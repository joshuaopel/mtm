import {
  FORMAT_VERSION,
  TRACK_FORMAT,
  type MTMTrack,
  type RoadPoint,
  type Vec3,
} from '../game/formats';

/**
 * The stock circuits.
 *
 * Roads are authored in polar form — [bearing, radius, height] around a
 * centre, with optional width and bank. Monotonically increasing bearings
 * guarantee a closed loop that cannot cross itself, which is the failure mode
 * when you hand-place spline points, and it keeps the shape of a circuit easy
 * to read and tweak.
 *
 * Elevation is where the character lives. Widely-spaced points give rolling
 * hills; the game re-splines them with Catmull-Rom, so a gentle bearing step
 * can never produce a sharp edge no matter how big the height change. Jumps
 * therefore need points packed close together — see `jump`.
 */
type PolarPoint = [bearingDeg: number, radius: number, height: number, width?: number, bank?: number];

function polarLoopWide(entries: PolarPoint[]): RoadPoint[] {
  return entries.map(([bearing, radius, height, width, bank]) => {
    const a = bearing * (Math.PI / 180);
    return {
      pos: [Math.sin(a) * radius, height, Math.cos(a) * radius] as Vec3,
      ...(width !== undefined ? { width } : {}),
      ...(bank !== undefined ? { bank } : {}),
    };
  });
}

/**
 * A table-top jump centred on a bearing.
 *
 * Four points packed into a few degrees: a run-up, a sharp lip, a flat deck,
 * and a landing ramp. At a 250m radius one degree is about 4.4m of road, so
 * these span roughly 50m — short enough that the spline keeps the lip sharp
 * enough to launch a truck rather than rounding it into a hill.
 */
function jump(
  bearing: number,
  radius: number,
  groundHeight: number,
  rise: number,
  width?: number,
): PolarPoint[] {
  return [
    [bearing - 6, radius, groundHeight, width],
    [bearing - 2, radius, groundHeight + rise, width],
    [bearing + 2, radius, groundHeight + rise, width],
    [bearing + 6, radius, groundHeight, width],
  ];
}

export const TRACKS: MTMTrack[] = [
  {
    format: TRACK_FORMAT,
    version: FORMAT_VERSION,
    id: 'mesa-speedway',
    name: 'MESA SPEEDWAY',
    blurb:
      'A wide bowl scraped out of the desert, with rolling ground and one big table-top on the back straight. Learn the trucks here, then learn to land them.',
    difficulty: 1,
    laps: 3,
    environment: {
      skyZenith: '#3a6a9a',
      skyHorizon: '#c8a878',
      fogColor: '#c8a878',
      fogDensity: 0.0055,
      sunDirection: [0.5, 0.75, 0.35],
      sunColor: '#fff0d0',
      ambientColor: '#6a6050',
      surface: 'sand',
    },
    terrain: {
      size: 900,
      segments: 180,
      amplitude: 9,
      frequency: 0.006,
      seed: 1101,
      features: [
        { type: 'hill', pos: [0, 0], radius: 130, height: 18 },
        { type: 'hill', pos: [-300, 260], radius: 160, height: 55 },
        { type: 'hill', pos: [320, -240], radius: 150, height: 48 },
        { type: 'hill', pos: [260, 280], radius: 120, height: 34 },
      ],
    },
    road: {
      width: 26,
      closed: true,
      // Wide graded verge, so the big elevation changes ease out into the
      // landscape instead of leaving the road on top of a wall of dirt.
      shoulder: 26,
      points: polarLoopWide([
        [0, 250, 4], [24, 258, 10], [48, 262, 18],
        ...jump(75, 256, 22, 11),
        [100, 250, 16], [124, 258, 8], [148, 262, 3],
        [172, 250, 2], [196, 258, 7], [220, 262, 14],
        ...jump(250, 254, 16, 9),
        [278, 250, 10], [302, 258, 6], [326, 262, 5], [350, 254, 4],
      ]),
    },
    barriers: {
      spacing: 12,
      height: 1.6,
      thickness: 0.9,
      offset: 4,
      material: 'tire',
    },
    walls: [],
    props: [{ kind: 'arch', pos: [0, 0, 250], rotation: 90 }],
    scatter: [
      { kind: 'rock', count: 90, minRoadDistance: 34, maxRoadDistance: 220, maxSlope: 46, scale: [0.9, 3.0], solid: true },
      { kind: 'barrel', count: 24, minRoadDistance: 30, maxRoadDistance: 70, maxSlope: 16, scale: [1, 1.3], solid: true },
      { kind: 'sign', count: 14, minRoadDistance: 28, maxRoadDistance: 48, maxSlope: 18, scale: [1, 1.4] },
    ],
  },

  {
    format: TRACK_FORMAT,
    version: FORMAT_VERSION,
    id: 'copper-canyon',
    name: 'COPPER CANYON',
    blurb:
      'Climbs out of the canyon floor and drops straight back into it. The rim section is thirty metres up with the walls closing in — get it wrong up there and it is a long way down.',
    difficulty: 3,
    laps: 3,
    environment: {
      skyZenith: '#2a4a7a',
      skyHorizon: '#e0a060',
      fogColor: '#d09858',
      fogDensity: 0.0075,
      sunDirection: [-0.4, 0.6, 0.6],
      sunColor: '#ffd8a0',
      ambientColor: '#584838',
      surface: 'sand',
    },
    terrain: {
      size: 900,
      segments: 190,
      amplitude: 18,
      frequency: 0.009,
      seed: 2202,
      features: [
        { type: 'ridge', points: [[-320, -300], [-120, -80], [60, 140], [280, 300]], width: 150, height: 62 },
        { type: 'ridge', points: [[300, -280], [140, -60], [-40, 180], [-260, 320]], width: 140, height: 54 },
        { type: 'crater', pos: [180, 180], radius: 80, depth: 20 },
        { type: 'hill', pos: [-260, 120], radius: 110, height: 48 },
      ],
    },
    road: {
      width: 22,
      closed: true,
      shoulder: 22,
      points: polarLoopWide([
        [0, 230, 6], [26, 255, 16], [52, 268, 28],
        [78, 250, 36, 20], [104, 215, 38, 18], [130, 200, 33, 17],
        ...jump(158, 212, 24, 10, 19),
        [186, 248, 14], [212, 262, 7], [238, 245, 4],
        [264, 210, 8, 18], [290, 198, 14, 17],
        ...jump(318, 208, 12, 8, 19),
        [344, 224, 8],
      ]),
    },
    barriers: {
      spacing: 11,
      height: 2.2,
      thickness: 1.0,
      offset: 3.0,
      material: 'rock',
    },
    walls: [],
    props: [{ kind: 'arch', pos: [0, 0, 230], rotation: 90 }],
    scatter: [
      { kind: 'rock', count: 160, minRoadDistance: 28, maxRoadDistance: 210, maxSlope: 48, scale: [0.9, 3.4], solid: true },
      { kind: 'tower', count: 4, minRoadDistance: 70, maxRoadDistance: 170, maxSlope: 20, scale: [0.9, 1.2], solid: true },
      { kind: 'cone', count: 40, minRoadDistance: 14, maxRoadDistance: 26, maxSlope: 22, scale: [1, 1.2] },
    ],
  },

  {
    format: TRACK_FORMAT,
    version: FORMAT_VERSION,
    id: 'pine-ridge',
    name: 'PINE RIDGE',
    blurb:
      'A logging road that climbs forty metres to the ridge line and comes back down the fast way. Blind crests the whole way up, trees hard against the verge, and no run-off worth the name.',
    difficulty: 3,
    laps: 3,
    environment: {
      skyZenith: '#5a7a8a',
      skyHorizon: '#a8b0a0',
      fogColor: '#98a494',
      fogDensity: 0.011,
      sunDirection: [0.3, 0.55, -0.6],
      sunColor: '#e8f0d8',
      ambientColor: '#4a5448',
      surface: 'grass',
    },
    terrain: {
      size: 800,
      segments: 180,
      amplitude: 26,
      frequency: 0.011,
      seed: 3303,
      features: [
        { type: 'hill', pos: [-160, -140], radius: 170, height: 78 },
        { type: 'hill', pos: [200, 180], radius: 150, height: 62 },
        { type: 'crater', pos: [-40, 220], radius: 90, depth: 20 },
      ],
    },
    road: {
      width: 19,
      closed: true,
      shoulder: 20,
      points: polarLoopWide([
        [0, 210, 14], [22, 232, 24], [44, 240, 36], [66, 224, 46],
        [88, 196, 48, 16], [110, 178, 42, 15],
        ...jump(136, 186, 32, 9, 17),
        [162, 220, 18], [184, 238, 9], [206, 232, 6],
        [228, 204, 12, 16], [250, 186, 20, 15], [272, 198, 26],
        ...jump(300, 216, 24, 8, 17),
        [326, 230, 20], [348, 220, 16],
      ]),
    },
    barriers: {
      spacing: 10,
      height: 1.5,
      thickness: 0.8,
      offset: 2.6,
      material: 'wood',
    },
    walls: [],
    props: [{ kind: 'arch', pos: [0, 0, 210], rotation: 90 }],
    scatter: [
      { kind: 'tree', count: 320, minRoadDistance: 22, maxRoadDistance: 220, maxSlope: 40, scale: [0.8, 1.6], solid: true },
      { kind: 'rock', count: 70, minRoadDistance: 24, maxRoadDistance: 170, maxSlope: 44, scale: [0.7, 2.0], solid: true },
      { kind: 'crate', count: 20, minRoadDistance: 20, maxRoadDistance: 48, maxSlope: 16, scale: [1, 1.4], solid: true },
    ],
  },

  {
    format: TRACK_FORMAT,
    version: FORMAT_VERSION,
    id: 'slag-works',
    name: 'SLAG WORKS',
    blurb:
      'A dead foundry with a course bolted through it, over the spoil heaps and off the loading ramps. Concrete on both sides and nowhere to put a mistake.',
    difficulty: 4,
    laps: 4,
    environment: {
      skyZenith: '#3a3a44',
      skyHorizon: '#8a7060',
      fogColor: '#6e6258',
      fogDensity: 0.014,
      sunDirection: [-0.5, 0.5, -0.4],
      sunColor: '#d8c0a0',
      ambientColor: '#484440',
      surface: 'slag',
    },
    terrain: {
      size: 700,
      segments: 170,
      amplitude: 12,
      frequency: 0.014,
      seed: 4404,
      features: [
        { type: 'plateau', pos: [0, 0], radius: 260, height: 4, falloff: 0.35 },
        { type: 'hill', pos: [-230, 190], radius: 110, height: 46 },
        { type: 'hill', pos: [240, -180], radius: 100, height: 40 },
      ],
    },
    road: {
      width: 17,
      closed: true,
      shoulder: 14,
      points: polarLoopWide([
        [0, 190, 3], [20, 205, 8], [40, 186, 14],
        ...jump(64, 152, 16, 10, 15),
        [88, 142, 10, 14], [110, 165, 5], [132, 196, 4], [154, 205, 9],
        [176, 188, 15],
        ...jump(202, 150, 16, 9, 15),
        [226, 146, 9, 14], [248, 170, 5], [270, 198, 3], [292, 206, 7],
        [314, 190, 11], [336, 168, 7],
      ]),
    },
    barriers: {
      spacing: 9,
      height: 2.0,
      thickness: 1.0,
      offset: 1.8,
      material: 'concrete',
    },
    walls: [],
    props: [{ kind: 'arch', pos: [0, 0, 190], rotation: 90 }],
    scatter: [
      { kind: 'tower', count: 14, minRoadDistance: 34, maxRoadDistance: 150, maxSlope: 26, scale: [0.8, 1.5], solid: true },
      { kind: 'crate', count: 90, minRoadDistance: 20, maxRoadDistance: 120, maxSlope: 24, scale: [0.9, 1.8], solid: true },
      { kind: 'barrel', count: 70, minRoadDistance: 18, maxRoadDistance: 90, maxSlope: 22, scale: [1, 1.4], solid: true },
      { kind: 'cone', count: 50, minRoadDistance: 11, maxRoadDistance: 19, maxSlope: 26, scale: [1, 1.2] },
    ],
  },

  {
    format: TRACK_FORMAT,
    version: FORMAT_VERSION,
    id: 'glacier-pass',
    name: 'GLACIER PASS',
    blurb:
      'Seventy metres from the valley floor to the top of the pass, banked hard through the high section and dropping the whole way home. The biggest air on the calendar, on the least grip.',
    difficulty: 5,
    laps: 3,
    environment: {
      skyZenith: '#4a6a9a',
      skyHorizon: '#d8e4ee',
      fogColor: '#c8d8e4',
      fogDensity: 0.009,
      sunDirection: [0.2, 0.8, 0.5],
      sunColor: '#ffffff',
      ambientColor: '#7a8494',
      surface: 'snow',
    },
    terrain: {
      size: 950,
      segments: 190,
      amplitude: 30,
      frequency: 0.008,
      seed: 5505,
      features: [
        { type: 'hill', pos: [0, -260], radius: 230, height: 105 },
        { type: 'hill', pos: [-280, 200], radius: 160, height: 58 },
        { type: 'ridge', points: [[-380, -380], [-200, -200], [0, -120], [220, -240], [380, -360]], width: 170, height: 88 },
      ],
    },
    road: {
      width: 24,
      closed: true,
      shoulder: 30,
      points: polarLoopWide([
        [0, 250, 8], [23, 268, 24], [46, 272, 44],
        [69, 258, 62, 22, 12], [92, 232, 72, 22, 14], [115, 218, 70, 22, 10],
        ...jump(142, 226, 56, 12, 22),
        [169, 258, 34], [192, 272, 18], [215, 268, 8], [238, 246, 4],
        [261, 224, 4, 22, -8], [284, 220, 8, 22, -10],
        ...jump(312, 228, 10, 9, 22),
        [338, 246, 8], [356, 250, 8],
      ]),
    },
    barriers: {
      spacing: 12,
      height: 1.9,
      thickness: 0.9,
      offset: 4.0,
      material: 'metal',
    },
    walls: [],
    props: [{ kind: 'arch', pos: [0, 0, 250], rotation: 90 }],
    scatter: [
      { kind: 'tree', count: 200, minRoadDistance: 32, maxRoadDistance: 250, maxSlope: 36, scale: [0.7, 1.3], solid: true },
      { kind: 'rock', count: 110, minRoadDistance: 30, maxRoadDistance: 230, maxSlope: 48, scale: [0.9, 2.8], solid: true },
      { kind: 'sign', count: 20, minRoadDistance: 26, maxRoadDistance: 44, maxSlope: 20, scale: [1, 1.3] },
    ],
  },

  {
    format: TRACK_FORMAT,
    version: FORMAT_VERSION,
    id: 'bog-hollow',
    name: 'BOG HOLLOW',
    blurb:
      'Fifteen metres of road, standing water, and a whoops section that will shake the fillings out of you. The heavy trucks earn their keep here and everything else swims.',
    difficulty: 5,
    laps: 4,
    environment: {
      skyZenith: '#3a4a3a',
      skyHorizon: '#7a7a58',
      fogColor: '#5e6448',
      fogDensity: 0.018,
      sunDirection: [0.15, 0.45, 0.7],
      sunColor: '#c8d0a0',
      ambientColor: '#3a4034',
      surface: 'mud',
    },
    terrain: {
      size: 650,
      segments: 175,
      amplitude: 14,
      frequency: 0.016,
      seed: 6606,
      features: [
        { type: 'crater', pos: [90, 60], radius: 70, depth: 16 },
        { type: 'crater', pos: [-110, -70], radius: 65, depth: 14 },
        { type: 'hill', pos: [-180, 170], radius: 120, height: 44 },
        { type: 'hill', pos: [190, -160], radius: 110, height: 38 },
      ],
    },
    road: {
      width: 15,
      closed: true,
      shoulder: 12,
      points: polarLoopWide([
        [0, 180, 3], [20, 198, 8], [40, 178, 14], [60, 148, 10, 13],
        // Whoops: tight, repeated humps that pitch the truck end over end
        // if you try to take them flat out.
        [76, 152, 16], [84, 158, 6], [92, 164, 16], [100, 172, 6],
        [108, 180, 15], [116, 188, 6],
        [136, 196, 8], [156, 172, 14, 13],
        ...jump(180, 152, 10, 9, 14),
        [204, 184, 6], [224, 196, 10], [244, 176, 15],
        [264, 146, 9, 13], [284, 156, 5], [304, 186, 6],
        [324, 198, 10], [344, 190, 6],
      ]),
    },
    barriers: {
      spacing: 8,
      height: 1.4,
      thickness: 0.8,
      offset: 2.2,
      material: 'wood',
    },
    walls: [],
    props: [{ kind: 'arch', pos: [0, 0, 180], rotation: 90 }],
    scatter: [
      { kind: 'tree', count: 260, minRoadDistance: 16, maxRoadDistance: 180, maxSlope: 38, scale: [0.9, 1.7], solid: true },
      { kind: 'rock', count: 60, minRoadDistance: 16, maxRoadDistance: 150, maxSlope: 42, scale: [0.6, 1.6], solid: true },
      { kind: 'barrel', count: 30, minRoadDistance: 14, maxRoadDistance: 56, maxSlope: 20, scale: [1, 1.3], solid: true },
    ],
  },
];

export function trackById(id: string): MTMTrack {
  return TRACKS.find((t) => t.id === id) ?? TRACKS[0];
}
