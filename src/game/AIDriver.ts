import * as THREE from 'three';
import { Rng, clamp } from '../core/Noise';
import type { RoadPath } from './RoadPath';
import type { Vehicle, VehicleControls } from './Vehicle';

export type Difficulty = 'rookie' | 'pro' | 'veteran';

interface DifficultyProfile {
  /** Fraction of the truck's top speed the AI will aim for. */
  paceFactor: number;
  /** How far ahead it looks when steering, in metres. */
  lookahead: number;
  /** How hard it slows for upcoming curvature. */
  cornerCaution: number;
  /** Random lateral wander, in metres — keeps the field from single-filing. */
  wander: number;
  /** Reaction lag on the steering, in seconds. */
  reaction: number;
  /** Speed boost applied when trailing the player badly. */
  catchUp: number;
}

const PROFILES: Record<Difficulty, DifficultyProfile> = {
  rookie: { paceFactor: 0.72, lookahead: 16, cornerCaution: 1.5, wander: 3.5, reaction: 0.22, catchUp: 0.05 },
  pro: { paceFactor: 0.86, lookahead: 20, cornerCaution: 1.15, wander: 2.2, reaction: 0.14, catchUp: 0.1 },
  veteran: { paceFactor: 0.97, lookahead: 24, cornerCaution: 0.92, wander: 1.2, reaction: 0.08, catchUp: 0.16 },
};

/**
 * Waypoint-following AI.
 *
 * It drives the same spline the road is built from, aiming at a point some
 * distance ahead and braking for curvature it can see coming. Deliberately
 * not a racing-line optimiser: a slightly scruffy opponent that occasionally
 * runs wide is more fun to race than a perfect one, and it matches how the
 * originals felt.
 */
export class AIDriver {
  readonly vehicle: Vehicle;
  private road: RoadPath;
  private profile: DifficultyProfile;
  private rng: Rng;

  /** Lateral offset from the centreline this driver prefers. */
  private laneOffset: number;
  private wanderPhase: number;
  private smoothedSteer = 0;

  /** Seconds spent barely moving; triggers a reverse-out manoeuvre. */
  private stuckTimer = 0;
  private reverseTimer = 0;

  constructor(vehicle: Vehicle, road: RoadPath, difficulty: Difficulty, seed: number) {
    this.vehicle = vehicle;
    this.road = road;
    this.profile = PROFILES[difficulty];
    this.rng = new Rng(seed);
    this.laneOffset = this.rng.spread(4);
    this.wanderPhase = this.rng.range(0, Math.PI * 2);
  }

  /**
   * Produce this frame's controls.
   *
   * `playerProgress` and `ownProgress` are total distances travelled along
   * the course, used only for gentle rubber-banding.
   */
  update(dt: number, playerProgress: number, ownProgress: number): VehicleControls {
    const vehicle = this.vehicle;
    const position = vehicle.position;
    const query = this.road.closestTo(position.x, position.z);

    if (this.updateStuckState(dt)) {
      return this.reverseOut(query.lateral);
    }

    this.wanderPhase += dt * 0.6;

    // Aim at a point further ahead the faster we're going, so the line
    // smooths out with speed instead of sawing at the wheel.
    const speed = Math.max(0, vehicle.forwardSpeed);
    const lookaheadMetres = this.profile.lookahead + speed * 0.55;
    const lookaheadSamples = Math.round(lookaheadMetres / this.road.step);
    const targetIndex = query.index + lookaheadSamples;

    const targetPoint = this.road.pointAt(targetIndex).clone();
    const targetTangent = this.road.tangentAt(targetIndex);
    const right = new THREE.Vector3().crossVectors(targetTangent, new THREE.Vector3(0, 1, 0)).normalize();

    // Sit off-centre, drifting slowly, so the pack spreads across the road.
    const wander = Math.sin(this.wanderPhase) * this.profile.wander;
    const maxOffset = this.road.widthAt(targetIndex) * 0.5 - 2.5;
    targetPoint.addScaledVector(right, clamp(this.laneOffset + wander, -maxOffset, maxOffset));

    const steer = this.steerTowards(targetPoint, dt);
    const throttleBrake = this.choosePace(query.index, speed, playerProgress, ownProgress);

    return {
      steer,
      throttle: throttleBrake.throttle,
      brake: throttleBrake.brake,
      handbrake: false,
    };
  }

  /** Steering toward a world point, in the vehicle's own frame. */
  private steerTowards(target: THREE.Vector3, dt: number): number {
    const vehicle = this.vehicle;
    const position = vehicle.position;

    const toTarget = new THREE.Vector3(
      target.x - position.x,
      0,
      target.z - position.z,
    ).normalize();

    const forward = vehicle.forwardVector();
    forward.y = 0;
    forward.normalize();

    // With headings measured as atan2(x, z), this cross/dot pair gives
    // exactly (own heading - target bearing). Positive steer is a right turn,
    // which *decreases* that heading, so the correction takes the angle's
    // own sign — negating it steers the truck away from the racing line.
    const cross = forward.x * toTarget.z - forward.z * toTarget.x;
    const dot = clamp(forward.dot(toTarget), -1, 1);
    const angle = Math.atan2(cross, dot);
    const desired = clamp(angle * 1.6, -1, 1);

    // First-order lag stands in for reaction time and stops the AI from
    // snapping to full lock the instant the line moves.
    const blend = 1 - Math.exp(-dt / Math.max(0.016, this.profile.reaction));
    this.smoothedSteer += (desired - this.smoothedSteer) * blend;
    return clamp(this.smoothedSteer, -1, 1);
  }

  /** Decide throttle and brake from upcoming curvature and race position. */
  private choosePace(
    index: number,
    speed: number,
    playerProgress: number,
    ownProgress: number,
  ): { throttle: number; brake: number } {
    const physics = this.vehicle.definition.physics;

    // Look one to three seconds down the road for the sharpest bend.
    const near = Math.round(Math.max(12, speed * 1.0) / this.road.step);
    const far = Math.round(Math.max(28, speed * 2.4) / this.road.step);
    const curvature = Math.max(
      Math.abs(this.road.curvatureAt(index, near)),
      Math.abs(this.road.curvatureAt(index, far)) * 0.75,
    );

    // Convert bend severity into a target speed.
    const severity = clamp(curvature * this.profile.cornerCaution, 0, 1.4);
    let targetSpeed = physics.topSpeed * this.profile.paceFactor * (1 - severity * 0.62);

    // Rubber-banding, applied only when well behind and capped tightly, so
    // it closes a gap without ever feeling like the AI is cheating.
    const deficit = playerProgress - ownProgress;
    if (deficit > 60) {
      targetSpeed *= 1 + Math.min(0.18, (deficit - 60) / 900) * (this.profile.catchUp / 0.16);
    } else if (deficit < -120) {
      // Comfortably ahead: ease off rather than disappear over the horizon.
      targetSpeed *= 0.93;
    }

    targetSpeed = Math.max(8, targetSpeed);

    if (speed > targetSpeed * 1.12) return { throttle: 0, brake: 0.85 };
    if (speed > targetSpeed) return { throttle: 0.15, brake: 0 };
    return { throttle: 1, brake: 0 };
  }

  /** Track how long the truck has been going nowhere. */
  private updateStuckState(dt: number): boolean {
    if (this.reverseTimer > 0) {
      this.reverseTimer -= dt;
      return this.reverseTimer > 0;
    }

    const stalled = Math.abs(this.vehicle.forwardSpeed) < 1.6 && this.vehicle.groundedWheels > 0;
    this.stuckTimer = stalled ? this.stuckTimer + dt : 0;

    if (this.stuckTimer > 1.8) {
      this.stuckTimer = 0;
      this.reverseTimer = 1.4;
      return true;
    }
    return false;
  }

  /** Back away from whatever we drove into, turning towards the road. */
  private reverseOut(lateral: number): VehicleControls {
    return {
      throttle: 0,
      brake: 1,
      // Reversing inverts the steering geometry, so steer towards the side
      // we came from to swing the nose back over the road.
      steer: clamp(lateral * 0.35, -1, 1),
      handbrake: false,
    };
  }
}
