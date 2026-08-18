# SPDX-License-Identifier: MIT
"""
Vehicle exporter: scene settings -> .mtmvehicle.json

Vehicle bodies are built procedurally by the game from a style and a palette,
so this exports numbers rather than geometry. The rig operator in
`ops_vehicle.py` creates matching viewport proxies so you can see the
proportions you are dialling in.
"""

import json
import os

import bpy
from bpy.types import Operator

from .convert import to_hex

FORMAT = "mtm-vehicle"
VERSION = 1


def build_vehicle(scene):
    settings = scene.mtm_vehicle

    vehicle = {
        "format": FORMAT,
        "version": VERSION,
        "id": settings.vehicle_id.strip() or "untitled-truck",
        "name": settings.vehicle_name.strip() or "UNTITLED",
        "blurb": settings.blurb.strip(),
        "class": settings.vehicle_class.strip() or "ALL-ROUND",
        "stats": {
            "speed": int(settings.stat_speed),
            "accel": int(settings.stat_accel),
            "grip": int(settings.stat_grip),
            "weight": int(settings.stat_weight),
            "suspension": int(settings.stat_suspension),
            "toughness": int(settings.stat_toughness),
        },
        "physics": {
            "mass": round(settings.mass, 2),
            "chassisSize": [round(v, 3) for v in settings.chassis_size],
            "chassisOffset": [0, 0.1, 0],
            "wheelRadius": round(settings.wheel_radius, 3),
            "wheelWidth": round(settings.wheel_width, 3),
            "frontAxle": [round(settings.front_track, 3), round(settings.front_z, 3)],
            "rearAxle": [round(settings.rear_track, 3), round(settings.rear_z, 3)],
            "axleHeight": round(settings.axle_height, 3),
            "suspensionRest": round(settings.suspension_rest, 3),
            "suspensionStiffness": round(settings.suspension_stiffness, 3),
            "suspensionDamping": round(settings.suspension_damping, 3),
            "suspensionCompression": round(settings.suspension_compression, 3),
            "maxSuspensionTravel": round(settings.suspension_travel, 3),
            "maxSuspensionForce": 140000,
            "frictionSlip": round(settings.friction_slip, 3),
            "rollInfluence": round(settings.roll_influence, 4),
            "engineForce": round(settings.engine_force, 2),
            "brakeForce": round(settings.brake_force, 2),
            "handbrakeForce": round(settings.handbrake_force, 2),
            "maxSteer": round(settings.max_steer, 4),
            "steerRate": 2.6,
            "highSpeedSteerFactor": 0.42,
            "topSpeed": round(settings.top_speed, 2),
            "downforce": round(settings.downforce, 3),
            "airControl": round(settings.air_control, 3),
        },
        "look": {
            "style": settings.style,
            "bodyColor": to_hex(settings.body_color),
            "accentColor": to_hex(settings.accent_color),
            "trimColor": to_hex(settings.trim_color),
            "glassColor": to_hex(settings.glass_color),
            "rimColor": to_hex(settings.rim_color),
            "livery": settings.livery,
            "rollCage": bool(settings.roll_cage),
            "stacks": bool(settings.stacks),
            "lightBar": bool(settings.light_bar),
        },
    }

    # Only reference a model when one has been exported. Without this the
    # game falls back to the procedural body, which is the sane default.
    if settings.model_path.strip():
        vehicle["model"] = {
            "url": settings.model_path.strip(),
            "bodyNode": "MTM_Body",
            "wheelNode": "MTM_Wheel",
            "scale": round(settings.model_scale, 4),
            "yawOffset": round(settings.model_yaw, 3),
            "mirrorLeftWheels": bool(settings.mirror_left_wheels),
        }

    return vehicle


def check_vehicle(vehicle):
    """Sanity checks that catch the mistakes which make a truck undriveable."""
    problems = []
    physics = vehicle["physics"]

    # The suspension has to be able to hold the truck up: cannon's spring
    # force is stiffness * compression * mass, shared across four wheels
    # against 2g of gravity. Too soft and the truck sits on its belly.
    equilibrium = 19.6 / (4 * physics["suspensionStiffness"])
    if equilibrium > physics["maxSuspensionTravel"] * 0.8:
        problems.append(
            "Suspension is too soft for this mass: it will bottom out. "
            f"Raise stiffness above {round(19.6 / (4 * physics['maxSuspensionTravel'] * 0.8), 1)} "
            "or increase max travel."
        )

    if physics["suspensionRest"] > physics["maxSuspensionTravel"] + physics["wheelRadius"]:
        problems.append("Suspension rest length is longer than the wheel can reach; wheels will float.")

    # Ground clearance: the chassis box must clear the ground when the
    # suspension is fully compressed, or the body will drag.
    clearance = physics["wheelRadius"] + physics["axleHeight"] - physics["chassisSize"][1] * 0.5
    if clearance < 0:
        problems.append(
            "Chassis box reaches below the bottom of the wheels — raise 'Axle Height' "
            "or reduce chassis height, or the body will scrape along the ground."
        )

    if physics["topSpeed"] < 10:
        problems.append("Top speed is below 10 m/s; the truck will feel broken.")

    return problems


class MTM_OT_export_vehicle(Operator):
    """Write the current vehicle settings out as JSON the game can load"""

    bl_idname = "mtm.export_vehicle"
    bl_label = "Export Vehicle"
    bl_options = {"REGISTER"}

    def execute(self, context):
        vehicle = build_vehicle(context.scene)

        for problem in check_vehicle(vehicle):
            self.report({"WARNING"}, problem)

        path = bpy.path.abspath(context.scene.mtm_vehicle.export_path)
        directory = os.path.dirname(path)
        if directory and not os.path.isdir(directory):
            os.makedirs(directory, exist_ok=True)

        try:
            with open(path, "w", encoding="utf-8") as handle:
                json.dump(vehicle, handle, indent=2)
        except OSError as error:
            self.report({"ERROR"}, f"Could not write {path}: {error}")
            return {"CANCELLED"}

        self.report({"INFO"}, f"Exported {vehicle['name']} -> {os.path.basename(path)}")
        return {"FINISHED"}


class MTM_OT_validate_vehicle(Operator):
    """Check the vehicle settings for problems without writing a file"""

    bl_idname = "mtm.validate_vehicle"
    bl_label = "Validate Vehicle"
    bl_options = {"REGISTER"}

    def execute(self, context):
        problems = check_vehicle(build_vehicle(context.scene))
        if problems:
            for problem in problems:
                self.report({"WARNING"}, problem)
            return {"FINISHED"}
        self.report({"INFO"}, "Vehicle settings look sound.")
        return {"FINISHED"}


_CLASSES = (MTM_OT_export_vehicle, MTM_OT_validate_vehicle)


def register():
    for cls in _CLASSES:
        bpy.utils.register_class(cls)


def unregister():
    for cls in reversed(_CLASSES):
        bpy.utils.unregister_class(cls)
