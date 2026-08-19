# SPDX-License-Identifier: MIT
"""
Sidebar panels (View3D > N > MTM).

Split into a Track tab and a Vehicle tab, each ordered the way you actually
work: create, shape, populate, validate, export.
"""

import bpy
from bpy.types import Panel

from .handling import damping_verdict, handling_numbers, wheelie_verdict
from .paint import LAYER_COLOURS
from .props import SIZED_PROP_KINDS, TEXTURED_PROP_KINDS


class MTMPanel:
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "MTM"


class MTM_PT_track(MTMPanel, Panel):
    bl_label = "Track"
    bl_idname = "MTM_PT_track"

    def draw(self, context):
        layout = self.layout
        settings = context.scene.mtm_track

        column = layout.column(align=True)
        column.operator("mtm.new_track", icon="CURVE_BEZCIRCLE")

        box = layout.box()
        box.label(text="Identity", icon="INFO")
        box.prop(settings, "track_id")
        box.prop(settings, "track_name")
        box.prop(settings, "blurb")
        box.prop(settings, "author")
        row = box.row(align=True)
        row.prop(settings, "difficulty")
        row.prop(settings, "laps")


class MTM_PT_track_road(MTMPanel, Panel):
    bl_label = "Road & Terrain"
    bl_idname = "MTM_PT_track_road"
    bl_parent_id = "MTM_PT_track"

    def draw(self, context):
        layout = self.layout
        settings = context.scene.mtm_track

        box = layout.box()
        box.label(text="Road", icon="CURVE_PATH")
        box.prop(settings, "road_width")
        box.prop(settings, "road_shoulder")
        box.prop(settings, "road_spacing")
        box.prop(settings, "road_closed")

        box = layout.box()
        box.label(text="Terrain", icon="MESH_GRID")
        box.prop(settings, "terrain_source", expand=True)

        if settings.terrain_source == "procedural":
            box.label(text="Generated at runtime — nothing to model.", icon="INFO")
            box.label(text="Shape it with Terrain Feature empties.")
            column = box.column(align=True)
            column.prop(settings, "terrain_amplitude")
            column.prop(settings, "terrain_frequency")
            column.prop(settings, "terrain_seed")
        else:
            column = box.column(align=True)
            column.scale_y = 1.2
            column.operator("mtm.new_sculpted_terrain", icon="MESH_GRID")
            box.label(text="Heightfield: no overhangs or caves.", icon="ERROR")
            column = box.column(align=True)
            column.prop(settings, "heightmap_segments")
            column.prop(settings, "heightmap_flatten_road")

            row = box.row(align=True)
            row.operator("mtm.add_road_carve", icon="MOD_SHRINKWRAP")
            row.operator("mtm.remove_road_carve", text="", icon="X")
            box.label(text="The carve follows the spline as you move it", icon="INFO")

        box.prop(settings, "terrain_segments")
        box.label(text="Size follows the Terrain object's bounds", icon="INFO")


class MTM_PT_track_paint(MTMPanel, Panel):
    bl_label = "Ground Textures"
    bl_idname = "MTM_PT_track_paint"
    bl_parent_id = "MTM_PT_track"
    bl_options = {"DEFAULT_CLOSED"}

    def draw(self, context):
        layout = self.layout
        settings = context.scene.mtm_track

        layout.prop(settings, "paint_mode", expand=True)

        if settings.paint_mode == "auto":
            layout.label(text="Rock on steep ground, worn verge by the road.", icon="INFO")
            layout.label(text="Chosen from the Surface theme.")
            return

        box = layout.box()
        box.label(text="Layers", icon="TEXTURE")
        for prop, scale in (
            ("paint_base", "paint_base_scale"),
            ("paint_layer1", "paint_layer1_scale"),
            ("paint_layer2", "paint_layer2_scale"),
            ("paint_layer3", "paint_layer3_scale"),
        ):
            row = box.row(align=True)
            row.prop(settings, prop, text="")
            row.prop(settings, scale, text="")
        box.label(text="Blank stops the list. Name or image path.", icon="INFO")

        box = layout.box()
        box.label(text="Automatic Blending", icon="MOD_NOISE")
        box.prop(settings, "paint_slope_rule")
        if settings.paint_slope_rule:
            row = box.row(align=True)
            row.prop(settings, "paint_slope_from")
            row.prop(settings, "paint_slope_to")
        box.prop(settings, "paint_verge_rule")
        if settings.paint_verge_rule:
            box.prop(settings, "paint_verge_distance")

        box = layout.box()
        box.label(text="Painting", icon="BRUSH_DATA")
        if context.scene.mtm_track.terrain_source != "sculpted":
            box.label(text="Painting needs a sculpted terrain mesh.", icon="ERROR")
            return

        box.operator("mtm.terrain_paint", icon="VPAINT_HLT")
        row = box.row(align=True)
        for index, (name, _, _) in enumerate(LAYER_COLOURS):
            row.operator("mtm.set_paint_layer", text=name).layer = index
        box.operator("mtm.clear_terrain_paint", icon="TRASH")


class MTM_PT_track_preview(MTMPanel, Panel):
    bl_label = "Course Preview"
    bl_idname = "MTM_PT_track_preview"
    bl_parent_id = "MTM_PT_track"

    def draw(self, context):
        layout = self.layout

        layout.label(text="Build the ground and road you will drive on", icon="INFO")
        column = layout.column(align=True)
        column.scale_y = 1.3
        column.operator("mtm.build_preview", icon="MESH_GRID")
        column.operator("mtm.clear_preview", icon="TRASH")

        layout.separator()
        layout.operator("mtm.drop_to_terrain", icon="TRIA_DOWN_BAR")
        layout.label(text="Preview meshes are never exported", icon="CHECKMARK")


class MTM_PT_track_environment(MTMPanel, Panel):
    bl_label = "Environment"
    bl_idname = "MTM_PT_track_environment"
    bl_parent_id = "MTM_PT_track"
    bl_options = {"DEFAULT_CLOSED"}

    def draw(self, context):
        layout = self.layout
        settings = context.scene.mtm_track

        layout.prop(settings, "surface")
        layout.prop(settings, "sky_zenith")
        layout.prop(settings, "sky_horizon")
        layout.prop(settings, "fog_color")
        layout.prop(settings, "fog_density")
        layout.prop(settings, "sun_color")
        layout.prop(settings, "ambient_color")
        layout.label(text="Sun direction is read from the scene's sun lamp", icon="LIGHT_SUN")


class MTM_PT_track_build(MTMPanel, Panel):
    bl_label = "Build Tools"
    bl_idname = "MTM_PT_track_build"
    bl_parent_id = "MTM_PT_track"

    def draw(self, context):
        layout = self.layout
        settings = context.scene.mtm_track

        column = layout.column(align=True)
        column.operator("mtm.build_start_grid", icon="EMPTY_ARROWS")
        column.operator("mtm.place_checkpoints", icon="MESH_PLANE")
        column.operator("mtm.scatter_props", icon="OUTLINER_OB_POINTCLOUD")

        box = layout.box()
        box.label(text="Blocker Walls", icon="MESH_CUBE")
        box.prop(settings, "barriers_enabled")
        sub = box.column(align=True)
        sub.enabled = settings.barriers_enabled
        sub.prop(settings, "barrier_spacing")
        sub.prop(settings, "barrier_height")
        sub.prop(settings, "barrier_thickness")
        sub.prop(settings, "barrier_offset")
        sub.prop(settings, "barrier_material")
        sub.prop(settings, "barrier_invisible")
        box.label(text="Or bake them as real objects:", icon="INFO")
        box.operator("mtm.generate_barriers", icon="MOD_ARRAY")


class MTM_PT_track_collision(MTMPanel, Panel):
    bl_label = "Collision & Scenery"
    bl_idname = "MTM_PT_track_collision"
    bl_parent_id = "MTM_PT_track"

    def draw(self, context):
        layout = self.layout

        box = layout.box()
        box.label(text="Colliders", icon="MESH_ICOSPHERE")
        box.operator_menu_enum("mtm.collider_from_selection", "shape", text="Collider From Selection")
        box.operator("mtm.check_colliders", icon="CHECKMARK")
        box.label(text="Convex or box only — see the manual", icon="INFO")

        box = layout.box()
        box.label(text="Scenery", icon="OUTLINER_OB_MESH")
        box.label(text="Tag meshes as Scenery to export them")
        box.label(text="into the track's .glb", icon="BLANK1")

        box = layout.box()
        box.label(text="Viewport", icon="RESTRICT_VIEW_OFF")
        box.operator("mtm.colour_by_role", icon="COLOR")
        box.operator("mtm.select_untagged", icon="SELECT_SET")


class MTM_PT_object(MTMPanel, Panel):
    bl_label = "Selected Object"
    bl_idname = "MTM_PT_object"

    @classmethod
    def poll(cls, context):
        return context.active_object is not None

    def draw(self, context):
        layout = self.layout
        obj = context.active_object
        mtm = obj.mtm

        layout.prop(mtm, "role")

        if mtm.role == "WALL":
            box = layout.box()
            box.prop(mtm, "wall_material")
            box.prop(mtm, "wall_invisible")
        elif mtm.role == "PROP":
            box = layout.box()
            box.prop(mtm, "prop_kind")
            if mtm.prop_kind in SIZED_PROP_KINDS:
                box.prop(mtm, "prop_size")
            if mtm.prop_kind in TEXTURED_PROP_KINDS:
                box.prop(mtm, "prop_texture")
            if mtm.prop_kind in ("ramp", "tabletop"):
                box.label(text="Always solid. Faces -Y in Blender.", icon="INFO")
            else:
                box.prop(mtm, "prop_solid")
        elif mtm.role == "CHECKPOINT":
            box = layout.box()
            box.prop(mtm, "checkpoint_order")
            box.prop(mtm, "checkpoint_width")
        elif mtm.role == "COLLIDER":
            box = layout.box()
            box.prop(mtm, "collider_shape")
            if mtm.collider_shape == "convex":
                box.label(text="Mesh must be convex", icon="ERROR")
        elif mtm.role == "SCENERY":
            layout.box().label(text="Exported into the track .glb", icon="INFO")
        elif mtm.role == "SPAWN":
            layout.box().prop(mtm, "spawn_order")
        elif mtm.role == "FEATURE":
            box = layout.box()
            box.prop(mtm, "feature_kind")
            box.prop(mtm, "feature_height")
            if mtm.feature_kind == "plateau":
                box.prop(mtm, "feature_falloff")
            box.label(text="Radius = object X scale x 10", icon="INFO")

        layout.separator()
        row = layout.row(align=True)
        row.operator_menu_enum("mtm.tag_objects", "role", text="Tag Selected")
        row.operator_menu_enum("mtm.select_role", "role", text="Select By Role")


class MTM_PT_track_export(MTMPanel, Panel):
    bl_label = "Export Track"
    bl_idname = "MTM_PT_track_export"

    def draw(self, context):
        layout = self.layout
        settings = context.scene.mtm_track

        layout.prop(settings, "export_path")
        row = layout.row(align=True)
        row.operator("mtm.validate_track", icon="CHECKMARK")
        row.operator("mtm.export_track", icon="EXPORT")


class MTM_PT_vehicle(MTMPanel, Panel):
    bl_label = "Vehicle"
    bl_idname = "MTM_PT_vehicle"
    bl_options = {"DEFAULT_CLOSED"}

    def draw(self, context):
        layout = self.layout
        settings = context.scene.mtm_vehicle

        layout.prop(settings, "vehicle_id")
        layout.prop(settings, "vehicle_name")
        layout.prop(settings, "vehicle_class")
        layout.prop(settings, "blurb")

        row = layout.row(align=True)
        op = row.operator("mtm.load_vehicle_preset", text="Light Preset")
        op.heavy = False
        op = row.operator("mtm.load_vehicle_preset", text="Heavy Preset")
        op.heavy = True


class MTM_PT_vehicle_stats(MTMPanel, Panel):
    bl_label = "Display Stats"
    bl_idname = "MTM_PT_vehicle_stats"
    bl_parent_id = "MTM_PT_vehicle"

    def draw(self, context):
        layout = self.layout
        settings = context.scene.mtm_vehicle
        column = layout.column(align=True)
        for name in ("speed", "accel", "grip", "weight", "suspension", "toughness"):
            column.prop(settings, f"stat_{name}")
        layout.label(text="Bars are cosmetic — keep them honest", icon="INFO")


class MTM_PT_vehicle_physics(MTMPanel, Panel):
    bl_label = "Physics"
    bl_idname = "MTM_PT_vehicle_physics"
    bl_parent_id = "MTM_PT_vehicle"

    def draw(self, context):
        layout = self.layout
        settings = context.scene.mtm_vehicle

        box = layout.box()
        box.label(text="Body", icon="MESH_CUBE")
        box.prop(settings, "mass")
        box.prop(settings, "chassis_size")

        box = layout.box()
        box.label(text="Wheels", icon="MESH_CIRCLE")
        box.prop(settings, "wheel_radius")
        box.prop(settings, "wheel_width")
        row = box.row(align=True)
        row.prop(settings, "front_track")
        row.prop(settings, "front_z")
        row = box.row(align=True)
        row.prop(settings, "rear_track")
        row.prop(settings, "rear_z")
        box.prop(settings, "axle_height")

        box = layout.box()
        box.label(text="Suspension", icon="CON_SPLINEIK")
        box.prop(settings, "suspension_rest")
        box.prop(settings, "suspension_stiffness")
        box.prop(settings, "suspension_damping")
        box.prop(settings, "suspension_compression")
        box.prop(settings, "suspension_travel")

        box = layout.box()
        box.label(text="Drive", icon="AUTO")
        box.prop(settings, "engine_force")
        box.prop(settings, "top_speed")
        box.prop(settings, "brake_force")
        box.prop(settings, "handbrake_force")
        box.prop(settings, "max_steer")
        box.prop(settings, "friction_slip")
        box.prop(settings, "roll_influence")
        box.prop(settings, "downforce")
        box.prop(settings, "air_control")


class MTM_PT_vehicle_response(MTMPanel, Panel):
    bl_label = "Response"
    bl_idname = "MTM_PT_vehicle_response"
    bl_parent_id = "MTM_PT_vehicle"

    def draw(self, context):
        layout = self.layout
        h = handling_numbers(context.scene.mtm_vehicle)

        # These are all derived from the settings above. They are what
        # actually determines how the truck feels, so they update live as you
        # drag the sliders.
        box = layout.box()
        box.label(text="Suspension", icon="CON_SPLINEIK")
        _readout(box, "Ride frequency", f"{h['ride_frequency']:.2f} Hz")
        _readout(
            box,
            "Rebound",
            f"{h['rebound_damping']:.2f} ({damping_verdict(h['rebound_damping'])})",
        )
        _readout(
            box,
            "Compression",
            f"{h['compression_damping']:.2f} ({damping_verdict(h['compression_damping'])})",
        )
        _readout(box, "Resting squat", f"{h['rest_compression']:.2f} m")
        _readout(box, "Bump headroom", f"{h['bump_headroom']:.2f} m")
        if h["bump_headroom"] < 0.1:
            box.label(text="Almost no travel left — it will bottom out", icon="ERROR")

        box = layout.box()
        box.label(text="Stance", icon="EMPTY_ARROWS")
        _readout(box, "Ride height", f"{h['ride_height']:.2f} m")

        box = layout.box()
        box.label(text="Drive", icon="AUTO")
        _readout(box, "Launch", f"{h['launch_acceleration']:.1f} m/s2")
        _readout(box, "Drive force", f"{h['drive_force'] / 1000:.1f} kN")
        _readout(box, "Front lifts at", f"{h['front_lift_threshold'] / 1000:.1f} kN")
        _readout(
            box,
            "Wheelie",
            f"{h['wheelie_margin'] * 100:.0f}% ({wheelie_verdict(h['wheelie_margin'])})",
        )
        if h["wheelie_margin"] >= 1.0:
            box.label(text="Drive exceeds the lift threshold — it will loop", icon="ERROR")


def _readout(layout, label, value):
    row = layout.row()
    row.label(text=label)
    row.label(text=value)


class MTM_PT_vehicle_look(MTMPanel, Panel):
    bl_label = "Look"
    bl_idname = "MTM_PT_vehicle_look"
    bl_parent_id = "MTM_PT_vehicle"

    def draw(self, context):
        layout = self.layout
        settings = context.scene.mtm_vehicle

        layout.prop(settings, "style")
        layout.prop(settings, "livery")
        column = layout.column(align=True)
        column.prop(settings, "body_color")
        column.prop(settings, "accent_color")
        column.prop(settings, "trim_color")
        column.prop(settings, "glass_color")
        column.prop(settings, "rim_color")
        row = layout.row(align=True)
        row.prop(settings, "roll_cage", toggle=True)
        row.prop(settings, "stacks", toggle=True)
        row.prop(settings, "light_bar", toggle=True)


class MTM_PT_vehicle_model(MTMPanel, Panel):
    bl_label = "Reference Rig & Model"
    bl_idname = "MTM_PT_vehicle_model"
    bl_parent_id = "MTM_PT_vehicle"

    def draw(self, context):
        layout = self.layout
        settings = context.scene.mtm_vehicle

        box = layout.box()
        box.label(text="Reference Rig", icon="EMPTY_ARROWS")
        box.operator("mtm.build_vehicle_rig", icon="OUTLINER_OB_MESH")
        row = box.row(align=True)
        row.operator("mtm.measure_vehicle_rig", icon="DRIVER_DISTANCE")
        row.operator("mtm.clear_vehicle_rig", icon="TRASH")
        box.label(text="Model against MTM_Body and MTM_Wheel", icon="INFO")

        box = layout.box()
        box.label(text="Your Model", icon="MESH_MONKEY")
        box.operator("mtm.fit_body_to_chassis", icon="FULLSCREEN_ENTER")
        box.operator("mtm.check_vehicle_model", icon="CHECKMARK")
        box.operator("mtm.export_vehicle_model", icon="EXPORT")
        box.prop(settings, "model_path")
        if settings.model_path.strip():
            column = box.column(align=True)
            column.prop(settings, "model_scale")
            column.prop(settings, "model_yaw")
            column.prop(settings, "mirror_left_wheels")
        else:
            box.label(text="Blank = procedural body", icon="INFO")


class MTM_PT_vehicle_export(MTMPanel, Panel):
    bl_label = "Export Vehicle"
    bl_idname = "MTM_PT_vehicle_export"
    bl_parent_id = "MTM_PT_vehicle"

    def draw(self, context):
        layout = self.layout
        settings = context.scene.mtm_vehicle

        layout.prop(settings, "export_path")
        row = layout.row(align=True)
        row.operator("mtm.validate_vehicle", icon="CHECKMARK")
        row.operator("mtm.export_vehicle", icon="EXPORT")


_CLASSES = (
    MTM_PT_track,
    MTM_PT_track_road,
    MTM_PT_track_paint,
    MTM_PT_track_preview,
    MTM_PT_track_environment,
    MTM_PT_track_build,
    MTM_PT_track_collision,
    MTM_PT_track_export,
    MTM_PT_object,
    MTM_PT_vehicle,
    MTM_PT_vehicle_stats,
    MTM_PT_vehicle_physics,
    MTM_PT_vehicle_response,
    MTM_PT_vehicle_look,
    MTM_PT_vehicle_model,
    MTM_PT_vehicle_export,
)


def register():
    for cls in _CLASSES:
        bpy.utils.register_class(cls)


def unregister():
    for cls in reversed(_CLASSES):
        bpy.utils.unregister_class(cls)
