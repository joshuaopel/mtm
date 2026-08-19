"""
Tests for the vehicle colour atlas.

Blender and the runtime each hold their own copy of the palette — Blender needs
it to build an image you can see while modelling, the engine needs it to build
the texture it actually renders. If those drift, picking a colour in the
viewport hands you a different one in the game, and nothing about the model
looks wrong; you just get the colour from the next cell along.

So this reads the TypeScript directly rather than restating it, and compares.

Run with:  python3 blender/tests/test_palette.py
"""

import importlib
import os
import re
import sys
import types
import unittest

sys.modules["mathutils"] = types.ModuleType("mathutils")
_ADDON = os.path.join(os.path.dirname(__file__), "..", "mtm_tools")
_package = types.ModuleType("mtm_tools")
_package.__path__ = [_ADDON]
sys.modules["mtm_tools"] = _package

palette = importlib.import_module("mtm_tools.palette")

_TYPESCRIPT = os.path.join(
    os.path.dirname(__file__), "..", "..", "src", "core", "Palette.ts"
)


def typescript_list(name):
    """Pull a `readonly string[]` out of Palette.ts without running it."""
    with open(_TYPESCRIPT) as handle:
        source = handle.read()
    match = re.search(rf"export const {name}: readonly string\[\] = \[(.*?)\];", source, re.S)
    if match is None:
        raise AssertionError(f"{name} not found in Palette.ts")
    return re.findall(r"'([^']*)'", match.group(1))


def typescript_number(name):
    with open(_TYPESCRIPT) as handle:
        source = handle.read()
    match = re.search(rf"export const {name} = (\d+);", source)
    if match is None:
        raise AssertionError(f"{name} not found in Palette.ts")
    return int(match.group(1))


class TestParity(unittest.TestCase):
    def test_the_colours_match_the_engine(self):
        self.assertEqual(
            [hexcode for _, hexcode in palette.PALETTE],
            typescript_list("PALETTE"),
        )

    def test_the_names_match_the_engine(self):
        self.assertEqual(
            [name for name, _ in palette.PALETTE],
            typescript_list("PALETTE_NAMES"),
        )

    def test_the_grid_is_the_same_shape(self):
        self.assertEqual(palette.COLUMNS, typescript_number("PALETTE_COLUMNS"))

    def test_the_material_name_matches(self):
        with open(_TYPESCRIPT) as handle:
            source = handle.read()
        match = re.search(r"export const PALETTE_MATERIAL = '([^']+)';", source)
        self.assertIsNotNone(match)
        self.assertEqual(palette.MATERIAL_NAME, match.group(1))

    def test_the_sheet_is_full(self):
        self.assertEqual(len(palette.PALETTE), palette.COLUMNS**2)


class TestHex(unittest.TestCase):
    def test_parses_to_unit_floats(self):
        self.assertEqual(palette.hex_to_rgb("#000000"), (0.0, 0.0, 0.0))
        self.assertEqual(palette.hex_to_rgb("#ffffff"), (1.0, 1.0, 1.0))
        r, g, b = palette.hex_to_rgb("#a8412a")
        self.assertAlmostEqual(r, 168 / 255)
        self.assertAlmostEqual(g, 65 / 255)
        self.assertAlmostEqual(b, 42 / 255)

    def test_every_palette_entry_parses(self):
        for name, hexcode in palette.PALETTE:
            with self.subTest(colour=name):
                self.assertRegex(hexcode, r"^#[0-9a-f]{6}$")
                for channel in palette.hex_to_rgb(hexcode):
                    self.assertGreaterEqual(channel, 0.0)
                    self.assertLessEqual(channel, 1.0)

    def test_srgb_to_linear_is_monotonic_and_bounded(self):
        previous = -1.0
        for i in range(101):
            value = palette.srgb_to_linear(i / 100)
            self.assertGreater(value, previous)
            self.assertGreaterEqual(value, 0.0)
            self.assertLessEqual(value, 1.0)
            previous = value
        # Mid grey is the classic check: 0.5 sRGB is about 0.214 linear.
        self.assertAlmostEqual(palette.srgb_to_linear(0.5), 0.2140, places=3)


class TestCellUv(unittest.TestCase):
    """
    Blender measures V upward and glTF measures it downward, so cell 0 — the
    top-left of the sheet — sits at a *high* V here. Getting this backwards
    mirrors the palette vertically and every part comes out the colour from
    the opposite row.
    """

    def test_cell_zero_is_top_left(self):
        u, v = palette.cell_uv(0)
        self.assertAlmostEqual(u, 0.125)
        self.assertAlmostEqual(v, 0.875)

    def test_last_cell_is_bottom_right(self):
        u, v = palette.cell_uv(15)
        self.assertAlmostEqual(u, 0.875)
        self.assertAlmostEqual(v, 0.125)

    def test_every_cell_sits_at_a_centre(self):
        seen = set()
        for i in range(len(palette.PALETTE)):
            u, v = palette.cell_uv(i)
            # Centres land on odd eighths, never on a cell boundary.
            self.assertIn(round(u * 8), (1, 3, 5, 7))
            self.assertIn(round(v * 8), (1, 3, 5, 7))
            seen.add((round(u, 6), round(v, 6)))
        self.assertEqual(len(seen), len(palette.PALETTE), "two colours share a cell")

    def test_out_of_range_clamps_rather_than_wrapping(self):
        self.assertEqual(palette.cell_uv(-5), palette.cell_uv(0))
        self.assertEqual(palette.cell_uv(999), palette.cell_uv(15))

    def test_rows_advance_downward(self):
        # Row 0 is the top, so its V must be greater than row 3's.
        self.assertGreater(palette.cell_uv(0)[1], palette.cell_uv(12)[1])
        # And columns advance left to right.
        self.assertLess(palette.cell_uv(0)[0], palette.cell_uv(3)[0])


if __name__ == "__main__":
    unittest.main(verbosity=2)
