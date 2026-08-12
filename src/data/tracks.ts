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
 * Roads are authored in polar form — a list of [bearing, radius, height]
 * around a centre. Monotonically increasing bearings guarantee a closed loop
 * that cannot cross itself, which is the failure mode when you hand-place
 * spline points, and it makes the shape of a circuit easy to read and tweak.
 */
function polarLoop(entries: [bearingDeg: number, radius: number, height: number][]): RoadPoint[] {
  return entries.map(([bearing, radius, height]) => {
    const a = bearing * (Math.PI / 180);
    return { pos: [Math.sin(a) * radius, height, Math.cos(a) * radius] as Vec3 };
  });
}

/** Same, but with a per-point road width override. */
function polarLoopWide(
  entries: [bearingDeg: number, radius: number, height: number, width?: number, bank?: number][],
): RoadPoint[] {
  return entries.map(([bearing, radius, height, width, bank]) => {
    const a = bearing * (Math.PI / 180);
    return {
      pos: [Math.sin(a) * radius, height, Math.cos(a) * radius] as Vec3,
      ...(width !== undefined ? { width } : {}),
      ...(bank !== undefined ? { bank } : {}),
    };
  });
}

export const TRACKS: MTMTrack[] = [
  {
    format: TRACK_FORMAT,
    version: FORMAT_VERSION,
    id: 'mesa-speedway',
    name: 'MESA SPEEDWAY',
    blurb:
      'A wide, flat bowl scraped out of the desert. Four long straights, four forgiving corners, and nothing to hit. Learn the trucks here.',
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
      amplitude: 3.5,
      frequency: 0.006,
      seed: 1101,
      features: [
        { type: 'hill', pos: [0, 0], radius: 120, height: 6 },
        { type: 'hill', pos: [-300, 260], radius: 150, height: 22 },
        { type: 'hill', pos: [320, -240], radius: 140, height: 18 },
      ],
    },
    road: {
      width: 26,
      closed: true,
      shoulder: 12,
      points: polarLoop([
        [0, 250, 2], [30, 262, 3], [60, 258, 4], [90, 250, 3],
        [120, 262, 2], [150, 258, 1], [180, 250, 0], [210, 262, 1],
        [240, 258, 2], [270, 250, 3], [300, 262, 3], [330, 258, 2],
      ]),
    },
    barriers: {
      spacing: 12,
      height: 1.5,
      thickness: 0.8,
      offset: 3,
      material: 'tire',
    },
    walls: [],
    props: [{ kind: 'arch', pos: [0, 0, 250], rotation: 90 }],
    scatter: [
      { kind: 'rock', count: 90, minRoadDistance: 26, maxRoadDistance: 220, maxSlope: 40, scale: [0.7, 2.4], solid: true },
      { kind: 'barrel', count: 24, minRoadDistance: 22, maxRoadDistance: 60, maxSlope: 14, scale: [1, 1.3], solid: true },
      { kind: 'sign', count: 14, minRoadDistance: 20, maxRoadDistance: 40, maxSlope: 16, scale: [1, 1.4] },
    ],
  },

  {
    format: TRACK_FORMAT,
    version: FORMAT_VERSION,
    id: 'copper-canyon',
    name: 'COPPER CANYON',
    blurb:
      'Cut along the canyon floor with the walls closing in. The back half narrows badly — stay off the rock and let the tail run wide.',
    difficulty: 2,
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
      amplitude: 9,
      frequency: 0.009,
      seed: 2202,
      features: [
        { type: 'ridge', points: [[-320, -300], [-120, -80], [60, 140], [280, 300]], width: 130, height: 34 },
        { type: 'ridge', points: [[300, -280], [140, -60], [-40, 180], [-260, 320]], width: 120, height: 28 },
        { type: 'crater', pos: [180, 180], radius: 70, depth: 12 },
        { type: 'hill', pos: [-260, 120], radius: 90, height: 26 },
      ],
    },
    road: {
      width: 22,
      closed: true,
      shoulder: 9,
      points: polarLoopWide([
        [0, 230, 4], [28, 255, 7], [55, 268, 10], [85, 250, 12],
        [112, 215, 11, 18], [140, 200, 8, 17], [168, 218, 5],
        [196, 248, 3], [224, 262, 2], [252, 245, 4],
        [280, 210, 7, 18], [308, 198, 8, 17], [336, 212, 6],
      ]),
    },
    barriers: {
      spacing: 11,
      height: 2.2,
      thickness: 1.0,
      offset: 2.5,
      material: 'rock',
    },
    walls: [],
    props: [{ kind: 'arch', pos: [0, 0, 230], rotation: 90 }],
    scatter: [
      { kind: 'rock', count: 160, minRoadDistance: 20, maxRoadDistance: 200, maxSlope: 45, scale: [0.8, 3.2], solid: true },
      { kind: 'tower', count: 4, minRoadDistance: 60, maxRoadDistance: 160, maxSlope: 18, scale: [0.9, 1.2], solid: true },
      { kind: 'cone', count: 40, minRoadDistance: 13, maxRoadDistance: 22, maxSlope: 20, scale: [1, 1.2] },
    ],
  },

  {
    format: TRACK_FORMAT,
    version: FORMAT_VERSION,
    id: 'pine-ridge',
    name: 'PINE RIDGE',
    blurb:
      'Logging trails through wet timber. Blind crests, trees hard against the verge, and a long downhill run that never quite straightens out.',
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
      amplitude: 14,
      frequency: 0.011,
      seed: 3303,
      features: [
        { type: 'hill', pos: [-160, -140], radius: 150, height: 40 },
        { type: 'hill', pos: [200, 180], radius: 130, height: 32 },
        { type: 'crater', pos: [-40, 220], radius: 80, depth: 14 },
      ],
    },
    road: {
      width: 19,
      closed: true,
      shoulder: 7,
      points: polarLoopWide([
        [0, 210, 10], [24, 232, 16], [48, 240, 22], [72, 224, 24],
        [96, 196, 20, 16], [120, 178, 14, 15], [144, 192, 8],
        [168, 220, 4], [192, 238, 2], [216, 232, 4],
        [240, 204, 9, 16], [264, 186, 14, 15], [288, 198, 16],
        [312, 224, 14], [336, 230, 12],
      ]),
    },
    barriers: {
      spacing: 10,
      height: 1.4,
      thickness: 0.7,
      offset: 2.2,
      material: 'wood',
    },
    walls: [],
    props: [{ kind: 'arch', pos: [0, 0, 210], rotation: 90 }],
    scatter: [
      { kind: 'tree', count: 320, minRoadDistance: 16, maxRoadDistance: 220, maxSlope: 38, scale: [0.8, 1.6], solid: true },
      { kind: 'rock', count: 70, minRoadDistance: 18, maxRoadDistance: 160, maxSlope: 42, scale: [0.6, 1.8], solid: true },
      { kind: 'crate', count: 20, minRoadDistance: 14, maxRoadDistance: 40, maxSlope: 14, scale: [1, 1.4], solid: true },
    ],
  },

  {
    format: TRACK_FORMAT,
    version: FORMAT_VERSION,
    id: 'slag-works',
    name: 'SLAG WORKS',
    blurb:
      'A dead foundry with a course bolted through it. Concrete on both sides, no run-off anywhere, and corners that arrive faster than they look.',
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
      amplitude: 5,
      frequency: 0.014,
      seed: 4404,
      features: [
        { type: 'plateau', pos: [0, 0], radius: 260, height: 2, falloff: 0.35 },
        { type: 'hill', pos: [-230, 190], radius: 90, height: 24 },
        { type: 'hill', pos: [240, -180], radius: 85, height: 20 },
      ],
    },
    road: {
      width: 17,
      closed: true,
      shoulder: 5,
      points: polarLoopWide([
        [0, 190, 2], [22, 205, 2], [44, 186, 3], [66, 150, 3, 15],
        [88, 142, 2, 14], [110, 165, 2], [132, 196, 3], [154, 205, 3],
        [176, 188, 2], [198, 152, 2, 15], [220, 144, 3, 14],
        [242, 168, 3], [264, 198, 2], [286, 206, 2], [308, 190, 3],
        [330, 168, 3],
      ]),
    },
    barriers: {
      spacing: 9,
      height: 2.0,
      thickness: 1.0,
      offset: 1.6,
      material: 'concrete',
    },
    walls: [],
    props: [{ kind: 'arch', pos: [0, 0, 190], rotation: 90 }],
    scatter: [
      { kind: 'tower', count: 14, minRoadDistance: 30, maxRoadDistance: 150, maxSlope: 25, scale: [0.8, 1.5], solid: true },
      { kind: 'crate', count: 90, minRoadDistance: 14, maxRoadDistance: 120, maxSlope: 22, scale: [0.9, 1.8], solid: true },
      { kind: 'barrel', count: 70, minRoadDistance: 12, maxRoadDistance: 90, maxSlope: 20, scale: [1, 1.4], solid: true },
      { kind: 'cone', count: 50, minRoadDistance: 10, maxRoadDistance: 18, maxSlope: 25, scale: [1, 1.2] },
    ],
  },

  {
    format: TRACK_FORMAT,
    version: FORMAT_VERSION,
    id: 'glacier-pass',
    name: 'GLACIER PASS',
    blurb:
      'High, fast and banked, with a 40-metre drop from the top of the pass to the valley floor. Carry too much speed over the crest and you will find out how far.',
    difficulty: 4,
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
      amplitude: 16,
      frequency: 0.008,
      seed: 5505,
      features: [
        { type: 'hill', pos: [0, -260], radius: 200, height: 55 },
        { type: 'hill', pos: [-280, 200], radius: 140, height: 30 },
        { type: 'ridge', points: [[-380, -380], [-200, -200], [0, -120], [220, -240], [380, -360]], width: 150, height: 45 },
      ],
    },
    road: {
      width: 24,
      closed: true,
      shoulder: 10,
      points: polarLoopWide([
        [0, 250, 6], [25, 268, 14], [50, 272, 26], [75, 258, 38, 22, 12],
        [100, 232, 44, 22, 14], [125, 218, 42, 22, 10], [150, 232, 32],
        [175, 258, 20], [200, 272, 10], [225, 268, 4], [250, 246, 2],
        [275, 224, 2, 22, -8], [300, 220, 4, 22, -10], [325, 234, 4],
        [350, 246, 4],
      ]),
    },
    barriers: {
      spacing: 12,
      height: 1.8,
      thickness: 0.9,
      offset: 3.5,
      material: 'metal',
    },
    walls: [],
    props: [{ kind: 'arch', pos: [0, 0, 250], rotation: 90 }],
    scatter: [
      { kind: 'tree', count: 200, minRoadDistance: 24, maxRoadDistance: 240, maxSlope: 34, scale: [0.7, 1.3], solid: true },
      { kind: 'rock', count: 110, minRoadDistance: 22, maxRoadDistance: 220, maxSlope: 46, scale: [0.8, 2.6], solid: true },
      { kind: 'sign', count: 20, minRoadDistance: 18, maxRoadDistance: 34, maxSlope: 18, scale: [1, 1.3] },
    ],
  },

  {
    format: TRACK_FORMAT,
    version: FORMAT_VERSION,
    id: 'bog-hollow',
    name: 'BOG HOLLOW',
    blurb:
      'Nine metres of road, standing water, and trees where the run-off should be. The heavy trucks earn their keep here and everything else swims.',
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
      segments: 165,
      amplitude: 7,
      frequency: 0.016,
      seed: 6606,
      features: [
        { type: 'crater', pos: [90, 60], radius: 60, depth: 9 },
        { type: 'crater', pos: [-110, -70], radius: 55, depth: 8 },
        { type: 'hill', pos: [-180, 170], radius: 100, height: 22 },
        { type: 'hill', pos: [190, -160], radius: 95, height: 18 },
      ],
    },
    road: {
      width: 15,
      closed: true,
      shoulder: 5,
      points: polarLoopWide([
        [0, 180, 2], [20, 198, 3], [40, 178, 4], [60, 148, 3, 13],
        [80, 158, 2], [100, 186, 2], [120, 196, 3], [140, 172, 4, 13],
        [160, 145, 3, 13], [180, 155, 2], [200, 184, 2], [220, 196, 3],
        [240, 176, 4], [260, 146, 3, 13], [280, 156, 2], [300, 186, 2],
        [320, 198, 3], [340, 190, 2],
      ]),
    },
    barriers: {
      spacing: 8,
      height: 1.3,
      thickness: 0.7,
      offset: 1.8,
      material: 'wood',
    },
    walls: [],
    props: [{ kind: 'arch', pos: [0, 0, 180], rotation: 90 }],
    scatter: [
      { kind: 'tree', count: 260, minRoadDistance: 12, maxRoadDistance: 170, maxSlope: 36, scale: [0.9, 1.7], solid: true },
      { kind: 'rock', count: 60, minRoadDistance: 12, maxRoadDistance: 140, maxSlope: 40, scale: [0.5, 1.4], solid: true },
      { kind: 'barrel', count: 30, minRoadDistance: 10, maxRoadDistance: 50, maxSlope: 18, scale: [1, 1.3], solid: true },
    ],
  },
];

export function trackById(id: string): MTMTrack {
  return TRACKS.find((t) => t.id === id) ?? TRACKS[0];
}
