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

/**
 * A readable failure, served over our own scheme.
 *
 * The alternative when something goes wrong before the game loads is the
 * Electron default: a black window with no text in it, indistinguishable
 * from a hang. This is deliberately plain HTML with no dependency on the
 * bundle, since a missing bundle is one of the things it has to report.
 */
function errorPage(title, message) {
  const escape = (text) =>
    String(text).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Monster Truck Mania</title>
<style>
  html,body{height:100%;margin:0;background:#14140f;color:#e8e4d0;
    font-family:'Courier New',monospace;letter-spacing:1px}
  div{height:100%;display:flex;flex-direction:column;align-items:center;
    justify-content:center;gap:16px;padding:32px;text-align:center}
  h1{margin:0;color:#ffb020;font-size:26px;letter-spacing:5px;text-transform:uppercase}
  p{margin:0;max-width:60ch;line-height:1.7}
</style></head>
<body><div><h1>${escape(title)}</h1><p>${escape(message)}</p></div></body></html>`;
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html', 'cache-control': 'no-cache' },
  });
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
  try {
    return await route(request);
  } catch (error) {
    // A throw here is a failed fetch in the page with no explanation
    // anywhere. Log it and answer, so at least something is on screen.
    console.error('[mtm] failed to serve', request.url, error);
    return new Response(`internal error: ${error}`, {
      status: 500,
      headers: { 'content-type': 'text/plain' },
    });
  }
}

async function route(request) {
  const url = new URL(request.url);
  if (url.host !== HOST) return notFound('unknown host');

  if (url.pathname === '/__error') {
    return errorPage(
      url.searchParams.get('title') ?? 'Something went wrong',
      url.searchParams.get('message') ?? '',
    );
  }

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

  /**
   * Anything that stops the page loading.
   *
   * The usual cause is running the shell without building first, so `dist/`
   * is not there — and the custom protocol answers the request either way,
   * which turns "you forgot npm run build" into a black window. Say so.
   */
  win.webContents.on('did-fail-load', (_event, code, description, failedUrl, isMainFrame) => {
    if (!isMainFrame) return;
    console.error(`[mtm] could not load ${failedUrl}: ${description} (${code})`);
    void win.loadURL(errorUrl('The game did not load', `${description} (${code})`));
  });

  // A renderer that dies takes the picture with it and leaves the window up.
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[mtm] the game process stopped: ${details.reason}`);
    void win.loadURL(
      errorUrl('The game stopped', `The game process ended unexpectedly (${details.reason}).`),
    );
  });

  if (!fs.existsSync(path.join(BUNDLE, 'index.html'))) {
    console.error(`[mtm] no build found at ${BUNDLE}`);
    void win.loadURL(
      errorUrl(
        'No build found',
        'The game has not been built yet. Run "npm run build" and start it again.',
      ),
    );
    return win;
  }

  void win.loadURL(`${SCHEME}://${HOST}/index.html`);
  return win;
}

/** URL of the built-in error page, with its text in the query string. */
function errorUrl(title, message) {
  const params = new URLSearchParams({ title, message });
  return `${SCHEME}://${HOST}/__error?${params.toString()}`;
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

  app
    .whenReady()
    .then(() => {
      protocol.handle(SCHEME, handle);
      createWindow();

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    })
    .catch((error) => {
      // Nothing has a window yet, so there is nowhere to draw a message —
      // print it and exit non-zero rather than sitting there doing nothing.
      console.error('[mtm] could not start:', error);
      app.exit(1);
    });

  app.on('window-all-closed', () => app.quit());
}
