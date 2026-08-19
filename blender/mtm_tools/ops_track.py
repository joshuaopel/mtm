# SPDX-License-Identifier: MIT
"""
Track authoring operators.

These are the tools you actually build a course with: laying out a road,
fencing it, dropping props along it, and setting up the start grid. They all
work on the tagged-object model in `props.py`, so anything they create can be
edited by hand afterwards like any other Blender object.
"""

import math

import bpy
from bpy.props import BoolProperty, EnumProperty, FloatProperty, IntProperty
from bpy.types import Operator
from mathutils import Vector

from .export_track import collect, curve_points
from .convert import resample_polyline
from .props import PROP_KINDS


def _tag(obj, role):
    obj.mtm.role = role
    return obj


def _road_object(context):
    roads = collect(context.scene, "ROAD")
    return roads[0] if roads else None


class MTM_OT_new_track(Operator):
    """Create a starter track: an oval road, a sun, and a terrain bounds box"""

    bl_idname = "mtm.new_track"
    bl_label = "New Track Scaffold"
    bl_options = {"REGISTER", "UNDO"}

    radius: FloatProperty(name="Radius", default=220.0, min=40.0, subtype="DISTANCE")
    points: IntProperty(name="Corner Points", default=12, min=4, max=64)
    preview: BoolProperty(
        name="Build Course Preview",
        default=True,
        description="Generate the terrain and road meshes so you can see the "
        "course while you edit it. They are display-only and never exported",
    )

    def execute(self, context):
        scene = context.scene

        curve_data = bpy.data.curves.new("MTM_Road", type="CURVE")
        curve_data.dimensions = "3D"
        # A smooth, evenly-sampled curve keeps the exported control points
        # tidy and the resulting racing line free of kinks.
        curve_data.resolution_u = 12

        spline = curve_data.splines.new("NURBS")
        spline.points.add(self.points - 1)
        for i in range(self.points):
            angle = (i / self.points) * math.tau
            # Slight radius variation so the starter track has some shape to
            # it rather than being a perfect circle.
            radius = self.radius * (1.0 + 0.08 * math.sin(angle * 2.0))
            spline.points[i].co = (
                math.sin(angle) * radius,
                math.cos(angle) * radius,
                0.0,
                1.0,
            )
        spline.use_cyclic_u = True
        spline.use_endpoint_u = True
        spline.order_u = 4

        road = bpy.data.objects.new("MTM_Road", curve_data)
        scene.collection.objects.link(road)
        _tag(road, "ROAD")

        bounds = bpy.data.objects.new("MTM_TerrainBounds", None)
        bounds.empty_display_type = "CUBE"
        bounds.empty_display_size = self.radius * 1.6
        scene.collection.objects.link(bounds)
        _tag(bounds, "TERRAIN")

        if not any(o.type == "LIGHT" and o.data.type == "SUN" for o in scene.objects):
            sun_data = bpy.data.lights.new("MTM_Sun", type="SUN")
            sun = bpy.data.objects.new("MTM_Sun", sun_data)
            sun.location = (0.0, 0.0, 120.0)
            sun.rotation_euler = (math.radians(50.0), 0.0, math.radians(30.0))
            scene.collection.objects.link(sun)

        scene.mtm_track.terrain_size = self.radius * 3.2

        for obj in context.selected_objects:
            obj.select_set(False)
        road.select_set(True)
        context.view_layer.objects.active = road

        if self.preview:
            # The road curve alone tells you nothing about the ground under
            # it, so the scaffold builds the preview once. Rebuild it from the
            # Course Preview panel after you move the curve.
            # The preview tessellates the curve through the depsgraph, which
            # has not seen the object we just linked until the view layer
            # catches up.
            context.view_layer.update()
            bpy.ops.mtm.build_preview()

        self.report({"INFO"}, "Created a starter track. Edit MTM_Road to shape the course.")
        return {"FINISHED"}


class MTM_OT_tag_objects(Operator):
    """Assign an MTM role to every selected object"""

    bl_idname = "mtm.tag_objects"
    bl_label = "Tag Selected"
    bl_options = {"REGISTER", "UNDO"}

    role: EnumProperty(
        name="Role",
        items=[
            ("ROAD", "Road Spline", ""),
            ("TERRAIN", "Terrain", ""),
            ("WALL", "Blocker Wall", ""),
            ("PROP", "Prop", ""),
            ("SPAWN", "Spawn Point", ""),
            ("CHECKPOINT", "Checkpoint", ""),
            ("FEATURE", "Terrain Feature", ""),
            ("NONE", "None", ""),
        ],
        default="WALL",
    )

    def execute(self, context):
        selected = context.selected_objects
        if not selected:
            self.report({"WARNING"}, "Nothing selected.")
            return {"CANCELLED"}

        for index, obj in enumerate(selected):
            obj.mtm.role = self.role
            # Sequential ordering saves hand-numbering a grid or a gate run.
            if self.role == "SPAWN":
                obj.mtm.spawn_order = index
            elif self.role == "CHECKPOINT":
                obj.mtm.checkpoint_order = index

        self.report({"INFO"}, f"Tagged {len(selected)} object(s) as {self.role}.")
        return {"FINISHED"}


class MTM_OT_build_start_grid(Operator):
    """Create a staggered start grid behind the start/finish line"""

    bl_idname = "mtm.build_start_grid"
    bl_label = "Build Start Grid"
    bl_options = {"REGISTER", "UNDO"}

    slots: IntProperty(name="Slots", default=6, min=1, max=24)
    row_spacing: FloatProperty(name="Row Spacing", default=9.0, min=3.0, subtype="DISTANCE")
    column_spacing: FloatProperty(name="Column Spacing", default=4.5, min=1.0, subtype="DISTANCE")
    clear_existing: BoolProperty(name="Replace Existing", default=True)

    def execute(self, context):
        scene = context.scene
        road = _road_object(context)
        if road is None:
            self.report({"ERROR"}, "No road spline in the scene — create or tag one first.")
            return {"CANCELLED"}

        points = curve_points(context.evaluated_depsgraph_get(), road)
        if len(points) < 3:
            self.report({"ERROR"}, "Road curve has too few points.")
            return {"CANCELLED"}

        if self.clear_existing:
            for obj in collect(scene, "SPAWN"):
                bpy.data.objects.remove(obj, do_unlink=True)

        # Walk backwards from the start of the spline, which is where the
        # start/finish line sits.
        sampled = resample_polyline(points, 1.0)
        count = len(sampled)
        up = Vector((0.0, 0.0, 1.0))

        for slot in range(self.slots):
            row = slot // 2
            column = -1 if slot % 2 == 0 else 1

            back = int(self.row_spacing * (row + 1))
            index = (-back) % count
            position = sampled[index]

            ahead = sampled[(index + 2) % count]
            tangent = (ahead - position)
            if tangent.length < 1e-5:
                tangent = Vector((1.0, 0.0, 0.0))
            tangent.normalize()
            right = tangent.cross(up).normalized()

            empty = bpy.data.objects.new(f"MTM_Spawn_{slot:02d}", None)
            empty.empty_display_type = "SINGLE_ARROW"
            empty.empty_display_size = 3.0
            empty.location = position + right * (column * self.column_spacing) + up * 1.6
            # Point the empty's +Y (Blender forward) down the track.
            empty.rotation_euler = (0.0, 0.0, math.atan2(tangent.y, tangent.x) - math.pi / 2)
            scene.collection.objects.link(empty)
            _tag(empty, "SPAWN")
            empty.mtm.spawn_order = slot

        self.report({"INFO"}, f"Built a {self.slots}-slot start grid.")
        return {"FINISHED"}


class MTM_OT_place_checkpoints(Operator):
    """Place evenly spaced checkpoint gates around the road"""

    bl_idname = "mtm.place_checkpoints"
    bl_label = "Place Checkpoints"
    bl_options = {"REGISTER", "UNDO"}

    spacing: FloatProperty(name="Spacing", default=70.0, min=10.0, subtype="DISTANCE")
    width: FloatProperty(name="Gate Width", default=0.0, min=0.0, subtype="DISTANCE")
    clear_existing: BoolProperty(name="Replace Existing", default=True)

    def execute(self, context):
        scene = context.scene
        road = _road_object(context)
        if road is None:
            self.report({"ERROR"}, "No road spline in the scene.")
            return {"CANCELLED"}

        points = curve_points(context.evaluated_depsgraph_get(), road)
        if len(points) < 3:
            self.report({"ERROR"}, "Road curve has too few points.")
            return {"CANCELLED"}

        if self.clear_existing:
            for obj in collect(scene, "CHECKPOINT"):
                bpy.data.objects.remove(obj, do_unlink=True)

        # Default gate width scales with the road: generous enough that a wide
        # line still registers.
        width = self.width if self.width > 0 else scene.mtm_track.road_width * 2.2
        sampled = resample_polyline(points, self.spacing)

        for order, position in enumerate(sampled):
            ahead = sampled[(order + 1) % len(sampled)]
            tangent = ahead - position
            if tangent.length < 1e-5:
                continue
            tangent.normalize()

            empty = bpy.data.objects.new(f"MTM_Gate_{order:02d}", None)
            empty.empty_display_type = "SINGLE_ARROW"
            empty.empty_display_size = width * 0.5
            empty.location = position + Vector((0.0, 0.0, 1.0))
            empty.rotation_euler = (0.0, 0.0, math.atan2(tangent.y, tangent.x) - math.pi / 2)
            scene.collection.objects.link(empty)
            _tag(empty, "CHECKPOINT")
            empty.mtm.checkpoint_order = order
            empty.mtm.checkpoint_width = width

        self.report({"INFO"}, f"Placed {len(sampled)} checkpoints.")
        return {"FINISHED"}


class MTM_OT_generate_barriers(Operator):
    """Create blocker wall objects along both edges of the road"""

    bl_idname = "mtm.generate_barriers"
    bl_label = "Generate Barrier Walls"
    bl_options = {"REGISTER", "UNDO"}

    spacing: FloatProperty(name="Spacing", default=12.0, min=2.0, subtype="DISTANCE")
    height: FloatProperty(name="Height", default=1.6, min=0.2, subtype="DISTANCE")
    thickness: FloatProperty(name="Thickness", default=0.8, min=0.1, subtype="DISTANCE")
    offset: FloatProperty(name="Offset From Edge", default=2.5, min=0.0, subtype="DISTANCE")
    sides: EnumProperty(
        name="Sides",
        items=[("BOTH", "Both", ""), ("LEFT", "Left", ""), ("RIGHT", "Right", "")],
        default="BOTH",
    )
    clear_existing: BoolProperty(name="Replace Generated", default=True)

    def execute(self, context):
        scene = context.scene
        road = _road_object(context)
        if road is None:
            self.report({"ERROR"}, "No road spline in the scene.")
            return {"CANCELLED"}

        points = curve_points(context.evaluated_depsgraph_get(), road)
        if len(points) < 3:
            self.report({"ERROR"}, "Road curve has too few points.")
            return {"CANCELLED"}

        if self.clear_existing:
            for obj in list(scene.objects):
                if obj.name.startswith("MTM_Barrier_"):
                    bpy.data.objects.remove(obj, do_unlink=True)

        sides = []
        if self.sides in ("BOTH", "LEFT"):
            sides.append(-1)
        if self.sides in ("BOTH", "RIGHT"):
            sides.append(1)

        lateral = scene.mtm_track.road_width * 0.5 + self.offset + self.thickness * 0.5
        sampled = resample_polyline(points, self.spacing)
        up = Vector((0.0, 0.0, 1.0))
        created = 0

        # One shared mesh, instanced per segment: a fenced circuit is hundreds
        # of boxes and duplicating the mesh data for each would bloat the file.
        mesh = bpy.data.meshes.new("MTM_BarrierSegment")
        bpy.ops.object.select_all(action="DESELECT")
        bm_verts = [
            (-0.5, -0.5, -0.5), (0.5, -0.5, -0.5), (0.5, 0.5, -0.5), (-0.5, 0.5, -0.5),
            (-0.5, -0.5, 0.5), (0.5, -0.5, 0.5), (0.5, 0.5, 0.5), (-0.5, 0.5, 0.5),
        ]
        bm_faces = [
            (0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1),
            (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0),
        ]
        mesh.from_pydata(bm_verts, [], bm_faces)
        mesh.update()

        for index, position in enumerate(sampled):
            ahead = sampled[(index + 1) % len(sampled)]
            tangent = ahead - position
            if tangent.length < 1e-5:
                continue
            tangent.normalize()
            right = tangent.cross(up).normalized()

            for side in sides:
                obj = bpy.data.objects.new(f"MTM_Barrier_{index:03d}_{side}", mesh)
                obj.location = (
                    position + right * (side * lateral) + up * (self.height * 0.5 - 0.25)
                )
                obj.rotation_euler = (0.0, 0.0, math.atan2(tangent.y, tangent.x))
                # Local X is thickness, local Y runs along the road, Z is up.
                obj.scale = (self.thickness, self.spacing * 1.12, self.height)
                scene.collection.objects.link(obj)
                _tag(obj, "WALL")
                obj.mtm.wall_material = scene.mtm_track.barrier_material
                created += 1

        # These are explicit objects now, so turn off the runtime generator to
        # avoid fencing the course twice.
        scene.mtm_track.barriers_enabled = False

        self.report(
            {"INFO"},
            f"Created {created} barrier walls and disabled auto-barriers to avoid duplicates.",
        )
        return {"FINISHED"}


class MTM_OT_scatter_props(Operator):
    """Scatter props along the sides of the road"""

    bl_idname = "mtm.scatter_props"
    bl_label = "Scatter Props"
    bl_options = {"REGISTER", "UNDO"}

    kind: EnumProperty(name="Kind", items=PROP_KINDS, default="tree")
    count: IntProperty(name="Count", default=60, min=1, max=2000)
    min_distance: FloatProperty(name="Min From Road", default=18.0, min=0.0, subtype="DISTANCE")
    max_distance: FloatProperty(name="Max From Road", default=70.0, min=1.0, subtype="DISTANCE")
    solid: BoolProperty(name="Solid", default=True)
    seed: IntProperty(name="Seed", default=1)

    def execute(self, context):
        import random

        scene = context.scene
        road = _road_object(context)
        if road is None:
            self.report({"ERROR"}, "No road spline in the scene.")
            return {"CANCELLED"}

        if self.max_distance <= self.min_distance:
            self.report({"ERROR"}, "'Max From Road' must be greater than 'Min From Road'.")
            return {"CANCELLED"}

        points = curve_points(context.evaluated_depsgraph_get(), road)
        if len(points) < 3:
            self.report({"ERROR"}, "Road curve has too few points.")
            return {"CANCELLED"}

        sampled = resample_polyline(points, 4.0)
        rng = random.Random(self.seed)
        up = Vector((0.0, 0.0, 1.0))

        for i in range(self.count):
            index = rng.randrange(len(sampled))
            position = sampled[index]
            ahead = sampled[(index + 1) % len(sampled)]
            tangent = ahead - position
            if tangent.length < 1e-5:
                continue
            tangent.normalize()
            right = tangent.cross(up).normalized()

            side = rng.choice((-1.0, 1.0))
            distance = rng.uniform(self.min_distance, self.max_distance)

            empty = bpy.data.objects.new(f"MTM_Prop_{self.kind}_{i:03d}", None)
            empty.empty_display_type = "PLAIN_AXES"
            empty.empty_display_size = 2.0
            empty.location = position + right * (side * distance)
            empty.rotation_euler = (0.0, 0.0, rng.uniform(0.0, math.tau))
            scale = rng.uniform(0.8, 1.4)
            empty.scale = (scale, scale, scale)
            scene.collection.objects.link(empty)
            _tag(empty, "PROP")
            empty.mtm.prop_kind = self.kind
            empty.mtm.prop_solid = self.solid

        self.report({"INFO"}, f"Scattered {self.count} {self.kind}(s) beside the road.")
        return {"FINISHED"}


class MTM_OT_select_role(Operator):
    """Select every object with a given role"""

    bl_idname = "mtm.select_role"
    bl_label = "Select By Role"
    bl_options = {"REGISTER", "UNDO"}

    role: EnumProperty(
        name="Role",
        items=[
            ("ROAD", "Road Spline", ""),
            ("TERRAIN", "Terrain", ""),
            ("WALL", "Blocker Wall", ""),
            ("PROP", "Prop", ""),
            ("SPAWN", "Spawn Point", ""),
            ("CHECKPOINT", "Checkpoint", ""),
            ("FEATURE", "Terrain Feature", ""),
        ],
        default="WALL",
    )

    def execute(self, context):
        for obj in context.selected_objects:
            obj.select_set(False)
        matches = collect(context.scene, self.role)
        for obj in matches:
            obj.select_set(True)
        if matches:
            context.view_layer.objects.active = matches[0]
        self.report({"INFO"}, f"Selected {len(matches)} {self.role} object(s).")
        return {"FINISHED"}


_CLASSES = (
    MTM_OT_new_track,
    MTM_OT_tag_objects,
    MTM_OT_build_start_grid,
    MTM_OT_place_checkpoints,
    MTM_OT_generate_barriers,
    MTM_OT_scatter_props,
    MTM_OT_select_role,
)


def register():
    for cls in _CLASSES:
        bpy.utils.register_class(cls)


def unregister():
    for cls in reversed(_CLASSES):
        bpy.utils.unregister_class(cls)
