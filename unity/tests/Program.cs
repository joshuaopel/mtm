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
using MonsterTruckMania.Simulation;

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
            TerrainMatchesTheWebGame();
            RoadQueriesAnswerOffTheRoad();
            HandlingMatchesTheTypeScript();
            TheDriveModelObeysItsRules();
            TheRaceDirectorCountsLapsAndPositions();

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

        // ------------------------------------------------------------------
        // Terrain
        // ------------------------------------------------------------------

        private static TerrainField Field(double amplitude = 10.0,
                                          IEnumerable<TerrainFeature> features = null,
                                          RoadPath road = null)
        {
            return TerrainField.Generate(400.0, 32, amplitude, 0.01, 4242, features, road);
        }

        private static void TerrainMatchesTheWebGame()
        {
            Section("terrain");

            TerrainField a = Field();
            TerrainField b = Field();
            Check(a.Heights.Length == 33 * 33, "grid is (segments+1) squared");
            bool identical = true;
            for (int i = 0; i < a.Heights.Length; i++)
            {
                if (a.Heights[i] != b.Heights[i]) identical = false;
            }
            Check(identical, "generation is deterministic for a seed");

            // The rim lift makes the world a bowl rather than ending at a
            // cliff you can drive off.
            Check(a.Heights[a.Index(0, 0)] > a.Heights[a.Index(16, 16)],
                  "the rim sits above the middle");

            TerrainField flat = Field(amplitude: 0.0);
            TerrainField hilly = Field(amplitude: 0.0, features: new[]
            {
                new TerrainFeature { Kind = FeatureKind.Hill, X = 0, Z = 0, Radius = 80, Height = 25 },
            });
            Near(hilly.Heights[hilly.Index(16, 16)] - flat.Heights[flat.Index(16, 16)], 25.0, 0.5,
                 "a hill raises the ground under it by its height");

            TerrainField dug = Field(amplitude: 0.0, features: new[]
            {
                new TerrainFeature { Kind = FeatureKind.Crater, X = 0, Z = 0, Radius = 80, Height = 15 },
            });
            Check(dug.Heights[dug.Index(16, 16)] < flat.Heights[flat.Index(16, 16)] - 10,
                  "a crater lowers it");

            // A straight road at height 5 must flatten the ground to 5
            // wherever it passes, whatever the noise was doing underneath.
            var samples = new List<Vec3>();
            for (int x = -200; x <= 200; x += 2) samples.Add(new Vec3(x, 5.0, 0.0));
            RoadPath road = RoadPath.FromSamples(samples, false, 20.0, 10.0, 2.0);

            TerrainField carved = Field(road: road);
            bool flatUnderRoad = true;
            for (int ix = 12; ix <= 20; ix++)
            {
                if (Math.Abs(carved.Heights[carved.Index(ix, 16)] - 5.0) > 0.6) flatUnderRoad = false;
            }
            Check(flatUnderRoad, "the road is carved flat to its own height");

            // And the carve must be local: a corner is far outside road width
            // plus shoulder and should be untouched.
            TerrainField uncarved = Field();
            Near(carved.Heights[carved.Index(0, 0)], uncarved.Heights[uncarved.Index(0, 0)], 1e-9,
                 "ground far from the road is untouched");

            // Bilinear sampling has to agree with the grid it samples, or
            // props sit above or below the ground they were dropped onto.
            bool samplesAgree = true;
            for (int iz = 0; iz <= 32; iz += 7)
            {
                for (int ix = 0; ix <= 32; ix += 7)
                {
                    double direct = carved.Heights[carved.Index(ix, iz)];
                    double sampled = carved.SampleHeight(carved.WorldX(ix), carved.WorldZ(iz));
                    if (Math.Abs(direct - sampled) > 1e-9) samplesAgree = false;
                }
            }
            Check(samplesAgree, "SampleHeight lands exactly on grid points");

            // Flat ground must read as flat, or the automatic paint rules put
            // rock everywhere.
            TerrainField level = Field(amplitude: 0.0);
            Near(level.SlopeAt(16, 16), 0.0, 1e-6, "flat ground has zero slope");
            Check(hilly.SlopeAt(20, 16) > 0.05, "a hillside reads as sloped");
        }

        // ------------------------------------------------------------------
        // Road queries
        // ------------------------------------------------------------------

        /// <summary>A closed 200m square loop, sampled every 2m.</summary>
        private static RoadPath SquareLoop()
        {
            var samples = new List<Vec3>();
            const double side = 200.0;
            const double step = 2.0;
            for (double d = 0; d < side; d += step) samples.Add(new Vec3(d, 0, 0));
            for (double d = 0; d < side; d += step) samples.Add(new Vec3(side, 0, d));
            for (double d = 0; d < side; d += step) samples.Add(new Vec3(side - d, 0, side));
            for (double d = 0; d < side; d += step) samples.Add(new Vec3(0, 0, side - d));
            return RoadPath.FromSamples(samples, true, 14.0, 6.0, step);
        }

        /// <summary>
        /// The AI and the lap counter query the road every frame, including on
        /// the frames where a truck has been launched off a jump or shoved into
        /// the scenery. The bucket lookup gives up out there; the query must
        /// not, or an airborne truck stops making progress and the AI drives
        /// into the nearest hill.
        /// </summary>
        private static void RoadQueriesAnswerOffTheRoad()
        {
            Section("road queries");
            RoadPath road = SquareLoop();

            RoadQuery near = road.Query(100.0, 0.0);
            Near(near.Point.X, 100.0, 1.5, "a query on the road finds the road");
            Near(Math.Abs(near.Lateral), 0.0, 1.5, "and reports no lateral offset");

            // Far outside every bucket: the fallback sweep has to answer.
            RoadQuery far = road.Query(100.0, -4000.0);
            Check(far.Index >= 0, "a query far off the course still returns a sample");
            Near(far.Point.Z, 0.0, 1e-9, "and finds the nearest edge of the loop");

            // The sign convention, stated against RightAt rather than against
            // a hardcoded axis — the two must agree, because the AI's lane
            // offsets are built from RightAt and its reverse-out manoeuvre
            // steers on the sign of Lateral. Travelling +X along the first
            // side of the loop, right is -Z: in a left-handed frame, facing
            // +X puts your right hand towards -Z.
            int side = road.Points.Count / 8;
            Vec3 on = road.PointAt(side);
            Vec3 right = road.RightAt(side);
            Vec3 offsetRight = on + right * 30.0;
            Vec3 offsetLeft = on + right * -30.0;
            Check(road.Query(offsetRight.X, offsetRight.Z).Lateral > 0,
                  "right of the racing line is positive");
            Check(road.Query(offsetLeft.X, offsetLeft.Z).Lateral < 0,
                  "left of the racing line is negative");
            Near(road.Query(offsetRight.X, offsetRight.Z).Lateral, 30.0, 1.5,
                 "and the magnitude is the distance off the line");

            // A lap of a square turns through exactly 2pi.
            double turned = 0;
            int quarter = road.Points.Count / 4;
            for (int i = 0; i < 4; i++) turned += Math.Abs(road.CurvatureAt(i * quarter + quarter / 2, quarter));
            Near(turned, 2.0 * Math.PI, 0.2, "a lap of a square turns through 2pi");

            Check(road.Wrap(road.Points.Count + 3) == 3, "a closed road wraps its indices");
            RoadPath open = RoadPath.FromSamples(new List<Vec3> { new Vec3(0, 0, 0), new Vec3(0, 0, 2) }, false, 14, 6, 2);
            Check(open.Wrap(99) == 1, "an open road clamps rather than wrapping");
        }

        // ------------------------------------------------------------------
        // Handling numbers
        // ------------------------------------------------------------------

        /// <summary>
        /// Per stock truck: the ten derived numbers and the two verdicts,
        /// printed from the running src/game/handling.ts. These are the whole
        /// reason the formulas can live in four languages at once — every one
        /// of them is pinned here.
        /// </summary>
        private static readonly (string Id, double RestCompression, double RideHeight, double RideFrequency,
                                 double Rebound, double Compression, double Drive, double LiftThreshold,
                                 double WheelieMargin, double Launch, double BumpHeadroom,
                                 string DampingVerdict, string WheelieVerdict)[] HandlingReference =
        {
            ("boulder-hog", 0.24500000000000002, 2.025, 1.4235250868343543, 0.2683281572999748, 0.5142956348249516, 16800, 27565.827160493835, 0.6094502407704653, 10.5, 0.8550000000000001, "bouncy", "lifts"),
            ("mud-marshal", 0.17500000000000002, 2.095, 1.6843375973911696, 0.2929224665821511, 0.5480484858633795, 20800, 39134.5107398568, 0.5315001927139491, 8.851063829787234, 0.825, "bouncy", "lifts"),
            ("sky-ripper", 0.30625, 2.29375, 1.2732395447351628, 0.25, 0.55, 15600, 21598.238692098093, 0.7222811184926574, 10.985915492957746, 1.1437499999999998, "bouncy", "wheelies"),
            ("iron-bull", 0.18846153846153849, 2.081538461538462, 1.623068321020647, 0.26475678243654843, 0.49029033784546006, 22400, 32683.325942350333, 0.6853647648807545, 11.487179487179487, 0.7115384615384616, "bouncy", "lifts"),
            ("dust-devil", 0.3266666666666667, 1.8833333333333333, 1.2328088881229997, 0.25819888974716115, 0.5422176684690384, 13200, 21859.030088495576, 0.6038694281750026, 11.186440677966102, 0.8233333333333333, "bouncy", "lifts"),
            ("nitro-hawk", 0.1814814814814815, 1.9885185185185188, 1.6539866862653763, 0.32716515254078793, 0.5773502691896258, 18400, 28948.787483702738, 0.6356052048935944, 11.151515151515152, 0.6185185185185186, "bouncy", "lifts"),
        };

        private static void HandlingMatchesTheTypeScript()
        {
            Section("handling numbers, against the TypeScript");

            foreach (var expected in HandlingReference)
            {
                VehicleSpec spec = StockVehicles.ById(expected.Id);
                Check(spec != null, $"{expected.Id} is in the roster");
                if (spec == null) continue;

                HandlingNumbers n = Handling.Numbers(spec);
                Near(n.RestCompression, expected.RestCompression, 1e-12, $"{expected.Id} rest compression");
                Near(n.RideHeight, expected.RideHeight, 1e-12, $"{expected.Id} ride height");
                Near(n.RideFrequency, expected.RideFrequency, 1e-12, $"{expected.Id} ride frequency");
                Near(n.ReboundDamping, expected.Rebound, 1e-12, $"{expected.Id} rebound damping");
                Near(n.CompressionDamping, expected.Compression, 1e-12, $"{expected.Id} compression damping");
                Near(n.DriveForce, expected.Drive, 1e-9, $"{expected.Id} drive force");
                Near(n.FrontLiftThreshold, expected.LiftThreshold, 1e-9, $"{expected.Id} front lift threshold");
                Near(n.WheelieMargin, expected.WheelieMargin, 1e-12, $"{expected.Id} wheelie margin");
                Near(n.LaunchAcceleration, expected.Launch, 1e-12, $"{expected.Id} launch acceleration");
                Near(n.BumpHeadroom, expected.BumpHeadroom, 1e-12, $"{expected.Id} bump headroom");
                Check(Handling.DampingVerdict(n.ReboundDamping) == expected.DampingVerdict,
                      $"{expected.Id} damping reads as {expected.DampingVerdict}");
                Check(Handling.WheelieVerdict(n.WheelieMargin) == expected.WheelieVerdict,
                      $"{expected.Id} wheelie margin reads as {expected.WheelieVerdict}");
            }

            // The relationships the tuning advice in the README rests on.
            VehicleSpec stock = StockVehicles.BoulderHog();
            VehicleSpec stiffer = stock.Clone();
            stiffer.SuspensionStiffness *= 2.0;
            Check(Handling.Numbers(stiffer).RideHeight > Handling.Numbers(stock).RideHeight,
                  "stiffer springs raise the truck");

            VehicleSpec heavier = stock.Clone();
            heavier.Mass *= 2.0;
            Near(Handling.Numbers(heavier).ReboundDamping, Handling.Numbers(stock).ReboundDamping, 1e-12,
                 "the damping ratio does not depend on mass");
            Near(Handling.Numbers(heavier).RestCompression, Handling.Numbers(stock).RestCompression, 1e-12,
                 "nor does resting squat");

            VehicleSpec tall = stock.Clone();
            tall.AxleHeight -= 0.5;
            Check(Handling.Numbers(tall).WheelieMargin > Handling.Numbers(stock).WheelieMargin,
                  "a taller truck wheelies more easily");
        }

        // ------------------------------------------------------------------
        // The drive model
        // ------------------------------------------------------------------

        /// <summary>
        /// Every decision in the control layer is a rule rather than a physical
        /// law, and each of these is one that was arrived at by playing the web
        /// game rather than derived. They are worth holding still.
        /// </summary>
        private static void TheDriveModelObeysItsRules()
        {
            Section("the drive model");
            VehicleSpec spec = StockVehicles.BoulderHog();

            var model = new DriveModel(spec);
            DriveDemand demand = model.Step(new DriveInput { Throttle = 1.0 }, 0.0, 1.0 / 60.0);
            Near(demand.EngineForce, spec.EngineForce, 1e-9, "full throttle from rest gives full drive");
            Check(demand.BrakeForce == 0.0, "and no brake");

            // Drive tapers to nothing at the soft top speed rather than being
            // clamped, so the truck coasts up to it instead of hitting a wall.
            demand = model.Step(new DriveInput { Throttle = 1.0 }, spec.TopSpeed, 1.0 / 60.0);
            Near(demand.EngineForce, 0.0, 1e-9, "drive tapers to nothing at top speed");

            // The brake pedal becomes reverse once stopped. This is the rule
            // the grid hold exists to work around.
            model = new DriveModel(spec);
            demand = model.Step(new DriveInput { Brake = 1.0 }, 12.0, 1.0 / 60.0);
            Check(demand.BrakeForce > 0.0 && demand.EngineForce == 0.0, "braking at speed brakes");
            demand = model.Step(new DriveInput { Brake = 1.0 }, 0.0, 1.0 / 60.0);
            Check(demand.EngineForce < 0.0, "braking at a standstill reverses");
            Check(Math.Abs(demand.EngineForce) < spec.EngineForce,
                  "and reverse is weaker than forward drive");

            model = new DriveModel(spec);
            demand = model.Step(new DriveInput { Parked = true, Throttle = 1.0 }, 0.0, 1.0 / 60.0);
            Check(demand.EngineForce == 0.0 && demand.BrakeForce > spec.HandbrakeForce,
                  "a parked truck ignores the throttle and holds the line");

            // Coasting: light engine braking while moving, a hard hold once
            // stopped, or a truck parked on a camber slides away on its own.
            model = new DriveModel(spec);
            demand = model.Step(DriveInput.Idle, 10.0, 1.0 / 60.0);
            Check(demand.BrakeForce > 0.0 && demand.BrakeForce < spec.BrakeForce, "lifting off brakes lightly");
            demand = model.Step(DriveInput.Idle, 0.0, 1.0 / 60.0);
            Near(demand.BrakeForce, spec.HandbrakeForce, 1e-9, "a stopped truck is held");

            model = new DriveModel(spec);
            demand = model.Step(new DriveInput { Handbrake = true, Throttle = 1.0 }, 10.0, 1.0 / 60.0);
            Check(demand.RearGripFactor < 1.0, "the handbrake breaks rear traction");

            // Steering: rate-limited, and tapered with speed.
            model = new DriveModel(spec);
            double afterOneStep = model.Step(new DriveInput { Steer = 1.0 }, 0.0, 1.0 / 60.0).SteerAngle;
            Near(afterOneStep, spec.SteerRate / 60.0, 1e-12, "steering moves at its actuation rate");
            for (int i = 0; i < 240; i++) model.Step(new DriveInput { Steer = 1.0 }, 0.0, 1.0 / 60.0);
            Near(model.SteerAngle, spec.MaxSteer, 1e-9, "and reaches full lock at a standstill");

            var fast = new DriveModel(spec);
            for (int i = 0; i < 240; i++) fast.Step(new DriveInput { Steer = 1.0 }, spec.TopSpeed, 1.0 / 60.0);
            Near(fast.SteerAngle, spec.MaxSteer * spec.HighSpeedSteerFactor, 1e-9,
                 "at top speed the lock is tapered to its high-speed fraction");

            // Air control is an angular acceleration, not a torque: doubling
            // the mass must not change it. Getting this wrong detonates the
            // solver, which is why it is checked rather than assumed.
            model = new DriveModel(spec);
            model.AirControlSpin(new DriveInput { Throttle = 1.0 }, true, 0.5, out double pitch, out _, out _);
            Near(pitch, -spec.AirControl * 0.5, 1e-12, "throttle in the air pitches the nose up");
            model.AirControlSpin(new DriveInput { Throttle = 1.0 }, false, 0.5, out double grounded, out _, out _);
            Near(grounded, 0.0, 1e-12, "and does nothing with a wheel on the ground");

            Near(model.DownforceAt(20.0, false), spec.Downforce * 400.0, 1e-9, "downforce goes with speed squared");
            Near(model.DownforceAt(20.0, true), 0.0, 1e-12, "and is not generated in the air");

            // The rescue timers: inverted *and* stationary, so a barrel roll
            // mid-jump is not a rescue.
            model = new DriveModel(spec);
            model.UpdateRescueTimers(3.0, -1.0, 0.5, false);
            Check(model.NeedsRescue, "a truck on its roof needs rescuing");
            model = new DriveModel(spec);
            model.UpdateRescueTimers(3.0, -1.0, 20.0, false);
            Check(!model.NeedsRescue, "a truck rolling through the air does not");
            model = new DriveModel(spec);
            model.UpdateRescueTimers(3.0, 1.0, 0.0, true);
            Near(model.StuckFor, 0.0, 1e-12, "a truck held on the grid is not stuck");
        }

        // ------------------------------------------------------------------
        // The race director
        // ------------------------------------------------------------------

        /// <summary>
        /// Drives two racers round a square loop by teleporting them from gate
        /// to gate. No physics needed: what is being checked is the bookkeeping
        /// — that gates must be taken in order, that laps and times land on the
        /// right frame, and that the field is sorted by route rather than by
        /// raw distance.
        /// </summary>
        private static void TheRaceDirectorCountsLapsAndPositions()
        {
            Section("the race director");
            RoadPath road = SquareLoop();
            var course = new RaceCourse(road);

            Check(course.Checkpoints.Count >= 6, "a course always gets at least six gates");
            Check(course.Spawns.Count == 12, "and a full grid");
            Check(course.Spawns[0].Position.Y > RaceCourse.SpawnLift - 1e-9,
                  "grid slots are lifted clear of the ground");

            var race = new RaceDirector(course, totalLaps: 2);
            Racer player = race.Add("player", "YOU", true);
            Racer rival = race.Add("rival", "RIVAL", false);
            foreach (Racer r in race.Racers)
            {
                r.Position = course.Checkpoints[0].Position;
                r.Forward = course.Checkpoints[0].Forward;
            }

            Check(race.Locked, "the grid is held during the countdown");
            race.Update(4.0);
            Check(race.Phase == RacePhase.Racing, "and released when the countdown expires");

            // Skipping straight to the last gate must not count as a lap: the
            // sequence is what stops a truck cutting the infield.
            player.Position = course.Checkpoints[course.Checkpoints.Count - 1].Position;
            race.Update(1.0 / 60.0);
            Check(player.Lap == 0, "jumping to the final gate does not count a lap");

            DriveARacerRound(race, course, player, laps: 1);
            Check(player.Lap == 1, "taking every gate in order counts a lap");
            Check(player.LapTimes.Count == 1 && player.BestLap != null, "and records its time");
            Check(player.PositionIndex == 1, "the racer on the longer route leads");
            Check(rival.PositionIndex == 2, "and the one still on the line is second");

            DriveARacerRound(race, course, player, laps: 1);
            Check(player.Finished, "the last lap finishes the race");
            Check(race.Phase == RacePhase.Finished, "and the player finishing ends it");
            Check(rival.Finished && rival.FinishTime == null,
                  "a racer still running is classified, not given a finish time");
            Check(rival.PositionIndex == 2, "in the position they were running in");

            // Wrong way: measured on travel, so reversing back down the road is
            // not a wrong-way warning.
            var second = new RaceDirector(course, 3);
            Racer solo = second.Add("solo", "SOLO", true);
            solo.Position = course.Checkpoints[0].Position;
            second.Update(4.0);
            solo.Forward = course.Checkpoints[0].Forward * -1.0;
            solo.ForwardSpeed = 10.0;
            second.Update(1.0 / 60.0);
            Check(solo.WrongWay, "facing backwards and driving is the wrong way");
            solo.ForwardSpeed = -10.0;
            second.Update(1.0 / 60.0);
            Check(!solo.WrongWay, "reversing back down the road is not");

            Check(RaceDirector.FormatTime(null) == "--:--.--", "an unset time reads as dashes");
            Check(RaceDirector.FormatTime(83.456) == "01:23.45", "times are mm:ss.hh");
            Check(RaceDirector.Ordinal(1) == "1ST" && RaceDirector.Ordinal(2) == "2ND"
                  && RaceDirector.Ordinal(3) == "3RD" && RaceDirector.Ordinal(4) == "4TH"
                  && RaceDirector.Ordinal(11) == "11TH", "positions are ordinals");
        }

        /// <summary>Walk a racer through every gate, in order, for whole laps.</summary>
        private static void DriveARacerRound(RaceDirector race, RaceCourse course, Racer racer, int laps)
        {
            for (int lap = 0; lap < laps; lap++)
            {
                for (int i = 0; i < course.Checkpoints.Count; i++)
                {
                    Checkpoint gate = course.Checkpoints[racer.NextCheckpoint];
                    racer.Position = gate.Position;
                    racer.Forward = gate.Forward;
                    race.Update(1.0 / 60.0);
                }
            }
        }

    }
}
