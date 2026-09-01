// SPDX-License-Identifier: MIT
using System;

namespace MonsterTruckMania.Simulation
{
    /// <summary>
    /// Everything the simulation needs to know about a truck.
    /// </summary>
    /// <remarks>
    /// The same field set as the web game's <c>VehiclePhysics</c>, and for the
    /// same reason: these are the raw inputs the physics consumes, stored
    /// exactly as they are tuned. What a truck actually <em>feels</em> like is
    /// derived from them in <see cref="Handling"/> rather than stored, so the
    /// two can never disagree.
    /// <para/>
    /// Deliberately free of UnityEngine, like the generation core: it compiles
    /// under a plain .NET SDK, which is what lets the derived numbers be
    /// checked against values printed from the running TypeScript instead of
    /// being trusted to read the same. <see cref="Vehicles.VehicleAsset"/> is
    /// the Unity-serialisable face of it.
    /// <para/>
    /// Axes are the project's usual: X right, Y up, Z forward.
    /// </remarks>
    public sealed class VehicleSpec
    {
        public string Id = "truck";
        public string Name = "TRUCK";
        /// <summary>Class label for the select screen — "HEAVY", "AIR".</summary>
        public string Class = "ALL-ROUND";

        public double Mass = 1600;
        /// <summary>Full extents of the chassis collision box.</summary>
        public double ChassisWidth = 2.4;
        public double ChassisHeight = 1.0;
        public double ChassisLength = 5.3;
        /// <summary>Offset of the collision box from the centre of mass.</summary>
        public double ChassisOffsetY = 0.1;

        public double WheelRadius = 0.92;
        public double WheelWidth = 0.62;

        /// <summary>Half-track of the front axle: distance from centre to a wheel.</summary>
        public double FrontHalfTrack = 1.34;
        /// <summary>Longitudinal position of the front axle, forward positive.</summary>
        public double FrontAxleZ = 1.72;
        public double RearHalfTrack = 1.34;
        public double RearAxleZ = -1.78;
        /// <summary>Height of the suspension attachment relative to the centre of mass.</summary>
        public double AxleHeight = -0.35;

        public double SuspensionRest = 1.0;
        /// <summary>Spring rate per unit mass. See the note in <see cref="Handling"/>.</summary>
        public double SuspensionStiffness = 20;
        /// <summary>Damping per unit mass on extension.</summary>
        public double SuspensionDamping = 1.2;
        /// <summary>Damping per unit mass on compression.</summary>
        public double SuspensionCompression = 2.3;
        public double MaxSuspensionTravel = 1.1;
        public double MaxSuspensionForce = 220000;

        /// <summary>Tyre grip, as a multiple of the load on the wheel.</summary>
        public double FrictionSlip = 2.8;
        /// <summary>How much lateral load transfer is allowed to roll the body, 0..1.</summary>
        public double RollInfluence = 0.10;

        public double EngineForce = 4200;
        public double BrakeForce = 62;
        public double HandbrakeForce = 155;

        /// <summary>Maximum steering angle in radians, at low speed.</summary>
        public double MaxSteer = 0.58;
        /// <summary>Radians per second of steering actuation.</summary>
        public double SteerRate = 2.4;
        /// <summary>Steering lock is scaled towards this fraction at top speed.</summary>
        public double HighSpeedSteerFactor = 0.42;
        /// <summary>Soft speed cap in m/s; drive tapers to nothing here.</summary>
        public double TopSpeed = 38;
        /// <summary>Downforce coefficient, newtons per (m/s) squared.</summary>
        public double Downforce = 2.5;
        /// <summary>Angular acceleration available for mid-air attitude control.</summary>
        public double AirControl = 2.6;

        /// <summary>Wheel positions in chassis space, front axle first.</summary>
        /// <remarks>
        /// The order is load-bearing everywhere downstream: 0 and 1 are the
        /// front pair and the only ones that steer, 2 and 3 are the rear pair
        /// and the only ones the handbrake locks. Left before right.
        /// </remarks>
        public void WheelLayout(int index, out double x, out double z)
        {
            switch (index)
            {
                case 0: x = -FrontHalfTrack; z = FrontAxleZ; break;
                case 1: x = FrontHalfTrack; z = FrontAxleZ; break;
                case 2: x = -RearHalfTrack; z = RearAxleZ; break;
                case 3: x = RearHalfTrack; z = RearAxleZ; break;
                default: throw new ArgumentOutOfRangeException(nameof(index), index, "a truck has four wheels");
            }
        }

        public VehicleSpec Clone() => (VehicleSpec)MemberwiseClone();
    }
}
