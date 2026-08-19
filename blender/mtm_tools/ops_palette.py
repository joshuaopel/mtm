# SPDX-License-Identifier: MIT
"""
Painting a modelled vehicle from the colour atlas.

Everything here is a UV operation. `Apply Palette` gives an object the shared
atlas material; a swatch button moves the selected faces onto that colour's
cell. Because it is all one material and one texture, a truck with sixteen
colours costs exactly what a truck with one colour costs.
"""

import bmesh
import bpy
from bpy.props import IntProperty
from bpy.types import Operator

from . import palette


class MTM_OT_apply_palette(Operator):
    """Give the selected objects the shared colour atlas material"""

    bl_idname = "mtm.apply_palette"
    bl_label = "Apply Palette Material"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        meshes = [o for o in context.selected_objects if o.type == "MESH"]
        if not meshes:
            self.report({"ERROR"}, "Select the mesh objects you want to paint.")
            return {"CANCELLED"}

        material = palette.build_material()
        for obj in meshes:
            palette.assign_material(obj, material)
            palette.ensure_uv_layer(obj.data)

        self.report(
            {"INFO"},
            f"Palette applied to {len(meshes)} object(s). Select faces in Edit "
            "Mode and click a colour.",
        )
        return {"FINISHED"}


class MTM_OT_paint_palette(Operator):
    """Move the selected faces onto this colour's cell in the atlas"""

    bl_idname = "mtm.paint_palette"
    bl_label = "Paint Palette Colour"
    bl_options = {"REGISTER", "UNDO"}

    index: IntProperty(name="Colour", default=0, min=0, max=len(palette.PALETTE) - 1)

    @classmethod
    def description(cls, context, properties):
        name, hexcode = palette.PALETTE[properties.index]
        return f"Paint the selected faces {name} ({hexcode})"

    def execute(self, context):
        u, v = palette.cell_uv(self.index)
        name = palette.PALETTE[self.index][0]

        objects = [o for o in context.selected_objects if o.type == "MESH"]
        active = context.object
        if active is not None and active.type == "MESH" and active not in objects:
            objects.append(active)
        if not objects:
            self.report({"ERROR"}, "Select a mesh first.")
            return {"CANCELLED"}

        editing = active is not None and active.mode == "EDIT"
        painted = 0
        skipped = []

        for obj in objects:
            mesh = obj.data
            if not mesh.materials or palette.MATERIAL_NAME not in [
                m.name for m in mesh.materials if m
            ]:
                skipped.append(obj.name)
                continue

            if editing:
                painted += self._paint_edit_mode(mesh, u, v)
            else:
                painted += self._paint_object_mode(mesh, u, v)

        if skipped:
            self.report(
                {"WARNING"},
                f"{', '.join(skipped)} has no palette material — press "
                "'Apply Palette Material' first.",
            )
            if painted == 0:
                return {"CANCELLED"}

        where = "selected faces" if editing else "every face"
        self.report({"INFO"}, f"Painted {painted} {where} {name}.")
        return {"FINISHED"}

    def _paint_edit_mode(self, mesh, u, v):
        """In Edit Mode only the selected faces move, which is the whole point."""
        bm = bmesh.from_edit_mesh(mesh)
        layer = bm.loops.layers.uv.active
        if layer is None:
            layer = bm.loops.layers.uv.new("UVMap")

        painted = 0
        for face in bm.faces:
            if not face.select:
                continue
            for loop in face.loops:
                loop[layer].uv = (u, v)
            painted += 1

        bmesh.update_edit_mesh(mesh)
        return painted

    def _paint_object_mode(self, mesh, u, v):
        layer = palette.ensure_uv_layer(mesh)
        for i in range(len(mesh.loops)):
            layer.data[i].uv = (u, v)
        return len(mesh.polygons)


class MTM_OT_refresh_palette(Operator):
    """Rebuild the atlas image and material from the current palette"""

    bl_idname = "mtm.refresh_palette"
    bl_label = "Refresh Palette"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        palette.build_material()
        self.report({"INFO"}, f"Rebuilt the {len(palette.PALETTE)}-colour atlas.")
        return {"FINISHED"}


_CLASSES = (MTM_OT_apply_palette, MTM_OT_paint_palette, MTM_OT_refresh_palette)


def register():
    for cls in _CLASSES:
        bpy.utils.register_class(cls)


def unregister():
    for cls in reversed(_CLASSES):
        bpy.utils.unregister_class(cls)
