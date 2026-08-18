# SPDX-License-Identifier: MIT
"""
Collision authoring.

Colliders are invisible volumes the trucks hit. They are kept separate from
the scenery mesh on purpose: collision should almost always be simpler than
what you see. A detailed building is best fenced by two boxes — faster to
simulate, and far more predictable to drive against than its own geometry.

Only boxes and convex hulls are supported. That is a hard constraint of the
physics engine, not a shortcut: cannon resolves box and convex-hull contacts
properly, but its triangle meshes only collide reliably with spheres and
rays, so a concave collider would let truck bodies pass straight through.
Concave shapes have to be built from several convex pieces.
"""

import math

from mathutils import Vector

from .convert import box_yaw_degrees, convert_position, local_bounds, world_centre

# How far a vertex may sit outside a face plane before the mesh is judged
# concave. Loose enough to tolerate modelling noise, tight enough to catch a
# genuine dent.
CONVEX_TOLERANCE = 1e-4


def triangulated_faces(mesh):
    """Triangle index triples for a mesh, whatever its n-gons look like."""
    mesh.calc_loop_triangles()
    return [tuple(tri.vertices) for tri in mesh.loop_triangles]


def convexity_report(vertices, faces):
    """
    Check that every vertex lies behind every face plane.

    Returns the worst outward excursion in metres; anything meaningfully
    above zero means the mesh is concave and will not collide correctly.
    """
    worst = 0.0
    if len(vertices) < 4 or len(faces) < 4:
        return math.inf

    for face in faces:
        a, b, c = (vertices[i] for i in face)
        normal = (b - a).cross(c - a)
        if normal.length < 1e-9:
            continue  # degenerate triangle, nothing to test against
        normal.normalize()
        offset = normal.dot(a)
        for vertex in vertices:
            worst = max(worst, normal.dot(vertex) - offset)
    return worst


def collider_from_object(obj, depsgraph, problems):
    """
    Build one collider entry from a tagged object.

    Returns None (and appends to `problems`) when the object cannot be turned
    into something the runtime will accept.
    """
    shape_kind = obj.mtm.collider_shape

    if shape_kind == "box":
        size, _ = local_bounds(obj)
        centre = world_centre(obj)
        return {
            "name": obj.name,
            "pos": convert_position(centre),
            # Blender local Y is depth (game Z) and local Z is up (game Y).
            "size_xyz": [round(size.x, 4), round(size.z, 4), round(size.y, 4)],
            "rotation": box_yaw_degrees(obj.matrix_world),
            "kind": "box",
        }

    if obj.type != "MESH":
        problems.append(f"Collider '{obj.name}' is set to Convex Hull but is not a mesh.")
        return None

    evaluated = obj.evaluated_get(depsgraph)
    mesh = None
    try:
        mesh = evaluated.to_mesh()
        if mesh is None or len(mesh.vertices) < 4:
            problems.append(f"Collider '{obj.name}' has fewer than 4 vertices.")
            return None

        local_verts = [v.co.copy() for v in mesh.vertices]
        faces = triangulated_faces(mesh)
        if len(faces) < 4:
            problems.append(f"Collider '{obj.name}' has fewer than 4 faces.")
            return None

        excursion = convexity_report(local_verts, faces)
        if excursion > CONVEX_TOLERANCE:
            problems.append(
                f"Collider '{obj.name}' is concave by {excursion:.3f}m. "
                "The physics engine cannot resolve concave collision — split it "
                "into convex pieces, or use a Box collider instead."
            )
            return None

        # Bake scale into the vertices and convert to game axes. Rotation and
        # translation stay on the collider entry so the runtime can place it.
        scale = obj.matrix_world.to_scale()
        vertices = []
        for v in local_verts:
            scaled = Vector((v.x * scale.x, v.y * scale.y, v.z * scale.z))
            vertices.extend([round(scaled.x, 4), round(scaled.z, 4), round(-scaled.y, 4)])

        # Mirroring the Y axis in the conversion reverses triangle winding, so
        # flip it back or every face plane points the wrong way and the hull
        # comes out inside-out.
        wound = [[int(f[0]), int(f[2]), int(f[1])] for f in faces]

        return {
            "name": obj.name,
            "pos": convert_position(obj.matrix_world.translation),
            "rotation": box_yaw_degrees(obj.matrix_world),
            "kind": "convex",
            "vertices": vertices,
            "faces": wound,
        }
    finally:
        if mesh is not None:
            evaluated.to_mesh_clear()


def build_colliders(scene, depsgraph, collect, problems):
    """Export every COLLIDER-tagged object into track JSON form."""
    colliders = []
    for obj in collect(scene, "COLLIDER"):
        entry = collider_from_object(obj, depsgraph, problems)
        if entry is None:
            continue

        if entry["kind"] == "box":
            colliders.append(
                {
                    "name": entry["name"],
                    "pos": entry["pos"],
                    "rotation": entry["rotation"],
                    "shape": {"kind": "box", "size": entry["size_xyz"]},
                }
            )
        else:
            colliders.append(
                {
                    "name": entry["name"],
                    "pos": entry["pos"],
                    "rotation": entry["rotation"],
                    "shape": {
                        "kind": "convex",
                        "vertices": entry["vertices"],
                        "faces": entry["faces"],
                    },
                }
            )
    return colliders
