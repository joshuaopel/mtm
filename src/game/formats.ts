/**
 * Shared data formats for Monster Truck Madness.
 *
 * These interfaces are the contract between the runtime and the Blender
 * exporter in `blender/mtm_tools`. Anything the exporter writes must
 * validate against these shapes. Keep the two in sync — the version field
 * exists so old files can be migrated rather than silently misread.
 *
 * Coordinate system: right-handed, Y up, -Z forward (three.js convention).
 * The Blender exporter converts from Blender's Z-up space on the way out.
 */

export const TRACK_FORMAT = 'mtm-track';
export const VEHICLE_FORMAT = 'mtm-vehicle';
export const FORMAT_VERSION = 1;

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

/* -------------------------------------------------------------------------
 * Tracks
 * ---------------------------------------------------------------------- */

/** Named lighting/atmosphere preset. Drives sky, fog and terrain palette. */
export interface TrackEnvironment {
  /** Horizon colour; fog is matched to this for the classic "fade to sky" look. */
  skyHorizon: string;
  /** Zenith colour of the gradient sky dome. */
  skyZenith: string;
  fogColor: string;
  /** Exponential-squared fog density. 0.006-0.02 suits the retro draw distance. */
  fogDensity: number;
  sunDirection: Vec3;
  sunColor: string;
  ambientColor: string;
  /** Surface palette key, see `SURFACE_THEMES` in Terrain.ts. */
  surface: 'dirt' | 'sand' | 'snow' | 'mud' | 'slag' | 'grass';
}

/**
 * A control point on the racing line. The road ribbon is lofted along these
 * and the terrain is flattened underneath, so this doubles as the AI path.
 */
export interface RoadPoint {
  pos: Vec3;
  /** Overrides the track-wide road width at this point, in metres. */
  width?: number;
  /** Banking in degrees, positive banks the road into a left turn. */
  bank?: number;
}

export interface TrackRoad {
  points: RoadPoint[];
  /** Default surface width in metres. */
  width: number;
  /** Closed circuits loop the spline; open ones are point-to-point sprints. */
  closed: boolean;
  /**
   * How far past the road edge the terrain is blended back to its natural
   * height. Wider values give gentler shoulders you can drift onto.
   */
  shoulder: number;
}

export type TerrainFeature =
  | { type: 'hill'; pos: Vec2; radius: number; height: number }
  | { type: 'crater'; pos: Vec2; radius: number; depth: number }
  | { type: 'plateau'; pos: Vec2; radius: number; height: number; falloff: number }
  | { type: 'ridge'; points: Vec2[]; width: number; height: number };

export interface TrackTerrain {
  /** Side length of the (square) terrain patch in metres. */
  size: number;
  /** Grid resolution. Vertex count is (segments+1)^2, so keep it sane. */
  segments: number;
  /** Amplitude of the background fractal noise. */
  amplitude: number;
  /** Base frequency of the background noise. */
  frequency: number;
  seed: number;
  features: TerrainFeature[];
}

/** Solid axis-relative box. Chassis and props collide with these. */
export interface TrackWall {
  pos: Vec3;
  /** Full extents (width, height, depth) in metres, before rotation. */
  size: Vec3;
  /** Yaw in degrees about +Y. */
  rotation?: number;
  /**
   * Invisible walls keep the player on course without cluttering the scene —
   * the classic way to fence a canyon.
   */
  invisible?: boolean;
  /** Material key for the visible case. */
  material?: 'concrete' | 'tire' | 'metal' | 'wood' | 'rock';
}

/**
 * Auto-generated blocker walls running along the road edges.
 *
 * Fencing a circuit by hand is hundreds of near-identical boxes, so tracks
 * declare the intent and the runtime lays them out along the spline. The
 * Blender exporter emits the same structure when a road is marked "fenced".
 */
export interface TrackBarriers {
  /** Length of each barrier segment along the road, in metres. */
  spacing: number;
  height: number;
  thickness: number;
  /** Gap between the road edge and the barrier. */
  offset: number;
  material?: TrackWall['material'];
  invisible?: boolean;
  sides?: 'both' | 'left' | 'right';
}

/**
 * Rule-based prop scatter. Placement is rejection-sampled against the road
 * and terrain slope using the track seed, so it is dense but deterministic.
 */
export interface TrackScatter {
  kind: TrackProp['kind'];
  count: number;
  /** Keep clear of the racing surface by at least this much. */
  minRoadDistance: number;
  /** Don't stray further than this from the road, or you'll never see it. */
  maxRoadDistance: number;
  /** Skip ground steeper than this, in degrees. */
  maxSlope: number;
  scale: Vec2;
  solid?: boolean;
}

export interface TrackProp {
  kind: 'tree' | 'rock' | 'barrel' | 'cone' | 'sign' | 'tower' | 'crate' | 'arch';
  pos: Vec3;
  rotation?: number;
  scale?: number;
  /** Props default to decorative; set true to give them a collision box. */
  solid?: boolean;
}

/**
 * A gate the racers must pass through in order. Index 0 is the start/finish
 * line. Generated automatically from the road if the track omits them.
 */
export interface TrackCheckpoint {
  pos: Vec3;
  /** Yaw in degrees; the gate plane faces along the racing direction. */
  rotation: number;
  width: number;
}

export interface MTMTrack {
  format: typeof TRACK_FORMAT;
  version: number;
  id: string;
  name: string;
  /** Shown on the level select screen. */
  blurb: string;
  author?: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  laps: number;
  environment: TrackEnvironment;
  terrain: TrackTerrain;
  road: TrackRoad;
  walls: TrackWall[];
  props: TrackProp[];
  /** Optional automatic edge fencing. */
  barriers?: TrackBarriers;
  /** Optional rule-based scenery scatter. */
  scatter?: TrackScatter[];
  /** Optional; auto-generated along the road spline when absent. */
  checkpoints?: TrackCheckpoint[];
  /** Optional; auto-generated as a start grid behind checkpoint 0 when absent. */
  spawns?: { pos: Vec3; rotation: number }[];
  /** Optional glTF of hand-modelled scenery, layered on top of the terrain. */
  sceneryModel?: string;
}

/* -------------------------------------------------------------------------
 * Vehicles
 * ---------------------------------------------------------------------- */

/**
 * Player-facing stat bars, 0-10. Purely cosmetic — the feel comes from
 * `VehiclePhysics` — but they should honestly reflect it.
 */
export interface VehicleStats {
  speed: number;
  accel: number;
  grip: number;
  weight: number;
  suspension: number;
  toughness: number;
}

export interface VehiclePhysics {
  mass: number;
  /** Full extents of the chassis collision box. */
  chassisSize: Vec3;
  /** Offset of the collision box from the body's centre of mass. */
  chassisOffset: Vec3;
  wheelRadius: number;
  wheelWidth: number;
  /** Half-track (x) and longitudinal offset (z) of the front axle. */
  frontAxle: Vec2;
  rearAxle: Vec2;
  /** Height of the suspension attachment point relative to centre of mass. */
  axleHeight: number;
  suspensionRest: number;
  suspensionStiffness: number;
  suspensionDamping: number;
  suspensionCompression: number;
  maxSuspensionTravel: number;
  maxSuspensionForce: number;
  frictionSlip: number;
  rollInfluence: number;
  engineForce: number;
  brakeForce: number;
  handbrakeForce: number;
  /** Maximum steering angle in radians at low speed. */
  maxSteer: number;
  /** Radians per second of steering actuation. */
  steerRate: number;
  /** Steering is scaled down towards this fraction at top speed. */
  highSpeedSteerFactor: number;
  /** Soft speed cap in m/s; engine force tapers to zero here. */
  topSpeed: number;
  /** Downforce coefficient, N per (m/s)^2. */
  downforce: number;
  /** Torque available for mid-air pitch/roll correction. */
  airControl: number;
}

export interface VehicleLook {
  /** Silhouette family used by the procedural mesh builder. */
  style: 'pickup' | 'crewcab' | 'flatnose' | 'muscle' | 'buggy' | 'hauler';
  bodyColor: string;
  accentColor: string;
  trimColor: string;
  glassColor: string;
  rimColor: string;
  /** Paint scheme applied over the base colour. */
  livery: 'solid' | 'stripe' | 'flames' | 'splatter' | 'checker' | 'bolt';
  /** Uniform scale applied to the visual mesh only. */
  scale?: number;
  rollCage?: boolean;
  stacks?: boolean;
  lightBar?: boolean;
}

export interface MTMVehicle {
  format: typeof VEHICLE_FORMAT;
  version: number;
  id: string;
  name: string;
  /** Short flavour line for the select screen. */
  blurb: string;
  class: string;
  stats: VehicleStats;
  physics: VehiclePhysics;
  look: VehicleLook;
  /** Optional glTF replacing the procedural body mesh. */
  model?: string;
}

/* -------------------------------------------------------------------------
 * Validation helpers
 * ---------------------------------------------------------------------- */

export function isTrack(value: unknown): value is MTMTrack {
  const t = value as MTMTrack | null;
  return !!t && t.format === TRACK_FORMAT && Array.isArray(t.road?.points);
}

export function isVehicle(value: unknown): value is MTMVehicle {
  const v = value as MTMVehicle | null;
  return !!v && v.format === VEHICLE_FORMAT && !!v.physics;
}
