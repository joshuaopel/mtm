import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { ValueNoise2D, clamp, smootherstep } from '../core/Noise';
import { groundTexture } from '../core/Textures';
import type { TrackTerrain, TerrainFeature } from './formats';
import type { RoadPath } from './RoadPath';

/**
 * Heightfield terrain.
 *
 * The same height array feeds three consumers: the visible mesh, the physics
 * heightfield the wheels ray-cast against, and height queries used to place
 * props and respawn trucks. Deriving all three from one source is what keeps
 * the visual ground and the collision ground from disagreeing — a mismatch
 * there produces trucks that float or sink, and it is very hard to debug
 * after the fact.
 */
export class Terrain {
  readonly size: number;
  readonly segments: number;
  /** Metres between adjacent grid vertices. */
  readonly elementSize: number;
  readonly heights: Float32Array;

  readonly mesh: THREE.Mesh;
  readonly body: CANNON.Body;

  constructor(config: TrackTerrain, road: RoadPath, surface: string) {
    this.size = config.size;
    this.segments = config.segments;
    this.elementSize = config.size / config.segments;
    this.heights = new Float32Array((config.segments + 1) ** 2);

    this.generateHeights(config, road);
    this.mesh = this.buildMesh(surface);
    this.body = this.buildBody();
  }

  private index(ix: number, iz: number): number {
    return iz * (this.segments + 1) + ix;
  }

  /** World-space X of a grid column. */
  private worldX(ix: number): number {
    return -this.size / 2 + ix * this.elementSize;
  }

  /** World-space Z of a grid row. */
  private worldZ(iz: number): number {
    return -this.size / 2 + iz * this.elementSize;
  }

  private generateHeights(config: TrackTerrain, road: RoadPath): void {
    const noise = new ValueNoise2D(config.seed);
    const n = this.segments;

    // Pass 1: background terrain.
    for (let iz = 0; iz <= n; iz++) {
      for (let ix = 0; ix <= n; ix++) {
        const x = this.worldX(ix);
        const z = this.worldZ(iz);
        const base = noise.fbm(x * config.frequency, z * config.frequency, 4);
        let h = (base - 0.5) * 2 * config.amplitude;

        // Lift the rim of the map so the world reads as a bowl rather than
        // ending at a visible cliff edge.
        const edge = Math.max(Math.abs(x), Math.abs(z)) / (this.size / 2);
        h += smootherstep(0.72, 1.0, edge) * config.amplitude * 3.5;

        this.heights[this.index(ix, iz)] = h;
      }
    }

    // Pass 2: authored features.
    for (const feature of config.features) {
      this.applyFeature(feature);
    }

    // Pass 3: carve the road last so it always wins over the scenery.
    this.flattenAlongRoad(road);
  }

  private applyFeature(feature: TerrainFeature): void {
    const n = this.segments;

    if (feature.type === 'ridge') {
      const half = feature.width * 0.5;
      for (let iz = 0; iz <= n; iz++) {
        for (let ix = 0; ix <= n; ix++) {
          const x = this.worldX(ix);
          const z = this.worldZ(iz);
          const d = distanceToPolyline(x, z, feature.points);
          if (d > half) continue;
          const t = 1 - smootherstep(0, half, d);
          this.heights[this.index(ix, iz)] += feature.height * t;
        }
      }
      return;
    }

    const [fx, fz] = feature.pos;
    const radius = feature.radius;
    // Only visit the grid cells the feature can actually reach.
    const minX = clamp(Math.floor((fx - radius + this.size / 2) / this.elementSize), 0, n);
    const maxX = clamp(Math.ceil((fx + radius + this.size / 2) / this.elementSize), 0, n);
    const minZ = clamp(Math.floor((fz - radius + this.size / 2) / this.elementSize), 0, n);
    const maxZ = clamp(Math.ceil((fz + radius + this.size / 2) / this.elementSize), 0, n);

    for (let iz = minZ; iz <= maxZ; iz++) {
      for (let ix = minX; ix <= maxX; ix++) {
        const x = this.worldX(ix);
        const z = this.worldZ(iz);
        const d = Math.hypot(x - fx, z - fz);
        if (d > radius) continue;
        const i = this.index(ix, iz);
        const t = 1 - smootherstep(0, radius, d);

        switch (feature.type) {
          case 'hill':
            this.heights[i] += feature.height * t * t;
            break;
          case 'crater': {
            // Dish out the middle and throw a lip up around the edge.
            const rim = Math.exp(-(((d / radius) - 0.85) ** 2) / 0.01);
            this.heights[i] -= feature.depth * t * t;
            this.heights[i] += feature.depth * 0.35 * rim;
            break;
          }
          case 'plateau': {
            const blend = 1 - smootherstep(radius * (1 - feature.falloff), radius, d);
            this.heights[i] += (feature.height - this.heights[i]) * blend;
            break;
          }
        }
      }
    }
  }

  /**
   * Blend terrain height towards the road surface. Inside the tarmac the
   * road wins outright; across the shoulder it eases back to the natural
   * ground so you can run wide without hitting a wall of dirt.
   */
  private flattenAlongRoad(road: RoadPath): void {
    const n = this.segments;
    for (let iz = 0; iz <= n; iz++) {
      for (let ix = 0; ix <= n; ix++) {
        const x = this.worldX(ix);
        const z = this.worldZ(iz);
        const query = road.closestTo(x, z);
        const halfWidth = query.width * 0.5;
        const outer = halfWidth + road.shoulder;
        const lateral = Math.abs(query.lateral);
        if (lateral > outer) continue;

        const bank = road.banks[query.index] * (Math.PI / 180);
        const roadY = query.point.y + clamp(query.lateral, -halfWidth, halfWidth) * Math.tan(bank);

        const i = this.index(ix, iz);
        const blend = 1 - smootherstep(halfWidth, outer, lateral);
        this.heights[i] += (roadY - this.heights[i]) * blend;
      }
    }
  }

  private buildMesh(surface: string): THREE.Mesh {
    const geometry = new THREE.PlaneGeometry(this.size, this.size, this.segments, this.segments);
    geometry.rotateX(-Math.PI / 2);

    // PlaneGeometry emits vertices row-major starting at +Y (which becomes
    // -Z after the rotation), so attribute order matches our grid indexing.
    const position = geometry.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(position.count * 3);
    const color = new THREE.Color();

    for (let i = 0; i < position.count; i++) {
      position.setY(i, this.heights[i]);
    }
    geometry.computeVertexNormals();

    // Tint by slope so steep faces read as exposed rock. Cheap stand-in for
    // the multi-texture splatting the era couldn't afford either.
    const normal = geometry.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < position.count; i++) {
      const steepness = 1 - clamp(normal.getY(i), 0, 1);
      const shade = 1 - smootherstep(0.12, 0.55, steepness) * 0.45;
      color.setRGB(shade, shade, shade * 0.97);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.MeshLambertMaterial({
      map: groundTexture(surface, this.size / 8),
      vertexColors: true,
      flatShading: true,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'terrain';
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return mesh;
  }

  private buildBody(): CANNON.Body {
    // cannon's Heightfield indexes data[i][j] along its local +X and +Y. We
    // lay it flat by rotating -90 degrees about X, which sends local +Y to
    // world -Z, so the row index has to be flipped to match.
    const n = this.segments;
    const matrix: number[][] = [];
    for (let i = 0; i <= n; i++) {
      const column = new Array<number>(n + 1);
      for (let j = 0; j <= n; j++) {
        column[j] = this.heights[this.index(i, n - j)];
      }
      matrix.push(column);
    }

    const shape = new CANNON.Heightfield(matrix, { elementSize: this.elementSize });
    const body = new CANNON.Body({ mass: 0, shape, material: new CANNON.Material('ground') });
    body.position.set(-this.size / 2, 0, this.size / 2);
    body.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    return body;
  }

  /** Bilinear height sample at an arbitrary world position. */
  heightAt(x: number, z: number): number {
    const fx = (x + this.size / 2) / this.elementSize;
    const fz = (z + this.size / 2) / this.elementSize;
    const ix = clamp(Math.floor(fx), 0, this.segments - 1);
    const iz = clamp(Math.floor(fz), 0, this.segments - 1);
    const tx = clamp(fx - ix, 0, 1);
    const tz = clamp(fz - iz, 0, 1);

    const h00 = this.heights[this.index(ix, iz)];
    const h10 = this.heights[this.index(ix + 1, iz)];
    const h01 = this.heights[this.index(ix, iz + 1)];
    const h11 = this.heights[this.index(ix + 1, iz + 1)];

    const top = h00 + (h10 - h00) * tx;
    const bottom = h01 + (h11 - h01) * tx;
    return top + (bottom - top) * tz;
  }

  /** Approximate surface normal, from central differences. */
  normalAt(x: number, z: number): THREE.Vector3 {
    const e = this.elementSize;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return new THREE.Vector3(-dx, 2 * e, -dz).normalize();
  }

  /** Steepness in radians, used to keep props off cliff faces. */
  slopeAt(x: number, z: number): number {
    return Math.acos(clamp(this.normalAt(x, z).y, -1, 1));
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/** Shortest distance from a point to a polyline in the XZ plane. */
function distanceToPolyline(x: number, z: number, points: [number, number][]): number {
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i];
    const [bx, bz] = points[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const lengthSq = dx * dx + dz * dz;
    const t = lengthSq > 0 ? clamp(((x - ax) * dx + (z - az) * dz) / lengthSq, 0, 1) : 0;
    const px = ax + dx * t;
    const pz = az + dz * t;
    best = Math.min(best, Math.hypot(x - px, z - pz));
  }
  return best;
}
