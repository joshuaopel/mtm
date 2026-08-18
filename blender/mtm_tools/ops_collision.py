# SPDX-License-Identifier: MIT
"""
Collider authoring operators.

Tools for wrapping visual geometry in collision the physics engine can
actually resolve, and for seeing what you've built.
"""

import bpy
from bpy.props import BoolProperty, EnumProperty, FloatProperty
from bpy.types import Operator
from mathutils import Vector

from .collision import CONVEX_TOLERANCE, convexity_report, triangulated_faces
from .export_track import collect

COLLIDER_COLLECTION = "MTM_Colliders"

# Viewport colours by role, so a tagged scene is readable at a glance.
ROLE_COLOURS = {
    "COLLIDER": (1.0, 0.35, 0.1, 1.0),
    "WALL": (1.0, 0.7, 0.1, 1.0),
    "SCENERY": (0.45, 0.75, 1.0, 1.0),
    "PROP": (0.5, 1.0, 0.5, 1.0),
    "CHECKPOINT": (1.0, 1.0, 0.3, 1.0),
    "SPAWN": (0.4, 1.0, 0.9, 1.0),
    "FEATURE": (0.8, 0.4, 1.0, 1.0),
    "TERRAIN": (0.6, 0.6, 0.6, 1.0),
    "ROAD": (1.0, 1.0, 1.0, 1.0),
}


def _collider_collection(scene):
    collection = bpy.data.collections.get(COLLIDER_COLLECTION)
    if collection is None:
        collection = bpy.data.collections.new(COLLIDER_COLLECTION)
        scene.collection.children.link(collection)
    return collection


class MTM_OT_collider_from_selection(Operator):
    """Wrap each selected object in a collider"""

    bl_idname = "mtm.collider_from_selection"
    bl_label = "Collider From Selection"
    bl_options = {"REGISTER", "UNDO"}

    shape: EnumProperty(
        name="Shape",
        items=[
            ("box", "Box", "Oriented bounding box — cheapest and most predictable"),
            ("convex", "Convex Hull", "Copy the mesh; it must already be convex"),
        ],
        default="box",
    )
    shrink: FloatProperty(
        name="Inset",
        default=0.0,
        min=0.0,
        subtype="DISTANCE",
        description="Pull the collider in from the visual surface by this much",
    )
    keep_visual: BoolProperty(
        name="Keep Original Visible",
        default=True,
        description="Leave the source object in place as scenery",
    )

    def execute(self, context):
        scene = context.scene
        sources = [o for o in context.selected_objects if o.type == "MESH"]
        if not sources:
            self.report({"WARNING"}, "Select at least one mesh object.")
            return {"CANCELLED"}

        collection = _collider_collection(scene)
        made = 0

        for source in sources:
            if self.shape == "box":
                collider = self._box_collider(source, collection)
            else:
                collider = self._convex_collider(source, collection)
            if collider is None:
                continue

            collider.mtm.role = "COLLIDER"
            collider.mtm.collider_shape = self.shape
            collider.display_type = "WIRE"
            collider.color = ROLE_COLOURS["COLLIDER"]
            # Colliders are invisible in game; hiding them from renders here
            # keeps them out of the scenery glTF export too.
            collider.hide_render = True
            made += 1

            if self.keep_visual and source.mtm.role == "NONE":
                source.mtm.role = "SCENERY"

        self.report({"INFO"}, f"Created {made} collider(s).")
        return {"FINISHED"}

    def _box_collider(self, source, collection):
        corners = [Vector(c) for c in source.bound_box]
        minimum = Vector((min(c[i] for c in corners) for i in range(3)))
        maximum = Vector((max(c[i] for c in corners) for i in range(3)))
        size = maximum - minimum
        centre = (minimum + maximum) * 0.5

        inset = self.shrink
        half = Vector(
            (
                max(0.01, size.x * 0.5 - inset),
                max(0.01, size.y * 0.5 - inset),
                max(0.01, size.z * 0.5 - inset),
            )
        )

        mesh = bpy.data.meshes.new(f"{source.name}_ColliderMesh")
        verts = [
            (-half.x, -half.y, -half.z), (half.x, -half.y, -half.z),
            (half.x, half.y, -half.z), (-half.x, half.y, -half.z),
            (-half.x, -half.y, half.z), (half.x, -half.y, half.z),
            (half.x, half.y, half.z), (-half.x, half.y, half.z),
        ]
        faces = [
            (0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1),
            (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0),
        ]
        mesh.from_pydata(verts, [], faces)
        mesh.update()

        collider = bpy.data.objects.new(f"{source.name}_Collider", mesh)
        # Inherit the source transform so the box tracks it if it is moved.
        collider.matrix_world = source.matrix_world.copy()
        collider.location = source.matrix_world @ centre
        collection.objects.link(collider)
        return collider

    def _convex_collider(self, source, collection):
        mesh = source.data.copy()
        collider = bpy.data.objects.new(f"{source.name}_Collider", mesh)
        collider.matrix_world = source.matrix_world.copy()
        collection.objects.link(collider)
        return collider


class MTM_OT_check_colliders(Operator):
    """Check every collider is something the physics engine can resolve"""

    bl_idname = "mtm.check_colliders"
    bl_label = "Check Colliders"
    bl_options = {"REGISTER"}

    def execute(self, context):
        colliders = collect(context.scene, "COLLIDER")
        if not colliders:
            self.report({"INFO"}, "No colliders in the scene.")
            return {"FINISHED"}

        depsgraph = context.evaluated_depsgraph_get()
        concave = 0
        checked = 0

        for obj in colliders:
            if obj.mtm.collider_shape != "convex":
                continue
            if obj.type != "MESH":
                self.report({"ERROR"}, f"'{obj.name}' is convex but not a mesh.")
                concave += 1
                continue

            evaluated = obj.evaluated_get(depsgraph)
            mesh = None
            try:
                mesh = evaluated.to_mesh()
                if mesh is None:
                    continue
                verts = [v.co.copy() for v in mesh.vertices]
                faces = triangulated_faces(mesh)
                excursion = convexity_report(verts, faces)
                checked += 1
                if excursion > CONVEX_TOLERANCE:
                    concave += 1
                    self.report(
                        {"ERROR"},
                        f"'{obj.name}' is concave by {excursion:.3f}m — split it into "
                        "convex pieces or switch it to a Box collider.",
                    )
            finally:
                if mesh is not None:
                    evaluated.to_mesh_clear()

        if concave == 0:
            self.report(
                {"INFO"},
                f"{len(colliders)} collider(s), {checked} convex hull(s) — all valid.",
            )
        return {"FINISHED"}


class MTM_OT_colour_by_role(Operator):
    """Colour every tagged object by its role, for viewport readability"""

    bl_idname = "mtm.colour_by_role"
    bl_label = "Colour By Role"
    bl_options = {"REGISTER", "UNDO"}

    wireframe_colliders: BoolProperty(name="Wireframe Colliders", default=True)

    def execute(self, context):
        touched = 0
        for obj in context.scene.objects:
            role = getattr(obj, "mtm", None) and obj.mtm.role
            if not role or role == "NONE":
                continue
            colour = ROLE_COLOURS.get(role)
            if colour:
                obj.color = colour
                touched += 1
            if role == "COLLIDER" and self.wireframe_colliders:
                obj.display_type = "WIRE"

        # Object colours only show in solid shading when the viewport is told
        # to use them, so switch that on rather than leaving the user
        # wondering why nothing changed.
        for area in context.screen.areas:
            if area.type != "VIEW_3D":
                continue
            for space in area.spaces:
                if space.type == "VIEW_3D":
                    space.shading.color_type = "OBJECT"

        self.report({"INFO"}, f"Coloured {touched} tagged object(s) by role.")
        return {"FINISHED"}


class MTM_OT_select_untagged(Operator):
    """Select mesh objects that have no MTM role yet"""

    bl_idname = "mtm.select_untagged"
    bl_label = "Select Untagged Meshes"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        for obj in context.selected_objects:
            obj.select_set(False)

        untagged = [
            o for o in context.scene.objects if o.type == "MESH" and o.mtm.role == "NONE"
        ]
        for obj in untagged:
            obj.select_set(True)
        if untagged:
            context.view_layer.objects.active = untagged[0]

        self.report(
            {"INFO"},
            f"{len(untagged)} untagged mesh(es) — these will not be exported.",
        )
        return {"FINISHED"}


_CLASSES = (
    MTM_OT_collider_from_selection,
    MTM_OT_check_colliders,
    MTM_OT_colour_by_role,
    MTM_OT_select_untagged,
)


def register():
    for cls in _CLASSES:
        bpy.utils.register_class(cls)


def unregister():
    for cls in reversed(_CLASSES):
        bpy.utils.unregister_class(cls)
