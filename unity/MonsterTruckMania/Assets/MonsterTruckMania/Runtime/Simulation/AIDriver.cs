// SPDX-License-Identifier: MIT
using System;
using MonsterTruckMania.Generation;

namespace MonsterTruckMania.Simulation
{
    public enum Difficulty
    {
        Rookie,
        Pro,
        Veteran,
    }

    /// <summary>How hard one class of opponent drives.</summary>
    public struct DifficultyProfile
    {
        /// <summary>Fraction of the truck's top speed the AI aims for.</summary>
        public double PaceFactor;
        /// <summary>How far ahead it looks when steering, in metres.</summary>
        public double Lookahead;
        /// <summary>How hard it slows for curvature it can see coming.</summary>
        public double CornerCaution;
        /// <summary>Random lateral wander, in metres — keeps the field from single-filing.</summary>
        public double Wander;
        /// <summary>Reaction lag on the steering, in seconds.</summary>
        public double Reaction;
        /// <summary>Speed boost applied when trailing the player badly.</summary>
        public double CatchUp;

        public static DifficultyProfile For(Difficulty difficulty)
        {
            switch (difficulty)
            {
                case Difficulty.Rookie:
                    return new DifficultyProfile { PaceFactor = 0.72, Lookahead = 16, CornerCaution = 1.5, Wander = 3.5, Reaction = 0.22, CatchUp = 0.05 };
                case Difficulty.Veteran:
                    return new DifficultyProfile { PaceFactor = 0.97, Lookahead = 24, CornerCaution = 0.92, Wander = 1.2, Reaction = 0.08, CatchUp = 0.16 };
                default:
                    return new DifficultyProfile { PaceFactor = 0.86, Lookahead = 20, CornerCaution = 1.15, Wander = 2.2, Reaction = 0.14, CatchUp = 0.1 };
            }
        }
    }

    /// <summary>Where a truck is and what it is doing, as the AI sees it.</summary>
    public struct DriverView
    {
        public Vec3 Position;
        /// <summary>Unit heading in the XZ plane.</summary>
        public Vec3 Forward;
        /// <summary>Signed speed along the truck's own forward axis.</summary>
        public double ForwardSpeed;
        public int GroundedWheels;
    }

    /// <summary>
    /// Waypoint-following AI.
    /// </summary>
    /// <remarks>
    /// It drives the same spline the road is built from, aiming at a point some
    /// distance ahead and braking for curvature it can see coming. Deliberately
    /// not a racing-line optimiser: a slightly scruffy opponent that
    /// occasionally runs wide is more fun to race than a perfect one, and it
    /// matches how the originals felt.
    /// <para/>
    /// Ported from <c>src/game/AIDriver.ts</c>. Pure C#, taking a
    /// <see cref="DriverView"/> in and handing a <see cref="DriveInput"/> back,
    /// so a lap of AI behaviour can be simulated in the offline tests without
    /// a physics engine underneath it.
    /// </remarks>
    public sealed class AIDriver
    {
        private readonly RoadPath _road;
        private readonly VehicleSpec _spec;
        private readonly DifficultyProfile _profile;

        /// <summary>Lateral offset from the centreline this driver prefers.</summary>
        private readonly double _laneOffset;
        private double _wanderPhase;
        private double _smoothedSteer;

        /// <summary>Seconds spent barely moving; triggers a reverse-out.</summary>
        private double _stuckTimer;
        private double _reverseTimer;

        public AIDriver(VehicleSpec spec, RoadPath road, Difficulty difficulty, int seed)
        {
            _spec = spec ?? throw new ArgumentNullException(nameof(spec));
            _road = road ?? throw new ArgumentNullException(nameof(road));
            _profile = DifficultyProfile.For(difficulty);

            var rng = new Rng(seed);
            _laneOffset = rng.Spread(4.0);
            _wanderPhase = rng.Range(0.0, Math.PI * 2.0);
        }

        /// <summary>
        /// Produce this step's controls.
        /// </summary>
        /// <param name="leaderProgress">
        /// Distance covered along the course by whoever is furthest ahead, and
        /// this driver's own, used only for gentle rubber-banding.
        /// </param>
        public DriveInput Step(double dt, DriverView view, double leaderProgress, double ownProgress)
        {
            RoadQuery query = _road.Query(view.Position.X, view.Position.Z);

            if (UpdateStuckState(dt, view))
            {
                return ReverseOut(query.Lateral);
            }

            _wanderPhase += dt * 0.6;

            // Aim further ahead the faster we are going, so the line smooths
            // out with speed instead of sawing at the wheel.
            double speed = Math.Max(0.0, view.ForwardSpeed);
            double lookaheadMetres = _profile.Lookahead + speed * 0.55;
            int lookaheadSamples = _road.Step > 0.0
                ? (int)Math.Round(lookaheadMetres / _road.Step, MidpointRounding.AwayFromZero)
                : 0;
            int targetIndex = query.Index + lookaheadSamples;

            Vec3 targetPoint = _road.PointAt(targetIndex);
            Vec3 right = _road.RightAt(_road.Wrap(targetIndex));

            // Sit off-centre, drifting slowly, so the pack spreads across the
            // road rather than forming a queue on the centreline.
            double wander = Math.Sin(_wanderPhase) * _profile.Wander;
            double maxOffset = Math.Max(0.0, _road.Width * 0.5 - 2.5);
            double offset = MathUtil.Clamp(_laneOffset + wander, -maxOffset, maxOffset);
            targetPoint += right * offset;

            double steer = SteerTowards(targetPoint, view, dt);
            ChoosePace(query.Index, speed, leaderProgress, ownProgress, out double throttle, out double brake);

            return new DriveInput { Steer = steer, Throttle = throttle, Brake = brake };
        }

        /// <summary>Steering towards a world point, in the truck's own frame.</summary>
        private double SteerTowards(Vec3 target, DriverView view, double dt)
        {
            Vec3 toTarget = new Vec3(target.X - view.Position.X, 0, target.Z - view.Position.Z).Normalized;
            Vec3 forward = new Vec3(view.Forward.X, 0, view.Forward.Z).Normalized;

            // With headings measured as atan2(x, z), this cross/dot pair gives
            // exactly (own heading - target bearing). Positive steer is a right
            // turn, which *decreases* that heading, so the correction takes the
            // angle's own sign — negating it steers away from the racing line.
            double cross = forward.X * toTarget.Z - forward.Z * toTarget.X;
            double dot = MathUtil.Clamp(forward.X * toTarget.X + forward.Z * toTarget.Z, -1.0, 1.0);
            double angle = Math.Atan2(cross, dot);
            double desired = MathUtil.Clamp(angle * 1.6, -1.0, 1.0);

            // First-order lag stands in for reaction time and stops the AI
            // snapping to full lock the instant the line moves.
            double blend = 1.0 - Math.Exp(-dt / Math.Max(0.016, _profile.Reaction));
            _smoothedSteer += (desired - _smoothedSteer) * blend;
            return MathUtil.Clamp(_smoothedSteer, -1.0, 1.0);
        }

        /// <summary>Throttle and brake, from upcoming curvature and race position.</summary>
        private void ChoosePace(int index, double speed, double leaderProgress, double ownProgress,
                                out double throttle, out double brake)
        {
            // Look one to three seconds down the road for the sharpest bend.
            double step = _road.Step > 0.0 ? _road.Step : 1.0;
            int near = (int)Math.Round(Math.Max(12.0, speed * 1.0) / step, MidpointRounding.AwayFromZero);
            int far = (int)Math.Round(Math.Max(28.0, speed * 2.4) / step, MidpointRounding.AwayFromZero);
            double curvature = Math.Max(
                Math.Abs(_road.CurvatureAt(index, near)),
                Math.Abs(_road.CurvatureAt(index, far)) * 0.75);

            // Convert bend severity into a target speed.
            double severity = MathUtil.Clamp(curvature * _profile.CornerCaution, 0.0, 1.4);
            double targetSpeed = _spec.TopSpeed * _profile.PaceFactor * (1.0 - severity * 0.62);

            // Rubber-banding, applied only when well behind and capped tightly,
            // so it closes a gap without ever feeling like the AI is cheating.
            double deficit = leaderProgress - ownProgress;
            if (deficit > 60.0)
            {
                targetSpeed *= 1.0 + Math.Min(0.18, (deficit - 60.0) / 900.0) * (_profile.CatchUp / 0.16);
            }
            else if (deficit < -120.0)
            {
                // Comfortably ahead: ease off rather than disappear over the horizon.
                targetSpeed *= 0.93;
            }

            targetSpeed = Math.Max(8.0, targetSpeed);

            if (speed > targetSpeed * 1.12) { throttle = 0.0; brake = 0.85; return; }
            if (speed > targetSpeed) { throttle = 0.15; brake = 0.0; return; }
            throttle = 1.0;
            brake = 0.0;
        }

        /// <summary>Track how long the truck has been going nowhere.</summary>
        private bool UpdateStuckState(double dt, DriverView view)
        {
            if (_reverseTimer > 0.0)
            {
                _reverseTimer -= dt;
                return _reverseTimer > 0.0;
            }

            bool stalled = Math.Abs(view.ForwardSpeed) < 1.6 && view.GroundedWheels > 0;
            _stuckTimer = stalled ? _stuckTimer + dt : 0.0;

            if (_stuckTimer > 1.8)
            {
                _stuckTimer = 0.0;
                _reverseTimer = 1.4;
                return true;
            }
            return false;
        }

        /// <summary>Back away from whatever we drove into, turning towards the road.</summary>
        private static DriveInput ReverseOut(double lateral)
        {
            return new DriveInput
            {
                Throttle = 0.0,
                Brake = 1.0,
                // Reversing inverts the steering geometry, so steer towards the
                // side we came from to swing the nose back over the road.
                Steer = MathUtil.Clamp(lateral * 0.35, -1.0, 1.0),
            };
        }
    }
}
