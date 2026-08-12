# MTM Tools — Blender add-on

Authoring tools for Monster Truck Madness tracks and vehicles. Exports the
JSON formats defined in `src/game/formats.ts`.

Tested against Blender 3.x and 4.x.

## Install

1. Zip the `mtm_tools` folder (`cd blender && zip -r mtm_tools.zip mtm_tools`),
   or copy the folder straight into your Blender `scripts/addons` directory.
2. **Edit > Preferences > Add-ons > Install…**, pick the zip.
3. Enable **MTM Tools**.
4. The panels live in the 3D viewport sidebar — press <kbd>N</kbd>, **MTM** tab.

## Building a track

The add-on works by tagging objects with a **role**. Only tagged objects are
exported, so blockouts, references and lighting rigs can live in the same file
without leaking into the track.

| Role | Object type | Becomes |
| --- | --- | --- |
| Road Spline | Curve | The racing line, road surface and AI path |
| Terrain Bounds | Any | Sets the terrain patch size |
| Blocker Wall | Mesh | A solid collision box |
| Prop | Empty or mesh | Scenery, optionally solid |
| Spawn Point | Empty | A start-grid slot |
| Checkpoint | Empty | An ordered gate |
| Terrain Feature | Empty | A hill, crater or plateau |

A typical session:

1. **New Track Scaffold** — creates an oval road curve, a terrain bounds box
   and a sun lamp.
2. Edit `MTM_Road` in Edit Mode to shape the course. Only its shape matters;
   the game re-splines the exported points.
3. Set **Road Width**, **Shoulder** and **Point Spacing** in the Road panel.
   The terrain is flattened under the road and blended back out across the
   shoulder, so a wide shoulder gives forgiving run-off.
4. Shape the landscape by adding Empties tagged **Terrain Feature**. Terrain is
   generated procedurally at runtime rather than baked from a mesh, so features
   are how you sculpt it. A feature's radius comes from its X scale, so you
   size it by scaling it in the viewport.
5. **Build Start Grid** and, if you want hand-placed gates, **Place
   Checkpoints**. Both are optional — without them the game generates a grid
   behind the line and gates around the road.
6. Fence the course. Leave **Auto Barriers** on to have the game generate edge
   walls at load time (cheap, and the file stays small), or press **Generate
   Barrier Walls** to bake them as real objects you can then edit. Baking turns
   auto-barriers off so the course is not fenced twice.
7. **Scatter Props** to dress the roadside.
8. **Validate Track**, then **Export Track**.

Export writes to the path in the Export panel. Copy the result into the game's
`public/content/` and add it to `manifest.json`.

### Coordinates

Blender is Z-up with +Y forward; the game is Y-up with -Z forward. The exporter
converts everything (`convert.py`), using the same mapping glTF does. You never
need to rotate your scene to compensate — model the way you normally would.

Colours are converted from Blender's linear space to sRGB hex on the way out,
so what the colour picker shows is what the game draws.

## Building a vehicle

Truck bodies are generated procedurally by the game from a style and a palette,
so there is no mesh to model — a vehicle is a set of numbers.

1. Open the **Vehicle** panel and load the Light or Heavy preset as a start.
2. **Build Proxy Rig** creates wireframe boxes and wheel cylinders in the
   viewport from the current settings, with a ground plane so ride height is
   readable. Move the wheels around and press **Read Back From Proxy** to pull
   the axle positions back into the settings.
3. Dial in physics, then pick a **Style** (silhouette family) and **Livery**.
4. **Validate Vehicle** checks for the mistakes that make a truck undriveable —
   suspension too soft for the mass, a chassis box that reaches below the
   wheels, and so on.
5. **Export Vehicle**.

### Tuning notes

- **Engine force** is per wheel, applied to all four. Very high values make the
  truck wheelie and, past a point, backflip.
- **Suspension stiffness** must be matched to mass. Cannon's spring force is
  `stiffness x compression x mass` against 2g of gravity, so a heavy truck on
  soft springs sits on its belly. The validator flags this.
- **Roll influence** is inverted from what the name suggests: `0` is very hard
  to roll over, `1` rolls easily. Keep it low (0.05–0.1).
- **Air control** is an angular acceleration in rad/s². Around 2 is subtle;
  above 4 the truck can flip itself mid-jump.

## Tests

The coordinate conversion has unit tests that run without Blender:

```bash
python3 blender/tests/test_convert.py
```
