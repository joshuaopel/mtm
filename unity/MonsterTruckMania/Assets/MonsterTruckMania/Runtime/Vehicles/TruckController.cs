// SPDX-License-Identifier: MIT
using UnityEngine;
using MonsterTruckMania.Simulation;

namespace MonsterTruckMania.Vehicles
{
    /// <summary>
    /// A driveable monster truck: four raycast wheels under a rigidbody, with
    /// the arcade control layer on top.
    /// </summary>
    /// <remarks>
    /// Deliberately not <c>WheelCollider</c>. The web game's handling is tuned
    /// against a raycast vehicle whose suspension force is
    /// <c>(stiffness * compression - damping * closingSpeed) * mass</c>, and
    /// every number in <see cref="VehicleSpec"/> — and every derived figure in
    /// <see cref="Handling"/> — means something in those terms.
    /// <c>WheelCollider</c> has its own spring model with its own units, so
    /// using it would mean re-tuning six trucks by feel and losing the
    /// reference numbers that keep the ports honest. Casting four rays is
    /// cheaper than that, and it is the same model the original ran.
    /// <para/>
    /// <b>Forces versus impulses.</b> The suspension and downforce are forces,
    /// in newtons. Drive, braking and tyre grip are <em>impulses</em>, applied
    /// per step, which is how the original's solver handles them: drive
    /// contributes <c>engineForce * dt</c> and braking is capped at
    /// <c>brakeForce</c> directly. That is why <c>brakeForce</c> (62) looks
    /// absurdly small next to <c>engineForce</c> (4200) and is not — at 60Hz
    /// the drive impulse is 70, so the two are comparable. Treating
    /// <c>brakeForce</c> as newtons gives a truck with no brakes.
    /// <para/>
    /// The whole thing runs in <c>FixedUpdate</c> at whatever
    /// <c>Time.fixedDeltaTime</c> is set to. 60Hz matches the original's fixed
    /// step; <see cref="Racing.RaceRunner"/> sets it, along with the 2g gravity
    /// every one of these numbers is calibrated against.
    /// </remarks>
    [RequireComponent(typeof(Rigidbody))]
    [AddComponentMenu("Monster Truck Mania/Truck Controller")]
    public sealed class TruckController : MonoBehaviour
    {
        private const int WheelCount = 4;

        [Tooltip("The truck to drive. Leave empty to use the built-in baseline.")]
        public VehicleAsset vehicle;

        [Tooltip("Layers the wheels raycast against. Exclude the truck itself.")]
        public LayerMask groundLayers = ~0;

        [Tooltip("Optional visuals, in wheel order: front-left, front-right, rear-left, rear-right.")]
        public Transform[] wheelVisuals = new Transform[WheelCount];

        [Tooltip("Draw the suspension rays and contact points in the scene view.")]
        public bool drawGizmos;

        private Rigidbody _body;
        private VehicleSpec _spec;
        private DriveModel _drive;
        private BoxCollider _chassis;
        /// <summary>True when we made the collider, so re-configuring may resize it.</summary>
        private bool _ownsChassis;

        private readonly Vector3[] _attachLocal = new Vector3[WheelCount];
        private readonly bool[] _grounded = new bool[WheelCount];
        private readonly float[] _suspensionLength = new float[WheelCount];
        private readonly float[] _suspensionForce = new float[WheelCount];
        private readonly Vector3[] _contactPoint = new Vector3[WheelCount];
        private readonly Vector3[] _contactNormal = new Vector3[WheelCount];
        private readonly float[] _wheelSpin = new float[WheelCount];

        private DriveInput _input;

        /// <summary>The spec this truck is running, once awake.</summary>
        public VehicleSpec Spec => _spec;

        /// <summary>The control layer, for anything that wants the rescue timers.</summary>
        public DriveModel Drive => _drive;

        /// <summary>Wheels touching the ground as of the last physics step.</summary>
        public int GroundedWheels { get; private set; }

        public bool Airborne => GroundedWheels == 0;

        /// <summary>Signed speed along the truck's own forward axis, m/s.</summary>
        public float ForwardSpeed => Vector3.Dot(_body.linearVelocity, transform.forward);

        public float Speed => _body.linearVelocity.magnitude;

        /// <summary>1 level, 0 on its side, -1 fully inverted.</summary>
        public float Uprightness => transform.up.y;

        private void Awake() => Configure(vehicle);

        /// <summary>
        /// Adopt a truck definition, now.
        /// </summary>
        /// <remarks>
        /// Separate from <c>Awake</c> because <c>Instantiate</c> runs Awake
        /// before the caller can touch the new object, so a race that spawns a
        /// prefab and then assigns <see cref="vehicle"/> would find every truck
        /// already built as the default one. Anything spawning a truck in code
        /// calls this straight afterwards; a truck placed in a scene with its
        /// asset set in the inspector needs nothing.
        /// </remarks>
        public void Configure(VehicleAsset asset)
        {
            vehicle = asset;
            _body = GetComponent<Rigidbody>();
            _spec = vehicle != null ? vehicle.ToSpec() : StockVehicles.BoulderHog();
            _drive = new DriveModel(_spec);

            _body.mass = (float)_spec.Mass;
            // Angular damping keeps the truck from spinning like a top after a
            // bad landing; linear damping stands in for drag we don't model.
            _body.angularDamping = 0.32f;
            _body.linearDamping = 0.01f;
            _body.interpolation = RigidbodyInterpolation.Interpolate;
            // A truck at 38 m/s covers 0.63m per 60Hz step, which is wider than
            // a wall is thick. Discrete sweeps drive straight through those.
            _body.collisionDetectionMode = CollisionDetectionMode.ContinuousDynamic;
            _body.centerOfMass = Vector3.zero;

            EnsureChassisCollider();

            for (int i = 0; i < WheelCount; i++)
            {
                _spec.WheelLayout(i, out double x, out double z);
                _attachLocal[i] = new Vector3((float)x, (float)_spec.AxleHeight, (float)z);
                _suspensionLength[i] = (float)_spec.SuspensionRest;
            }
        }

        /// <summary>What the driver is asking for this step.</summary>
        public void SetInput(DriveInput input) => _input = input;

        private void FixedUpdate()
        {
            float dt = Time.fixedDeltaTime;
            float forwardSpeed = ForwardSpeed;

            DriveDemand demand = _drive.Step(_input, forwardSpeed, dt);

            CastWheels();
            ApplySuspension(dt);
            ApplyTyreForces(demand, dt);
            ApplyDownforce(Mathf.Abs(forwardSpeed));
            ApplyAirControl(dt);
            ClampVelocities();

            _drive.UpdateRescueTimers(dt, Uprightness, Speed, _input.Parked);
            UpdateWheelVisuals(demand.SteerAngle, forwardSpeed, dt);
        }

        /// <summary>Raycast each corner and record what it found.</summary>
        private void CastWheels()
        {
            GroundedWheels = 0;
            float radius = (float)_spec.WheelRadius;
            float rest = (float)_spec.SuspensionRest;
            float travel = (float)_spec.MaxSuspensionTravel;
            float maxLength = rest + travel;

            for (int i = 0; i < WheelCount; i++)
            {
                Vector3 origin = transform.TransformPoint(_attachLocal[i]);
                Vector3 down = -transform.up;

                if (Physics.Raycast(origin, down, out RaycastHit hit, maxLength + radius,
                                    groundLayers, QueryTriggerInteraction.Ignore)
                    && hit.rigidbody != _body)
                {
                    _grounded[i] = true;
                    GroundedWheels++;
                    _suspensionLength[i] = Mathf.Clamp(hit.distance - radius, rest - travel, maxLength);
                    _contactPoint[i] = hit.point;
                    _contactNormal[i] = hit.normal;
                }
                else
                {
                    _grounded[i] = false;
                    // A wheel in the air hangs at full droop, which is what the
                    // visuals need and what the next contact measures against.
                    _suspensionLength[i] = maxLength;
                    _suspensionForce[i] = 0f;
                    _contactPoint[i] = origin + down * (maxLength + radius);
                    _contactNormal[i] = transform.up;
                }
            }
        }

        /// <summary>
        /// Spring and damper, per corner.
        /// </summary>
        /// <remarks>
        /// Stiffness and damping are per unit mass, so both are multiplied by
        /// the chassis mass here rather than being absolute rates. That is what
        /// makes a heavier truck need a proportionally higher stiffness for the
        /// same ride height, and what makes the damping <em>ratio</em>
        /// independent of mass — the property the tuning advice rests on.
        /// </remarks>
        private void ApplySuspension(float dt)
        {
            _ = dt;
            float mass = (float)_spec.Mass;
            float rest = (float)_spec.SuspensionRest;
            float maxForce = (float)_spec.MaxSuspensionForce;

            for (int i = 0; i < WheelCount; i++)
            {
                if (!_grounded[i]) continue;

                float compression = rest - _suspensionLength[i];
                Vector3 up = transform.up;
                Vector3 pointVelocity = _body.GetPointVelocity(_contactPoint[i]);
                // Positive while the spring is being compressed.
                float closingSpeed = -Vector3.Dot(pointVelocity, up);

                float damping = closingSpeed > 0f
                    ? (float)_spec.SuspensionCompression
                    : (float)_spec.SuspensionDamping;

                float force = (compression * (float)_spec.SuspensionStiffness + closingSpeed * damping) * mass;
                force = Mathf.Clamp(force, 0f, maxForce);
                _suspensionForce[i] = force;

                // Along the contact normal, not the truck's up: on a slope the
                // spring pushes away from the ground it is resting on.
                _body.AddForceAtPosition(_contactNormal[i] * force, _contactPoint[i], ForceMode.Force);
            }
        }

        /// <summary>
        /// Drive, braking and grip, as impulses at the contact patch.
        /// </summary>
        /// <remarks>
        /// The grip budget per wheel is <c>frictionSlip * suspensionForce * dt</c>
        /// — grip in proportion to load, which is what makes a truck lose the
        /// back end as it goes light over a crest. Longitudinal demand is
        /// served first and lateral gets what is left, so a truck cannot both
        /// accelerate hard and hold a tight line.
        /// <para/>
        /// The lateral impulse is applied at a point lifted towards the centre
        /// of mass by <c>rollInfluence</c>. Applied at the contact patch it
        /// would be a lever the full height of the truck and would put a
        /// monster truck on its roof in the first corner; applied at the centre
        /// of mass there would be no weight transfer to feel at all.
        /// </remarks>
        private void ApplyTyreForces(DriveDemand demand, float dt)
        {
            float driveShare = 0.25f; // four-wheel drive, as any real monster truck is
            float steerAngle = (float)demand.SteerAngle * Mathf.Rad2Deg;

            for (int i = 0; i < WheelCount; i++)
            {
                if (!_grounded[i]) continue;

                bool front = i < 2;
                bool rear = !front;

                Vector3 normal = _contactNormal[i];
                Quaternion steer = Quaternion.AngleAxis(front ? steerAngle : 0f, transform.up);
                Vector3 forward = Vector3.ProjectOnPlane(steer * transform.forward, normal).normalized;
                Vector3 right = Vector3.Cross(normal, forward).normalized;

                Vector3 pointVelocity = _body.GetPointVelocity(_contactPoint[i]);
                float forwardVelocity = Vector3.Dot(pointVelocity, forward);
                float lateralVelocity = Vector3.Dot(pointVelocity, right);

                float grip = (float)_spec.FrictionSlip * _suspensionForce[i] * dt;
                if (rear) grip *= (float)demand.RearGripFactor;

                // Longitudinal: drive as an impulse, braking as a cap on how
                // much forward speed one step may remove.
                float driveImpulse = (float)demand.EngineForce * driveShare * dt;
                float brakeCap = (float)demand.BrakeForce + (rear ? (float)demand.RearBrakeForce : 0f);
                float cornerMass = (float)_spec.Mass * driveShare;
                float brakeImpulse = Mathf.Clamp(-forwardVelocity * cornerMass, -brakeCap, brakeCap);

                float longitudinal = Mathf.Clamp(driveImpulse + brakeImpulse, -grip, grip);

                // Lateral: cancel the sideways velocity, with whatever grip is
                // left after the longitudinal demand.
                float lateralBudget = Mathf.Sqrt(Mathf.Max(0f, grip * grip - longitudinal * longitudinal));
                float lateral = Mathf.Clamp(-lateralVelocity * cornerMass, -lateralBudget, lateralBudget);

                _body.AddForceAtPosition(forward * longitudinal, _contactPoint[i], ForceMode.Impulse);

                Vector3 rollPoint = _contactPoint[i];
                Vector3 toContact = rollPoint - _body.worldCenterOfMass;
                float lift = Vector3.Dot(toContact, transform.up);
                rollPoint -= transform.up * (lift * (1f - (float)_spec.RollInfluence));
                _body.AddForceAtPosition(right * lateral, rollPoint, ForceMode.Impulse);
            }
        }

        /// <summary>
        /// Downforce, along the truck's own up axis so it still adds load on a
        /// banked or cambered surface.
        /// </summary>
        /// <remarks>
        /// Applied at the centre of mass, which is what <c>AddForce</c> does,
        /// so it adds load without adding torque. Applying it at a world point
        /// instead turns a small downforce into an enormous lever and flips the
        /// truck the moment it has any speed.
        /// </remarks>
        private void ApplyDownforce(float absSpeed)
        {
            float magnitude = (float)_drive.DownforceAt(absSpeed, Airborne);
            if (magnitude <= 0f) return;
            _body.AddForce(-transform.up * magnitude, ForceMode.Force);
        }

        private void ApplyAirControl(float dt)
        {
            _drive.AirControlSpin(_input, Airborne, dt, out double pitch, out double yaw, out double roll);
            if (pitch == 0.0 && yaw == 0.0 && roll == 0.0) return;
            // In the truck's own frame, then rotated into the world: the signs
            // only mean anything relative to the truck.
            Vector3 spin = transform.rotation * new Vector3((float)pitch, (float)yaw, (float)roll);
            _body.angularVelocity += spin;
        }

        /// <summary>
        /// Safety net against solver blow-ups.
        /// </summary>
        /// <remarks>
        /// A truck wedged into geometry can pick up absurd velocities in a
        /// single step. Clamping keeps a bad frame recoverable instead of
        /// firing the truck into orbit, where nothing downstream — camera, AI,
        /// lap logic — is valid any more.
        /// </remarks>
        private void ClampVelocities()
        {
            const float maxAngular = 12f; // rad/s, about two rotations a second
            const float maxLinear = 120f; // m/s, far above any truck's top speed

            if (_body.angularVelocity.sqrMagnitude > maxAngular * maxAngular)
            {
                _body.angularVelocity = _body.angularVelocity.normalized * maxAngular;
            }
            if (_body.linearVelocity.sqrMagnitude > maxLinear * maxLinear)
            {
                _body.linearVelocity = _body.linearVelocity.normalized * maxLinear;
            }
        }

        private void UpdateWheelVisuals(double steerAngle, float forwardSpeed, float dt)
        {
            if (wheelVisuals == null) return;
            float radius = (float)_spec.WheelRadius;
            float spinDelta = radius > 0f ? forwardSpeed / radius * Mathf.Rad2Deg * dt : 0f;

            for (int i = 0; i < WheelCount && i < wheelVisuals.Length; i++)
            {
                Transform wheel = wheelVisuals[i];
                if (wheel == null) continue;

                _wheelSpin[i] = Mathf.Repeat(_wheelSpin[i] + spinDelta, 360f);
                Vector3 local = _attachLocal[i] + Vector3.down * _suspensionLength[i];
                wheel.position = transform.TransformPoint(local);
                float steerDegrees = i < 2 ? (float)steerAngle * Mathf.Rad2Deg : 0f;
                wheel.rotation = transform.rotation
                                 * Quaternion.AngleAxis(steerDegrees, Vector3.up)
                                 * Quaternion.AngleAxis(_wheelSpin[i], Vector3.right);
            }
        }

        /// <summary>Drop the truck at a position and heading, fully at rest.</summary>
        public void Respawn(Vector3 position, float heading)
        {
            transform.SetPositionAndRotation(position, Quaternion.Euler(0f, heading * Mathf.Rad2Deg, 0f));
            _body.linearVelocity = Vector3.zero;
            _body.angularVelocity = Vector3.zero;
            _drive.Reset();
            _input = DriveInput.Idle;
            for (int i = 0; i < WheelCount; i++)
            {
                _suspensionLength[i] = (float)(_spec.SuspensionRest + _spec.MaxSuspensionTravel);
                _suspensionForce[i] = 0f;
                _grounded[i] = false;
            }
            GroundedWheels = 0;
        }

        /// <summary>
        /// Build the chassis box from the spec unless one was placed by hand.
        /// </summary>
        /// <remarks>
        /// Sized from the spec so the collision volume and the numbers the
        /// handling maths uses cannot drift apart. A hand-placed collider is
        /// left alone: a modelled truck may want a shape the box does not
        /// describe.
        /// </remarks>
        private void EnsureChassisCollider()
        {
            if (_chassis == null)
            {
                _chassis = GetComponent<BoxCollider>();
                // A collider already on the object was put there on purpose —
                // a modelled truck may want a shape a box cannot describe — so
                // it is left exactly as it is.
                if (_chassis != null) return;

                _chassis = gameObject.AddComponent<BoxCollider>();
                _ownsChassis = true;
            }
            if (!_ownsChassis) return;

            _chassis.size = new Vector3((float)_spec.ChassisWidth, (float)_spec.ChassisHeight, (float)_spec.ChassisLength);
            _chassis.center = new Vector3(0f, (float)_spec.ChassisOffsetY, 0f);
        }

        private void OnDrawGizmosSelected()
        {
            if (!drawGizmos || _spec == null) return;
            for (int i = 0; i < WheelCount; i++)
            {
                Vector3 origin = transform.TransformPoint(_attachLocal[i]);
                Gizmos.color = _grounded[i] ? Color.green : Color.red;
                Gizmos.DrawLine(origin, origin - transform.up * _suspensionLength[i]);
                Gizmos.DrawWireSphere(origin - transform.up * _suspensionLength[i], (float)_spec.WheelRadius);
            }
        }
    }
}
