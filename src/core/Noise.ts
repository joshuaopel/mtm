/**
 * Deterministic pseudo-random numbers and value noise.
 *
 * Everything procedural in the game (terrain, textures, prop scatter) draws
 * from a seed stored in the track file, so a given track builds identically
 * on every machine and every run.
 */

/** Small, fast, well-distributed 32-bit PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Convenience wrapper: seeded random helpers with the usual shapes. */
export class Rng {
  private next: () => number;

  constructor(seed: number) {
    this.next = mulberry32(seed);
  }

  float(): number {
    return this.next();
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  int(min: number, maxExclusive: number): number {
    return Math.floor(this.range(min, maxExclusive));
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.min(items.length - 1, Math.floor(this.next() * items.length))];
  }

  /** Symmetric jitter around zero. */
  spread(amount: number): number {
    return (this.next() * 2 - 1) * amount;
  }
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Tiling-free 2D value noise on a hashed lattice. Cheaper than gradient
 * noise and the slightly blockier character suits the era.
 */
export class ValueNoise2D {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
  }

  private hash(ix: number, iy: number): number {
    let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + this.seed) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  /** Single octave, returns 0..1. */
  sample(x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smoothstep(x - x0);
    const fy = smoothstep(y - y0);

    const n00 = this.hash(x0, y0);
    const n10 = this.hash(x0 + 1, y0);
    const n01 = this.hash(x0, y0 + 1);
    const n11 = this.hash(x0 + 1, y0 + 1);

    const top = n00 + (n10 - n00) * fx;
    const bottom = n01 + (n11 - n01) * fx;
    return top + (bottom - top) * fy;
  }

  /** Fractal sum of octaves, returns roughly 0..1. */
  fbm(x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
    let amplitude = 1;
    let frequency = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.sample(x * frequency, y * frequency) * amplitude;
      norm += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    return sum / norm;
  }

  /** Ridged variant, good for rocky spines. */
  ridged(x: number, y: number, octaves = 4): number {
    let amplitude = 1;
    let frequency = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      const n = 1 - Math.abs(this.sample(x * frequency, y * frequency) * 2 - 1);
      sum += n * n * amplitude;
      norm += amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }
    return sum / norm;
  }
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Smooth 0..1 ramp between two edges. */
export function smootherstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1e-6), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}
