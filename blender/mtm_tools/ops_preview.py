# SPDX-License-Identifier: MIT
"""
Course preview.

The runtime generates terrain from noise plus features, and lofts the road
ribbon along the spline at load time. Neither exists as geometry in the .blend,
which meant authoring a track was editing a curve in empty space and finding
out what you had made only after exporting and driving it.

These operators build both as real Blender meshes using the same generation
code the game runs (`generate.py`, verified against the TypeScript), so what
you see here is the ground you will drive on. The meshes are display-only:
they carry no MTM role, so the exporter ignores them, and they are rebuilt
from scratch every time.
"""

import bpy
from bpy.props import BoolProperty, IntProperty
from bpy.types import Operator
from mathutils import Vector

from .convert import convert_position, resample_polyline
from .export_track import build_features, collect, curve_points, terrain_size
from .generate import RoadSamples, generate_heights, road_polyline
from .heightmap import RAY_HEIGHT

PREVIEW_COLLECTION = "MTM_Preview"
TERRAIN_NAME = "MTM_Preview_Terrain"
ROAD_NAME = "MTM_Preview_Road"


def clear_preview():
    collection = bpy.data.collections.get(PREVIEW_COLLECTION)
    if collection is None:
        return
    for obj in list(collection.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.collections.remove(collection)


def _preview_collection(scene):
    collection = bpy.data.collections.get(PREVIEW_COLLECTION)
    if collection is None:
        collection = bpy.data.collections.new(PREVIEW_COLLECTION)
        scene.collection.children.link(collection)
    return collection


def _game_to_blender(x, y, z):
    """Inverse of `convert_position`: game (x, y, z) -> Blender (x, -z, y)."""
    return (x, -z, y)


def road_in_game_space(context, problems):
    """
    The road centreline, resampled the way the runtime will resample it.

    Returns (points, step, length) in game space, or None. Runs the export
    path first so the preview is built from exactly the data that would be
    written to the track file.
    """
    scene = context.scene
    roads = collect(scene, "ROAD")
    if not roads:
        problems.append("No object has the 'Road Spline' role.")
        return None
    if roads[0].type != "CURVE":
        problems.append(f"'{roads[0].name}' is marked as the road but is not a curve.")
        return None

    tessellated = curve_points(context.evaluated_depsgraph_get(), roads[0])
    if len(tessellated) < 3:
        problems.append("Road curve has too few points.")
        return None

    settings = scene.mtm_track
    # Match the exporter: resample the curve, then re-spline those points the
    # way the game does. Previewing the raw curve instead would hide the
    # smoothing the game applies.
    exported = resample_polyline(tessellated, settings.road_spacing)
    control = [tuple(convert_position(p)) for p in exported]
    if len(control) < 3:
        problems.append("Road resampled to fewer than 3 points; reduce 'Point Spacing'.")
        return None

    return road_polyline(control, settings.road_closed)


class MTM_OT_build_preview(Operator):
    """Generate the terrain and road surface the game will build"""

    bl_idname = "mtm.build_preview"
    bl_label = "Build Course Preview"
    bl_options = {"REGISTER", "UNDO"}

    resolution: IntProperty(
        name="Preview Resolution",
        default=96,
        min=32,
        max=256,
        description="Grid resolution for the preview mesh only. The exported "
        "track uses the terrain 'Segments' setting; this is just what Blender "
        "has to draw, and a full-resolution grid is slow to work with",
    )
    shade_smooth: BoolProperty(name="Smooth Shading", default=False)

    def execute(self, context):
        scene = context.scene
        settings = scene.mtm_track
        problems = []

        road = road_in_game_space(context, problems)
        if road is None:
            for problem in problems:
                self.report({"ERROR"}, problem)
            return {"CANCELLED"}

        road_points, step, length = road

        clear_preview()
        collection = _preview_collection(scene)
        self._build_road_mesh(collection, road_points, settings)

        # With a sculpted terrain the ground is already in the scene — the
        # author's own mesh — so generating one on top of it would bury the
        # thing they are editing under a second surface.
        if settings.terrain_source == "sculpted":
            self.report(
                {"INFO"},
                f"Road preview built: {length:.0f}m ({len(road_points)} samples). "
                "Terrain is your own sculpted mesh, so none was generated.",
            )
            return {"FINISHED"}

        # Terrain size follows the same rule the exporter uses, so the preview
        # covers exactly the patch the game will generate.
        fake_road = {"points": [{"pos": list(p)} for p in road_points]}
        size = terrain_size(scene, fake_road)

        terrain = {
            "size": size,
            "segments": int(settings.terrain_segments),
            "amplitude": settings.terrain_amplitude,
            "frequency": settings.terrain_frequency,
            "seed": int(settings.terrain_seed),
            "features": build_features(scene),
        }

        samples = RoadSamples(road_points, settings.road_width, settings.road_shoulder, step)
        n = int(self.resolution)
        heights = generate_heights(terrain, samples, segments=n)
        self._build_terrain_mesh(collection, size, n, heights)

        self.report(
            {"INFO"},
            f"Preview built: {size:.0f}m terrain at {n}x{n}, road {length:.0f}m "
            f"({len(road_points)} samples), {len(terrain['features'])} feature(s). "
            "Preview objects are not exported.",
        )
        return {"FINISHED"}

    def _build_terrain_mesh(self, collection, size, n, heights):
        element = size / n
        verts = []
        for iz in range(n + 1):
            for ix in range(n + 1):
                gx = -size / 2 + ix * element
                gz = -size / 2 + iz * element
                verts.append(_game_to_blender(gx, heights[iz * (n + 1) + ix], gz))

        faces = []
        for iz in range(n):
            for ix in range(n):
                a = iz * (n + 1) + ix
                b = a + 1
                c = a + (n + 1) + 1
                d = a + (n + 1)
                faces.append((a, b, c, d))

        mesh = bpy.data.meshes.new(TERRAIN_NAME)
        mesh.from_pydata(verts, [], faces)
        mesh.update()
        if self.shade_smooth:
            for polygon in mesh.polygons:
                polygon.use_smooth = True

        obj = bpy.data.objects.new(TERRAIN_NAME, mesh)
        obj.color = (0.45, 0.38, 0.28, 1.0)
        # Not selectable: it is a backdrop, and clicking through to the things
        # you are actually placing matters more than being able to grab it.
        obj.hide_select = True
        collection.objects.link(obj)

    def _build_road_mesh(self, collection, points, settings):
        half = settings.road_width * 0.5
        closed = settings.road_closed
        count = len(points)
        up = Vector((0.0, 1.0, 0.0))  # game-space up

        verts = []
        for i in range(count):
            current = Vector(points[i])
            nxt = Vector(points[(i + 1) % count]) if closed else Vector(points[min(i + 1, count - 1)])
            prev = Vector(points[(i - 1) % count]) if closed else Vector(points[max(i - 1, 0)])

            tangent = (nxt - prev)
            if tangent.length < 1e-6:
                tangent = Vector((0.0, 0.0, 1.0))
            tangent.normalize()
            right = tangent.cross(up)
            if right.length < 1e-6:
                right = Vector((1.0, 0.0, 0.0))
            right.normalize()

            # Lifted slightly, exactly as the runtime lifts the ribbon clear
            # of the terrain to avoid z-fighting.
            left_edge = current - right * half
            right_edge = current + right * half
            verts.append(_game_to_blender(left_edge.x, left_edge.y + 0.08, left_edge.z))
            verts.append(_game_to_blender(right_edge.x, right_edge.y + 0.08, right_edge.z))

        faces = []
        segments = count if closed else count - 1
        for i in range(segments):
            a = i * 2
            b = a + 1
            nxt = ((i + 1) % count) * 2
            faces.append((a, nxt, nxt + 1, b))

        mesh = bpy.data.meshes.new(ROAD_NAME)
        mesh.from_pydata(verts, [], faces)
        mesh.update()

        obj = bpy.data.objects.new(ROAD_NAME, mesh)
        obj.color = (0.75, 0.6, 0.35, 1.0)
        obj.hide_select = True
        collection.objects.link(obj)


class MTM_OT_clear_preview(Operator):
    """Delete the course preview meshes"""

    bl_idname = "mtm.clear_preview"
    bl_label = "Clear Preview"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        clear_preview()
        self.report({"INFO"}, "Preview removed.")
        return {"FINISHED"}


class MTM_OT_drop_to_terrain(Operator):
    """Drop the selected objects onto the terrain surface"""

    bl_idname = "mtm.drop_to_terrain"
    bl_label = "Drop To Terrain"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        # Whichever mesh is the ground: the generated preview, or the author's
        # own terrain when they are sculpting one.
        terrain = bpy.data.objects.get(TERRAIN_NAME)
        if terrain is None:
            sculpted = [o for o in collect(context.scene, "TERRAIN") if o.type == "MESH"]
            terrain = sculpted[0] if sculpted else None
        if terrain is None:
            self.report(
                {"ERROR"},
                "No ground to drop onto. Build the course preview, or give a "
                "mesh the Terrain role.",
            )
            return {"CANCELLED"}

        selected = [o for o in context.selected_objects if o is not terrain]
        if not selected:
            self.report({"WARNING"}, "Nothing selected.")
            return {"CANCELLED"}

        # Evaluated, so a sculpted terrain carrying a subdivision or multires
        # modifier is sampled at the shape the author sees.
        evaluated = terrain.evaluated_get(context.evaluated_depsgraph_get())
        matrix = evaluated.matrix_world
        inverse = matrix.inverted()
        direction = (inverse.to_3x3() @ Vector((0.0, 0.0, -1.0))).normalized()

        moved = 0
        for obj in selected:
            origin = obj.matrix_world.translation.copy()
            # Cast from well above, straight down, in the terrain's local space.
            start = inverse @ Vector((origin.x, origin.y, RAY_HEIGHT))
            hit, location, _, _ = evaluated.ray_cast(start, direction)
            if not hit:
                continue
            world = matrix @ location
            obj.location.z = world.z + (obj.location.z - origin.z)
            moved += 1

        self.report({"INFO"}, f"Dropped {moved} of {len(selected)} object(s) onto the terrain.")
        return {"FINISHED"}


_CLASSES = (MTM_OT_build_preview, MTM_OT_clear_preview, MTM_OT_drop_to_terrain)


def register():
    for cls in _CLASSES:
        bpy.utils.register_class(cls)


def unregister():
    for cls in reversed(_CLASSES):
        bpy.utils.unregister_class(cls)
