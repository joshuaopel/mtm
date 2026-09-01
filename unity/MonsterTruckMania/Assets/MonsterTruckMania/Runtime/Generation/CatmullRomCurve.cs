// SPDX-License-Identifier: MIT
using System;
using System.Collections.Generic;

namespace MonsterTruckMania.Generation
{
    /// <summary>
    /// Centripetal Catmull-Rom, ported from three.js <c>CatmullRomCurve3</c>
    /// along with the arc-length machinery its <c>Curve</c> base provides.
    /// </summary>
    /// <remarks>
    /// This is a line-for-line port, not a reimplementation, and that is a
    /// deliberate choice paid for once already. Writing the same curve with
    /// the textbook Barry-Goldman recursion looks equivalent and agrees
    /// almost everywhere — then parts company exactly at repeated and
    /// near-repeated control points, which three special-cases below, and at
    /// the ends of an open curve, where three extrapolates a reflected point
    /// rather than repeating the endpoint. Both differences move the road.
    /// <para/>
    /// The reference values in <c>unity/tests</c> come from the running
    /// JavaScript, so a drift away from three shows up as a failure rather
    /// than as a track that bends slightly differently.
    /// </remarks>
    public sealed class CatmullRomCurve
    {
        /// <summary>Segments used to build the arc-length table. three's default.</summary>
        public const int ArcLengthDivisions = 200;

        private readonly List<Vec3> _points;
        private readonly bool _closed;
        private double[] _lengths;

        public CatmullRomCurve(IReadOnlyList<Vec3> points, bool closed)
        {
            _points = new List<Vec3>(points);
            _closed = closed;
        }

        public IReadOnlyList<Vec3> ControlPoints => _points;
        public bool Closed => _closed;

        /// <summary>three's <c>a - b + a</c>: the reflection past an endpoint.</summary>
        private static Vec3 Reflect(Vec3 a, Vec3 b) => a - b + a;

        public Vec3 GetPoint(double t)
        {
            int count = _points.Count;
            if (count < 2) return count == 1 ? _points[0] : new Vec3(0, 0, 0);

            double p = (count - (_closed ? 0 : 1)) * t;
            int intPoint = (int)Math.Floor(p);
            double weight = p - intPoint;

            if (_closed)
            {
                if (intPoint <= 0)
                {
                    intPoint += ((int)Math.Floor(Math.Abs((double)intPoint) / count) + 1) * count;
                }
            }
            else if (weight == 0.0 && intPoint == count - 1)
            {
                intPoint = count - 2;
                weight = 1.0;
            }

            Vec3 p0 = (_closed || intPoint > 0)
                ? _points[Mod(intPoint - 1, count)]
                : Reflect(_points[0], _points[1]);

            Vec3 p1 = _points[Mod(intPoint, count)];
            Vec3 p2 = _points[Mod(intPoint + 1, count)];

            Vec3 p3 = (_closed || intPoint + 2 < count)
                ? _points[Mod(intPoint + 2, count)]
                : Reflect(_points[count - 1], _points[count - 2]);

            // Centripetal: the fourth root of the squared distance, i.e. sqrt
            // of the distance. This is what keeps the curve from looping back
            // on itself where control points bunch up.
            double dt0 = Math.Pow(Vec3.DistanceSquared(p0, p1), 0.25);
            double dt1 = Math.Pow(Vec3.DistanceSquared(p1, p2), 0.25);
            double dt2 = Math.Pow(Vec3.DistanceSquared(p2, p3), 0.25);

            // Repeated control points would divide by zero. three substitutes
            // neighbouring spacings, and the substitution is visible in the
            // output, so it is reproduced rather than approximated.
            if (dt1 < 1e-4) dt1 = 1.0;
            if (dt0 < 1e-4) dt0 = dt1;
            if (dt2 < 1e-4) dt2 = dt1;

            var poly = new CubicPoly();
            double[] outAxis = new double[3];
            for (int axis = 0; axis < 3; axis++)
            {
                poly.InitNonuniform(p0[axis], p1[axis], p2[axis], p3[axis], dt0, dt1, dt2);
                outAxis[axis] = poly.Calc(weight);
            }
            return new Vec3(outAxis[0], outAxis[1], outAxis[2]);
        }

        /// <summary>Python-style modulo: never negative, unlike C#'s <c>%</c>.</summary>
        private static int Mod(int value, int n)
        {
            int r = value % n;
            return r < 0 ? r + n : r;
        }

        public double[] GetLengths(int divisions = ArcLengthDivisions)
        {
            if (_lengths != null && _lengths.Length == divisions + 1) return _lengths;

            var cache = new double[divisions + 1];
            cache[0] = 0.0;
            Vec3 last = GetPoint(0.0);
            double total = 0.0;
            for (int i = 1; i <= divisions; i++)
            {
                Vec3 current = GetPoint((double)i / divisions);
                total += Vec3.Distance(current, last);
                cache[i] = total;
                last = current;
            }

            _lengths = cache;
            return cache;
        }

        public double GetLength() => GetLengths()[ArcLengthDivisions];

        /// <summary>
        /// Map a fraction of arc length to a curve parameter, so samples come
        /// out evenly spaced along the road instead of bunching in the corners.
        /// </summary>
        public double UToT(double u)
        {
            double[] arc = GetLengths();
            int count = arc.Length;
            double target = u * arc[count - 1];

            int low = 0, high = count - 1, i = 0;
            while (low <= high)
            {
                i = low + (high - low) / 2;
                double comparison = arc[i] - target;
                if (comparison < 0) low = i + 1;
                else if (comparison > 0) high = i - 1;
                else { high = i; break; }
            }

            i = high;
            if (i < 0) return 0.0;
            if (arc[i] == target) return (double)i / (count - 1);

            double span = arc[i + 1] - arc[i];
            double fraction = span == 0.0 ? 0.0 : (target - arc[i]) / span;
            return (i + fraction) / (count - 1);
        }

        public List<Vec3> GetSpacedPoints(int divisions)
        {
            var result = new List<Vec3>(divisions + 1);
            for (int d = 0; d <= divisions; d++)
            {
                result.Add(GetPoint(UToT((double)d / divisions)));
            }
            return result;
        }

        /// <summary>three's CubicPoly, including its non-uniform tangent scaling.</summary>
        private sealed class CubicPoly
        {
            private double _c0, _c1, _c2, _c3;

            private void Init(double x0, double x1, double t0, double t1)
            {
                _c0 = x0;
                _c1 = t0;
                _c2 = -3 * x0 + 3 * x1 - 2 * t0 - t1;
                _c3 = 2 * x0 - 2 * x1 + t0 + t1;
            }

            public void InitNonuniform(double x0, double x1, double x2, double x3,
                                       double dt0, double dt1, double dt2)
            {
                double t1 = (x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1;
                double t2 = (x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2;
                // Rescale the tangents for a parameterisation over [0, 1].
                Init(x1, x2, t1 * dt1, t2 * dt1);
            }

            public double Calc(double t) => _c0 + _c1 * t + _c2 * t * t + _c3 * t * t * t;
        }
    }
}
