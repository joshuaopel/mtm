"""
Tests for the Blender/game coordinate conversion.

These run without Blender: `mathutils` is stubbed with just enough vector and
matrix behaviour for the pure functions in `convert.py`. The conversion is
worth testing precisely because its failure mode is silent — a wrong axis
produces a mirrored track that looks plausible until you drive it.

Run with:  python3 blender/tests/test_convert.py
"""

import math
import os
import sys
import types
import unittest

# --- minimal mathutils stub -------------------------------------------------


class Vector:
    def __init__(self, values=(0.0, 0.0, 0.0)):
        self.x, self.y, self.z = (float(v) for v in values)

    def __iter__(self):
        return iter((self.x, self.y, self.z))

    def __add__(self, other):
        return Vector((self.x + other.x, self.y + other.y, self.z + other.z))

    def __sub__(self, other):
        return Vector((self.x - other.x, self.y - other.y, self.z - other.z))

    def __mul__(self, scalar):
        return Vector((self.x * scalar, self.y * scalar, self.z * scalar))

    __rmul__ = __mul__

    @property
    def length(self):
        return math.sqrt(self.x**2 + self.y**2 + self.z**2)

    def lerp(self, other, t):
        return Vector(
            (
                self.x + (other.x - self.x) * t,
                self.y + (other.y - self.y) * t,
                self.z + (other.z - self.z) * t,
            )
        )

    def copy(self):
        return Vector((self.x, self.y, self.z))

    def __repr__(self):
        return f"Vector(({self.x}, {self.y}, {self.z}))"


class Matrix3:
    """3x3 rotation, stored row-major."""

    def __init__(self, rows):
        self.rows = rows

    def __matmul__(self, vector):
        return Vector(
            tuple(
                self.rows[i][0] * vector.x + self.rows[i][1] * vector.y + self.rows[i][2] * vector.z
                for i in range(3)
            )
        )


class Matrix:
    def __init__(self, rows):
        self.rows = rows

    @staticmethod
    def rotation_z(angle):
        c, s = math.cos(angle), math.sin(angle)
        return Matrix([[c, -s, 0], [s, c, 0], [0, 0, 1]])

    def to_3x3(self):
        return Matrix3([row[:3] for row in self.rows[:3]])


stub = types.ModuleType("mathutils")
stub.Vector = Vector
stub.Matrix = Matrix
sys.modules["mathutils"] = stub

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "mtm_tools"))
import convert  # noqa: E402


# --- tests ------------------------------------------------------------------


class TestPositionConversion(unittest.TestCase):
    def test_blender_up_becomes_game_up(self):
        # Blender +Z (up) must land on game +Y (up).
        self.assertEqual(convert.convert_position(Vector((0, 0, 5))), [0.0, 5.0, 0.0])

    def test_blender_forward_becomes_negative_z(self):
        # Blender +Y (forward) must land on game -Z (three.js forward).
        self.assertEqual(convert.convert_position(Vector((0, 3, 0))), [0.0, 0.0, -3.0])

    def test_right_is_preserved(self):
        self.assertEqual(convert.convert_position(Vector((7, 0, 0))), [7.0, 0.0, 0.0])

    def test_conversion_preserves_length(self):
        source = Vector((3, -4, 12))
        converted = convert.convert_position(source)
        self.assertAlmostEqual(
            math.sqrt(sum(c * c for c in converted)),
            source.length,
            places=4,
        )

    def test_conversion_is_handedness_preserving(self):
        # Blender's X cross Y = Z must map to the game's equivalent, or the
        # exported world comes out mirrored.
        x = convert.convert_direction(Vector((1, 0, 0)))
        y = convert.convert_direction(Vector((0, 1, 0)))
        z = convert.convert_direction(Vector((0, 0, 1)))
        cross = Vector(
            (
                x.y * y.z - x.z * y.y,
                x.z * y.x - x.x * y.z,
                x.x * y.y - x.y * y.x,
            )
        )
        self.assertAlmostEqual(cross.x, z.x, places=5)
        self.assertAlmostEqual(cross.y, z.y, places=5)
        self.assertAlmostEqual(cross.z, z.z, places=5)


class TestSizeConversion(unittest.TestCase):
    def test_axes_swap_without_sign_flip(self):
        # Blender (width, depth, height) -> game (width, height, depth).
        self.assertEqual(convert.convert_size(Vector((2, 5, 1))), [2.0, 1.0, 5.0])

    def test_sizes_are_unsigned(self):
        self.assertEqual(convert.convert_size(Vector((-2, -5, -1))), [2.0, 1.0, 5.0])


class TestYaw(unittest.TestCase):
    def test_unrotated_forward_points_down_negative_z(self):
        # An unrotated object faces Blender +Y, i.e. game -Z, which the game
        # reconstructs as a yaw of 180 degrees.
        yaw = convert.yaw_degrees(Matrix.rotation_z(0.0))
        self.assertAlmostEqual(abs(yaw), 180.0, places=3)

    def test_quarter_turn_changes_yaw_by_ninety(self):
        base = convert.yaw_degrees(Matrix.rotation_z(0.0))
        turned = convert.yaw_degrees(Matrix.rotation_z(math.radians(90)))
        delta = (turned - base + 540) % 360 - 180
        self.assertAlmostEqual(abs(delta), 90.0, places=3)

    def test_box_yaw_is_zero_when_unrotated(self):
        self.assertAlmostEqual(convert.box_yaw_degrees(Matrix.rotation_z(0.0)), 0.0, places=3)

    def test_box_yaw_matches_blender_rotation(self):
        # A Blender rotation about +Z by t must export as a game yaw of t,
        # since both are the vertical axis in their own space.
        for degrees in (30, 90, 145, -60):
            with self.subTest(degrees=degrees):
                yaw = convert.box_yaw_degrees(Matrix.rotation_z(math.radians(degrees)))
                self.assertAlmostEqual(yaw, degrees, places=3)


class TestColor(unittest.TestCase):
    def test_black_and_white(self):
        self.assertEqual(convert.to_hex((0.0, 0.0, 0.0)), "#000000")
        self.assertEqual(convert.to_hex((1.0, 1.0, 1.0)), "#ffffff")

    def test_linear_is_converted_to_srgb(self):
        # Linear 0.5 is around 188 in sRGB, not 128. Getting this wrong makes
        # every exported colour noticeably dark.
        self.assertEqual(convert.to_hex((0.5, 0.5, 0.5)), "#bcbcbc")

    def test_values_are_clamped(self):
        self.assertEqual(convert.to_hex((2.0, -1.0, 0.0)), "#ff0000")


class TestResample(unittest.TestCase):
    def test_even_spacing_along_a_straight_line(self):
        points = [Vector((i, 0, 0)) for i in range(0, 101)]
        result = convert.resample_polyline(points, 10.0)
        gaps = [(result[i + 1] - result[i]).length for i in range(len(result) - 1)]
        for gap in gaps:
            self.assertAlmostEqual(gap, 10.0, places=3)

    def test_short_input_is_returned_unchanged(self):
        self.assertEqual(len(convert.resample_polyline([Vector((0, 0, 0))], 5.0)), 1)

    def test_duplicate_points_do_not_hang(self):
        points = [Vector((0, 0, 0))] * 10 + [Vector((50, 0, 0))]
        result = convert.resample_polyline(points, 5.0)
        self.assertGreater(len(result), 1)

    def test_closed_loop_does_not_duplicate_the_seam(self):
        # A ring sampled all the way round must not end almost on top of its
        # own start, which would give the game a zero-length segment.
        ring = [
            Vector((math.cos(a * math.tau / 200) * 100, math.sin(a * math.tau / 200) * 100, 0))
            for a in range(201)
        ]
        result = convert.resample_polyline(ring, 20.0)
        seam = (result[-1] - result[0]).length
        self.assertGreater(seam, 10.0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
