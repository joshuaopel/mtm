# SPDX-License-Identifier: MIT
"""
Track exporter: scene -> .mtmtrack.json

Walks the scene, reads each object's MTM role, and writes the JSON the game
loads. Validation happens before anything is written so a broken track fails
with a message in the UI rather than producing a file that crashes the game
on load.
"""

import json
import os

import bpy
from bpy.types import Operator
from mathutils import Vector

from .collision import build_colliders
from .props import SIZED_PROP_KINDS, TEXTURED_PROP_KINDS
from .heightmap import bake_surface, check_road_alignment, encode_heights, encode_paint
from .convert import (
    box_yaw_degrees,
    convert_position,
    local_bounds,
    resample_polyline,
    to_hex,
    world_centre,
    yaw_degrees,
)

FORMAT = "mtm-track"
VERSION = 1


def collect(scene, role):
    """Every visible object in the scene playing a given role."""
    return [obj for obj in scene.objects if getattr(obj, "mtm", None) and obj.mtm.role == role]


def curve_points(depsgraph, obj):
    """
    Tessellated world-space points along a curve object, in spline order.

    Evaluating through the depsgraph means modifiers and shape settings are
    respected, so what you see in the viewport is what gets exported.
    """
    evaluated = obj.evaluated_get(depsgraph)
    mesh = None
    try:
        mesh = evaluated.to_mesh()
        if mesh is None or len(mesh.vertices) < 2:
            return []
        matrix = evaluated.matrix_world
        return [matrix @ v.co.copy() for v in mesh.vertices]
    finally:
        if mesh is not None:
            evaluated.to_mesh_clear()


def build_road(scene, depsgraph, problems):
    settings = scene.mtm_track
    roads = collect(scene, "ROAD")

    if not roads:
        problems.append("No object has the 'Road Spline' role — a track needs exactly one.")
        return None
    if len(roads) > 1:
        problems.append(
            f"{len(roads)} objects have the 'Road Spline' role; there must be exactly one."
        )
        return None

    road_object = roads[0]
    if road_object.type != "CURVE":
        problems.append(f"'{road_object.name}' is marked as the road but is not a curve object.")
        return None

    raw = curve_points(depsgraph, road_object)
    if len(raw) < 3:
        problems.append(f"Road curve '{road_object.name}' has too few points to build a track.")
        return None

    sampled = resample_polyline(raw, settings.road_spacing)
    if len(sampled) < 3:
        problems.append(
            "Road resampled to fewer than 3 points — reduce 'Point Spacing' in the track settings."
        )
        return None

    return {
        "points": [{"pos": convert_position(p)} for p in sampled],
        "width": round(settings.road_width, 3),
        "closed": bool(settings.road_closed),
        "shoulder": round(settings.road_shoulder, 3),
    }


def build_walls(scene):
    walls = []
    for obj in collect(scene, "WALL"):
        size, _ = local_bounds(obj)
        centre = world_centre(obj)
        entry = {
            "pos": convert_position(centre),
            # Blender local Y is depth (game Z) and local Z is up (game Y).
            "size": [round(size.x, 4), round(size.z, 4), round(size.y, 4)],
            "rotation": box_yaw_degrees(obj.matrix_world),
            "material": obj.mtm.wall_material,
        }
        if obj.mtm.wall_invisible:
            entry["invisible"] = True
        walls.append(entry)
    return walls


def build_props(scene):
    props = []
    for obj in collect(scene, "PROP"):
        scale = obj.matrix_world.to_scale()
        entry = {
            "kind": obj.mtm.prop_kind,
            "pos": convert_position(obj.matrix_world.translation),
            "rotation": yaw_degrees(obj.matrix_world),
            "scale": round(max(0.01, (abs(scale.x) + abs(scale.y) + abs(scale.z)) / 3.0), 4),
        }
        kind = obj.mtm.prop_kind
        if obj.mtm.prop_solid:
            entry["solid"] = True
        if kind in SIZED_PROP_KINDS:
            size = obj.mtm.prop_size
            entry["size"] = [round(size[0], 3), round(size[1], 3), round(size[2], 3)]
        if kind in TEXTURED_PROP_KINDS and obj.mtm.prop_texture.strip():
            entry["texture"] = obj.mtm.prop_texture.strip()
        props.append(entry)
    return props


def build_features(scene):
    features = []
    for obj in collect(scene, "FEATURE"):
        position = obj.matrix_world.translation
        scale = obj.matrix_world.to_scale()
        # Radius comes from the object's own footprint, so features are sized
        # by scaling them in the viewport.
        radius = max(1.0, abs(scale.x) * 10.0)
        kind = obj.mtm.feature_kind

        entry = {
            "type": kind,
            "pos": [round(position.x, 3), round(-position.y, 3)],
            "radius": round(radius, 3),
        }
        if kind == "crater":
            entry["depth"] = round(abs(obj.mtm.feature_height), 3)
        else:
            entry["height"] = round(obj.mtm.feature_height, 3)
        if kind == "plateau":
            entry["falloff"] = round(obj.mtm.feature_falloff, 3)
        features.append(entry)
    return features


def build_checkpoints(scene, problems):
    gates = collect(scene, "CHECKPOINT")
    if not gates:
        # Perfectly valid: the game generates gates along the road instead.
        return None

    ordered = sorted(gates, key=lambda o: o.mtm.checkpoint_order)
    seen = {}
    for obj in ordered:
        order = obj.mtm.checkpoint_order
        if order in seen:
            problems.append(
                f"Checkpoints '{seen[order]}' and '{obj.name}' share order {order}; "
                "each gate needs a unique order."
            )
        seen[order] = obj.name

    if len(ordered) < 3:
        problems.append(
            f"Only {len(ordered)} checkpoints placed. Use at least 3, or delete them all "
            "and let the game generate gates along the road."
        )

    return [
        {
            "pos": convert_position(obj.matrix_world.translation),
            "rotation": yaw_degrees(obj.matrix_world),
            "width": round(obj.mtm.checkpoint_width, 3),
        }
        for obj in ordered
    ]


def build_spawns(scene):
    spawns = collect(scene, "SPAWN")
    if not spawns:
        return None
    ordered = sorted(spawns, key=lambda o: o.mtm.spawn_order)
    return [
        {
            "pos": convert_position(obj.matrix_world.translation),
            "rotation": yaw_degrees(obj.matrix_world),
        }
        for obj in ordered
    ]


def build_paint(scene, painted, bake_segments):
    """
    The terrain's ground textures, and where each one shows.

    Returns None on 'Automatic', which leaves the field out of the track file
    entirely — the game then picks layers from the surface theme. Writing an
    explicit copy of the automatic behaviour would freeze it into every track
    exported today and stop them benefiting when the defaults improve.
    """
    settings = scene.mtm_track
    if settings.paint_mode != "custom":
        return None

    slots = (
        (settings.paint_base, settings.paint_base_scale),
        (settings.paint_layer1, settings.paint_layer1_scale),
        (settings.paint_layer2, settings.paint_layer2_scale),
        (settings.paint_layer3, settings.paint_layer3_scale),
    )

    layers = []
    for texture, scale in slots:
        name = texture.strip()
        if not name:
            # A blank slot ends the list: layer 3 cannot exist without layer 2,
            # because the channels are positional.
            break
        layers.append({"texture": name, "scale": round(scale, 2)})

    if not layers:
        return None

    paint = {"layers": layers}

    rules = []
    if settings.paint_slope_rule and len(layers) > 1:
        rules.append(
            {
                "layer": 1,
                "by": "slope",
                "from": round(settings.paint_slope_from, 1),
                "to": round(settings.paint_slope_to, 1),
            }
        )
    if settings.paint_verge_rule and len(layers) > 2:
        # Inverted range: strongest at the road, gone by the verge width.
        rules.append(
            {
                "layer": 2,
                "by": "road",
                "from": round(settings.paint_verge_distance, 1),
                "to": round(settings.paint_verge_distance * 0.35, 1),
                "strength": 0.75,
            }
        )
    if rules:
        paint["rules"] = rules

    if painted:
        paint["weights"] = {"segments": bake_segments, "data": encode_paint(painted)}

    return paint


def terrain_size(scene, road):
    """
    Terrain extent: the bounds of a TERRAIN-role object if one exists,
    otherwise sized to comfortably contain the road.

    With a sculpted terrain this is the mesh's own footprint, which is what
    makes "model the landscape, export, drive it" line up without the author
    having to type a size anywhere.
    """
    terrains = collect(scene, "TERRAIN")
    if terrains:
        extent = terrain_object_extent(terrains[0])
        if extent > 0.0:
            return max(100.0, extent)

    if road:
        extent = 0.0
        for point in road["points"]:
            extent = max(extent, abs(point["pos"][0]), abs(point["pos"][2]))
        # Leave room for run-off and scenery beyond the outermost corner.
        return max(200.0, (extent + 120.0) * 2.0)

    return scene.mtm_track.terrain_size


def terrain_object_extent(obj):
    """
    Footprint of the Terrain-role object, or 0 if it does not have one.

    An Empty has no bounding box at all — `bound_box` is eight zeroes — so the
    display size is the only thing describing the box the author drew. Reading
    the bounds alone silently collapsed every scaffolded track to the 100m
    floor while the course ran for hundreds of metres outside it.
    """
    if obj.type == "EMPTY":
        # `empty_display_size` is the half-extent of the drawn cube, before
        # object scale.
        scale = obj.matrix_world.to_scale()
        return obj.empty_display_size * 2.0 * max(abs(scale.x), abs(scale.y))

    size, _ = local_bounds(obj)
    return max(size.x, size.y)


def export_scenery_gltf(context, json_path, problems):
    """
    Write SCENERY-tagged objects to a .glb beside the track JSON.

    Blender's glTF exporter converts Z-up to the Y-up convention the game
    uses, so the result needs no fixing up on the runtime side. Returns the
    filename to reference from the JSON, or None when there is no scenery.
    """
    scene = context.scene
    scenery = [o for o in collect(scene, "SCENERY") if o.type in {"MESH", "CURVE", "SURFACE"}]
    if not scenery:
        return None

    base = os.path.splitext(os.path.basename(json_path))[0]
    # Strip the ".mtmtrack" half of a ".mtmtrack.json" name.
    if base.endswith(".mtmtrack"):
        base = base[: -len(".mtmtrack")]
    glb_name = f"{base}.glb"
    glb_path = os.path.join(os.path.dirname(json_path), glb_name)

    previous_selection = list(context.selected_objects)
    previous_active = context.view_layer.objects.active

    try:
        bpy.ops.object.select_all(action="DESELECT")
        for obj in scenery:
            obj.select_set(True)
        context.view_layer.objects.active = scenery[0]

        bpy.ops.export_scene.gltf(
            filepath=glb_path,
            export_format="GLB",
            use_selection=True,
            export_apply=True,
            export_yup=True,
        )
    except Exception as error:  # noqa: BLE001 - surfaced to the user below
        problems.append(f"Scenery glTF export failed: {error}")
        return None
    finally:
        bpy.ops.object.select_all(action="DESELECT")
        for obj in previous_selection:
            try:
                obj.select_set(True)
            except ReferenceError:
                pass
        context.view_layer.objects.active = previous_active

    return glb_name


def build_track(context, problems):
    scene = context.scene
    settings = scene.mtm_track
    depsgraph = context.evaluated_depsgraph_get()

    road = build_road(scene, depsgraph, problems)
    if road is None:
        return None

    size = terrain_size(scene, road)

    track = {
        "format": FORMAT,
        "version": VERSION,
        "id": settings.track_id.strip() or "untitled-track",
        "name": settings.track_name.strip() or "UNTITLED",
        "blurb": settings.blurb.strip(),
        "difficulty": int(settings.difficulty),
        "laps": int(settings.laps),
        "environment": {
            "skyZenith": to_hex(settings.sky_zenith),
            "skyHorizon": to_hex(settings.sky_horizon),
            "fogColor": to_hex(settings.fog_color),
            "fogDensity": round(settings.fog_density, 5),
            "sunDirection": [0.4, 0.7, 0.4],
            "sunColor": to_hex(settings.sun_color),
            "ambientColor": to_hex(settings.ambient_color),
            "surface": settings.surface,
        },
        "terrain": {
            "size": round(size, 2),
            "segments": int(settings.terrain_segments),
            "amplitude": round(settings.terrain_amplitude, 3),
            "frequency": round(settings.terrain_frequency, 5),
            "seed": int(settings.terrain_seed),
            "features": build_features(scene),
        },
        "road": road,
        "bounds": {
            "margin": round(settings.bounds_margin, 3),
            "seconds": round(settings.bounds_seconds, 2),
        },
        "walls": build_walls(scene),
        "props": build_props(scene),
    }

    # Sculpted terrain is sampled onto the runtime's height grid at export,
    # so the mesh in the .blend stays the single source of truth rather than
    # a cache that can go stale.
    bake_segments = int(settings.heightmap_segments)
    painted = None

    if settings.terrain_source == "sculpted":
        terrains = collect(scene, "TERRAIN")
        if not terrains:
            problems.append(
                "Terrain is set to 'Sculpted Mesh' but no object has the Terrain role."
            )
        else:
            heights, painted = bake_surface(
                terrains[0],
                depsgraph,
                size,
                bake_segments,
                problems,
                want_paint=settings.paint_mode == "custom",
            )
            if heights:
                check_road_alignment(
                    heights,
                    size,
                    bake_segments,
                    road,
                    settings.road_shoulder,
                    bool(settings.heightmap_flatten_road),
                    problems,
                )
                track["terrain"]["heightmap"] = {
                    "segments": bake_segments,
                    "data": encode_heights(heights),
                    "flattenRoad": bool(settings.heightmap_flatten_road),
                }

    paint = build_paint(scene, painted, bake_segments)
    if paint:
        track.setdefault("environment", {}).setdefault("artwork", {})["paint"] = paint

    colliders = build_colliders(scene, depsgraph, collect, problems)
    if colliders:
        track["colliders"] = colliders

    if settings.author.strip():
        track["author"] = settings.author.strip()

    # Take the sun direction from the first sun lamp if the scene has one.
    sun = next((o for o in scene.objects if o.type == "LIGHT" and o.data.type == "SUN"), None)
    if sun is not None:
        direction = sun.matrix_world.to_3x3() @ Vector((0.0, 0.0, 1.0))
        track["environment"]["sunDirection"] = [
            round(direction.x, 3),
            round(direction.z, 3),
            round(-direction.y, 3),
        ]

    if settings.barriers_enabled:
        track["barriers"] = {
            "spacing": round(settings.barrier_spacing, 3),
            "height": round(settings.barrier_height, 3),
            "thickness": round(settings.barrier_thickness, 3),
            "offset": round(settings.barrier_offset, 3),
            "material": settings.barrier_material,
            "invisible": bool(settings.barrier_invisible),
        }

    checkpoints = build_checkpoints(scene, problems)
    if checkpoints:
        track["checkpoints"] = checkpoints

    spawns = build_spawns(scene)
    if spawns:
        track["spawns"] = spawns

    return track


class MTM_OT_export_track(Operator):
    """Write the current scene out as a track the game can load"""

    bl_idname = "mtm.export_track"
    bl_label = "Export Track"
    bl_options = {"REGISTER"}

    def execute(self, context):
        problems = []
        track = build_track(context, problems)

        # Anything in `problems` is a hard error: writing a file the game
        # cannot load is worse than refusing to write one.
        if problems:
            for problem in problems:
                self.report({"ERROR"}, problem)
            return {"CANCELLED"}

        path = bpy.path.abspath(context.scene.mtm_track.export_path)
        directory = os.path.dirname(path)
        if directory and not os.path.isdir(directory):
            os.makedirs(directory, exist_ok=True)

        # Scenery goes out as a .glb beside the JSON, which then references it
        # by filename so the pair can be copied into the game together.
        scenery_problems = []
        glb_name = export_scenery_gltf(context, path, scenery_problems)
        for problem in scenery_problems:
            self.report({"WARNING"}, problem)
        if glb_name:
            track["sceneryModel"] = f"content/{glb_name}"

        try:
            with open(path, "w", encoding="utf-8") as handle:
                json.dump(track, handle, indent=2)
        except OSError as error:
            self.report({"ERROR"}, f"Could not write {path}: {error}")
            return {"CANCELLED"}

        self.report(
            {"INFO"},
            "Exported {name}: {points} road points, {walls} walls, {props} props, "
            "{colliders} colliders, {features} features{scenery} -> {path}".format(
                name=track["name"],
                points=len(track["road"]["points"]),
                walls=len(track["walls"]),
                props=len(track["props"]),
                colliders=len(track.get("colliders", [])),
                features=len(track["terrain"]["features"]),
                scenery=f", scenery {glb_name}" if glb_name else "",
                path=os.path.basename(path),
            ),
        )
        return {"FINISHED"}


class MTM_OT_validate_track(Operator):
    """Check the scene for problems without writing a file"""

    bl_idname = "mtm.validate_track"
    bl_label = "Validate Track"
    bl_options = {"REGISTER"}

    def execute(self, context):
        problems = []
        track = build_track(context, problems)

        if problems:
            for problem in problems:
                self.report({"ERROR"}, problem)
            return {"CANCELLED"}

        scene = context.scene
        # Warnings, not errors: each of these still exports, but is very
        # likely a mistake worth surfacing before it reaches the game.
        if not collect(scene, "SPAWN"):
            self.report({"INFO"}, "No spawn points — the game will build a grid behind the line.")
        if not track["walls"] and not track.get("barriers"):
            self.report({"WARNING"}, "No walls and auto-barriers are off: nothing fences the course.")
        if not track["blurb"]:
            self.report({"WARNING"}, "No blurb set; the level select screen will look empty.")
        if collect(scene, "SCENERY") and not track.get("colliders"):
            self.report(
                {"WARNING"},
                "Scenery is tagged but nothing has a collider — trucks will drive through it.",
            )

        self.report({"INFO"}, f"Track '{track['name']}' looks good.")
        return {"FINISHED"}


_CLASSES = (MTM_OT_export_track, MTM_OT_validate_track)


def register():
    for cls in _CLASSES:
        bpy.utils.register_class(cls)


def unregister():
    for cls in reversed(_CLASSES):
        bpy.utils.unregister_class(cls)
