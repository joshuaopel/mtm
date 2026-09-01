/**
 * Headless smoke test for the web build.
 *
 * `npm run typecheck` proves the code compiles and the Python suite proves
 * the generation maths is right, but neither one ever starts the game. This
 * does: it drives a real browser through the menus, races a lap with the
 * keyboard, opens the debug overlay and pauses — and fails on any console
 * error, page exception or failed request along the way. That is the class
 * of breakage the rest of the tests cannot see, and every one of them lands
 * on the player as a black screen.
 *
 *   npm run smoke               # against a dev server it starts itself
 *   npm run smoke -- --headed   # watch it happen
 *
 * Playwright is not a dependency of the game: nothing a player runs needs a
 * browser download, and `run.bat` staying a single `npm install` is worth
 * more than the convenience here. Install it when you want to run this:
 *
 *   npm install --no-save playwright && npx playwright install chromium
 */
import { createRequire } from 'node:module';
import process from 'node:process';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const HOST = '127.0.0.1';
const PORT = 5199;
const URL = `http://${HOST}:${PORT}/`;
const headed = process.argv.includes('--headed');

let playwright;
try {
  playwright = require('playwright');
} catch {
  console.error(
    'Playwright is not installed. This test drives a real browser, so:\n' +
      '  npm install --no-save playwright && npx playwright install chromium',
  );
  process.exit(2);
}

/**
 * The dev server, because the debug handle the test drives is dev-only.
 *
 * Started through Vite's Node API rather than as a child process: this way
 * the config, the content plugin and the live-reload channel are the real
 * ones, and closing it actually closes it. Spawning `npm run dev` instead
 * leaves the server npm spawned holding the port after the test ends, and
 * the next run fails on a port clash that has nothing to do with the game.
 */
async function startServer() {
  const server = await createServer({
    server: { host: HOST, port: PORT, strictPort: true },
  });
  await server.listen();
  return server;
}

const steps = [];
function step(name) {
  steps.push(name);
  console.log(`  ${name}`);
}

async function run(page, problems) {
  await page.goto(URL, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForFunction(() => Boolean(window.__mtm), null, { timeout: 30_000 });
  step('the game booted');

  const uiText = async () => page.evaluate(() => document.getElementById('ui')?.innerText ?? '');
  const mode = async () => page.evaluate(() => window.__mtm.debugMode());

  if (!(await uiText()).includes('START RACE')) problems.push('the title screen has no START RACE');
  step('title screen is up');

  // Through the menus on the keyboard, the way a player gets there.
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__mtm.debugMode() === 'tracks', null, { timeout: 10_000 });
  step('course list opened');

  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__mtm.debugMode() === 'vehicles', null, { timeout: 10_000 });
  step('truck list opened');

  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__mtm.debugMode() === 'racing', null, { timeout: 60_000 });
  step(`race started on ${await page.evaluate(() => window.__mtm.debugTrackName())}`);

  // A truck that is not on the ground at the start line means the terrain
  // and the physics heightfield disagree — the failure this project cares
  // about most, and one that looks fine in a screenshot.
  const start = await page.evaluate(() => window.__mtm.debugState());
  if (!start) problems.push('the race started with no player');
  else if (Math.abs(start.pos[1] - start.terrainY) > 6) {
    problems.push(`the truck starts ${(start.pos[1] - start.terrainY).toFixed(1)}m off the ground`);
  }
  step('the truck is on the ground');

  // Drive. Steering comes from the game's own racing-line hint, pushed in
  // through the real keyboard path rather than by moving the truck directly,
  // so input, physics, the AI line and progress all get exercised.
  await page.keyboard.down('ArrowUp');
  const held = { ArrowLeft: false, ArrowRight: false };
  for (let i = 0; i < 60; i++) {
    const steer = await page.evaluate(() => window.__mtm.debugPlayerSteerHint());
    const want = steer < -0.12 ? 'ArrowLeft' : steer > 0.12 ? 'ArrowRight' : null;
    for (const key of ['ArrowLeft', 'ArrowRight']) {
      if (want === key && !held[key]) { await page.keyboard.down(key); held[key] = true; }
      if (want !== key && held[key]) { await page.keyboard.up(key); held[key] = false; }
    }
    await page.waitForTimeout(100);
  }
  await page.keyboard.up('ArrowUp');
  for (const key of ['ArrowLeft', 'ArrowRight']) if (held[key]) await page.keyboard.up(key);

  const driven = await page.evaluate(() => window.__mtm.debugState());
  if (!driven || driven.speed < 3) {
    problems.push(`the truck barely moved (${driven ? driven.speed : 'no state'} m/s)`);
  }
  step(`drove at up to ${driven ? driven.speed.toFixed(1) : '?'} m/s`);

  // The debug overlay reads straight out of the physics world, so it is also
  // the check that the physics world has anything in it.
  await page.keyboard.press('F1');
  await page.waitForTimeout(500);
  const overlay = await page.evaluate(() => window.__mtm.debugSessionOverlay());
  if (!overlay || !overlay.visible || overlay.lineSets === 0) {
    problems.push('the F1 debug overlay drew nothing');
  }
  await page.keyboard.press('F1');
  step('debug overlay drew the physics world');

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__mtm.debugMode() === 'paused', null, { timeout: 10_000 });
  if (!(await uiText()).includes('RESUME')) problems.push('the pause menu is missing');
  step('pause menu works');

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__mtm.debugMode() === 'racing', null, { timeout: 10_000 });
  step(`resumed (mode: ${await mode()})`);
}

let server;
let browser;
let failed = false;
const problems = [];

try {
  server = await startServer();
  browser = await playwright.chromium.launch({
    headless: !headed,
    // Set MTM_CHROMIUM to use a browser that is already on the machine —
    // a CI image's system Chromium, say — instead of Playwright's download.
    ...(process.env.MTM_CHROMIUM ? { executablePath: process.env.MTM_CHROMIUM } : {}),
    // Software rendering, so this runs on a machine with no GPU — CI, a
    // container, a headless box. The look is the same, just slower.
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console error: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`uncaught exception: ${error.message}`));
  page.on('requestfailed', (request) =>
    problems.push(`request failed: ${request.url()} (${request.failure()?.errorText})`),
  );
  page.on('response', (response) => {
    if (response.status() >= 400) problems.push(`http ${response.status()}: ${response.url()}`);
  });

  await run(page, problems);
} catch (error) {
  failed = true;
  problems.push(String(error && error.stack ? error.stack : error));
} finally {
  await browser?.close();
  await server?.close();
}

console.log('');
if (problems.length === 0 && !failed) {
  console.log(`SMOKE OK — ${steps.length} checks passed`);
  process.exit(0);
}

console.error('SMOKE FAILED');
for (const problem of problems) console.error(`  - ${problem}`);
process.exit(1);
