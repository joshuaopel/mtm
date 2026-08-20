/**
 * Desktop shell.
 *
 * The same `dist/` the browser build produces, wrapped in Electron so it
 * ships as an executable — one artifact that runs on a desktop and on a
 * Steam Deck, since the Deck is an x86-64 Linux PC.
 *
 * Two things this has to get right that a plain `loadFile` would not:
 *
 *   1. The game fetches its content at startup, and `fetch()` is blocked on
 *      `file://`. So the app is served over a custom scheme registered as
 *      standard + secure, which gives the page a real origin and makes fetch
 *      behave exactly as it does over HTTP — with no socket open.
 *
 *   2. Dropping a track into a folder is how content works everywhere else in
 *      this project, and burying `content/` inside an asar archive would take
 *      that away. The handler looks in a writable folder beside the game
 *      first and falls back to the bundled copy, and it rebuilds the content
 *      index by listing that folder, so a file dropped in is found without a
 *      rebuild.
 */
const { app, BrowserWindow, protocol, shell } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const SCHEME = 'mtm';
/** Host part of the URL. Only this one is served. */
const HOST = 'app';

/**
 * Must run before `app.ready`, which is why it is at module scope.
 *
 * `standard` gives the scheme URL semantics (origins, relative paths);
 * `secure` puts it in a secure context so it is not treated as untrusted;
 * `supportFetchAPI` is the one that makes the content loading work at all.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.gltf': 'model/gltf+json',
  '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.txt': 'text/plain',
};

/**
 * Files bundled with the app: the Vite build, read-only, possibly in an asar.
 *
 * Resolved from this file rather than from `app.getAppPath()`, which is only
 * the project root when Electron was pointed at a directory. Launched as
 * `electron electron/main.cjs` it returns the directory holding the script,
 * and every bundled path silently 404s — with the custom protocol still
 * answering, so you get a blank window and no error worth the name.
 */
const APP_ROOT = path.join(__dirname, '..');
const BUNDLE = path.join(APP_ROOT, 'dist');

/**
 * Where a player drops their own tracks, trucks and music.
 *
 * Beside the executable, so it is somewhere you can actually find on a Deck
 * without going hunting through hidden folders. In development there is no
 * packaged executable, so fall back to the repo's own content folder.
 */
function externalContentDir() {
  if (!app.isPackaged) return path.join(APP_ROOT, 'public', 'content');
  // resources/app.asar -> the folder holding the executable.
  return path.join(path.dirname(app.getPath('exe')), 'content');
}

const EXTERNAL = externalContentDir();

function notFound(message) {
  return new Response(message, { status: 404, headers: { 'content-type': 'text/plain' } });
}

async function fileResponse(absolute) {
  const body = await fsp.readFile(absolute);
  const type = MIME[path.extname(absolute).toLowerCase()] ?? 'application/octet-stream';
  return new Response(body, {
    status: 200,
    headers: { 'content-type': type, 'cache-control': 'no-cache' },
  });
}

/**
 * Merge the bundled content index with whatever is sitting in the external
 * folder, so a dropped-in file is picked up without rebuilding.
 *
 * Classified by the same suffixes the Vite plugin uses, so the two agree.
 */
async function contentIndex() {
  let index = { tracks: [], vehicles: [], music: [], manifest: false };
  try {
    const bundled = await fsp.readFile(path.join(BUNDLE, 'content', 'index.json'), 'utf8');
    index = { ...index, ...JSON.parse(bundled) };
  } catch {
    // No bundled index is fine: the built-in tracks are compiled in.
  }

  const music = ['.mp3', '.ogg', '.m4a', '.wav', '.opus', '.flac'];
  let entries = [];
  try {
    entries = await fsp.readdir(EXTERNAL);
  } catch {
    return index; // No drop-in folder yet.
  }

  const add = (list, name) => {
    if (!list.includes(name)) list.push(name);
  };
  for (const name of entries) {
    if (name.endsWith('.mtmtrack.json')) add(index.tracks, name);
    else if (name.endsWith('.mtmvehicle.json')) add(index.vehicles, name);
    else if (music.includes(path.extname(name).toLowerCase())) add(index.music, name);
  }
  return index;
}

/**
 * Resolve a request path to a file, refusing anything that climbs out of the
 * directories we are willing to serve.
 */
function safeJoin(root, relative) {
  const absolute = path.resolve(root, relative);
  const base = path.resolve(root);
  return absolute === base || absolute.startsWith(base + path.sep) ? absolute : null;
}

async function handle(request) {
  const url = new URL(request.url);
  if (url.host !== HOST) return notFound('unknown host');

  let relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  if (relative === '') relative = 'index.html';

  // The index is generated rather than served, so drop-in files appear.
  if (relative === 'content/index.json') {
    return new Response(JSON.stringify(await contentIndex()), {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-cache' },
    });
  }

  // Player content wins over the bundled copy, so a dropped-in file can
  // replace a shipped one by name.
  if (relative.startsWith('content/')) {
    const external = safeJoin(EXTERNAL, relative.slice('content/'.length));
    if (external && fs.existsSync(external)) return fileResponse(external);
  }

  const bundled = safeJoin(BUNDLE, relative);
  if (!bundled) return notFound('outside the app');
  try {
    return await fileResponse(bundled);
  } catch {
    return notFound(`no such file: ${relative}`);
  }
}

function createWindow() {
  const windowed = process.argv.includes('--windowed');

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    // The Deck's panel is 1280x800; starting fullscreen means Gaming Mode
    // never shows a title bar to fight with a controller.
    fullscreen: !windowed,
    backgroundColor: '#000000',
    show: false,
    autoHideMenuBar: true,
    title: 'Monster Truck Mania',
    webPreferences: {
      // The game is ordinary web code and wants none of Node, so it does not
      // get any of it.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      // Nearest-neighbour upscaling of the low-res target is the whole look.
      // Leave the page in charge of it rather than letting the compositor
      // smooth it.
      spellcheck: false,
    },
  });

  win.removeMenu();
  win.once('ready-to-show', () => win.show());

  // Escape is the game's pause key. Leaving the default fullscreen exit
  // bound to it would drop a player out of fullscreen every time they
  // paused, so fullscreen is toggled with F11 only.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });

  // Nothing in the game opens a window; if something ever does, it goes to
  // the real browser rather than an unchromed Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  void win.loadURL(`${SCHEME}://${HOST}/index.html`);
  return win;
}

/**
 * One instance only: two copies fighting over the same window is never what
 * anyone wanted, and Steam can be enthusiastic about launch requests.
 *
 * The lock is a file in the user data directory, so asking for it can fail
 * outright on a system where that directory is not writable. Treat that as
 * "no other instance" rather than letting it decide the game does not start:
 * refusing to launch, with nothing on screen, is far worse than the risk of
 * a second window.
 */
function haveSingleInstanceLock() {
  try {
    return app.requestSingleInstanceLock();
  } catch (error) {
    console.warn('[mtm] could not take the single-instance lock:', error);
    return true;
  }
}

if (!haveSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  void app.whenReady().then(() => {
    protocol.handle(SCHEME, handle);
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => app.quit());
}
