# SPDX-License-Identifier: MIT
"""
Live road carve.

Sculpting a landscape and then finding out at export that the road runs along
the side of a hill is a slow way to work. This builds a Geometry Nodes group
that flattens the terrain under the road curve, with a smooth blend back out
across the shoulder, and evaluates it as you drag the spline.

It is deliberately a modifier rather than an operator that edits vertices:
the sculpt stays in the base mesh, so the carve can be retuned or removed
without having lost anything. The exporter bakes the *evaluated* mesh, so
whatever the modifier shows is what ships.

The node group is rebuilt from scratch whenever the operator runs, so an old
group from a previous version of the add-on never lingers with the wrong
wiring.
"""

import bpy

GROUP_NAME = "MTM Road Carve"
MODIFIER_NAME = "MTM Road Carve"

# Socket names moved around between Blender versions — Geometry Proximity's
# target input was "Target" and is now "Geometry" — so anything ambiguous or
# renamed is wired by index, which has been stable.
_PROXIMITY_TARGET = 0
_PROXIMITY_SAMPLE_POSITION = 2
_MIX_FACTOR = 0
_MIX_A = 2
_MIX_B = 3
_MAP_VALUE = 0
_MAP_FROM_MIN = 1
_MAP_FROM_MAX = 2
_MAP_TO_MIN = 3
_MAP_TO_MAX = 4


def _new_socket(group, name, socket_type, in_out, **kwargs):
    """Declare a group socket across the 3.x and 4.x+ interface APIs."""
    if hasattr(group, "interface"):
        socket = group.interface.new_socket(name=name, in_out=in_out, socket_type=socket_type)
    else:  # Blender 3.x
        collection = group.inputs if in_out == "INPUT" else group.outputs
        socket = collection.new(socket_type, name)
    for key, value in kwargs.items():
        if hasattr(socket, key):
            setattr(socket, key, value)
    return socket


def build_group():
    """(Re)build the carve node group and return it."""
    existing = bpy.data.node_groups.get(GROUP_NAME)
    if existing is not None:
        bpy.data.node_groups.remove(existing)

    group = bpy.data.node_groups.new(GROUP_NAME, "GeometryNodeTree")

    _new_socket(group, "Geometry", "NodeSocketGeometry", "INPUT")
    _new_socket(group, "Road", "NodeSocketObject", "INPUT")
    _new_socket(group, "Width", "NodeSocketFloat", "INPUT", default_value=18.0, min_value=0.5)
    _new_socket(group, "Shoulder", "NodeSocketFloat", "INPUT", default_value=12.0, min_value=0.0)
    _new_socket(
        group,
        "Sample Spacing",
        "NodeSocketFloat",
        "INPUT",
        default_value=1.5,
        min_value=0.1,
        description="Distance between samples taken along the curve. Smaller "
        "follows tight corners more closely and costs more to evaluate",
    )
    _new_socket(group, "Geometry", "NodeSocketGeometry", "OUTPUT")

    nodes = group.nodes
    link = group.links.new

    group_in = nodes.new("NodeGroupInput")
    group_in.location = (-900, 0)
    group_out = nodes.new("NodeGroupOutput")
    group_out.location = (700, 0)

    # The curve, as a cloud of points to measure against. Relative space so a
    # moved or scaled road object still lands where it looks like it does.
    info = nodes.new("GeometryNodeObjectInfo")
    info.transform_space = "RELATIVE"
    info.location = (-700, -200)
    link(group_in.outputs["Road"], info.inputs["Object"])

    to_points = nodes.new("GeometryNodeCurveToPoints")
    to_points.mode = "LENGTH"
    to_points.location = (-520, -200)
    link(info.outputs["Geometry"], to_points.inputs["Curve"])
    link(group_in.outputs["Sample Spacing"], to_points.inputs["Length"])

    position = nodes.new("GeometryNodeInputPosition")
    position.location = (-700, 200)

    proximity = nodes.new("GeometryNodeProximity")
    proximity.target_element = "POINTS"
    proximity.location = (-340, -60)
    link(to_points.outputs["Points"], proximity.inputs[_PROXIMITY_TARGET])
    link(position.outputs["Position"], proximity.inputs[_PROXIMITY_SAMPLE_POSITION])

    # Horizontal distance to the road, not the 3D distance Proximity reports:
    # ground high above the road would otherwise measure as further out than
    # it is and get less of the blend than it needs.
    delta = nodes.new("ShaderNodeVectorMath")
    delta.operation = "SUBTRACT"
    delta.location = (-160, 120)
    link(position.outputs["Position"], delta.inputs[0])
    link(proximity.outputs["Position"], delta.inputs[1])

    flatten = nodes.new("ShaderNodeVectorMath")
    flatten.operation = "MULTIPLY"
    flatten.location = (0, 120)
    flatten.inputs[1].default_value = (1.0, 1.0, 0.0)
    link(delta.outputs["Vector"], flatten.inputs[0])

    lateral = nodes.new("ShaderNodeVectorMath")
    lateral.operation = "LENGTH"
    lateral.location = (160, 120)
    link(flatten.outputs["Vector"], lateral.inputs[0])

    half = nodes.new("ShaderNodeMath")
    half.operation = "MULTIPLY"
    half.location = (-340, 320)
    half.inputs[1].default_value = 0.5
    link(group_in.outputs["Width"], half.inputs[0])

    outer = nodes.new("ShaderNodeMath")
    outer.operation = "ADD"
    outer.location = (-160, 320)
    link(half.outputs["Value"], outer.inputs[0])
    link(group_in.outputs["Shoulder"], outer.inputs[1])

    # Full carve out to the road edge, easing to nothing at the shoulder.
    blend = nodes.new("ShaderNodeMapRange")
    blend.interpolation_type = "SMOOTHERSTEP"
    blend.clamp = True
    blend.location = (340, 260)
    link(lateral.outputs["Value"], blend.inputs[_MAP_VALUE])
    link(half.outputs["Value"], blend.inputs[_MAP_FROM_MIN])
    link(outer.outputs["Value"], blend.inputs[_MAP_FROM_MAX])
    blend.inputs[_MAP_TO_MIN].default_value = 1.0
    blend.inputs[_MAP_TO_MAX].default_value = 0.0

    vertex_xyz = nodes.new("ShaderNodeSeparateXYZ")
    vertex_xyz.location = (-520, 200)
    link(position.outputs["Position"], vertex_xyz.inputs[0])

    road_xyz = nodes.new("ShaderNodeSeparateXYZ")
    road_xyz.location = (-160, -60)
    link(proximity.outputs["Position"], road_xyz.inputs[0])

    height = nodes.new("ShaderNodeMix")
    height.data_type = "FLOAT"
    height.location = (500, 120)
    link(blend.outputs["Result"], height.inputs[_MIX_FACTOR])
    link(vertex_xyz.outputs["Z"], height.inputs[_MIX_A])
    link(road_xyz.outputs["Z"], height.inputs[_MIX_B])

    combine = nodes.new("ShaderNodeCombineXYZ")
    combine.location = (620, -80)
    link(vertex_xyz.outputs["X"], combine.inputs["X"])
    link(vertex_xyz.outputs["Y"], combine.inputs["Y"])
    link(height.outputs[0], combine.inputs["Z"])

    set_position = nodes.new("GeometryNodeSetPosition")
    set_position.location = (820, 0)
    link(group_in.outputs["Geometry"], set_position.inputs["Geometry"])
    link(combine.outputs["Vector"], set_position.inputs["Position"])

    # With no road assigned Proximity has nothing to measure against and
    # reports the origin, which would drag the whole landscape down to Z=0.
    # Newer Blender exposes a validity flag; where it exists, use it.
    valid = proximity.outputs.get("Is Valid")
    if valid is not None:
        link(valid, set_position.inputs["Selection"])

    link(set_position.outputs["Geometry"], group_out.inputs[0])
    return group


def _identifier(group, name):
    """Modifier inputs are addressed by socket identifier, not by name."""
    if hasattr(group, "interface"):
        for item in group.interface.items_tree:
            if getattr(item, "in_out", None) == "INPUT" and item.name == name:
                return item.identifier
    else:  # Blender 3.x
        for socket in group.inputs:
            if socket.name == name:
                return socket.identifier
    return None


def apply_carve(obj, road, width, shoulder, spacing=1.5):
    """Add or update the carve modifier on `obj`. Returns the modifier."""
    group = build_group()

    modifier = obj.modifiers.get(MODIFIER_NAME)
    if modifier is None or modifier.type != "NODES":
        if modifier is not None:
            obj.modifiers.remove(modifier)
        modifier = obj.modifiers.new(MODIFIER_NAME, "NODES")
    modifier.node_group = group

    for name, value in (
        ("Road", road),
        ("Width", float(width)),
        ("Shoulder", float(shoulder)),
        ("Sample Spacing", float(spacing)),
    ):
        identifier = _identifier(group, name)
        if identifier is not None:
            modifier[identifier] = value

    return modifier


def remove_carve(obj):
    modifier = obj.modifiers.get(MODIFIER_NAME)
    if modifier is None:
        return False
    obj.modifiers.remove(modifier)
    return True
