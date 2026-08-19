"""
Tests for the sculpted-terrain bake.

A baked heightmap is a wall of base64 that nobody will ever eyeball. If the
byte order, the row order or the grid origin is wrong, the track still loads
and the ground is simply in the wrong place — so the encoding is pinned here
against what `decodeHeightmap` in `src/game/Terrain.ts` actually reads back.

Run with:  python3 blender/tests/test_heightmap.py
"""

import base64
import importlib
import math
import os
import struct
import sys
import types
import unittest

sys.modules["mathutils"] = types.ModuleType("mathutils")
sys.modules["mathutils"].Vector = tuple
_ADDON = os.path.join(os.path.dirname(__file__), "..", "mtm_tools")
_package = types.ModuleType("mtm_tools")
_package.__path__ = [_ADDON]
sys.modules["mtm_tools"] = _package

heightmap = importlib.import_module("mtm_tools.heightmap")


def surface(segments, size=400.0):
    """A dome plus a diagonal ramp: asymmetric in both axes, so a transposed
    or mirrored grid cannot pass by accident."""
    heights = []
    for iz in range(segments + 1):
        for ix in range(segments + 1):
            u = ix / segments * 2 - 1
            v = iz / segments * 2 - 1
            heights.append(30.0 * math.exp(-(u * u + v * v) * 2.5) + 4.0 * u - 7.0 * v)
    return heights


class TestEncoding(unittest.TestCase):
    def test_round_trips_through_float32(self):
        heights = surface(16)
        raw = base64.b64decode(heightmap.encode_heights(heights))
        decoded = struct.unpack(f"<{len(heights)}f", raw)
        self.assertEqual(len(decoded), len(heights))
        for original, back in zip(heights, decoded):
            self.assertAlmostEqual(original, back, places=5)

    def test_is_little_endian_float32(self):
        # The runtime reads the bytes as a Float32Array, which is little-endian
        # on every platform the game runs on. Four bytes per height, no padding.
        encoded = heightmap.encode_heights([1.0, -2.0])
        self.assertEqual(base64.b64decode(encoded), b"\x00\x00\x80\x3f\x00\x00\x00\xc0")

    def test_size_is_predictable(self):
        # Base64 is 4 bytes out per 3 in, so a 256-segment bake is ~340KB.
        # Worth knowing before it lands in a track file.
        encoded = heightmap.encode_heights([0.0] * (257 * 257))
        self.assertAlmostEqual(len(encoded) / 1024, 344, delta=2)


class TestSampleGrid(unittest.TestCase):
    SIZE = 400.0
    SEGMENTS = 16

    def setUp(self):
        self.heights = surface(self.SEGMENTS, self.SIZE)

    def sample(self, x, z):
        return heightmap.sample_grid(self.heights, self.SIZE, self.SEGMENTS, x, z)

    def test_hits_grid_vertices_exactly(self):
        row = self.SEGMENTS + 1
        element = self.SIZE / self.SEGMENTS
        for iz in (0, 5, self.SEGMENTS):
            for ix in (0, 9, self.SEGMENTS):
                x = -self.SIZE / 2 + ix * element
                z = -self.SIZE / 2 + iz * element
                self.assertAlmostEqual(self.sample(x, z), self.heights[iz * row + ix], places=9)

    def test_interpolates_between_them(self):
        row = self.SEGMENTS + 1
        element = self.SIZE / self.SEGMENTS
        x = -self.SIZE / 2 + 4 * element
        z = -self.SIZE / 2 + 4.5 * element
        expected = (self.heights[4 * row + 4] + self.heights[5 * row + 4]) / 2
        self.assertAlmostEqual(self.sample(x, z), expected, places=9)

    def test_x_and_z_are_not_transposed(self):
        # The surface is deliberately asymmetric; swapping the axes changes it.
        self.assertNotAlmostEqual(self.sample(120.0, -60.0), self.sample(-60.0, 120.0), places=3)

    def test_outside_the_patch_clamps_instead_of_exploding(self):
        for x, z in ((-1e6, 0.0), (1e6, 0.0), (0.0, -1e6), (0.0, 1e6), (1e6, 1e6)):
            value = self.sample(x, z)
            self.assertTrue(math.isfinite(value))
            self.assertGreaterEqual(value, min(self.heights) - 1e-6)
            self.assertLessEqual(value, max(self.heights) + 1e-6)


class TestRoadAlignment(unittest.TestCase):
    """
    The two ways a sculpted track goes wrong, both silent until you drive it.
    Measured in the browser: ground 15m above the road with a 12m shoulder
    puts the course in a trench, and turning the carve off with the same
    mismatch starts the whole grid on its roof.
    """

    SIZE = 400.0
    SEGMENTS = 8

    def flat_ground(self, height):
        return [float(height)] * ((self.SEGMENTS + 1) ** 2)

    def road_at(self, height):
        return {"points": [{"pos": [x * 20.0, float(height), 0.0]} for x in range(-8, 9)]}

    def check(self, ground, road_height, shoulder, carve):
        problems = []
        heightmap.check_road_alignment(
            self.flat_ground(ground),
            self.SIZE,
            self.SEGMENTS,
            self.road_at(road_height),
            shoulder,
            carve,
            problems,
        )
        return problems

    def test_matching_ground_is_quiet(self):
        self.assertEqual(self.check(5.0, 5.0, 12.0, True), [])
        self.assertEqual(self.check(5.0, 5.0, 12.0, False), [])

    def test_carve_tolerates_a_gap_it_can_blend(self):
        self.assertEqual(self.check(0.0, 6.0, 12.0, True), [])

    def test_carve_warns_about_a_trench(self):
        problems = self.check(25.0, 0.0, 5.0, True)
        self.assertEqual(len(problems), 1)
        self.assertIn("trench", problems[0])
        self.assertIn("25m", problems[0])

    def test_a_wider_shoulder_buys_more_room(self):
        self.assertEqual(len(self.check(25.0, 0.0, 5.0, True)), 1)
        self.assertEqual(self.check(25.0, 0.0, 20.0, True), [])

    def test_no_carve_warns_about_a_much_smaller_gap(self):
        # Without the carve there is no blend at all, so metres matter.
        problems = self.check(0.0, 9.0, 20.0, False)
        self.assertEqual(len(problems), 1)
        self.assertIn("buried or falling", problems[0])

    def test_direction_is_reported_correctly(self):
        below = self.check(-30.0, 0.0, 5.0, True)[0]
        above = self.check(30.0, 0.0, 5.0, True)[0]
        self.assertIn("below", below)
        self.assertIn("above", above)

    def test_an_empty_road_is_not_an_error(self):
        problems = []
        heightmap.check_road_alignment(
            self.flat_ground(0.0), self.SIZE, self.SEGMENTS, {"points": []}, 12.0, True, problems
        )
        self.assertEqual(problems, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
