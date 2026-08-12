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

/** Shared baseline; each truck overrides only what makes it distinct. */
const BASE: VehiclePhysics = {
  mass: 1400,
  chassisSize: [2.3, 1.0, 5.2],
  chassisOffset: [0, 0.1, 0],
  wheelRadius: 0.66,
  wheelWidth: 0.52,
  frontAxle: [1.12, 1.6],
  rearAxle: [1.12, -1.65],
  axleHeight: -0.18,
  suspensionRest: 0.62,
  suspensionStiffness: 36,
  suspensionDamping: 2.6,
  suspensionCompression: 4.2,
  maxSuspensionTravel: 0.6,
  maxSuspensionForce: 140000,
  frictionSlip: 2.7,
  rollInfluence: 0.06,
  engineForce: 5200,
  brakeForce: 55,
  handbrakeForce: 140,
  maxSteer: 0.55,
  steerRate: 2.6,
  highSpeedSteerFactor: 0.42,
  topSpeed: 42,
  downforce: 4.5,
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
      mass: 2050,
      engineForce: 6200,
      topSpeed: 38,
      frictionSlip: 3.2,
      maxSteer: 0.48,
      steerRate: 2.1,
      suspensionStiffness: 44,
      maxSuspensionForce: 190000,
      brakeForce: 70,
      downforce: 6.0,
      airControl: 1.9,
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
      mass: 1250,
      suspensionRest: 0.78,
      maxSuspensionTravel: 0.85,
      suspensionStiffness: 30,
      suspensionDamping: 2.2,
      wheelRadius: 0.72,
      engineForce: 5000,
      topSpeed: 44,
      airControl: 4.4,
      frictionSlip: 2.5,
      rollInfluence: 0.09,
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
      mass: 1750,
      engineForce: 7400,
      topSpeed: 46,
      frictionSlip: 2.5,
      maxSteer: 0.5,
      steerRate: 2.4,
      suspensionStiffness: 42,
      maxSuspensionTravel: 0.48,
      handbrakeForce: 180,
      downforce: 5.5,
      rollInfluence: 0.05,
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
      mass: 1050,
      engineForce: 4300,
      topSpeed: 40,
      maxSteer: 0.66,
      steerRate: 3.4,
      highSpeedSteerFactor: 0.55,
      frictionSlip: 3.0,
      suspensionStiffness: 32,
      rollInfluence: 0.1,
      airControl: 3.4,
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
      mass: 1450,
      engineForce: 6000,
      topSpeed: 54,
      maxSteer: 0.44,
      steerRate: 2.2,
      highSpeedSteerFactor: 0.3,
      frictionSlip: 2.4,
      suspensionStiffness: 40,
      maxSuspensionTravel: 0.5,
      downforce: 8.0,
      brakeForce: 50,
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
