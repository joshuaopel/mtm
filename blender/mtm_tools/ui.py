# SPDX-License-Identifier: MIT
"""
Sidebar panels (View3D > N > MTM).

Split into a Track tab and a Vehicle tab, each ordered the way you actually
work: create, shape, populate, validate, export.
"""

import bpy
from bpy.types import Panel


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
        box.prop(settings, "terrain_segments")
        box.prop(settings, "terrain_amplitude")
        box.prop(settings, "terrain_frequency")
        box.prop(settings, "terrain_seed")
        box.label(text="Size follows the terrain bounds object", icon="INFO")


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
            box.prop(mtm, "prop_solid")
        elif mtm.role == "CHECKPOINT":
            box = layout.box()
            box.prop(mtm, "checkpoint_order")
            box.prop(mtm, "checkpoint_width")
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


class MTM_PT_vehicle_export(MTMPanel, Panel):
    bl_label = "Proxy & Export"
    bl_idname = "MTM_PT_vehicle_export"
    bl_parent_id = "MTM_PT_vehicle"

    def draw(self, context):
        layout = self.layout
        settings = context.scene.mtm_vehicle

        column = layout.column(align=True)
        column.operator("mtm.build_vehicle_proxy", icon="OUTLINER_OB_MESH")
        column.operator("mtm.measure_vehicle_proxy", icon="DRIVER_DISTANCE")
        column.operator("mtm.clear_vehicle_proxy", icon="TRASH")

        layout.separator()
        layout.prop(settings, "export_path")
        row = layout.row(align=True)
        row.operator("mtm.validate_vehicle", icon="CHECKMARK")
        row.operator("mtm.export_vehicle", icon="EXPORT")


_CLASSES = (
    MTM_PT_track,
    MTM_PT_track_road,
    MTM_PT_track_environment,
    MTM_PT_track_build,
    MTM_PT_track_export,
    MTM_PT_object,
    MTM_PT_vehicle,
    MTM_PT_vehicle_stats,
    MTM_PT_vehicle_physics,
    MTM_PT_vehicle_look,
    MTM_PT_vehicle_export,
)


def register():
    for cls in _CLASSES:
        bpy.utils.register_class(cls)


def unregister():
    for cls in reversed(_CLASSES):
        bpy.utils.unregister_class(cls)
