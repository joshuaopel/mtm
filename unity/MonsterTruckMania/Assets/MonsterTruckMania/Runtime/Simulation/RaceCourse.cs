// SPDX-License-Identifier: MIT
using System;
using System.Collections.Generic;
using MonsterTruckMania.Generation;

namespace MonsterTruckMania.Simulation
{
    /// <summary>One checkpoint gate across the road.</summary>
    public struct Checkpoint
    {
        public int Index;
        public Vec3 Position;
        /// <summary>Unit vector along the racing direction: the gate's facing.</summary>
        public Vec3 Forward;
        public double HalfWidth;
        /// <summary>Arc length along the road, used to order progress within a lap.</summary>
        public double RoadDistance;
    }

    /// <summary>A place on the grid: where a truck starts and which way it points.</summary>
    public struct SpawnPoint
    {
        public Vec3 Position;
        /// <summary>Rotation about +Y, in radians.</summary>
        public double Heading;
    }

    /// <summary>
    /// The navigation data a race needs: gates to pass and slots to start in.
    /// </summary>
    /// <remarks>
    /// Both are generated from the road rather than authored, which is what
    /// makes a new track raceable the moment its spline exists. An authored
    /// gate list can replace the generated one later; nothing downstream cares
    /// which it got.
    /// <para/>
    /// Ported from the checkpoint and spawn passes of <c>src/game/Track.ts</c>.
    /// </remarks>
    public sealed class RaceCourse
    {
        /// <summary>
        /// How high above the ground a truck is dropped onto its grid slot.
        /// </summary>
        /// <remarks>
        /// The suspension is over a metre long and starts fully extended, so a
        /// truck placed at ground level starts with its wheels underground and
        /// is fired into the air on the first step.
        /// </remarks>
        public const double SpawnLift = 2.8;

        /// <summary>Respawns get more room, since the truck is usually wedged on something.</summary>
        public const double RespawnLift = 3.3;

        /// <summary>Target spacing between generated gates, in metres.</summary>
        private const double GateSpacing = 70.0;

        public IReadOnlyList<Checkpoint> Checkpoints { get; }
        public IReadOnlyList<SpawnPoint> Spawns { get; }
        public RoadPath Road { get; }

        public RaceCourse(RoadPath road, int gridSlots = 12)
        {
            Road = road ?? throw new ArgumentNullException(nameof(road));
            Checkpoints = GenerateCheckpoints(road);
            Spawns = GenerateSpawns(road, Checkpoints, gridSlots);
        }

        /// <summary>Evenly spaced gates around the road, dense enough to catch shortcuts.</summary>
        private static List<Checkpoint> GenerateCheckpoints(RoadPath road)
        {
            var gates = new List<Checkpoint>();
            if (road.Points.Count == 0) return gates;

            int count = Math.Max(6, (int)Math.Round(road.Length / GateSpacing, MidpointRounding.AwayFromZero));
            int stride = Math.Max(1, road.Points.Count / count);

            for (int i = 0; i < count; i++)
            {
                int index = road.Wrap(i * stride);
                Vec3 point = road.PointAt(index);
                gates.Add(new Checkpoint
                {
                    Index = i,
                    Position = point,
                    Forward = road.TangentAt(index),
                    // Generous gates: they exist to prove you went round, not
                    // to punish a wide line.
                    HalfWidth = road.Width * 2.2 * 0.5,
                    RoadDistance = road.DistanceAt(index),
                });
            }
            return gates;
        }

        /// <summary>
        /// A two-by-N grid stacked back from the start gate.
        /// </summary>
        /// <remarks>
        /// Walked backwards along the spline rather than laid out on a
        /// straight line, so the grid follows the road's shape — on a course
        /// whose start line sits in a bend, a straight grid puts the back row
        /// in the scenery.
        /// </remarks>
        private static List<SpawnPoint> GenerateSpawns(RoadPath road, IReadOnlyList<Checkpoint> gates, int slots)
        {
            var spawns = new List<SpawnPoint>();
            if (gates.Count == 0 || road.Step <= 0.0) return spawns;

            const double rowSpacing = 9.0;
            const double columnSpacing = 4.5;

            RoadQuery start = road.Query(gates[0].Position.X, gates[0].Position.Z);

            for (int slot = 0; slot < slots; slot++)
            {
                int row = slot / 2;
                int column = slot % 2 == 0 ? -1 : 1;

                int back = (int)Math.Round(rowSpacing * (row + 1) / road.Step, MidpointRounding.AwayFromZero);
                int index = road.Wrap(start.Index - back);
                Vec3 point = road.PointAt(index);
                Vec3 tangent = road.TangentAt(index);
                Vec3 right = road.RightAt(index);

                Vec3 position = point + right * (column * columnSpacing);
                spawns.Add(new SpawnPoint
                {
                    Position = new Vec3(position.X, point.Y + SpawnLift, position.Z),
                    Heading = Math.Atan2(tangent.X, tangent.Z),
                });
            }
            return spawns;
        }

        /// <summary>
        /// Where to put a truck that has to be rescued: back at the last gate
        /// it actually passed.
        /// </summary>
        /// <remarks>
        /// Deliberately not the nearest point on the racing line. Snapping to
        /// the nearest point pays out whatever distance a shortcut across the
        /// infield covered, which turns the rescue into a reward for leaving
        /// the course.
        /// </remarks>
        public SpawnPoint RescueAt(int nextCheckpoint)
        {
            if (Checkpoints.Count == 0) return default;
            int last = ((nextCheckpoint - 1) % Checkpoints.Count + Checkpoints.Count) % Checkpoints.Count;
            Checkpoint gate = Checkpoints[last];
            return new SpawnPoint
            {
                Position = new Vec3(gate.Position.X, gate.Position.Y + RespawnLift, gate.Position.Z),
                Heading = Math.Atan2(gate.Forward.X, gate.Forward.Z),
            };
        }
    }
}
