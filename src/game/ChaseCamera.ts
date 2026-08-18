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

/**
 * Camera rigs, framed for a monster truck: the body sits roughly two metres
 * up and stands another two above that, so these are higher and further back
 * than a car would need, and they aim above the truck's own roofline.
 */
const RIGS: Record<CameraMode, CameraRig> = {
  chase: { offset: new THREE.Vector3(0, 6.0, -13.5), lookAhead: 9, responsiveness: 0.10, baseFov: 68 },
  close: { offset: new THREE.Vector3(0, 4.4, -9.5), lookAhead: 7, responsiveness: 0.06, baseFov: 74 },
  // Roughly where a driver's head would be, above the front axle.
  hood: { offset: new THREE.Vector3(0, 1.5, 1.1), lookAhead: 16, responsiveness: 0.02, baseFov: 82 },
};

const MODE_ORDER: CameraMode[] = ['chase', 'close', 'hood'];

/** Minimum height the camera keeps above the terrain, in metres. */
const GROUND_CLEARANCE = 1.8;

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
  /**
   * Backward-facing camera feeding the rear-view mirror.
   *
   * Mounted above the cab rather than at the chase camera's position, so the
   * mirror shows what is behind the *truck* — from the chase position the
   * truck's own body fills most of the frame.
   */
  readonly mirrorCamera: THREE.PerspectiveCamera;

  private mode: CameraMode = 'chase';
  private lookingBack = false;
  private position = new THREE.Vector3();
  private target = new THREE.Vector3();
  private initialised = false;

  /**
   * Terrain height lookup, used to stop the camera burying itself in the
   * ground. Without it, launching off a crest drops the trailing camera
   * inside the hill and the player spends the jump looking at the underside
   * of the terrain.
   */
  private groundProbe: ((x: number, z: number) => number) | null = null;

  constructor(aspect: number, far: number, mirrorAspect = 3.2) {
    this.camera = new THREE.PerspectiveCamera(RIGS.chase.baseFov, aspect, 0.4, far);
    // Wide and short: a mirror strip covers a lot of lateral view but very
    // little vertically, which is also what makes it cheap to render.
    this.mirrorCamera = new THREE.PerspectiveCamera(48, mirrorAspect, 0.4, far);
  }

  /** Supply a terrain height lookup so the camera can stay above ground. */
  setGroundProbe(probe: (x: number, z: number) => number): void {
    this.groundProbe = probe;
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
    const truckYaw = Math.atan2(forward.x, forward.z);
    const yaw = this.lookingBack ? truckYaw + Math.PI : truckYaw;

    // The mirror always faces astern of the truck, independent of which way
    // the chase camera is pointing — otherwise holding "look back" would aim
    // the mirror forwards.
    const truckForward = new THREE.Vector3(Math.sin(truckYaw), 0, Math.cos(truckYaw));
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
      .add(new THREE.Vector3(0, 2.2, 0));

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

    // Hold the camera clear of the ground. Applied after smoothing so the
    // lift is immediate — easing it in would let the terrain swallow the
    // camera for a few frames on a sharp crest, which is exactly when it
    // matters most.
    if (this.groundProbe) {
      const floor = this.groundProbe(this.position.x, this.position.z) + GROUND_CLEARANCE;
      if (this.position.y < floor) this.position.y = floor;
    }

    this.camera.position.copy(this.position);
    this.camera.lookAt(this.target);

    // Widen the lens with speed for a cheap sense of velocity.
    const targetFov = rig.baseFov + clamp(speed / 50, 0, 1) * 10;
    this.camera.fov += (targetFov - this.camera.fov) * (1 - Math.exp(-dt / 0.25));
    this.camera.updateProjectionMatrix();

    this.updateMirror(anchor, truckForward);
  }

  /**
   * Aim the mirror camera backwards from above the cab.
   *
   * Like the chase camera it uses yaw only. A mirror that rolled with the
   * truck would be technically right and completely unreadable, since the
   * horizon behind you would tumble every time you landed a jump.
   */
  private updateMirror(anchor: THREE.Vector3, flatForward: THREE.Vector3): void {
    const mount = anchor
      .clone()
      .addScaledVector(flatForward, -0.4)
      .add(new THREE.Vector3(0, 2.9, 0));

    if (this.groundProbe) {
      const floor = this.groundProbe(mount.x, mount.z) + GROUND_CLEARANCE;
      if (mount.y < floor) mount.y = floor;
    }

    this.mirrorCamera.position.copy(mount);
    this.mirrorCamera.lookAt(
      mount.clone().addScaledVector(flatForward, -20).add(new THREE.Vector3(0, -1.2, 0)),
    );
  }

  setMirrorAspect(aspect: number): void {
    this.mirrorCamera.aspect = aspect;
    this.mirrorCamera.updateProjectionMatrix();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
