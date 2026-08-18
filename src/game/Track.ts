import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Rng } from '../core/Noise';
import { checkerTexture, imageTexture, roadTexture, skyTexture, wallTexture } from '../core/Textures';
import { RoadPath } from './RoadPath';
import { Terrain } from './Terrain';
import { buildProp } from './Props';
import { disposeModel } from '../core/Assets';
import type { MTMTrack, TrackCheckpoint, TrackCollider, TrackWall } from './formats';

/**
 * How far above the road a truck is placed.
 *
 * Monster trucks stand roughly 2.3m to their centre of mass, so these clear
 * the tallest truck in the roster with a little slack. Spawning too low drops
 * the chassis inside the terrain, and the solver ejects it violently.
 */
const SPAWN_LIFT = 2.8;
/** Respawns get extra room, since the truck is usually wedged on something. */
const RESPAWN_LIFT = 3.3;

function clampUnit(value: number): number {
  return value < -1 ? -1 : value > 1 ? 1 : value;
}

export interface Checkpoint {
  index: number;
  position: THREE.Vector3;
  /** Unit vector along the racing direction, i.e. the gate's facing. */
  forward: THREE.Vector3;
  halfWidth: number;
  /** Arc length along the road, used to order progress within a lap. */
  roadDistance: number;
}

export interface SpawnPoint {
  position: THREE.Vector3;
  heading: number;
}

/**
 * A loaded, playable track: scene graph on one side, physics bodies on the
 * other, plus the navigation data the race director and AI need.
 */
export class Track {
  readonly definition: MTMTrack;
  readonly scene = new THREE.Scene();
  readonly world: CANNON.World;
  readonly road: RoadPath;
  readonly terrain: Terrain;
  readonly checkpoints: Checkpoint[] = [];
  readonly spawns: SpawnPoint[] = [];
  readonly groundMaterial = new CANNON.Material('ground');

  /** Far plane, derived from fog density so geometry fades before it pops. */
  readonly viewDistance: number;

  private disposables: { dispose(): void }[] = [];
  /** Pre-loaded glTF models, keyed by URL. Empty for fully procedural tracks. */
  private models: Map<string, THREE.Group>;

  constructor(definition: MTMTrack, models: Map<string, THREE.Group> = new Map()) {
    this.definition = definition;
    this.models = models;
    this.road = new RoadPath(definition.road);

    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -19.6, 0), // 2g: arcade trucks land, they don't float
    });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.defaultContactMaterial.friction = 0.35;
    this.world.defaultContactMaterial.restitution = 0.08;
    (this.world.solver as CANNON.GSSolver).iterations = 12;
    this.world.allowSleep = true;

    this.terrain = new Terrain(
      definition.terrain,
      this.road,
      definition.environment.surface,
      definition.environment.artwork,
    );
    this.terrain.body.material = this.groundMaterial;
    this.scene.add(this.terrain.mesh);
    this.world.addBody(this.terrain.body);
    this.disposables.push(this.terrain);

    // Fog density sets how far you can see; the far plane follows it so the
    // camera never reveals a hard edge to the world.
    const density = definition.environment.fogDensity;
    this.viewDistance = Math.min(1200, Math.max(220, 3.2 / density));

    this.buildAtmosphere();
    this.buildRoadSurface();
    this.buildWalls(this.collectWalls());
    this.buildProps();
    this.buildScatter();
    this.buildScenery();
    this.buildColliders();
    this.buildCheckpoints();
    this.buildStartLine();
    this.buildSpawns();
  }

  private buildAtmosphere(): void {
    const env = this.definition.environment;

    this.scene.fog = new THREE.FogExp2(new THREE.Color(env.fogColor), env.fogDensity);
    this.scene.background = new THREE.Color(env.fogColor);

    const sun = new THREE.DirectionalLight(new THREE.Color(env.sunColor), 1.15);
    sun.position.set(...env.sunDirection).normalize().multiplyScalar(200);
    this.scene.add(sun);

    const ambient = new THREE.AmbientLight(new THREE.Color(env.ambientColor), 1.0);
    this.scene.add(ambient);

    // Weak upward fill so the underside of trucks and overhangs don't go
    // fully black — cheaper and more period-appropriate than a shadow pass.
    const fill = new THREE.HemisphereLight(
      new THREE.Color(env.skyZenith),
      new THREE.Color(env.fogColor),
      0.35,
    );
    this.scene.add(fill);

    // Sky dome. Rendered on the inside of a sphere, unlit, and unaffected by
    // fog so the horizon colour stays put.
    //
    // Depth testing is off and it draws first, so it always sits behind the
    // world regardless of its radius. Sizing it past the far plane instead
    // gets it sliced by the frustum, which shows up as a hard curved seam
    // across the sky.
    const skyGeometry = new THREE.SphereGeometry(this.viewDistance * 0.85, 24, 14);
    const skyMaterial = new THREE.MeshBasicMaterial({
      map: skyTexture(env.skyZenith, env.skyHorizon),
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
      depthTest: false,
    });
    const sky = new THREE.Mesh(skyGeometry, skyMaterial);
    sky.name = 'sky';
    sky.renderOrder = -1;
    this.scene.add(sky);
    this.disposables.push({
      dispose: () => {
        skyGeometry.dispose();
        skyMaterial.dispose();
      },
    });
  }

  /** Loft the visible road ribbon along the spline, just above the terrain. */
  private buildRoadSurface(): void {
    const path = this.road;
    const count = path.points.length;
    const closed = path.closed;
    const segmentCount = closed ? count : count - 1;

    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const up = new THREE.Vector3(0, 1, 0);
    const lift = 0.08; // clear of the terrain to avoid z-fighting

    for (let i = 0; i < count; i++) {
      const point = path.points[i];
      const tangent = path.tangents[i];
      const right = new THREE.Vector3().crossVectors(tangent, up).normalize();
      const halfWidth = path.widths[i] * 0.5;
      const bank = path.banks[i] * (Math.PI / 180);
      const rise = Math.tan(bank) * halfWidth;

      const left = point.clone().addScaledVector(right, -halfWidth);
      left.y += -rise + lift;
      const rightEdge = point.clone().addScaledVector(right, halfWidth);
      rightEdge.y += rise + lift;

      positions.push(left.x, left.y, left.z, rightEdge.x, rightEdge.y, rightEdge.z);

      // Repeat the texture every 8 metres of road so the ruts stay in scale.
      const v = (i * path.step) / 8;
      uvs.push(0, v, 1, v);
    }

    for (let i = 0; i < segmentCount; i++) {
      const a = i * 2;
      const b = a + 1;
      const next = closed ? (i + 1) % count : i + 1;
      const c = next * 2;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    // Road artwork repeats along the ribbon's length; the UVs above are laid
    // out in metres, so the repeat is expressed the same way.
    const artwork = this.definition.environment.artwork;
    const roadMap = artwork?.road
      ? imageTexture(artwork.road, {
          repeatX: 1,
          repeatY: 8 / (artwork.roadRepeatMetres ?? 8),
          pixelated: artwork.pixelated,
        })
      : roadTexture(this.definition.environment.surface);

    const material = new THREE.MeshLambertMaterial({
      map: roadMap,
      // Pull the ribbon towards the camera in depth so it wins against the
      // terrain it sits on without needing a bigger physical offset.
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'road';
    this.scene.add(mesh);
    this.disposables.push({
      dispose: () => {
        geometry.dispose();
        material.dispose();
      },
    });
  }

  /** Authored walls plus any generated from the barrier rule. */
  private collectWalls(): TrackWall[] {
    const walls = [...this.definition.walls];
    const barriers = this.definition.barriers;
    if (!barriers) return walls;

    const sides = barriers.sides ?? 'both';
    const offsets: number[] = [];
    if (sides === 'both' || sides === 'left') offsets.push(-1);
    if (sides === 'both' || sides === 'right') offsets.push(1);

    const stride = Math.max(1, Math.round(barriers.spacing / this.road.step));
    const up = new THREE.Vector3(0, 1, 0);
    const count = this.road.points.length;
    // An open road would otherwise get a barrier straddling its two ends.
    const limit = this.road.closed ? count : count - stride;

    for (let i = 0; i < limit; i += stride) {
      const point = this.road.pointAt(i);
      const tangent = this.road.tangentAt(i);
      const right = new THREE.Vector3().crossVectors(tangent, up).normalize();
      const lateral = this.road.widthAt(i) * 0.5 + barriers.offset + barriers.thickness * 0.5;

      for (const side of offsets) {
        const position = point.clone().addScaledVector(right, side * lateral);
        walls.push({
          // Sink the barrier slightly so it never floats over uneven ground.
          pos: [position.x, position.y + barriers.height * 0.5 - 0.25, position.z],
          // Overlap segments a little so corners don't open up gaps.
          size: [barriers.thickness, barriers.height, barriers.spacing * 1.12],
          rotation: this.road.headingAt(i) * (180 / Math.PI),
          // Follow the gradient. A positive tangent.y means the road climbs,
          // and the barrier's +Z end has to rise with it — which is a
          // negative rotation about its own X axis.
          pitch: -Math.asin(clampUnit(tangent.y)) * (180 / Math.PI),
          material: barriers.material,
          invisible: barriers.invisible,
        });
      }
    }
    return walls;
  }

  private buildWalls(walls: TrackWall[]): void {
    const byMaterial = new Map<string, THREE.Mesh[]>();

    for (const wall of walls) {
      const yaw = (wall.rotation ?? 0) * (Math.PI / 180);
      const pitch = (wall.pitch ?? 0) * (Math.PI / 180);
      const half = new CANNON.Vec3(wall.size[0] / 2, wall.size[1] / 2, wall.size[2] / 2);

      const body = new CANNON.Body({
        mass: 0,
        shape: new CANNON.Box(half),
        material: this.groundMaterial,
      });
      body.position.set(wall.pos[0], wall.pos[1], wall.pos[2]);
      // YXZ: yaw first, then pitch about the wall's own long axis.
      body.quaternion.setFromEuler(pitch, yaw, 0, 'YXZ');
      this.world.addBody(body);

      if (wall.invisible) continue;

      const key = wall.material ?? 'concrete';
      const geometry = new THREE.BoxGeometry(wall.size[0], wall.size[1], wall.size[2]);

      // Scale UVs with the box so the texture keeps a constant world size
      // instead of stretching across long barrier runs.
      const uv = geometry.attributes.uv as THREE.BufferAttribute;
      const scaleU = [wall.size[2], wall.size[2], wall.size[0], wall.size[0], wall.size[0], wall.size[0]];
      const scaleV = [wall.size[1], wall.size[1], wall.size[2], wall.size[2], wall.size[1], wall.size[1]];
      for (let face = 0; face < 6; face++) {
        for (let v = 0; v < 4; v++) {
          const i = face * 4 + v;
          uv.setXY(i, uv.getX(i) * (scaleU[face] / 4), uv.getY(i) * (scaleV[face] / 4));
        }
      }
      uv.needsUpdate = true;

      const mesh = new THREE.Mesh(geometry, undefined as unknown as THREE.Material);
      mesh.position.set(wall.pos[0], wall.pos[1], wall.pos[2]);
      mesh.rotation.order = 'YXZ';
      mesh.rotation.set(pitch, yaw, 0);

      const list = byMaterial.get(key);
      if (list) list.push(mesh);
      else byMaterial.set(key, [mesh]);
    }

    // One material per wall type, shared across every wall using it.
    for (const [key, meshes] of byMaterial) {
      const material = new THREE.MeshLambertMaterial({ map: wallTexture(key) });
      for (const mesh of meshes) {
        mesh.material = material;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        this.scene.add(mesh);
        this.disposables.push({ dispose: () => mesh.geometry.dispose() });
      }
      this.disposables.push(material);
    }
  }

  private buildProps(): void {
    const rng = new Rng(this.definition.terrain.seed ^ 0x9e3779b9);

    for (const prop of this.definition.props) {
      // A prop authored at y=0 means "sit it on the ground"; anything else is
      // an explicit height the author chose.
      const definition = { ...prop };
      if (definition.pos[1] === 0) {
        definition.pos = [prop.pos[0], this.terrain.heightAt(prop.pos[0], prop.pos[2]), prop.pos[2]];
      }

      const built = buildProp(definition, rng.int(0, 2 ** 30));
      this.scene.add(built.object);

      if (built.collisionHalfExtents) {
        const half = built.collisionHalfExtents;
        const body = new CANNON.Body({
          mass: 0,
          shape: new CANNON.Box(new CANNON.Vec3(half.x, half.y, half.z)),
          material: this.groundMaterial,
        });
        body.position.set(
          definition.pos[0],
          definition.pos[1] + half.y,
          definition.pos[2],
        );
        body.quaternion.setFromAxisAngle(
          new CANNON.Vec3(0, 1, 0),
          (definition.rotation ?? 0) * (Math.PI / 180),
        );
        this.world.addBody(body);
      }
    }
  }

  /**
   * Rejection-sample scenery into the space beside the road. Candidates are
   * rejected for being on the racing line, too far away to ever be seen, on
   * ground too steep to sit flat, or outside the terrain patch.
   */
  private buildScatter(): void {
    const rules = this.definition.scatter;
    if (!rules?.length) return;

    const rng = new Rng(this.definition.terrain.seed ^ 0x5bf03635);
    const halfSize = this.definition.terrain.size / 2 - 6;

    for (const rule of rules) {
      let placed = 0;
      // Cap the attempts so an impossible rule can't hang the load.
      const maxAttempts = rule.count * 30;

      for (let attempt = 0; attempt < maxAttempts && placed < rule.count; attempt++) {
        const x = rng.range(-halfSize, halfSize);
        const z = rng.range(-halfSize, halfSize);

        const lateral = Math.abs(this.road.closestTo(x, z).lateral);
        if (lateral < rule.minRoadDistance || lateral > rule.maxRoadDistance) continue;
        if (this.terrain.slopeAt(x, z) > rule.maxSlope * (Math.PI / 180)) continue;

        const built = buildProp(
          {
            kind: rule.kind,
            pos: [x, this.terrain.heightAt(x, z), z],
            rotation: rng.range(0, 360),
            scale: rng.range(rule.scale[0], rule.scale[1]),
            solid: rule.solid,
          },
          rng.int(0, 2 ** 30),
        );
        this.scene.add(built.object);

        if (built.collisionHalfExtents) {
          const half = built.collisionHalfExtents;
          const body = new CANNON.Body({
            mass: 0,
            shape: new CANNON.Box(new CANNON.Vec3(half.x, half.y, half.z)),
            material: this.groundMaterial,
          });
          body.position.set(x, this.terrain.heightAt(x, z) + half.y, z);
          this.world.addBody(body);
        }
        placed++;
      }
    }
  }

  /** Drop the hand-modelled scenery mesh in, if the track ships one. */
  private buildScenery(): void {
    const url = this.definition.sceneryModel;
    if (!url) return;

    const model = this.models.get(url);
    if (!model) {
      // Not fatal: the track still plays, it just looks bare. The loader has
      // already logged why the file didn't arrive.
      console.warn(`[track] scenery model "${url}" was not loaded; skipping`);
      return;
    }

    model.name = 'scenery';
    this.scene.add(model);
    this.disposables.push({ dispose: () => disposeModel(model) });
  }

  /**
   * Hand-authored collision volumes.
   *
   * Kept separate from the scenery mesh so collision can be simpler than
   * what you see — a detailed building can be fenced by two boxes, which is
   * both faster and far more predictable to drive against.
   */
  private buildColliders(): void {
    const colliders = this.definition.colliders;
    if (!colliders?.length) return;

    for (const collider of colliders) {
      const shape = this.buildColliderShape(collider);
      if (!shape) continue;

      const body = new CANNON.Body({ mass: 0, shape, material: this.groundMaterial });
      body.position.set(collider.pos[0], collider.pos[1], collider.pos[2]);
      body.quaternion.setFromEuler(
        (collider.pitch ?? 0) * (Math.PI / 180),
        (collider.rotation ?? 0) * (Math.PI / 180),
        0,
        'YXZ',
      );
      this.world.addBody(body);
    }
  }

  private buildColliderShape(collider: TrackCollider): CANNON.Shape | null {
    const shape = collider.shape;

    if (shape.kind === 'box') {
      return new CANNON.Box(
        new CANNON.Vec3(shape.size[0] / 2, shape.size[1] / 2, shape.size[2] / 2),
      );
    }

    // Convex hull. cannon wants vertices as Vec3 and faces as index loops.
    const vertexCount = Math.floor(shape.vertices.length / 3);
    if (vertexCount < 4 || shape.faces.length < 4) {
      console.warn(
        `[track] collider "${collider.name ?? 'unnamed'}" has too few vertices or faces; skipping`,
      );
      return null;
    }

    const vertices: CANNON.Vec3[] = [];
    for (let i = 0; i < vertexCount; i++) {
      vertices.push(
        new CANNON.Vec3(shape.vertices[i * 3], shape.vertices[i * 3 + 1], shape.vertices[i * 3 + 2]),
      );
    }

    try {
      return new CANNON.ConvexPolyhedron({ vertices, faces: shape.faces });
    } catch (error) {
      // cannon throws on degenerate hulls rather than returning an error, and
      // one bad collider must not take the whole track down.
      console.warn(`[track] collider "${collider.name ?? 'unnamed'}" is not a valid hull:`, error);
      return null;
    }
  }

  private buildCheckpoints(): void {
    const authored = this.definition.checkpoints;
    const gates: TrackCheckpoint[] = authored?.length
      ? authored
      : this.generateCheckpoints();

    for (let i = 0; i < gates.length; i++) {
      const gate = gates[i];
      const yaw = gate.rotation * (Math.PI / 180);
      const position = new THREE.Vector3(gate.pos[0], gate.pos[1], gate.pos[2]);
      this.checkpoints.push({
        index: i,
        position,
        forward: new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)),
        halfWidth: gate.width * 0.5,
        roadDistance: this.road.closestTo(position.x, position.z).distance,
      });
    }
  }

  /** Evenly spaced gates around the road, dense enough to catch shortcuts. */
  private generateCheckpoints(): TrackCheckpoint[] {
    const spacing = 70;
    const count = Math.max(6, Math.round(this.road.length / spacing));
    const stride = Math.floor(this.road.points.length / count);
    const gates: TrackCheckpoint[] = [];

    for (let i = 0; i < count; i++) {
      const index = i * stride;
      const point = this.road.pointAt(index);
      gates.push({
        pos: [point.x, point.y, point.z],
        rotation: this.road.headingAt(index) * (180 / Math.PI),
        // Generous gates: they exist to prove you went round, not to punish
        // a wide line.
        width: this.road.widthAt(index) * 2.2,
      });
    }
    return gates;
  }

  /** Chequered strip laid across the road at the start/finish gate. */
  private buildStartLine(): void {
    const start = this.checkpoints[0];
    if (!start) return;

    const width = start.halfWidth * 2;
    const geometry = new THREE.PlaneGeometry(width, 3);
    geometry.rotateX(-Math.PI / 2);

    const texture = checkerTexture().clone();
    texture.repeat.set(Math.max(2, Math.round(width / 3)), 1);
    texture.needsUpdate = true;

    const material = new THREE.MeshLambertMaterial({
      map: texture,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(start.position);
    mesh.position.y += 0.12;
    mesh.rotation.y = Math.atan2(start.forward.x, start.forward.z);
    this.scene.add(mesh);
    this.disposables.push({
      dispose: () => {
        geometry.dispose();
        material.dispose();
        texture.dispose();
      },
    });
  }

  /** Staggered two-column grid, laid out behind the start line. */
  private buildSpawns(): void {
    const authored = this.definition.spawns;
    if (authored?.length) {
      for (const spawn of authored) {
        this.spawns.push({
          position: new THREE.Vector3(...spawn.pos),
          heading: spawn.rotation * (Math.PI / 180),
        });
      }
      return;
    }

    const startIndex = this.road.closestTo(
      this.checkpoints[0].position.x,
      this.checkpoints[0].position.z,
    ).index;

    const rowSpacing = 9;
    const columnSpacing = 4.5;
    const up = new THREE.Vector3(0, 1, 0);

    for (let slot = 0; slot < 12; slot++) {
      const row = Math.floor(slot / 2);
      const column = slot % 2 === 0 ? -1 : 1;

      // Walk backwards along the spline so the grid follows the road's shape.
      const back = Math.round((rowSpacing * (row + 1)) / this.road.step);
      const index = this.road.wrap(startIndex - back);
      const point = this.road.pointAt(index);
      const tangent = this.road.tangentAt(index);
      const right = new THREE.Vector3().crossVectors(tangent, up).normalize();

      const position = point
        .clone()
        .addScaledVector(right, column * columnSpacing)
        .setY(point.y + SPAWN_LIFT);

      this.spawns.push({ position, heading: Math.atan2(tangent.x, tangent.z) });
    }
  }

  /**
   * Where a stuck truck should be put back. Snaps to the road, faces the
   * racing direction, and lifts clear of the surface.
   */
  respawnNear(x: number, z: number): SpawnPoint {
    const query = this.road.closestTo(x, z);
    return {
      position: new THREE.Vector3(query.point.x, query.point.y + RESPAWN_LIFT, query.point.z),
      heading: Math.atan2(query.tangent.x, query.tangent.z),
    };
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
    this.disposables = [];
    this.scene.clear();
  }
}
