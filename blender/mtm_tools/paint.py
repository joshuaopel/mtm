# SPDX-License-Identifier: MIT
"""
Terrain painting.

The game blends up to four ground textures across the terrain from a weight
per vertex. Those weights are authored here by vertex-painting the terrain
mesh: red, green and blue each drive one layer, and unpainted ground is the
base layer. Painting in pure channels is not a limitation to work around, it
is the whole interface — "paint red where you want rock" is the entire mental
model, and it needs no UV unwrap, no image to manage, and no second editor.

The alternative was a splat image the author paints in texture-paint mode.
That needs UVs on a mesh they are also sculpting, and it puts the weights in
a file that can go missing from the track. Vertex colours travel in the
.blend and bake straight onto the game's own grid.
"""

from mathutils.interpolate import poly_3d_calc

ATTRIBUTE = "MTM_Paint"

# Which channel drives which layer. Layer 0 is what shows through where
# nothing is painted, so it has no channel of its own.
LAYER_COLOURS = (
    ("Base", (0.0, 0.0, 0.0, 1.0), "Unpainted ground — the base layer"),
    ("Layer 1", (1.0, 0.0, 0.0, 1.0), "Red channel"),
    ("Layer 2", (0.0, 1.0, 0.0, 1.0), "Green channel"),
    ("Layer 3", (0.0, 0.0, 1.0, 1.0), "Blue channel"),
)


def find_attribute(mesh):
    """The paint attribute on a mesh, or None."""
    return mesh.color_attributes.get(ATTRIBUTE)


def ensure_attribute(mesh):
    """
    Create the paint attribute if it is missing, and make it active.

    Point domain rather than corner: the terrain is a continuous surface with
    no material seams, so per-corner colour would only cost memory and make
    the bake pick between two values at every vertex.
    """
    layer = find_attribute(mesh)
    if layer is None:
        layer = mesh.color_attributes.new(name=ATTRIBUTE, type="FLOAT_COLOR", domain="POINT")
        for entry in layer.data:
            entry.color = (0.0, 0.0, 0.0, 1.0)

    mesh.color_attributes.active_color = layer
    if hasattr(mesh.color_attributes, "render_color_index"):
        mesh.color_attributes.render_color_index = mesh.color_attributes.find(ATTRIBUTE)
    return layer


def sample_colour(mesh, layer, point, polygon):
    """
    Interpolate the painted colour across a face at a point inside it.

    Nearest-vertex would be cheaper but bakes visible facets into the blend at
    the grid resolution, which is exactly where a painted edge is most obvious.
    """
    corners = [mesh.vertices[i].co for i in polygon.vertices]
    weights = poly_3d_calc(corners, point)

    corner_domain = layer.domain == "CORNER"
    indices = polygon.loop_indices if corner_domain else polygon.vertices

    r = g = b = 0.0
    for weight, index in zip(weights, indices):
        colour = layer.data[index].color
        r += colour[0] * weight
        g += colour[1] * weight
        b += colour[2] * weight
    return r, g, b


def clamp_byte(value):
    return 0 if value < 0 else 255 if value > 1 else int(value * 255 + 0.5)


def is_blank(packed):
    """True when nothing was painted, so the weights are not worth shipping."""
    return not any(packed)
