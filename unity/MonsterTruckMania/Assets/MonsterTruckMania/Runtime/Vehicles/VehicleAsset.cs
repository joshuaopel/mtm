// SPDX-License-Identifier: MIT
using UnityEngine;
using MonsterTruckMania.Simulation;

namespace MonsterTruckMania.Vehicles
{
    /// <summary>
    /// A truck, as an asset you can edit in the inspector.
    /// </summary>
    /// <remarks>
    /// The Unity-serialisable face of <see cref="VehicleSpec"/>. The simulation
    /// itself never sees this type — it is handed a plain <c>VehicleSpec</c> —
    /// which is what keeps the driving code testable without an editor.
    /// <para/>
    /// Fields are <c>float</c> here because that is what an inspector edits
    /// well, and <c>double</c> in the spec because the derived handling numbers
    /// are compared against the web game's to twelve decimal places. The
    /// widening happens once, in <see cref="ToSpec"/>.
    /// </remarks>
    [CreateAssetMenu(fileName = "Truck", menuName = "Monster Truck Mania/Vehicle", order = 20)]
    public sealed class VehicleAsset : ScriptableObject
    {
        [Header("Identity")]
        public string id = "truck";
        public string displayName = "TRUCK";
        [Tooltip("Class label for the select screen: HEAVY, AIR, TOP SPEED.")]
        public string vehicleClass = "ALL-ROUND";

        [Header("Body")]
        public float mass = 1600f;
        [Tooltip("Full extents of the chassis collision box.")]
        public Vector3 chassisSize = new Vector3(2.4f, 1.0f, 5.3f);
        [Tooltip("Height of the collision box above the centre of mass.")]
        public float chassisOffsetY = 0.1f;

        [Header("Wheels")]
        [Tooltip("66 inches is the class standard, which is 0.92m of radius.")]
        public float wheelRadius = 0.92f;
        public float wheelWidth = 0.62f;
        [Tooltip("Half-track (x) and longitudinal offset (z) of the front axle.")]
        public Vector2 frontAxle = new Vector2(1.34f, 1.72f);
        public Vector2 rearAxle = new Vector2(1.34f, -1.78f);
        [Tooltip("Top of the suspension strut, measured from the centre of mass.")]
        public float axleHeight = -0.35f;

        [Header("Suspension")]
        public float suspensionRest = 1.0f;
        [Tooltip("Spring rate per unit mass. Rest squat is 19.6 / (4 * this).")]
        public float suspensionStiffness = 20f;
        [Tooltip("Damping per unit mass on extension. Low values visibly rebound.")]
        public float suspensionDamping = 1.2f;
        [Tooltip("Damping per unit mass on compression.")]
        public float suspensionCompression = 2.3f;
        public float maxSuspensionTravel = 1.1f;
        public float maxSuspensionForce = 220000f;

        [Header("Grip")]
        [Tooltip("Tyre grip as a multiple of the load on the wheel.")]
        public float frictionSlip = 2.8f;
        [Range(0f, 1f)]
        [Tooltip("How much cornering load is allowed to roll the body over.")]
        public float rollInfluence = 0.10f;

        [Header("Drive")]
        [Tooltip("Per wheel, in newtons. Watch the wheelie margin when raising this.")]
        public float engineForce = 4200f;
        [Tooltip("Impulse cap per wheel, not a force — see TruckController.")]
        public float brakeForce = 62f;
        public float handbrakeForce = 155f;
        [Tooltip("Maximum steering angle in radians at low speed.")]
        public float maxSteer = 0.58f;
        [Tooltip("Radians per second of steering actuation.")]
        public float steerRate = 2.4f;
        [Range(0f, 1f)]
        [Tooltip("Steering lock is scaled towards this fraction at top speed.")]
        public float highSpeedSteerFactor = 0.42f;
        [Tooltip("Soft cap in m/s; drive tapers to nothing here.")]
        public float topSpeed = 38f;
        [Tooltip("Newtons per (m/s) squared. Heavy downforce kills the wallow.")]
        public float downforce = 2.5f;
        [Tooltip("Angular acceleration for mid-air attitude control, rad/s^2.")]
        public float airControl = 2.6f;

        /// <summary>The plain-C# spec the simulation actually drives.</summary>
        public VehicleSpec ToSpec() => new VehicleSpec
        {
            Id = id,
            Name = displayName,
            Class = vehicleClass,
            Mass = mass,
            ChassisWidth = chassisSize.x,
            ChassisHeight = chassisSize.y,
            ChassisLength = chassisSize.z,
            ChassisOffsetY = chassisOffsetY,
            WheelRadius = wheelRadius,
            WheelWidth = wheelWidth,
            FrontHalfTrack = frontAxle.x,
            FrontAxleZ = frontAxle.y,
            RearHalfTrack = rearAxle.x,
            RearAxleZ = rearAxle.y,
            AxleHeight = axleHeight,
            SuspensionRest = suspensionRest,
            SuspensionStiffness = suspensionStiffness,
            SuspensionDamping = suspensionDamping,
            SuspensionCompression = suspensionCompression,
            MaxSuspensionTravel = maxSuspensionTravel,
            MaxSuspensionForce = maxSuspensionForce,
            FrictionSlip = frictionSlip,
            RollInfluence = rollInfluence,
            EngineForce = engineForce,
            BrakeForce = brakeForce,
            HandbrakeForce = handbrakeForce,
            MaxSteer = maxSteer,
            SteerRate = steerRate,
            HighSpeedSteerFactor = highSpeedSteerFactor,
            TopSpeed = topSpeed,
            Downforce = downforce,
            AirControl = airControl,
        };

        /// <summary>Copy a plain spec in, so the stock roster can seed an asset.</summary>
        public void CopyFrom(VehicleSpec spec)
        {
            if (spec == null) return;
            id = spec.Id;
            displayName = spec.Name;
            vehicleClass = spec.Class;
            mass = (float)spec.Mass;
            chassisSize = new Vector3((float)spec.ChassisWidth, (float)spec.ChassisHeight, (float)spec.ChassisLength);
            chassisOffsetY = (float)spec.ChassisOffsetY;
            wheelRadius = (float)spec.WheelRadius;
            wheelWidth = (float)spec.WheelWidth;
            frontAxle = new Vector2((float)spec.FrontHalfTrack, (float)spec.FrontAxleZ);
            rearAxle = new Vector2((float)spec.RearHalfTrack, (float)spec.RearAxleZ);
            axleHeight = (float)spec.AxleHeight;
            suspensionRest = (float)spec.SuspensionRest;
            suspensionStiffness = (float)spec.SuspensionStiffness;
            suspensionDamping = (float)spec.SuspensionDamping;
            suspensionCompression = (float)spec.SuspensionCompression;
            maxSuspensionTravel = (float)spec.MaxSuspensionTravel;
            maxSuspensionForce = (float)spec.MaxSuspensionForce;
            frictionSlip = (float)spec.FrictionSlip;
            rollInfluence = (float)spec.RollInfluence;
            engineForce = (float)spec.EngineForce;
            brakeForce = (float)spec.BrakeForce;
            handbrakeForce = (float)spec.HandbrakeForce;
            maxSteer = (float)spec.MaxSteer;
            steerRate = (float)spec.SteerRate;
            highSpeedSteerFactor = (float)spec.HighSpeedSteerFactor;
            topSpeed = (float)spec.TopSpeed;
            downforce = (float)spec.Downforce;
            airControl = (float)spec.AirControl;
        }
    }
}
