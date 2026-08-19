import * as THREE from 'three';

/**
 * Convex hulls for the props you drive on.
 *
 * A kicker and a table-top are both convex solids, which is the only reason
 * they can exist as props at all: cannon resolves box and convex-hull contacts
 * properly but its triangle meshes only collide reliably against spheres and
 * rays, so a concave ramp would let truck bodies through at exactly the speed
 * you hit one.
 *
 * Winding matters and is not obvious by inspection — cannon takes the face
 * normal from the vertex order, and a face wound the wrong way makes the hull
 * behave inside-out, which shows up as trucks falling through a ramp rather
 * than as anything that looks like a geometry bug. `hullIsOutward` checks it
 * arithmetically, and the ramp drop tests exercise it in the simulator.
 */

export interface Hull {
  /** Flat xyz triples in the prop's local space, y=0 on the ground. */
  vertices: number[];
  /** Index loops, wound counter-clockwise seen from outside the solid. */
  faces: number[][];
}

/**
 * A kicker: a wedge rising towards local -Z, which is the game's forward
 * direction, so a ramp yawed to the road's heading launches you along it.
 */
export function kickerHull(width: number, height: number, length: number): Hull {
  const w = width / 2;
  const l = length / 2;

  // 0-3 base, 4-5 the top edge of the takeoff lip.
  const vertices = [
    -w, 0, l, //  0 back left  (ground, trailing edge)
    w, 0, l, //  1 back right
    w, 0, -l, //  2 front right (ground, under the lip)
    -w, 0, -l, //  3 front left
    -w, height, -l, //  4 lip left
    w, height, -l, //  5 lip right
  ];

  const faces = [
    [0, 3, 2, 1], // bottom, normal -Y
    [0, 1, 5, 4], // the ramp surface, sloping up towards -Z
    [2, 3, 4, 5], // the vertical face under the lip, normal -Z
    [1, 2, 5], // right side
    [0, 4, 3], // left side
  ];

  return { vertices, faces };
}

/**
 * A table-top: up-ramp, flat deck, down-ramp in one convex solid.
 *
 * `deck` is the flat length at the top; the two slopes take whatever is left.
 */
export function tabletopHull(
  width: number,
  height: number,
  length: number,
  deck: number,
): Hull {
  const w = width / 2;
  const l = length / 2;
  const d = Math.min(deck, length * 0.9) / 2;

  const vertices = [
    -w, 0, l, //  0 base back left
    w, 0, l, //  1 base back right
    w, 0, -l, //  2 base front right
    -w, 0, -l, //  3 base front left
    -w, height, d, //  4 deck back left
    w, height, d, //  5 deck back right
    w, height, -d, //  6 deck front right
    -w, height, -d, //  7 deck front left
  ];

  const faces = [
    [0, 3, 2, 1], // bottom
    [4, 5, 6, 7], // deck
    [0, 1, 5, 4], // back slope
    [2, 3, 7, 6], // front slope
    [1, 2, 6, 5], // right side
    [0, 4, 7, 3], // left side
  ];

  return { vertices, faces };
}

/** Three.js geometry for a hull, flat-shaded to match everything else. */
export function hullGeometry(hull: Hull): THREE.BufferGeometry {
  const positions: number[] = [];

  for (const face of hull.faces) {
    // Fan-triangulate. Every face here is convex and planar, so a fan from
    // the first vertex is watertight.
    for (let i = 1; i < face.length - 1; i++) {
      for (const index of [face[0], face[i], face[i + 1]]) {
        positions.push(
          hull.vertices[index * 3],
          hull.vertices[index * 3 + 1],
          hull.vertices[index * 3 + 2],
        );
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Every face normal points away from the hull's interior.
 *
 * Uses the centroid as an interior reference point, which is valid for any
 * convex solid. Returns the indices of faces that are wound inwards.
 */
export function inwardFaces(hull: Hull): number[] {
  const count = hull.vertices.length / 3;
  const centre = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    centre[0] += hull.vertices[i * 3];
    centre[1] += hull.vertices[i * 3 + 1];
    centre[2] += hull.vertices[i * 3 + 2];
  }
  centre[0] /= count;
  centre[1] /= count;
  centre[2] /= count;

  const bad: number[] = [];
  hull.faces.forEach((face, index) => {
    const a = vertex(hull, face[0]);
    const b = vertex(hull, face[1]);
    const c = vertex(hull, face[2]);
    const normal = cross(sub(b, a), sub(c, a));
    // Positive means the normal points the same way as "outwards from the
    // centroid", which is what cannon needs.
    if (dot(normal, sub(a, centre)) <= 0) bad.push(index);
  });
  return bad;
}

export function hullIsOutward(hull: Hull): boolean {
  return inwardFaces(hull).length === 0;
}

function vertex(hull: Hull, index: number): number[] {
  return [hull.vertices[index * 3], hull.vertices[index * 3 + 1], hull.vertices[index * 3 + 2]];
}

function sub(a: number[], b: number[]): number[] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: number[], b: number[]): number[] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: number[], b: number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
