# SPDX-License-Identifier: MIT
"""
MTM Tools — Blender add-on for authoring Monster Truck Madness content.

Install: Edit > Preferences > Add-ons > Install..., pick the zipped
`mtm_tools` folder (or drop the folder into your Blender addons directory),
then enable "MTM Tools". The panels appear in the 3D viewport sidebar
(press N) under the "MTM" tab.

What it exports:
  * Tracks  -> .mtmtrack.json   (road spline, terrain, walls, props, gates)
  * Vehicles-> .mtmvehicle.json (stats, physics, look)

Both formats are documented in `src/game/formats.ts`; this add-on writes the
same shapes the runtime reads. Blender is Z-up and the game is Y-up, so all
coordinates are converted on export — see `convert_position`.
"""

bl_info = {
    "name": "MTM Tools",
    "author": "Monster Truck Madness",
    "version": (1, 0, 0),
    "blender": (3, 0, 0),
    "location": "View3D > Sidebar (N) > MTM",
    "description": "Author tracks and vehicles for Monster Truck Madness",
    "category": "Game Engine",
}

import importlib
import sys

from . import (
    props,
    ops_track,
    ops_preview,
    ops_collision,
    ops_vehicle,
    export_track,
    export_vehicle,
    ui,
)

_MODULES = (
    props,
    ops_track,
    ops_preview,
    ops_collision,
    ops_vehicle,
    export_track,
    export_vehicle,
    ui,
)


def register():
    # Re-import on reload so edits land without restarting Blender.
    for module in _MODULES:
        if module.__name__ in sys.modules:
            importlib.reload(module)
    for module in _MODULES:
        module.register()


def unregister():
    for module in reversed(_MODULES):
        module.unregister()


if __name__ == "__main__":
    register()
