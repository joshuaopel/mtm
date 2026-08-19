# SPDX-License-Identifier: MIT
"""
The vehicle colour atlas.

A modelled truck wants more than one colour, but a material per part means a
draw call per part. The period answer, and still the right one, is a single
texture of flat colours and a single material: each part's faces point at a
different cell.

Painting a part is therefore a UV operation, not a material one. Select faces,
click a swatch, and their UVs move onto that cell. That is the entire model,
and it means a truck with twenty colours still draws in one call.

These values mirror `src/core/Palette.ts` exactly. The engine generates its own
copy of the sheet at runtime and substitutes it for whatever a `.glb` ships
with, so this file only has to be right for what you see while modelling —
but a mismatch would still mean picking one colour and getting another, which
is why `tests/test_palette.py` pins the two together.
"""

MATERIAL_NAME = "MTM_Palette"
IMAGE_NAME = "MTM_Palette"

COLUMNS = 4
CELL_PIXELS = 16

# Deliberately desaturated: fully saturated paint reads as plastic against
# dithered dirt, and the renderer quantises to 16 levels per channel anyway.
# Two rows of bodywork, a row of neutrals, and a row of the materials every
# truck needs whatever its livery.
PALETTE = [
    ("Rust Red", "#a8412a"),
    ("Burnt Orange", "#c4692a"),
    ("Mustard", "#c9a03c"),
    ("Olive", "#7c8342"),
    ("Forest", "#40663c"),
    ("Teal", "#2f6b6b"),
    ("Steel Blue", "#3c6288"),
    ("Plum", "#6b4560"),
    ("Bone", "#d8d2c0"),
    ("Light Grey", "#a8a399"),
    ("Mid Grey", "#6e6a62"),
    ("Charcoal", "#3a3833"),
    ("Tyre Black", "#1a1a18"),
    ("Leather", "#6b4f32"),
    ("Chrome", "#b8bcc0"),
    ("Amber", "#e8a81c"),
]


def hex_to_rgb(value):
    """'#a8412a' -> (0.659, 0.255, 0.165), still in sRGB."""
    raw = value.lstrip("#")
    return tuple(int(raw[i : i + 2], 16) / 255.0 for i in (0, 2, 4))


def cell_uv(index):
    """
    Centre of a cell in Blender's UV space, whose V axis runs upward.

    Sampling the centre rather than an edge is what makes the atlas robust:
    no filtering, mip level or rounding error can reach a neighbouring colour.
    Cell 0 is the top-left of the sheet as you look at it, which is why V is
    inverted here — glTF measures V downward and Blender measures it up.
    """
    i = max(0, min(len(PALETTE) - 1, int(index)))
    column = i % COLUMNS
    row = i // COLUMNS
    return ((column + 0.5) / COLUMNS, 1.0 - (row + 0.5) / COLUMNS)


def srgb_to_linear(value):
    """
    Blender stores colours linearly and the palette is written in sRGB.

    Skipping this is the classic way to end up with a viewport that looks
    nothing like the game — every colour comes out washed out and pale.
    """
    if value <= 0.04045:
        return value / 12.92
    return ((value + 0.055) / 1.055) ** 2.4


def build_image():
    """(Re)build the atlas image datablock and return it."""
    import bpy

    size = COLUMNS * CELL_PIXELS
    image = bpy.data.images.get(IMAGE_NAME)
    if image is not None and (image.size[0] != size or image.size[1] != size):
        bpy.data.images.remove(image)
        image = None
    if image is None:
        image = bpy.data.images.new(IMAGE_NAME, width=size, height=size, alpha=False)

    # Blender's pixel buffer starts at the bottom-left, so row 0 of the palette
    # — the top row on screen — is written last.
    pixels = [0.0] * (size * size * 4)
    for y in range(size):
        row = COLUMNS - 1 - (y * COLUMNS) // size
        for x in range(size):
            column = (x * COLUMNS) // size
            colour = hex_to_rgb(PALETTE[row * COLUMNS + column][1])
            offset = (y * size + x) * 4
            pixels[offset] = srgb_to_linear(colour[0])
            pixels[offset + 1] = srgb_to_linear(colour[1])
            pixels[offset + 2] = srgb_to_linear(colour[2])
            pixels[offset + 3] = 1.0

    image.pixels = pixels
    image.pack()
    return image


def build_material():
    """(Re)build the palette material, wired to the atlas with no filtering."""
    import bpy

    image = build_image()
    material = bpy.data.materials.get(MATERIAL_NAME)
    if material is None:
        material = bpy.data.materials.new(MATERIAL_NAME)

    material.use_nodes = True
    tree = material.node_tree
    tree.nodes.clear()

    output = tree.nodes.new("ShaderNodeOutputMaterial")
    output.location = (300, 0)
    shader = tree.nodes.new("ShaderNodeBsdfPrincipled")
    shader.location = (0, 0)
    texture = tree.nodes.new("ShaderNodeTexImage")
    texture.location = (-320, 0)
    texture.image = image
    # Closest, or the viewport blurs 16 flat colours into a gradient.
    texture.interpolation = "Closest"

    tree.links.new(texture.outputs["Color"], shader.inputs["Base Color"])
    tree.links.new(shader.outputs["BSDF"], output.inputs["Surface"])

    # The game lights everything itself; a shiny preview is misleading.
    if "Roughness" in shader.inputs:
        shader.inputs["Roughness"].default_value = 0.9
    if "Specular IOR Level" in shader.inputs:
        shader.inputs["Specular IOR Level"].default_value = 0.1
    elif "Specular" in shader.inputs:
        shader.inputs["Specular"].default_value = 0.1

    return material


def assign_material(obj, material):
    """Make the palette the object's only material."""
    obj.data.materials.clear()
    obj.data.materials.append(material)


def ensure_uv_layer(mesh):
    if not mesh.uv_layers:
        mesh.uv_layers.new(name="UVMap")
    return mesh.uv_layers.active
