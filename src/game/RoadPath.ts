import * as THREE from 'three';
import type { TrackRoad } from './formats';

export interface RoadQuery {
  /** Index of the nearest resampled point. */
  index: number;
  /** Arc length from the start of the road to that point, in metres. */
  distance: number;
  /** Signed lateral offset: negative is left of the racing direction. */
  lateral: number;
  point: THREE.Vector3;
  tangent: THREE.Vector3;
  width: number;
}

/**
 * The racing line, resampled to uniform arc length.
 *
 * One object serves three jobs, which is deliberate — they must agree:
 *   - the visible road ribbon is lofted along it,
 *   - the terrain is flattened underneath it,
 *   - the AI follows it and the race director measures progress along it.
 *
 * If these used separate representations they would drift apart and the AI
 * would drive somewhere the road isn't.
 */
export class RoadPath {
  readonly closed: boolean;
  readonly length: number;
  readonly points: THREE.Vector3[] = [];
  readonly tangents: THREE.Vector3[] = [];
  readonly widths: number[] = [];
  readonly banks: number[] = [];
  /** Uniform spacing between resampled points, in metres. */
  readonly step: number;
  readonly shoulder: number;

  private buckets = new Map<number, number[]>();
  private cellSize: number;

  constructor(road: TrackRoad, resolution = 1.5) {
    this.closed = road.closed;
    this.shoulder = road.shoulder;

    const controls = road.points.map((p) => new THREE.Vector3(p.pos[0], p.pos[1], p.pos[2]));
    const curve = new THREE.CatmullRomCurve3(controls, road.closed, 'centripetal', 0.5);

    const approxLength = curve.getLength();
    const count = Math.max(8, Math.round(approxLength / resolution));
    this.step = approxLength / count;
    this.length = approxLength;

    // getSpacedPoints returns count+1 arc-length-uniform samples. For a closed
    // loop the last duplicates the first, so drop it to keep spacing even.
    const spaced = curve.getSpacedPoints(count);
    const sampleCount = road.closed ? count : count + 1;

    for (let i = 0; i < sampleCount; i++) {
      this.points.push(spaced[i].clone());

      // Map the sample back onto control-point space so per-point width and
      // bank overrides interpolate along the same parameterisation.
      const u = i / count;
      const t = curve.getUtoTmapping(u, u * approxLength);
      const span = road.closed ? controls.length : controls.length - 1;
      const raw = t * span;
      const i0 = Math.floor(raw) % controls.length;
      const i1 = (i0 + 1) % controls.length;
      const frac = raw - Math.floor(raw);

      const w0 = road.points[i0].width ?? road.width;
      const w1 = road.points[i1].width ?? road.width;
      this.widths.push(w0 + (w1 - w0) * frac);

      const b0 = road.points[i0].bank ?? 0;
      const b1 = road.points[i1].bank ?? 0;
      this.banks.push(b0 + (b1 - b0) * frac);
    }

    for (let i = 0; i < this.points.length; i++) {
      const next = this.points[this.wrap(i + 1)];
      const prev = this.points[this.wrap(i - 1)];
      this.tangents.push(next.clone().sub(prev).normalize());
    }

    // Cells must be at least as wide as the furthest query we expect to
    // resolve from a 3x3 neighbourhood.
    const maxWidth = Math.max(...this.widths);
    this.cellSize = Math.max(8, maxWidth * 0.5 + road.shoulder + 4);
    this.buildBuckets();
  }

  /** Clamp (open road) or wrap (closed circuit) a sample index. */
  wrap(index: number): number {
    const n = this.points.length;
    if (this.closed) return ((index % n) + n) % n;
    return index < 0 ? 0 : index >= n ? n - 1 : index;
  }

  private key(cx: number, cz: number): number {
    // Pack two signed cell coordinates into one integer key.
    return (cx + 4096) * 8192 + (cz + 4096);
  }

  private buildBuckets(): void {
    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i];
      const cx = Math.floor(p.x / this.cellSize);
      const cz = Math.floor(p.z / this.cellSize);
      const k = this.key(cx, cz);
      const list = this.buckets.get(k);
      if (list) list.push(i);
      else this.buckets.set(k, [i]);
    }
  }

  /** Arc length at a sample index. */
  distanceAt(index: number): number {
    return this.wrap(index) * this.step;
  }

  pointAt(index: number): THREE.Vector3 {
    return this.points[this.wrap(index)];
  }

  tangentAt(index: number): THREE.Vector3 {
    return this.tangents[this.wrap(index)];
  }

  widthAt(index: number): number {
    return this.widths[this.wrap(index)];
  }

  /**
   * Nearest point on the road to a world position.
   *
   * Uses a uniform bucket grid; falls back to a strided brute-force sweep for
   * queries far off the course, which happens when a truck gets launched.
   */
  closestTo(x: number, z: number): RoadQuery {
    const cx = Math.floor(x / this.cellSize);
    const cz = Math.floor(z / this.cellSize);

    let best = -1;
    let bestDistanceSq = Infinity;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const list = this.buckets.get(this.key(cx + dx, cz + dz));
        if (!list) continue;
        for (const i of list) {
          const p = this.points[i];
          const d = (p.x - x) ** 2 + (p.z - z) ** 2;
          if (d < bestDistanceSq) {
            bestDistanceSq = d;
            best = i;
          }
        }
      }
    }

    if (best < 0) {
      const stride = Math.max(1, Math.floor(this.points.length / 256));
      for (let i = 0; i < this.points.length; i += stride) {
        const p = this.points[i];
        const d = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d < bestDistanceSq) {
          bestDistanceSq = d;
          best = i;
        }
      }
      // Refine around the coarse hit so the result is still accurate.
      const coarse = best;
      for (let i = coarse - stride; i <= coarse + stride; i++) {
        const p = this.points[this.wrap(i)];
        const d = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d < bestDistanceSq) {
          bestDistanceSq = d;
          best = this.wrap(i);
        }
      }
    }

    const point = this.points[best];
    const tangent = this.tangents[best];
    // Sign the offset by which side of the tangent the query falls on.
    const toQueryX = x - point.x;
    const toQueryZ = z - point.z;
    const cross = tangent.z * toQueryX - tangent.x * toQueryZ;
    const lateral = Math.sign(cross) * Math.sqrt(bestDistanceSq);

    return {
      index: best,
      distance: best * this.step,
      lateral,
      point,
      tangent,
      width: this.widths[best],
    };
  }

  /**
   * Heading in radians at a sample, measured so that it can be handed
   * straight to a Y-axis rotation.
   */
  headingAt(index: number): number {
    const t = this.tangentAt(index);
    return Math.atan2(t.x, t.z);
  }

  /**
   * Signed curvature over a lookahead window, used by the AI to decide how
   * hard to brake for what is coming.
   */
  curvatureAt(index: number, lookaheadSamples: number): number {
    const a = this.tangentAt(index);
    const b = this.tangentAt(index + lookaheadSamples);
    const cross = a.z * b.x - a.x * b.z;
    const dot = Math.max(-1, Math.min(1, a.dot(b)));
    return Math.sign(cross) * Math.acos(dot);
  }
}
