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
  /**
   * Optional artwork overriding the procedural surfaces.
   *
   * Both fall back to the `surface` theme when absent or when the image
   * fails to load, so a track always renders even with a broken path.
   */
  artwork?: TrackArtwork;
}

export interface TrackArtwork {
  /** Image used for the terrain, tiled across the whole patch. */
  ground?: string;
  /** How many times the ground image repeats across the terrain. */
  groundRepeat?: number;
  /** Image used for the road ribbon. */
  road?: string;
  /** Metres of road per vertical repeat of the road image. */
  roadRepeatMetres?: number;
  /**
   * Drop imported artwork to nearest-neighbour filtering, matching the
   * built-in textures. Turn it off for artwork drawn at a higher resolution
   * that you want to stay smooth.
   */
  pixelated?: boolean;
  /**
   * Blend several textures across the terrain instead of tiling one.
   *
   * Takes precedence over `ground` when present. See `TerrainPaint`.
   */
  paint?: TerrainPaint;
}

/**
 * Multi-texture terrain.
 *
 * Up to four layers are blended per-vertex. Where the weights come from is the
 * only choice the author makes: `weights` if they painted the terrain in
 * Blender, `rules` if they would rather describe the landscape than paint it,
 * and both is fine — rules fill in wherever the painting left the base layer.
 *
 * Four is not arbitrary. The weights ride in a single vertex attribute, and
 * four texture fetches per fragment is what the blend costs; a fifth layer
 * doubles the attribute and adds a fetch for the whole terrain to buy one more
 * material. Four covers ground / worn / rock / peak, which is the vocabulary
 * of a period racing surface.
 */
export interface TerrainPaint {
  /**
   * Layer 0 is the base and shows wherever nothing else outweighs it.
   * Layers beyond the fourth are ignored.
   */
  layers: TerrainLayer[];
  /**
   * Painted weights: base64 RGB bytes, one triplet per grid vertex, row-major
   * and indexed as `iz * (segments + 1) + ix` like the heightmap. The three
   * channels weight layers 1, 2 and 3; layer 0 takes whatever is left.
   */
  weights?: TerrainWeights;
  /** Weights derived from the shape of the land. Applied under `weights`. */
  rules?: TerrainPaintRule[];
}

export interface TerrainLayer {
  /** A built-in surface name, or a URL to an image. */
  texture: string;
  /** Metres per tile. Smaller repeats faster; 8 matches the built-in ground. */
  scale?: number;
  /** Hex tint multiplied over the texture, for reusing one image as several. */
  tint?: string;
}

export interface TerrainWeights {
  /** Grid resolution the weights were baked at; `data` is (segments + 1)^2 RGB. */
  segments: number;
  /** Base64-encoded RGB bytes, three per vertex. */
  data: string;
}

/**
 * One ramp from a property of the terrain to a layer's weight.
 *
 * `from`/`to` bracket the ramp: below `from` the layer contributes nothing, at
 * `to` it contributes `strength`. Inverting them (`from` greater than `to`)
 * runs the ramp the other way, which is how you get a layer that appears on
 * *flat* ground or *low* ground.
 */
export interface TerrainPaintRule {
  /** Index into `layers`. Rule on layer 0 is ignored; it is the base. */
  layer: number;
  /**
   * - `slope`: surface angle in degrees, 0 flat and 90 vertical.
   * - `height`: world height in metres.
   * - `road`: horizontal distance from the racing line in metres.
   */
  by: 'slope' | 'height' | 'road';
  from: number;
  to: number;
  /** Peak weight this rule contributes, 0..1. Defaults to 1. */
  strength?: number;
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
  /**
   * Baked heights from a sculpted mesh, replacing the procedural generation.
   *
   * The physics ground is a heightfield, so this is a grid of heights rather
   * than an arbitrary mesh — overhangs and caves cannot be represented, and
   * anything modelled as one bakes to its topmost surface.
   */
  heightmap?: TerrainHeightmap;
}

export interface TerrainHeightmap {
  /** Grid resolution; `data` decodes to (segments + 1)^2 floats. */
  segments: number;
  /**
   * Base64-encoded little-endian Float32 array, row-major and indexed as
   * `iz * (segments + 1) + ix`, matching the runtime's own layout.
   */
  data: string;
  /**
   * Carve the road into the baked surface, as the procedural path does.
   * On by default: without it a road crossing sculpted ground is left either
   * buried or floating. Turn it off only if you sculpted the road yourself.
   */
  flattenRoad?: boolean;
}

/** Solid axis-relative box. Chassis and props collide with these. */
export interface TrackWall {
  pos: Vec3;
  /** Full extents (width, height, depth) in metres, before rotation. */
  size: Vec3;
  /** Yaw in degrees about +Y. */
  rotation?: number;
  /**
   * Pitch in degrees about the wall's own X axis, applied after yaw.
   *
   * Lets a barrier follow a climbing or falling road. Without it a long run
   * of walls on a gradient stays horizontal while the ground slopes past,
   * and the fence breaks up into a line of floating wedges.
   */
  pitch?: number;
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

/**
 * Collision geometry authored as real meshes rather than generated boxes.
 *
 * Only convex shapes are supported, and that is deliberate: cannon resolves
 * box and convex-hull collisions properly, but its triangle meshes only
 * collide reliably against spheres and rays. A concave collider would let
 * truck bodies pass straight through ramps and buildings, so the Blender
 * exporter splits concave collision volumes into convex pieces instead.
 */
export type ColliderShape =
  | { kind: 'box'; size: Vec3 }
  | {
      kind: 'convex';
      /** Flat xyz triples, in the collider's local space. */
      vertices: number[];
      /** Triangle indices into `vertices`. */
      faces: number[][];
    };

export interface TrackCollider {
  pos: Vec3;
  /** Yaw in degrees about +Y. */
  rotation?: number;
  /** Pitch in degrees about the collider's own X axis, applied after yaw. */
  pitch?: number;
  shape: ColliderShape;
  /** Free-text label, carried through for debugging. */
  name?: string;
}

export type PropKind =
  | 'tree'
  | 'palm'
  | 'deadtree'
  | 'rock'
  | 'barrel'
  | 'cone'
  | 'sign'
  | 'billboard'
  | 'flag'
  | 'tower'
  | 'crate'
  | 'arch'
  | 'ramp'
  | 'tabletop';

export interface TrackProp {
  kind: PropKind;
  pos: Vec3;
  /** Yaw in degrees. Ramps kick towards their local -Z at rotation 0. */
  rotation?: number;
  scale?: number;
  /**
   * Props default to decorative; set true to give them collision.
   *
   * Ignored for ramps, which are always solid — a ramp you cannot drive up
   * is not a ramp.
   */
  solid?: boolean;
  /**
   * Explicit dimensions in metres, meaning per kind:
   * - `ramp`: [width, height, length]
   * - `tabletop`: [width, height, length]
   * - `billboard`: [width, height, post height]
   * - `flag`: [width, height, mast height]
   *
   * Left out, each kind uses its own default. `scale` still multiplies on top.
   */
  size?: Vec3;
  /**
   * Image for the kinds that carry artwork — the face of a billboard, the
   * cloth of a flag. Falls back to a generated panel when absent or broken.
   */
  texture?: string;
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
  /**
   * Song to play on this course, as a path relative to `public/content/`.
   *
   * Left out, whatever was already playing keeps going — which is usually
   * what you want, since restarting the music at every screen change is
   * more noticeable than a song carrying across one.
   */
  music?: string;
  /** Optional; auto-generated along the road spline when absent. */
  checkpoints?: TrackCheckpoint[];
  /** Optional; auto-generated as a start grid behind checkpoint 0 when absent. */
  spawns?: { pos: Vec3; rotation: number }[];
  /**
   * Optional glTF of hand-modelled scenery, layered on top of the terrain.
   * Purely visual — give it collision with `colliders`.
   */
  sceneryModel?: string;
  /** Hand-authored collision volumes, independent of the scenery mesh. */
  colliders?: TrackCollider[];
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
  /**
   * Optional glTF replacing the procedural body and wheels. When absent, or
   * when the file fails to load, the truck falls back to `look`.
   */
  model?: VehicleModel;
}

/**
 * A modelled truck.
 *
 * The file needs one body node and one wheel node. The wheel is instanced
 * four times and placed by the physics rig, so the model only has to contain
 * a single wheel, modelled at the origin.
 *
 * Both meshes must be built around the chassis origin — the centre of mass —
 * which is what the Blender reference rig exists to show you.
 */
export interface VehicleModel {
  /** Path to the .glb, relative to the site root. */
  url: string;
  /** Node holding the body mesh. Defaults to "MTM_Body". */
  bodyNode?: string;
  /** Node holding a single wheel, modelled at the origin. Defaults to "MTM_Wheel". */
  wheelNode?: string;
  /** Uniform scale applied to the imported meshes. */
  scale?: number;
  /** Extra yaw in degrees, for a body modelled facing the wrong way. */
  yawOffset?: number;
  /**
   * Mirror the wheel on the left-hand side of the truck. Right for
   * asymmetric wheels (offset rims, directional tread), wrong for wheels
   * carrying text that would come out backwards.
   */
  mirrorLeftWheels?: boolean;
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
