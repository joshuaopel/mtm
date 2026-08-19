"""
Tests for the terrain and road generation port.

`blender/mtm_tools/generate.py` is a port of the runtime's generation code so
that Blender can preview the ground you will actually drive on. If the two
drift apart the preview quietly starts lying, which is worse than having no
preview at all — so the noise reference values below were produced by the
TypeScript in `src/core/Noise.ts` and are pinned here.

Run with:  python3 blender/tests/test_generate.py
"""

import importlib
import math
import os
import sys
import types
import unittest

sys.modules["mathutils"] = types.ModuleType("mathutils")
_ADDON = os.path.join(os.path.dirname(__file__), "..", "mtm_tools")
_package = types.ModuleType("mtm_tools")
_package.__path__ = [_ADDON]
sys.modules["mtm_tools"] = _package

generate = importlib.import_module("mtm_tools.generate")


class TestValueNoise(unittest.TestCase):
    """Reference values taken from the TypeScript implementation."""

    # (seed, x, y, fbm(x, y, 4), sample(x, y)), printed by node from a
    # compiled `src/core/Noise.ts`. Both languages use IEEE doubles here, so
    # these should agree to the last bit, not merely to a tolerance.
    REFERENCE = [
        (1101, 0.0, 0.0, 0.617842318257317, 0.617842318257317),
        (1101, 1.5, -2.25, 0.37761605190850484, 0.411292769418651),
        (5505, 123.456, -987.654, 0.3663739720266263, 0.27546547513039144),
        (8821, -0.001, 0.001, 0.5025534431437741, 0.5025568659853799),
        (8821, 1000.0, 1000.0, 0.5983232556997488, 0.8045466088224202),
        (99, -5.5, -3.25, 0.5047832289419603, 0.377474898359651),
        (99, 5.5, 3.25, 0.2699024747669076, 0.19216773212247062),
    ]

    def test_fbm_matches_the_typescript(self):
        for seed, x, y, expected, _ in self.REFERENCE:
            with self.subTest(seed=seed, x=x, y=y):
                noise = generate.ValueNoise2D(seed)
                self.assertEqual(noise.fbm(x, y, 4), expected)

    def test_sample_matches_the_typescript(self):
        for seed, x, y, _, expected in self.REFERENCE:
            with self.subTest(seed=seed, x=x, y=y):
                noise = generate.ValueNoise2D(seed)
                self.assertEqual(noise.sample(x, y), expected)

    def test_noise_is_bounded(self):
        noise = generate.ValueNoise2D(1234)
        for i in range(400):
            value = noise.fbm(i * 0.37 - 70, i * -0.21 + 15, 4)
            self.assertGreaterEqual(value, 0.0)
            self.assertLessEqual(value, 1.0)

    def test_seeds_differ(self):
        a = generate.ValueNoise2D(1).fbm(3.5, 7.25, 4)
        b = generate.ValueNoise2D(2).fbm(3.5, 7.25, 4)
        self.assertNotAlmostEqual(a, b, places=6)

    def test_negative_coordinates_do_not_wrap(self):
        # The hash uses 32-bit wraparound multiply; a sign-handling mistake
        # shows up as mirrored terrain across the origin.
        noise = generate.ValueNoise2D(99)
        self.assertNotAlmostEqual(noise.sample(-5.5, -3.25), noise.sample(5.5, 3.25), places=6)


class TestCatmullRom(unittest.TestCase):
    """
    Reference values printed by node from three.js's own CatmullRomCurve3, the
    class `RoadPath` uses. Anywhere these disagree the preview shows a road the
    game will not build.
    """

    SQUARE = [(-100.0, 0.0, -100.0), (100.0, 0.0, -100.0), (100.0, 0.0, 100.0), (-100.0, 0.0, 100.0)]
    UNEVEN = [(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (100.0, 0.0, 0.0), (101.0, 0.0, 5.0)]
    HILLY = [
        (0.0, 2.0, 0.0),
        (60.0, 9.0, -30.0),
        (130.0, 4.0, 10.0),
        (90.0, -3.0, 90.0),
        (10.0, 6.0, 70.0),
        (-50.0, 1.0, 20.0),
    ]

    def test_length_matches_three(self):
        cases = [
            (self.SQUARE, True, 840.7218853683465),
            (self.UNEVEN, False, 105.68990603214777),
            (self.HILLY, True, 466.8115844032844),
        ]
        for control, closed, expected in cases:
            with self.subTest(closed=closed, n=len(control)):
                curve = generate.CatmullRomCurve3(control, closed)
                self.assertAlmostEqual(curve.get_length(), expected, places=9)

    def test_get_point_matches_three(self):
        # three.js `getPoint(t)` on the hilly closed loop.
        expected = {
            0.0: (0.0, 2.0, 0.0),
            0.13: (46.46599108326515, 8.082098993792883, -27.50123157946683),
            0.37: (129.84515807425774, 2.2639993369600875, 26.940805102452522),
            0.5: (90.0, -3.0, 90.0),
            0.86: (-47.14421555474135, 0.8431449505315751, 15.769572936863442),
            1.0: (0.0, 2.0, 0.0),
        }
        curve = generate.CatmullRomCurve3(self.HILLY, True)
        for t, point in expected.items():
            with self.subTest(t=t):
                self.assertLess(math.dist(curve.get_point(t), point), 1e-9)

    def test_open_curve_extrapolates_past_its_ends(self):
        # three reflects a virtual point past each end rather than repeating
        # the endpoint. Repeating it pins the tangent and bends the road away
        # from the start line, so this is not a detail.
        curve = generate.CatmullRomCurve3(self.UNEVEN, False)
        start = curve.get_point(0.0)
        end = curve.get_point(1.0)
        self.assertLess(math.dist(start, self.UNEVEN[0]), 1e-9)
        self.assertLess(math.dist(end, self.UNEVEN[-1]), 1e-9)
        # Just off the start the curve heads along +x, not back on itself.
        self.assertGreater(curve.get_point(0.01)[0], start[0])

    def test_curve_passes_through_its_control_points(self):
        points, _, _ = generate.road_polyline(self.SQUARE, True, 1.0)
        for c in self.SQUARE:
            nearest = min(math.dist(c, p) for p in points)
            self.assertLess(nearest, 1.0)

    def test_resample_is_evenly_spaced(self):
        points, step, length = generate.road_polyline(self.SQUARE, True, 5.0)
        gaps = [math.dist(points[i], points[i + 1]) for i in range(len(points) - 1)]
        for gap in gaps:
            self.assertAlmostEqual(gap, step, delta=step * 0.25)
        self.assertGreater(length, 700)

    def test_closed_loop_drops_the_duplicated_sample(self):
        # getSpacedPoints returns divisions+1 points and the last repeats the
        # first on a loop; keeping it leaves a zero-length segment at the line.
        points, step, length = generate.road_polyline(self.SQUARE, True, 1.5)
        self.assertGreater(math.dist(points[0], points[-1]), step * 0.5)
        self.assertAlmostEqual(len(points) * step, length, delta=1e-6)

    def test_uneven_control_spacing_does_not_produce_a_cusp(self):
        # Control points 1m apart followed by a 99m straight is the case
        # centripetal parameterisation exists for: uniform Catmull-Rom loops
        # back to x = -6.5 here, a visible kink in the road at the start line.
        points, step, _ = generate.road_polyline(self.UNEVEN, False, 0.5)
        xs = [p[0] for p in points]
        self.assertGreaterEqual(min(xs), -1e-9)
        # three's arc-length table is 200 divisions for the whole curve, so a
        # curve whose speed varies this wildly gets a few centimetres of
        # jitter. That is the game's jitter too; what matters is that it stays
        # a small fraction of a step rather than a fold in the road.
        backtrack = max((xs[i] - xs[i + 1] for i in range(len(xs) - 1)), default=0.0)
        self.assertLess(backtrack, step * 0.1)


class TestTerrain(unittest.TestCase):
    def terrain(self, **overrides):
        base = {
            "size": 400.0,
            "segments": 32,
            "amplitude": 10.0,
            "frequency": 0.01,
            "seed": 4242,
            "features": [],
        }
        base.update(overrides)
        return base

    def test_grid_size_and_determinism(self):
        a = generate.generate_heights(self.terrain(), None, segments=32)
        b = generate.generate_heights(self.terrain(), None, segments=32)
        self.assertEqual(len(a), 33 * 33)
        self.assertEqual(a, b)

    def test_rim_is_lifted(self):
        heights = generate.generate_heights(self.terrain(), None, segments=32)
        n = 32
        corner = heights[0]
        centre = heights[(n // 2) * (n + 1) + n // 2]
        # The edge lift makes the world a bowl so it does not end at a cliff.
        self.assertGreater(corner, centre)

    def test_a_hill_raises_the_ground_beneath_it(self):
        flat = generate.generate_heights(self.terrain(amplitude=0.0), None, segments=32)
        hilly = generate.generate_heights(
            self.terrain(
                amplitude=0.0,
                features=[{"type": "hill", "pos": [0, 0], "radius": 80, "height": 25}],
            ),
            None,
            segments=32,
        )
        centre = 16 * 33 + 16
        self.assertAlmostEqual(hilly[centre] - flat[centre], 25.0, delta=0.5)

    def test_a_crater_lowers_it(self):
        flat = generate.generate_heights(self.terrain(amplitude=0.0), None, segments=32)
        dug = generate.generate_heights(
            self.terrain(
                amplitude=0.0,
                features=[{"type": "crater", "pos": [0, 0], "radius": 80, "depth": 15}],
            ),
            None,
            segments=32,
        )
        centre = 16 * 33 + 16
        self.assertLess(dug[centre], flat[centre] - 10)

    def test_the_road_is_carved_flat(self):
        # A straight road along x at height 5 should flatten the ground to 5
        # wherever it passes, whatever the noise was doing.
        points = [(x, 5.0, 0.0) for x in range(-200, 201, 2)]
        road = generate.RoadSamples(points, width=20.0, shoulder=10.0, step=2.0)
        heights = generate.generate_heights(self.terrain(), road, segments=32)

        n = 32
        centre_row = n // 2
        for ix in range(12, 21):
            height = heights[centre_row * (n + 1) + ix]
            self.assertAlmostEqual(height, 5.0, delta=0.6)

    def test_terrain_away_from_the_road_is_untouched(self):
        points = [(x, 5.0, 0.0) for x in range(-200, 201, 2)]
        road = generate.RoadSamples(points, width=20.0, shoulder=10.0, step=2.0)
        with_road = generate.generate_heights(self.terrain(), road, segments=32)
        without = generate.generate_heights(self.terrain(), None, segments=32)
        # A corner is far outside road width + shoulder.
        self.assertAlmostEqual(with_road[0], without[0], places=9)


if __name__ == "__main__":
    unittest.main(verbosity=2)
