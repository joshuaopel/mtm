# SPDX-License-Identifier: MIT
"""
The standard chassis reference rig.

A monster truck in this game is a physics rig — a chassis box, four
suspension attachment points, and wheels of a given radius — with artwork
hung on it. The hard part of modelling one is not the modelling, it is
knowing exactly where the physics thinks things are, because the runtime
places wheels from the numbers and not from your mesh.

This builds that rig as visible reference geometry so you can model against
it: the chassis collision box, the wheel positions at full droop, resting
height and full compression, the ground plane, and the centre of mass your
body mesh must be built around.

Everything it creates is reference only. It is excluded from export, and the
`MTM_Body` / `MTM_Wheel` slots are the only objects that ship.
"""

import bpy
from mathutils import Vector

RIG_COLLECTION = "MTM_VehicleRig"
BODY_NAME = "MTM_Body"
WHEEL_NAME = "MTM_Wheel"

# Front-left, front-right, rear-left, rear-right — the order the game adds
# wheels to its physics rig, so index 0 and 2 are always the left-hand pair.
# Left is -X in both Blender and the game.
WHEEL_CORNERS = ("FL", "FR", "RL", "RR")


def wheel_slot_name(corner):
    """`MTM_Wheel_FL` and friends: the per-corner slots you drag."""
    return f"{WHEEL_NAME}_{corner}"


def wheel_slot_names():
    return [wheel_slot_name(corner) for corner in WHEEL_CORNERS]

# Colours for reference parts, so the rig reads at a glance.
COLOUR_CHASSIS = (1.0, 0.55, 0.1, 1.0)
COLOUR_TRAVEL = (0.35, 0.7, 1.0, 1.0)
COLOUR_REST = (0.4, 1.0, 0.5, 1.0)
COLOUR_GROUND = (0.5, 0.5, 0.5, 1.0)
COLOUR_COM = (1.0, 0.2, 0.2, 1.0)


def rest_compression(settings):
    """
    How far the springs sit compressed under the truck's own weight.

    Mirrors cannon's spring equation — force = stiffness x compression x mass
    against 2g — so the rig shows the ride height the game will actually use
    rather than the fully-extended one.
    """
    return min(settings.suspension_travel, 19.6 / (4 * max(1e-3, settings.suspension_stiffness)))


def suspension_drop(settings):
    """
    Distance from the suspension mounting point down to the wheel centre at
    rest — the extended spring length minus the squat under the truck's own
    weight.
    """
    return settings.suspension_rest - rest_compression(settings)


def ride_height(settings):
    """Height of the chassis origin (the centre of mass) above the ground."""
    return settings.wheel_radius + suspension_drop(settings) - settings.axle_height


def wheel_rest_z(settings):
    """
    Height of a wheel centre in the scene, at rest.

    Always the wheel radius, and that is not a simplification — it falls out
    of the definitions. With the body at ride height H:

        wheel_z = H + axle_height - drop
        H       = wheel_radius + drop - axle_height

    Substitute and the `axle_height` and `drop` terms both cancel, leaving
    `wheel_z = wheel_radius`. A resting wheel touches the ground; where else
    would it be?

    The consequence matters for authoring: **dragging a wheel up or down
    cannot tell you `axleHeight`.** It only says how big the tyre is. The
    vertical degree of freedom the author actually controls is how high the
    body floats over the axles, which is `axle_height_from_body_z` below.
    """
    return settings.wheel_radius


def axle_height_from_body_z(settings, body_z):
    """
    Turn the height of the body origin — the centre of mass — into the
    `axleHeight` the game wants.

    Rearranged from `ride_height`, so raising the body lowers the strut mount
    relative to it: the two move in opposite directions. This is the only
    honest way to set `axleHeight` by dragging something, because it is the
    only thing whose height depends on it.
    """
    return settings.wheel_radius + suspension_drop(settings) - body_z


def clear_rig():
    collection = bpy.data.collections.get(RIG_COLLECTION)
    if collection is None:
        return
    for obj in list(collection.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.collections.remove(collection)


def ensure_collection(scene):
    collection = bpy.data.collections.get(RIG_COLLECTION)
    if collection is None:
        collection = bpy.data.collections.new(RIG_COLLECTION)
        scene.collection.children.link(collection)
    return collection


def _box_mesh(name, size):
    x, y, z = size.x * 0.5, size.y * 0.5, size.z * 0.5
    mesh = bpy.data.meshes.new(name)
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
    return mesh


def _add_box(collection, name, size, location, colour, wire=True):
    obj = bpy.data.objects.new(name, _box_mesh(name, size))
    obj.location = location
    obj.color = colour
    if wire:
        obj.display_type = "WIRE"
    collection.objects.link(obj)
    return obj


def _add_ring(collection, name, radius, location, colour, width):
    """A wheel outline, drawn as a flat cylinder lying on the axle."""
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=24,
        radius=radius,
        depth=width,
        location=location,
        rotation=(0.0, 1.5707963, 0.0),
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.display_type = "WIRE"
    obj.color = colour
    for existing in list(obj.users_collection):
        existing.objects.unlink(obj)
    collection.objects.link(obj)
    return obj


def axle_positions(settings):
    """(label, x, y) for each wheel, in Blender space (+Y forward)."""
    return [
        ("FL", -settings.front_track, settings.front_z),
        ("FR", settings.front_track, settings.front_z),
        ("RL", -settings.rear_track, settings.rear_z),
        ("RR", settings.rear_track, settings.rear_z),
    ]


def build_rig(context):
    """
    Build the reference rig from the current vehicle settings.

    Returns a short summary of the key measurements, which the operator
    reports so the numbers are visible without opening the panel.
    """
    scene = context.scene
    settings = scene.mtm_vehicle

    clear_rig()
    collection = ensure_collection(scene)

    com_height = ride_height(settings)
    compression = rest_compression(settings)

    # The game's chassisSize is (width, height, length) in its Y-up frame;
    # in Blender that is (width, length, height).
    width, height, length = settings.chassis_size
    chassis = _add_box(
        collection,
        "MTM_Ref_ChassisBox",
        Vector((width, length, height)),
        Vector((0.0, 0.0, com_height + 0.1)),
        COLOUR_CHASSIS,
    )
    chassis.hide_select = True

    # Centre of mass: a small marker at the origin your body must be built
    # around. Getting this wrong is the most common reason an imported truck
    # looks like it is floating or sunk into the ground.
    com = bpy.data.objects.new("MTM_Ref_CentreOfMass", None)
    com.empty_display_type = "PLAIN_AXES"
    com.empty_display_size = 0.8
    com.location = (0.0, 0.0, com_height)
    com.color = COLOUR_COM
    com.hide_select = True
    collection.objects.link(com)

    for label, x, y in axle_positions(settings):
        # Resting position — where the wheel actually sits in game.
        rest = _add_ring(
            collection,
            f"MTM_Ref_Wheel_{label}",
            settings.wheel_radius,
            (x, y, settings.wheel_radius),
            COLOUR_REST,
            settings.wheel_width,
        )
        rest.hide_select = True

        # Travel extremes, so you can check nothing fouls the bodywork
        # through the full stroke.
        droop_z = settings.wheel_radius - (settings.suspension_travel - compression)
        bump_z = settings.wheel_radius + compression
        for suffix, z, in (("Droop", droop_z), ("Bump", bump_z)):
            ring = _add_ring(
                collection,
                f"MTM_Ref_Wheel_{label}_{suffix}",
                settings.wheel_radius,
                (x, y, z),
                COLOUR_TRAVEL,
                settings.wheel_width * 0.35,
            )
            ring.hide_select = True

    ground = _add_box(
        collection,
        "MTM_Ref_Ground",
        Vector((max(8.0, width * 4), max(12.0, length * 2.4), 0.02)),
        Vector((0.0, 0.0, -0.01)),
        COLOUR_GROUND,
    )
    ground.hide_select = True

    clearance = com_height - height * 0.5
    return {
        "com_height": com_height,
        "clearance": clearance,
        "wheelbase": abs(settings.front_z - settings.rear_z),
        "track": settings.front_track * 2,
        "compression": compression,
    }


def ensure_slots(context, per_corner=True):
    """
    Create the body and wheel slots if the scene has none.

    They are plain Empties: parent your own meshes to them, or rename your
    meshes to match. Either way the exporter finds them by name.

    `per_corner` gives four wheel slots — `MTM_Wheel_FL`, `_FR`, `_RL`, `_RR`
    — placed where the physics currently puts them and, unlike the reference
    rings, selectable. Drag them and read the axle numbers back off. Turn it
    off for the older single `MTM_Wheel` at the origin, cloned four times by
    the runtime, which is still the right choice for a symmetric truck.
    """
    scene = context.scene
    collection = ensure_collection(scene)
    settings = scene.mtm_vehicle
    created = []

    if bpy.data.objects.get(BODY_NAME) is None:
        body = bpy.data.objects.new(BODY_NAME, None)
        body.empty_display_type = "CUBE"
        body.empty_display_size = 0.5
        # Sits at the centre of mass, which is the origin the runtime uses.
        body.location = (0.0, 0.0, ride_height(settings))
        collection.objects.link(body)
        created.append(BODY_NAME)

    if per_corner:
        rest_z = wheel_rest_z(settings)
        for label, x, y in axle_positions(settings):
            name = wheel_slot_name(label)
            if bpy.data.objects.get(name) is not None:
                continue
            wheel = bpy.data.objects.new(name, None)
            wheel.empty_display_type = "CIRCLE"
            wheel.empty_display_size = settings.wheel_radius
            # Lying on the axle, like the reference rings, so the circle
            # reads as a tyre rather than a puddle.
            wheel.rotation_euler = (0.0, 1.5707963, 0.0)
            wheel.location = (x, y, rest_z)
            collection.objects.link(wheel)
            created.append(name)
        return created

    if bpy.data.objects.get(WHEEL_NAME) is None:
        wheel = bpy.data.objects.new(WHEEL_NAME, None)
        wheel.empty_display_type = "CIRCLE"
        wheel.empty_display_size = settings.wheel_radius
        # Modelled at the origin: the runtime places all four copies itself.
        wheel.location = (0.0, 0.0, 0.0)
        collection.objects.link(wheel)
        created.append(WHEEL_NAME)

    return created


def read_wheel_slots():
    """
    The per-corner wheel slots present in the scene, by label.

    Returns `{}` unless all four are there — a partial set means the author
    is mid-way through something, and guessing from two corners would write
    nonsense into the settings.
    """
    found = {}
    for corner in WHEEL_CORNERS:
        obj = bpy.data.objects.get(wheel_slot_name(corner))
        if obj is None:
            return {}
        found[corner] = obj
    return found


def axles_from_wheels(wheels):
    """
    Derive the axle numbers from four dragged wheel slots.

    Track is the mean of the two |x| on an axle, so a slightly asymmetric
    drag lands on something symmetric rather than putting one wheel further
    out than the other — the physics has one half-track per axle and cannot
    represent the difference anyway.
    """
    def axle(left, right):
        half_track = (abs(left.matrix_world.translation.x) + abs(right.matrix_world.translation.x)) / 2.0
        longitudinal = (left.matrix_world.translation.y + right.matrix_world.translation.y) / 2.0
        return round(half_track, 3), round(longitudinal, 3)

    front_track, front_z = axle(wheels["FL"], wheels["FR"])
    rear_track, rear_z = axle(wheels["RL"], wheels["RR"])
    return {
        "front_track": front_track,
        "front_z": front_z,
        "rear_track": rear_track,
        "rear_z": rear_z,
    }
