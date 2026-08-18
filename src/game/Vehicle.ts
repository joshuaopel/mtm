import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { clamp } from '../core/Noise';
import { buildTruckMesh, buildTruckMeshFromModel } from './TruckMesh';
import type { MTMVehicle } from './formats';

export interface VehicleControls {
  /** 0..1 */
  throttle: number;
  /** 0..1; doubles as reverse once the truck has stopped. */
  brake: number;
  /** -1 (left) .. 1 (right) */
  steer: number;
  handbrake: boolean;
  /**
   * Hold the truck stationary regardless of the other inputs.
   *
   * Needed for the pre-race grid: holding the line with `brake: 1` would be
   * read as "stopped and still braking", which is exactly the condition that
   * engages reverse, and the whole field would trickle backwards off the
   * start line.
   */
  parked?: boolean;
}

const WHEEL_COUNT = 4;
/** Wheels 0 and 1 are the front pair and are the only ones that steer. */
const STEERED_WHEELS = [0, 1];

/**
 * Below this speed (m/s) a truck counts as going nowhere. Set above walking
 * pace so a genuinely slow crawl out of a rut doesn't read as stuck, but low
 * enough that grinding along a wall does.
 */
const STUCK_SPEED = 2.0;

/**
 * A driveable monster truck: cannon `RaycastVehicle` for the simulation,
 * a procedural mesh for the visuals, and an arcade control layer on top.
 *
 * The control layer is where the "madness" lives. A literal vehicle sim is
 * miserable to drive with a keyboard, so we add the things the era's racers
 * did: forgiving grip, mid-air attitude control, speed-sensitive steering
 * and an automatic recovery when you inevitably land on the roof.
 */
export class Vehicle {
  readonly definition: MTMVehicle;
  readonly chassis: CANNON.Body;
  readonly raycast: CANNON.RaycastVehicle;
  readonly object = new THREE.Group();

  private bodyMesh: THREE.Group;
  private wheelMeshes: THREE.Group[];
  private world: CANNON.World;

  private controls: VehicleControls = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  private steerAngle = 0;
  private upsideDownFor = 0;
  /**
   * Wheel contact count, latched immediately after the physics step.
   *
   * cannon's `updateWheelTransform` resets `isInContact` as its first act, so
   * reading the flags after we sync the meshes always reports zero contacts.
   * Latching the count before syncing is what keeps `airborne` honest.
   */
  private contactCount = 0;

  /** Set when the truck has been on its roof long enough to need rescuing. */
  needsRescue = false;

  /**
   * Seconds spent going nowhere: wedged against scenery, beached on its roof,
   * or facing a wall with the throttle buried. Drives the auto-respawn.
   */
  stuckFor = 0;

  constructor(
    definition: MTMVehicle,
    world: CANNON.World,
    wheelMaterial: CANNON.Material,
    model?: THREE.Group,
  ) {
    this.definition = definition;
    this.world = world;
    const physics = definition.physics;

    const half = new CANNON.Vec3(
      physics.chassisSize[0] / 2,
      physics.chassisSize[1] / 2,
      physics.chassisSize[2] / 2,
    );

    this.chassis = new CANNON.Body({ mass: physics.mass, material: wheelMaterial });
    this.chassis.addShape(
      new CANNON.Box(half),
      new CANNON.Vec3(...physics.chassisOffset),
    );
    // Angular damping keeps the truck from spinning like a top after a bad
    // landing; linear damping stands in for drag we don't otherwise model.
    this.chassis.angularDamping = 0.32;
    this.chassis.linearDamping = 0.01;

    this.raycast = new CANNON.RaycastVehicle({
      chassisBody: this.chassis,
      // three.js-style axes: X right, Y up, Z forward.
      indexRightAxis: 0,
      indexUpAxis: 1,
      indexForwardAxis: 2,
    });

    const [frontHalfTrack, frontZ] = physics.frontAxle;
    const [rearHalfTrack, rearZ] = physics.rearAxle;
    const layout: [number, number][] = [
      [-frontHalfTrack, frontZ],
      [frontHalfTrack, frontZ],
      [-rearHalfTrack, rearZ],
      [rearHalfTrack, rearZ],
    ];

    for (const [x, z] of layout) {
      this.raycast.addWheel({
        radius: physics.wheelRadius,
        directionLocal: new CANNON.Vec3(0, -1, 0),
        // Must be +X. cannon derives the side-friction axle from the
        // hardcoded `directions[indexRightAxis]` rather than from this
        // vector, so any other value leaves the steering geometry and the
        // friction axis mirrored — the wheels then fight each other and
        // generate lateral impulses that roll the truck onto its roof under
        // straight-line acceleration.
        axleLocal: new CANNON.Vec3(1, 0, 0),
        chassisConnectionPointLocal: new CANNON.Vec3(x, physics.axleHeight, z),
        suspensionRestLength: physics.suspensionRest,
        suspensionStiffness: physics.suspensionStiffness,
        dampingRelaxation: physics.suspensionDamping,
        dampingCompression: physics.suspensionCompression,
        maxSuspensionTravel: physics.maxSuspensionTravel,
        maxSuspensionForce: physics.maxSuspensionForce,
        frictionSlip: physics.frictionSlip,
        rollInfluence: physics.rollInfluence,
        customSlidingRotationalSpeed: -30,
        useCustomSlidingRotationalSpeed: true,
      });
    }

    this.raycast.addToWorld(world);

    // A modelled truck when one loaded, the procedural build otherwise.
    const mesh =
      (model ? buildTruckMeshFromModel(definition, model) : null) ?? buildTruckMesh(definition);
    this.bodyMesh = mesh.body;
    this.wheelMeshes = mesh.wheels;
    this.object.add(this.bodyMesh);
    for (const wheel of this.wheelMeshes) this.object.add(wheel);
    // Wheels are placed in world space from the physics transforms, so the
    // group itself must not add a transform of its own.
    this.object.matrixAutoUpdate = false;
    this.object.updateMatrix();
  }

  setControls(controls: VehicleControls): void {
    this.controls = controls;
  }

  /** Signed speed along the truck's own forward axis, in m/s. */
  get forwardSpeed(): number {
    const forward = new CANNON.Vec3(0, 0, 1);
    this.chassis.quaternion.vmult(forward, forward);
    return this.chassis.velocity.dot(forward);
  }

  get speed(): number {
    return this.chassis.velocity.length();
  }

  get position(): CANNON.Vec3 {
    return this.chassis.position;
  }

  /** Number of wheels touching ground as of the last physics step. */
  get groundedWheels(): number {
    return this.contactCount;
  }

  get airborne(): boolean {
    return this.groundedWheels === 0;
  }

  /** World-space forward direction. */
  forwardVector(target = new THREE.Vector3()): THREE.Vector3 {
    const forward = new CANNON.Vec3(0, 0, 1);
    this.chassis.quaternion.vmult(forward, forward);
    return target.set(forward.x, forward.y, forward.z);
  }

  /** How upright the truck is: 1 level, 0 on its side, -1 fully inverted. */
  get uprightness(): number {
    const up = new CANNON.Vec3(0, 1, 0);
    this.chassis.quaternion.vmult(up, up);
    return up.y;
  }

  update(dt: number): void {
    const speed = this.forwardSpeed;
    const absSpeed = Math.abs(speed);

    this.updateSteering(dt, absSpeed);
    this.updateDrive(speed, absSpeed);
    this.updateAerodynamics(absSpeed);
    this.updateAirControl(dt);
    this.clampVelocities();
    this.updateRescueTimer(dt);
  }

  private updateSteering(dt: number, absSpeed: number): void {
    const physics = this.definition.physics;

    // Taper the steering lock as speed rises, or the truck becomes
    // undriveable above about 20 m/s.
    const speedFactor = clamp(absSpeed / physics.topSpeed, 0, 1);
    const maxSteer =
      physics.maxSteer * (1 - speedFactor * (1 - physics.highSpeedSteerFactor));

    const target = this.controls.steer * maxSteer;
    const maxDelta = physics.steerRate * dt;
    // Move towards the target at a bounded rate; instant steering input
    // makes a heavy vehicle feel weightless.
    this.steerAngle += clamp(target - this.steerAngle, -maxDelta, maxDelta);

    // `steerAngle` is kept in player space (positive = right) for the HUD and
    // the AI. cannon's sign is the opposite here: with a +Z-facing model,
    // right is -X, so a positive steering value yaws the truck left. Negate
    // once, at the boundary, rather than inverting the input everywhere.
    for (const index of STEERED_WHEELS) {
      this.raycast.setSteeringValue(-this.steerAngle, index);
    }
  }

  private updateDrive(speed: number, absSpeed: number): void {
    const physics = this.definition.physics;
    const { throttle, brake, handbrake } = this.controls;

    if (this.controls.parked) {
      for (let i = 0; i < WHEEL_COUNT; i++) {
        this.raycast.applyEngineForce(0, i);
        this.raycast.setBrake(physics.handbrakeForce * 2, i);
        this.raycast.wheelInfos[i].frictionSlip = physics.frictionSlip;
      }
      return;
    }

    let engineForce = 0;
    let brakeForce = 0;

    if (throttle > 0.01) {
      // Taper drive to nothing as we approach the soft top speed, giving a
      // natural-feeling cap without a hard velocity clamp.
      const headroom = clamp(1 - speed / physics.topSpeed, 0, 1);
      engineForce = -physics.engineForce * throttle * headroom;
    }

    if (brake > 0.01) {
      if (speed > 1.0) {
        // Moving forward: the brake pedal is a brake.
        brakeForce = physics.brakeForce * brake;
      } else {
        // Stopped or already rolling back: it becomes reverse, capped lower
        // than forward drive so reversing never feels like a shortcut.
        const headroom = clamp(1 + speed / (physics.topSpeed * 0.45), 0, 1);
        engineForce = physics.engineForce * 0.55 * brake * headroom;
      }
    }

    if (throttle < 0.01 && brake < 0.01) {
      if (absSpeed > 0.5) {
        // Light engine braking, so lifting off actually slows you down.
        brakeForce = physics.brakeForce * 0.04;
      } else {
        // Hold the truck once it has stopped. cannon's wheels have no rolling
        // resistance of their own, so without this a parked truck slides
        // away down the gentlest camber.
        brakeForce = physics.handbrakeForce;
      }
    }

    for (let i = 0; i < WHEEL_COUNT; i++) {
      // Four-wheel drive, as any real monster truck is.
      this.raycast.applyEngineForce(engineForce, i);
      this.raycast.setBrake(brakeForce, i);
    }

    if (handbrake) {
      for (let i = 2; i < WHEEL_COUNT; i++) {
        this.raycast.applyEngineForce(0, i);
        this.raycast.setBrake(physics.handbrakeForce, i);
      }
      // Break rear traction so the handbrake actually rotates the truck
      // instead of just stopping it.
      this.raycast.wheelInfos[2].frictionSlip = physics.frictionSlip * 0.35;
      this.raycast.wheelInfos[3].frictionSlip = physics.frictionSlip * 0.35;
    } else {
      this.raycast.wheelInfos[2].frictionSlip = physics.frictionSlip;
      this.raycast.wheelInfos[3].frictionSlip = physics.frictionSlip;
    }
  }

  private updateAerodynamics(absSpeed: number): void {
    const physics = this.definition.physics;
    if (physics.downforce <= 0 || this.airborne) return;

    // Push down along the truck's own up axis so downforce still helps when
    // running across a banked or cambered surface.
    const up = new CANNON.Vec3(0, 1, 0);
    this.chassis.quaternion.vmult(up, up);
    const force = up.scale(-physics.downforce * absSpeed * absSpeed);

    // Applied at the centre of mass, so it adds load without adding torque.
    // cannon's second argument is an offset *from* the centre of mass, not a
    // world point: passing the body's world position turns this into a lever
    // hundreds of metres long and flips the truck as soon as it gains speed.
    this.chassis.applyForce(force);
  }

  /**
   * Mid-air attitude control. Without this, one bad ramp ends the race —
   * and every arcade racer of the period let you save a jump.
   */
  private updateAirControl(dt: number): void {
    if (!this.airborne) return;
    const physics = this.definition.physics;

    // `airControl` is an angular acceleration in rad/s^2, so the per-step
    // change in angular velocity is simply rate * dt. It is emphatically not
    // a torque: scaling this by mass injects tens of rad/s every frame and
    // detonates the solver instantly.
    const delta = physics.airControl * dt;

    // Signs follow from the +Z-forward frame: +X spins the nose down,
    // +Y yaws left, +Z rolls the right-hand side down.
    const spin = new CANNON.Vec3(
      // Nose up under throttle, nose down under brake, to set up landings.
      (this.controls.brake - this.controls.throttle) * delta,
      -this.controls.steer * delta * 0.8,
      this.controls.steer * delta * 0.35, // a little roll into the yaw
    );
    this.chassis.quaternion.vmult(spin, spin);
    this.chassis.angularVelocity.vadd(spin, this.chassis.angularVelocity);
  }

  /**
   * Safety net against solver blow-ups.
   *
   * A truck wedged into geometry can pick up absurd velocities in a single
   * step. Clamping keeps a bad frame recoverable instead of firing the truck
   * into orbit, where nothing downstream — camera, AI, lap logic — is valid.
   */
  private clampVelocities(): void {
    const maxAngular = 12; // rad/s, about two rotations a second
    const maxLinear = 120; // m/s, far above any truck's top speed

    const angular = this.chassis.angularVelocity;
    const angularSpeed = angular.length();
    if (angularSpeed > maxAngular) angular.scale(maxAngular / angularSpeed, angular);

    const linear = this.chassis.velocity;
    const linearSpeed = linear.length();
    if (linearSpeed > maxLinear) linear.scale(maxLinear / linearSpeed, linear);
  }

  private updateRescueTimer(dt: number): void {
    // Only count time spent inverted *and* essentially stationary, so a
    // barrel roll mid-jump doesn't trigger a rescue.
    if (this.uprightness < 0.15 && this.speed < 2.5) {
      this.upsideDownFor += dt;
    } else {
      this.upsideDownFor = 0;
    }
    this.needsRescue = this.upsideDownFor > 2.5;

    // Separately, track going nowhere for any reason. A truck parked on the
    // grid is not stuck, so the countdown hold is excluded.
    const crawling = this.speed < STUCK_SPEED;
    if (crawling && !this.controls.parked) {
      this.stuckFor += dt;
    } else {
      this.stuckFor = 0;
    }
  }

  /**
   * Copy physics transforms onto the visual meshes. Must be called after
   * `world.step` and before the next `update`, since it latches the wheel
   * contact flags that `updateWheelTransform` is about to clear.
   */
  syncMesh(): void {
    this.contactCount = 0;
    for (const wheel of this.raycast.wheelInfos) {
      if (wheel.isInContact) this.contactCount++;
    }

    this.bodyMesh.position.set(
      this.chassis.position.x,
      this.chassis.position.y,
      this.chassis.position.z,
    );
    this.bodyMesh.quaternion.set(
      this.chassis.quaternion.x,
      this.chassis.quaternion.y,
      this.chassis.quaternion.z,
      this.chassis.quaternion.w,
    );

    for (let i = 0; i < WHEEL_COUNT; i++) {
      this.raycast.updateWheelTransform(i);
      const transform = this.raycast.wheelInfos[i].worldTransform;
      const wheel = this.wheelMeshes[i];
      wheel.position.set(transform.position.x, transform.position.y, transform.position.z);
      wheel.quaternion.set(
        transform.quaternion.x,
        transform.quaternion.y,
        transform.quaternion.z,
        transform.quaternion.w,
      );
    }
  }

  /** Drop the truck at a position and heading, fully at rest. */
  reset(position: THREE.Vector3, heading: number): void {
    this.chassis.position.set(position.x, position.y, position.z);
    this.chassis.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), heading);
    this.chassis.velocity.set(0, 0, 0);
    this.chassis.angularVelocity.set(0, 0, 0);
    this.chassis.force.set(0, 0, 0);
    this.chassis.torque.set(0, 0, 0);
    this.chassis.wakeUp();

    this.steerAngle = 0;
    this.upsideDownFor = 0;
    this.needsRescue = false;
    this.stuckFor = 0;

    for (let i = 0; i < WHEEL_COUNT; i++) {
      this.raycast.applyEngineForce(0, i);
      this.raycast.setBrake(0, i);
      this.raycast.setSteeringValue(0, i);
    }
    this.syncMesh();
  }

  dispose(): void {
    this.raycast.removeFromWorld(this.world);
    this.object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
      }
    });
  }
}
