import fs from 'node:fs';
import path from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';

/**
 * Drop-in content discovery.
 *
 * Scans `public/content/` and serves the result at `content/index.json`, so
 * adding a track or a truck is "put the file in the folder" rather than
 * "put the file in the folder and remember to edit a manifest". The manifest
 * is still honoured when present — it just isn't required any more.
 *
 * In dev this is a middleware, so the listing is always current. For a
 * production build the same listing is written to disk during `closeBundle`.
 * The two paths share `scanContent` so they cannot drift.
 */

const CONTENT_DIR = 'public/content';
const INDEX_FILE = 'index.json';

/** Audio the browser can stream. Ogg is included for Firefox-first authors. */
const MUSIC_EXTENSIONS = ['.mp3', '.ogg', '.m4a', '.wav', '.opus', '.flac'];

export interface ContentIndex {
  tracks: string[];
  vehicles: string[];
  /** Any audio file found, used as background music. */
  music: string[];
  /** Set when a hand-written manifest.json was found and merged. */
  manifest: boolean;
  generatedAt: string;
}

/** Recognise content by filename, which is what the exporters produce. */
function classify(name: string): 'track' | 'vehicle' | 'music' | null {
  if (name.endsWith('.mtmtrack.json')) return 'track';
  if (name.endsWith('.mtmvehicle.json')) return 'vehicle';
  // Music needs no naming convention: drop a song in and it plays.
  const lower = name.toLowerCase();
  if (MUSIC_EXTENSIONS.some((ext) => lower.endsWith(ext))) return 'music';
  return null;
}

export function scanContent(root: string): ContentIndex {
  const dir = path.resolve(root, CONTENT_DIR);
  const index: ContentIndex = {
    tracks: [],
    vehicles: [],
    music: [],
    manifest: false,
    generatedAt: new Date().toISOString(),
  };

  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    // No content directory at all is a perfectly normal state.
    return index;
  }

  for (const entry of entries.sort()) {
    const kind = classify(entry);
    if (kind === 'track') index.tracks.push(entry);
    else if (kind === 'vehicle') index.vehicles.push(entry);
    else if (kind === 'music') index.music.push(entry);
  }

  // A hand-written manifest can add files that don't follow the naming
  // convention. It extends the scan rather than replacing it, so dropping in
  // a conventionally-named file always works even if a manifest exists.
  const manifestPath = path.join(dir, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
        tracks?: string[];
        vehicles?: string[];
        music?: string[];
      };
      index.manifest = true;
      for (const file of raw.tracks ?? []) {
        if (!index.tracks.includes(file)) index.tracks.push(file);
      }
      for (const file of raw.vehicles ?? []) {
        if (!index.vehicles.includes(file)) index.vehicles.push(file);
      }
      for (const file of raw.music ?? []) {
        if (!index.music.includes(file)) index.music.push(file);
      }
    } catch (error) {
      console.warn(`[content] manifest.json is not valid JSON, ignoring it: ${error}`);
    }
  }

  return index;
}

export function contentPlugin(): Plugin {
  let root = process.cwd();

  return {
    name: 'mtm-content-index',

    configResolved(config) {
      root = config.root;
    },

    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        if (!req.url) return next();
        const url = req.url.split('?')[0];
        if (url !== `/content/${INDEX_FILE}` && url !== `content/${INDEX_FILE}`) return next();

        // Rescanned per request: the whole point is that a file dropped in
        // while the server is running shows up without a restart.
        const index = scanContent(root);
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(index));
      });

      // Tell the page when content changes so it can reload without an F5.
      const contentDir = path.resolve(root, CONTENT_DIR);
      server.watcher.add(contentDir);

      const notify = (file: string): void => {
        if (!file.startsWith(contentDir)) return;
        const name = path.basename(file);
        if (!classify(name) && !name.endsWith('.glb') && !name.endsWith('.gltf')) return;
        server.ws.send({ type: 'custom', event: 'mtm:content-changed', data: { file: name } });
        console.log(`[content] ${name} changed`);
      };

      server.watcher.on('add', notify);
      server.watcher.on('change', notify);
      server.watcher.on('unlink', notify);
    },

    /**
     * Bake the listing into the build. `public/` is copied verbatim by Vite,
     * so writing into the output directory after the copy is what makes the
     * generated index survive.
     */
    closeBundle() {
      const index = scanContent(root);
      const outDir = path.resolve(root, 'dist', 'content');
      try {
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, INDEX_FILE), JSON.stringify(index, null, 2));
        console.log(
          `[content] indexed ${index.tracks.length} track(s), ${index.vehicles.length} vehicle(s) ` +
            `and ${index.music.length} music file(s)`,
        );
      } catch (error) {
        console.warn(`[content] could not write the content index: ${error}`);
      }
    },
  };
}
