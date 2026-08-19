import * as THREE from 'three';
import { Rng } from '../core/Noise';
import { imageTexture } from '../core/Textures';
import type { PropKind, TrackProp, Vec3 } from './formats';
import { type Hull, hullGeometry, kickerHull, tabletopHull } from './PropShapes';

/**
 * Low-poly scenery.
 *
 * Every prop is built from a handful of primitives with flat shading and no
 * texture — which is roughly the polygon budget a 1996 track had for
 * roadside dressing, and it keeps the silhouette readable through the fog.
 */

const materialCache = new Map<string, THREE.MeshLambertMaterial>();

function material(color: string, flat = true): THREE.MeshLambertMaterial {
  const key = `${color}:${flat}`;
  const existing = materialCache.get(key);
  if (existing) return existing;
  const created = new THREE.MeshLambertMaterial({ color, flatShading: flat });
  materialCache.set(key, created);
  return created;
}

/** Collision extents a solid prop should get, keyed by kind. */
const SOLID_EXTENTS: Record<PropKind, [number, number, number] | null> = {
  tree: [0.8, 6, 0.8],
  palm: [0.7, 7, 0.7],
  deadtree: [0.7, 5, 0.7],
  rock: [2.4, 2.2, 2.4],
  barrel: [1.0, 1.4, 1.0],
  cone: null, // squashable, deliberately not solid
  sign: [0.3, 3, 2.4],
  billboard: [0.4, 4, 6], // the posts, not the hoarding you can drive under
  flag: null, // a flagpole that stops a monster truck would be absurd
  tower: [3.2, 12, 3.2],
  crate: [1.6, 1.6, 1.6],
  arch: null, // the posts are added as walls by the track instead
  ramp: null, // hull, not a box
  tabletop: null,
};

/** Default [width, height, length] per kind, before `size` or `scale`. */
const DEFAULT_SIZE: Partial<Record<PropKind, Vec3>> = {
  // 2.5m over 11m is about 13 degrees — enough to launch a truck at speed
  // without stopping it dead if you creep up to it.
  ramp: [8, 2.5, 11],
  tabletop: [11, 3, 26],
  billboard: [10, 4, 3.5],
  flag: [1.6, 1.1, 6],
};

function sizeOf(prop: TrackProp): Vec3 {
  const fallback = DEFAULT_SIZE[prop.kind] ?? [1, 1, 1];
  const size = prop.size ?? fallback;
  return [size[0], size[1], size[2]];
}

/**
 * Shared wind phase, advanced once per frame.
 *
 * A uniform rather than per-frame CPU work: the flags deform in the vertex
 * shader, so a hundred of them cost one number per frame between them.
 */
const wind = { value: 0 };

export function advanceWind(seconds: number): void {
  wind.value = (wind.value + seconds) % 3600;
}

function buildTree(rng: Rng): THREE.Object3D {
  const group = new THREE.Group();
  const height = rng.range(4.5, 7.5);

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.34, height * 0.42, 5),
    material('#4a3520'),
  );
  trunk.position.y = height * 0.21;
  group.add(trunk);

  const tiers = 3;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const radius = 2.1 * (1 - t * 0.62);
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(radius, height * 0.36, 6),
      material(i % 2 === 0 ? '#2c4a1e' : '#35592a'),
    );
    cone.position.y = height * (0.36 + t * 0.42);
    cone.rotation.y = rng.range(0, Math.PI);
    group.add(cone);
  }
  return group;
}

function buildRock(rng: Rng): THREE.Object3D {
  const geometry = new THREE.IcosahedronGeometry(1.4, 0);
  // Shove the vertices around so no two boulders are identical.
  const position = geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    position.setXYZ(
      i,
      position.getX(i) * rng.range(0.7, 1.35),
      position.getY(i) * rng.range(0.5, 1.1),
      position.getZ(i) * rng.range(0.7, 1.35),
    );
  }
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material(rng.pick(['#6b6459', '#57504a', '#7a7268'])));
  mesh.position.y = 0.5;
  return mesh;
}

function buildBarrel(rng: Rng): THREE.Object3D {
  const group = new THREE.Group();
  const color = rng.pick(['#b8400c', '#c8a010', '#2a6ba8', '#3a7a2a']);
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.4, 8), material(color));
  drum.position.y = 0.7;
  group.add(drum);

  for (const y of [0.4, 1.0]) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.53, 0.53, 0.12, 8), material('#3a3a38'));
    band.position.y = y;
    group.add(band);
  }
  return group;
}

function buildCone(): THREE.Object3D {
  const group = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.08, 0.62), material('#1a1a18'));
  base.position.y = 0.04;
  group.add(base);

  const body = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.78, 5), material('#e8600c'));
  body.position.y = 0.45;
  group.add(body);

  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.22, 0.14, 5), material('#e8e4d0'));
  stripe.position.y = 0.5;
  group.add(stripe);
  return group;
}

function buildSign(rng: Rng): THREE.Object3D {
  const group = new THREE.Group();
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 3, 0.16), material('#6e6e64'));
  post.position.y = 1.5;
  group.add(post);

  const board = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 1.2, 0.1),
    material(rng.pick(['#c8a010', '#b8400c', '#e8e4d0'])),
  );
  board.position.y = 2.5;
  group.add(board);

  const chevron = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.28, 0.14), material('#1a1a18'));
  chevron.position.set(0, 2.5, 0.02);
  chevron.rotation.z = rng.pick([0.5, -0.5]);
  group.add(chevron);
  return group;
}

function buildTower(rng: Rng): THREE.Object3D {
  const group = new THREE.Group();
  let width = 3.2;
  let y = 0;
  const sections = 4;
  for (let i = 0; i < sections; i++) {
    const height = 3;
    const section = new THREE.Mesh(
      new THREE.CylinderGeometry(width * 0.42, width * 0.5, height, 4),
      material(i % 2 === 0 ? '#7a8290' : '#69707c'),
    );
    section.position.y = y + height / 2;
    section.rotation.y = Math.PI / 4;
    group.add(section);
    y += height;
    width *= 0.78;
  }

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.6, 2.6), material('#8a5a2a'));
  cabin.position.y = y + 0.8;
  group.add(cabin);

  const light = new THREE.Mesh(new THREE.SphereGeometry(0.28, 6, 4), material('#e02020', false));
  light.position.y = y + 1.9;
  group.add(light);

  group.rotation.y = rng.range(0, Math.PI);
  return group;
}

function buildCrate(rng: Rng): THREE.Object3D {
  const group = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), material('#7a5a34'));
  box.position.y = 0.8;
  group.add(box);

  const frameColor = material('#5a4226');
  for (const axis of ['x', 'y'] as const) {
    const slat = new THREE.Mesh(
      axis === 'x'
        ? new THREE.BoxGeometry(1.68, 0.18, 1.68)
        : new THREE.BoxGeometry(0.18, 1.68, 1.68),
      frameColor,
    );
    slat.position.y = 0.8;
    group.add(slat);
  }
  group.rotation.y = rng.range(0, Math.PI * 2);
  return group;
}

/**
 * Start/finish gantry.
 *
 * The legs sit at +/-16 m so they clear the widest stock road (26 m) and its
 * barrier line. A gantry leg standing in the run-off at the start line would
 * be the single most infuriating object on the track.
 */
function buildArch(): THREE.Object3D {
  const group = new THREE.Group();
  const legMaterial = material('#8a5a2a');
  const legX = 16;

  for (const x of [-legX, legX]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(1.2, 9, 1.2), legMaterial);
    leg.position.set(x, 4.5, 0);
    group.add(leg);

    const brace = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 1.8), material('#6e6e64'));
    brace.position.set(x, 0.25, 0);
    group.add(brace);
  }

  const beam = new THREE.Mesh(new THREE.BoxGeometry(legX * 2 + 2, 1.6, 1.2), material('#b8400c'));
  beam.position.y = 9.4;
  group.add(beam);

  const bannerWidth = 20;
  const banner = new THREE.Mesh(new THREE.BoxGeometry(bannerWidth, 2.4, 0.2), material('#14140f'));
  banner.position.set(0, 7.8, 0.1);
  group.add(banner);

  // Chequered strip across the banner, drawn as alternating blocks.
  for (let i = 0; i < bannerWidth; i++) {
    const block = new THREE.Mesh(
      new THREE.BoxGeometry(1, 0.55, 0.1),
      material(i % 2 === 0 ? '#e8e4d0' : '#1a1a18'),
    );
    block.position.set(-bannerWidth / 2 + 0.5 + i, 8.7, 0.2);
    group.add(block);
  }
  return group;
}

function rampSurface(rng: Rng): THREE.MeshLambertMaterial {
  return material(rng.pick(['#8a6a3a', '#7d6a52', '#6f5f46']));
}

/**
 * A kicker, built from the same hull the physics uses.
 *
 * Deriving both from one description is the point: a ramp whose visible
 * surface and collision surface disagree is the worst kind of track bug,
 * because it looks fine right up until the truck launches off nothing.
 */
function buildRamp(prop: TrackProp, rng: Rng): { object: THREE.Object3D; hull: Hull } {
  const [width, height, length] = sizeOf(prop);
  const hull = kickerHull(width, height, length);

  const group = new THREE.Group();
  const deck = new THREE.Mesh(hullGeometry(hull), rampSurface(rng));
  group.add(deck);

  // A lip along the takeoff edge, so it reads as a built ramp rather than a
  // wedge of dirt, and you can see where it ends at speed.
  const lip = new THREE.Mesh(
    new THREE.BoxGeometry(width, 0.28, 0.4),
    material('#c8a010'),
  );
  lip.position.set(0, height + 0.08, -length / 2 + 0.2);
  group.add(lip);

  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, length), material('#3a352c'));
    rail.position.set((side * width) / 2, height * 0.18, 0);
    rail.rotation.x = Math.atan2(height, length);
    group.add(rail);
  }

  return { object: group, hull };
}

function buildTabletop(prop: TrackProp, rng: Rng): { object: THREE.Object3D; hull: Hull } {
  const [width, height, length] = sizeOf(prop);
  const hull = tabletopHull(width, height, length, length * 0.35);

  const group = new THREE.Group();
  group.add(new THREE.Mesh(hullGeometry(hull), rampSurface(rng)));

  // Edge markers on the deck corners: on a table-top the landing is blind
  // from the run-up, and knowing where the deck ends is the whole skill.
  for (const side of [-1, 1]) {
    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.5, length * 0.35),
      material('#c8a010'),
    );
    marker.position.set((side * (width / 2 - 0.3)), height + 0.2, 0);
    group.add(marker);
  }

  return { object: group, hull };
}

function panelTexture(prop: TrackProp, rng: Rng): THREE.MeshLambertMaterial {
  if (prop.texture) {
    const key = `panel:${prop.texture}`;
    const existing = materialCache.get(key);
    if (existing) return existing;
    const created = new THREE.MeshLambertMaterial({
      map: imageTexture(prop.texture, { repeatX: 1, repeatY: 1 }),
      flatShading: true,
    });
    materialCache.set(key, created);
    return created;
  }
  return material(rng.pick(['#c03a1a', '#1a5aa8', '#d8a418', '#2a7a3a']));
}

/** A roadside hoarding. Carries track artwork on its face when given one. */
function buildBillboard(prop: TrackProp, rng: Rng): THREE.Object3D {
  const [width, height, postHeight] = sizeOf(prop);
  const group = new THREE.Group();

  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, postHeight + height, 0.3),
      material('#5a5248'),
    );
    post.position.set((side * width) / 3, (postHeight + height) / 2, 0);
    group.add(post);
  }

  const face = new THREE.Mesh(new THREE.PlaneGeometry(width, height), panelTexture(prop, rng));
  face.position.set(0, postHeight + height / 2, 0.09);
  group.add(face);

  // A plain back, so it reads as a solid object from behind rather than
  // vanishing when you drive past it.
  const back = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.16), material('#4a443c'));
  back.position.set(0, postHeight + height / 2, 0);
  group.add(back);

  const trim = new THREE.Mesh(new THREE.BoxGeometry(width + 0.4, 0.3, 0.3), material('#d8d2c0'));
  trim.position.set(0, postHeight + height + 0.1, 0);
  group.add(trim);

  return group;
}

function clothMaterial(prop: TrackProp, width: number, rng: Rng): THREE.MeshLambertMaterial {
  const key = `cloth:${prop.texture ?? 'plain'}:${width.toFixed(2)}`;
  const existing = materialCache.get(key);
  if (existing) return existing;

  const created = new THREE.MeshLambertMaterial({
    color: prop.texture ? '#ffffff' : rng.pick(['#c03a1a', '#e8e4d0', '#d8a418', '#1a5aa8']),
    map: prop.texture ? imageTexture(prop.texture, { repeatX: 1, repeatY: 1 }) : null,
    side: THREE.DoubleSide,
    flatShading: false,
  });

  created.onBeforeCompile = (shader) => {
    shader.uniforms.windTime = wind;
    shader.uniforms.clothWidth = { value: width };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float windTime;
uniform float clothWidth;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
// Pinned at the mast and free at the fly end, so the amplitude has to grow
// with distance along the cloth or it looks like a rigid flapping board.
float hoist = clamp( transformed.x / max( clothWidth, 0.001 ), 0.0, 1.0 );
float phase = windTime * 4.2 + transformed.x * 2.6;
transformed.z += sin( phase ) * 0.30 * hoist;
transformed.y += cos( phase * 0.75 ) * 0.10 * hoist * hoist;`,
      );
  };
  created.customProgramCacheKey = () => 'mtm-flag-cloth';

  materialCache.set(key, created);
  return created;
}

/** A flag on a mast, waving in the vertex shader. */
function buildFlag(prop: TrackProp, rng: Rng): THREE.Object3D {
  const [width, height, mastHeight] = sizeOf(prop);
  const group = new THREE.Group();

  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.09, mastHeight, 5),
    material('#b8b2a4'),
  );
  mast.position.y = mastHeight / 2;
  group.add(mast);

  const finial = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.3, 5), material('#d8a418'));
  finial.position.y = mastHeight + 0.15;
  group.add(finial);

  // Segmented along its length so the wave has vertices to move.
  const cloth = new THREE.PlaneGeometry(width, height, 10, 1);
  cloth.translate(width / 2, 0, 0);
  const flag = new THREE.Mesh(cloth, clothMaterial(prop, width, rng));
  flag.position.set(0.06, mastHeight - height / 2 - 0.25, 0);
  group.add(flag);

  return group;
}

function buildPalm(rng: Rng): THREE.Object3D {
  const group = new THREE.Group();
  const height = rng.range(5.5, 8.5);
  const lean = rng.range(-0.16, 0.16);

  // Stacked segments rather than one cylinder, so the trunk can curve.
  const segments = 6;
  for (let i = 0; i < segments; i++) {
    const t = i / segments;
    const piece = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.24 - t * 0.06, height / segments, 5),
      material(i % 2 === 0 ? '#6d5a3c' : '#7d6a48'),
    );
    piece.position.set(lean * height * t * t, height * (t + 0.5 / segments), 0);
    piece.rotation.z = -lean * t;
    group.add(piece);
  }

  const crown = new THREE.Group();
  crown.position.set(lean * height, height, 0);
  for (let i = 0; i < 7; i++) {
    const frond = new THREE.Mesh(
      new THREE.ConeGeometry(0.42, rng.range(2.4, 3.4), 4, 1, true),
      material(rng.pick(['#2f5a24', '#3c6b2c'])),
    );
    frond.rotation.z = Math.PI / 2 - rng.range(0.15, 0.6);
    frond.rotation.y = (i / 7) * Math.PI * 2 + rng.range(-0.2, 0.2);
    frond.position.y = 0.2;
    crown.add(frond);
  }
  group.add(crown);
  return group;
}

function buildDeadTree(rng: Rng): THREE.Object3D {
  const group = new THREE.Group();
  const height = rng.range(3.5, 5.5);
  const bark = material(rng.pick(['#4a4038', '#574c40', '#3e362e']));

  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.3, height, 5), bark);
  trunk.position.y = height / 2;
  group.add(trunk);

  for (let i = 0; i < 5; i++) {
    const length = rng.range(0.9, 2.0);
    const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.1, length, 4), bark);
    const yaw = rng.range(0, Math.PI * 2);
    const tilt = rng.range(0.5, 1.15);
    branch.position.set(
      Math.sin(yaw) * length * 0.4 * Math.sin(tilt),
      height * rng.range(0.5, 0.92),
      Math.cos(yaw) * length * 0.4 * Math.sin(tilt),
    );
    branch.rotation.set(Math.cos(yaw) * tilt, 0, -Math.sin(yaw) * tilt);
    group.add(branch);
  }
  return group;
}

export type PropCollision =
  | { kind: 'box'; halfExtents: THREE.Vector3 }
  | { kind: 'hull'; hull: Hull };

export interface BuiltProp {
  object: THREE.Object3D;
  /** Collision for this prop, or null when it is purely decorative. */
  collision: PropCollision | null;
}

/** Build one prop from its track definition. */
export function buildProp(prop: TrackProp, seed: number): BuiltProp {
  const rng = new Rng(seed);
  let object: THREE.Object3D;
  let hull: Hull | null = null;

  switch (prop.kind) {
    case 'tree': object = buildTree(rng); break;
    case 'palm': object = buildPalm(rng); break;
    case 'deadtree': object = buildDeadTree(rng); break;
    case 'rock': object = buildRock(rng); break;
    case 'barrel': object = buildBarrel(rng); break;
    case 'cone': object = buildCone(); break;
    case 'sign': object = buildSign(rng); break;
    case 'billboard': object = buildBillboard(prop, rng); break;
    case 'flag': object = buildFlag(prop, rng); break;
    case 'tower': object = buildTower(rng); break;
    case 'crate': object = buildCrate(rng); break;
    case 'arch': object = buildArch(); break;
    case 'ramp': ({ object, hull } = buildRamp(prop, rng)); break;
    case 'tabletop': ({ object, hull } = buildTabletop(prop, rng)); break;
  }

  const scale = prop.scale ?? 1;
  object.scale.setScalar(scale);
  object.position.set(prop.pos[0], prop.pos[1], prop.pos[2]);
  object.rotation.y += (prop.rotation ?? 0) * (Math.PI / 180);

  if (hull) {
    // Ramps are solid whatever the track says. The `solid` flag exists to let
    // an author put scenery close to the road without fencing it off; a ramp
    // you drive through is just a hole.
    return { object, collision: { kind: 'hull', hull: scaleHull(hull, scale) } };
  }

  const extents = prop.solid ? SOLID_EXTENTS[prop.kind] : null;
  if (!extents) return { object, collision: null };

  return {
    object,
    collision: {
      kind: 'box',
      halfExtents: new THREE.Vector3(
        extents[0] * scale * 0.5,
        extents[1] * scale * 0.5,
        extents[2] * scale * 0.5,
      ),
    },
  };
}

function scaleHull(hull: Hull, scale: number): Hull {
  if (scale === 1) return hull;
  return { vertices: hull.vertices.map((v) => v * scale), faces: hull.faces };
}

export function disposeProps(): void {
  for (const m of materialCache.values()) m.dispose();
  materialCache.clear();
}
