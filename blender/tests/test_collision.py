"""
Tests for the collider convexity check.

This runs without Blender: `mathutils` is stubbed with the small amount of
vector maths the check needs.

The convexity test is worth covering because its failure mode is invisible.
A concave collider exports and loads perfectly happily, and only shows up as
trucks driving through geometry at speed — by which point the cause is a long
way from the symptom.

Run with:  python3 blender/tests/test_collision.py
"""

import math
import os
import sys
import types
import unittest


class Vector:
    def __init__(self, values=(0.0, 0.0, 0.0)):
        self.x, self.y, self.z = (float(v) for v in values)

    def __sub__(self, other):
        return Vector((self.x - other.x, self.y - other.y, self.z - other.z))

    def cross(self, other):
        return Vector(
            (
                self.y * other.z - self.z * other.y,
                self.z * other.x - self.x * other.z,
                self.x * other.y - self.y * other.x,
            )
        )

    def dot(self, other):
        return self.x * other.x + self.y * other.y + self.z * other.z

    @property
    def length(self):
        return math.sqrt(self.x**2 + self.y**2 + self.z**2)

    def normalize(self):
        length = self.length
        if length > 0:
            self.x /= length
            self.y /= length
            self.z /= length
        return self


stub = types.ModuleType("mathutils")
stub.Vector = Vector
stub.Matrix = object
sys.modules["mathutils"] = stub

# `collision` uses package-relative imports, so register a stand-in package
# pointing at the add-on directory. This loads the submodule without running
# the real __init__.py, which would need Blender.
_ADDON = os.path.join(os.path.dirname(__file__), "..", "mtm_tools")
_package = types.ModuleType("mtm_tools")
_package.__path__ = [_ADDON]
sys.modules["mtm_tools"] = _package

import importlib  # noqa: E402

_collision = importlib.import_module("mtm_tools.collision")
CONVEX_TOLERANCE = _collision.CONVEX_TOLERANCE
convexity_report = _collision.convexity_report


def cube(size=1.0):
    """Unit cube as (vertices, triangles), wound outward."""
    h = size / 2
    verts = [
        Vector((-h, -h, -h)), Vector((h, -h, -h)), Vector((h, h, -h)), Vector((-h, h, -h)),
        Vector((-h, -h, h)), Vector((h, -h, h)), Vector((h, h, h)), Vector((-h, h, h)),
    ]
    faces = [
        (0, 2, 1), (0, 3, 2),  # bottom
        (4, 5, 6), (4, 6, 7),  # top
        (0, 1, 5), (0, 5, 4),  # front
        (1, 2, 6), (1, 6, 5),  # right
        (2, 3, 7), (2, 7, 6),  # back
        (3, 0, 4), (3, 4, 7),  # left
    ]
    return verts, faces


class TestConvexity(unittest.TestCase):
    def test_cube_is_convex(self):
        verts, faces = cube()
        self.assertLessEqual(convexity_report(verts, faces), CONVEX_TOLERANCE)

    def test_large_cube_is_convex(self):
        # Scale must not affect the verdict, only the reported magnitude.
        verts, faces = cube(40.0)
        self.assertLessEqual(convexity_report(verts, faces), CONVEX_TOLERANCE)

    def test_tetrahedron_is_convex(self):
        verts = [
            Vector((0, 0, 0)), Vector((1, 0, 0)),
            Vector((0, 1, 0)), Vector((0, 0, 1)),
        ]
        faces = [(0, 2, 1), (0, 1, 3), (0, 3, 2), (1, 2, 3)]
        self.assertLessEqual(convexity_report(verts, faces), CONVEX_TOLERANCE)

    def test_dented_cube_is_rejected(self):
        # Push one corner inward: the classic concave collider that would
        # silently let trucks through.
        verts, faces = cube(2.0)
        verts[6] = Vector((0.2, 0.2, 0.2))
        excursion = convexity_report(verts, faces)
        self.assertGreater(excursion, CONVEX_TOLERANCE)

    def test_excursion_scales_with_the_dent(self):
        verts, faces = cube(2.0)
        verts[6] = Vector((0.9, 0.9, 0.9))
        small = convexity_report(verts, faces)

        verts, faces = cube(2.0)
        verts[6] = Vector((-0.5, -0.5, -0.5))
        large = convexity_report(verts, faces)

        self.assertGreater(large, small)

    def test_too_few_vertices_is_infinite(self):
        verts = [Vector((0, 0, 0)), Vector((1, 0, 0)), Vector((0, 1, 0))]
        self.assertEqual(convexity_report(verts, [(0, 1, 2)]), math.inf)

    def test_degenerate_faces_do_not_crash(self):
        # A zero-area triangle has no usable normal; it must be skipped
        # rather than producing a NaN that poisons the comparison.
        verts, faces = cube()
        faces = list(faces) + [(0, 0, 0)]
        result = convexity_report(verts, faces)
        self.assertFalse(math.isnan(result))
        self.assertLessEqual(result, CONVEX_TOLERANCE)


if __name__ == "__main__":
    unittest.main(verbosity=2)
