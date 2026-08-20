import { el, statRow } from './dom';
import { Menu, type Screen } from './Screen';
import { renderTrackThumbnail } from './TrackThumbnail';
import { formatTime, ordinal, type Racer } from '../game/Race';
import type { Input } from '../core/Input';
import type { MTMTrack, MTMVehicle } from '../game/formats';
import type { Difficulty } from '../game/AIDriver';
import type { DetailLevel } from '../core/RetroRenderer';

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  rookie: 'ROOKIE',
  pro: 'PRO',
  veteran: 'VETERAN',
};

const DETAIL_LABELS: Record<DetailLevel, string> = {
  lo: '320x240 (AUTHENTIC)',
  med: '480x360',
  hi: '720x540',
};

/**
 * HUD sizes. The interface is laid out in CSS pixels, so a handheld gets the
 * same pixel count as a monitor at a third of the physical size — 150% is
 * what makes a Steam Deck readable at arm's length.
 */
export const UI_SCALES = [1, 1.25, 1.5, 1.75] as const;

/* -------------------------------------------------------------------------
 * Title
 * ---------------------------------------------------------------------- */

export class TitleScreen implements Screen {
  readonly root: HTMLElement;
  private menu: Menu;

  constructor(actions: { onRace(): void; onControls(): void }) {
    this.menu = new Menu();
    this.menu.setEntries([
      { label: 'START RACE', tag: 'ENTER', onSelect: actions.onRace },
      { label: 'CONTROLS', onSelect: actions.onControls },
    ]);

    this.root = el('div', { class: 'screen' }, [
      el('div', { class: 'title-plate' }, [
        el('h1', {}, ['MONSTER', el('br'), 'TRUCK MANIA']),
        el('div', { class: 'sub', text: 'DIRT * AIR * CARNAGE' }),
      ]),
      this.menu.root,
      el('div', { class: 'hint' }, [
        el('b', { text: 'ARROWS' }),
        ' / ',
        el('b', { text: 'WASD' }),
        ' MOVE  •  ',
        el('b', { text: 'ENTER' }),
        ' SELECT  •  ',
        el('b', { text: 'ESC' }),
        ' BACK',
      ]),
    ]);
  }

  handleInput(input: Input): void {
    this.menu.handleInput(input);
  }
}

/* -------------------------------------------------------------------------
 * Track select
 * ---------------------------------------------------------------------- */

export class TrackSelectScreen implements Screen {
  readonly root: HTMLElement;
  private menu: Menu;
  private detail: HTMLElement;
  private tracks: MTMTrack[];
  private onBack: () => void;
  /** Cached so switching back and forth doesn't redraw the map each time. */
  private thumbnails = new Map<string, HTMLCanvasElement>();

  constructor(tracks: MTMTrack[], actions: { onPick(track: MTMTrack): void; onBack(): void }) {
    this.tracks = tracks;
    this.onBack = actions.onBack;
    this.detail = el('div', { class: 'detail-pane bevel' });

    this.menu = new Menu({ onChange: (i) => this.showDetail(i) });
    this.menu.setEntries(
      tracks.map((track) => ({
        label: track.name,
        tag: '★'.repeat(track.difficulty),
        onSelect: () => actions.onPick(track),
      })),
      false,
    );

    this.root = el('div', { class: 'select-root' }, [
      el('div', { class: 'bar' }, [
        el('span', { text: 'SELECT COURSE' }),
        el('span', { class: 'right', text: 'ESC — BACK' }),
      ]),
      el('div', { class: 'split' }, [
        el('div', { class: 'list-pane bevel' }, [this.menu.root]),
        this.detail,
      ]),
      el('div', { class: 'bar' }, [
        el('span', { class: 'right', text: 'ENTER — CONFIRM COURSE' }),
      ]),
    ]);

    this.showDetail(0);
  }

  private showDetail(index: number): void {
    const track = this.tracks[index];
    if (!track) return;

    let thumbnail = this.thumbnails.get(track.id);
    if (!thumbnail) {
      thumbnail = renderTrackThumbnail(track);
      this.thumbnails.set(track.id, thumbnail);
    }

    const stats = el('div', { class: 'stats' }, [
      ...statRow('DIFFICULTY', track.difficulty, 5),
      el('span', { class: 'label', text: 'LAPS' }),
      el('span', { text: String(track.laps) }),
      el('span', {}),
      el('span', { class: 'label', text: 'LENGTH' }),
      el('span', { text: `${estimateLength(track)} M` }),
      el('span', {}),
      el('span', { class: 'label', text: 'SURFACE' }),
      el('span', { text: track.environment.surface.toUpperCase() }),
      el('span', {}),
    ]);

    this.detail.replaceChildren(
      el('h2', { text: track.name }),
      thumbnail,
      el('div', { class: 'blurb', text: track.blurb }),
      stats,
    );
  }

  handleInput(input: Input): void {
    this.menu.handleInput(input);
    if (input.pressed('back')) this.onBack();
  }
}

/** Rough centreline length, good enough for a select-screen readout. */
function estimateLength(track: MTMTrack): number {
  const points = track.road.points;
  let total = 0;
  const count = track.road.closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i++) {
    const a = points[i].pos;
    const b = points[(i + 1) % points.length].pos;
    total += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  // Control-point chords cut the corners; a small factor compensates.
  return Math.round((total * 1.04) / 10) * 10;
}

/* -------------------------------------------------------------------------
 * Vehicle select
 * ---------------------------------------------------------------------- */

export class VehicleSelectScreen implements Screen {
  readonly root: HTMLElement;
  private menu: Menu;
  private detail: HTMLElement;
  private vehicles: MTMVehicle[];
  private onBack: () => void;
  private onPreview: (vehicle: MTMVehicle) => void;

  private difficulty: Difficulty = 'pro';
  private opponents = 5;
  private difficultyRow: HTMLElement;
  private opponentsRow: HTMLElement;

  constructor(
    vehicles: MTMVehicle[],
    actions: {
      onPick(vehicle: MTMVehicle, difficulty: Difficulty, opponents: number): void;
      onBack(): void;
      onPreview(vehicle: MTMVehicle): void;
    },
  ) {
    this.vehicles = vehicles;
    this.onBack = actions.onBack;
    this.onPreview = actions.onPreview;
    this.detail = el('div', { class: 'detail-pane bevel showroom' });
    this.difficultyRow = el('span', { text: DIFFICULTY_LABELS[this.difficulty] });
    this.opponentsRow = el('span', { text: String(this.opponents) });

    this.menu = new Menu({ onChange: (i) => this.showDetail(i) });
    this.menu.setEntries(
      vehicles.map((vehicle) => ({
        label: vehicle.name,
        tag: vehicle.class,
        onSelect: () => actions.onPick(vehicle, this.difficulty, this.opponents),
      })),
      false,
    );

    this.root = el('div', { class: 'select-root' }, [
      el('div', { class: 'bar' }, [
        el('span', { text: 'SELECT TRUCK' }),
        el('span', { class: 'right', text: 'ESC — BACK' }),
      ]),
      el('div', { class: 'split' }, [
        el('div', { class: 'list-pane bevel' }, [this.menu.root]),
        this.detail,
      ]),
      el('div', { class: 'bar' }, [
        el('span', {}, ['◄ ►  DIFFICULTY: ', this.difficultyRow, '   •   OPPONENTS: ', this.opponentsRow]),
        el('span', { class: 'right', text: 'ENTER — GREEN FLAG' }),
      ]),
    ]);

    this.showDetail(0);
  }

  private showDetail(index: number): void {
    const vehicle = this.vehicles[index];
    if (!vehicle) return;
    this.onPreview(vehicle);

    this.detail.replaceChildren(
      el('h2', { text: vehicle.name }),
      el('div', { class: 'hint', text: vehicle.class }),
      el('div', { class: 'blurb', text: vehicle.blurb }),
      el('div', { class: 'stats' }, [
        ...statRow('SPEED', vehicle.stats.speed),
        ...statRow('ACCEL', vehicle.stats.accel),
        ...statRow('GRIP', vehicle.stats.grip),
        ...statRow('WEIGHT', vehicle.stats.weight),
        ...statRow('SUSPENSION', vehicle.stats.suspension),
        ...statRow('TOUGHNESS', vehicle.stats.toughness),
      ]),
    );
  }

  handleInput(input: Input): void {
    this.menu.handleInput(input);
    if (input.pressed('back')) this.onBack();

    // Left/right adjust the race options shown in the footer.
    if (input.pressed('left') || input.pressed('right')) {
      const order: Difficulty[] = ['rookie', 'pro', 'veteran'];
      const delta = input.pressed('right') ? 1 : -1;
      const next = order.indexOf(this.difficulty) + delta;
      if (next >= 0 && next < order.length) {
        this.difficulty = order[next];
        this.difficultyRow.textContent = DIFFICULTY_LABELS[this.difficulty];
      }
    }
  }
}

/* -------------------------------------------------------------------------
 * Results, pause, controls, loading
 * ---------------------------------------------------------------------- */

export class ResultsScreen implements Screen {
  readonly root: HTMLElement;
  private menu: Menu;

  constructor(
    racers: Racer[],
    trackName: string,
    actions: { onRetry(): void; onTracks(): void; onTitle(): void },
  ) {
    const player = racers.find((r) => r.isPlayer);
    const table = el('div', { class: 'results-table bevel' }, [
      el('span', { class: 'head', text: 'POS' }),
      el('span', { class: 'head', text: 'DRIVER' }),
      el('span', { class: 'head', text: 'TIME' }),
      el('span', { class: 'head', text: 'BEST LAP' }),
    ]);

    for (const racer of racers) {
      const cls = racer.isPlayer ? 'me' : '';
      table.append(
        el('span', { class: cls, text: ordinal(racer.position) }),
        el('span', { class: cls, text: racer.name }),
        // A null finish time means the racer was classified when the player
        // took the flag rather than crossing the line themselves.
        el('span', { class: cls, text: racer.finishTime === null ? 'DNF' : formatTime(racer.finishTime) }),
        el('span', { class: cls, text: formatTime(racer.bestLap) }),
      );
    }

    this.menu = new Menu();
    this.menu.setEntries([
      { label: 'RACE AGAIN', onSelect: actions.onRetry },
      { label: 'CHANGE COURSE', onSelect: actions.onTracks },
      { label: 'MAIN MENU', onSelect: actions.onTitle },
    ]);

    const headline = player
      ? player.position === 1
        ? 'WINNER'
        : `${ordinal(player.position)} PLACE`
      : 'RACE OVER';

    this.root = el('div', { class: 'screen dim' }, [
      el('div', { class: 'title-plate' }, [
        el('h1', { text: headline }),
        el('div', { class: 'sub', text: trackName }),
      ]),
      table,
      this.menu.root,
    ]);
  }

  handleInput(input: Input): void {
    this.menu.handleInput(input);
  }
}

export class PauseScreen implements Screen {
  readonly root: HTMLElement;
  private menu: Menu;
  private onResume: () => void;

  constructor(actions: { onResume(): void; onRestart(): void; onQuit(): void }) {
    this.onResume = actions.onResume;
    this.menu = new Menu();
    this.menu.setEntries([
      { label: 'RESUME', onSelect: actions.onResume },
      { label: 'RESTART RACE', onSelect: actions.onRestart },
      { label: 'QUIT TO MENU', onSelect: actions.onQuit },
    ]);

    this.root = el('div', { class: 'screen dim' }, [
      el('div', { class: 'title-plate' }, [el('h1', { text: 'PAUSED' })]),
      this.menu.root,
    ]);
  }

  handleInput(input: Input): void {
    this.menu.handleInput(input);
    if (input.pressed('pause') || input.pressed('back')) this.onResume();
  }
}

/** Everything the Controls screen needs to describe the music. */
export interface MusicState {
  /** False when no audio file has been dropped into the content folder. */
  available: boolean;
  enabled: boolean;
  volume: number;
}

const VOLUME_LABELS = ['OFF', 'LOW', 'MEDIUM', 'HIGH'];

export class ControlsScreen implements Screen {
  readonly root: HTMLElement;
  private onBack: () => void;
  private onDetailChange: (detail: DetailLevel) => void;
  private onUiScaleChange: (scale: number) => void;
  private onToggleMute: () => boolean;
  private onToggleMusic: () => MusicState;
  private onCycleMusicVolume: () => MusicState;

  private detail: DetailLevel;
  private uiScale: number;
  private muted = false;
  private music: MusicState;
  private menu: Menu;

  constructor(
    initialDetail: DetailLevel,
    initialUiScale: number,
    initialMuted: boolean,
    initialMusic: MusicState,
    actions: {
      onBack(): void;
      onDetailChange(detail: DetailLevel): void;
      onUiScaleChange(scale: number): void;
      onToggleMute(): boolean;
      onToggleMusic(): MusicState;
      onCycleMusicVolume(): MusicState;
    },
  ) {
    this.onBack = actions.onBack;
    this.onDetailChange = actions.onDetailChange;
    this.onUiScaleChange = actions.onUiScaleChange;
    this.onToggleMute = actions.onToggleMute;
    this.onToggleMusic = actions.onToggleMusic;
    this.onCycleMusicVolume = actions.onCycleMusicVolume;
    this.detail = initialDetail;
    this.uiScale = initialUiScale;
    this.muted = initialMuted;
    this.music = initialMusic;

    const rows: [string, string][] = [
      ['ACCELERATE', 'UP ARROW / W / RIGHT TRIGGER'],
      ['BRAKE & REVERSE', 'DOWN ARROW / S / LEFT TRIGGER'],
      ['STEER', 'LEFT & RIGHT ARROWS / A & D / STICK'],
      ['HANDBRAKE', 'SPACE / X'],
      ['RESET TRUCK', 'R / Y'],
      ['CHANGE CAMERA', 'C / RB'],
      ['LOOK BACK', 'B / LB'],
      ['REAR-VIEW MIRROR', 'M / SELECT'],
      ['PAUSE', 'ESC / START'],
      ['MUSIC', 'DROP AN MP3 INTO PUBLIC/CONTENT'],
    ];

    const table = el('div', { class: 'results-table bevel' }, [
      el('span', { class: 'head', text: 'ACTION' }),
      el('span', { class: 'head', text: 'INPUT' }),
      el('span', { class: 'head' }),
      el('span', { class: 'head' }),
    ]);
    for (const [action, keys] of rows) {
      table.append(
        el('span', { text: action }),
        el('span', { text: keys }),
        el('span', {}),
        el('span', {}),
      );
    }

    this.menu = new Menu();
    this.rebuild();

    this.root = el('div', { class: 'screen' }, [
      el('div', { class: 'title-plate' }, [el('h1', { text: 'CONTROLS' })]),
      table,
      this.menu.root,
    ]);
  }

  /**
   * Rebuild the option rows so their tags reflect current state. Selection
   * is preserved, so toggling an option doesn't jump the cursor.
   */
  private rebuild(): void {
    this.menu.setEntries([
      {
        label: 'RESOLUTION',
        tag: DETAIL_LABELS[this.detail],
        onSelect: () => {
          const order: DetailLevel[] = ['lo', 'med', 'hi'];
          this.detail = order[(order.indexOf(this.detail) + 1) % order.length];
          this.onDetailChange(this.detail);
          this.rebuild();
        },
      },
      {
        label: 'HUD SIZE',
        tag: `${Math.round(this.uiScale * 100)}%`,
        onSelect: () => {
          const next = (UI_SCALES.indexOf(this.uiScale as (typeof UI_SCALES)[number]) + 1) % UI_SCALES.length;
          this.uiScale = UI_SCALES[next];
          this.onUiScaleChange(this.uiScale);
          this.rebuild();
        },
      },
      {
        label: 'SOUND',
        tag: this.muted ? 'OFF' : 'ON',
        onSelect: () => {
          this.muted = this.onToggleMute();
          this.rebuild();
        },
      },
      // Shown even with nothing to play, so it is obvious the feature exists
      // and where a song would go.
      {
        label: 'MUSIC',
        tag: !this.music.available ? 'NONE FOUND' : this.music.enabled ? 'ON' : 'OFF',
        onSelect: () => {
          if (!this.music.available) return;
          this.music = this.onToggleMusic();
          this.rebuild();
        },
      },
      {
        label: 'MUSIC VOLUME',
        tag: VOLUME_LABELS[Math.min(3, Math.round(this.music.volume * 3.4))],
        onSelect: () => {
          if (!this.music.available) return;
          this.music = this.onCycleMusicVolume();
          this.rebuild();
        },
      },
      { label: 'BACK', onSelect: () => this.onBack() },
    ]);
  }

  handleInput(input: Input): void {
    this.menu.handleInput(input);
    if (input.pressed('back')) this.onBack();
  }
}

export class LoadingScreen implements Screen {
  readonly root: HTMLElement;
  private fill: HTMLElement;
  private label: HTMLElement;

  constructor(title: string) {
    this.fill = el('div', { class: 'fill' });
    this.label = el('div', { text: 'PREPARING COURSE' });
    this.root = el('div', { class: 'loading' }, [
      el('div', { text: title }),
      el('div', { class: 'track bevel-in' }, [this.fill]),
      this.label,
    ]);
  }

  setProgress(fraction: number, label?: string): void {
    this.fill.style.width = `${Math.round(fraction * 100)}%`;
    if (label) this.label.textContent = label;
  }
}
