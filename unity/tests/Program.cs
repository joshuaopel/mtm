// SPDX-License-Identifier: MIT
//
// Checks the C# generation core against values printed from the running
// TypeScript. Three implementations of this maths now exist — TypeScript for
// the web game, Python for the Blender add-on, C# here — and they are only
// safe to have because all three are pinned to the same numbers.
//
//   dotnet run --project unity/tests/GenerationTests.csproj

using System;
using System.Collections.Generic;
using MonsterTruckMania.Generation;

namespace MonsterTruckMania.Tests
{
    internal static class Program
    {
        private static int _failures;
        private static int _checks;

        private static void Check(bool condition, string what)
        {
            _checks++;
            if (condition) return;
            _failures++;
            Console.WriteLine($"  FAIL  {what}");
        }

        private static void Near(double actual, double expected, double tolerance, string what)
        {
            _checks++;
            double delta = Math.Abs(actual - expected);
            if (delta <= tolerance) return;
            _failures++;
            Console.WriteLine($"  FAIL  {what}\n          expected {expected:R}\n          actual   {actual:R}\n          delta    {delta:R} > {tolerance:R}");
        }

        private static void Exact(double actual, double expected, string what)
        {
            _checks++;
            if (actual.Equals(expected)) return;
            _failures++;
            Console.WriteLine($"  FAIL  {what}\n          expected {expected:R}\n          actual   {actual:R}");
        }

        private static void Section(string name) => Console.WriteLine($"\n{name}");

        private static int Main()
        {
            NoiseMatchesTheTypeScript();
            CurveMatchesThree();
            RoadResamplingIsEven();

            Console.WriteLine($"\n{_checks - _failures}/{_checks} checks passed.");
            if (_failures > 0) Console.WriteLine($"{_failures} FAILED");
            return _failures == 0 ? 0 : 1;
        }

        // ------------------------------------------------------------------
        // Value noise
        // ------------------------------------------------------------------

        /// <summary>
        /// (seed, x, y, fbm(x, y, 4), sample(x, y)) printed by node from the
        /// compiled src/core/Noise.ts. Both languages use IEEE doubles, so
        /// these must agree to the last bit, not merely to a tolerance — the
        /// hash wraps at 32 bits and any drift there is total, not gradual.
        /// </summary>
        private static readonly (int Seed, double X, double Y, double Fbm, double Sample)[] NoiseReference =
        {
            (1101, 0.0, 0.0, 0.617842318257317, 0.617842318257317),
            (1101, 1.5, -2.25, 0.37761605190850484, 0.411292769418651),
            (5505, 123.456, -987.654, 0.3663739720266263, 0.27546547513039144),
            (8821, -0.001, 0.001, 0.5025534431437741, 0.5025568659853799),
            (8821, 1000.0, 1000.0, 0.5983232556997488, 0.8045466088224202),
            (99, -5.5, -3.25, 0.5047832289419603, 0.377474898359651),
            (99, 5.5, 3.25, 0.2699024747669076, 0.19216773212247062),
        };

        private static void NoiseMatchesTheTypeScript()
        {
            Section("value noise, against the TypeScript");
            foreach (var r in NoiseReference)
            {
                var noise = new ValueNoise2D(r.Seed);
                Exact(noise.Sample(r.X, r.Y), r.Sample, $"sample(seed {r.Seed}, {r.X}, {r.Y})");
                Exact(noise.Fbm(r.X, r.Y, 4), r.Fbm, $"fbm(seed {r.Seed}, {r.X}, {r.Y})");
            }

            // Noise feeds an amplitude directly, so an out-of-range sample
            // would show up as terrain spikes rather than as an exception.
            var bounded = new ValueNoise2D(1234);
            bool inRange = true;
            for (int i = 0; i < 400; i++)
            {
                double v = bounded.Fbm(i * 0.37 - 70, i * -0.21 + 15, 4);
                if (v < 0.0 || v > 1.0) inRange = false;
            }
            Check(inRange, "fbm stays within 0..1 over 400 samples");
        }

        // ------------------------------------------------------------------
        // Catmull-Rom
        // ------------------------------------------------------------------

        private static readonly Vec3[] Square =
        {
            new Vec3(-100, 0, -100), new Vec3(100, 0, -100),
            new Vec3(100, 0, 100), new Vec3(-100, 0, 100),
        };

        // Near-repeated control points, which is where the naive Catmull-Rom
        // and three's version disagree.
        private static readonly Vec3[] Uneven =
        {
            new Vec3(0, 0, 0), new Vec3(1, 0, 0), new Vec3(100, 0, 0), new Vec3(101, 0, 5),
        };

        private static readonly Vec3[] Hilly =
        {
            new Vec3(0, 2, 0), new Vec3(60, 9, -30), new Vec3(130, 4, 10),
            new Vec3(90, -3, 90), new Vec3(10, 6, 70), new Vec3(-50, 1, 20),
        };

        private static void CurveMatchesThree()
        {
            Section("centripetal Catmull-Rom, against three.js");

            // Curve lengths, from three's getLength().
            Near(new CatmullRomCurve(Square, true).GetLength(), 840.7218853683465, 1e-9,
                 "closed square length");
            Near(new CatmullRomCurve(Uneven, false).GetLength(), 105.68990603214777, 1e-9,
                 "open uneven length (repeated control points)");
            Near(new CatmullRomCurve(Hilly, true).GetLength(), 466.8115844032844, 1e-9,
                 "closed hilly loop length");

            // getPoint(t) on the hilly loop.
            var expected = new (double T, Vec3 P)[]
            {
                (0.0, new Vec3(0.0, 2.0, 0.0)),
                (0.13, new Vec3(46.46599108326515, 8.082098993792883, -27.50123157946683)),
                (0.37, new Vec3(129.84515807425774, 2.2639993369600875, 26.940805102452522)),
                (0.5, new Vec3(90.0, -3.0, 90.0)),
                (0.86, new Vec3(-47.14421555474135, 0.8431449505315751, 15.769572936863442)),
                (1.0, new Vec3(0.0, 2.0, 0.0)),
            };
            var hilly = new CatmullRomCurve(Hilly, true);
            foreach (var e in expected)
            {
                Near(Vec3.Distance(hilly.GetPoint(e.T), e.P), 0.0, 1e-9, $"getPoint({e.T})");
            }

            // three reflects a virtual point past each end rather than
            // repeating the endpoint. Repeating it pins the tangent and bends
            // the road away from the start line, so this is not a detail.
            var open = new CatmullRomCurve(Uneven, false);
            Near(Vec3.Distance(open.GetPoint(0.0), Uneven[0]), 0.0, 1e-9, "open curve starts on its first point");
            Near(Vec3.Distance(open.GetPoint(1.0), Uneven[Uneven.Length - 1]), 0.0, 1e-9, "open curve ends on its last point");
            Check(open.GetPoint(0.01).X > open.GetPoint(0.0).X,
                  "open curve heads forward off the start rather than doubling back");
        }

        // ------------------------------------------------------------------
        // Road resampling
        // ------------------------------------------------------------------

        private static void RoadResamplingIsEven()
        {
            Section("road resampling");

            var road = new RoadPath(Square, true, 20.0, 10.0, 5.0);
            var gaps = new List<double>();
            for (int i = 0; i < road.Points.Count - 1; i++)
            {
                gaps.Add(Vec3.Distance(road.Points[i], road.Points[i + 1]));
            }
            bool even = true;
            foreach (double g in gaps) if (Math.Abs(g - road.Step) > road.Step * 0.25) even = false;
            Check(even, "samples are evenly spaced along the arc");
            Check(road.Length > 700, "closed square is over 700m around");

            // The loop must not keep the duplicated final sample: it leaves a
            // zero-length segment on the start line, which pinches the road
            // mesh and makes the tangent there undefined.
            var fine = new RoadPath(Square, true, 20.0, 10.0, 1.5);
            Check(Vec3.Distance(fine.Points[0], fine.Points[fine.Points.Count - 1]) > fine.Step * 0.5,
                  "closed loop drops the duplicated last sample");
            Near(fine.Points.Count * fine.Step, fine.Length, 1e-6,
                 "sample count times spacing recovers the length");

            // The curve should pass near every control point it was built from.
            double worst = 0.0;
            foreach (Vec3 c in Square)
            {
                double nearest = double.PositiveInfinity;
                foreach (Vec3 p in fine.Points) nearest = Math.Min(nearest, Vec3.Distance(c, p));
                worst = Math.Max(worst, nearest);
            }
            Check(worst < 1.0, "curve passes through its control points");

            // The bucket grid must agree with a brute-force search, or the
            // terrain carve quietly misses parts of the road.
            var rng = new Random(7);
            bool agrees = true;
            for (int i = 0; i < 500; i++)
            {
                double x = rng.NextDouble() * 400 - 200;
                double z = rng.NextDouble() * 400 - 200;

                int found = fine.Closest(x, z, out double lateral);

                double bestSq = double.PositiveInfinity;
                for (int k = 0; k < fine.Points.Count; k++)
                {
                    Vec3 p = fine.Points[k];
                    double d = (p.X - x) * (p.X - x) + (p.Z - z) * (p.Z - z);
                    if (d < bestSq) bestSq = d;
                }
                double brute = Math.Sqrt(bestSq);

                // Only inside the guaranteed radius must the two agree.
                // Beyond it the nine-bucket search is allowed to miss, which
                // is fine because the carve never asks about ground that far
                // from the road.
                if (brute < fine.SearchRadius && (found < 0 || Math.Abs(lateral - brute) > 1e-9))
                {
                    agrees = false;
                }
            }
            Check(agrees, "bucket lookup matches a brute-force nearest search within its guaranteed radius");
            Check(fine.SearchRadius > 20.0 * 0.5 + 10.0,
                  "guaranteed radius covers the full carved corridor");
        }
    }
}
