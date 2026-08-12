# SPDX-License-Identifier: MIT
"""
Coordinate conversion between Blender and the game.

Blender is Z-up with +Y forward. The game (three.js) is Y-up with -Z
forward. The mapping is the same one glTF uses:

    game = (bx, bz, -by)

Everything crossing the boundary goes through these helpers rather than
being converted inline. A single inconsistent axis flip produces tracks that
are subtly mirrored, which is miserable to diagnose once it is baked into a
data file — so the conversion lives in exactly one place.
"""

import math

from mathutils import Matrix, Vector


def convert_position(v) -> list:
    """Blender world position -> game position."""
    return [round(v.x, 4), round(v.z, 4), round(-v.y, 4)]


def convert_direction(v) -> Vector:
    """Blender world direction -> game direction (unnormalised)."""
    return Vector((v.x, v.z, -v.y))


def convert_size(v) -> list:
    """
    Blender local extents -> game extents.

    Sizes are unsigned, so the axis swap applies without the sign flip that
    positions need: Blender Y (depth) becomes game Z, Blender Z (up) becomes
    game Y.
    """
    return [round(abs(v.x), 4), round(abs(v.z), 4), round(abs(v.y), 4)]


def yaw_degrees(matrix: Matrix) -> float:
    """
    Heading of an object about the game's vertical axis, in degrees.

    Taken from the object's local +Y axis (Blender's forward) rather than
    from `rotation_euler`, so it is correct regardless of rotation order,
    parenting, or delta transforms.

    The game reconstructs a facing as (sin(yaw), 0, cos(yaw)), and a rotation
    of `yaw` about game +Y sends +X to (cos, 0, -sin) — hence atan2(x, -z).
    """
    forward = convert_direction(matrix.to_3x3() @ Vector((0.0, 1.0, 0.0)))
    return round(math.degrees(math.atan2(forward.x, forward.z)), 3)


def box_yaw_degrees(matrix: Matrix) -> float:
    """
    Yaw for a box-shaped object, measured from its local +X axis.

    Walls are exported as an axis-aligned box plus a yaw, so the angle has to
    describe how far the box's own X axis has been turned about game +Y.
    """
    axis = convert_direction(matrix.to_3x3() @ Vector((1.0, 0.0, 0.0)))
    return round(math.degrees(math.atan2(-axis.z, axis.x)), 3)


def local_bounds(obj):
    """
    Local-space size and centre of an object's bounding box, with scale
    applied. Using `obj.dimensions` instead would give the *world* axis-aligned
    bounds, which balloon as soon as the object is rotated.
    """
    corners = [Vector(c) for c in obj.bound_box]
    minimum = Vector(
        (
            min(c.x for c in corners),
            min(c.y for c in corners),
            min(c.z for c in corners),
        )
    )
    maximum = Vector(
        (
            max(c.x for c in corners),
            max(c.y for c in corners),
            max(c.z for c in corners),
        )
    )
    scale = obj.matrix_world.to_scale()
    size = Vector(
        (
            (maximum.x - minimum.x) * abs(scale.x),
            (maximum.y - minimum.y) * abs(scale.y),
            (maximum.z - minimum.z) * abs(scale.z),
        )
    )
    centre_local = (minimum + maximum) * 0.5
    return size, centre_local


def world_centre(obj) -> Vector:
    """World-space centre of an object's bounding box."""
    _, centre_local = local_bounds(obj)
    return obj.matrix_world @ centre_local


def to_hex(color) -> str:
    """Blender linear colour -> sRGB hex string, as the game's JSON expects."""

    def channel(value: float) -> int:
        value = max(0.0, min(1.0, float(value)))
        # Blender colour properties are linear; the game reads CSS hex, which
        # is sRGB. Skipping this makes every exported colour look washed out.
        srgb = 12.92 * value if value <= 0.0031308 else 1.055 * (value ** (1 / 2.4)) - 0.055
        return int(round(srgb * 255))

    return "#{:02x}{:02x}{:02x}".format(channel(color[0]), channel(color[1]), channel(color[2]))


def resample_polyline(points, spacing: float):
    """
    Resample an ordered list of Blender-space points to roughly even spacing.

    Curves tessellate into far more points than the track format wants, and
    uneven spacing makes the game's Catmull-Rom re-spline bulge. Returns
    points in the original (Blender) space; convert afterwards.
    """
    if len(points) < 2:
        return list(points)

    result = [points[0]]
    carried = 0.0

    for index in range(1, len(points)):
        start = points[index - 1]
        end = points[index]
        segment = (end - start).length
        if segment <= 1e-6:
            continue

        travelled = spacing - carried
        while travelled <= segment:
            result.append(start.lerp(end, travelled / segment))
            travelled += spacing
        carried = (carried + segment) % spacing

    # Drop a final point that has crept back onto the first one, which would
    # otherwise give a closed loop a zero-length segment.
    if len(result) > 2 and (result[-1] - result[0]).length < spacing * 0.5:
        result.pop()

    return result
