"""
Tests that run the add-on inside Blender.

The other suites test pure-Python helpers with `bpy` stubbed out, which is
fast and runs anywhere but cannot see the things that actually break: an
operator that raises, a panel that references a property that no longer
exists, a node group wired to a socket that moved. The bug that prompted this
file — every scaffolded track exporting a 100m terrain patch for a 700m course,
because an Empty has no bounding box — was invisible to every unit test and
obvious within one operator call here.

Blender is not a normal dependency, so this suite skips itself when `bpy` is
missing rather than failing:

    python3 -m venv .bpyenv && .bpyenv/bin/pip install bpy
    .bpyenv/bin/python blender/tests/test_blender.py

`bpy` on PyPI is tied to a Python version (4.x wants 3.11, 5.x wants 3.11+),
so the venv has to be built with one it supports.
"""

import math
import os
import sys
import tempfile
import unittest

try:
    import bpy  # noqa: F401
except ImportError:  # pragma: no cover - depends on the environment
    bpy = None

_BLENDER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _BLENDER_DIR not in sys.path:
    sys.path.insert(0, _BLENDER_DIR)


def setUpModule():
    if bpy is None:
        raise unittest.SkipTest("bpy is not installed; see this file's docstring")
    import mtm_tools

    try:
        mtm_tools.unregister()
    except Exception:
        pass
    mtm_tools.register()


class BlenderCase(unittest.TestCase):
    """Base class giving every test an empty scene with the add-on loaded."""

    def setUp(self):
        if bpy is None:
            self.skipTest("bpy is not installed")
        bpy.ops.wm.read_factory_settings(use_empty=True)
        self.settings = bpy.context.scene.mtm_track

    def road_curve(self, points, name="Road", closed=False):
        data = bpy.data.curves.new(name, "CURVE")
        data.dimensions = "3D"
        spline = data.splines.new("POLY")
        spline.points.add(len(points) - 1)
        for i, (x, y, z) in enumerate(points):
            spline.points[i].co = (x, y, z, 1.0)
        spline.use_cyclic_u = closed
        obj = bpy.data.objects.new(name, data)
        bpy.context.scene.collection.objects.link(obj)
        obj.mtm.role = "ROAD"
        return obj

    def grid(self, size, subdivisions, height=lambda x, y: 0.0):
        bpy.ops.mesh.primitive_grid_add(
            x_subdivisions=subdivisions, y_subdivisions=subdivisions, size=size
        )
        obj = bpy.context.object
        for vertex in obj.data.vertices:
            vertex.co.z = height(vertex.co.x, vertex.co.y)
        obj.data.update()
        obj.mtm.role = "TERRAIN"
        return obj

    def evaluated_z(self, obj):
        """Heights of the evaluated mesh, indexed to match the base mesh."""
        bpy.context.view_layer.update()
        evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
        mesh = evaluated.to_mesh()
        heights = [v.co.z for v in mesh.vertices]
        evaluated.to_mesh_clear()
        return heights


class TestRegistration(BlenderCase):
    def test_every_operator_the_panels_reference_exists(self):
        import re
        import pathlib

        ui = pathlib.Path(_BLENDER_DIR, "mtm_tools", "ui.py").read_text()
        referenced = set(re.findall(r'\.operator(?:_menu_enum)?\(\s*"mtm\.([a-z_]+)"', ui))
        self.assertGreater(len(referenced), 15)
        for name in sorted(referenced):
            self.assertTrue(hasattr(bpy.ops.mtm, name), f"panel calls missing operator {name}")

    def test_scene_properties_are_registered(self):
        self.assertTrue(hasattr(bpy.context.scene, "mtm_track"))
        self.assertTrue(hasattr(bpy.context.scene, "mtm_vehicle"))


class TestTerrainSize(BlenderCase):
    """
    An Empty reports an all-zero bounding box, so reading `bound_box` alone
    silently collapsed the terrain to the 100m floor while the course ran for
    hundreds of metres outside it.
    """

    def test_size_comes_from_an_empty_display_size(self):
        from mtm_tools.export_track import terrain_object_extent

        empty = bpy.data.objects.new("Bounds", None)
        empty.empty_display_type = "CUBE"
        empty.empty_display_size = 350.0
        bpy.context.scene.collection.objects.link(empty)

        self.assertEqual(empty.bound_box[0][0], 0.0)  # the trap
        self.assertAlmostEqual(terrain_object_extent(empty), 700.0, places=3)

    def test_empty_scale_is_applied(self):
        from mtm_tools.export_track import terrain_object_extent

        empty = bpy.data.objects.new("Bounds", None)
        empty.empty_display_size = 100.0
        empty.scale = (2.0, 2.0, 1.0)
        bpy.context.scene.collection.objects.link(empty)
        # `matrix_world` is composed by the depsgraph, so it still holds the
        # old scale until the view layer catches up. In Blender proper this
        # has always happened by the time anyone presses Export.
        bpy.context.view_layer.update()

        self.assertAlmostEqual(terrain_object_extent(empty), 400.0, places=3)

    def test_size_comes_from_mesh_bounds_when_the_terrain_is_a_mesh(self):
        from mtm_tools.export_track import terrain_object_extent

        terrain = self.grid(600.0, 4)
        self.assertAlmostEqual(terrain_object_extent(terrain), 600.0, places=3)

    def test_a_scaffolded_track_covers_its_own_course(self):
        bpy.ops.mtm.new_track(radius=220, points=12, preview=False)
        from mtm_tools.export_track import build_road, terrain_size

        problems = []
        road = build_road(bpy.context.scene, bpy.context.evaluated_depsgraph_get(), problems)
        size = terrain_size(bpy.context.scene, road)

        reach = max(max(abs(p["pos"][0]), abs(p["pos"][2])) for p in road["points"])
        self.assertGreater(size / 2, reach, "terrain patch is smaller than the road it holds")


class TestRoadCarve(BlenderCase):
    WIDTH = 18.0
    SHOULDER = 12.0
    ROAD_Z = 3.0

    def setup_carve(self):
        from mtm_tools import carve

        terrain = self.grid(400.0, 60, lambda x, y: 12 * math.sin(x / 60) + 6 * math.cos(y / 45))
        road = self.road_curve([(-200 + i * 20, 0.0, self.ROAD_Z) for i in range(21)])
        self.sculpt = [v.co.z for v in terrain.data.vertices]
        self.lateral = [abs(v.co.y) for v in terrain.data.vertices]
        carve.apply_carve(terrain, road, self.WIDTH, self.SHOULDER)
        return terrain, road

    def test_the_sculpt_itself_is_never_edited(self):
        terrain, _ = self.setup_carve()
        self.evaluated_z(terrain)
        for vertex, original in zip(terrain.data.vertices, self.sculpt):
            self.assertAlmostEqual(vertex.co.z, original, places=9)

    def test_ground_under_the_road_sits_at_road_height(self):
        terrain, _ = self.setup_carve()
        heights = self.evaluated_z(terrain)
        on_road = [z for z, lat in zip(heights, self.lateral) if lat < self.WIDTH / 2 - 1]
        self.assertGreater(len(on_road), 20)
        for z in on_road:
            self.assertAlmostEqual(z, self.ROAD_Z, places=4)

    def test_the_shoulder_blends_rather_than_stepping(self):
        terrain, _ = self.setup_carve()
        heights = self.evaluated_z(terrain)
        inner, outer = self.WIDTH / 2, self.WIDTH / 2 + self.SHOULDER
        band = [
            (z, sculpt)
            for z, sculpt, lat in zip(heights, self.sculpt, self.lateral)
            if inner + 2 < lat < outer - 2
        ]
        self.assertGreater(len(band), 10)
        for z, sculpt in band:
            self.assertGreaterEqual(z, min(self.ROAD_Z, sculpt) - 0.01)
            self.assertLessEqual(z, max(self.ROAD_Z, sculpt) + 0.01)

    def test_ground_beyond_the_shoulder_is_untouched(self):
        terrain, _ = self.setup_carve()
        heights = self.evaluated_z(terrain)
        far = [
            abs(z - sculpt)
            for z, sculpt, lat in zip(heights, self.sculpt, self.lateral)
            if lat > self.WIDTH / 2 + self.SHOULDER + 10
        ]
        self.assertGreater(len(far), 100)
        self.assertLess(max(far), 1e-6)

    def test_the_carve_follows_the_curve(self):
        terrain, road = self.setup_carve()
        self.evaluated_z(terrain)

        for point in road.data.splines[0].points:
            point.co = (point.co.x, 60.0, 9.0, 1.0)
        heights = self.evaluated_z(terrain)

        moved = [z for z, v in zip(heights, terrain.data.vertices) if abs(v.co.y - 60) < 5]
        released = [
            (z, sculpt)
            for z, sculpt, lat in zip(heights, self.sculpt, self.lateral)
            if lat < 5
        ]
        self.assertGreater(len(moved), 5)
        for z in moved:
            self.assertAlmostEqual(z, 9.0, places=3)
        for z, sculpt in released:
            self.assertAlmostEqual(z, sculpt, places=3)

    def test_removing_the_carve_restores_the_sculpt(self):
        from mtm_tools import carve

        terrain, _ = self.setup_carve()
        self.assertTrue(carve.remove_carve(terrain))
        for z, original in zip(self.evaluated_z(terrain), self.sculpt):
            self.assertAlmostEqual(z, original, places=9)


class TestPaintBake(BlenderCase):
    def test_painted_colours_land_on_the_matching_half_of_the_grid(self):
        from mtm_tools import paint
        from mtm_tools.heightmap import bake_surface

        terrain = self.grid(400.0, 40)
        layer = paint.ensure_attribute(terrain.data)
        for i, vertex in enumerate(terrain.data.vertices):
            if vertex.co.x > 0:
                layer.data[i].color = (1.0, 0.0, 0.0, 1.0)

        problems = []
        segments = 32
        heights, packed = bake_surface(
            terrain, bpy.context.evaluated_depsgraph_get(), 400.0, segments, problems, True
        )
        self.assertEqual(problems, [])
        self.assertIsNotNone(packed)
        self.assertEqual(len(packed), (segments + 1) ** 2 * 3)

        # Sample well clear of the boundary so interpolation is not the answer.
        row = segments + 1
        west = packed[(16 * row + 4) * 3]
        east = packed[(16 * row + 28) * 3]
        self.assertLess(west, 20)
        self.assertGreater(east, 235)

    def test_unpainted_terrain_bakes_no_weights(self):
        from mtm_tools import paint
        from mtm_tools.heightmap import bake_surface

        terrain = self.grid(400.0, 20)
        paint.ensure_attribute(terrain.data)
        _, packed = bake_surface(
            terrain, bpy.context.evaluated_depsgraph_get(), 400.0, 16, [], True
        )
        self.assertIsNone(packed, "an all-black paint layer should not be shipped")

    def test_paint_is_skipped_entirely_when_not_asked_for(self):
        from mtm_tools import paint
        from mtm_tools.heightmap import bake_surface

        terrain = self.grid(400.0, 20)
        layer = paint.ensure_attribute(terrain.data)
        for entry in layer.data:
            entry.color = (1.0, 0.0, 0.0, 1.0)
        heights, packed = bake_surface(
            terrain, bpy.context.evaluated_depsgraph_get(), 400.0, 16, [], False
        )
        self.assertIsNotNone(heights)
        self.assertIsNone(packed)


class TestFullExport(BlenderCase):
    def export(self):
        import json

        path = os.path.join(tempfile.mkdtemp(), "t.mtmtrack.json")
        self.settings.export_path = path
        bpy.context.view_layer.update()
        result = bpy.ops.mtm.export_track()
        self.assertEqual(result, {"FINISHED"})
        with open(path) as handle:
            return json.load(handle)

    def test_generated_terrain_track_round_trips(self):
        bpy.ops.mtm.new_track(radius=200, points=10, preview=False)
        self.settings.track_id = "t"
        self.settings.track_name = "T"
        track = self.export()

        self.assertEqual(track["format"], "mtm-track")
        self.assertGreater(track["terrain"]["size"], 400)
        self.assertNotIn("heightmap", track["terrain"])
        self.assertGreater(len(track["road"]["points"]), 20)

    def test_course_limits_are_exported(self):
        bpy.ops.mtm.new_track(radius=200, points=10, preview=False)
        self.settings.bounds_margin = 17.5
        self.settings.bounds_seconds = 8.0
        track = self.export()

        self.assertAlmostEqual(track["bounds"]["margin"], 17.5, places=3)
        self.assertAlmostEqual(track["bounds"]["seconds"], 8.0, places=2)

    def test_sculpted_and_painted_track_carries_heights_and_weights(self):
        from mtm_tools import paint

        bpy.ops.mtm.new_track(radius=200, points=10, preview=False)
        self.settings.track_id = "t"
        self.settings.track_name = "T"
        bpy.ops.mtm.new_sculpted_terrain(resolution=48, carve_road=True)

        terrain = bpy.data.objects["MTM_Terrain"]
        self.assertIn("MTM Road Carve", [m.name for m in terrain.modifiers])
        self.assertEqual(self.settings.terrain_source, "sculpted")

        for vertex in terrain.data.vertices:
            vertex.co.z = 10 * math.sin(vertex.co.x / 90)
        terrain.data.update()

        layer = paint.ensure_attribute(terrain.data)
        for i, vertex in enumerate(terrain.data.vertices):
            if vertex.co.x > 0:
                layer.data[i].color = (1.0, 0.0, 0.0, 1.0)

        self.settings.paint_mode = "custom"
        self.settings.paint_base = "grass"
        self.settings.paint_layer1 = "rock"
        self.settings.heightmap_segments = 64

        track = self.export()
        heightmap = track["terrain"]["heightmap"]
        self.assertEqual(heightmap["segments"], 64)
        self.assertTrue(heightmap["data"])

        paint_block = track["environment"]["artwork"]["paint"]
        self.assertEqual([l["texture"] for l in paint_block["layers"]], ["grass", "rock"])
        self.assertEqual(paint_block["weights"]["segments"], 64)
        self.assertTrue(paint_block["weights"]["data"])

    def test_automatic_ground_writes_no_paint_block(self):
        bpy.ops.mtm.new_track(radius=200, points=10, preview=False)
        self.settings.track_id = "t"
        self.settings.track_name = "T"
        self.settings.paint_mode = "auto"
        track = self.export()
        self.assertNotIn("paint", track["environment"].get("artwork", {}))

    def test_ramp_and_billboard_props_carry_their_dimensions(self):
        bpy.ops.mtm.new_track(radius=200, points=10, preview=False)
        self.settings.track_id = "t"
        self.settings.track_name = "T"

        ramp = bpy.data.objects.new("Ramp", None)
        bpy.context.scene.collection.objects.link(ramp)
        ramp.mtm.role = "PROP"
        ramp.mtm.prop_kind = "ramp"
        ramp.mtm.prop_size = (16.0, 3.0, 14.0)

        board = bpy.data.objects.new("Board", None)
        bpy.context.scene.collection.objects.link(board)
        board.mtm.role = "PROP"
        board.mtm.prop_kind = "billboard"
        board.mtm.prop_texture = "  sponsor.png  "

        tree = bpy.data.objects.new("Tree", None)
        bpy.context.scene.collection.objects.link(tree)
        tree.mtm.role = "PROP"
        tree.mtm.prop_kind = "palm"

        track = self.export()
        by_kind = {p["kind"]: p for p in track["props"]}

        self.assertEqual(by_kind["ramp"]["size"], [16.0, 3.0, 14.0])
        self.assertEqual(by_kind["billboard"]["texture"], "sponsor.png")
        # A tree has no meaningful width/height/length, so it should not carry
        # the sized-prop defaults into the file.
        self.assertNotIn("size", by_kind["palm"])
        self.assertNotIn("texture", by_kind["palm"])

    def test_a_blank_layer_slot_ends_the_list(self):
        from mtm_tools.export_track import build_paint

        self.settings.paint_mode = "custom"
        self.settings.paint_base = "dirt"
        self.settings.paint_layer1 = "rock"
        self.settings.paint_layer2 = ""
        self.settings.paint_layer3 = "snow"
        paint_block = build_paint(bpy.context.scene, None, 64)
        self.assertEqual([l["texture"] for l in paint_block["layers"]], ["dirt", "rock"])


class TestColourPalette(BlenderCase):
    def cube(self, name="Cube"):
        bpy.ops.mesh.primitive_cube_add(size=1)
        obj = bpy.context.object
        obj.name = name
        return obj

    def select_only(self, obj):
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj

    def test_applying_the_palette_gives_one_material_and_a_uv_layer(self):
        from mtm_tools import palette

        obj = self.cube()
        self.select_only(obj)
        self.assertEqual(bpy.ops.mtm.apply_palette(), {"FINISHED"})

        self.assertEqual(len(obj.data.materials), 1)
        self.assertEqual(obj.data.materials[0].name, palette.MATERIAL_NAME)
        self.assertGreater(len(obj.data.uv_layers), 0)

    def test_the_atlas_image_is_square_and_packed(self):
        from mtm_tools import palette

        palette.build_material()
        image = bpy.data.images[palette.IMAGE_NAME]
        self.assertEqual(tuple(image.size), (palette.COLUMNS * 16, palette.COLUMNS * 16))
        self.assertTrue(image.packed_file, "the atlas must travel inside the .blend")

    def test_the_image_holds_the_palette_colour_in_every_cell(self):
        from mtm_tools import palette

        palette.build_material()
        image = bpy.data.images[palette.IMAGE_NAME]
        size = image.size[0]
        pixels = list(image.pixels)

        def linear_to_srgb(c):
            return 12.92 * c if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055

        for index, (name, hexcode) in enumerate(palette.PALETTE):
            with self.subTest(colour=name):
                u, v = palette.cell_uv(index)
                offset = (int(v * size) * size + int(u * size)) * 4
                got = tuple(round(linear_to_srgb(pixels[offset + k]) * 255) for k in range(3))
                want = tuple(round(c * 255) for c in palette.hex_to_rgb(hexcode))
                for a, b in zip(got, want):
                    self.assertLessEqual(abs(a - b), 2)

    def test_painting_moves_every_uv_onto_the_chosen_cell(self):
        from mtm_tools import palette

        obj = self.cube()
        self.select_only(obj)
        bpy.ops.mtm.apply_palette()

        for index in (0, 5, 15):
            with self.subTest(cell=index):
                self.assertEqual(bpy.ops.mtm.paint_palette(index=index), {"FINISHED"})
                expected = palette.cell_uv(index)
                for loop in obj.data.uv_layers.active.data:
                    self.assertAlmostEqual(loop.uv[0], expected[0], places=6)
                    self.assertAlmostEqual(loop.uv[1], expected[1], places=6)

    def test_painting_without_the_material_refuses_rather_than_silently_working(self):
        obj = self.cube()
        self.select_only(obj)
        self.assertEqual(bpy.ops.mtm.paint_palette(index=3), {"CANCELLED"})

    def test_two_objects_share_one_material(self):
        from mtm_tools import palette

        a, b = self.cube("A"), self.cube("B")
        bpy.ops.object.select_all(action="DESELECT")
        a.select_set(True)
        b.select_set(True)
        bpy.context.view_layer.objects.active = b
        bpy.ops.mtm.apply_palette()

        self.assertIs(a.data.materials[0], b.data.materials[0])
        self.assertEqual(
            len([m for m in bpy.data.materials if m.name.startswith(palette.MATERIAL_NAME)]), 1
        )


class TestPreview(BlenderCase):
    def test_preview_builds_terrain_and_road_meshes(self):
        bpy.ops.mtm.new_track(radius=200, points=10, preview=False)
        self.assertEqual(bpy.ops.mtm.build_preview(resolution=48), {"FINISHED"})

        collection = bpy.data.collections.get("MTM_Preview")
        self.assertIsNotNone(collection)
        names = {o.name for o in collection.objects}
        self.assertEqual(names, {"MTM_Preview_Terrain", "MTM_Preview_Road"})
        for obj in collection.objects:
            self.assertGreater(len(obj.data.polygons), 10)
            self.assertEqual(obj.mtm.role, "NONE", "preview must not be exported")

    def test_preview_terrain_has_relief(self):
        bpy.ops.mtm.new_track(radius=200, points=10, preview=False)
        bpy.ops.mtm.build_preview(resolution=48)
        terrain = bpy.data.objects["MTM_Preview_Terrain"]
        heights = [v.co.z for v in terrain.data.vertices]
        self.assertGreater(max(heights) - min(heights), 5.0)

    def test_sculpted_mode_previews_the_road_only(self):
        bpy.ops.mtm.new_track(radius=200, points=10, preview=False)
        self.settings.terrain_source = "sculpted"
        bpy.ops.mtm.build_preview(resolution=48)
        names = {o.name for o in bpy.data.collections["MTM_Preview"].objects}
        self.assertEqual(names, {"MTM_Preview_Road"})

    def test_clearing_removes_everything(self):
        bpy.ops.mtm.new_track(radius=200, points=10, preview=False)
        bpy.ops.mtm.build_preview(resolution=48)
        bpy.ops.mtm.clear_preview()
        self.assertIsNone(bpy.data.collections.get("MTM_Preview"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
