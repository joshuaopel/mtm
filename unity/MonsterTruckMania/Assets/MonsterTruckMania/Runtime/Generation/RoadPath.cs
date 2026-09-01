// SPDX-License-Identifier: MIT
using System;
using System.Collections.Generic;

namespace MonsterTruckMania.Generation
{
    /// <summary>
    /// The road centreline: a Catmull-Rom curve resampled at even arc length,
    /// with a bucket grid for "how far is this point from the road".
    /// </summary>
    /// <remarks>
    /// One source of truth for the racing line. The visible road ribbon, the
    /// terrain flattening under it, the prop scatter exclusion and the
    /// out-of-bounds test all read from this same resampled polyline. Deriving
    /// them separately is how you end up with a road that is not quite where
    /// the terrain thinks it is.
    /// </remarks>
    public sealed class RoadPath
    {
        private readonly Dictionary<long, List<int>> _buckets = new Dictionary<long, List<int>>();
        private readonly double _cell;

        public IReadOnlyList<Vec3> Points { get; }
        /// <summary>Spacing between samples, in metres.</summary>
        public double Step { get; }
        /// <summary>Total curve length, in metres.</summary>
        public double Length { get; }
        public double Width { get; }
        public double Shoulder { get; }
        public bool Closed { get; }

        public RoadPath(IReadOnlyList<Vec3> control, bool closed, double width, double shoulder,
                        double resolution = 1.5)
        {
            Width = width;
            Shoulder = shoulder;
            Closed = closed;

            if (control.Count < 2)
            {
                Points = new List<Vec3>(control);
                Step = 0.0;
                Length = 0.0;
                _cell = Math.Max(8.0, width * 0.5 + shoulder + 4.0);
                return;
            }

            var curve = new CatmullRomCurve(control, closed);
            Length = curve.GetLength();
            int count = Math.Max(8, (int)Math.Round(Length / resolution, MidpointRounding.AwayFromZero));
            List<Vec3> spaced = curve.GetSpacedPoints(count);

            // GetSpacedPoints returns divisions+1 samples, and on a loop the
            // last repeats the first. Keeping it leaves a zero-length segment
            // right on the start line, which shows up as a pinched quad in the
            // road mesh and a divide-by-zero in the tangent there.
            int sampleCount = closed ? count : count + 1;
            var points = new List<Vec3>(sampleCount);
            for (int i = 0; i < sampleCount; i++) points.Add(spaced[i]);
            Points = points;
            Step = Length / count;

            _cell = Math.Max(8.0, width * 0.5 + shoulder + 4.0);
            BuildBuckets();
        }

        /// <summary>
        /// Build from samples that are already spaced, skipping the spline.
        /// </summary>
        /// <remarks>
        /// For a road that came from data rather than from control points —
        /// a track authored elsewhere, or a baked path — where re-splining
        /// would move it slightly. Also what the terrain tests use, so a
        /// straight road can be stated exactly rather than approximated by
        /// control points that happen to produce one.
        /// </remarks>
        public static RoadPath FromSamples(IReadOnlyList<Vec3> samples, bool closed,
                                           double width, double shoulder, double step)
        {
            return new RoadPath(samples, closed, width, shoulder, step, true);
        }

        private RoadPath(IReadOnlyList<Vec3> samples, bool closed, double width, double shoulder,
                         double step, bool preSampled)
        {
            _ = preSampled;
            Width = width;
            Shoulder = shoulder;
            Closed = closed;
            Points = new List<Vec3>(samples);
            Step = step;

            double length = 0.0;
            for (int i = 0; i < Points.Count - 1; i++) length += Vec3.Distance(Points[i], Points[i + 1]);
            Length = length;

            _cell = Math.Max(8.0, width * 0.5 + shoulder + 4.0);
            BuildBuckets();
        }

        private void BuildBuckets()
        {
            for (int i = 0; i < Points.Count; i++)
            {
                long key = Key((int)Math.Floor(Points[i].X / _cell), (int)Math.Floor(Points[i].Z / _cell));
                if (!_buckets.TryGetValue(key, out var list))
                {
                    list = new List<int>();
                    _buckets[key] = list;
                }
                list.Add(i);
            }
        }

        private static long Key(int cx, int cz) => ((long)cx << 32) ^ (uint)cz;

        /// <summary>
        /// How far from the road <see cref="Closest"/> is guaranteed to find
        /// the true nearest sample.
        /// </summary>
        /// <remarks>
        /// The lookup searches the nine buckets around the query, so anything
        /// within one cell is certain to be found and anything beyond it is
        /// best-effort. Sized so the whole carved corridor — road plus
        /// shoulder — is comfortably inside the guarantee, since that is what
        /// the terrain carve queries.
        /// </remarks>
        public double SearchRadius => _cell;

        /// <summary>
        /// Nearest sample to a world XZ position, and the distance to it.
        /// </summary>
        /// <remarks>
        /// Only the nine buckets around the query are searched, which is what
        /// makes carving a 256x256 grid against a 1500m course tolerable —
        /// the naive version is O(grid * samples) and takes seconds.
        /// Returns index -1 when nothing is near, so callers can skip.
        /// </remarks>
        public int Closest(double x, double z, out double lateral)
        {
            int cx = (int)Math.Floor(x / _cell);
            int cz = (int)Math.Floor(z / _cell);
            int best = -1;
            double bestSq = double.PositiveInfinity;

            for (int dx = -1; dx <= 1; dx++)
            {
                for (int dz = -1; dz <= 1; dz++)
                {
                    if (!_buckets.TryGetValue(Key(cx + dx, cz + dz), out var list)) continue;
                    for (int k = 0; k < list.Count; k++)
                    {
                        Vec3 p = Points[list[k]];
                        double d = (p.X - x) * (p.X - x) + (p.Z - z) * (p.Z - z);
                        if (d < bestSq)
                        {
                            bestSq = d;
                            best = list[k];
                        }
                    }
                }
            }

            lateral = best < 0 ? double.PositiveInfinity : Math.Sqrt(bestSq);
            return best;
        }

        /// <summary>Direction of travel at a sample, normalised, XZ only.</summary>
        public Vec3 TangentAt(int index)
        {
            int count = Points.Count;
            if (count < 2) return new Vec3(0, 0, 1);
            int next = Closed ? (index + 1) % count : Math.Min(index + 1, count - 1);
            int prev = Closed ? (index - 1 + count) % count : Math.Max(index - 1, 0);
            Vec3 d = Points[next] - Points[prev];
            return new Vec3(d.X, 0, d.Z).Normalized;
        }

        /// <summary>Right-hand normal at a sample, in the XZ plane.</summary>
        public Vec3 RightAt(int index)
        {
            Vec3 t = TangentAt(index);
            // cross(tangent, up) with up = +Y.
            return new Vec3(t.Z, 0, -t.X);
        }
    }
}
