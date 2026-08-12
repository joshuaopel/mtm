import * as THREE from 'three';
import { Rng } from '../core/Noise';
import type { TrackProp } from './formats';

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
const SOLID_EXTENTS: Record<TrackProp['kind'], [number, number, number] | null> = {
  tree: [0.8, 6, 0.8],
  rock: [2.4, 2.2, 2.4],
  barrel: [1.0, 1.4, 1.0],
  cone: null, // squashable, deliberately not solid
  sign: [0.3, 3, 2.4],
  tower: [3.2, 12, 3.2],
  crate: [1.6, 1.6, 1.6],
  arch: null, // the posts are added as walls by the track instead
};

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

export interface BuiltProp {
  object: THREE.Object3D;
  /** Half-extents for a collision box, or null for decorative props. */
  collisionHalfExtents: THREE.Vector3 | null;
}

/** Build one prop from its track definition. */
export function buildProp(prop: TrackProp, seed: number): BuiltProp {
  const rng = new Rng(seed);
  let object: THREE.Object3D;

  switch (prop.kind) {
    case 'tree': object = buildTree(rng); break;
    case 'rock': object = buildRock(rng); break;
    case 'barrel': object = buildBarrel(rng); break;
    case 'cone': object = buildCone(); break;
    case 'sign': object = buildSign(rng); break;
    case 'tower': object = buildTower(rng); break;
    case 'crate': object = buildCrate(rng); break;
    case 'arch': object = buildArch(); break;
  }

  const scale = prop.scale ?? 1;
  object.scale.setScalar(scale);
  object.position.set(prop.pos[0], prop.pos[1], prop.pos[2]);
  object.rotation.y += (prop.rotation ?? 0) * (Math.PI / 180);

  const extents = prop.solid ? SOLID_EXTENTS[prop.kind] : null;
  const collisionHalfExtents = extents
    ? new THREE.Vector3(extents[0] * scale * 0.5, extents[1] * scale * 0.5, extents[2] * scale * 0.5)
    : null;

  return { object, collisionHalfExtents };
}

export function disposeProps(): void {
  for (const m of materialCache.values()) m.dispose();
  materialCache.clear();
}
