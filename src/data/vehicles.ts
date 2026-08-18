import { FORMAT_VERSION, VEHICLE_FORMAT, type MTMVehicle, type VehiclePhysics } from '../game/formats';

/**
 * The truck roster.
 *
 * Balance intent: no truck is strictly best. Heavy trucks carry speed through
 * rough ground and shrug off contact but wash out in tight corners; light
 * trucks change direction instantly but get knocked around and bounce badly
 * on landings. The stat bars shown on the select screen are derived from
 * these physics numbers by hand and should be updated alongside them.
 */

/**
 * Shared baseline; each truck overrides only what makes it distinct.
 *
 * These are monster trucks, not rally cars, and the numbers say so. A 66-inch
 * tyre puts the chassis about two metres up, the springs carry roughly a
 * quarter-metre of squat at rest so the body visibly pitches and rolls, and
 * there is over a metre of travel to absorb landings.
 *
 * The one number to be careful with is `engineForce`. Drive is applied at the
 * contact patch, so the front wheels lift once total drive exceeds
 * `weight x (COM-to-rear-axle) / (COM height)` — about 27kN here. Staying
 * meaningfully under that gives a truck that squats and goes light at the
 * front without looping itself onto its roof.
 */
const BASE: VehiclePhysics = {
  mass: 1600,
  chassisSize: [2.4, 1.0, 5.3],
  chassisOffset: [0, 0.1, 0],
  // 66-inch tyres, the class standard.
  wheelRadius: 0.92,
  wheelWidth: 0.62,
  // Wide stance to offset the very high centre of mass.
  frontAxle: [1.34, 1.72],
  rearAxle: [1.34, -1.78],
  axleHeight: -0.35,
  suspensionRest: 1.0,
  // Soft: rest compression is 19.6 / (4 x stiffness) = ~0.25m of visible squat.
  suspensionStiffness: 20,
  suspensionDamping: 2.1,
  suspensionCompression: 3.2,
  maxSuspensionTravel: 1.1,
  maxSuspensionForce: 220000,
  frictionSlip: 2.8,
  // Enough body roll to feel the weight transfer, short of tipping over.
  rollInfluence: 0.12,
  engineForce: 4200,
  brakeForce: 62,
  handbrakeForce: 155,
  maxSteer: 0.58,
  steerRate: 2.4,
  highSpeedSteerFactor: 0.42,
  topSpeed: 38,
  // Light: heavy downforce would pin the suspension flat and kill the wallow.
  downforce: 2.5,
  airControl: 2.6,
};

function truck(
  id: string,
  name: string,
  klass: string,
  blurb: string,
  stats: MTMVehicle['stats'],
  physics: Partial<VehiclePhysics>,
  look: MTMVehicle['look'],
): MTMVehicle {
  return {
    format: VEHICLE_FORMAT,
    version: FORMAT_VERSION,
    id,
    name,
    class: klass,
    blurb,
    stats,
    physics: { ...BASE, ...physics },
    look,
  };
}

export const VEHICLES: MTMVehicle[] = [
  truck(
    'boulder-hog',
    'BOULDER HOG',
    'ALL-ROUND',
    'The one to learn on. Nothing about it is remarkable, which is exactly why nothing about it will catch you out.',
    { speed: 6, accel: 6, grip: 7, weight: 5, suspension: 7, toughness: 6 },
    {},
    {
      style: 'pickup',
      bodyColor: '#c85a18',
      accentColor: '#f0e0c0',
      trimColor: '#3a3a38',
      glassColor: '#8ab4c8',
      rimColor: '#d8d4c0',
      livery: 'stripe',
      rollCage: true,
      stacks: true,
      lightBar: true,
    },
  ),

  truck(
    'mud-marshal',
    'MUD MARSHAL',
    'HEAVY',
    'Two tonnes of stubborn. Slow to wind up, but it holds a line through ruts that spit lighter trucks into the scenery.',
    { speed: 5, accel: 4, grip: 9, weight: 9, suspension: 8, toughness: 9 },
    {
      mass: 2350,
      engineForce: 5200,
      topSpeed: 35,
      frictionSlip: 3.3,
      maxSteer: 0.5,
      steerRate: 2.0,
      // Stiffer to carry the extra tonne without lying on its bump stops.
      suspensionStiffness: 28,
      maxSuspensionForce: 300000,
      maxSuspensionTravel: 1.0,
      rollInfluence: 0.09,
      brakeForce: 78,
      downforce: 3.4,
      airControl: 1.8,
    },
    {
      style: 'hauler',
      bodyColor: '#4a6b2c',
      accentColor: '#2a3a1c',
      trimColor: '#8a8a80',
      glassColor: '#7aa0b0',
      rimColor: '#6e6e64',
      livery: 'splatter',
      rollCage: true,
      stacks: true,
    },
  ),

  truck(
    'sky-ripper',
    'SKY RIPPER',
    'AIR',
    'Built for the jumps. Soft, long-travel springs soak up landings that would fold anything else, and it steers in mid-air.',
    { speed: 7, accel: 7, grip: 5, weight: 4, suspension: 10, toughness: 5 },
    {
      mass: 1420,
      suspensionRest: 1.25,
      // Almost a metre and a half of travel: it soaks up landings that fold
      // everything else in the field.
      maxSuspensionTravel: 1.45,
      suspensionStiffness: 16,
      suspensionDamping: 1.8,
      suspensionCompression: 2.8,
      wheelRadius: 1.0,
      engineForce: 3900,
      topSpeed: 39,
      airControl: 4.2,
      frictionSlip: 2.6,
      rollInfluence: 0.16,
    },
    {
      style: 'buggy',
      bodyColor: '#2a6ba8',
      accentColor: '#ffd020',
      trimColor: '#1a1a18',
      glassColor: '#a0c8d8',
      rimColor: '#ffd020',
      livery: 'bolt',
      rollCage: true,
    },
  ),

  truck(
    'iron-bull',
    'IRON BULL',
    'MUSCLE',
    'All engine, no manners. Ferocious off the line and happy to move anything that gets in the way, including you.',
    { speed: 8, accel: 9, grip: 5, weight: 7, suspension: 5, toughness: 8 },
    {
      mass: 1950,
      // The most drive in the field, and enough to make the nose go light.
      engineForce: 5600,
      topSpeed: 41,
      frictionSlip: 2.6,
      maxSteer: 0.52,
      steerRate: 2.3,
      suspensionStiffness: 26,
      maxSuspensionTravel: 0.9,
      handbrakeForce: 200,
      downforce: 3.6,
      rollInfluence: 0.1,
    },
    {
      style: 'muscle',
      bodyColor: '#8a1818',
      accentColor: '#ffb020',
      trimColor: '#c0c4cc',
      glassColor: '#6a8a98',
      rimColor: '#c0c4cc',
      livery: 'flames',
      stacks: true,
    },
  ),

  truck(
    'dust-devil',
    'DUST DEVIL',
    'LIGHT',
    'Feathery and quick to change direction. Point it early, stay off the kerbs, and it will out-corner everything here.',
    { speed: 6, accel: 7, grip: 8, weight: 2, suspension: 6, toughness: 3 },
    {
      mass: 1180,
      engineForce: 3300,
      topSpeed: 37,
      maxSteer: 0.7,
      steerRate: 3.3,
      highSpeedSteerFactor: 0.55,
      frictionSlip: 3.1,
      suspensionStiffness: 15,
      maxSuspensionTravel: 1.15,
      wheelRadius: 0.86,
      // Light and tall: it changes direction instantly and leans hard doing it.
      rollInfluence: 0.19,
      airControl: 3.3,
    },
    {
      style: 'flatnose',
      bodyColor: '#e0c020',
      accentColor: '#1a1a18',
      trimColor: '#b8400c',
      glassColor: '#88b0c0',
      rimColor: '#3a3a38',
      livery: 'checker',
      lightBar: true,
    },
  ),

  truck(
    'nitro-hawk',
    'NITRO HAWK',
    'TOP SPEED',
    'Geared for the long straights and nothing else. Brake early, or the first real corner will be the last thing it sees.',
    { speed: 10, accel: 8, grip: 4, weight: 5, suspension: 4, toughness: 5 },
    {
      mass: 1650,
      engineForce: 4600,
      topSpeed: 48,
      maxSteer: 0.46,
      steerRate: 2.1,
      highSpeedSteerFactor: 0.3,
      frictionSlip: 2.5,
      // Stiff and low-travel for stability at speed, which costs it dearly
      // over the rough stuff.
      suspensionStiffness: 27,
      maxSuspensionTravel: 0.8,
      suspensionRest: 0.9,
      rollInfluence: 0.08,
      downforce: 5.0,
      brakeForce: 56,
    },
    {
      style: 'crewcab',
      bodyColor: '#e8e4d0',
      accentColor: '#2a6ba8',
      trimColor: '#b8400c',
      glassColor: '#7a9ab0',
      rimColor: '#2a6ba8',
      livery: 'stripe',
      stacks: true,
      lightBar: true,
    },
  ),
];

export function vehicleById(id: string): MTMVehicle {
  return VEHICLES.find((v) => v.id === id) ?? VEHICLES[0];
}
