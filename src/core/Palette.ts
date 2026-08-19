import * as THREE from 'three';

/**
 * The vehicle colour atlas.
 *
 * A modelled truck wants more than one colour — a red body, a black cage, a
 * chrome bumper, amber lights — but a separate material per part means a draw
 * call per part, which is exactly what the 1996 budget did not have. The
 * period answer, and still the right one, is one texture and one material:
 * every part's faces point at a different cell of a small colour grid.
 *
 * So this is 16 flat colours in a 4x4 sheet. Painting a part means moving its
 * UVs onto a cell, which is what the Blender swatch grid does for you.
 *
 * The engine generates the sheet rather than loading one, and substitutes it
 * for whatever a model happens to ship, so this file is the single source of
 * truth. Retune a colour here and every vehicle ever exported changes with it.
 * `blender/mtm_tools/palette.py` mirrors these values, and the round trip is
 * covered by the Blender tests.
 */

/** Name the Blender exporter gives the palette material. */
export const PALETTE_MATERIAL = 'MTM_Palette';

/** Cells per side. Sixteen colours is the most you can pick from at a glance. */
export const PALETTE_COLUMNS = 4;

/** Pixels per cell. Generous, so nearest filtering never straddles an edge. */
const CELL_PIXELS = 16;

/**
 * Deliberately desaturated. Fully saturated paint reads as plastic against
 * dithered dirt, and the quantiser has only 16 levels per channel to spend —
 * a hot red and a slightly hotter red collapse into the same colour anyway.
 *
 * Ordered by use, not by hue: two rows of bodywork, a row of neutrals, and a
 * row of the materials every truck needs regardless of its livery.
 */
export const PALETTE: readonly string[] = [
  // Bodywork, warm
  '#a8412a', '#c4692a', '#c9a03c', '#7c8342',
  // Bodywork, cool
  '#40663c', '#2f6b6b', '#3c6288', '#6b4560',
  // Neutrals
  '#d8d2c0', '#a8a399', '#6e6a62', '#3a3833',
  // Detail materials
  '#1a1a18', '#6b4f32', '#b8bcc0', '#e8a81c',
];

/** Human names, for the Blender swatch tooltips and the docs. */
export const PALETTE_NAMES: readonly string[] = [
  'Rust Red', 'Burnt Orange', 'Mustard', 'Olive',
  'Forest', 'Teal', 'Steel Blue', 'Plum',
  'Bone', 'Light Grey', 'Mid Grey', 'Charcoal',
  'Tyre Black', 'Leather', 'Chrome', 'Amber',
];

/**
 * UV of a cell's centre, in glTF convention — V measured downward from the
 * top of the image, which is what `GLTFLoader` gives imported meshes.
 *
 * Sampling the centre rather than an edge is what makes the atlas robust:
 * no filter, mip level or UV rounding error can reach a neighbouring colour.
 */
export function cellUv(index: number): [number, number] {
  const i = Math.max(0, Math.min(PALETTE.length - 1, Math.floor(index)));
  const column = i % PALETTE_COLUMNS;
  const row = Math.floor(i / PALETTE_COLUMNS);
  return [
    (column + 0.5) / PALETTE_COLUMNS,
    (row + 0.5) / PALETTE_COLUMNS,
  ];
}

let cached: THREE.Texture | null = null;

/** The atlas, built once and shared by every vehicle in the scene. */
export function paletteTexture(): THREE.Texture {
  if (cached) return cached;

  const size = PALETTE_COLUMNS * CELL_PIXELS;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.imageSmoothingEnabled = false;

  PALETTE.forEach((colour, i) => {
    ctx.fillStyle = colour;
    ctx.fillRect(
      (i % PALETTE_COLUMNS) * CELL_PIXELS,
      Math.floor(i / PALETTE_COLUMNS) * CELL_PIXELS,
      CELL_PIXELS,
      CELL_PIXELS,
    );
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  // Imported UVs come from glTF, whose V axis runs downward. A canvas texture
  // defaults to flipY, which would mirror the sheet vertically and hand every
  // part the colour from the opposite row.
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  cached = texture;
  return texture;
}

export function disposePalette(): void {
  cached?.dispose();
  cached = null;
}
