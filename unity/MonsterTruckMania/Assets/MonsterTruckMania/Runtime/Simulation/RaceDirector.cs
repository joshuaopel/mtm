// SPDX-License-Identifier: MIT
using System;
using System.Collections.Generic;
using MonsterTruckMania.Generation;

namespace MonsterTruckMania.Simulation
{
    public enum RacePhase
    {
        Countdown,
        Racing,
        Finished,
    }

    /// <summary>
    /// One competitor's race state.
    /// </summary>
    /// <remarks>
    /// A class rather than a struct: the Unity layer holds references to these
    /// and reads them every frame for the HUD, and copying a struct out of a
    /// list would hand it a snapshot that silently stops updating.
    /// </remarks>
    public sealed class Racer
    {
        public string Id = "racer";
        public string Name = "RACER";
        public bool IsPlayer;

        /// <summary>Where the truck is now. Written by the host each step.</summary>
        public Vec3 Position;
        /// <summary>Unit heading in the XZ plane. Written by the host each step.</summary>
        public Vec3 Forward = new Vec3(0, 0, 1);
        /// <summary>Signed speed along the truck's own forward axis.</summary>
        public double ForwardSpeed;

        /// <summary>Completed laps.</summary>
        public int Lap;
        /// <summary>Index of the gate this racer must reach next.</summary>
        public int NextCheckpoint;
        /// <summary>Monotonic distance covered along the course, in metres.</summary>
        public double Progress;

        public readonly List<double> LapTimes = new List<double>();
        public double CurrentLapStart;
        /// <summary>Best lap so far, or null when none is complete.</summary>
        public double? BestLap;

        public bool Finished;
        /// <summary>Time at the flag, or null when classified rather than flagged.</summary>
        public double? FinishTime;
        /// <summary>
        /// Current or final classification, 1 for the leader.
        /// </summary>
        /// <remarks>
        /// Not called <c>Position</c>: that name is already taken by where the
        /// truck is in the world, and a race has both. Confusing the two is a
        /// class of bug that reads perfectly.
        /// </remarks>
        public int PositionIndex;

        public bool WrongWay;
    }

    /// <summary>
    /// Lap timing, checkpoint order and race positions.
    /// </summary>
    /// <remarks>
    /// Checkpoints must be taken in sequence, which is what stops a truck
    /// cutting the infield and claiming a lap. The gates are deliberately
    /// generous: they exist to prove you went the long way round, not to
    /// punish a wide line.
    /// <para/>
    /// Ported from <c>src/game/Race.ts</c>. It reads positions and headings the
    /// host writes onto each <see cref="Racer"/> rather than reaching into a
    /// physics engine, which keeps the whole thing testable offline — the
    /// awkward cases here (progress across the start/finish line, a field
    /// classified mid-lap when the player finishes) are exactly the ones you
    /// do not want to be debugging through a running race.
    /// </remarks>
    public sealed class RaceDirector
    {
        private const double CountdownSeconds = 3.2;
        /// <summary>Extra slack beyond a gate's half width, so wide lines still register.</summary>
        private const double GateMargin = 6.0;
        /// <summary>Vertical tolerance, so a bridge or a big jump does not trigger a gate.</summary>
        private const double GateVerticalTolerance = 14.0;

        private readonly List<Racer> _racers = new List<Racer>();
        private readonly List<Racer> _finishOrder = new List<Racer>();
        private readonly RaceCourse _course;

        public IReadOnlyList<Racer> Racers => _racers;
        public int TotalLaps { get; }
        public RacePhase Phase { get; private set; } = RacePhase.Countdown;
        /// <summary>Counts up from zero once the lights go out.</summary>
        public double Clock { get; private set; }
        /// <summary>Counts down to the start.</summary>
        public double Countdown { get; private set; } = CountdownSeconds;

        public RaceDirector(RaceCourse course, int totalLaps)
        {
            _course = course ?? throw new ArgumentNullException(nameof(course));
            TotalLaps = Math.Max(1, totalLaps);
        }

        /// <summary>True while the grid is still held for the countdown.</summary>
        public bool Locked => Phase == RacePhase.Countdown;

        public Racer Player
        {
            get
            {
                foreach (Racer racer in _racers)
                {
                    if (racer.IsPlayer) return racer;
                }
                return null;
            }
        }

        public Racer Add(string id, string name, bool isPlayer)
        {
            var racer = new Racer
            {
                Id = id,
                Name = name,
                IsPlayer = isPlayer,
                // Gate 0 is the start/finish line, so the first target is gate 1.
                NextCheckpoint = _course.Checkpoints.Count == 0 ? 0 : 1 % _course.Checkpoints.Count,
                PositionIndex = _racers.Count + 1,
            };
            _racers.Add(racer);
            return racer;
        }

        public void Update(double dt)
        {
            if (Phase == RacePhase.Countdown)
            {
                Countdown -= dt;
                if (Countdown <= 0.0)
                {
                    Countdown = 0.0;
                    Phase = RacePhase.Racing;
                    foreach (Racer racer in _racers) racer.CurrentLapStart = 0.0;
                }
                return;
            }

            if (Phase == RacePhase.Finished) return;

            Clock += dt;
            foreach (Racer racer in _racers)
            {
                if (!racer.Finished) UpdateRacer(racer);
            }
            UpdateStandings();

            Racer player = Player;
            if (player != null && player.Finished) Finish();
        }

        private void UpdateRacer(Racer racer)
        {
            IReadOnlyList<Checkpoint> gates = _course.Checkpoints;
            if (gates.Count == 0) return;

            Checkpoint gate = gates[racer.NextCheckpoint];
            double dx = racer.Position.X - gate.Position.X;
            double dz = racer.Position.Z - gate.Position.Z;
            double dy = Math.Abs(racer.Position.Y - gate.Position.Y);
            double planar = Math.Sqrt(dx * dx + dz * dz);

            if (planar < gate.HalfWidth + GateMargin && dy < GateVerticalTolerance)
            {
                PassGate(racer);
            }

            UpdateProgress(racer);
            UpdateWrongWay(racer);
        }

        private void PassGate(Racer racer)
        {
            int total = _course.Checkpoints.Count;
            racer.NextCheckpoint = (racer.NextCheckpoint + 1) % total;

            // Wrapping back to gate 1 means we just crossed the start/finish.
            if (racer.NextCheckpoint != 1) return;

            racer.Lap += 1;
            double lapTime = Clock - racer.CurrentLapStart;
            racer.LapTimes.Add(lapTime);
            racer.CurrentLapStart = Clock;
            if (racer.BestLap == null || lapTime < racer.BestLap.Value) racer.BestLap = lapTime;

            if (racer.Lap >= TotalLaps)
            {
                racer.Finished = true;
                racer.FinishTime = Clock;
                _finishOrder.Add(racer);
            }
        }

        /// <summary>
        /// Distance covered along the course, used for AI rubber-banding.
        /// </summary>
        /// <remarks>
        /// The lap counter and the road distance wrap at slightly different
        /// moments — the lap ticks over at the finish gate, the road distance
        /// wraps at spline index 0 — so near the line the two disagree by
        /// almost a full lap. Reconciling them here is what keeps progress
        /// monotonic across the start/finish, and without it the AI's
        /// rubber-banding sees the leader fall a lap behind every time round.
        /// </remarks>
        private void UpdateProgress(Racer racer)
        {
            double length = _course.Road.Length;
            RoadQuery query = _course.Road.Query(racer.Position.X, racer.Position.Z);
            double distance = query.Distance;

            if (racer.NextCheckpoint == 1 && distance > length * 0.5)
            {
                // Lap already counted, but the spline has not wrapped yet.
                distance -= length;
            }
            else if (racer.NextCheckpoint == 0 && distance < length * 0.5)
            {
                // Spline wrapped, but the finish gate has not been taken yet.
                distance += length;
            }

            racer.Progress = racer.Lap * length + distance;
        }

        private void UpdateWrongWay(Racer racer)
        {
            if (Math.Abs(racer.ForwardSpeed) < 3.0)
            {
                racer.WrongWay = false;
                return;
            }

            RoadQuery query = _course.Road.Query(racer.Position.X, racer.Position.Z);
            Vec3 heading = new Vec3(racer.Forward.X, 0, racer.Forward.Z).Normalized;

            // Compare where the truck is actually travelling with the road
            // direction, so reversing back down the road counts as the right way.
            Vec3 travel = racer.ForwardSpeed >= 0.0 ? heading : heading * -1.0;
            double dot = travel.X * query.Tangent.X + travel.Z * query.Tangent.Z;
            racer.WrongWay = dot < -0.35;
        }

        /// <summary>
        /// Sort the field.
        /// </summary>
        /// <remarks>
        /// Gate order beats raw distance, so a truck that cuts the course
        /// cannot leapfrog one that took the proper route.
        /// </remarks>
        private void UpdateStandings()
        {
            int total = _course.Checkpoints.Count;
            var ordered = new List<Racer>(_racers);

            ordered.Sort((a, b) =>
            {
                if (a.Finished != b.Finished) return a.Finished ? -1 : 1;
                if (a.Finished && b.Finished)
                {
                    return (a.FinishTime ?? 0.0).CompareTo(b.FinishTime ?? 0.0);
                }
                if (a.Lap != b.Lap) return b.Lap.CompareTo(a.Lap);

                // NextCheckpoint 0 means the racer has taken the last gate and
                // is on its way to the line, which is ahead of anyone mid-lap.
                int aGate = a.NextCheckpoint == 0 ? total : a.NextCheckpoint;
                int bGate = b.NextCheckpoint == 0 ? total : b.NextCheckpoint;
                if (aGate != bGate) return bGate.CompareTo(aGate);

                return DistanceToNextGate(a).CompareTo(DistanceToNextGate(b));
            });

            for (int i = 0; i < ordered.Count; i++) ordered[i].PositionIndex = i + 1;
        }

        private double DistanceToNextGate(Racer racer)
        {
            if (_course.Checkpoints.Count == 0) return 0.0;
            Checkpoint gate = _course.Checkpoints[racer.NextCheckpoint];
            double dx = racer.Position.X - gate.Position.X;
            double dz = racer.Position.Z - gate.Position.Z;
            return Math.Sqrt(dx * dx + dz * dz);
        }

        /// <summary>Close the race, classifying anyone still running by current order.</summary>
        private void Finish()
        {
            Phase = RacePhase.Finished;
            UpdateStandings();

            var remaining = new List<Racer>();
            foreach (Racer racer in _racers)
            {
                if (!racer.Finished) remaining.Add(racer);
            }
            remaining.Sort((a, b) => a.PositionIndex.CompareTo(b.PositionIndex));

            foreach (Racer racer in remaining)
            {
                racer.Finished = true;
                // No finish time: they were classified, not flagged across the line.
                racer.FinishTime = null;
                _finishOrder.Add(racer);
            }

            for (int i = 0; i < _finishOrder.Count; i++) _finishOrder[i].PositionIndex = i + 1;
        }

        /// <summary>Standings, leader first.</summary>
        public List<Racer> Standings()
        {
            var ordered = new List<Racer>(_racers);
            ordered.Sort((a, b) => a.PositionIndex.CompareTo(b.PositionIndex));
            return ordered;
        }

        /// <summary>Furthest progress in the field, for AI rubber-banding.</summary>
        public double LeaderProgress()
        {
            double best = 0.0;
            foreach (Racer racer in _racers) best = Math.Max(best, racer.Progress);
            return best;
        }

        /// <summary>Countdown text, or null once racing.</summary>
        public string CountdownLabel()
        {
            if (Phase != RacePhase.Countdown) return null;
            int remaining = (int)Math.Ceiling(Countdown);
            if (remaining <= 0) return "GO!";
            return Math.Min(3, remaining).ToString(System.Globalization.CultureInfo.InvariantCulture);
        }

        /// <summary>mm:ss.hh, the format every racing game of the era used.</summary>
        public static string FormatTime(double? seconds)
        {
            if (seconds == null || double.IsNaN(seconds.Value) || double.IsInfinity(seconds.Value))
            {
                return "--:--.--";
            }
            double clamped = Math.Max(0.0, seconds.Value);
            int minutes = (int)Math.Floor(clamped / 60.0);
            int secs = (int)Math.Floor(clamped % 60.0);
            int hundredths = (int)Math.Floor(clamped * 100.0 % 100.0);
            return string.Format(System.Globalization.CultureInfo.InvariantCulture,
                                 "{0:00}:{1:00}.{2:00}", minutes, secs, hundredths);
        }

        /// <summary>1ST, 2ND, 3RD and so on.</summary>
        public static string Ordinal(int position)
        {
            int mod100 = position % 100;
            string suffix = mod100 >= 11 && mod100 <= 13
                ? "TH"
                : position % 10 == 1 ? "ST"
                : position % 10 == 2 ? "ND"
                : position % 10 == 3 ? "RD" : "TH";
            return position.ToString(System.Globalization.CultureInfo.InvariantCulture) + suffix;
        }
    }
}
