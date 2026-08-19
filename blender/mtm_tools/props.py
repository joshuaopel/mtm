# SPDX-License-Identifier: MIT
"""
Custom properties.

Track authoring works by tagging objects with a role. Every object in the
scene carries an `mtm` property group; the exporter walks the scene, reads
each object's role, and emits the matching JSON. Nothing is exported unless
it has been given a role, so you can keep reference geometry, lighting rigs
and blockouts in the same file without them leaking into the track.
"""

import bpy
from bpy.props import (
    BoolProperty,
    EnumProperty,
    FloatProperty,
    FloatVectorProperty,
    IntProperty,
    PointerProperty,
    StringProperty,
)
from bpy.types import Object, PropertyGroup, Scene

# Roles an object can play in a track. The value strings are what the
# exporter switches on, so treat them as stable identifiers.
OBJECT_ROLES = [
    ("NONE", "None", "Ignored by the exporter", "BLANK1", 0),
    ("ROAD", "Road Spline", "Curve defining the racing line", "CURVE_BEZCURVE", 1),
    (
        "TERRAIN",
        "Terrain",
        "Sets the terrain patch size; becomes the ground itself when Terrain "
        "Source is Sculpted Mesh",
        "MESH_GRID",
        2,
    ),
    ("WALL", "Blocker Wall", "Solid box the trucks collide with", "MESH_CUBE", 3),
    ("PROP", "Prop", "Scenery, optionally solid", "MESH_MONKEY", 4),
    ("SPAWN", "Spawn Point", "A grid slot", "EMPTY_ARROWS", 5),
    ("CHECKPOINT", "Checkpoint", "Ordered gate", "MESH_PLANE", 6),
    ("FEATURE", "Terrain Feature", "Hill, crater or plateau", "SPHERECURVE", 7),
    ("COLLIDER", "Collider", "Invisible collision volume", "MESH_ICOSPHERE", 8),
    ("SCENERY", "Scenery Mesh", "Visual geometry exported to the track's .glb", "OUTLINER_OB_MESH", 9),
]

# Collision shapes the runtime can build. Concave meshes are absent on
# purpose: cannon resolves boxes and convex hulls properly, but its triangle
# meshes only collide reliably against spheres and rays, so a concave
# collider would let truck bodies drive straight through it.
COLLIDER_SHAPES = [
    ("box", "Box", "Object bounds as an oriented box. Cheapest and most predictable"),
    ("convex", "Convex Hull", "The mesh itself, which must be convex"),
]

# Terrain is generated procedurally at runtime rather than baked from a mesh,
# so shaping it means placing these instead of sculpting vertices. Each maps
# one-to-one onto a TerrainFeature in the track format.
FEATURE_KINDS = [
    ("hill", "Hill", "Raised mound"),
    ("crater", "Crater", "Dished hollow with a raised lip"),
    ("plateau", "Plateau", "Flatten an area to a fixed height"),
]

PROP_KINDS = [
    ("ramp", "Stunt Ramp", "A kicker. Always solid — you drive up it"),
    ("tabletop", "Table-Top", "Up-ramp, flat deck, down-ramp. Always solid"),
    ("tree", "Tree (Conifer)", ""),
    ("palm", "Tree (Palm)", ""),
    ("deadtree", "Tree (Bare)", ""),
    ("rock", "Rock", ""),
    ("barrel", "Barrel", ""),
    ("cone", "Cone", ""),
    ("sign", "Sign", ""),
    ("billboard", "Billboard", "Hoarding. Give it an image to carry artwork"),
    ("flag", "Flag", "On a mast, waving in the wind"),
    ("tower", "Tower", ""),
    ("crate", "Crate", ""),
    ("arch", "Arch / Gantry", ""),
]

# Kinds whose dimensions are worth setting in metres rather than by scaling,
# because the shape of a jump is the thing you are actually authoring.
SIZED_PROP_KINDS = {"ramp", "tabletop", "billboard", "flag"}
# Kinds that can carry an image.
TEXTURED_PROP_KINDS = {"billboard", "flag"}

WALL_MATERIALS = [
    ("concrete", "Concrete", ""),
    ("tire", "Tyre Wall", ""),
    ("metal", "Metal", ""),
    ("wood", "Wood", ""),
    ("rock", "Rock", ""),
]

SURFACES = [
    ("dirt", "Dirt", ""),
    ("sand", "Sand", ""),
    ("snow", "Snow", ""),
    ("mud", "Mud", ""),
    ("slag", "Slag", ""),
    ("grass", "Grass", ""),
]

VEHICLE_STYLES = [
    ("pickup", "Pickup", ""),
    ("crewcab", "Crew Cab", ""),
    ("flatnose", "Flat Nose", ""),
    ("muscle", "Muscle", ""),
    ("buggy", "Buggy", ""),
    ("hauler", "Hauler", ""),
]

LIVERIES = [
    ("solid", "Solid", ""),
    ("stripe", "Stripe", ""),
    ("flames", "Flames", ""),
    ("splatter", "Splatter", ""),
    ("checker", "Checker", ""),
    ("bolt", "Bolt", ""),
]


class MTMObjectProps(PropertyGroup):
    """Per-object authoring data."""

    role: EnumProperty(
        name="Role",
        items=OBJECT_ROLES,
        default="NONE",
        description="What this object becomes in the exported track",
    )

    # --- walls ---
    wall_material: EnumProperty(name="Material", items=WALL_MATERIALS, default="concrete")
    wall_invisible: BoolProperty(
        name="Invisible",
        default=False,
        description="Collides but is not drawn — for fencing a course without clutter",
    )

    # --- props ---
    prop_kind: EnumProperty(name="Kind", items=PROP_KINDS, default="rock")
    prop_solid: BoolProperty(
        name="Solid",
        default=False,
        description="Give this prop a collision box. Ramps ignore this — they "
        "are always solid",
    )
    prop_size: FloatVectorProperty(
        name="Size",
        size=3,
        default=(8.0, 2.5, 11.0),
        min=0.1,
        subtype="XYZ",
        description="Width, height and length in metres. Ramps and table-tops "
        "read length along the direction of travel; billboards and flags read "
        "the third value as the post or mast height",
    )
    prop_texture: StringProperty(
        name="Image",
        default="",
        description="Artwork for a billboard face or flag cloth. A path "
        "relative to public/content/, e.g. 'my-logo.png'",
    )

    # --- checkpoints ---
    checkpoint_order: IntProperty(
        name="Order",
        default=0,
        min=0,
        description="Gates are sorted by this. Gate 0 is the start/finish line",
    )
    checkpoint_width: FloatProperty(
        name="Width",
        default=40.0,
        min=1.0,
        subtype="DISTANCE",
        description="How wide the gate is. Be generous — gates prove you went "
        "round, they should not punish a wide line",
    )

    # --- spawns ---
    spawn_order: IntProperty(name="Grid Slot", default=0, min=0)

    # --- colliders ---
    collider_shape: EnumProperty(
        name="Shape",
        items=COLLIDER_SHAPES,
        default="box",
        description="How this volume is turned into collision",
    )

    # --- terrain features ---
    # Radius comes from the object's own X scale so you can size a feature by
    # dragging it in the viewport rather than typing numbers here.
    feature_kind: EnumProperty(name="Feature", items=FEATURE_KINDS, default="hill")
    feature_height: FloatProperty(
        name="Height / Depth",
        default=20.0,
        subtype="DISTANCE",
        description="Rise for a hill or plateau, depth for a crater",
    )
    feature_falloff: FloatProperty(
        name="Falloff",
        default=0.35,
        min=0.01,
        max=1.0,
        description="Plateau only: fraction of the radius used to blend the edge",
    )


class MTMTrackProps(PropertyGroup):
    """Scene-level track settings."""

    track_id: StringProperty(name="ID", default="my-track")
    track_name: StringProperty(name="Name", default="MY TRACK")
    blurb: StringProperty(name="Blurb", default="", description="Shown on the level select screen")
    author: StringProperty(name="Author", default="")
    difficulty: IntProperty(name="Difficulty", default=2, min=1, max=5)
    laps: IntProperty(name="Laps", default=3, min=1, max=20)

    # Road
    road_width: FloatProperty(name="Road Width", default=20.0, min=4.0, subtype="DISTANCE")
    road_closed: BoolProperty(name="Closed Circuit", default=True)
    road_shoulder: FloatProperty(
        name="Shoulder",
        default=8.0,
        min=0.0,
        subtype="DISTANCE",
        description="How far past the road edge the terrain blends back to its natural height",
    )
    road_spacing: FloatProperty(
        name="Point Spacing",
        default=12.0,
        min=2.0,
        subtype="DISTANCE",
        description="The curve is tessellated then resampled at this spacing. "
        "The game re-splines those points, so tighter spacing tracks a "
        "complex curve more faithfully at the cost of a larger file",
    )

    # Terrain
    terrain_source: EnumProperty(
        name="Terrain Source",
        items=[
            (
                "procedural",
                "Generated",
                "Built at runtime from noise plus the terrain features you place. "
                "Nothing to model; use the course preview to see it",
            ),
            (
                "sculpted",
                "Sculpted Mesh",
                "Bake the Terrain-role mesh into a heightfield at export. Model the "
                "landscape however you like — but it is a heightfield, so overhangs "
                "and caves cannot be represented",
            ),
        ],
        default="procedural",
    )
    heightmap_segments: IntProperty(
        name="Bake Resolution",
        default=128,
        min=32,
        max=256,
        description="Grid resolution of the baked heightfield. Higher captures "
        "finer sculpting at the cost of a much larger track file",
    )
    heightmap_flatten_road: BoolProperty(
        name="Carve Road Into Terrain",
        default=True,
        description="Flatten the sculpted ground under the road, as the generated "
        "terrain does. Turn this off only if you sculpted the road surface yourself",
    )
    terrain_size: FloatProperty(name="Size", default=800.0, min=100.0, subtype="DISTANCE")
    terrain_segments: IntProperty(
        name="Segments",
        default=180,
        min=32,
        max=400,
        description="Heightfield resolution. Vertex count is (segments+1) squared",
    )
    terrain_amplitude: FloatProperty(name="Amplitude", default=10.0, min=0.0)
    terrain_frequency: FloatProperty(name="Frequency", default=0.01, min=0.0001, precision=4)
    terrain_seed: IntProperty(name="Seed", default=1234)

    # Terrain paint
    paint_mode: EnumProperty(
        name="Ground Texture",
        items=[
            (
                "auto",
                "Automatic",
                "The game blends rock onto steep ground and wears a verge along "
                "the road, chosen from the Surface theme. Nothing to set up",
            ),
            (
                "custom",
                "Choose Layers",
                "Pick the four ground textures yourself, and optionally paint "
                "where each one shows",
            ),
        ],
        default="auto",
    )
    paint_base: StringProperty(
        name="Base",
        default="dirt",
        description="Ground everywhere nothing else is painted. A built-in "
        "surface name (dirt, sand, snow, mud, slag, grass, rock) or an image path",
    )
    paint_layer1: StringProperty(name="Layer 1 (Red)", default="rock")
    paint_layer2: StringProperty(name="Layer 2 (Green)", default="")
    paint_layer3: StringProperty(name="Layer 3 (Blue)", default="")
    paint_base_scale: FloatProperty(name="Base Tile", default=8.0, min=0.5, subtype="DISTANCE")
    paint_layer1_scale: FloatProperty(name="Tile", default=11.0, min=0.5, subtype="DISTANCE")
    paint_layer2_scale: FloatProperty(name="Tile", default=8.0, min=0.5, subtype="DISTANCE")
    paint_layer3_scale: FloatProperty(name="Tile", default=8.0, min=0.5, subtype="DISTANCE")
    paint_slope_rule: BoolProperty(
        name="Layer 1 On Steep Ground",
        default=True,
        description="Blend layer 1 in as the ground gets steeper, so cliffs read "
        "as rock without painting them",
    )
    # Degrees, stored plain rather than as Blender angles so the number in the
    # panel is the number written to the track file.
    paint_slope_from: FloatProperty(
        name="Starts At", default=32.0, min=0.0, max=90.0,
        description="Slope in degrees where layer 1 starts to show",
    )
    paint_slope_to: FloatProperty(
        name="Full At", default=52.0, min=0.0, max=90.0,
        description="Slope in degrees where layer 1 covers the ground completely",
    )
    paint_verge_rule: BoolProperty(
        name="Layer 2 Along The Road",
        default=False,
        description="Blend layer 2 in near the racing line, for a worn verge",
    )
    paint_verge_distance: FloatProperty(
        name="Verge Width", default=26.0, min=1.0, subtype="DISTANCE"
    )

    # Environment
    surface: EnumProperty(name="Surface", items=SURFACES, default="dirt")
    sky_zenith: FloatVectorProperty(
        name="Sky Zenith", subtype="COLOR", size=3, min=0.0, max=1.0, default=(0.23, 0.42, 0.60)
    )
    sky_horizon: FloatVectorProperty(
        name="Sky Horizon", subtype="COLOR", size=3, min=0.0, max=1.0, default=(0.78, 0.66, 0.47)
    )
    fog_color: FloatVectorProperty(
        name="Fog", subtype="COLOR", size=3, min=0.0, max=1.0, default=(0.78, 0.66, 0.47)
    )
    fog_density: FloatProperty(name="Fog Density", default=0.008, min=0.0005, max=0.05, precision=4)
    sun_color: FloatVectorProperty(
        name="Sun", subtype="COLOR", size=3, min=0.0, max=1.0, default=(1.0, 0.94, 0.82)
    )
    ambient_color: FloatVectorProperty(
        name="Ambient", subtype="COLOR", size=3, min=0.0, max=1.0, default=(0.35, 0.30, 0.25)
    )

    # Automatic barriers
    barriers_enabled: BoolProperty(
        name="Auto Barriers",
        default=True,
        description="Generate blocker walls along both road edges on export",
    )
    barrier_spacing: FloatProperty(name="Spacing", default=10.0, min=2.0, subtype="DISTANCE")
    barrier_height: FloatProperty(name="Height", default=1.6, min=0.2, subtype="DISTANCE")
    barrier_thickness: FloatProperty(name="Thickness", default=0.8, min=0.1, subtype="DISTANCE")
    barrier_offset: FloatProperty(name="Offset", default=2.5, min=0.0, subtype="DISTANCE")
    barrier_material: EnumProperty(name="Material", items=WALL_MATERIALS, default="tire")
    barrier_invisible: BoolProperty(name="Invisible", default=False)

    export_path: StringProperty(
        name="Export To",
        default="//track.mtmtrack.json",
        subtype="FILE_PATH",
    )


class MTMVehicleProps(PropertyGroup):
    """Scene-level vehicle settings."""

    vehicle_id: StringProperty(name="ID", default="my-truck")
    vehicle_name: StringProperty(name="Name", default="MY TRUCK")
    vehicle_class: StringProperty(name="Class", default="ALL-ROUND")
    blurb: StringProperty(name="Blurb", default="")

    # Display stats, 0-10
    stat_speed: IntProperty(name="Speed", default=6, min=0, max=10)
    stat_accel: IntProperty(name="Accel", default=6, min=0, max=10)
    stat_grip: IntProperty(name="Grip", default=6, min=0, max=10)
    stat_weight: IntProperty(name="Weight", default=5, min=0, max=10)
    stat_suspension: IntProperty(name="Suspension", default=6, min=0, max=10)
    stat_toughness: IntProperty(name="Toughness", default=6, min=0, max=10)

    # Physics
    mass: FloatProperty(name="Mass", default=1400.0, min=200.0)
    chassis_size: FloatVectorProperty(
        name="Chassis Size", size=3, default=(2.3, 1.0, 5.2), min=0.1, subtype="XYZ"
    )
    wheel_radius: FloatProperty(name="Wheel Radius", default=0.66, min=0.1, subtype="DISTANCE")
    wheel_width: FloatProperty(name="Wheel Width", default=0.52, min=0.05, subtype="DISTANCE")
    front_track: FloatProperty(name="Front Half-Track", default=1.12, min=0.2, subtype="DISTANCE")
    front_z: FloatProperty(name="Front Axle Z", default=1.6, subtype="DISTANCE")
    rear_track: FloatProperty(name="Rear Half-Track", default=1.12, min=0.2, subtype="DISTANCE")
    rear_z: FloatProperty(name="Rear Axle Z", default=-1.65, subtype="DISTANCE")
    axle_height: FloatProperty(name="Axle Height", default=-0.18, subtype="DISTANCE")

    suspension_rest: FloatProperty(name="Suspension Rest", default=0.62, min=0.05)
    suspension_stiffness: FloatProperty(name="Stiffness", default=36.0, min=1.0)
    suspension_damping: FloatProperty(name="Damping (relax)", default=2.6, min=0.0)
    suspension_compression: FloatProperty(name="Damping (compress)", default=4.2, min=0.0)
    suspension_travel: FloatProperty(name="Max Travel", default=0.6, min=0.05)
    friction_slip: FloatProperty(name="Grip (friction slip)", default=2.7, min=0.1)
    roll_influence: FloatProperty(
        name="Roll Influence",
        default=0.06,
        min=0.0,
        max=1.0,
        description="0 is very hard to roll over, 1 rolls easily",
    )

    engine_force: FloatProperty(name="Engine Force", default=5200.0, min=100.0)
    brake_force: FloatProperty(name="Brake Force", default=55.0, min=1.0)
    handbrake_force: FloatProperty(name="Handbrake Force", default=140.0, min=1.0)
    max_steer: FloatProperty(name="Max Steer", default=0.55, min=0.05, max=1.5)
    top_speed: FloatProperty(name="Top Speed", default=42.0, min=5.0)
    downforce: FloatProperty(name="Downforce", default=4.5, min=0.0)
    air_control: FloatProperty(
        name="Air Control",
        default=2.6,
        min=0.0,
        max=8.0,
        description="Mid-air rotation rate, in rad/s^2",
    )

    # Look
    style: EnumProperty(name="Style", items=VEHICLE_STYLES, default="pickup")
    livery: EnumProperty(name="Livery", items=LIVERIES, default="solid")
    body_color: FloatVectorProperty(
        name="Body", subtype="COLOR", size=3, min=0.0, max=1.0, default=(0.78, 0.35, 0.09)
    )
    accent_color: FloatVectorProperty(
        name="Accent", subtype="COLOR", size=3, min=0.0, max=1.0, default=(0.94, 0.88, 0.75)
    )
    trim_color: FloatVectorProperty(
        name="Trim", subtype="COLOR", size=3, min=0.0, max=1.0, default=(0.23, 0.23, 0.22)
    )
    glass_color: FloatVectorProperty(
        name="Glass", subtype="COLOR", size=3, min=0.0, max=1.0, default=(0.54, 0.70, 0.78)
    )
    rim_color: FloatVectorProperty(
        name="Rims", subtype="COLOR", size=3, min=0.0, max=1.0, default=(0.85, 0.83, 0.75)
    )
    roll_cage: BoolProperty(name="Roll Cage", default=True)
    stacks: BoolProperty(name="Exhaust Stacks", default=True)
    light_bar: BoolProperty(name="Light Bar", default=False)

    # --- custom model ---
    # Set by the model exporter. Leave blank to use the procedural body.
    model_path: StringProperty(
        name="Model",
        default="",
        description="Path to the exported .glb, relative to the game's site root. "
        "Blank means the procedural body is used instead",
    )
    model_scale: FloatProperty(
        name="Model Scale",
        default=1.0,
        min=0.01,
        description="Uniform scale applied to the imported meshes",
    )
    model_yaw: FloatProperty(
        name="Model Yaw",
        default=0.0,
        description="Degrees of extra yaw, for a body modelled facing the wrong way",
    )
    mirror_left_wheels: BoolProperty(
        name="Mirror Left Wheels",
        default=False,
        description="Mirror the wheel on the left side. Right for offset rims and "
        "directional tread, wrong for wheels with lettering",
    )

    export_path: StringProperty(
        name="Export To",
        default="//vehicle.mtmvehicle.json",
        subtype="FILE_PATH",
    )


_CLASSES = (MTMObjectProps, MTMTrackProps, MTMVehicleProps)


def register():
    for cls in _CLASSES:
        bpy.utils.register_class(cls)
    Object.mtm = PointerProperty(type=MTMObjectProps)
    Scene.mtm_track = PointerProperty(type=MTMTrackProps)
    Scene.mtm_vehicle = PointerProperty(type=MTMVehicleProps)


def unregister():
    del Scene.mtm_vehicle
    del Scene.mtm_track
    del Object.mtm
    for cls in reversed(_CLASSES):
        bpy.utils.unregister_class(cls)
