import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import type { Track } from './Track';
import type { Race } from './Race';
import type { RoadPath } from './RoadPath';

/**
 * Visual debugging for track and AI authoring.
 *
 * Everything here is drawn from the data the simulation actually uses — the
 * collision shapes come out of the physics world, not the track JSON — so a
 * mismatch between what you modelled and what you collide with shows up
 * immediately. That mismatch is the single most common authoring mistake and
 * is otherwise invisible until a truck drives through a wall.
 */

const COLOUR_STATIC = 0xff8c1a;
const COLOUR_CHASSIS = 0x2ad4ff;
const COLOUR_GATE = 0xffe14d;
const COLOUR_SPAWN = 0x4dffd2;
const COLOUR_LINE = 0xff4dd2;
const COLOUR_TARGET = 0xff2a2a;

export class DebugOverlay {
  readonly group = new THREE.Group();

  private aiTargets: THREE.Mesh[] = [];
  private built = false;
  private disposables: { dispose(): void }[] = [];

  constructor() {
    this.group.name = 'debug-overlay';
    this.group.visible = false;
    // Draw on top of the world; the point is to see collision through the
    // scenery it wraps.
    this.group.renderOrder = 10;
  }

  get visible(): boolean {
    return this.group.visible;
  }

  toggle(track: Track, race: Race): boolean {
    if (!this.built) this.build(track, race);
    this.group.visible = !this.group.visible;
    return this.group.visible;
  }

  private lineMaterial(colour: number): THREE.LineBasicMaterial {
    const material = new THREE.LineBasicMaterial({
      color: colour,
      depthTest: false,
      transparent: true,
      opacity: 0.9,
      fog: false,
    });
    this.disposables.push(material);
    return material;
  }

  private build(track: Track, race: Race): void {
    this.built = true;
    this.buildCollisionShapes(track);
    this.buildGates(track);
    this.buildSpawns(track);
    this.buildRacingLine(track.road);
    this.buildAiTargets(race);
  }

  /**
   * Wireframes for every static collision shape in the world.
   *
   * Heightfields are skipped: the terrain is tens of thousands of triangles
   * and drawing it as wireframe hides everything else.
   */
  private buildCollisionShapes(track: Track): void {
    const staticMaterial = this.lineMaterial(COLOUR_STATIC);
    const chassisMaterial = this.lineMaterial(COLOUR_CHASSIS);

    for (const body of track.world.bodies) {
      const isStatic = body.mass === 0;
      const material = isStatic ? staticMaterial : chassisMaterial;

      for (let i = 0; i < body.shapes.length; i++) {
        const shape = body.shapes[i];
        const geometry = this.geometryForShape(shape);
        if (!geometry) continue;

        const wireframe = new THREE.WireframeGeometry(geometry);
        geometry.dispose();
        const lines = new THREE.LineSegments(wireframe, material);
        this.disposables.push({ dispose: () => wireframe.dispose() });

        // Bake the shape's offset within its body into the object transform.
        const offset = body.shapeOffsets[i] ?? new CANNON.Vec3();
        const orientation = body.shapeOrientations[i] ?? new CANNON.Quaternion();
        const local = new THREE.Vector3(offset.x, offset.y, offset.z);
        const localQuat = new THREE.Quaternion(
          orientation.x, orientation.y, orientation.z, orientation.w,
        );

        const bodyQuat = new THREE.Quaternion(
          body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w,
        );
        lines.position
          .copy(local.applyQuaternion(bodyQuat))
          .add(new THREE.Vector3(body.position.x, body.position.y, body.position.z));
        lines.quaternion.copy(bodyQuat).multiply(localQuat);
        lines.renderOrder = 10;

        this.group.add(lines);
      }
    }
  }

  private geometryForShape(shape: CANNON.Shape): THREE.BufferGeometry | null {
    if (shape instanceof CANNON.Box) {
      const h = shape.halfExtents;
      return new THREE.BoxGeometry(h.x * 2, h.y * 2, h.z * 2);
    }

    if (shape instanceof CANNON.Sphere) {
      return new THREE.SphereGeometry(shape.radius, 8, 6);
    }

    if (shape instanceof CANNON.ConvexPolyhedron) {
      const geometry = new THREE.BufferGeometry();
      const positions: number[] = [];
      // cannon faces are index loops of arbitrary length; fan-triangulate.
      for (const face of shape.faces) {
        for (let i = 1; i < face.length - 1; i++) {
          for (const index of [face[0], face[i], face[i + 1]]) {
            const v = shape.vertices[index];
            positions.push(v.x, v.y, v.z);
          }
        }
      }
      if (positions.length === 0) return null;
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      return geometry;
    }

    // Heightfield and anything else: deliberately not drawn.
    return null;
  }

  /** A bar across each checkpoint gate, at the width the gate actually uses. */
  private buildGates(track: Track): void {
    const material = this.lineMaterial(COLOUR_GATE);
    const points: THREE.Vector3[] = [];

    for (const gate of track.checkpoints) {
      const right = new THREE.Vector3()
        .crossVectors(gate.forward, new THREE.Vector3(0, 1, 0))
        .normalize();
      const left = gate.position.clone().addScaledVector(right, -gate.halfWidth);
      const rightEnd = gate.position.clone().addScaledVector(right, gate.halfWidth);

      // Posts at each end plus the bar between them.
      points.push(left, rightEnd);
      points.push(left, left.clone().add(new THREE.Vector3(0, 6, 0)));
      points.push(rightEnd, rightEnd.clone().add(new THREE.Vector3(0, 6, 0)));
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    this.disposables.push({ dispose: () => geometry.dispose() });
    const lines = new THREE.LineSegments(geometry, material);
    lines.renderOrder = 10;
    this.group.add(lines);
  }

  private buildSpawns(track: Track): void {
    const material = this.lineMaterial(COLOUR_SPAWN);
    const points: THREE.Vector3[] = [];

    for (const spawn of track.spawns) {
      const base = spawn.position.clone();
      points.push(base, base.clone().add(new THREE.Vector3(0, 4, 0)));
      // A short spur showing which way the truck will face.
      const forward = new THREE.Vector3(Math.sin(spawn.heading), 0, Math.cos(spawn.heading));
      points.push(base, base.clone().addScaledVector(forward, 3));
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    this.disposables.push({ dispose: () => geometry.dispose() });
    const lines = new THREE.LineSegments(geometry, material);
    lines.renderOrder = 10;
    this.group.add(lines);
  }

  /** The spline the AI follows, lifted clear of the road so it reads. */
  private buildRacingLine(road: RoadPath): void {
    const material = this.lineMaterial(COLOUR_LINE);
    const points = road.points.map((p) => p.clone().add(new THREE.Vector3(0, 0.6, 0)));
    if (road.closed && points.length > 0) points.push(points[0].clone());

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    this.disposables.push({ dispose: () => geometry.dispose() });
    const line = new THREE.Line(geometry, material);
    line.renderOrder = 10;
    this.group.add(line);
  }

  /** One marker per racer, moved each frame to its steering target. */
  private buildAiTargets(race: Race): void {
    const geometry = new THREE.OctahedronGeometry(1.1);
    const material = new THREE.MeshBasicMaterial({
      color: COLOUR_TARGET,
      wireframe: true,
      depthTest: false,
      fog: false,
    });
    this.disposables.push({ dispose: () => geometry.dispose() });
    this.disposables.push(material);

    for (let i = 0; i < race.racers.length; i++) {
      const marker = new THREE.Mesh(geometry, material);
      marker.renderOrder = 10;
      marker.visible = false;
      this.aiTargets.push(marker);
      this.group.add(marker);
    }
  }

  /**
   * Move the per-racer markers onto the point each one is steering at.
   * Recomputed here rather than read from the driver so the overlay stays
   * decoupled from the AI's internals.
   */
  update(track: Track, race: Race): void {
    if (!this.group.visible) return;

    for (let i = 0; i < this.aiTargets.length; i++) {
      const racer = race.racers[i];
      const marker = this.aiTargets[i];
      if (!racer) {
        marker.visible = false;
        continue;
      }

      const position = racer.vehicle.position;
      const query = track.road.closestTo(position.x, position.z);
      const lookahead = Math.round(
        (16 + Math.max(0, racer.vehicle.forwardSpeed) * 0.55) / track.road.step,
      );
      const target = track.road.pointAt(query.index + lookahead);
      marker.position.copy(target).add(new THREE.Vector3(0, 1.4, 0));
      marker.visible = true;
    }
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
    this.disposables = [];
    this.aiTargets = [];
    this.group.clear();
    this.built = false;
  }
}
