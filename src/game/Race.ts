import type { Track } from './Track';
import type { Vehicle } from './Vehicle';

export interface Racer {
  id: string;
  name: string;
  vehicle: Vehicle;
  isPlayer: boolean;

  /** Completed laps. */
  lap: number;
  /** Index of the gate this racer must reach next. */
  nextCheckpoint: number;
  /** Monotonic distance covered along the course, in metres. */
  progress: number;

  lapTimes: number[];
  currentLapStart: number;
  bestLap: number | null;

  finished: boolean;
  finishTime: number | null;
  /** Final classification, assigned when the race ends. */
  position: number;

  wrongWay: boolean;

  /**
   * Seconds spent outside the course bounds. Zero whenever the racer is on
   * course, so the HUD can read it directly as a countdown.
   */
  offTrackFor: number;
}

export type RacePhase = 'countdown' | 'racing' | 'finished';

const COUNTDOWN_SECONDS = 3.2;
/** Extra slack beyond a gate's half width, so wide lines still register. */
const GATE_MARGIN = 6;
/** Vertical tolerance, to avoid triggering a gate from a bridge or a big jump. */
const GATE_VERTICAL_TOLERANCE = 14;

/**
 * Lap timing, checkpoint order and race positions.
 *
 * Checkpoints must be taken in sequence, which is what stops a truck from
 * cutting the infield and claiming a lap. Gates are deliberately generous:
 * they exist to prove you went the long way round, not to punish a wide line.
 */
export class Race {
  readonly racers: Racer[] = [];
  readonly track: Track;
  readonly totalLaps: number;

  phase: RacePhase = 'countdown';
  /** Counts up from zero once the lights go out. */
  clock = 0;
  /** Counts down to the start. */
  countdown = COUNTDOWN_SECONDS;

  private finishOrder: Racer[] = [];

  constructor(track: Track, totalLaps: number) {
    this.track = track;
    this.totalLaps = totalLaps;
  }

  add(racer: Omit<Racer, 'lap' | 'nextCheckpoint' | 'progress' | 'lapTimes' | 'currentLapStart' | 'bestLap' | 'finished' | 'finishTime' | 'position' | 'wrongWay' | 'offTrackFor'>): Racer {
    const full: Racer = {
      ...racer,
      lap: 0,
      // Gate 0 is the start/finish line, so the first target is gate 1.
      nextCheckpoint: 1 % this.track.checkpoints.length,
      progress: 0,
      lapTimes: [],
      currentLapStart: 0,
      bestLap: null,
      finished: false,
      finishTime: null,
      position: this.racers.length + 1,
      wrongWay: false,
      offTrackFor: 0,
    };
    this.racers.push(full);
    return full;
  }

  get player(): Racer | undefined {
    return this.racers.find((r) => r.isPlayer);
  }

  /** True while the grid is still held for the countdown. */
  get locked(): boolean {
    return this.phase === 'countdown';
  }

  update(dt: number): void {
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.countdown = 0;
        this.phase = 'racing';
        for (const racer of this.racers) racer.currentLapStart = 0;
      }
      return;
    }

    if (this.phase === 'finished') return;

    this.clock += dt;
    for (const racer of this.racers) {
      if (!racer.finished) this.updateRacer(racer);
    }
    this.updateStandings();

    const player = this.player;
    if (player?.finished) this.finish();
  }

  private updateRacer(racer: Racer): void {
    const position = racer.vehicle.position;
    const checkpoints = this.track.checkpoints;
    const gate = checkpoints[racer.nextCheckpoint];

    const dx = position.x - gate.position.x;
    const dz = position.z - gate.position.z;
    const dy = Math.abs(position.y - gate.position.y);
    const planarDistance = Math.hypot(dx, dz);

    if (planarDistance < gate.halfWidth + GATE_MARGIN && dy < GATE_VERTICAL_TOLERANCE) {
      this.passGate(racer);
    }

    this.updateProgress(racer);
    this.updateWrongWay(racer);
  }

  private passGate(racer: Racer): void {
    const total = this.track.checkpoints.length;
    racer.nextCheckpoint = (racer.nextCheckpoint + 1) % total;

    // Wrapping back to gate 1 means we just crossed the start/finish line.
    if (racer.nextCheckpoint !== 1) return;

    racer.lap += 1;
    const lapTime = this.clock - racer.currentLapStart;
    racer.lapTimes.push(lapTime);
    racer.currentLapStart = this.clock;
    if (racer.bestLap === null || lapTime < racer.bestLap) racer.bestLap = lapTime;

    if (racer.lap >= this.totalLaps) {
      racer.finished = true;
      racer.finishTime = this.clock;
      this.finishOrder.push(racer);
    }
  }

  /**
   * Distance covered along the course, used for AI rubber-banding.
   *
   * The lap counter and the road distance wrap at slightly different moments
   * — the lap ticks over at the finish gate, while the road distance wraps at
   * spline index 0 — so near the line the two disagree by almost a full lap.
   * Reconciling them here keeps progress monotonic across the start/finish.
   */
  private updateProgress(racer: Racer): void {
    const length = this.track.road.length;
    const query = this.track.road.closestTo(racer.vehicle.position.x, racer.vehicle.position.z);
    let distance = query.distance;

    if (racer.nextCheckpoint === 1 && distance > length * 0.5) {
      // Lap already counted, but the spline hasn't wrapped yet.
      distance -= length;
    } else if (racer.nextCheckpoint === 0 && distance < length * 0.5) {
      // Spline wrapped, but the finish gate hasn't been taken yet.
      distance += length;
    }

    racer.progress = racer.lap * length + distance;
  }

  private updateWrongWay(racer: Racer): void {
    const speed = racer.vehicle.forwardSpeed;
    if (Math.abs(speed) < 3) {
      racer.wrongWay = false;
      return;
    }

    const query = this.track.road.closestTo(racer.vehicle.position.x, racer.vehicle.position.z);
    const heading = racer.vehicle.forwardVector();
    heading.y = 0;
    heading.normalize();

    // Compare where the truck is actually travelling with the road direction;
    // reversing down the road counts as going the right way.
    const travel = speed >= 0 ? heading : heading.clone().negate();
    racer.wrongWay = travel.dot(query.tangent) < -0.35;
  }

  /**
   * Sort the field. Gate order beats raw distance, so a truck that cuts the
   * course cannot leapfrog one that took the proper route.
   */
  private updateStandings(): void {
    const total = this.track.checkpoints.length;

    const ordered = [...this.racers].sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished && b.finished) {
        return (a.finishTime ?? 0) - (b.finishTime ?? 0);
      }
      if (a.lap !== b.lap) return b.lap - a.lap;

      // nextCheckpoint 0 means the racer has taken the last gate and is on
      // its way to the line, which is ahead of everyone still mid-lap.
      const aGate = a.nextCheckpoint === 0 ? total : a.nextCheckpoint;
      const bGate = b.nextCheckpoint === 0 ? total : b.nextCheckpoint;
      if (aGate !== bGate) return bGate - aGate;

      return this.distanceToNextGate(a) - this.distanceToNextGate(b);
    });

    for (let i = 0; i < ordered.length; i++) {
      ordered[i].position = i + 1;
    }
  }

  private distanceToNextGate(racer: Racer): number {
    const gate = this.track.checkpoints[racer.nextCheckpoint];
    const position = racer.vehicle.position;
    return Math.hypot(position.x - gate.position.x, position.z - gate.position.z);
  }

  /** Close the race, classifying anyone still running by current order. */
  private finish(): void {
    this.phase = 'finished';
    this.updateStandings();

    const remaining = this.racers
      .filter((r) => !r.finished)
      .sort((a, b) => a.position - b.position);

    for (const racer of remaining) {
      racer.finished = true;
      // No finish time: they were classified, not flagged across the line.
      racer.finishTime = null;
      this.finishOrder.push(racer);
    }

    for (let i = 0; i < this.finishOrder.length; i++) {
      this.finishOrder[i].position = i + 1;
    }
  }

  /** Standings, best first. */
  standings(): Racer[] {
    return [...this.racers].sort((a, b) => a.position - b.position);
  }

  /** Furthest progress in the field, for AI rubber-banding. */
  leaderProgress(): number {
    return this.racers.reduce((best, r) => Math.max(best, r.progress), 0);
  }

  /** Countdown text, or null once racing. */
  countdownLabel(): string | null {
    if (this.phase !== 'countdown') return null;
    const remaining = Math.ceil(this.countdown);
    if (remaining <= 0) return 'GO!';
    return String(Math.min(3, remaining));
  }
}

/** mm:ss.hh, the format every racing game of the era used. */
export function formatTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '--:--.--';
  const clamped = Math.max(0, seconds);
  const minutes = Math.floor(clamped / 60);
  const secs = Math.floor(clamped % 60);
  const hundredths = Math.floor((clamped * 100) % 100);
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

/** 1ST, 2ND, 3RD, ... */
export function ordinal(position: number): string {
  const suffix =
    position % 100 >= 11 && position % 100 <= 13
      ? 'TH'
      : position % 10 === 1
        ? 'ST'
        : position % 10 === 2
          ? 'ND'
          : position % 10 === 3
            ? 'RD'
            : 'TH';
  return `${position}${suffix}`;
}
