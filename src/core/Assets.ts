import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * glTF model loading and caching.
 *
 * This is what lets tracks and vehicles use real modelled geometry instead of
 * the procedural primitives. Blender's glTF exporter already converts from
 * Z-up to the Y-up convention the game uses, so models arrive in game space
 * with no fixing up needed on this side.
 *
 * Models are cached by URL and handed out as clones, because the same wheel
 * mesh gets instanced four times per truck and the same truck can appear
 * several times in one race.
 */

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group>>();

/**
 * Bumped whenever the cache is cleared for a live reload, and appended to
 * request URLs. Without it the browser's own HTTP cache serves the old model
 * back and an edited file appears not to have changed.
 */
let cacheEpoch = 0;

/**
 * Materials arriving from glTF are physically-based, which looks wrong next
 * to the flat-shaded procedural geometry and costs more to draw. Swapping
 * them for Lambert keeps imported models in the same visual language as
 * everything else, and keeps them responding to the same simple lighting.
 */
function retroifyMaterials(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;

    const source = Array.isArray(child.material) ? child.material : [child.material];
    const converted = source.map((material) => {
      const standard = material as THREE.MeshStandardMaterial;
      const lambert = new THREE.MeshLambertMaterial({
        color: standard.color ?? new THREE.Color(0xffffff),
        map: standard.map ?? null,
        transparent: standard.transparent,
        opacity: standard.opacity,
        side: standard.side,
        // Flat shading is the single biggest contributor to the period look.
        flatShading: true,
      });

      // Imported textures are usually big and smooth; nearest filtering drags
      // them back towards the chunky look of the built-in ones.
      if (lambert.map) {
        lambert.map.magFilter = THREE.NearestFilter;
        lambert.map.minFilter = THREE.NearestMipmapLinearFilter;
        lambert.map.needsUpdate = true;
      }
      return lambert;
    });

    child.material = converted.length === 1 ? converted[0] : converted;
    child.castShadow = false;
    child.receiveShadow = false;
  });
}

/** Load a glTF/glb, cached by URL. The returned group is the shared original. */
function loadShared(url: string): Promise<THREE.Group> {
  const existing = cache.get(url);
  if (existing) return existing;

  const requestUrl = cacheEpoch === 0 ? url : `${url}?v=${cacheEpoch}`;
  const promise = new Promise<THREE.Group>((resolve, reject) => {
    loader.load(
      requestUrl,
      (gltf) => {
        retroifyMaterials(gltf.scene);
        resolve(gltf.scene);
      },
      undefined,
      (error) => reject(new Error(`failed to load model "${url}": ${error}`)),
    );
  });

  cache.set(url, promise);
  return promise;
}

/**
 * Load a model and return a private copy, safe to transform and dispose
 * without disturbing other users of the same file.
 */
export async function loadModel(url: string): Promise<THREE.Group> {
  const shared = await loadShared(url);
  return shared.clone(true);
}

/**
 * Load several models at once, tolerating failures.
 *
 * A missing or broken model must never stop a race from starting — the
 * caller falls back to procedural geometry — so failures are reported and
 * skipped rather than thrown.
 */
export async function loadModels(
  urls: readonly string[],
): Promise<{ models: Map<string, THREE.Group>; warnings: string[] }> {
  const unique = [...new Set(urls.filter(Boolean))];
  const models = new Map<string, THREE.Group>();
  const warnings: string[] = [];

  const results = await Promise.allSettled(unique.map((url) => loadModel(url)));
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') models.set(unique[index], result.value);
    else warnings.push(String(result.reason));
  });

  return { models, warnings };
}

/** Find a named node, case-insensitively, anywhere under a model. */
export function findNode(root: THREE.Object3D, name: string): THREE.Object3D | null {
  const wanted = name.toLowerCase();
  let found: THREE.Object3D | null = null;
  root.traverse((child) => {
    if (found) return;
    if (child.name.toLowerCase() === wanted) found = child;
  });
  return found;
}

/**
 * Detach a node from its parent while keeping its world transform, so it can
 * be re-parented into the game's own hierarchy without jumping.
 */
export function extractNode(root: THREE.Object3D, name: string): THREE.Object3D | null {
  const node = findNode(root, name);
  if (!node) return null;
  root.updateMatrixWorld(true);
  node.removeFromParent();
  return node;
}

/** Release GPU resources held by a model built from glTF. */
export function disposeModel(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) material.dispose();
  });
}

/**
 * Forget every cached model so the next load re-fetches from disk. Used by
 * live reload; the epoch bump defeats the browser's HTTP cache too.
 */
export function clearModelCache(): void {
  cache.clear();
  cacheEpoch += 1;
}
