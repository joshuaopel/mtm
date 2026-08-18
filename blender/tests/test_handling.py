"""
Tests for the derived handling numbers.

These formulas exist twice — here in Python for the Blender panel, and in
`src/game/handling.ts` for the in-game overlay. The expected values below are
the ones the TypeScript produces for the stock trucks, so if the two
implementations drift apart this fails.

Run with:  python3 blender/tests/test_handling.py
"""

import importlib
import os
import sys
import types
import unittest

# `handling` needs no Blender API, but it is imported as a package submodule.
sys.modules["mathutils"] = types.ModuleType("mathutils")
_ADDON = os.path.join(os.path.dirname(__file__), "..", "mtm_tools")
_package = types.ModuleType("mtm_tools")
_package.__path__ = [_ADDON]
sys.modules["mtm_tools"] = _package

handling = importlib.import_module("mtm_tools.handling")


class Settings:
    """Stand-in for the Blender property group."""

    def __init__(self, **kwargs):
        # Boulder Hog, the baseline truck.
        self.mass = 1600
        self.suspension_stiffness = 20
        self.suspension_damping = 1.2
        self.suspension_compression = 2.3
        self.suspension_travel = 1.1
        self.suspension_rest = 1.0
        self.wheel_radius = 0.92
        self.axle_height = -0.35
        self.engine_force = 4200
        self.rear_z = -1.78
        for key, value in kwargs.items():
            setattr(self, key, value)


class TestHandlingNumbers(unittest.TestCase):
    def test_baseline_matches_the_typescript(self):
        h = handling.handling_numbers(Settings())
        self.assertAlmostEqual(h["ride_frequency"], 1.42, places=2)
        self.assertAlmostEqual(h["rebound_damping"], 0.27, places=2)
        self.assertAlmostEqual(h["compression_damping"], 0.51, places=2)
        self.assertAlmostEqual(h["ride_height"], 2.02, places=2)
        self.assertAlmostEqual(h["rest_compression"], 0.245, places=3)
        self.assertAlmostEqual(h["wheelie_margin"], 0.61, places=2)

    def test_resting_squat_is_independent_of_mass(self):
        # The mass cancels in the equilibrium equation, so a truck twice as
        # heavy on the same springs sits at exactly the same height.
        light = handling.handling_numbers(Settings(mass=1000))
        heavy = handling.handling_numbers(Settings(mass=3000))
        self.assertAlmostEqual(light["rest_compression"], heavy["rest_compression"], places=6)
        self.assertAlmostEqual(light["ride_height"], heavy["ride_height"], places=6)

    def test_damping_ratio_is_independent_of_mass(self):
        # Both stiffness and damping are per-unit-mass in cannon, so the
        # ratio between them does not move with the truck's weight.
        light = handling.handling_numbers(Settings(mass=1000))
        heavy = handling.handling_numbers(Settings(mass=3000))
        self.assertAlmostEqual(light["rebound_damping"], heavy["rebound_damping"], places=6)

    def test_stiffer_springs_raise_the_truck(self):
        soft = handling.handling_numbers(Settings(suspension_stiffness=12))
        stiff = handling.handling_numbers(Settings(suspension_stiffness=40))
        self.assertGreater(stiff["ride_height"], soft["ride_height"])
        self.assertGreater(stiff["ride_frequency"], soft["ride_frequency"])

    def test_bottoming_out_is_reported(self):
        # Springs far too soft for 2g: the squat is clamped to the available
        # travel and there is nothing left for bumps.
        h = handling.handling_numbers(Settings(suspension_stiffness=2))
        self.assertAlmostEqual(h["rest_compression"], 1.1, places=3)
        self.assertAlmostEqual(h["bump_headroom"], 0.0, places=3)

    def test_more_drive_moves_towards_a_wheelie(self):
        mild = handling.handling_numbers(Settings(engine_force=2000))
        wild = handling.handling_numbers(Settings(engine_force=9000))
        self.assertLess(mild["wheelie_margin"], wild["wheelie_margin"])
        self.assertGreater(wild["wheelie_margin"], 1.0)
        self.assertEqual(handling.wheelie_verdict(wild["wheelie_margin"]), "loops over")

    def test_a_taller_truck_wheelies_more_easily(self):
        # Same drive, higher centre of mass: less leverage holding the nose
        # down, so the lift threshold falls.
        low = handling.handling_numbers(Settings(wheel_radius=0.5))
        tall = handling.handling_numbers(Settings(wheel_radius=1.3))
        self.assertLess(tall["front_lift_threshold"], low["front_lift_threshold"])


class TestVerdicts(unittest.TestCase):
    def test_damping_bands(self):
        self.assertEqual(handling.damping_verdict(0.10), "pogo")
        self.assertEqual(handling.damping_verdict(0.16), "loose")
        self.assertEqual(handling.damping_verdict(0.27), "bouncy")
        self.assertEqual(handling.damping_verdict(0.47), "firm")
        self.assertEqual(handling.damping_verdict(0.85), "planted")
        self.assertEqual(handling.damping_verdict(1.4), "dead")

    def test_stock_trucks_are_all_bouncy_or_firm(self):
        # A regression guard on the roster: if a truck drifts into "pogo" or
        # "dead" it will feel wrong long before anyone reads the numbers.
        roster = [
            ("boulder-hog", 20, 1.2),
            ("mud-marshal", 28, 1.55),
            ("sky-ripper", 16, 1.0),
            ("iron-bull", 26, 1.35),
            ("dust-devil", 15, 1.0),
            ("nitro-hawk", 27, 1.7),
        ]
        for name, stiffness, damping in roster:
            with self.subTest(truck=name):
                h = handling.handling_numbers(
                    Settings(suspension_stiffness=stiffness, suspension_damping=damping)
                )
                verdict = handling.damping_verdict(h["rebound_damping"])
                self.assertIn(verdict, {"bouncy", "firm"}, f"{name} is '{verdict}'")


if __name__ == "__main__":
    unittest.main(verbosity=2)
