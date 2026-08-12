import * as THREE from 'three';
import { clamp } from '../core/Noise';
import type { Vehicle } from './Vehicle';

export type CameraMode = 'chase' | 'close' | 'hood';

interface CameraRig {
  /** Local offset behind (-Z) and above (+Y) the truck. */
  offset: THREE.Vector3;
  /** How far ahead of the truck the camera aims. */
  lookAhead: number;
  /** Position smoothing half-life in seconds; lower is tighter. */
  responsiveness: number;
  baseFov: number;
}

const RIGS: Record<CameraMode, CameraRig> = {
  chase: { offset: new THREE.Vector3(0, 4.2, -10.5), lookAhead: 8, responsiveness: 0.10, baseFov: 68 },
  close: { offset: new THREE.Vector3(0, 2.9, -7.0), lookAhead: 6, responsiveness: 0.06, baseFov: 74 },
  hood: { offset: new THREE.Vector3(0, 1.9, 0.9), lookAhead: 14, responsiveness: 0.02, baseFov: 80 },
};

const MODE_ORDER: CameraMode[] = ['chase', 'close', 'hood'];

/**
 * Chase camera.
 *
 * Follows the truck's yaw only. Inheriting pitch and roll is technically
 * more correct and completely unplayable — one barrel roll and the player
 * loses all sense of where the ground is. Keeping the camera level and
 * letting the truck tumble inside the frame is what the originals did, and
 * it reads far better.
 */
export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;

  private mode: CameraMode = 'chase';
  private lookingBack = false;
  private position = new THREE.Vector3();
  private target = new THREE.Vector3();
  private initialised = false;

  constructor(aspect: number, far: number) {
    this.camera = new THREE.PerspectiveCamera(RIGS.chase.baseFov, aspect, 0.4, far);
  }

  setMode(mode: CameraMode): void {
    this.mode = mode;
    this.initialised = false;
  }

  cycleMode(): CameraMode {
    const next = MODE_ORDER[(MODE_ORDER.indexOf(this.mode) + 1) % MODE_ORDER.length];
    this.setMode(next);
    return next;
  }

  setLookingBack(lookingBack: boolean): void {
    if (lookingBack !== this.lookingBack) this.initialised = false;
    this.lookingBack = lookingBack;
  }

  get currentMode(): CameraMode {
    return this.mode;
  }

  /** Snap to the truck without smoothing, e.g. after a respawn. */
  reset(): void {
    this.initialised = false;
  }

  update(dt: number, vehicle: Vehicle): void {
    const rig = RIGS[this.mode];

    // Yaw only: strip pitch and roll out of the truck's orientation.
    const forward = vehicle.forwardVector();
    let yaw = Math.atan2(forward.x, forward.z);
    if (this.lookingBack) yaw += Math.PI;

    const flatForward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const flatRight = new THREE.Vector3(flatForward.z, 0, -flatForward.x);

    const chassis = vehicle.position;
    const anchor = new THREE.Vector3(chassis.x, chassis.y, chassis.z);

    const desired = anchor
      .clone()
      .addScaledVector(flatForward, rig.offset.z)
      .addScaledVector(flatRight, rig.offset.x)
      .add(new THREE.Vector3(0, rig.offset.y, 0));

    // Pull back a little with speed so fast trucks don't fill the frame.
    const speed = vehicle.speed;
    const pullback = clamp(speed / 45, 0, 1) * 2.2;
    desired.addScaledVector(flatForward, -pullback);

    const desiredTarget = anchor
      .clone()
      .addScaledVector(flatForward, rig.lookAhead)
      .add(new THREE.Vector3(0, 1.4, 0));

    if (!this.initialised) {
      this.position.copy(desired);
      this.target.copy(desiredTarget);
      this.initialised = true;
    } else {
      // Frame-rate independent exponential smoothing.
      const positionBlend = 1 - Math.exp(-dt / Math.max(0.001, rig.responsiveness));
      const targetBlend = 1 - Math.exp(-dt / 0.07);
      this.position.lerp(desired, positionBlend);
      this.target.lerp(desiredTarget, targetBlend);
    }

    this.camera.position.copy(this.position);
    this.camera.lookAt(this.target);

    // Widen the lens with speed for a cheap sense of velocity.
    const targetFov = rig.baseFov + clamp(speed / 50, 0, 1) * 10;
    this.camera.fov += (targetFov - this.camera.fov) * (1 - Math.exp(-dt / 0.25));
    this.camera.updateProjectionMatrix();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
