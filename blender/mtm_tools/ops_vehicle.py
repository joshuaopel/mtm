# SPDX-License-Identifier: MIT
"""
Vehicle authoring operators.

Two ways to build a truck:

  * Procedural — pick a style and a palette, and the game builds the body
    from primitives. No modelling, and it always fits the physics rig.
  * Modelled — build your own body and wheel against the reference rig, and
    export them as a .glb the game loads instead.

These operators cover the second path: build the rig to model against,
check what you've built actually lines up with the physics, and export it.
"""

import math
import os

import bpy
from bpy.props import BoolProperty
from bpy.types import Operator
from mathutils import Vector

from .vehicle_rig import (
    BODY_NAME,
    RIG_COLLECTION,
    WHEEL_CORNERS,
    WHEEL_NAME,
    axle_height_from_body_z,
    axle_positions,
    axles_from_wheels,
    build_rig,
    clear_rig,
    ensure_slots,
    read_wheel_slots,
    ride_height,
    wheel_rest_z,
    wheel_slot_name,
    wheel_slot_names,
)


def _exportable(obj):
    """Objects that carry real geometry, i.e. worth writing to a glTF."""
    return obj is not None and obj.type in {"MESH", "CURVE", "SURFACE"}


def _slot_meshes(name):
    """
    The mesh objects behind a slot: the named object itself if it is a mesh,
    plus anything parented to it. This is what lets you either rename your
    mesh to `MTM_Body` or parent a whole assembly under an empty of that name.
    """
    root = bpy.data.objects.get(name)
    if root is None:
        return []

    found = []
    if _exportable(root):
        found.append(root)
    for obj in bpy.data.objects:
        if obj.parent is root and _exportable(obj):
            found.append(obj)
    return found


def wheel_slots_in_use():
    """
    The wheel slot names this scene actually models, and whether they are
    per-corner.

    Per-corner wins when all four exist, because an author who made them
    meant them. Falling back to the single slot keeps every truck built
    before the corner slots existed working untouched.
    """
    corners = wheel_slot_names()
    if all(bpy.data.objects.get(name) is not None for name in corners):
        return corners, True
    return [WHEEL_NAME], False


class MTM_OT_build_vehicle_rig(Operator):
    """Build the reference chassis, wheels and ground plane to model against"""

    bl_idname = "mtm.build_vehicle_rig"
    bl_label = "Build Reference Rig"
    bl_options = {"REGISTER", "UNDO"}

    add_slots: BoolProperty(
        name="Add Body/Wheel Slots",
        default=True,
        description="Create empty MTM_Body and MTM_Wheel slots to hang your meshes on",
    )

    def execute(self, context):
        measurements = build_rig(context)
        created = ensure_slots(context) if self.add_slots else []

        self.report(
            {"INFO"},
            "Rig built. Wheelbase {wheelbase:.2f}m, track {track:.2f}m, "
            "centre of mass {com:.2f}m up, clearance {clearance:.2f}m, "
            "resting squat {squat:.2f}m.{slots}".format(
                wheelbase=measurements["wheelbase"],
                track=measurements["track"],
                com=measurements["com_height"],
                clearance=measurements["clearance"],
                squat=measurements["compression"],
                slots=f" Created {', '.join(created)}." if created else "",
            ),
        )
        return {"FINISHED"}


class MTM_OT_clear_vehicle_rig(Operator):
    """Delete the reference rig"""

    bl_idname = "mtm.clear_vehicle_rig"
    bl_label = "Clear Reference Rig"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        clear_rig()
        self.report({"INFO"}, "Reference rig removed.")
        return {"FINISHED"}


class MTM_OT_fit_body_to_chassis(Operator):
    """Scale and centre the body slot to match the physics chassis box"""

    bl_idname = "mtm.fit_body_to_chassis"
    bl_label = "Fit Body To Chassis"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        settings = context.scene.mtm_vehicle
        meshes = _slot_meshes(BODY_NAME)
        if not meshes:
            self.report({"ERROR"}, f"No mesh found for '{BODY_NAME}'.")
            return {"CANCELLED"}

        # World-space bounds of everything in the slot.
        minimum = Vector((math.inf,) * 3)
        maximum = Vector((-math.inf,) * 3)
        for obj in meshes:
            for corner in obj.bound_box:
                world = obj.matrix_world @ Vector(corner)
                for i in range(3):
                    minimum[i] = min(minimum[i], world[i])
                    maximum[i] = max(maximum[i], world[i])

        size = maximum - minimum
        if min(size) <= 1e-6:
            self.report({"ERROR"}, "Body has no volume to fit.")
            return {"CANCELLED"}

        width, height, length = settings.chassis_size
        # Fit to the longest axis so proportions are preserved; the chassis
        # box is a collision volume, not a mould, so matching it exactly on
        # every axis would squash the artwork.
        factor = min(width / size.x, length / size.y, height / size.z)

        root = bpy.data.objects.get(BODY_NAME)
        target_z = ride_height(settings)
        centre = (minimum + maximum) * 0.5

        for obj in meshes:
            if obj.parent is root and root is not None:
                continue  # parented meshes follow the root
            obj.scale = [s * factor for s in obj.scale]
            obj.location = (
                obj.location.x - centre.x * factor,
                obj.location.y - centre.y * factor,
                obj.location.z - centre.z * factor + target_z,
            )

        self.report(
            {"INFO"},
            f"Scaled body by {factor:.3f} and centred it on the chassis origin.",
        )
        return {"FINISHED"}


class MTM_OT_check_vehicle_model(Operator):
    """Check the body and wheel line up with the physics rig"""

    bl_idname = "mtm.check_vehicle_model"
    bl_label = "Check Model Alignment"
    bl_options = {"REGISTER"}

    def execute(self, context):
        settings = context.scene.mtm_vehicle
        problems = 0

        body = _slot_meshes(BODY_NAME)
        slot_names, per_corner = wheel_slots_in_use()

        if not body:
            self.report({"ERROR"}, f"No mesh named or parented to '{BODY_NAME}'.")
            problems += 1
        empty_slots = [name for name in slot_names if not _slot_meshes(name)]
        if empty_slots:
            self.report({"ERROR"}, f"No mesh named or parented to '{', '.join(empty_slots)}'.")
            problems += 1
        if problems:
            return {"CANCELLED"}

        com_height = ride_height(settings)

        # Body should straddle the centre of mass, not sit above or below it.
        body_min = math.inf
        body_max = -math.inf
        for obj in body:
            for corner in obj.bound_box:
                z = (obj.matrix_world @ Vector(corner)).z
                body_min = min(body_min, z)
                body_max = max(body_max, z)

        if body_min > com_height:
            self.report(
                {"WARNING"},
                f"Body sits entirely above the centre of mass ({com_height:.2f}m). "
                "It will look like it is floating — run 'Fit Body To Chassis'.",
            )
            problems += 1
        elif body_max < com_height:
            self.report(
                {"WARNING"},
                f"Body sits entirely below the centre of mass ({com_height:.2f}m). "
                "It will be buried in the ground.",
            )
            problems += 1

        # Where each wheel slot should sit. A single slot is modelled at the
        # origin and cloned; per-corner slots are modelled where they belong,
        # which is directly over the axle at exactly one wheel radius up —
        # the height a resting wheel always has, whatever `axleHeight` is.
        expected_at = {}
        if per_corner:
            rest_z = wheel_rest_z(settings)
            for label, x, y in axle_positions(settings):
                expected_at[wheel_slot_name(label)] = Vector((x, y, rest_z))
        else:
            expected_at[WHEEL_NAME] = Vector((0.0, 0.0, 0.0))

        modelled_radius = 0.0
        for name in slot_names:
            wheel_min = Vector((math.inf,) * 3)
            wheel_max = Vector((-math.inf,) * 3)
            for obj in _slot_meshes(name):
                for corner in obj.bound_box:
                    world = obj.matrix_world @ Vector(corner)
                    for i in range(3):
                        wheel_min[i] = min(wheel_min[i], world[i])
                        wheel_max[i] = max(wheel_max[i], world[i])

            centre = (wheel_min + wheel_max) * 0.5
            drift = (centre - expected_at[name]).length
            if drift > 0.15:
                where = (
                    f"its axle position {tuple(round(v, 2) for v in expected_at[name])}"
                    if per_corner
                    else "the origin"
                )
                self.report(
                    {"WARNING"},
                    f"{name} is {drift:.2f}m from {where}. The game places wheels from "
                    "the physics numbers, so an offset here is applied on top.",
                )
                problems += 1

            wheel_size = wheel_max - wheel_min
            modelled_radius = max(modelled_radius, max(wheel_size.y, wheel_size.z) * 0.5)

        expected = settings.wheel_radius
        if modelled_radius > 1e-4 and abs(modelled_radius - expected) > expected * 0.15:
            self.report(
                {"WARNING"},
                f"Wheel radius is {modelled_radius:.2f}m but physics expects "
                f"{expected:.2f}m. It will not touch the ground correctly — "
                "rescale the mesh or change 'Wheel Radius'.",
            )
            problems += 1

        if problems == 0:
            layout = "four corners" if per_corner else "one wheel, cloned"
            self.report(
                {"INFO"},
                f"Body and wheels line up ({layout}). Centre of mass {com_height:.2f}m, "
                f"wheel radius {modelled_radius:.2f}m.",
            )
        return {"FINISHED"}


class MTM_OT_export_vehicle_model(Operator):
    """Export the body and wheel meshes as the truck's .glb"""

    bl_idname = "mtm.export_vehicle_model"
    bl_label = "Export Model (.glb)"
    bl_options = {"REGISTER"}

    def execute(self, context):
        settings = context.scene.mtm_vehicle
        slot_names, per_corner = wheel_slots_in_use()
        roots = [BODY_NAME] + slot_names

        meshes = []
        for name in roots:
            meshes.extend(_slot_meshes(name))
        if not meshes:
            self.report(
                {"ERROR"},
                f"Nothing to export — create '{BODY_NAME}' and "
                f"'{', '.join(slot_names)}' meshes first.",
            )
            return {"CANCELLED"}

        json_path = bpy.path.abspath(settings.export_path)
        base = os.path.splitext(os.path.basename(json_path))[0]
        if base.endswith(".mtmvehicle"):
            base = base[: -len(".mtmvehicle")]
        glb_name = f"{base}.glb"
        glb_path = os.path.join(os.path.dirname(json_path), glb_name)

        directory = os.path.dirname(glb_path)
        if directory and not os.path.isdir(directory):
            os.makedirs(directory, exist_ok=True)

        previous = list(context.selected_objects)
        previous_active = context.view_layer.objects.active

        try:
            bpy.ops.object.select_all(action="DESELECT")
            # The named slot roots go too, so the node names survive into the
            # glTF for the runtime to find.
            for name in roots:
                root = bpy.data.objects.get(name)
                if root is not None:
                    root.select_set(True)
            for obj in meshes:
                obj.select_set(True)
            context.view_layer.objects.active = meshes[0]

            bpy.ops.export_scene.gltf(
                filepath=glb_path,
                export_format="GLB",
                use_selection=True,
                export_apply=True,
                export_yup=True,
            )
        except Exception as error:  # noqa: BLE001 - reported below
            self.report({"ERROR"}, f"glTF export failed: {error}")
            return {"CANCELLED"}
        finally:
            bpy.ops.object.select_all(action="DESELECT")
            for obj in previous:
                try:
                    obj.select_set(True)
                except ReferenceError:
                    pass
            context.view_layer.objects.active = previous_active

        settings.model_path = f"content/{glb_name}"
        layout = "four corners" if per_corner else "one wheel"
        self.report(
            {"INFO"},
            f"Exported {len(meshes)} mesh(es) ({layout}) -> {glb_name}. "
            "Export the vehicle JSON as well; it now references this model.",
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
        # Shared monster-truck baseline.
        settings.wheel_radius = 0.92
        settings.wheel_width = 0.62
        settings.front_track = 1.34
        settings.rear_track = 1.34
        settings.front_z = 1.72
        settings.rear_z = -1.78
        settings.axle_height = -0.35
        settings.suspension_rest = 1.0
        settings.suspension_travel = 1.1

        if self.heavy:
            settings.mass = 2350.0
            settings.engine_force = 5200.0
            settings.top_speed = 35.0
            settings.friction_slip = 3.3
            settings.suspension_stiffness = 28.0
            settings.max_steer = 0.5
            settings.air_control = 1.8
            settings.roll_influence = 0.09
            settings.style = "hauler"
        else:
            settings.mass = 1600.0
            settings.engine_force = 4200.0
            settings.top_speed = 38.0
            settings.friction_slip = 2.8
            settings.suspension_stiffness = 20.0
            settings.max_steer = 0.58
            settings.air_control = 2.6
            settings.roll_influence = 0.12
            settings.style = "pickup"

        self.report({"INFO"}, "Preset loaded. Rebuild the reference rig to see it.")
        return {"FINISHED"}


class MTM_OT_measure_vehicle_rig(Operator):
    """Read the axle numbers back off the wheel slots you dragged"""

    bl_idname = "mtm.measure_vehicle_rig"
    bl_label = "Read Axles From Wheels"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        settings = context.scene.mtm_vehicle
        bpy.context.view_layer.update()

        wheels = read_wheel_slots()
        source = "wheel slots"

        if not wheels:
            # Fall back to the reference rings, which is all there was before
            # the draggable slots existed.
            collection = bpy.data.collections.get(RIG_COLLECTION)
            if collection is not None:
                for obj in collection.objects:
                    if obj.name.startswith("MTM_Ref_Wheel_") and obj.name.count("_") == 3:
                        wheels[obj.name.rsplit("_", 1)[-1]] = obj
                source = "reference rig"
            if len(wheels) < 4:
                self.report(
                    {"ERROR"},
                    "No wheel slots to measure. Run 'Build Reference Rig' to create "
                    f"{', '.join(wheel_slot_names())}, then drag them into place.",
                )
                return {"CANCELLED"}

        for key, value in axles_from_wheels(wheels).items():
            setattr(settings, key, value)

        # Height is deliberately not read from the wheels: a resting wheel
        # always sits at its own radius whatever `axleHeight` is, so dragging
        # one up or down says nothing about it. Ride height comes from the
        # body instead.
        body = bpy.data.objects.get(BODY_NAME)
        note = ""
        if body is not None:
            wanted = axle_height_from_body_z(settings, body.matrix_world.translation.z)
            if abs(wanted - settings.axle_height) > 1e-4:
                settings.axle_height = round(wanted, 3)
                note = f", axle height {settings.axle_height:.3f}m from the body"

        self.report(
            {"INFO"},
            f"Read from {source}: wheelbase {abs(settings.front_z - settings.rear_z):.2f}m, "
            f"front track {settings.front_track * 2:.2f}m, "
            f"rear track {settings.rear_track * 2:.2f}m{note}.",
        )
        return {"FINISHED"}


_CLASSES = (
    MTM_OT_build_vehicle_rig,
    MTM_OT_clear_vehicle_rig,
    MTM_OT_fit_body_to_chassis,
    MTM_OT_check_vehicle_model,
    MTM_OT_export_vehicle_model,
    MTM_OT_load_vehicle_preset,
    MTM_OT_measure_vehicle_rig,
)


def register():
    for cls in _CLASSES:
        bpy.utils.register_class(cls)


def unregister():
    for cls in reversed(_CLASSES):
        bpy.utils.unregister_class(cls)
