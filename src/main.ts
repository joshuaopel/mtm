import './style.css';
import * as THREE from 'three';
import { RetroRenderer, type DetailLevel } from './core/RetroRenderer';
import { Input } from './core/Input';
import { EngineAudio } from './core/Audio';
import { RaceSession, collectModelUrls } from './game/RaceSession';
import { Showroom } from './game/Showroom';
import { Hud } from './ui/Hud';
import { Telemetry } from './ui/Telemetry';
import {
  ControlsScreen,
  type MusicState,
  LoadingScreen,
  PauseScreen,
  ResultsScreen,
  TitleScreen,
  TrackSelectScreen,
  VehicleSelectScreen,
} from './ui/screens';
import type { Screen } from './ui/Screen';
import { showErrorPanel } from './ui/ErrorPanel';
import { TRACKS } from './data/tracks';
import { VEHICLES } from './data/vehicles';
import { loadContent } from './game/ContentLoader';
import { MusicPlayer } from './core/Music';
import { loadModels, clearModelCache } from './core/Assets';
import type { MTMTrack, MTMVehicle } from './game/formats';
import type { Difficulty } from './game/AIDriver';

type Mode = 'title' | 'tracks' | 'vehicles' | 'loading' | 'racing' | 'paused' | 'results' | 'controls';

/**
 * Application shell: owns the renderer, input, audio and the screen stack,
 * and decides what gets simulated and drawn each frame.
 */
class Game {
  private renderer: RetroRenderer;
  private input = new Input();
  private audio = new EngineAudio();
  private music = new MusicPlayer();
  private showroom: Showroom;
  private hud = new Hud();
  private telemetry = new Telemetry();
  /** Debug overlay state, kept here so it survives a race restart. */
  private debugVisible = false;

  private uiRoot: HTMLElement;
  private screen: Screen | null = null;
  private mode: Mode = 'title';

  private session: RaceSession | null = null;
  /**
   * Built-in roster plus anything the Blender add-on exported into
   * `public/content/`. Replaced once the manifest resolves.
   */
  private tracks: MTMTrack[] = TRACKS;
  private vehicles: MTMVehicle[] = VEHICLES;
  private selectedTrack: MTMTrack = TRACKS[0];
  private selectedVehicle: MTMVehicle = VEHICLES[0];
  private difficulty: Difficulty = 'pro';
  private opponents = 5;

  private lastFrame = performance.now();
  /** Set once the loop has given up, so nothing schedules another frame. */
  private stopped = false;
  private detail: DetailLevel = 'lo';
  /**
   * HUD size multiplier.
   *
   * The interface is sized in CSS pixels, which is right on a monitor and
   * small on a 7-inch handheld held at arm's length — same pixel count, a
   * third of the physical size. This scales the chrome without touching the
   * 3D, which has its own resolution setting.
   */
  private uiScale = 1;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.uiRoot = uiRoot;
    this.renderer = new RetroRenderer(canvas);
    this.renderer.setDetail(this.detail);
    this.showroom = new Showroom(1);

    this.input.attach();
    this.resize();
    window.addEventListener('resize', () => this.resize());

    // Browsers only allow audio to start from a user gesture. Listening
    // once was wrong: if the first gesture cannot start the context — the
    // tab is still in the background, or the device is out of audio
    // contexts — the listener is gone and the game is silent for the rest
    // of the session. Keep trying until one gesture works.
    const unlock = (): void => {
      this.audio.unlock().then(
        () => {
          window.removeEventListener('keydown', unlock);
          window.removeEventListener('pointerdown', unlock);
        },
        (error: unknown) => console.warn('[audio] could not start audio yet', error),
      );
      this.music.unlock();
    };
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);

    this.watchGraphicsContext(canvas);

    this.showTitle();
    requestAnimationFrame(this.frame);
    void this.loadCustomContent();
    this.attachLiveReload();

    // Debug handle for the dev server only, used by the smoke tests to
    // inspect simulation state without reaching through the UI.
    if (import.meta.env.DEV) {
      (window as unknown as { __mtm?: Game }).__mtm = this;
    }
  }

  /**
   * Merge in anything exported from the Blender add-on. Runs in the
   * background so the title screen is interactive immediately; the select
   * screens read the roster when they are opened, by which point this has
   * almost always finished.
   */
  private async loadCustomContent(): Promise<void> {
    try {
      const content = await loadContent();
      this.tracks = content.tracks;
      this.vehicles = content.vehicles;
      this.music.setPlaylist(content.music);
      if (content.music.length > 0) this.music.request();
      for (const warning of content.warnings) console.warn(`[content] ${warning}`);

      const added = content.tracks.length - TRACKS.length + (content.vehicles.length - VEHICLES.length);
      if (added > 0) console.info(`[content] loaded ${added} custom item(s)`);
      if (content.music.length > 0) {
        console.info(`[content] ${content.music.length} music file(s) found`);
      }
    } catch (error) {
      console.warn('[content] custom content failed to load', error);
    }
  }

  /**
   * A lost WebGL context.
   *
   * The GPU can take its context away at any time — a driver reset, a laptop
   * waking from sleep, another tab being greedy — and the default browser
   * behaviour is to leave every GL object dead while the page carries on
   * calling into them. That renders as a frozen or black screen with a
   * console full of three.js warnings and nothing else.
   *
   * Preventing the default on the loss event tells the browser we would like
   * it back; if it comes back the cleanest thing to do is reload, because the
   * scene's textures, buffers and render targets all died with the old
   * context and rebuilding them piecemeal is how you get half-invisible
   * geometry. Either way the player is told what happened.
   */
  private watchGraphicsContext(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.stopped = true;
      console.warn('[renderer] the graphics context was lost');
      showErrorPanel(this.uiRoot, {
        title: 'GRAPHICS RESET',
        message:
          'The graphics driver took the display context back. Reload the page to carry on.',
        action: { label: 'RELOAD', onSelect: () => window.location.reload() },
      });
    });

    canvas.addEventListener('webglcontextrestored', () => {
      console.info('[renderer] the graphics context came back');
    });
  }

  /**
   * Live reload, dev server only.
   *
   * The Vite content plugin watches `public/content/` and pings us when a
   * track, vehicle or model file changes. Editing a track and seeing it
   * without leaving the game is the single biggest saving in the authoring
   * loop — the alternative is export, alt-tab, reselect, wait for the
   * countdown, every time.
   */
  private attachLiveReload(): void {
    if (!import.meta.hot) return;
    import.meta.hot.on('mtm:content-changed', (data: { file?: string }) => {
      void this.hotReloadContent(data?.file);
    });
    console.info('[content] live reload active — edit files in public/content/');
  }

  private async hotReloadContent(file?: string): Promise<void> {
    // Models are cached by URL, so an edited .glb would otherwise be ignored.
    clearModelCache();
    await this.loadCustomContent();

    // Re-resolve the current selections against the freshly loaded lists, so
    // editing the track you are sitting on picks up the new version rather
    // than a stale object with the same name.
    this.selectedTrack =
      this.tracks.find((t) => t.id === this.selectedTrack.id) ?? this.tracks[0];
    this.selectedVehicle =
      this.vehicles.find((v) => v.id === this.selectedVehicle.id) ?? this.vehicles[0];

    const label = file ? `${file} reloaded` : 'content reloaded';

    switch (this.mode) {
      case 'racing':
      case 'paused':
        // Rebuild the race in place. Restarting is the honest option: track
        // geometry and physics bodies are built once at construction, so
        // there is no way to swap them under a running simulation.
        await this.startRace();
        this.session?.flash(label.toUpperCase(), 2.2);
        break;
      case 'tracks':
        this.showTrackSelect();
        break;
      case 'vehicles':
        this.showVehicleSelect();
        break;
      case 'title':
        this.showroom.setVehicle(this.selectedVehicle);
        break;
      default:
        break;
    }
    console.info(`[content] ${label}`);
  }

  /**
   * Steering the racing line would ask for, in player units. Used by the
   * automated tests to drive a lap through the real keyboard input path.
   */
  debugPlayerSteerHint(): number {
    const session = this.session;
    const vehicle = session?.race.player?.vehicle;
    if (!session || !vehicle) return 0;

    const road = session.track.road;
    const query = road.closestTo(vehicle.position.x, vehicle.position.z);
    const lookahead = Math.round((14 + Math.max(0, vehicle.forwardSpeed) * 0.6) / road.step);
    const target = road.pointAt(query.index + lookahead);

    const toTarget = new THREE.Vector3(
      target.x - vehicle.position.x,
      0,
      target.z - vehicle.position.z,
    ).normalize();
    const forward = vehicle.forwardVector();
    forward.y = 0;
    forward.normalize();

    const cross = forward.x * toTarget.z - forward.z * toTarget.x;
    const dot = Math.max(-1, Math.min(1, forward.dot(toTarget)));
    return Math.max(-1, Math.min(1, Math.atan2(cross, dot) * 1.6));
  }

  /** Checkpoint geometry and per-racer gate distances, for debugging. */
  debugGates(): unknown {
    const session = this.session;
    if (!session) return null;
    const gates = session.track.checkpoints;
    return {
      count: gates.length,
      roadLength: +session.track.road.length.toFixed(1),
      first3: gates.slice(0, 3).map((g) => ({
        i: g.index,
        pos: [+g.position.x.toFixed(1), +g.position.y.toFixed(1), +g.position.z.toFixed(1)],
        halfWidth: +g.halfWidth.toFixed(1),
        roadDistance: +g.roadDistance.toFixed(1),
      })),
      racers: session.race.racers.map((r) => {
        const g = gates[r.nextCheckpoint];
        const p = r.vehicle.position;
        return {
          n: r.name,
          cp: r.nextCheckpoint,
          dist: +Math.hypot(p.x - g.position.x, p.z - g.position.z).toFixed(1),
          dy: +Math.abs(p.y - g.position.y).toFixed(1),
          need: +g.halfWidth.toFixed(1),
        };
      }),
    };
  }

  /** Debug overlay state, for the automated tests. */
  debugSessionOverlay(): unknown {
    const overlay = this.session?.debug;
    if (!overlay) return null;
    let lines = 0;
    overlay.group.traverse((o) => {
      if ((o as { isLineSegments?: boolean }).isLineSegments) lines++;
    });
    return { visible: overlay.visible, children: overlay.group.children.length, lineSets: lines };
  }

  /** Name of the loaded track, for debugging. */
  debugTrackName(): string {
    return this.session?.setup.track.name ?? this.selectedTrack.name;
  }

  /** Total laps of the running race, for debugging. */
  debugTotalLaps(): number | null {
    return this.session?.race.totalLaps ?? null;
  }

  /** Current screen mode, for debugging. */
  debugMode(): string {
    return this.mode;
  }

  /** Shorten the race, so tests can reach the finish. */
  debugSetLaps(laps: number): void {
    const race = this.session?.race as { totalLaps: number } | undefined;
    if (race) race.totalLaps = laps;
  }

  /** Physics world, for debugging. */
  debugWorld(): unknown {
    return this.session?.track.world;
  }

  /** Terrain collision body, for debugging. */
  debugTerrainBody(): unknown {
    return this.session?.track.terrain.body;
  }

  /** All racers, for debugging. */
  debugRacers(): unknown[] {
    return this.session?.race.racers ?? [];
  }

  /** Per-wheel suspension state, for debugging. */
  debugPlayerWheels(): number[] {
    const v = this.session?.race.player?.vehicle;
    if (!v) return [];
    return v.raycast.wheelInfos.map((w) => +w.suspensionLength.toFixed(2));
  }

  /** Simulation snapshot, for debugging. */
  debugState(): Record<string, unknown> | null {
    const session = this.session;
    const player = session?.race.player;
    if (!session || !player) return null;
    const v = player.vehicle;
    return {
      mode: this.mode,
      phase: session.race.phase,
      pos: [v.position.x, v.position.y, v.position.z].map((n) => +n.toFixed(2)),
      vel: [v.chassis.velocity.x, v.chassis.velocity.y, v.chassis.velocity.z].map((n) => +n.toFixed(2)),
      speed: +v.speed.toFixed(2),
      forwardSpeed: +v.forwardSpeed.toFixed(2),
      grounded: v.groundedWheels,
      upright: +v.uprightness.toFixed(2),
      terrainY: +session.track.terrain.heightAt(v.position.x, v.position.z).toFixed(2),
      angVel: +Math.hypot(
        v.chassis.angularVelocity.x,
        v.chassis.angularVelocity.y,
        v.chassis.angularVelocity.z,
      ).toFixed(2),
    };
  }

  private resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.resize(width, height);
    this.showroom.setAspect(this.renderer.aspect);
    this.session?.setAspect(this.renderer.aspect);
  }

  /** Push the HUD size into the stylesheet variable everything reads. */
  private applyUiScale(): void {
    document.documentElement.style.setProperty('--ui-scale', String(this.uiScale));
  }

  private setScreen(screen: Screen | null, mode: Mode): void {
    this.screen?.onUnmount?.();
    this.uiRoot.replaceChildren();
    this.screen = screen;
    this.mode = mode;
    if (screen) {
      this.uiRoot.append(screen.root);
      screen.onMount?.();
    }
    // Drop any queued edges so the keypress that opened a screen doesn't
    // immediately activate something on it.
    this.input.flush();
  }

  /* --- screens --------------------------------------------------------- */

  private showTitle(): void {
    this.disposeSession();
    this.showroom.setVehicle(this.selectedVehicle);
    this.showroom.setSubjectOffset(0);
    this.setScreen(
      new TitleScreen({
        onRace: () => this.showTrackSelect(),
        onControls: () => this.showControls(),
      }),
      'title',
    );
  }

  private showControls(): void {
    this.setScreen(
      new ControlsScreen(this.detail, this.uiScale, this.audio.isMuted, this.musicState(), {
        onBack: () => this.showTitle(),
        onDetailChange: (detail) => {
          this.detail = detail;
          this.renderer.setDetail(detail);
          this.resize();
        },
        onUiScaleChange: (scale) => {
          this.uiScale = scale;
          this.applyUiScale();
        },
        onToggleMute: () => {
          this.audio.setMuted(!this.audio.isMuted);
          return this.audio.isMuted;
        },
        onToggleMusic: () => {
          this.music.setEnabled(!this.music.isEnabled);
          return this.musicState();
        },
        onCycleMusicVolume: () => {
          // Four steps rather than a slider: the menu is driven by a
          // d-pad, and a continuous control is miserable to nudge.
          const steps = [0, 0.25, 0.55, 0.85];
          const next = steps[(steps.findIndex((v) => v >= this.music.getVolume() - 1e-6) + 1) % steps.length];
          this.music.setVolume(next);
          return this.musicState();
        },
      }),
      'controls',
    );
  }

  /** What the Controls screen needs to label its music rows. */
  private musicState(): MusicState {
    return {
      available: this.music.hasMusic,
      enabled: this.music.isEnabled,
      volume: this.music.getVolume(),
    };
  }

  private showTrackSelect(): void {
    this.disposeSession();
    this.setScreen(
      new TrackSelectScreen(this.tracks, {
        onPick: (track) => {
          this.selectedTrack = track;
          this.showVehicleSelect();
        },
        onBack: () => this.showTitle(),
      }),
      'tracks',
    );
  }

  private showVehicleSelect(): void {
    this.showroom.setVehicle(this.selectedVehicle);
    // Park the truck on the right so the stat panel doesn't cover it.
    this.showroom.setSubjectOffset(-3.4);
    this.setScreen(
      new VehicleSelectScreen(this.vehicles, {
        onPick: (vehicle, difficulty, opponents) => {
          this.selectedVehicle = vehicle;
          this.difficulty = difficulty;
          this.opponents = opponents;
          void this.startRace();
        },
        onBack: () => this.showTrackSelect(),
        onPreview: (vehicle) => {
          this.selectedVehicle = vehicle;
          this.showroom.setVehicle(vehicle);
        },
      }),
      'vehicles',
    );
  }

  /**
   * Build the race. Track construction is heavy (terrain, collision, scatter)
   * so we show a loading screen and yield to the browser before doing it,
   * otherwise the screen never paints.
   */
  private async startRace(): Promise<void> {
    const loading = new LoadingScreen(this.selectedTrack.name);
    this.setScreen(loading, 'loading');
    try {
      await this.buildRace(loading);
    } catch (error) {
      // Anything that escapes the build — a model fetch that rejects, a
      // track whose numbers make the generator throw — used to become an
      // unhandled rejection and leave the player on a loading screen that
      // never finished. Report it and give them the course list back.
      console.error('[race] failed to start', error);
      // Only if we are still on that loading screen: a failure after the
      // race is up belongs to the frame loop's handler, not here.
      if (this.screen === loading) loading.fail('COURSE FAILED TO LOAD', () => this.showTrackSelect());
    }
  }

  private async buildRace(loading: LoadingScreen): Promise<void> {
    await nextFrame();
    this.disposeSession();

    this.music.request(this.selectedTrack.music ?? null);

    const setup = {
      track: this.selectedTrack,
      playerVehicle: this.selectedVehicle,
      vehiclePool: this.vehicles,
      opponents: this.opponents,
      difficulty: this.difficulty,
    };

    // Models have to be in hand before the session is built, since that pass
    // is synchronous. A model that fails to load is reported and skipped —
    // the track or truck falls back to its procedural form.
    const modelUrls = collectModelUrls(setup);
    let models = new Map<string, THREE.Group>();
    if (modelUrls.length > 0) {
      loading.setProgress(0.1, `LOADING ${modelUrls.length} MODEL(S)`);
      await nextFrame();
      const loaded = await loadModels(modelUrls);
      models = loaded.models;
      for (const warning of loaded.warnings) console.warn(`[assets] ${warning}`);
    }

    loading.setProgress(0.45, 'BUILDING TERRAIN');
    await nextFrame();

    try {
      this.session = new RaceSession(
        { ...setup, models },
        this.renderer.aspect,
        this.renderer.mirrorAspect,
      );
    } catch (error) {
      console.error('[race] failed to build the course', error);
      loading.fail('COURSE FAILED TO LOAD', () => this.showTrackSelect());
      return;
    }

    loading.setProgress(1, 'READY');
    await nextFrame();

    this.setRacingScreen();
    this.lastFrame = performance.now();

    // Restore the overlay across a restart, so live-reloading a track you are
    // debugging doesn't silently turn the visualisation off.
    if (this.debugVisible) {
      this.session.toggleDebug();
      this.setRacingScreen();
    }
  }

  /** The in-race screen: HUD, plus the tuning panel when debug is on. */
  private setRacingScreen(): void {
    const root = document.createElement('div');
    root.style.position = 'absolute';
    root.style.inset = '0';
    root.style.pointerEvents = 'none';
    root.append(this.hud.root);
    if (this.debugVisible) root.append(this.telemetry.root);
    this.setScreen({ root }, 'racing');
  }

  private pause(): void {
    if (!this.session) return;
    this.session.paused = true;
    this.setScreen(
      new PauseScreen({
        onResume: () => this.resume(),
        onRestart: () => void this.startRace(),
        onQuit: () => this.showTitle(),
      }),
      'paused',
    );
  }

  private resume(): void {
    if (!this.session) return;
    this.session.paused = false;
    this.setRacingScreen();
    this.lastFrame = performance.now();
  }

  private showResults(): void {
    const session = this.session;
    if (!session) return;
    this.setScreen(
      new ResultsScreen(session.race.standings(), session.setup.track.name, {
        onRetry: () => void this.startRace(),
        onTracks: () => this.showTrackSelect(),
        onTitle: () => this.showTitle(),
      }),
      'results',
    );
  }

  private disposeSession(): void {
    this.session?.dispose();
    this.session = null;
    this.audio.idle();
  }

  /* --- loop ------------------------------------------------------------ */

  private frame = (now: number): void => {
    // One try/catch around the whole frame. Without it a single throw ends
    // the requestAnimationFrame chain for good: the picture freezes, input
    // stops, and the only sign anything happened is one line in a console
    // nobody has open. Failing visibly is the whole point.
    try {
      this.step(now);
    } catch (error) {
      this.crash(error);
    }
  };

  private step(now: number): void {
    if (this.stopped) return;
    const frameTime = Math.min(0.25, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    this.input.update();

    if (this.mode === 'racing' && this.session) {
      this.updateRacing(frameTime);
    } else {
      this.screen?.handleInput?.(this.input);
      this.screen?.update?.(frameTime);
      if (this.mode === 'paused' && this.session) {
        // Keep the frozen race visible behind the pause menu.
        this.renderer.render(
          this.session.scene,
          this.session.camera.camera,
          this.session.camera.mirrorCamera,
        );
        requestAnimationFrame(this.frame);
        return;
      }
      this.showroom.update(frameTime);
      this.renderer.render(this.showroom.scene, this.showroom.camera);
      requestAnimationFrame(this.frame);
      return;
    }

    requestAnimationFrame(this.frame);
  }

  /**
   * A frame threw.
   *
   * The simulation is the likely culprit and it is not safe to keep stepping
   * it, so the session is torn down and the player is put back on the title
   * screen with the loop still running. A second failure — one that happens
   * with no race in flight — is the renderer or the shell itself, and there
   * is nothing left to fall back to, so that one is fatal and says so.
   */
  private crash(error: unknown): void {
    console.error('[game] a frame failed', error);

    if (this.session) {
      try {
        this.disposeSession();
        this.showTitle();
        this.lastFrame = performance.now();
        requestAnimationFrame(this.frame);
        return;
      } catch (cleanupError) {
        console.error('[game] could not recover', cleanupError);
      }
    }

    this.stopped = true;
    showErrorPanel(this.uiRoot, {
      title: 'THE GAME STOPPED',
      message: 'Something went wrong while drawing a frame. Reload the page to start again.',
      detail: error,
      action: { label: 'RELOAD', onSelect: () => window.location.reload() },
    });
  }

  private updateRacing(frameTime: number): void {
    const session = this.session;
    if (!session) return;

    if (this.input.pressed('pause')) {
      this.pause();
      return;
    }
    if (this.input.pressed('reset')) session.rescuePlayer();
    if (this.input.pressed('camera')) session.camera.cycleMode();
    if (this.input.pressed('debug')) {
      this.debugVisible = session.toggleDebug();
      this.setRacingScreen();
    }
    if (this.input.pressed('mirror')) {
      this.renderer.setMirrorEnabled(!this.renderer.isMirrorEnabled);
      session.flash(this.renderer.isMirrorEnabled ? 'MIRROR ON' : 'MIRROR OFF');
    }
    session.camera.setLookingBack(this.input.down('lookBack'));

    session.update(frameTime, this.input, this.audio);
    this.hud.update(session);
    if (this.debugVisible) this.telemetry.update(session);
    this.renderer.render(
      session.scene,
      session.camera.camera,
      session.camera.mirrorCamera,
    );

    if (session.race.phase === 'finished') {
      this.audio.idle();
      this.showResults();
    }
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * Anything that escapes an event handler or a promise.
 *
 * These are logged rather than shown: most of them are recoverable, and a
 * modal panel over a game that is still running would be worse than the bug.
 * The failures worth interrupting a player for raise their own panel.
 */
function attachGlobalHandlers(): void {
  window.addEventListener('error', (event) => {
    console.error('[game] uncaught error', event.error ?? event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    console.error('[game] unhandled promise rejection', event.reason);
  });
}

/**
 * Is WebGL 2 available at all?
 *
 * Asked on a throwaway canvas, never the one we render to: a canvas hands
 * back the context it already made and ignores the attributes of any later
 * request, so probing the real canvas would quietly discard the renderer's
 * own `alpha: false` and `powerPreference: 'high-performance'` — and losing
 * the latter is the difference between the discrete GPU and the integrated
 * one on a laptop.
 *
 * Only consulted after startup has already failed, to tell "no 3D on this
 * machine" — old hardware, hardware acceleration switched off, a remote
 * desktop session — apart from a bug in our own code. Both are black pages
 * otherwise, and only one of them is the player's to fix.
 */
function webglAvailable(): boolean {
  try {
    return document.createElement('canvas').getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

function boot(): void {
  attachGlobalHandlers();

  const canvas = document.getElementById('view');
  const ui = document.getElementById('ui');
  if (!(canvas instanceof HTMLCanvasElement) || !(ui instanceof HTMLElement)) {
    // The page itself is wrong, so there is nowhere trustworthy to draw a
    // panel. This one stays a throw.
    throw new Error('missing #view canvas or #ui container');
  }

  // three r15x+ defaults to sRGB output; the retro pass expects linear values
  // so the dithering lands on the right colour steps.
  THREE.ColorManagement.enabled = true;

  try {
    new Game(canvas, ui);
  } catch (error) {
    console.error('[game] failed to start', error);
    if (!webglAvailable()) {
      showErrorPanel(ui, {
        title: 'NO 3D GRAPHICS',
        // Worded for both places this runs: a browser tab and the desktop
        // build, which is the same page inside Electron.
        message:
          'Could not open a WebGL 2 context, so the game cannot draw. In a browser, ' +
          'check that hardware acceleration is switched on; otherwise update your ' +
          'graphics driver.',
      });
      return;
    }
    showErrorPanel(ui, {
      title: 'THE GAME DID NOT START',
      message: 'Something failed while setting up. Reload the page to try again.',
      detail: error,
      action: { label: 'RELOAD', onSelect: () => window.location.reload() },
    });
  }
}

boot();
