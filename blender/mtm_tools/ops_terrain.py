# SPDX-License-Identifier: MIT
"""
Sculpted terrain operators: making one, carving the road into it, painting it.

The generated-terrain path needs none of this — you place feature empties and
the game builds the ground. These are for when you want to model the landscape
by hand instead.
"""

import bpy
from bpy.props import BoolProperty, FloatProperty, IntProperty, StringProperty
from bpy.types import Operator

from . import carve, paint
from .export_track import collect, curve_points, terrain_size
from .convert import convert_position, resample_polyline

TERRAIN_NAME = "MTM_Terrain"


def _road_object(context):
    roads = collect(context.scene, "ROAD")
    return roads[0] if roads else None


def _course_size(context):
    """Terrain extent for the current course, without running a full export."""
    road = _road_object(context)
    if road is None or road.type != "CURVE":
        return context.scene.mtm_track.terrain_size

    points = curve_points(context.evaluated_depsgraph_get(), road)
    if len(points) < 3:
        return context.scene.mtm_track.terrain_size

    sampled = resample_polyline(points, context.scene.mtm_track.road_spacing)
    fake = {"points": [{"pos": convert_position(p)} for p in sampled]}
    return terrain_size(context.scene, fake)


class MTM_OT_new_sculpted_terrain(Operator):
    """Create a terrain grid sized to the course, ready to sculpt"""

    bl_idname = "mtm.new_sculpted_terrain"
    bl_label = "New Sculpted Terrain"
    bl_options = {"REGISTER", "UNDO"}

    resolution: IntProperty(
        name="Grid Resolution",
        default=192,
        min=32,
        max=512,
        description="Vertices per side. This is what you sculpt; the exported "
        "heightfield is resampled from it and can be a different size",
    )
    carve_road: BoolProperty(
        name="Carve The Road In",
        default=True,
        description="Add the live road carve modifier so the road flattens "
        "itself into the terrain as you move the spline",
    )
    replace: BoolProperty(name="Replace Existing", default=True)

    def execute(self, context):
        scene = context.scene
        size = _course_size(context)

        if self.replace:
            for obj in collect(scene, "TERRAIN"):
                bpy.data.objects.remove(obj, do_unlink=True)

        bpy.ops.mesh.primitive_grid_add(
            x_subdivisions=int(self.resolution),
            y_subdivisions=int(self.resolution),
            size=size,
            location=(0.0, 0.0, 0.0),
        )
        terrain = context.object
        terrain.name = TERRAIN_NAME
        terrain.data.name = TERRAIN_NAME
        terrain.mtm.role = "TERRAIN"

        # A sculpted mesh is the ground, so say so — otherwise the exporter
        # would keep generating noise and ignore everything just modelled.
        scene.mtm_track.terrain_source = "sculpted"

        road = _road_object(context)
        if self.carve_road and road is not None:
            carve.apply_carve(
                terrain,
                road,
                scene.mtm_track.road_width,
                scene.mtm_track.road_shoulder,
            )

        self.report(
            {"INFO"},
            f"Created a {size:.0f}m terrain at {self.resolution}x{self.resolution}. "
            "Sculpt it, then export."
            + ("" if road is not None else " No road spline found, so nothing was carved."),
        )
        return {"FINISHED"}


class MTM_OT_add_road_carve(Operator):
    """Flatten the terrain under the road, updating as you move the spline"""

    bl_idname = "mtm.add_road_carve"
    bl_label = "Add / Update Road Carve"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        scene = context.scene
        road = _road_object(context)
        if road is None:
            self.report({"ERROR"}, "No object has the 'Road Spline' role.")
            return {"CANCELLED"}
        if road.type != "CURVE":
            self.report({"ERROR"}, f"'{road.name}' is marked as the road but is not a curve.")
            return {"CANCELLED"}

        targets = [o for o in collect(scene, "TERRAIN") if o.type == "MESH"]
        if not targets:
            self.report(
                {"ERROR"},
                "No mesh has the Terrain role. Use 'New Sculpted Terrain', or "
                "tag your own mesh.",
            )
            return {"CANCELLED"}

        for terrain in targets:
            carve.apply_carve(
                terrain,
                road,
                scene.mtm_track.road_width,
                scene.mtm_track.road_shoulder,
            )

        self.report(
            {"INFO"},
            f"Road carve on {len(targets)} terrain mesh(es): {scene.mtm_track.road_width:.0f}m "
            f"wide, blending out over {scene.mtm_track.road_shoulder:.0f}m. "
            "The sculpt itself is untouched.",
        )
        return {"FINISHED"}


class MTM_OT_remove_road_carve(Operator):
    """Remove the road carve modifier, leaving the sculpt as modelled"""

    bl_idname = "mtm.remove_road_carve"
    bl_label = "Remove Road Carve"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        removed = sum(1 for o in collect(context.scene, "TERRAIN") if carve.remove_carve(o))
        self.report({"INFO"}, f"Removed the carve from {removed} object(s).")
        return {"FINISHED"}


class MTM_OT_terrain_paint(Operator):
    """Set up the paint attribute and switch to Vertex Paint"""

    bl_idname = "mtm.terrain_paint"
    bl_label = "Paint Terrain"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        targets = [o for o in collect(context.scene, "TERRAIN") if o.type == "MESH"]
        if not targets:
            self.report({"ERROR"}, "No mesh has the Terrain role.")
            return {"CANCELLED"}

        terrain = targets[0]
        paint.ensure_attribute(terrain.data)

        for obj in context.selected_objects:
            obj.select_set(False)
        terrain.select_set(True)
        context.view_layer.objects.active = terrain

        if context.object.mode != "VERTEX_PAINT":
            bpy.ops.object.mode_set(mode="VERTEX_PAINT")

        self.report(
            {"INFO"},
            "Painting '" + terrain.name + "'. Red, green and blue each pick a "
            "layer; black is the base.",
        )
        return {"FINISHED"}


class MTM_OT_set_paint_layer(Operator):
    """Set the brush to the colour that selects this layer"""

    bl_idname = "mtm.set_paint_layer"
    bl_label = "Set Paint Layer"
    bl_options = {"REGISTER", "UNDO"}

    layer: IntProperty(name="Layer", default=0, min=0, max=3)

    def execute(self, context):
        name, colour, _ = paint.LAYER_COLOURS[self.layer]
        settings = context.tool_settings.vertex_paint
        brush = settings.brush if settings else None
        if brush is None:
            self.report({"ERROR"}, "No vertex paint brush; enter Vertex Paint mode first.")
            return {"CANCELLED"}

        brush.color = colour[:3]
        # Painting a channel to zero is how you erase back to the base layer,
        # and a brush left on Mix at partial strength will not get there.
        brush.blend = "MIX"
        if hasattr(brush, "strength"):
            brush.strength = 1.0

        self.report({"INFO"}, f"Brush set to {name}.")
        return {"FINISHED"}


class MTM_OT_clear_terrain_paint(Operator):
    """Reset the terrain to the base layer everywhere"""

    bl_idname = "mtm.clear_terrain_paint"
    bl_label = "Clear Painting"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        cleared = 0
        for obj in collect(context.scene, "TERRAIN"):
            if obj.type != "MESH":
                continue
            layer = paint.find_attribute(obj.data)
            if layer is None:
                continue
            for entry in layer.data:
                entry.color = (0.0, 0.0, 0.0, 1.0)
            cleared += 1
        self.report({"INFO"}, f"Cleared painting on {cleared} object(s).")
        return {"FINISHED"}


_CLASSES = (
    MTM_OT_new_sculpted_terrain,
    MTM_OT_add_road_carve,
    MTM_OT_remove_road_carve,
    MTM_OT_terrain_paint,
    MTM_OT_set_paint_layer,
    MTM_OT_clear_terrain_paint,
)


def register():
    for cls in _CLASSES:
        bpy.utils.register_class(cls)


def unregister():
    for cls in reversed(_CLASSES):
        bpy.utils.unregister_class(cls)
