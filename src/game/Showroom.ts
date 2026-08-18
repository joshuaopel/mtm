import * as THREE from 'three';
import { skyTexture, groundTexture } from '../core/Textures';
import { buildTruckMesh } from './TruckMesh';
import type { MTMVehicle } from './formats';

/**
 * Turntable scene used behind the title and vehicle-select screens.
 *
 * Rendered through the same retro pipeline as the race, so the truck you
 * pick looks exactly as it will on track — chunky pixels, dithering and all.
 */
export class Showroom {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;

  private turntable = new THREE.Group();
  private current: THREE.Group | null = null;
  private spin = 0;
  private wheels: THREE.Group[] = [];
  /**
   * Lateral dolly, in metres. Camera and look-target move together so the
   * view direction is unchanged and the truck simply slides across the
   * frame — which lets a screen park it clear of its own UI panels.
   */
  private subjectOffset = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(40, aspect, 0.3, 400);
    this.camera.position.set(0, 3.6, 16);
    this.camera.lookAt(0, 1.4, 0);

    this.scene.fog = new THREE.FogExp2(new THREE.Color('#2a2a30'), 0.012);
    this.scene.background = new THREE.Color('#2a2a30');

    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(160, 16, 12),
      new THREE.MeshBasicMaterial({
        map: skyTexture('#1a1a24', '#6a5a48'),
        side: THREE.BackSide,
        fog: false,
        depthWrite: false,
      }),
    );
    this.scene.add(dome);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(90, 24),
      new THREE.MeshLambertMaterial({ map: groundTexture('dirt', 24) }),
    );
    ground.rotateX(-Math.PI / 2);
    this.scene.add(ground);

    // Three-point-ish lighting: a warm key from the front left, a cool rim
    // from behind, and enough ambient that the dark panels still read.
    const key = new THREE.DirectionalLight('#fff0d8', 1.5);
    key.position.set(-6, 9, 8);
    this.scene.add(key);

    const rim = new THREE.DirectionalLight('#88a8d8', 0.9);
    rim.position.set(5, 4, -8);
    this.scene.add(rim);

    this.scene.add(new THREE.AmbientLight('#606878', 1.1));
    this.scene.add(this.turntable);
  }

  /** Swap in a different truck. Safe to call every frame with the same id. */
  setVehicle(vehicle: MTMVehicle | null): void {
    if (this.current) {
      this.turntable.remove(this.current);
      disposeGroup(this.current);
      for (const wheel of this.wheels) {
        this.turntable.remove(wheel);
        disposeGroup(wheel);
      }
      this.current = null;
      this.wheels = [];
    }
    if (!vehicle) return;

    const built = buildTruckMesh(vehicle);
    const physics = vehicle.physics;

    // Sit the truck on its wheels at the height its own springs would settle
    // at, using the same rest-compression formula as the running gear.
    const restCompression = Math.min(
      physics.maxSuspensionTravel,
      19.6 / (4 * physics.suspensionStiffness),
    );
    const rideHeight =
      physics.wheelRadius + (physics.suspensionRest - restCompression) - physics.axleHeight;
    built.body.position.y = rideHeight;
    this.turntable.add(built.body);
    this.current = built.body;

    for (let i = 0; i < built.wheels.length; i++) {
      const wheel = built.wheels[i];
      const [halfTrack, z] = i < 2 ? physics.frontAxle : physics.rearAxle;
      wheel.position.set(i % 2 === 0 ? -halfTrack : halfTrack, physics.wheelRadius, z);
      this.turntable.add(wheel);
      this.wheels.push(wheel);
    }
  }

  /**
   * Slide the truck across the frame. Negative values move it to the right
   * of screen, leaving the left free for a list panel.
   */
  setSubjectOffset(offset: number): void {
    this.subjectOffset = offset;
  }

  update(dt: number): void {
    this.spin += dt * 0.42;
    this.turntable.rotation.y = this.spin;
    // Gentle bob so the shot never looks like a still image.
    this.camera.position.set(this.subjectOffset, 3.6 + Math.sin(this.spin * 0.6) * 0.35, 16);
    this.camera.lookAt(this.subjectOffset, 1.3, 0);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}

function disposeGroup(group: THREE.Object3D): void {
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) child.geometry.dispose();
  });
}
