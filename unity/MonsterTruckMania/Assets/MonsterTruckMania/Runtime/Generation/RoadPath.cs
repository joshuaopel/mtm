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
        /// <remarks>
        /// This is cross(up, tangent), not cross(tangent, up) — the latter
        /// points left. Unity's frame is left-handed, so facing +Z your right
        /// is +X, and facing +X your right is -Z; both fall out of the form
        /// below. Everything that offsets from the centreline (grid columns,
        /// AI lane offsets, the sign of <see cref="RoadQuery.Lateral"/>) reads
        /// this, so a flip here mirrors the whole course.
        /// </remarks>
        public Vec3 RightAt(int index)
        {
            Vec3 t = TangentAt(index);
            return new Vec3(t.Z, 0, -t.X);
        }

        /// <summary>Clamp (open road) or wrap (closed circuit) a sample index.</summary>
        /// <remarks>
        /// Every lookahead in the game adds samples to an index and expects
        /// the result to stay valid, so the wrap lives here rather than at
        /// each call site. An open road clamps instead: running off the end
        /// of a point-to-point course must not teleport the AI to the start.
        /// </remarks>
        public int Wrap(int index)
        {
            int n = Points.Count;
            if (n == 0) return 0;
            if (Closed) return ((index % n) + n) % n;
            return index < 0 ? 0 : index >= n ? n - 1 : index;
        }

        /// <summary>Sample position, index wrapped or clamped.</summary>
        public Vec3 PointAt(int index) => Points.Count == 0 ? new Vec3(0, 0, 0) : Points[Wrap(index)];

        /// <summary>Arc length from the start of the road to a sample.</summary>
        public double DistanceAt(int index) => Wrap(index) * Step;

        /// <summary>
        /// Heading at a sample, as a rotation about +Y.
        /// </summary>
        /// <remarks>
        /// Measured as atan2(x, z) rather than the usual atan2(z, x) so it can
        /// be handed straight to a Y-axis rotation with a +Z-forward model —
        /// which is the convention every truck, prop and spawn in this project
        /// uses. Converting at each call site is how half of them end up 90
        /// degrees out.
        /// </remarks>
        public double HeadingAt(int index)
        {
            Vec3 t = TangentAt(index);
            return Math.Atan2(t.X, t.Z);
        }

        /// <summary>
        /// Signed change of direction over a lookahead window, in radians.
        /// </summary>
        /// <remarks>
        /// This is what the AI brakes on: not the instantaneous curvature,
        /// which is noisy on a resampled polyline, but how much the road has
        /// turned by the time it gets there. Positive is a right-hand bend.
        /// </remarks>
        public double CurvatureAt(int index, int lookaheadSamples)
        {
            Vec3 a = TangentAt(Wrap(index));
            Vec3 b = TangentAt(Wrap(index + lookaheadSamples));
            double cross = a.Z * b.X - a.X * b.Z;
            double dot = MathUtil.Clamp(a.X * b.X + a.Z * b.Z, -1.0, 1.0);
            return Math.Sign(cross) * Math.Acos(dot);
        }

        /// <summary>
        /// Everything a driver or the race director needs about where a world
        /// position sits relative to the road.
        /// </summary>
        /// <remarks>
        /// <see cref="Closest"/> answers "how far from the road is this",
        /// which is all the terrain carve needs, and it gives up outside the
        /// bucket neighbourhood. A truck that has been launched off a jump —
        /// or shoved into the scenery — is routinely outside it, and the AI
        /// and the lap counter cannot give up on those frames. So this falls
        /// back to a strided sweep of the whole path and then refines around
        /// the coarse hit, which is exact to the sample and still cheap.
        /// </remarks>
        public RoadQuery Query(double x, double z)
        {
            if (Points.Count == 0) return default;

            int best = Closest(x, z, out double _);
            if (best < 0) best = SweepForClosest(x, z);

            Vec3 point = Points[best];
            Vec3 tangent = TangentAt(best);
            double dx = x - point.X;
            double dz = z - point.Z;
            double distance = Math.Sqrt(dx * dx + dz * dz);

            // Which side of the road: the sign of the cross product of the
            // direction of travel with the offset. Positive is the right-hand
            // side going forwards, which is what the AI's lane offsets and the
            // reverse-out manoeuvre both assume.
            double cross = tangent.Z * dx - tangent.X * dz;

            return new RoadQuery(best, DistanceAt(best), Math.Sign(cross) * distance, point, tangent, Width);
        }

        private int SweepForClosest(double x, double z)
        {
            int count = Points.Count;
            int stride = Math.Max(1, count / 256);
            int best = 0;
            double bestSq = double.PositiveInfinity;

            for (int i = 0; i < count; i += stride)
            {
                double d = SqrPlanarDistance(i, x, z);
                if (d < bestSq) { bestSq = d; best = i; }
            }

            int coarse = best;
            for (int i = coarse - stride; i <= coarse + stride; i++)
            {
                int w = Wrap(i);
                double d = SqrPlanarDistance(w, x, z);
                if (d < bestSq) { bestSq = d; best = w; }
            }
            return best;
        }

        private double SqrPlanarDistance(int index, double x, double z)
        {
            Vec3 p = Points[index];
            return (p.X - x) * (p.X - x) + (p.Z - z) * (p.Z - z);
        }
    }

    /// <summary>
    /// Where a world position sits relative to the road.
    /// </summary>
    public readonly struct RoadQuery
    {
        /// <summary>Index of the nearest resampled sample.</summary>
        public readonly int Index;
        /// <summary>Arc length from the start of the road to that sample.</summary>
        public readonly double Distance;
        /// <summary>Signed offset from the centreline; negative is left of travel.</summary>
        public readonly double Lateral;
        public readonly Vec3 Point;
        public readonly Vec3 Tangent;
        public readonly double Width;

        public RoadQuery(int index, double distance, double lateral, Vec3 point, Vec3 tangent, double width)
        {
            Index = index;
            Distance = distance;
            Lateral = lateral;
            Point = point;
            Tangent = tangent;
            Width = width;
        }

        /// <summary>How far outside the road plus its shoulder this is, in metres.</summary>
        public double DistanceOutside(double shoulder) => Math.Abs(Lateral) - (Width * 0.5 + shoulder);
    }
}
