import * as THREE from 'three';
import { Rng, ValueNoise2D, clamp } from './Noise';

/**
 * Procedural low-resolution textures.
 *
 * Everything is generated into a 64x64 canvas and sampled with nearest
 * filtering. Real 1996 texture art was hand-painted at exactly this kind of
 * size, and keeping it small is what makes surfaces read as gritty rather
 * than blurry when the camera gets close.
 */

const SIZE = 64;
const cache = new Map<string, THREE.Texture>();

interface Layer {
  color: string;
  /** Relative weight in the speckle mix. */
  amount: number;
}

interface SurfaceOptions {
  base: string;
  layers: Layer[];
  /** Frequency of the large-scale mottling. */
  scale: number;
  /** How much per-pixel grain to add, 0..1. */
  grain: number;
  /** Optional directional streaking, for ruts and drag marks. */
  streak?: number;
}

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function buildCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

function finish(canvas: HTMLCanvasElement, repeat: number): THREE.Texture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapLinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 1;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** Mottled noise surface: the workhorse behind every ground and wall type. */
function surfaceTexture(seed: number, options: SurfaceOptions): HTMLCanvasElement {
  const { canvas, ctx } = buildCanvas(SIZE);
  const noise = new ValueNoise2D(seed);
  const detail = new ValueNoise2D(seed + 977);
  const rng = new Rng(seed + 31);

  const image = ctx.createImageData(SIZE, SIZE);
  const base = hexToRgb(options.base);
  const layers = options.layers.map((l) => ({ rgb: hexToRgb(l.color), amount: l.amount }));
  const totalWeight = layers.reduce((sum, l) => sum + l.amount, 0) || 1;

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      // Sample on a torus so the tile wraps seamlessly in both directions.
      const u = (x / SIZE) * Math.PI * 2;
      const v = (y / SIZE) * Math.PI * 2;
      const wrapX = Math.cos(u) * options.scale + Math.sin(v) * 0.3;
      const wrapY = Math.sin(u) * options.scale + Math.cos(v) * 0.3;

      let n = noise.fbm(wrapX + 8, wrapY + 8, 3);
      if (options.streak) {
        // Stretch the noise along Y to suggest tyre ruts running with the road.
        n = n * (1 - options.streak) + detail.sample(wrapX * 3, wrapY * 0.35) * options.streak;
      }

      let r = base[0];
      let g = base[1];
      let b = base[2];

      // Pick a speckle layer by thresholding the noise into weighted bands.
      let accum = 0;
      const pick = n * totalWeight;
      for (const layer of layers) {
        accum += layer.amount;
        if (pick <= accum) {
          const blend = 0.55 + rng.float() * 0.45;
          r = r + (layer.rgb[0] - r) * blend;
          g = g + (layer.rgb[1] - g) * blend;
          b = b + (layer.rgb[2] - b) * blend;
          break;
        }
      }

      const grain = (rng.float() - 0.5) * options.grain * 255;
      const idx = (y * SIZE + x) * 4;
      image.data[idx] = clamp(r + grain, 0, 255);
      image.data[idx + 1] = clamp(g + grain, 0, 255);
      image.data[idx + 2] = clamp(b + grain, 0, 255);
      image.data[idx + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** Palettes for each terrain theme, plus the road cut through it. */
const SURFACE_PRESETS: Record<string, { ground: SurfaceOptions; road: SurfaceOptions }> = {
  dirt: {
    ground: {
      base: '#6b5a3a',
      layers: [
        { color: '#4c6b2a', amount: 3 },
        { color: '#7a6842', amount: 4 },
        { color: '#3d3320', amount: 2 },
      ],
      scale: 1.6,
      grain: 0.16,
    },
    road: {
      base: '#7a6444',
      layers: [
        { color: '#5c4a30', amount: 4 },
        { color: '#8e7754', amount: 3 },
        { color: '#463522', amount: 2 },
      ],
      scale: 1.1,
      grain: 0.13,
      streak: 0.55,
    },
  },
  sand: {
    ground: {
      base: '#c2a068',
      layers: [
        { color: '#d8bb84', amount: 4 },
        { color: '#a4834e', amount: 3 },
        { color: '#8d6b3c', amount: 1 },
      ],
      scale: 1.4,
      grain: 0.12,
    },
    road: {
      base: '#b89660',
      layers: [
        { color: '#9c7c48', amount: 4 },
        { color: '#cdae7a', amount: 3 },
      ],
      scale: 1.0,
      grain: 0.1,
      streak: 0.6,
    },
  },
  snow: {
    ground: {
      base: '#dfe6ee',
      layers: [
        { color: '#ffffff', amount: 5 },
        { color: '#b8c6d6', amount: 3 },
        { color: '#8fa2b8', amount: 1 },
      ],
      scale: 1.8,
      grain: 0.09,
    },
    road: {
      base: '#b6bfc9',
      layers: [
        { color: '#9aa5b2', amount: 4 },
        { color: '#d6dee6', amount: 3 },
        { color: '#6f7a86', amount: 2 },
      ],
      scale: 1.1,
      grain: 0.12,
      streak: 0.65,
    },
  },
  mud: {
    ground: {
      base: '#4a4426',
      layers: [
        { color: '#3a5a24', amount: 3 },
        { color: '#5a4e2c', amount: 4 },
        { color: '#2a2414', amount: 3 },
      ],
      scale: 1.5,
      grain: 0.15,
    },
    road: {
      base: '#4a3a22',
      layers: [
        { color: '#33270f', amount: 5 },
        { color: '#5e4a2c', amount: 3 },
        { color: '#6b5a3a', amount: 1 },
      ],
      scale: 0.9,
      grain: 0.16,
      streak: 0.7,
    },
  },
  slag: {
    ground: {
      base: '#57544e',
      layers: [
        { color: '#6b6760', amount: 4 },
        { color: '#3e3b36', amount: 4 },
        { color: '#7a4a2a', amount: 1 },
      ],
      scale: 1.7,
      grain: 0.18,
    },
    road: {
      base: '#4a4844',
      layers: [
        { color: '#383632', amount: 4 },
        { color: '#5e5c56', amount: 4 },
      ],
      scale: 1.2,
      grain: 0.14,
      streak: 0.5,
    },
  },
  grass: {
    ground: {
      base: '#4a6b2c',
      layers: [
        { color: '#5c7f36', amount: 4 },
        { color: '#3a5622', amount: 4 },
        { color: '#6b7a3a', amount: 2 },
      ],
      scale: 2.0,
      grain: 0.14,
    },
    road: {
      base: '#6e5c3c',
      layers: [
        { color: '#54462c', amount: 4 },
        { color: '#836f4a', amount: 3 },
      ],
      scale: 1.0,
      grain: 0.13,
      streak: 0.6,
    },
  },
};

const WALL_PRESETS: Record<string, SurfaceOptions> = {
  concrete: {
    base: '#9a978e',
    layers: [
      { color: '#8a877e', amount: 4 },
      { color: '#aaa79e', amount: 3 },
      { color: '#6e6b64', amount: 1 },
    ],
    scale: 1.3,
    grain: 0.1,
  },
  tire: {
    base: '#2a2a2a',
    layers: [
      { color: '#1a1a1a', amount: 4 },
      { color: '#3a3a3a', amount: 3 },
    ],
    scale: 2.2,
    grain: 0.12,
  },
  metal: {
    base: '#7a8290',
    layers: [
      { color: '#5e6672', amount: 4 },
      { color: '#98a2b0', amount: 3 },
      { color: '#8a5a2a', amount: 1 },
    ],
    scale: 1.1,
    grain: 0.1,
  },
  wood: {
    base: '#7a5a34',
    layers: [
      { color: '#5e4426', amount: 4 },
      { color: '#8e6c42', amount: 3 },
    ],
    scale: 0.8,
    grain: 0.12,
    streak: 0.75,
  },
  rock: {
    base: '#6e6459',
    layers: [
      { color: '#574e45', amount: 4 },
      { color: '#847a6e', amount: 3 },
      { color: '#3e372f', amount: 2 },
    ],
    scale: 1.6,
    grain: 0.16,
  },
};

function seedFromString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function cached(key: string, build: () => THREE.Texture): THREE.Texture {
  const existing = cache.get(key);
  if (existing) return existing;
  const texture = build();
  cache.set(key, texture);
  return texture;
}

export function groundTexture(theme: string, repeat = 64): THREE.Texture {
  const preset = SURFACE_PRESETS[theme] ?? SURFACE_PRESETS.dirt;
  return cached(`ground:${theme}:${repeat}`, () =>
    finish(surfaceTexture(seedFromString(`ground${theme}`), preset.ground), repeat),
  );
}

export function roadTexture(theme: string, repeat = 1): THREE.Texture {
  const preset = SURFACE_PRESETS[theme] ?? SURFACE_PRESETS.dirt;
  return cached(`road:${theme}:${repeat}`, () =>
    finish(surfaceTexture(seedFromString(`road${theme}`), preset.road), repeat),
  );
}

export function wallTexture(material: string): THREE.Texture {
  const preset = WALL_PRESETS[material] ?? WALL_PRESETS.concrete;
  return cached(`wall:${material}`, () => {
    const texture = finish(surfaceTexture(seedFromString(`wall${material}`), preset), 1);
    if (material === 'tire') {
      // Tyre walls read better as stacked rings than as flat noise.
      const canvas = texture.image as HTMLCanvasElement;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.strokeStyle = 'rgba(10,10,10,0.85)';
        ctx.lineWidth = 2;
        for (let y = 8; y < SIZE; y += 16) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(SIZE, y);
          ctx.stroke();
        }
        texture.needsUpdate = true;
      }
    }
    return texture;
  });
}

/** Black-and-white chequer for the start/finish line. */
export function checkerTexture(): THREE.Texture {
  return cached('checker', () => {
    const { canvas, ctx } = buildCanvas(SIZE);
    const cell = SIZE / 8;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? '#f0f0e8' : '#1a1a18';
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
    return finish(canvas, 1);
  });
}

/** Vertical gradient used by the sky dome. */
export function skyTexture(zenith: string, horizon: string): THREE.Texture {
  return cached(`sky:${zenith}:${horizon}`, () => {
    const height = 64;
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, zenith);
    gradient.addColorStop(0.55, horizon);
    gradient.addColorStop(1, horizon);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1, height);

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  });
}

/** Knobbly tread pattern wrapped around the tyre sidewall/tread. */
export function treadTexture(): THREE.Texture {
  return cached('tread', () => {
    const { canvas, ctx } = buildCanvas(SIZE);
    ctx.fillStyle = '#232323';
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = '#101010';
    for (let i = 0; i < 8; i++) {
      const y = i * 8;
      ctx.fillRect(0, y, SIZE, 3);
      ctx.fillRect((i % 2) * 16, y, 10, 8);
    }
    ctx.fillStyle = '#333';
    const rng = new Rng(seedFromString('tread'));
    for (let i = 0; i < 40; i++) {
      ctx.fillRect(rng.range(0, SIZE), rng.range(0, SIZE), 2, 2);
    }
    return finish(canvas, 1);
  });
}

/**
 * Load a texture from an image file, for tracks that ship their own artwork.
 *
 * Returns immediately with a placeholder that is filled in once the image
 * arrives, which is how three's loader works — the material picks up the
 * pixels on the next frame. A failed load leaves the placeholder in place and
 * logs, rather than throwing, so a broken path costs you a grey road and not
 * the whole track.
 */
export function imageTexture(
  url: string,
  options: { repeatX?: number; repeatY?: number; pixelated?: boolean } = {},
): THREE.Texture {
  const key = `image:${url}:${options.repeatX ?? 1}:${options.repeatY ?? 1}:${options.pixelated !== false}`;
  return cached(key, () => {
    const loader = new THREE.TextureLoader();
    const texture = loader.load(
      url,
      undefined,
      undefined,
      () => console.warn(`[textures] could not load artwork "${url}"; keeping the fallback`),
    );

    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(options.repeatX ?? 1, options.repeatY ?? 1);
    texture.colorSpace = THREE.SRGBColorSpace;

    if (options.pixelated !== false) {
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestMipmapLinearFilter;
    }
    texture.anisotropy = 1;
    return texture;
  });
}

export function disposeTextures(): void {
  for (const texture of cache.values()) texture.dispose();
  cache.clear();
}
