// SPDX-License-Identifier: MIT
using System.Collections.Generic;

namespace MonsterTruckMania.Simulation
{
    /// <summary>
    /// The stock truck roster, with the same numbers the web game ships.
    /// </summary>
    /// <remarks>
    /// Balance intent: no truck is strictly best. Heavy trucks carry speed
    /// through rough ground and shrug off contact but wash out in tight
    /// corners; light trucks change direction instantly but get knocked around
    /// and bounce badly on landings.
    /// <para/>
    /// Every truck states every field rather than being written as a diff
    /// against a baseline. A half-stated truck reads fine here and is useless
    /// in an inspector, where you want to see what you are about to change.
    /// The values were transcribed mechanically from
    /// <c>src/data/vehicles.ts</c> rather than retyped.
    /// <para/>
    /// The number to be careful with is <c>EngineForce</c>. Drive is applied at
    /// the contact patch, so the front wheels lift once total drive exceeds
    /// <c>weight * (COM-to-rear-axle) / (COM height)</c> — about 27kN on
    /// BOULDER HOG, which is the baseline the others vary from. Staying
    /// meaningfully under it gives a truck that squats and goes light at the
    /// front without looping onto its roof; <see cref="Handling"/> reports how
    /// close each one runs as <c>WheelieMargin</c>.
    /// </remarks>
    public static class StockVehicles
    {
        /// <summary>Every stock truck, in select-screen order.</summary>
        public static IReadOnlyList<VehicleSpec> All() => new List<VehicleSpec>
        {
            BoulderHog(),
            MudMarshal(),
            SkyRipper(),
            IronBull(),
            DustDevil(),
            NitroHawk()
        };

        /// <summary>Look a truck up by id, or null when there is no such truck.</summary>
        public static VehicleSpec ById(string id)
        {
            foreach (VehicleSpec spec in All())
            {
                if (spec.Id == id) return spec;
            }
            return null;
        }

        /// <summary>BOULDER HOG — all-round. Nothing about it is remarkable, which is exactly why nothing about it will catch you out.</summary>
        public static VehicleSpec BoulderHog() =>
            new VehicleSpec
            {
                Id = "boulder-hog",
                Name = "BOULDER HOG",
                Class = "ALL-ROUND",
                Mass = 1600,
                ChassisWidth = 2.4,
                ChassisHeight = 1,
                ChassisLength = 5.3,
                ChassisOffsetY = 0.1,
                WheelRadius = 0.92,
                WheelWidth = 0.62,
                FrontHalfTrack = 1.34,
                FrontAxleZ = 1.72,
                RearHalfTrack = 1.34,
                RearAxleZ = -1.78,
                AxleHeight = -0.35,
                SuspensionRest = 1,
                SuspensionStiffness = 20,
                SuspensionDamping = 1.2,
                SuspensionCompression = 2.3,
                MaxSuspensionTravel = 1.1,
                MaxSuspensionForce = 220000,
                FrictionSlip = 2.8,
                RollInfluence = 0.1,
                EngineForce = 4200,
                BrakeForce = 62,
                HandbrakeForce = 155,
                MaxSteer = 0.58,
                SteerRate = 2.4,
                HighSpeedSteerFactor = 0.42,
                TopSpeed = 38,
                Downforce = 2.5,
                AirControl = 2.6,
            };

        /// <summary>MUD MARSHAL — heavy. Two tonnes of stubborn. Slow to wind up, holds a line through ruts that spit lighter trucks out.</summary>
        public static VehicleSpec MudMarshal() =>
            new VehicleSpec
            {
                Id = "mud-marshal",
                Name = "MUD MARSHAL",
                Class = "HEAVY",
                Mass = 2350,
                ChassisWidth = 2.4,
                ChassisHeight = 1,
                ChassisLength = 5.3,
                ChassisOffsetY = 0.1,
                WheelRadius = 0.92,
                WheelWidth = 0.62,
                FrontHalfTrack = 1.34,
                FrontAxleZ = 1.72,
                RearHalfTrack = 1.34,
                RearAxleZ = -1.78,
                AxleHeight = -0.35,
                SuspensionRest = 1,
                SuspensionStiffness = 28,
                SuspensionDamping = 1.55,
                SuspensionCompression = 2.9,
                MaxSuspensionTravel = 1,
                MaxSuspensionForce = 300000,
                FrictionSlip = 3.3,
                RollInfluence = 0.09,
                EngineForce = 5200,
                BrakeForce = 78,
                HandbrakeForce = 155,
                MaxSteer = 0.5,
                SteerRate = 2,
                HighSpeedSteerFactor = 0.42,
                TopSpeed = 35,
                Downforce = 3.4,
                AirControl = 1.8,
            };

        /// <summary>SKY RIPPER — air. Built for the jumps: soft long-travel springs, and it steers in mid-air.</summary>
        public static VehicleSpec SkyRipper() =>
            new VehicleSpec
            {
                Id = "sky-ripper",
                Name = "SKY RIPPER",
                Class = "AIR",
                Mass = 1420,
                ChassisWidth = 2.4,
                ChassisHeight = 1,
                ChassisLength = 5.3,
                ChassisOffsetY = 0.1,
                WheelRadius = 1,
                WheelWidth = 0.62,
                FrontHalfTrack = 1.34,
                FrontAxleZ = 1.72,
                RearHalfTrack = 1.34,
                RearAxleZ = -1.78,
                AxleHeight = -0.35,
                SuspensionRest = 1.25,
                SuspensionStiffness = 16,
                SuspensionDamping = 1,
                SuspensionCompression = 2.2,
                MaxSuspensionTravel = 1.45,
                MaxSuspensionForce = 220000,
                FrictionSlip = 2.6,
                RollInfluence = 0.16,
                EngineForce = 3900,
                BrakeForce = 62,
                HandbrakeForce = 155,
                MaxSteer = 0.58,
                SteerRate = 2.4,
                HighSpeedSteerFactor = 0.42,
                TopSpeed = 39,
                Downforce = 2.5,
                AirControl = 4.2,
            };

        /// <summary>IRON BULL — muscle. All engine, no manners. Ferocious off the line and happy to move whatever is in the way.</summary>
        public static VehicleSpec IronBull() =>
            new VehicleSpec
            {
                Id = "iron-bull",
                Name = "IRON BULL",
                Class = "MUSCLE",
                Mass = 1950,
                ChassisWidth = 2.4,
                ChassisHeight = 1,
                ChassisLength = 5.3,
                ChassisOffsetY = 0.1,
                WheelRadius = 0.92,
                WheelWidth = 0.62,
                FrontHalfTrack = 1.34,
                FrontAxleZ = 1.72,
                RearHalfTrack = 1.34,
                RearAxleZ = -1.78,
                AxleHeight = -0.35,
                SuspensionRest = 1,
                SuspensionStiffness = 26,
                SuspensionDamping = 1.35,
                SuspensionCompression = 2.5,
                MaxSuspensionTravel = 0.9,
                MaxSuspensionForce = 220000,
                FrictionSlip = 2.6,
                RollInfluence = 0.1,
                EngineForce = 5600,
                BrakeForce = 62,
                HandbrakeForce = 200,
                MaxSteer = 0.52,
                SteerRate = 2.3,
                HighSpeedSteerFactor = 0.42,
                TopSpeed = 41,
                Downforce = 3.6,
                AirControl = 2.6,
            };

        /// <summary>DUST DEVIL — light. Feathery and quick to change direction. Point it early and it out-corners everything here.</summary>
        public static VehicleSpec DustDevil() =>
            new VehicleSpec
            {
                Id = "dust-devil",
                Name = "DUST DEVIL",
                Class = "LIGHT",
                Mass = 1180,
                ChassisWidth = 2.4,
                ChassisHeight = 1,
                ChassisLength = 5.3,
                ChassisOffsetY = 0.1,
                WheelRadius = 0.86,
                WheelWidth = 0.62,
                FrontHalfTrack = 1.34,
                FrontAxleZ = 1.72,
                RearHalfTrack = 1.34,
                RearAxleZ = -1.78,
                AxleHeight = -0.35,
                SuspensionRest = 1,
                SuspensionStiffness = 15,
                SuspensionDamping = 1,
                SuspensionCompression = 2.1,
                MaxSuspensionTravel = 1.15,
                MaxSuspensionForce = 220000,
                FrictionSlip = 3.1,
                RollInfluence = 0.19,
                EngineForce = 3300,
                BrakeForce = 62,
                HandbrakeForce = 155,
                MaxSteer = 0.7,
                SteerRate = 3.3,
                HighSpeedSteerFactor = 0.55,
                TopSpeed = 37,
                Downforce = 2.5,
                AirControl = 3.3,
            };

        /// <summary>NITRO HAWK — top speed. Geared for the long straights and nothing else. Brake early.</summary>
        public static VehicleSpec NitroHawk() =>
            new VehicleSpec
            {
                Id = "nitro-hawk",
                Name = "NITRO HAWK",
                Class = "TOP SPEED",
                Mass = 1650,
                ChassisWidth = 2.4,
                ChassisHeight = 1,
                ChassisLength = 5.3,
                ChassisOffsetY = 0.1,
                WheelRadius = 0.92,
                WheelWidth = 0.62,
                FrontHalfTrack = 1.34,
                FrontAxleZ = 1.72,
                RearHalfTrack = 1.34,
                RearAxleZ = -1.78,
                AxleHeight = -0.35,
                SuspensionRest = 0.9,
                SuspensionStiffness = 27,
                SuspensionDamping = 1.7,
                SuspensionCompression = 3,
                MaxSuspensionTravel = 0.8,
                MaxSuspensionForce = 220000,
                FrictionSlip = 2.5,
                RollInfluence = 0.08,
                EngineForce = 4600,
                BrakeForce = 56,
                HandbrakeForce = 155,
                MaxSteer = 0.46,
                SteerRate = 2.1,
                HighSpeedSteerFactor = 0.3,
                TopSpeed = 48,
                Downforce = 5,
                AirControl = 2.6,
            };
    }
}
