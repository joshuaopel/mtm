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
| Terrain | Any | Sets the terrain patch size; if it is a mesh and Terrain Source is *Sculpted*, it also becomes the ground |
| Blocker Wall | Mesh | A solid collision box |
| Prop | Empty or mesh | Scenery, optionally solid |
| Spawn Point | Empty | A start-grid slot |
| Checkpoint | Empty | An ordered gate |
| Terrain Feature | Empty | A hill, crater or plateau |
| Collider | Mesh | An invisible collision volume |
| Scenery Mesh | Mesh | Visual geometry exported into the track's `.glb` |

### You do not model the terrain or the road

This trips everyone up once, so it is worth stating plainly: **there is no road
mesh and no terrain mesh in your .blend, and you are not supposed to make one.**

The road you drive on is lofted along the spline by the game at load time, and
the ground is generated from noise plus the features you place. A track file is
a recipe, not geometry. So the authoring order is:

1. Draw the **road curve**.
2. Place **Terrain Feature** empties to shape the land around it.
3. Press **Build Course Preview** to see the result.

You do not "apply a spline over a terrain" — the road carves the terrain, not
the other way round.

### The course preview

The **Course Preview** panel builds `MTM_Preview_Terrain` and
`MTM_Preview_Road` as real meshes, using a Python port of the game's own
generation code (`generate.py`, pinned to the TypeScript by
`tests/test_generate.py`). What you see is the ground you will drive on, at the
elevation you will drive it.

- Preview meshes carry no role, so the exporter ignores them.
- They are not selectable, so they never get in the way of the things you are
  actually placing.
- They do not update by themselves. Move the curve, change a feature, change
  the seed — press **Build Course Preview** again.
- **Preview Resolution** (in the operator's redo panel, bottom-left) only
  affects what Blender has to draw. The exported track uses **Segments**.

**Drop To Terrain** snaps the selected objects down onto that surface, which is
the fastest way to get props and walls sitting on sloped ground.

### Terrain source: generated or sculpted

The **Terrain** box has a **Terrain Source** switch:

- **Generated** (default) — noise plus features, built at load time. The
  terrain object only needs to be an Empty; its bounds set the patch size.
  Nothing to model, and the track file stays a couple of kilobytes.
- **Sculpted Mesh** — give a *mesh* the Terrain role and sculpt it. At export
  it is sampled onto the runtime's height grid by casting rays straight down,
  and the result is written into the track JSON as a heightmap.

Sculpted terrain is a heightfield, which has two consequences you need to know
before you model: **overhangs, caves and vertical cliff faces cannot be
represented** (each bakes to its topmost surface, and the truck drives over the
top), and the file grows — 256 segments is about 340KB of base64. **Bake
Resolution** trades detail against size; the game resamples to the track's own
**Segments** either way.

**Carve Road Into Terrain** stays on by default, so the road is still flattened
into your sculpt. Two things follow from that, both worth knowing before you
spend an evening modelling:

- The carve blends from road level back to your ground over the **shoulder**
  distance. If your sculpt is 15m above the road and the shoulder is 5m, that
  is a 15m step in 5m — the road ends up at the bottom of a trench. Sculpt the
  land to roughly follow the road's elevation, and give a sculpted track a
  generous shoulder.
- Turning the carve **off** means the ground under the road is whatever you
  modelled, full stop. That only works if your sculpt already contains the road
  bed at the spline's own elevation — otherwise the trucks spawn inside a hill
  and start the race on their roofs. Build the preview, look at where the road
  ribbon sits relative to your mesh, and sculpt to it.

In sculpted mode the preview builds only the road ribbon — your mesh is already
the ground, and generating a second one would bury it.

### A typical session

1. **New Track Scaffold** — creates an oval road curve, a terrain bounds box
   and a sun lamp, and builds the course preview.
2. Edit `MTM_Road` in Edit Mode to shape the course. Only its shape matters;
   the game re-splines the exported points.
3. Set **Road Width**, **Shoulder** and **Point Spacing** in the Road panel.
   The terrain is flattened under the road and blended back out across the
   shoulder, so a wide shoulder gives forgiving run-off.
4. Shape the landscape by adding Empties tagged **Terrain Feature**. A
   feature's radius comes from its X scale, so you size it by scaling it in the
   viewport. Rebuild the preview to see what you did.
5. **Build Start Grid** and, if you want hand-placed gates, **Place
   Checkpoints**. Both are optional — without them the game generates a grid
   behind the line and gates around the road.
6. Fence the course. Leave **Auto Barriers** on to have the game generate edge
   walls at load time (cheap, and the file stays small), or press **Generate
   Barrier Walls** to bake them as real objects you can then edit. Baking turns
   auto-barriers off so the course is not fenced twice.
7. **Scatter Props** to dress the roadside, then **Drop To Terrain** to settle
   them onto the ground.
8. Model any custom geometry, tag it **Scenery Mesh**, and give it collision
   (see below).
9. **Validate Track**, then **Export Track**.

Export writes the JSON to the path in the Export panel, and a matching `.glb`
of the scenery beside it. Copy **both** into the game's `public/content/`.

### If the preview will not build

- *"No object has the 'Road Spline' role"* — nothing is tagged as the road.
  Select your curve and use **Tag Selected → Road Spline**.
- *"...is marked as the road but is not a curve"* — the role is on a mesh.
  The road has to be a curve object.
- *"Road resampled to fewer than 3 points"* — **Point Spacing** is larger than
  your course. Lower it.
- The preview appears but is flat — check **Amplitude** is not zero and that
  your Terrain Feature empties are actually tagged.

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
python3 blender/tests/test_generate.py   # terrain and road generation
python3 blender/tests/test_heightmap.py  # sculpted-terrain bake
```

`test_generate.py` is the one that keeps the preview honest. It pins the noise
and the road spline to reference values printed from the game's own code —
`src/core/Noise.ts` and three.js's `CatmullRomCurve3` — so if a formula changes
on one side and not the other, the tests say so instead of the preview quietly
showing you a course the game will not build.
