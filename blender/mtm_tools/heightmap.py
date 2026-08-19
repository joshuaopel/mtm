# SPDX-License-Identifier: MIT
"""
Baking a sculpted terrain mesh into a heightfield.

The physics ground is a heightfield — a regular grid of heights — because
that is what the wheels ray-cast against and what keeps the visible ground and
the collision ground identical. So a sculpted terrain mesh cannot be shipped
as-is; it has to be sampled onto that grid.

The consequence worth knowing before you model: overhangs, caves and vertical
cliff faces cannot be represented. Anything modelled as one bakes to its
topmost surface, and the truck drives over the top of it.
"""

import base64
import struct

from mathutils import Vector

from . import paint as paint_module

# How far above the terrain the sampling ray starts. Generous, because the
# author's mesh could be anywhere.
RAY_HEIGHT = 10000.0


def bake_surface(obj, depsgraph, size, segments, problems, want_paint=False):
    """
    Sample a mesh onto a (segments+1)^2 grid by casting rays straight down.

    The grid is laid out in game space — index `iz * (segments + 1) + ix`,
    x and z running from -size/2 to +size/2 — so it drops straight into the
    runtime's own height array.

    Height and paint come out of the same ray because they are answers about
    the same point on the same surface; casting twice would double the cost of
    a bake for nothing. Returns `(heights, paint_bytes)` where paint is None
    unless asked for and actually painted, or `(None, None)` if the mesh could
    not be sampled at all.
    """
    if obj.type != "MESH":
        problems.append(
            f"'{obj.name}' is the Terrain object but is not a mesh. "
            "Switch Terrain to 'Generated', or give the role to a mesh."
        )
        return None, None

    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.data
    matrix = evaluated.matrix_world
    inverse = matrix.inverted()
    # Ray directions are transformed by the rotation only; a direction has no
    # translation, and using the full matrix would skew it.
    direction_local = (inverse.to_3x3() @ Vector((0.0, 0.0, -1.0))).normalized()

    layer = paint_module.find_attribute(mesh) if want_paint else None
    packed = bytearray() if layer is not None else None

    element = size / segments
    heights = []
    misses = 0

    for iz in range(segments + 1):
        for ix in range(segments + 1):
            # Grid position in game space, then into Blender space:
            # game (x, y, z) -> Blender (x, -z, y).
            gx = -size / 2 + ix * element
            gz = -size / 2 + iz * element
            world = Vector((gx, -gz, RAY_HEIGHT))

            origin_local = inverse @ world
            hit, location, _, face = evaluated.ray_cast(origin_local, direction_local)
            if hit:
                heights.append((matrix @ location).z)
                if packed is not None:
                    colour = paint_module.sample_colour(
                        mesh, layer, location, mesh.polygons[face]
                    )
                    packed.extend(paint_module.clamp_byte(c) for c in colour)
            else:
                # No surface under this point. Zero keeps the grid flat there
                # rather than punching a hole in the world.
                heights.append(0.0)
                misses += 1
                if packed is not None:
                    packed.extend((0, 0, 0))

    total = len(heights)
    if misses == total:
        problems.append(
            f"'{obj.name}' was not hit by any sampling ray. It probably does not "
            "cover the terrain area, or its normals are inverted."
        )
        return None, None

    if misses > total * 0.25:
        problems.append(
            f"{misses * 100 // total}% of the terrain area has no surface under it. "
            f"Scale '{obj.name}' to cover the whole {size:.0f}m patch, or those "
            "areas will be flat at zero."
        )

    if packed is not None and paint_module.is_blank(packed):
        # Everything is the base layer, which the game assumes anyway.
        packed = None

    return heights, packed


def encode_paint(packed):
    """Base64 the painted RGB bytes, three per grid vertex."""
    return base64.b64encode(bytes(packed)).decode("ascii")


def encode_heights(heights):
    """Pack a height list as little-endian float32, base64 — the wire format."""
    return base64.b64encode(struct.pack(f"<{len(heights)}f", *heights)).decode("ascii")


def sample_grid(heights, size, segments, x, z):
    """Bilinear height lookup into a baked grid, in game space."""
    element = size / segments
    fx = (x + size / 2) / element
    fz = (z + size / 2) / element
    x0 = min(segments - 1, max(0, int(fx)))
    z0 = min(segments - 1, max(0, int(fz)))
    tx = min(1.0, max(0.0, fx - x0))
    tz = min(1.0, max(0.0, fz - z0))
    row = segments + 1
    h00 = heights[z0 * row + x0]
    h10 = heights[z0 * row + x0 + 1]
    h01 = heights[(z0 + 1) * row + x0]
    h11 = heights[(z0 + 1) * row + x0 + 1]
    top = h00 + (h10 - h00) * tx
    bottom = h01 + (h11 - h01) * tx
    return top + (bottom - top) * tz


def check_road_alignment(heights, size, segments, road, shoulder, carve, problems):
    """
    Compare the sculpted ground against the road's own elevation.

    Both ways of getting this wrong are silent until you drive the track, and
    both are miserable: with the carve on, ground far above the road turns the
    course into a trench; with it off, the trucks spawn in mid-air or inside a
    hill and start the race on their roofs.
    """
    gaps = []
    for point in road["points"]:
        x, y, z = point["pos"]
        gaps.append(y - sample_grid(heights, size, segments, x, z))
    if not gaps:
        return

    worst = max(gaps, key=abs)
    if carve:
        # The carve blends back to the sculpt across the shoulder, so the
        # gradient it has to cover is what matters, not the gap itself.
        if abs(worst) > max(4.0, shoulder * 1.5):
            problems.append(
                f"Sculpted ground sits up to {abs(worst):.0f}m {'below' if worst > 0 else 'above'} "
                f"the road, and the carve has only {shoulder:.0f}m of shoulder to blend it. "
                "The road will sit in a trench — sculpt closer to the road's elevation, "
                "or raise 'Shoulder'."
            )
    elif abs(worst) > 2.0:
        problems.append(
            f"'Carve Road Into Terrain' is off but the sculpted ground is up to "
            f"{abs(worst):.0f}m from the road spline. Trucks spawn at road height, so "
            "they will start the race buried or falling. Sculpt the road bed to match "
            "the spline, or turn the carve back on."
        )
