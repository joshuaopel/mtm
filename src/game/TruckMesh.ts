import * as THREE from 'three';
import { treadTexture } from '../core/Textures';
import type { MTMVehicle, VehicleLook } from './formats';

/**
 * Procedural monster truck bodies.
 *
 * Trucks are assembled from boxes and low-segment cylinders with flat
 * shading — no imported models, so a new vehicle is a few lines of JSON
 * rather than an art task. The silhouette does the heavy lifting: at the
 * resolution and fog density we render at, you recognise a truck by its
 * outline long before you can read any detail on it.
 *
 * Convention: the model faces +Z. This matches the physics forward axis and
 * the road heading, so a single Y rotation aims everything consistently.
 */

const BODY_LENGTH = 5.2;
const BODY_WIDTH = 2.35;

function mat(color: string, options: Partial<THREE.MeshLambertMaterialParameters> = {}) {
  return new THREE.MeshLambertMaterial({ color, flatShading: true, ...options });
}

function box(
  width: number,
  height: number,
  depth: number,
  material: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  return mesh;
}

/** Trapezoidal slab: a box with its top face inset, for cabs and hoods. */
function taperedBox(
  bottomWidth: number,
  topWidth: number,
  height: number,
  bottomDepth: number,
  topDepth: number,
  material: THREE.Material,
): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(bottomWidth, height, bottomDepth);
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const scaleX = topWidth / bottomWidth;
  const scaleZ = topDepth / bottomDepth;

  for (let i = 0; i < position.count; i++) {
    if (position.getY(i) > 0) {
      position.setX(i, position.getX(i) * scaleX);
      position.setZ(i, position.getZ(i) * scaleZ);
    }
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

interface Palette {
  body: THREE.Material;
  accent: THREE.Material;
  trim: THREE.Material;
  glass: THREE.Material;
  rim: THREE.Material;
  dark: THREE.Material;
  chrome: THREE.Material;
  lamp: THREE.Material;
}

function palette(look: VehicleLook): Palette {
  return {
    body: mat(look.bodyColor),
    accent: mat(look.accentColor),
    trim: mat(look.trimColor),
    glass: mat(look.glassColor, { transparent: true, opacity: 0.72 }),
    rim: mat(look.rimColor),
    dark: mat('#1a1a18'),
    chrome: mat('#b8bcc4'),
    lamp: new THREE.MeshBasicMaterial({ color: '#fff4c0' }),
  };
}

/* -------------------------------------------------------------------------
 * Body styles
 * ---------------------------------------------------------------------- */

function buildPickup(p: Palette): THREE.Group {
  const group = new THREE.Group();

  group.add(box(BODY_WIDTH, 0.85, BODY_LENGTH, p.body, 0, 0.1, 0));

  const hood = box(BODY_WIDTH * 0.96, 0.55, 1.9, p.body, 0, 0.6, 1.5);
  group.add(hood);

  const cab = taperedBox(BODY_WIDTH * 0.94, BODY_WIDTH * 0.78, 1.05, 1.8, 1.45, p.body);
  cab.position.set(0, 1.05, 0.05);
  group.add(cab);

  // Windows sit slightly proud of the cab so they don't z-fight.
  group.add(box(BODY_WIDTH * 0.72, 0.6, 0.06, p.glass, 0, 1.25, 0.93));
  group.add(box(0.06, 0.55, 1.35, p.glass, BODY_WIDTH * 0.4, 1.22, 0.05));
  group.add(box(0.06, 0.55, 1.35, p.glass, -BODY_WIDTH * 0.4, 1.22, 0.05));

  // Bed walls.
  group.add(box(BODY_WIDTH, 0.5, 0.16, p.body, 0, 0.75, -2.5));
  group.add(box(0.16, 0.5, 1.9, p.body, BODY_WIDTH / 2 - 0.08, 0.75, -1.6));
  group.add(box(0.16, 0.5, 1.9, p.body, -BODY_WIDTH / 2 + 0.08, 0.75, -1.6));

  group.add(box(BODY_WIDTH * 1.02, 0.32, 0.35, p.trim, 0, 0.42, 2.4));
  return group;
}

function buildCrewCab(p: Palette): THREE.Group {
  const group = new THREE.Group();

  group.add(box(BODY_WIDTH, 0.9, BODY_LENGTH, p.body, 0, 0.1, 0));
  group.add(box(BODY_WIDTH * 0.96, 0.5, 1.5, p.body, 0, 0.62, 1.75));

  const cab = taperedBox(BODY_WIDTH * 0.95, BODY_WIDTH * 0.84, 1.15, 2.9, 2.6, p.body);
  cab.position.set(0, 1.1, 0.2);
  group.add(cab);

  group.add(box(BODY_WIDTH * 0.74, 0.62, 0.06, p.glass, 0, 1.32, 1.62));
  for (const z of [0.85, -0.15]) {
    group.add(box(0.06, 0.55, 0.9, p.glass, BODY_WIDTH * 0.43, 1.3, z));
    group.add(box(0.06, 0.55, 0.9, p.glass, -BODY_WIDTH * 0.43, 1.3, z));
  }

  group.add(box(BODY_WIDTH, 0.45, 0.16, p.body, 0, 0.75, -2.5));
  group.add(box(0.16, 0.45, 1.2, p.body, BODY_WIDTH / 2 - 0.08, 0.75, -1.95));
  group.add(box(0.16, 0.45, 1.2, p.body, -BODY_WIDTH / 2 + 0.08, 0.75, -1.95));

  group.add(box(BODY_WIDTH * 1.04, 0.4, 0.4, p.trim, 0, 0.45, 2.45));
  return group;
}

function buildFlatnose(p: Palette): THREE.Group {
  const group = new THREE.Group();

  group.add(box(BODY_WIDTH, 0.8, BODY_LENGTH, p.body, 0, 0.1, 0));

  // Cab-over: the cabin sits right at the nose, no hood at all.
  const cab = taperedBox(BODY_WIDTH * 0.98, BODY_WIDTH * 0.92, 1.7, 2.0, 1.9, p.body);
  cab.position.set(0, 1.35, 1.4);
  group.add(cab);

  group.add(box(BODY_WIDTH * 0.82, 0.95, 0.06, p.glass, 0, 1.65, 2.42));
  group.add(box(0.06, 0.7, 1.5, p.glass, BODY_WIDTH * 0.46, 1.6, 1.4));
  group.add(box(0.06, 0.7, 1.5, p.glass, -BODY_WIDTH * 0.46, 1.6, 1.4));

  group.add(box(BODY_WIDTH * 1.02, 0.45, 0.3, p.accent, 0, 0.62, 2.45));

  // Flat deck behind the cab.
  group.add(box(BODY_WIDTH * 0.98, 0.22, 2.6, p.trim, 0, 0.62, -1.2));
  group.add(box(BODY_WIDTH, 0.7, 0.16, p.body, 0, 0.95, -2.45));
  return group;
}

function buildMuscle(p: Palette): THREE.Group {
  const group = new THREE.Group();

  group.add(box(BODY_WIDTH, 0.75, BODY_LENGTH, p.body, 0, 0.05, 0));

  const hood = taperedBox(BODY_WIDTH * 0.98, BODY_WIDTH * 0.86, 0.5, 2.4, 2.1, p.body);
  hood.position.set(0, 0.62, 1.35);
  group.add(hood);

  // Blower poking through the bonnet — the signature muscle-truck detail.
  group.add(box(0.75, 0.42, 0.9, p.chrome, 0, 1.0, 1.35));
  group.add(box(0.55, 0.22, 0.55, p.dark, 0, 1.28, 1.35));

  const cab = taperedBox(BODY_WIDTH * 0.9, BODY_WIDTH * 0.6, 0.95, 1.9, 1.2, p.body);
  cab.position.set(0, 1.0, -0.35);
  group.add(cab);

  group.add(box(BODY_WIDTH * 0.62, 0.55, 0.06, p.glass, 0, 1.18, 0.55));
  group.add(box(BODY_WIDTH * 0.98, 0.28, 0.5, p.accent, 0, 0.5, -2.35));
  group.add(box(BODY_WIDTH * 0.75, 0.12, 0.5, p.trim, 0, 1.15, -2.3));
  return group;
}

function buildBuggy(p: Palette): THREE.Group {
  const group = new THREE.Group();

  group.add(box(BODY_WIDTH * 0.8, 0.5, BODY_LENGTH * 0.86, p.body, 0, 0.1, 0));

  // Exposed tube frame instead of panels.
  const tube = new THREE.CylinderGeometry(0.08, 0.08, 1, 5);
  const addTube = (
    length: number,
    x: number,
    y: number,
    z: number,
    rx = 0,
    rz = 0,
  ): void => {
    const mesh = new THREE.Mesh(tube, p.accent);
    mesh.scale.y = length;
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, 0, rz);
    group.add(mesh);
  };

  for (const x of [-0.85, 0.85]) {
    addTube(1.5, x, 0.9, 0.6);
    addTube(1.3, x, 0.85, -1.5);
    addTube(2.2, x, 1.6, -0.45, Math.PI / 2);
  }
  addTube(1.7, 0, 1.62, 0.6, 0, Math.PI / 2);
  addTube(1.7, 0, 1.5, -1.5, 0, Math.PI / 2);

  const seat = box(0.6, 0.6, 0.6, p.trim, 0, 0.65, -0.3);
  group.add(seat);

  group.add(box(BODY_WIDTH * 0.86, 0.35, 0.9, p.trim, 0, 0.5, 2.0));
  group.add(box(0.9, 0.5, 0.9, p.dark, 0, 0.75, -1.9));
  return group;
}

function buildHauler(p: Palette): THREE.Group {
  const group = new THREE.Group();

  group.add(box(BODY_WIDTH * 1.05, 1.0, BODY_LENGTH * 1.05, p.body, 0, 0.15, 0));

  const cab = taperedBox(BODY_WIDTH, BODY_WIDTH * 0.92, 1.9, 2.2, 2.0, p.body);
  cab.position.set(0, 1.5, 1.15);
  group.add(cab);

  group.add(box(BODY_WIDTH * 0.84, 0.9, 0.06, p.glass, 0, 1.9, 2.22));
  group.add(box(0.06, 0.75, 1.6, p.glass, BODY_WIDTH * 0.48, 1.85, 1.1));
  group.add(box(0.06, 0.75, 1.6, p.glass, -BODY_WIDTH * 0.48, 1.85, 1.1));

  // Boxed-in cargo body.
  group.add(box(BODY_WIDTH * 1.02, 1.5, 2.4, p.accent, 0, 1.4, -1.4));
  group.add(box(BODY_WIDTH * 1.04, 0.2, 2.42, p.trim, 0, 2.2, -1.4));
  group.add(box(BODY_WIDTH * 1.08, 0.4, 0.4, p.trim, 0, 0.6, 2.6));
  return group;
}

const STYLE_BUILDERS: Record<VehicleLook['style'], (p: Palette) => THREE.Group> = {
  pickup: buildPickup,
  crewcab: buildCrewCab,
  flatnose: buildFlatnose,
  muscle: buildMuscle,
  buggy: buildBuggy,
  hauler: buildHauler,
};

/* -------------------------------------------------------------------------
 * Liveries and bolt-ons
 * ---------------------------------------------------------------------- */

function applyLivery(group: THREE.Group, look: VehicleLook, p: Palette): void {
  const halfWidth = BODY_WIDTH / 2;

  switch (look.livery) {
    case 'stripe':
      for (const x of [-0.45, 0.45]) {
        group.add(box(0.28, 0.06, BODY_LENGTH * 0.98, p.accent, x, 0.54, 0));
      }
      break;

    case 'flames': {
      // Tongues of flame licking back from the front wheel arches.
      for (const side of [-1, 1]) {
        for (let i = 0; i < 4; i++) {
          const length = 1.5 - i * 0.28;
          const flame = box(0.06, 0.3 - i * 0.04, length, p.accent);
          flame.position.set(side * (halfWidth + 0.02), 0.34 + i * 0.16, 1.0 - i * 0.35);
          group.add(flame);
        }
      }
      break;
    }

    case 'splatter': {
      // Deterministic mud spatter: fixed offsets, so every copy matches.
      const spots: [number, number, number][] = [
        [0.55, 0.2, 1.4], [0.8, 0.45, 0.2], [0.3, 0.6, -1.1],
        [0.9, 0.15, -2.0], [0.45, 0.35, -0.6], [0.7, 0.55, 1.9],
      ];
      for (const side of [-1, 1]) {
        for (const [sx, y, z] of spots) {
          const spot = box(0.06, 0.22, 0.3, p.accent);
          spot.position.set(side * (halfWidth + 0.02), y, z * sx * 1.1);
          group.add(spot);
        }
      }
      break;
    }

    case 'checker':
      for (const side of [-1, 1]) {
        for (let i = 0; i < 8; i++) {
          if (i % 2 === 0) continue;
          const square = box(0.06, 0.26, 0.5, p.accent);
          square.position.set(side * (halfWidth + 0.02), 0.42, -2.2 + i * 0.58);
          group.add(square);
        }
      }
      break;

    case 'bolt':
      for (const side of [-1, 1]) {
        for (let i = 0; i < 5; i++) {
          const segment = box(0.06, 0.24, 0.7, p.accent);
          segment.position.set(side * (halfWidth + 0.02), 0.5, 1.6 - i * 0.75);
          segment.rotation.x = i % 2 === 0 ? 0.5 : -0.5;
          group.add(segment);
        }
      }
      break;

    case 'solid':
    default:
      break;
  }
}

function addRollCage(group: THREE.Group, p: Palette): void {
  const tube = new THREE.CylinderGeometry(0.07, 0.07, 1, 5);
  const bar = (length: number, x: number, y: number, z: number, rx = 0, rz = 0): void => {
    const mesh = new THREE.Mesh(tube, p.chrome);
    mesh.scale.y = length;
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, 0, rz);
    group.add(mesh);
  };

  for (const x of [-0.95, 0.95]) {
    bar(1.5, x, 1.6, -1.6);
    bar(1.3, x, 1.5, 0.3);
  }
  bar(1.9, 0, 2.34, -1.6, 0, Math.PI / 2);
  bar(1.9, 0, 2.14, 0.3, 0, Math.PI / 2);
  bar(1.95, 0.95, 2.25, -0.65, Math.PI / 2 + 0.1);
  bar(1.95, -0.95, 2.25, -0.65, Math.PI / 2 + 0.1);
}

function addStacks(group: THREE.Group, p: Palette): void {
  const pipe = new THREE.CylinderGeometry(0.11, 0.13, 1.7, 6);
  for (const x of [-0.78, 0.78]) {
    const stack = new THREE.Mesh(pipe, p.chrome);
    stack.position.set(x, 1.9, -0.2);
    stack.rotation.x = -0.09;
    group.add(stack);

    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.16, 6), p.dark);
    tip.position.set(x, 2.74, -0.28);
    group.add(tip);
  }
}

function addLightBar(group: THREE.Group, p: Palette): void {
  group.add(box(1.7, 0.16, 0.22, p.dark, 0, 2.42, 0.1));
  for (let i = 0; i < 4; i++) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.14), p.lamp);
    lamp.position.set(-0.63 + i * 0.42, 2.42, 0.22);
    group.add(lamp);
  }
}

function addHeadlights(group: THREE.Group, p: Palette): void {
  for (const x of [-0.72, 0.72]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.12), p.lamp);
    lamp.position.set(x, 0.6, 2.55);
    group.add(lamp);
  }
  for (const x of [-0.78, 0.78]) {
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.2, 0.1), mat('#c01818'));
    tail.position.set(x, 0.62, -2.6);
    group.add(tail);
  }
}

/* -------------------------------------------------------------------------
 * Wheels
 * ---------------------------------------------------------------------- */

/**
 * One oversized knobbly wheel. The cylinder axis is baked onto X so the
 * mesh quaternion can be copied straight from the physics wheel transform.
 */
export function buildWheel(radius: number, width: number, rimColor: string): THREE.Group {
  const group = new THREE.Group();

  const tyreGeometry = new THREE.CylinderGeometry(radius, radius, width, 10, 1);
  tyreGeometry.rotateZ(Math.PI / 2);
  const tyre = new THREE.Mesh(
    tyreGeometry,
    new THREE.MeshLambertMaterial({ map: treadTexture(), color: '#4a4a48', flatShading: true }),
  );
  group.add(tyre);

  const rimGeometry = new THREE.CylinderGeometry(radius * 0.5, radius * 0.5, width * 1.02, 8, 1);
  rimGeometry.rotateZ(Math.PI / 2);
  const rim = new THREE.Mesh(rimGeometry, mat(rimColor));
  group.add(rim);

  // Tread blocks around the circumference, for a chunky silhouette.
  const lugGeometry = new THREE.BoxGeometry(width * 1.06, radius * 0.16, radius * 0.34);
  const lugMaterial = mat('#2a2a28');
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2;
    const lug = new THREE.Mesh(lugGeometry, lugMaterial);
    lug.position.set(0, Math.cos(angle) * radius * 0.97, Math.sin(angle) * radius * 0.97);
    lug.rotation.x = -angle;
    group.add(lug);
  }

  // Hub cap so the wheel doesn't look hollow from the side.
  for (const side of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.22, radius * 0.18, 0.08, 6), mat('#8a8a84'));
    cap.rotateZ(Math.PI / 2);
    cap.position.x = side * width * 0.52;
    group.add(cap);
  }

  return group;
}

/** A cylinder stretched between two points, for shocks and links. */
function strut(
  from: THREE.Vector3,
  to: THREE.Vector3,
  radius: number,
  material: THREE.Material,
): THREE.Mesh {
  const direction = new THREE.Vector3().subVectors(to, from);
  const length = direction.length();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 6), material);
  mesh.position.copy(from).addScaledVector(direction, 0.5);
  // CylinderGeometry runs along +Y; aim it along the strut.
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.normalize(),
  );
  return mesh;
}

/**
 * The bit that makes it a monster truck: solid beam axles slung well below a
 * lifted body, with visible coil-overs and radius rods bridging the gap.
 *
 * Geometry is placed at the suspension's resting height so it lines up with
 * where the wheels actually sit. The parts don't articulate — at this
 * resolution and speed the silhouette is doing all the work.
 */
function addRunningGear(body: THREE.Group, vehicle: MTMVehicle, p: Palette): void {
  const physics = vehicle.physics;

  // Where the wheel centres settle under the truck's own weight. Mirrors
  // cannon's spring equation: force = stiffness x compression x mass, with
  // four wheels carrying 2g.
  const restCompression = Math.min(
    physics.maxSuspensionTravel,
    19.6 / (4 * physics.suspensionStiffness),
  );
  const axleY = physics.axleHeight - (physics.suspensionRest - restCompression);

  // Chassis rails tucked under the body.
  const railY = -0.42;
  for (const x of [-0.85, 0.85]) {
    body.add(box(0.2, 0.24, BODY_LENGTH * 0.94, p.dark, x, railY, 0));
  }

  const axles: [number, number][] = [
    [physics.frontAxle[0], physics.frontAxle[1]],
    [physics.rearAxle[0], physics.rearAxle[1]],
  ];

  for (const [halfTrack, z] of axles) {
    // Beam axle spanning the full track width.
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.11, halfTrack * 2, 6),
      p.dark,
    );
    beam.rotation.z = Math.PI / 2;
    beam.position.set(0, axleY, z);
    body.add(beam);

    // Differential housing.
    const pumpkin = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), p.trim);
    pumpkin.position.set(0, axleY, z);
    body.add(pumpkin);

    for (const side of [-1, 1]) {
      // Coil-over from the chassis rail down and out to the axle end.
      const top = new THREE.Vector3(side * 0.85, railY + 0.1, z);
      const bottom = new THREE.Vector3(side * halfTrack * 0.82, axleY, z);
      body.add(strut(top, bottom, 0.07, p.chrome));

      // Spring wrapped around it, drawn as a fatter, shorter sleeve.
      const springTop = top.clone().lerp(bottom, 0.15);
      const springBottom = top.clone().lerp(bottom, 0.85);
      body.add(strut(springTop, springBottom, 0.13, p.accent));

      // Radius rod running fore-and-aft to locate the axle.
      const rodBody = new THREE.Vector3(side * 0.8, railY - 0.05, z * 0.35);
      const rodAxle = new THREE.Vector3(side * halfTrack * 0.6, axleY + 0.05, z);
      body.add(strut(rodBody, rodAxle, 0.05, p.dark));
    }
  }

  // Driveshaft between the axles.
  body.add(
    strut(
      new THREE.Vector3(0, axleY + 0.05, physics.frontAxle[1]),
      new THREE.Vector3(0, axleY + 0.05, physics.rearAxle[1]),
      0.06,
      p.chrome,
    ),
  );
}

export interface TruckMesh {
  /** Chassis visual, positioned by the physics body each frame. */
  body: THREE.Group;
  /** Four wheels, in the same order as the physics wheel infos. */
  wheels: THREE.Group[];
}

/** Build the complete visual rig for a vehicle definition. */
export function buildTruckMesh(vehicle: MTMVehicle): TruckMesh {
  const look = vehicle.look;
  const p = palette(look);

  const body = STYLE_BUILDERS[look.style](p);
  applyLivery(body, look, p);
  addHeadlights(body, p);
  if (look.rollCage) addRollCage(body, p);
  if (look.stacks) addStacks(body, p);
  if (look.lightBar) addLightBar(body, p);

  addRunningGear(body, vehicle, p);

  const scale = look.scale ?? 1;
  body.scale.setScalar(scale);

  const wheels: THREE.Group[] = [];
  for (let i = 0; i < 4; i++) {
    wheels.push(buildWheel(vehicle.physics.wheelRadius, vehicle.physics.wheelWidth, look.rimColor));
  }

  return { body, wheels };
}
