import * as THREE from 'three';
import { clamp, smootherstep } from '../core/Noise';
import { groundTexture, imageTexture } from '../core/Textures';
import type { TerrainPaint, TerrainPaintRule, TerrainWeights, TrackArtwork } from './formats';
import type { RoadPath } from './RoadPath';

/**
 * Multi-texture terrain.
 *
 * The terrain is one mesh with one material, so the layers cannot be separate
 * draw calls; they are blended in the fragment shader from a weight per
 * vertex. Those weights come from painting in Blender, from rules describing
 * the landscape, or from both — by the time they reach the GPU they are the
 * same `vec4` either way, and the shader has no idea which it got.
 *
 * The blend rides inside `MeshLambertMaterial` rather than a `ShaderMaterial`
 * so fog, lighting and the retro post pass keep working untouched. That is
 * worth the awkwardness of string-replacing a shader chunk: a custom material
 * would have to re-implement all three and would drift from them.
 */

/** Layers past this cost a texture fetch each for the whole terrain. */
export const MAX_LAYERS = 4;

/**
 * Blend weights per vertex, four floats, normalised to sum to 1.
 *
 * Named to match the attribute the injected vertex shader declares.
 */
export type LayerWeights = Float32Array;

export interface PaintContext {
  segments: number;
  size: number;
  heights: Float32Array;
  /** Vertex normals, three floats per vertex, in the mesh's own space. */
  normals: THREE.BufferAttribute;
  positions: THREE.BufferAttribute;
  road: RoadPath;
}

/**
 * Ground surfaces that read as a different material next to the base one.
 * A track that does not ask for paint still gets rock on its cliffs, which is
 * most of the visual win for none of the authoring.
 */
const DEFAULT_ACCENT: Record<string, string | undefined> = {
  dirt: 'sand',
  grass: 'dirt',
  mud: 'dirt',
  sand: undefined,
  snow: undefined,
  slag: undefined,
};

/**
 * What the terrain looks like when the track says nothing about paint.
 *
 * Rock on anything steep, and for the softer surfaces a worn verge either
 * side of the racing line. Both are things the eye expects to see and neither
 * needs the author to do anything.
 */
export function defaultPaint(surface: string): TerrainPaint {
  const layers = [{ texture: surface, scale: 8 }, { texture: 'rock', scale: 11 }];
  // 32-52 degrees, measured rather than guessed: on the built-in courses a
  // ramp starting at 20 turned nearly half the map to rock, because rolling
  // terrain spends a lot of its area between 20 and 40. Above 52 is where the
  // ground stops being driveable and genuinely should read as cliff.
  const rules: TerrainPaintRule[] = [{ layer: 1, by: 'slope', from: 32, to: 52 }];

  const accent = DEFAULT_ACCENT[surface];
  if (accent) {
    layers.push({ texture: accent, scale: 7 });
    // Inverted range: full strength at the road, gone by 26m out.
    rules.push({ layer: 2, by: 'road', from: 26, to: 9, strength: 0.75 });
  }

  return { layers, rules };
}

/** Resolve the paint for a track, falling back to the surface theme. */
export function resolvePaint(surface: string, artwork?: TrackArtwork): TerrainPaint | null {
  if (artwork?.paint && artwork.paint.layers.length > 0) return artwork.paint;
  // An explicit ground image is a deliberate "tile this one thing"; do not
  // second-guess it with a blend.
  if (artwork?.ground) return null;
  return defaultPaint(surface);
}

/**
 * Build the per-vertex weights.
 *
 * Rules are evaluated first and painted weights layered over the top, so an
 * author can paint the parts they care about and let the rules handle the
 * rest rather than having to cover the whole map.
 */
export function buildLayerWeights(paint: TerrainPaint, ctx: PaintContext): LayerWeights {
  const count = ctx.positions.count;
  const weights = new Float32Array(count * MAX_LAYERS);
  const layerCount = Math.min(paint.layers.length, MAX_LAYERS);

  const painted = paint.weights ? decodeWeights(paint.weights, ctx.segments) : null;
  const rules = (paint.rules ?? []).filter(
    (rule) => rule.layer > 0 && rule.layer < layerCount && rule.from !== rule.to,
  );

  for (let i = 0; i < count; i++) {
    const base = i * MAX_LAYERS;

    if (rules.length > 0) {
      const x = ctx.positions.getX(i);
      const z = ctx.positions.getZ(i);
      for (const rule of rules) {
        const value = sampleProperty(rule.by, i, x, z, ctx);
        weights[base + rule.layer] += ramp(value, rule.from, rule.to) * (rule.strength ?? 1);
      }
    }

    if (painted) {
      // Painted channels replace whatever the rules decided for those layers:
      // someone who painted a hillside meant it.
      for (let layer = 1; layer < layerCount && layer <= 3; layer++) {
        const value = painted[i * 3 + (layer - 1)];
        if (value > 0) weights[base + layer] = value;
      }
    }

    // Layer 0 fills whatever the others leave. It has to be the remainder
    // rather than a constant: give it a fixed weight of its own and no layer
    // can ever exceed half the blend, so a cliff at full rock strength still
    // comes out half grass.
    let covered = 0;
    for (let k = 1; k < MAX_LAYERS; k++) covered += weights[base + k];
    weights[base] = Math.max(0, 1 - covered);

    normalise(weights, base);
  }

  return weights;
}

function sampleProperty(
  by: TerrainPaintRule['by'],
  index: number,
  x: number,
  z: number,
  ctx: PaintContext,
): number {
  if (by === 'height') return ctx.heights[index];
  if (by === 'slope') {
    // Vertex normals are unit length, so the Y component is the cosine of the
    // surface angle straight away.
    const up = clamp(ctx.normals.getY(index), -1, 1);
    return Math.acos(up) * (180 / Math.PI);
  }
  return Math.abs(ctx.road.closestTo(x, z).lateral);
}

/**
 * Smooth 0..1 ramp between two bounds, either way round.
 *
 * `from` above `to` runs the ramp backwards, which is how a rule targets low
 * ground or the near side of the road rather than the far side.
 */
function ramp(value: number, from: number, to: number): number {
  if (from < to) return smootherstep(from, to, value);
  return 1 - smootherstep(to, from, value);
}

function normalise(weights: Float32Array, base: number): void {
  let sum = 0;
  for (let k = 0; k < MAX_LAYERS; k++) sum += weights[base + k];
  if (sum <= 1e-6) {
    weights[base] = 1;
    return;
  }
  for (let k = 0; k < MAX_LAYERS; k++) weights[base + k] /= sum;
}

/**
 * Decode painted weights, resampling if they were baked at a different grid
 * resolution than the terrain runs at.
 *
 * Returns three floats per vertex — the weights of layers 1, 2 and 3 — or null
 * if the data does not describe the grid it claims to.
 */
export function decodeWeights(weights: TerrainWeights, segments: number): Float32Array | null {
  let bytes: Uint8Array;
  try {
    const binary = atob(weights.data);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  } catch {
    return null;
  }

  const sourceSegments = weights.segments;
  const row = sourceSegments + 1;
  if (bytes.length !== row * row * 3) return null;

  const target = new Float32Array((segments + 1) ** 2 * 3);
  const scale = sourceSegments / segments;

  for (let iz = 0; iz <= segments; iz++) {
    for (let ix = 0; ix <= segments; ix++) {
      const fx = ix * scale;
      const fz = iz * scale;
      const x0 = Math.min(sourceSegments - 1, Math.floor(fx));
      const z0 = Math.min(sourceSegments - 1, Math.floor(fz));
      const tx = fx - x0;
      const tz = fz - z0;
      const out = (iz * (segments + 1) + ix) * 3;

      for (let channel = 0; channel < 3; channel++) {
        const h00 = bytes[(z0 * row + x0) * 3 + channel];
        const h10 = bytes[(z0 * row + x0 + 1) * 3 + channel];
        const h01 = bytes[((z0 + 1) * row + x0) * 3 + channel];
        const h11 = bytes[((z0 + 1) * row + x0 + 1) * 3 + channel];
        const top = h00 + (h10 - h00) * tx;
        const bottom = h01 + (h11 - h01) * tx;
        target[out + channel] = (top + (bottom - top) * tz) / 255;
      }
    }
  }
  return target;
}

function layerTexture(layer: { texture: string; scale?: number }, pixelated?: boolean): THREE.Texture {
  // A layer names either a built-in surface or an image; a slash or a dot is
  // the giveaway, and it is the same rule the rest of the content pipeline
  // uses for artwork paths.
  const isImage = /[/.]/.test(layer.texture);
  return isImage
    ? imageTexture(layer.texture, { repeatX: 1, repeatY: 1, pixelated })
    : groundTexture(layer.texture, 1);
}

/**
 * Material that blends the layers.
 *
 * Tiling is done in the shader from the terrain's own 0..1 UVs rather than by
 * setting `repeat` on each texture, because the textures are shared and cached
 * across tracks — mutating one track's repeat would change every other track
 * using the same surface.
 */
export function paintMaterial(
  paint: TerrainPaint,
  size: number,
  pixelated?: boolean,
): THREE.MeshLambertMaterial {
  const layers = paint.layers.slice(0, MAX_LAYERS);
  const textures = layers.map((layer) => layerTexture(layer, pixelated));
  // Repeats are in tiles across the whole patch, which is what the UVs are in.
  const repeats = layers.map((layer) => size / Math.max(0.5, layer.scale ?? 8));
  const tints = layers.map((layer) => new THREE.Color(layer.tint ?? '#ffffff'));

  while (textures.length < MAX_LAYERS) {
    textures.push(textures[0]);
    repeats.push(repeats[0]);
    tints.push(new THREE.Color('#ffffff'));
  }

  const material = new THREE.MeshLambertMaterial({
    map: textures[0],
    vertexColors: true,
    flatShading: true,
  });

  const uniforms = {
    layer1: { value: textures[1] },
    layer2: { value: textures[2] },
    layer3: { value: textures[3] },
    layerRepeat: { value: new THREE.Vector4(repeats[0], repeats[1], repeats[2], repeats[3]) },
    layerTint0: { value: tints[0] },
    layerTint1: { value: tints[1] },
    layerTint2: { value: tints[2] },
    layerTint3: { value: tints[3] },
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 layerWeight;
varying vec4 vLayerWeight;
varying vec2 vTerrainUv;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vLayerWeight = layerWeight;
vTerrainUv = uv;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D layer1;
uniform sampler2D layer2;
uniform sampler2D layer3;
uniform vec4 layerRepeat;
uniform vec3 layerTint0;
uniform vec3 layerTint1;
uniform vec3 layerTint2;
uniform vec3 layerTint3;
varying vec4 vLayerWeight;
varying vec2 vTerrainUv;`,
      )
      .replace(
        '#include <map_fragment>',
        `vec4 blended =
    texture2D( map,    vTerrainUv * layerRepeat.x ) * vec4( layerTint0, 1.0 ) * vLayerWeight.x
  + texture2D( layer1, vTerrainUv * layerRepeat.y ) * vec4( layerTint1, 1.0 ) * vLayerWeight.y
  + texture2D( layer2, vTerrainUv * layerRepeat.z ) * vec4( layerTint2, 1.0 ) * vLayerWeight.z
  + texture2D( layer3, vTerrainUv * layerRepeat.w ) * vec4( layerTint3, 1.0 ) * vLayerWeight.w;
diffuseColor *= vec4( blended.rgb, 1.0 );`,
      );
  };

  // Materials with the same program cache key share a compiled program, and
  // ours differs from a stock Lambert, so it needs its own key.
  material.customProgramCacheKey = () => 'mtm-terrain-paint';
  return material;
}
