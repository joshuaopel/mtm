import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { clamp } from '../core/Noise';
import type { Input } from '../core/Input';
import type { EngineAudio } from '../core/Audio';
import { Track } from './Track';
import { Vehicle } from './Vehicle';
import { AIDriver, type Difficulty } from './AIDriver';
import { Race, type Racer } from './Race';
import { ChaseCamera } from './ChaseCamera';
import { DebugOverlay } from './DebugOverlay';
import { advanceWind } from './Props';
import type { MTMTrack, MTMVehicle } from './formats';

/** Physics runs at a fixed rate; rendering is decoupled from it. */
const FIXED_STEP = 1 / 60;
/** Never simulate more than this much time in one frame, or a stall spirals. */
const MAX_FRAME_TIME = 0.1;

/**
 * How long a truck may go nowhere before it is put back on the track.
 *
 * Long enough that the AI's own reverse-out manoeuvre (which fires at ~1.8s)
 * gets a fair chance to free the truck first, so a respawn only happens when
 * recovery has genuinely failed.
 */
const STUCK_RESPAWN_SECONDS = 5;

/**
 * The course boundary, when a track does not set its own.
 *
 * `OUT_OF_BOUNDS_MARGIN` is measured out from the edge of the shoulder — the
 * graded verge either side of the road — so a 24m road with a 16m shoulder
 * stays fair out to 50m either side of the centreline. Running wide is
 * racing; only leaving the course entirely should start the clock.
 */
const OUT_OF_BOUNDS_MARGIN = 22;
const OUT_OF_BOUNDS_SECONDS = 5;

/**
 * Coming back inside does not stop the clock instantly.
 *
 * Without this the timer flickers on and off while you scrabble along the
 * boundary, which reads as a bug and makes the countdown impossible to act
 * on. Winding down four times faster than it wound up means a genuine return
 * clears it quickly while a wheel dipping back in does not.
 */
const RECOVERY_RATE = 4;

const AI_NAMES = [
  'RAZORBACK', 'STOMPER', 'HALF-TON', 'BONEYARD',
  'DIRT NAP', 'ROADKILL', 'THUNDERHEAD', 'GRIT',
  'HAMMERLOCK', 'CINDER', 'BADLANDS',
];

export interface RaceSetup {
  track: MTMTrack;
  playerVehicle: MTMVehicle;
  /** Pool the AI trucks are drawn from. */
  vehiclePool: MTMVehicle[];
  opponents: number;
  difficulty: Difficulty;
  /** Pre-loaded glTF models keyed by URL, from `collectModelUrls`. */
  models?: Map<string, THREE.Group>;
}

/**
 * Every model URL a race needs, so they can be fetched before the session is
 * built. Construction is synchronous — the physics world and scene graph are
 * assembled in one pass — so anything loaded from the network has to be in
 * hand first.
 */
export function collectModelUrls(setup: {
  track: MTMTrack;
  playerVehicle: MTMVehicle;
  vehiclePool: MTMVehicle[];
}): string[] {
  const urls: string[] = [];
  if (setup.track.sceneryModel) urls.push(setup.track.sceneryModel);
  for (const vehicle of [setup.playerVehicle, ...setup.vehiclePool]) {
    if (vehicle.model?.url) urls.push(vehicle.model.url);
  }
  return [...new Set(urls)];
}

/**
 * One race, from grid to flag.
 *
 * Owns the track, the trucks, the AI, the race director and the camera, and
 * runs the fixed-step simulation loop. The screens above it only need to
 * call `update` and read the state they want to draw.
 */
export class RaceSession {
  readonly track: Track;
  readonly race: Race;
  readonly camera: ChaseCamera;
  readonly setup: RaceSetup;

  readonly playerVehicle: Vehicle;
  private drivers: AIDriver[] = [];
  private accumulator = 0;

  /** Latched so the HUD can flash a message without polling every frame. */
  lastEvent: string | null = null;
  private eventTimer = 0;

  private previousVerticalSpeed = 0;
  paused = false;

  /** Collision, gate and AI-path visualisation. Off until toggled. */
  readonly debug = new DebugOverlay();

  constructor(setup: RaceSetup, viewAspect: number, mirrorAspect = 3.2) {
    this.setup = setup;
    const models = setup.models ?? new Map<string, THREE.Group>();
    this.track = new Track(setup.track, models);
    this.race = new Race(this.track, setup.track.laps);
    this.camera = new ChaseCamera(viewAspect, this.track.viewDistance, mirrorAspect);
    this.camera.setGroundProbe((x, z) => this.track.terrain.heightAt(x, z));

    const wheelMaterial = new CANNON.Material('wheel');
    const contact = new CANNON.ContactMaterial(this.track.groundMaterial, wheelMaterial, {
      friction: 0.42,
      restitution: 0.12,
      contactEquationStiffness: 1e8,
    });
    this.track.world.addContactMaterial(contact);

    // Grid order: the player starts at the back, which is the only way a
    // race against AI is worth running.
    const gridSize = Math.min(setup.opponents + 1, this.track.spawns.length);
    const playerSlot = gridSize - 1;

    const opponentVehicles = this.pickOpponentVehicles(setup, gridSize - 1);

    for (let slot = 0; slot < gridSize; slot++) {
      const isPlayer = slot === playerSlot;
      const definition = isPlayer ? setup.playerVehicle : opponentVehicles[slot];
      const spawn = this.track.spawns[slot];

      // Each truck gets its own clone of the model, since four of them may
      // share one file and each needs an independent transform.
      const modelUrl = definition.model?.url;
      const shared = modelUrl ? models.get(modelUrl) : undefined;
      const vehicle = new Vehicle(
        definition,
        this.track.world,
        wheelMaterial,
        shared ? (shared.clone(true) as THREE.Group) : undefined,
      );
      vehicle.reset(spawn.position, spawn.heading);
      this.track.scene.add(vehicle.object);

      this.race.add({
        id: isPlayer ? 'player' : `ai-${slot}`,
        name: isPlayer ? 'YOU' : AI_NAMES[slot % AI_NAMES.length],
        vehicle,
        isPlayer,
      });

      if (!isPlayer) {
        this.drivers.push(
          new AIDriver(vehicle, this.track.road, setup.difficulty, 7919 * (slot + 1)),
        );
      }
    }

    this.track.scene.add(this.debug.group);

    const player = this.race.player;
    if (!player) throw new Error('race created without a player');
    this.playerVehicle = player.vehicle;
    this.camera.reset();
  }

  /** Give opponents a spread of trucks, avoiding the player's own choice. */
  private pickOpponentVehicles(setup: RaceSetup, count: number): MTMVehicle[] {
    const others = setup.vehiclePool.filter((v) => v.id !== setup.playerVehicle.id);
    const pool = others.length > 0 ? others : setup.vehiclePool;
    const result: MTMVehicle[] = [];
    for (let i = 0; i < count; i++) result.push(pool[i % pool.length]);
    return result;
  }

  get scene(): THREE.Scene {
    return this.track.scene;
  }

  /**
   * Advance the race. `frameTime` is real elapsed seconds; physics is
   * stepped at a fixed rate so behaviour never depends on frame rate.
   */
  update(frameTime: number, input: Input, audio: EngineAudio): void {
    if (this.paused) {
      audio.idle();
      return;
    }

    this.accumulator += Math.min(frameTime, MAX_FRAME_TIME);

    while (this.accumulator >= FIXED_STEP) {
      this.step(FIXED_STEP, input);
      this.accumulator -= FIXED_STEP;
    }

    // Flags deform in the vertex shader from a shared phase, so this is the
    // entire per-frame cost of every flag on the track.
    advanceWind(frameTime);

    this.camera.update(frameTime, this.playerVehicle);
    this.updateAudio(audio, input);
    this.debug.update(this.track, this.race);

    if (this.eventTimer > 0) {
      this.eventTimer -= frameTime;
      if (this.eventTimer <= 0) this.lastEvent = null;
    }
  }

  private step(dt: number, input: Input): void {
    const locked = this.race.locked;

    // Player controls. The grid is held during the countdown, but steering
    // still responds so you can line up before the lights go out.
    const steer = input.steerAxis();
    this.playerVehicle.setControls({
      throttle: locked ? 0 : input.throttleAxis(),
      brake: locked ? 0 : input.brakeAxis(),
      steer,
      handbrake: !locked && input.down('handbrake'),
      parked: locked,
    });

    const leaderProgress = this.race.leaderProgress();
    for (const driver of this.drivers) {
      const racer = this.race.racers.find((r) => r.vehicle === driver.vehicle);
      const controls = locked
        ? { throttle: 0, brake: 0, steer: 0, handbrake: false, parked: true }
        : driver.update(dt, leaderProgress, racer?.progress ?? 0);
      driver.vehicle.setControls(controls);
    }

    for (const racer of this.race.racers) racer.vehicle.update(dt);

    this.track.world.step(dt);

    // syncMesh also latches wheel contact flags, so it must run every step
    // rather than once per rendered frame.
    for (const racer of this.race.racers) racer.vehicle.syncMesh();

    this.race.update(dt);
    this.handleRescues(dt);
  }

  /**
   * Put trucks back on the road when they end up stranded, inverted, or
   * simply going nowhere.
   *
   * Applies to the whole field, not just the player: an AI truck wedged
   * against a barrier for the rest of the race is both a dead opponent and a
   * permanent obstacle for everyone else.
   */
  private handleRescues(dt: number): void {
    // Nothing to rescue before the flag drops or after it falls.
    if (this.race.phase !== 'racing') return;

    for (const racer of this.race.racers) {
      if (racer.finished) continue;

      const vehicle = racer.vehicle;
      const belowWorld = vehicle.position.y < -40;
      const stuck = vehicle.stuckFor >= STUCK_RESPAWN_SECONDS;

      if (this.updateBounds(racer, dt)) continue;
      if (!vehicle.needsRescue && !belowWorld && !stuck) continue;

      // Snap to the nearest point on the racing line, facing the right way,
      // and lifted clear of the surface.
      const spawn = this.track.respawnNear(vehicle.position.x, vehicle.position.z);
      vehicle.reset(spawn.position, spawn.heading);

      if (racer.isPlayer) {
        this.camera.reset();
        this.flash(stuck && !vehicle.needsRescue ? 'UNSTUCK' : 'RECOVERED');
      }
    }
  }

  /** How long a racer may stay off course, for the HUD countdown. */
  get boundsSeconds(): number {
    return this.track.definition.bounds?.seconds ?? OUT_OF_BOUNDS_SECONDS;
  }

  /**
   * Run the off-course countdown for one racer.
   *
   * Returns true when the racer was reset, so the caller skips the other
   * rescue checks this step rather than resetting them twice.
   */
  private updateBounds(racer: Racer, dt: number): boolean {
    const limit = this.boundsSeconds;
    const margin = this.track.definition.bounds?.margin ?? OUT_OF_BOUNDS_MARGIN;

    const vehicle = racer.vehicle;
    const query = this.track.road.closestTo(vehicle.position.x, vehicle.position.z);
    const edge = query.width * 0.5 + this.track.road.shoulder + margin;
    const outside = Math.abs(query.lateral) > edge;

    if (!outside) {
      racer.offTrackFor = Math.max(0, racer.offTrackFor - dt * RECOVERY_RATE);
      return false;
    }

    racer.offTrackFor += dt;
    if (racer.offTrackFor < limit) return false;

    // Back to the last gate actually passed, not the nearest point on the
    // line: a shortcut across the infield would otherwise be rewarded with
    // whatever distance it covered.
    const spawn = this.track.respawnAtCheckpoint(racer.nextCheckpoint - 1);
    vehicle.reset(spawn.position, spawn.heading);
    racer.offTrackFor = 0;

    if (racer.isPlayer) {
      this.camera.reset();
      this.flash('OFF COURSE');
    }
    return true;
  }

  private updateAudio(audio: EngineAudio, input: Input): void {
    const vehicle = this.playerVehicle;
    const topSpeed = vehicle.definition.physics.topSpeed;
    const speedFraction = clamp(Math.abs(vehicle.forwardSpeed) / topSpeed, 0, 1);

    // Fake gearing so the pitch rises and drops rather than climbing once.
    const gears = 4;
    const gearSpan = 1 / gears;
    const withinGear = (speedFraction % gearSpan) / gearSpan;
    const rpm = clamp(0.25 + withinGear * 0.75, 0, 1);

    const throttle = this.race.locked ? 0 : input.throttleAxis();
    audio.update(rpm, throttle, speedFraction, vehicle.airborne);

    // Landing thump, triggered on a sharp reversal of vertical speed.
    const verticalSpeed = vehicle.chassis.velocity.y;
    const deceleration = verticalSpeed - this.previousVerticalSpeed;
    if (deceleration > 6 && vehicle.groundedWheels >= 2) {
      audio.thump(clamp(deceleration / 22, 0.2, 1));
    }
    this.previousVerticalSpeed = verticalSpeed;
  }

  /** Manual reset, bound to the R key. */
  rescuePlayer(): void {
    const vehicle = this.playerVehicle;
    const spawn = this.track.respawnNear(vehicle.position.x, vehicle.position.z);
    vehicle.reset(spawn.position, spawn.heading);
    this.camera.reset();
    this.flash('RESET');
  }

  flash(message: string, seconds = 1.6): void {
    this.lastEvent = message;
    this.eventTimer = seconds;
  }

  get playerRacer(): Racer | undefined {
    return this.race.player;
  }

  setAspect(aspect: number): void {
    this.camera.setAspect(aspect);
  }

  /** Toggle the debug overlay; returns its new visibility. */
  toggleDebug(): boolean {
    return this.debug.toggle(this.track, this.race);
  }

  dispose(): void {
    this.debug.dispose();
    for (const racer of this.race.racers) racer.vehicle.dispose();
    this.track.dispose();
  }
}
