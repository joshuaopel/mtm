// SPDX-License-Identifier: MIT
using System;

namespace MonsterTruckMania.Simulation
{
    /// <summary>
    /// The derived handling numbers: what the raw tuning values actually mean.
    /// </summary>
    public struct HandlingNumbers
    {
        /// <summary>Static spring compression under the truck's own weight, in metres.</summary>
        public double RestCompression;
        /// <summary>Height of the chassis origin above flat ground, in metres.</summary>
        public double RideHeight;
        /// <summary>Undamped natural frequency of the body on its springs, in Hz.</summary>
        public double RideFrequency;
        /// <summary>Damping ratio on extension. Below 1 the truck rebounds and oscillates.</summary>
        public double ReboundDamping;
        /// <summary>Damping ratio on compression. How hard it hits the bump stops.</summary>
        public double CompressionDamping;
        /// <summary>Total drive force across all four wheels, in newtons.</summary>
        public double DriveForce;
        /// <summary>Drive force at which the front wheels lift.</summary>
        public double FrontLiftThreshold;
        /// <summary>How close the truck runs to lifting its nose, 0..1 and beyond.</summary>
        public double WheelieMargin;
        /// <summary>Peak acceleration from a standstill, in m/s squared.</summary>
        public double LaunchAcceleration;
        /// <summary>Suspension travel left before the bump stop, in metres.</summary>
        public double BumpHeadroom;
    }

    /// <summary>
    /// Turns tuning inputs into the quantities that describe how a truck feels.
    /// </summary>
    /// <remarks>
    /// A port of <c>src/game/handling.ts</c>, and the fourth implementation of
    /// these formulas — TypeScript for the web game, Python for the Blender
    /// panel, and now C# here. They are only safe to have because all of them
    /// are pinned to the same reference numbers; the offline test project
    /// checks this one against values printed from the running TypeScript. If
    /// you change a formula here, change it in the other three.
    /// <para/>
    /// The key to reading the suspension model: its force is
    /// <c>(stiffness * compression - damping * closingSpeed) * chassisMass</c>,
    /// so <c>stiffness</c> is a spring rate <em>per unit mass</em> and
    /// <c>damping</c> a damping coefficient per unit mass. Both scale with the
    /// truck, which is why a heavier truck needs a proportionally higher
    /// stiffness to sit at the same ride height — and why rest compression
    /// depends only on stiffness, with the mass cancelling out.
    /// </remarks>
    public static class Handling
    {
        /// <summary>
        /// 2g. The world runs at double gravity so trucks land instead of
        /// floating, exactly as the web game does — every number below is
        /// calibrated against it, so changing it invalidates all of them.
        /// </summary>
        public const double Gravity = 19.6;

        public static HandlingNumbers Numbers(VehicleSpec spec)
        {
            if (spec == null) throw new ArgumentNullException(nameof(spec));

            // Equilibrium: 4 * stiffness * compression * mass = mass * g, so
            // the mass cancels and compression depends only on stiffness.
            double restCompression = Math.Min(
                spec.MaxSuspensionTravel,
                Gravity / (4.0 * Math.Max(1e-3, spec.SuspensionStiffness)));

            double rideHeight =
                spec.WheelRadius + (spec.SuspensionRest - restCompression) - spec.AxleHeight;

            // Per-corner spring rate and mass. The mass factors cancel in the
            // ratio, but keeping them explicit makes the derivation checkable.
            double springRate = spec.SuspensionStiffness * spec.Mass;
            double cornerMass = spec.Mass / 4.0;
            double omega = Math.Sqrt(springRate / cornerMass);
            double rideFrequency = omega / (2.0 * Math.PI);

            double criticalDamping = 2.0 * Math.Sqrt(springRate * cornerMass);
            double reboundDamping = spec.SuspensionDamping * spec.Mass / criticalDamping;
            double compressionDamping = spec.SuspensionCompression * spec.Mass / criticalDamping;

            double driveForce = spec.EngineForce * 4.0;

            // Longitudinal load transfer lifts the front once
            //   F * comHeight >= weight * (distance from COM back to the rear axle).
            double weight = spec.Mass * Gravity;
            double rearAxleDistance = Math.Abs(spec.RearAxleZ);
            double frontLiftThreshold = weight * rearAxleDistance / Math.Max(0.01, rideHeight);

            return new HandlingNumbers
            {
                RestCompression = restCompression,
                RideHeight = rideHeight,
                RideFrequency = rideFrequency,
                ReboundDamping = reboundDamping,
                CompressionDamping = compressionDamping,
                DriveForce = driveForce,
                FrontLiftThreshold = frontLiftThreshold,
                WheelieMargin = driveForce / frontLiftThreshold,
                LaunchAcceleration = driveForce / spec.Mass,
                BumpHeadroom = spec.MaxSuspensionTravel - restCompression,
            };
        }

        /// <summary>
        /// Plain-language verdict on a damping ratio.
        /// </summary>
        /// <remarks>
        /// The thresholds are calibrated against measured drop tests rather
        /// than the textbook bands, because a raycast vehicle loses far more
        /// energy to tyre friction and to the solver than an ideal spring-mass
        /// system does. Measured from a 3.5m drop: 0.47 gives one 6cm hop,
        /// 0.21 gives two bounces, and 0.11 gives three and over two seconds
        /// of wallow.
        /// </remarks>
        public static string DampingVerdict(double ratio)
        {
            if (ratio < 0.13) return "pogo";
            if (ratio < 0.20) return "loose";
            if (ratio < 0.35) return "bouncy";
            if (ratio < 0.60) return "firm";
            if (ratio < 1.0) return "planted";
            return "dead";
        }

        /// <summary>Plain-language verdict on how close a truck is to wheelie-ing.</summary>
        public static string WheelieVerdict(double margin)
        {
            if (margin < 0.4) return "planted";
            if (margin < 0.7) return "lifts";
            if (margin < 1.0) return "wheelies";
            return "loops over";
        }
    }
}
