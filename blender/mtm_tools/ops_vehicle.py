# SPDX-License-Identifier: MIT
"""
Vehicle authoring operators.

The game builds truck bodies procedurally from a style and a palette, so
there is no mesh to model. What you do need is a way to *see* the numbers
you are choosing — wheelbase, track width, wheel size, ride height — because
those decide how a truck drives and how it looks. These operators build a
throwaway proxy rig in the viewport from the current settings, and read
measurements back off it if you move things around.
"""

import bpy
from bpy.props import BoolProperty
from bpy.types import Operator
from mathutils import Vector

RIG_COLLECTION = "MTM_VehicleProxy"


def _clear_rig():
    collection = bpy.data.collections.get(RIG_COLLECTION)
    if collection is None:
        return
    for obj in list(collection.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.collections.remove(collection)


def _ensure_collection(scene):
    collection = bpy.data.collections.new(RIG_COLLECTION)
    scene.collection.children.link(collection)
    return collection


def _box(name, size, location, collection):
    mesh = bpy.data.meshes.new(name)
    x, y, z = size.x * 0.5, size.y * 0.5, size.z * 0.5
    verts = [
        (-x, -y, -z), (x, -y, -z), (x, y, -z), (-x, y, -z),
        (-x, -y, z), (x, -y, z), (x, y, z), (-x, y, z),
    ]
    faces = [
        (0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1),
        (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0),
    ]
    mesh.from_pydata(verts, [], faces)
    mesh.update()

    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    collection.objects.link(obj)
    return obj


class MTM_OT_build_vehicle_proxy(Operator):
    """Build a viewport proxy of the current vehicle settings"""

    bl_idname = "mtm.build_vehicle_proxy"
    bl_label = "Build Proxy Rig"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        scene = context.scene
        settings = scene.mtm_vehicle

        _clear_rig()
        collection = _ensure_collection(scene)

        # The game's chassisSize is (width, height, length) in its own Y-up
        # frame; in Blender that is (width, length, height).
        width, height, length = settings.chassis_size
        ride_height = settings.wheel_radius + settings.axle_height

        body = _box(
            "MTM_Proxy_Body",
            Vector((width, length, height)),
            Vector((0.0, 0.0, ride_height + 0.1)),
            collection,
        )
        body.display_type = "WIRE"

        # Wheels as cylinders on the axle lines. Blender +Y is forward and the
        # game's +Z is forward, so the axle Z offsets map onto Blender Y.
        for label, half_track, offset in (
            ("FL", -settings.front_track, settings.front_z),
            ("FR", settings.front_track, settings.front_z),
            ("RL", -settings.rear_track, settings.rear_z),
            ("RR", settings.rear_track, settings.rear_z),
        ):
            bpy.ops.mesh.primitive_cylinder_add(
                vertices=16,
                radius=settings.wheel_radius,
                depth=settings.wheel_width,
                location=(half_track, offset, settings.wheel_radius),
                rotation=(0.0, 1.5707963, 0.0),
            )
            wheel = context.active_object
            wheel.name = f"MTM_Proxy_Wheel_{label}"
            for existing in list(wheel.users_collection):
                existing.objects.unlink(wheel)
            collection.objects.link(wheel)

        # Ground plane at z=0 so ride height is readable at a glance.
        ground = _box(
            "MTM_Proxy_Ground",
            Vector((max(6.0, width * 3), max(10.0, length * 2), 0.02)),
            Vector((0.0, 0.0, -0.01)),
            collection,
        )
        ground.display_type = "WIRE"

        clearance = round(ride_height - height * 0.5, 3)
        wheelbase = round(abs(settings.front_z - settings.rear_z), 3)
        self.report(
            {"INFO"},
            f"Proxy built. Wheelbase {wheelbase} m, ground clearance {clearance} m.",
        )
        return {"FINISHED"}


class MTM_OT_clear_vehicle_proxy(Operator):
    """Delete the vehicle proxy rig"""

    bl_idname = "mtm.clear_vehicle_proxy"
    bl_label = "Clear Proxy Rig"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        _clear_rig()
        self.report({"INFO"}, "Proxy rig removed.")
        return {"FINISHED"}


class MTM_OT_measure_vehicle_proxy(Operator):
    """Read wheel positions back off the proxy rig into the settings"""

    bl_idname = "mtm.measure_vehicle_proxy"
    bl_label = "Read Back From Proxy"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        settings = context.scene.mtm_vehicle
        collection = bpy.data.collections.get(RIG_COLLECTION)
        if collection is None:
            self.report({"ERROR"}, "No proxy rig in the scene — build one first.")
            return {"CANCELLED"}

        wheels = {}
        for obj in collection.objects:
            if obj.name.startswith("MTM_Proxy_Wheel_"):
                wheels[obj.name.rsplit("_", 1)[-1]] = obj

        if len(wheels) < 4:
            self.report({"ERROR"}, "Proxy rig is missing wheels; rebuild it.")
            return {"CANCELLED"}

        front = [wheels["FL"], wheels["FR"]]
        rear = [wheels["RL"], wheels["RR"]]

        settings.front_track = round(sum(abs(w.location.x) for w in front) / 2.0, 3)
        settings.rear_track = round(sum(abs(w.location.x) for w in rear) / 2.0, 3)
        settings.front_z = round(sum(w.location.y for w in front) / 2.0, 3)
        settings.rear_z = round(sum(w.location.y for w in rear) / 2.0, 3)

        self.report(
            {"INFO"},
            f"Read back: front axle {settings.front_z} m, rear axle {settings.rear_z} m.",
        )
        return {"FINISHED"}


class MTM_OT_load_vehicle_preset(Operator):
    """Load a balanced starting point for a class of truck"""

    bl_idname = "mtm.load_vehicle_preset"
    bl_label = "Load Preset"
    bl_options = {"REGISTER", "UNDO"}

    heavy: BoolProperty(name="Heavy", default=False)

    def execute(self, context):
        settings = context.scene.mtm_vehicle
        if self.heavy:
            settings.mass = 2050.0
            settings.engine_force = 6200.0
            settings.top_speed = 38.0
            settings.friction_slip = 3.2
            settings.suspension_stiffness = 44.0
            settings.max_steer = 0.48
            settings.air_control = 1.9
            settings.style = "hauler"
        else:
            settings.mass = 1400.0
            settings.engine_force = 5200.0
            settings.top_speed = 42.0
            settings.friction_slip = 2.7
            settings.suspension_stiffness = 36.0
            settings.max_steer = 0.55
            settings.air_control = 2.6
            settings.style = "pickup"
        self.report({"INFO"}, "Preset loaded.")
        return {"FINISHED"}


_CLASSES = (
    MTM_OT_build_vehicle_proxy,
    MTM_OT_clear_vehicle_proxy,
    MTM_OT_measure_vehicle_proxy,
    MTM_OT_load_vehicle_preset,
)


def register():
    for cls in _CLASSES:
        bpy.utils.register_class(cls)


def unregister():
    for cls in reversed(_CLASSES):
        bpy.utils.unregister_class(cls)
