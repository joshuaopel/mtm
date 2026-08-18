import type { VehiclePhysics } from './formats';

/**
 * Derived handling numbers.
 *
 * The vehicle format stores raw physics inputs — spring stiffness, damping,
 * engine force — because that is what the simulation consumes. None of them
 * tell you how the truck will actually *feel*. These functions turn them
 * into the quantities that do, so both the in-game tuning overlay and the
 * Blender panel can show the same thing.
 *
 * The equivalent Python lives in `blender/mtm_tools/handling.py`. If you
 * change a formula here, change it there.
 *
 * The key to reading cannon's suspension: its force is
 *
 *     (stiffness * compression - damping * closingSpeed) * chassisMass
 *
 * so `stiffness` is really a spring rate per unit mass, and `damping` a
 * damping coefficient per unit mass. Both scale with the truck, which is why
 * a heavy truck needs a proportionally higher stiffness to sit at the same
 * ride height.
 */

/** 2g. The world runs at double gravity so trucks land instead of floating. */
export const GRAVITY = 19.6;

export interface HandlingNumbers {
  /** Static spring compression under the truck's own weight, in metres. */
  restCompression: number;
  /** Height of the chassis origin above flat ground, in metres. */
  rideHeight: number;
  /** Undamped natural frequency of the body on its springs, in Hz. */
  rideFrequency: number;
  /** Damping ratio on extension. Below 1 the truck rebounds and oscillates. */
  reboundDamping: number;
  /** Damping ratio on compression. Controls how hard it hits its bump stops. */
  compressionDamping: number;
  /** Total drive force across all four wheels, in newtons. */
  driveForce: number;
  /**
   * Drive force at which the front wheels lift. Exceed it and the truck
   * wheelies; exceed it hard and it loops onto its roof.
   */
  frontLiftThreshold: number;
  /** How close the truck runs to lifting its nose, 0..1+. */
  wheelieMargin: number;
  /** Peak acceleration from a standstill, in m/s^2. */
  launchAcceleration: number;
  /** Suspension travel left before the bump stop, in metres. */
  bumpHeadroom: number;
}

export function handlingNumbers(physics: VehiclePhysics): HandlingNumbers {
  // Equilibrium: 4 * stiffness * compression * mass = mass * g, so the mass
  // cancels and compression depends only on stiffness.
  const restCompression = Math.min(
    physics.maxSuspensionTravel,
    GRAVITY / (4 * Math.max(1e-3, physics.suspensionStiffness)),
  );

  const rideHeight =
    physics.wheelRadius + (physics.suspensionRest - restCompression) - physics.axleHeight;

  // Per-corner spring rate and mass. The mass factors cancel in the ratio,
  // but keeping them explicit makes the derivation checkable.
  const springRate = physics.suspensionStiffness * physics.mass;
  const cornerMass = physics.mass / 4;
  const omega = Math.sqrt(springRate / cornerMass);
  const rideFrequency = omega / (2 * Math.PI);

  const criticalDamping = 2 * Math.sqrt(springRate * cornerMass);
  const reboundDamping = (physics.suspensionDamping * physics.mass) / criticalDamping;
  const compressionDamping = (physics.suspensionCompression * physics.mass) / criticalDamping;

  const driveForce = physics.engineForce * 4;

  // Longitudinal load transfer lifts the front once
  //   F * comHeight >= weight * (distance from COM back to the rear axle).
  const weight = physics.mass * GRAVITY;
  const rearAxleDistance = Math.abs(physics.rearAxle[1]);
  const frontLiftThreshold = (weight * rearAxleDistance) / Math.max(0.01, rideHeight);

  return {
    restCompression,
    rideHeight,
    rideFrequency,
    reboundDamping,
    compressionDamping,
    driveForce,
    frontLiftThreshold,
    wheelieMargin: driveForce / frontLiftThreshold,
    launchAcceleration: driveForce / physics.mass,
    bumpHeadroom: physics.maxSuspensionTravel - restCompression,
  };
}

/**
 * Plain-language verdict on a damping ratio.
 *
 * Thresholds are calibrated against measured drop tests rather than the
 * textbook bands, because a raycast vehicle loses far more energy to tyre
 * friction and the solver than an ideal spring-mass system does. Measured
 * from a 3.5m drop: 0.47 gives one 6cm hop, 0.21 gives two bounces, and
 * 0.11 gives three and over two seconds of wallow.
 */
export function dampingVerdict(ratio: number): string {
  if (ratio < 0.13) return 'pogo';
  if (ratio < 0.20) return 'loose';
  if (ratio < 0.35) return 'bouncy';
  if (ratio < 0.60) return 'firm';
  if (ratio < 1.0) return 'planted';
  return 'dead';
}

/** Plain-language verdict on how close the truck is to wheelie-ing. */
export function wheelieVerdict(margin: number): string {
  if (margin < 0.4) return 'planted';
  if (margin < 0.7) return 'lifts';
  if (margin < 1.0) return 'wheelies';
  return 'loops over';
}
