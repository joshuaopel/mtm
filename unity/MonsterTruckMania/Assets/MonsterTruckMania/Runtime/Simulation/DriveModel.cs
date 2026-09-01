// SPDX-License-Identifier: MIT
using System;
using MonsterTruckMania.Generation;

namespace MonsterTruckMania.Simulation
{
    /// <summary>What a driver — player or AI — is asking the truck to do.</summary>
    public struct DriveInput
    {
        /// <summary>0..1.</summary>
        public double Throttle;
        /// <summary>0..1; doubles as reverse once the truck has stopped.</summary>
        public double Brake;
        /// <summary>-1 (left) .. 1 (right).</summary>
        public double Steer;
        public bool Handbrake;
        /// <summary>
        /// Hold the truck stationary whatever else is asked.
        /// </summary>
        /// <remarks>
        /// Needed for the pre-race grid. Holding the line with <c>Brake = 1</c>
        /// instead would be read as "stopped and still braking", which is
        /// exactly the condition that engages reverse, and the whole field
        /// would trickle backwards off the start line.
        /// </remarks>
        public bool Parked;

        public static DriveInput Idle => new DriveInput();
    }

    /// <summary>The per-wheel demand the drive model resolved this step.</summary>
    public struct DriveDemand
    {
        /// <summary>Engine force per wheel, newtons. Positive drives forward.</summary>
        public double EngineForce;
        /// <summary>Brake force per wheel.</summary>
        public double BrakeForce;
        /// <summary>Extra brake on the rear pair only, from the handbrake.</summary>
        public double RearBrakeForce;
        /// <summary>Grip multiplier for the rear pair; below 1 while the handbrake is up.</summary>
        public double RearGripFactor;
        /// <summary>Steering angle at the front wheels, radians, positive right.</summary>
        public double SteerAngle;
    }

    /// <summary>
    /// The arcade control layer: what the driver asks for, turned into forces.
    /// </summary>
    /// <remarks>
    /// A port of the control half of <c>src/game/Vehicle.ts</c>. This is where
    /// the "mania" lives — a literal vehicle sim is miserable to drive with a
    /// keyboard, so it does what the era's racers did: forgiving grip,
    /// speed-sensitive steering, mid-air attitude control and a brake pedal
    /// that becomes reverse once you have stopped.
    /// <para/>
    /// Kept free of Unity, and kept separate from the thing that applies the
    /// forces, for one reason: every decision in here is a rule rather than a
    /// physical law — where reverse engages, when engine braking applies, how
    /// the steering lock tapers — and rules are worth testing. The offline
    /// test project drives it directly.
    /// <para/>
    /// It holds one piece of state, the actuated steering angle, because
    /// steering moves towards its target at a bounded rate rather than
    /// snapping: instant steering makes a two-tonne truck feel weightless.
    /// </remarks>
    public sealed class DriveModel
    {
        /// <summary>
        /// Below this speed (m/s) a truck counts as going nowhere.
        /// </summary>
        /// <remarks>
        /// Above walking pace, so a genuinely slow crawl out of a rut does not
        /// read as stuck, but low enough that grinding along a wall does.
        /// </remarks>
        public const double StuckSpeed = 2.0;

        private readonly VehicleSpec _spec;

        /// <summary>
        /// Actuated steering angle in player space: positive is a right turn.
        /// </summary>
        public double SteerAngle { get; private set; }

        /// <summary>Seconds spent inverted and stationary.</summary>
        public double UpsideDownFor { get; private set; }

        /// <summary>Seconds spent going nowhere, for any reason.</summary>
        public double StuckFor { get; private set; }

        /// <summary>True once the truck has been on its roof long enough to need rescuing.</summary>
        public bool NeedsRescue { get; private set; }

        public DriveModel(VehicleSpec spec)
        {
            _spec = spec ?? throw new ArgumentNullException(nameof(spec));
        }

        /// <summary>Put the model back to its resting state after a respawn.</summary>
        public void Reset()
        {
            SteerAngle = 0.0;
            UpsideDownFor = 0.0;
            StuckFor = 0.0;
            NeedsRescue = false;
        }

        /// <summary>
        /// Resolve this step's demand.
        /// </summary>
        /// <param name="input">What the driver is asking for.</param>
        /// <param name="forwardSpeed">Signed speed along the truck's own forward axis.</param>
        /// <param name="dt">Step length, seconds.</param>
        public DriveDemand Step(DriveInput input, double forwardSpeed, double dt)
        {
            double absSpeed = Math.Abs(forwardSpeed);
            var demand = new DriveDemand
            {
                SteerAngle = UpdateSteering(input.Steer, absSpeed, dt),
                RearGripFactor = 1.0,
            };

            if (input.Parked)
            {
                // Twice the handbrake: the grid must not creep, and a truck
                // sat on a slope with only the handbrake on will.
                demand.BrakeForce = _spec.HandbrakeForce * 2.0;
                return demand;
            }

            double engineForce = 0.0;
            double brakeForce = 0.0;

            if (input.Throttle > 0.01)
            {
                // Taper drive to nothing approaching the soft top speed, which
                // caps the truck without a hard clamp on its velocity.
                double headroom = MathUtil.Clamp01(1.0 - forwardSpeed / _spec.TopSpeed);
                engineForce = _spec.EngineForce * input.Throttle * headroom;
            }

            if (input.Brake > 0.01)
            {
                if (forwardSpeed > 1.0)
                {
                    // Moving forward: the brake pedal is a brake.
                    brakeForce = _spec.BrakeForce * input.Brake;
                }
                else
                {
                    // Stopped or already rolling back: it becomes reverse,
                    // capped lower than forward drive so reversing never feels
                    // like a shortcut.
                    double headroom = MathUtil.Clamp01(1.0 + forwardSpeed / (_spec.TopSpeed * 0.45));
                    engineForce = -_spec.EngineForce * 0.55 * input.Brake * headroom;
                }
            }

            if (input.Throttle < 0.01 && input.Brake < 0.01)
            {
                if (absSpeed > 0.5)
                {
                    // Light engine braking, so lifting off actually slows you.
                    brakeForce = _spec.BrakeForce * 0.04;
                }
                else
                {
                    // Hold the truck once it has stopped. The wheels have no
                    // rolling resistance of their own, so without this a parked
                    // truck slides away down the gentlest camber.
                    brakeForce = _spec.HandbrakeForce;
                }
            }

            demand.EngineForce = engineForce;
            demand.BrakeForce = brakeForce;

            if (input.Handbrake)
            {
                demand.RearBrakeForce = _spec.HandbrakeForce;
                // Break rear traction, so the handbrake rotates the truck
                // rather than merely stopping it.
                demand.RearGripFactor = 0.35;
            }

            return demand;
        }

        /// <summary>
        /// Angular velocity to add for mid-air attitude control, in the truck's
        /// own frame, or zero when any wheel is down.
        /// </summary>
        /// <remarks>
        /// Without this one bad ramp ends the race, and every arcade racer of
        /// the period let you save a jump.
        /// <para/>
        /// <c>AirControl</c> is an angular acceleration in rad/s squared, so
        /// the change in angular velocity over a step is simply rate * dt. It
        /// is emphatically not a torque: scaling it by mass injects tens of
        /// rad/s every frame and detonates the solver instantly.
        /// <para/>
        /// The signs follow from the +Z-forward frame: +X spins the nose down,
        /// +Y yaws left, +Z rolls the right-hand side down.
        /// </remarks>
        public void AirControlSpin(DriveInput input, bool airborne, double dt,
                                   out double pitch, out double yaw, out double roll)
        {
            pitch = yaw = roll = 0.0;
            if (!airborne) return;

            double delta = _spec.AirControl * dt;
            // Nose up under throttle, nose down under brake, to set up landings.
            pitch = (input.Brake - input.Throttle) * delta;
            yaw = -input.Steer * delta * 0.8;
            roll = input.Steer * delta * 0.35; // a little roll into the yaw
        }

        /// <summary>Downforce magnitude at this speed, along the truck's own up axis.</summary>
        /// <remarks>
        /// Along the truck's up axis rather than the world's, so it still adds
        /// load on a banked or cambered surface. Whatever applies it must do so
        /// at the centre of mass: applied at a world point it becomes a lever
        /// hundreds of metres long and flips the truck as soon as it has speed.
        /// </remarks>
        public double DownforceAt(double absSpeed, bool airborne)
        {
            if (_spec.Downforce <= 0.0 || airborne) return 0.0;
            return _spec.Downforce * absSpeed * absSpeed;
        }

        /// <summary>
        /// Track the two ways a truck stops being able to race: on its roof,
        /// and going nowhere.
        /// </summary>
        /// <param name="uprightness">1 level, 0 on its side, -1 fully inverted.</param>
        /// <param name="speed">Unsigned speed, m/s.</param>
        public void UpdateRescueTimers(double dt, double uprightness, double speed, bool parked)
        {
            // Only count time spent inverted *and* essentially stationary, so a
            // barrel roll mid-jump does not trigger a rescue.
            UpsideDownFor = uprightness < 0.15 && speed < 2.5 ? UpsideDownFor + dt : 0.0;
            NeedsRescue = UpsideDownFor > 2.5;

            // Separately, going nowhere for any reason: wedged in scenery,
            // beached, or facing a wall with the throttle buried. A truck held
            // on the grid is not stuck.
            StuckFor = speed < StuckSpeed && !parked ? StuckFor + dt : 0.0;
        }

        private double UpdateSteering(double steer, double absSpeed, double dt)
        {
            // Taper the steering lock as speed rises, or the truck becomes
            // undriveable above about 20 m/s.
            double speedFactor = MathUtil.Clamp01(absSpeed / _spec.TopSpeed);
            double maxSteer = _spec.MaxSteer * (1.0 - speedFactor * (1.0 - _spec.HighSpeedSteerFactor));

            double target = MathUtil.Clamp(steer, -1.0, 1.0) * maxSteer;
            double maxDelta = _spec.SteerRate * dt;
            SteerAngle += MathUtil.Clamp(target - SteerAngle, -maxDelta, maxDelta);
            return SteerAngle;
        }
    }
}
