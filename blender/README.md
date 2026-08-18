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
| Collider | Mesh | An invisible collision volume |
| Scenery Mesh | Mesh | Visual geometry exported into the track's `.glb` |

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
8. Model any custom geometry, tag it **Scenery Mesh**, and give it collision
   (see below).
9. **Validate Track**, then **Export Track**.

Export writes the JSON to the path in the Export panel, and a matching `.glb`
of the scenery beside it. Copy **both** into the game's `public/content/` and
add the JSON to `manifest.json`.

## Collision

Colliders are invisible volumes the trucks hit. They are separate from the
scenery mesh on purpose: collision should almost always be simpler than what
you see. A detailed building is best fenced by two boxes — faster to simulate
and far more predictable to drive against than its own geometry.

Select your scenery and use **Collider From Selection**, choosing:

- **Box** — the object's oriented bounding box. Cheapest, most predictable,
  and the right answer for most things.
- **Convex Hull** — the mesh itself, which must already be convex.

The source object is tagged **Scenery Mesh** automatically so it still gets
drawn. Colliders are created wireframe, excluded from renders, and therefore
kept out of the scenery `.glb`.

### Only convex shapes work, and this matters

The physics engine resolves box and convex-hull contacts properly, but its
triangle meshes only collide reliably against spheres and rays. A concave
collider will *look* fine, export fine, and load fine — and then let truck
bodies drive straight through it at speed. Because the symptom appears a long
way from the cause, the exporter refuses to write one.

**Check Colliders** tests every convex hull and tells you, in metres, how far
from convex it is. To collide a concave shape — an archway, an L-shaped
building — split it into convex pieces and give each its own collider.

### Seeing what you've tagged

**Colour By Role** tints every tagged object by its role and switches the
viewport to object colours. **Select Untagged Meshes** finds geometry that
would be silently skipped at export.

### Coordinates

Blender is Z-up with +Y forward; the game is Y-up with -Z forward. The exporter
converts everything (`convert.py`), using the same mapping glTF does. You never
need to rotate your scene to compensate — model the way you normally would.

Colours are converted from Blender's linear space to sRGB hex on the way out,
so what the colour picker shows is what the game draws.

## Building a vehicle

There are two ways to build a truck.

**Procedural** — pick a style and a palette and the game builds the body from
primitives. No modelling, and it always fits the physics rig.

**Modelled** — build your own body and wheel against the reference rig and
export them as a `.glb` the game uses instead.

### Both paths start the same way

1. Open the **Vehicle** panel and load the Light or Heavy preset.
2. Dial in the physics: mass, wheel size, axle positions, suspension.
3. **Build Reference Rig** draws what the simulation actually believes — the
   chassis collision box, the wheels at full droop, resting height and full
   compression, the ground plane, and the centre of mass. It reports the
   wheelbase, track, ride height, clearance and resting squat.
4. Watch the **Response** panel as you work. It shows what the numbers
   actually produce — ride frequency, rebound and compression damping ratios
   with a plain-language verdict, ride height, resting squat, remaining bump
   travel, launch acceleration, and how close the truck runs to lifting its
   nose under power. These are the figures that decide how it feels; the
   sliders above are just their inputs.
5. **Validate Vehicle** catches the settings that make a truck undriveable:
   suspension too soft for the mass, a chassis box reaching below the wheels.

You can drag the reference wheels around and press **Read Back From Rig** to
pull the axle positions back into the settings.

### Modelling your own body

The rig creates two slots: `MTM_Body` and `MTM_Wheel`. Either rename your
meshes to match, or parent whole assemblies under the empties of those names.

- **The body must be built around the centre of mass** — the red axes marker,
  not the ground. That origin is what the runtime positions the truck by, so
  a body modelled sitting on the floor will end up buried.
- **The wheel must be modelled at the world origin**, and only once. The game
  places all four copies itself from the physics rig; any offset you build in
  is applied on top of that.
- Check the body clears the wheels through their whole stroke — the blue
  droop and bump rings show the extremes.

**Fit Body To Chassis** scales and centres a body to the chassis box, fitting
to the tightest axis so proportions survive. **Check Model Alignment** reports
a body sitting above or below the centre of mass, a wheel modelled off-origin,
and a wheel whose radius disagrees with the physics.

Then **Export Model (.glb)**, which also fills in the **Model** path, and
**Export Vehicle** to write the JSON. Copy both into `public/content/`.

Leave the **Model** path blank to go back to the procedural body.

### Tuning notes


- **Engine force** is per wheel, applied to all four. Drive is applied at the
  contact patch, so the front wheels lift once the total exceeds
  `weight x (COM-to-rear-axle) / (COM height)` — around 27kN on the stock
  trucks. Stay meaningfully under it.
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
python3 blender/tests/test_convert.py    # coordinate conversion
python3 blender/tests/test_collision.py  # collider convexity check
python3 blender/tests/test_handling.py   # derived handling numbers
```
