# Monster Truck Madness

A web arcade racer in the spirit of the 1996 PC original: low-resolution
rendering, dithered 16-bit colour, fog you can taste, and trucks with far too
much suspension travel.

Tracks and vehicles are plain JSON, and everything has a procedural fallback —
terrain, textures, trucks and scenery can all be generated from code, so a
playable track is a few lines of data. When you want real geometry instead,
the Blender add-on in `blender/` is the level and vehicle editor: model it,
tag it, export it, and the game loads it.

## Running it

**Windows:** double-click `run.bat`.
**macOS / Linux:** `./run.sh`

Either one checks Node is present and new enough, installs the dependencies
the first time, starts the server and opens your browser. Leave the window
open while you play.

If you would rather drive it yourself:

```bash
npm install
npm run dev      # http://127.0.0.1:5173
npm run build    # typecheck + production bundle into dist/
npm run preview  # serve that bundle
```

Node 20.19 or newer. Nothing else to install — no build step for content, no
asset pipeline, no database.

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Accelerate | Up / W | Right trigger |
| Brake, then reverse | Down / S | Left trigger |
| Steer | Left / Right, A / D | Left stick |
| Handbrake | Space | X |
| Reset truck | R | Y |
| Change camera | C | RB |
| Look back | B | LB |
| Toggle rear-view mirror | M | Select |
| Debug & tuning overlay | F1 | — |
| Pause | Esc | Start |

## Suspension and tuning

The suspension is deliberately underdamped, so trucks visibly rebound. The
stock baseline runs a 1.42Hz ride frequency at a 0.27 rebound damping ratio,
which from a 3.5m drop gives a clear quarter-metre bounce.

Bounce is not free. Measured over a 75-second autopilot lap, the flip count
roughly doubles going from 1.2 rebound damping to 0.95, because a
fast-extending spring flicks the truck sideways on landing. The stock values
sit at the point where the rebound is clearly visible and the truck still
completes laps without pitching over. If you want it wilder, that is the knob —
and the tradeoff.

Every physics number is per-vehicle and editable in the JSON or the Blender
panel: mass, spring rate, rebound and compression damping, travel, wheel size,
axle positions, engine force, top speed, steering rate and lock, grip, roll,
downforce and mid-air control.

Raw numbers don't tell you how a truck will feel, so both the **F1 overlay**
and the Blender **Response** panel show the derived figures that do — ride
frequency, damping ratios with a plain-language verdict, ride height, resting
squat, remaining bump travel, launch acceleration, and how close the truck runs
to lifting its nose. The overlay adds live per-wheel suspension travel, which
goes red when a spring hits its bump stop.

## Trucks and terrain

These are monster trucks and the numbers say so: 66-inch tyres, a chassis about
two metres up, over a metre of suspension travel, and soft enough springs that
roughly a quarter-metre of squat is visible as the body pitches and rolls. The
mesh matches — beam axles slung under a lifted body, with coil-overs and radius
rods bridging the gap.

The tuning constraint worth knowing: drive is applied at the contact patch, so
the front wheels lift once total drive exceeds `weight x (COM-to-rear-axle) /
(COM height)`, about 27kN on the stock trucks. Staying under it gives a truck
that squats and goes light at the front without looping onto its roof.

Courses climb and drop tens of metres, and each carries table-top jumps built
from tightly-spaced spline points — widely-spaced points can only ever produce
rolling hills, because the Catmull-Rom re-spline smooths everything between
them. Verges are wide so the elevation eases out into the landscape instead of
leaving the road on a wall of dirt, and barrier walls pitch to follow the
gradient rather than staying level while the ground slopes past.

## The rear-view mirror

A second pass over the scene from a backward-facing camera above the cab,
rendered into its own small target and composited at the top of the screen,
flipped horizontally like real glass. It costs what its pixel count costs,
which is why the target is 256x80; toggle it with **M** if you want the frames
back. It always looks astern of the truck, independent of the chase camera, so
holding "look back" doesn't aim it forwards.

## Getting unstuck

Any truck — player or AI — that goes nowhere for five seconds is put back on
the racing line facing the right way. Inverted trucks are picked up sooner, at
two and a half. It applies to the whole field deliberately: an AI truck wedged
against a barrier is both a dead opponent and a permanent obstacle for
everyone else.

## The retro look

The scene renders into a 320x240 offscreen target with nearest-neighbour
filtering, then blits to the display through a shader that converts to display
space, applies a 4x4 Bayer dither and quantises to 16 levels per channel. The
geometry is genuinely rasterised at low resolution, which is where most of the
period character comes from — a CSS filter over a crisp render does not look
the same. Resolution and colour depth are adjustable under **Controls**.

Everything else follows from the era: flat shading, no antialiasing, no shadow
maps, exponential fog matched to the horizon colour, and a far plane derived
from fog density so nothing ever pops in.

## Architecture

```
src/
  core/
    RetroRenderer.ts   low-res render target, dither + quantise post pass
    Assets.ts          glTF loading, caching and retro material conversion
    Input.ts           keyboard + gamepad, mapped to named actions
    Textures.ts        procedural 64x64 surface/wall/sky textures
    Palette.ts         16-colour vehicle atlas, shared with the Blender tools
    Music.ts           streamed background music with fades
    Noise.ts           seeded PRNG and value noise
    Audio.ts           synthesised engine, tyre noise and impacts
  game/
    formats.ts         MTMTrack / MTMVehicle schemas (the Blender contract)
    RoadPath.ts        racing line: road ribbon, terrain carve, AI path
    Terrain.ts         heightfield mesh + cannon collision from one array
    TerrainPaint.ts    four-layer ground blend, weights from rules or painting
    Track.ts           assembles scene, physics bodies, gates, spawns
    Props.ts           low-poly scenery, ramps, billboards, flags
    PropShapes.ts      convex hulls for the props you drive on
    StaticBody.ts      static physics bodies with a correct broadphase AABB
    Vehicle.ts         raycast vehicle + arcade control layer
    TruckMesh.ts       procedural truck bodies, liveries, wheels
    AIDriver.ts        waypoint AI with difficulty profiles
    Race.ts            laps, checkpoint order, positions, timing
    RaceSession.ts     fixed-step simulation loop tying it together
    ContentLoader.ts   merges Blender exports with the built-in roster
  ui/                  screens, HUD, course maps
  data/                built-in tracks and vehicles
```

Physics runs at a fixed 60 Hz step, decoupled from rendering, so handling never
depends on frame rate.

### One source of truth for the ground

`Terrain` builds a single height array and derives three things from it: the
visible mesh, the cannon `Heightfield` the wheels ray-cast against, and the
height queries used to place props and respawn trucks. Deriving them separately
is how you end up with trucks that float or sink, and it is miserable to debug
after the fact.

`RoadPath` plays the same role for the racing line: the visible road ribbon,
the terrain flattening beneath it, the AI path and race progress all read from
one resampled spline. If those disagreed, the AI would drive where the road
isn't.

### Notes on cannon-es

Three things cost real debugging time and are worth knowing before changing
`Vehicle.ts` or adding static geometry:

- **`axleLocal` must be `(1, 0, 0)`.** Cannon derives the side-friction axle
  from a hardcoded `directions[indexRightAxis]`, not from the vector you pass.
  Any other value leaves the steering geometry and the friction axis mirrored;
  the wheels then fight each other and roll the truck onto its roof under
  straight-line acceleration.
- **A static body's AABB is computed once, at the origin.** Passing `shape` to
  the `Body` constructor computes the bounding box immediately — before the
  body has been positioned — and clears `aabbNeedsUpdate`. Only `integrate()`
  re-flags it, and a static body never integrates, so the box stays at 0,0,0
  for the lifetime of the world. Every broadphase query is gated on it, so the
  body silently never collides and never appears in a raycast, while looking
  perfectly correct in the scene. `StaticBody.ts` exists solely to call
  `updateAABB()` after positioning. This one had every barrier wall, solid prop
  and collider in the game inert without anyone noticing.
- **`updateWheelTransform` clears `isInContact`** as its first act, so wheel
  contact must be latched immediately after `world.step` and before the meshes
  are synced. Reading it later always reports "airborne".

Also: `Body.applyForce`'s second argument is an offset *from the centre of
mass*, not a world point. Passing a world position turns a small downforce into
an enormous torque.

## Authoring

The Blender add-on in `blender/` is the editor for both tracks and vehicles.
See [`blender/README.md`](blender/README.md) for the full workflow; the short
version:

**Levels.** [`docs/making-tracks.md`](docs/making-tracks.md) walks the whole
thing end to end. In short: tag objects with a role — road spline, collider,
scenery, wall, prop, spawn, checkpoint, terrain feature — and export. Tools generate start
grids, checkpoint runs, barrier walls and roadside scatter along the road.
Scenery meshes go out as a `.glb` beside the JSON.

You don't model the road or the ground: both are generated from the track file
at load time. **Build Course Preview** builds them as meshes in Blender, using
a Python port of the game's own generation code, so you author against the
terrain you will actually drive on.

If you'd rather sculpt by hand, switch Terrain Source to **Sculpted Mesh**. A
Geometry Nodes modifier carves the road into your sculpt and re-evaluates as
you drag the spline, so the road cuts its own corridor while you work; the
sculpt itself is never edited. The exporter bakes the evaluated mesh into the
heightfield.

**Ground textures** blend up to four surfaces across the terrain. By default the
game picks them from the surface theme — rock on anything steeper than 32°, a
worn verge along the racing line — so every track gets layered ground for free.
Choose your own layers and vertex-paint the terrain when you want to say exactly
where each one goes.

**Collision** is authored separately from what you see, and must be convex:
the physics engine resolves boxes and convex hulls properly but not concave
triangle meshes, which would silently let trucks through. The exporter checks
this and refuses to write a collider that would fail.

**Vehicle colours.** A modelled truck is painted from a 4x4 atlas of sixteen
muted colours: one material, one texture, and a part's colour is which cell its
UVs point at. Select faces in Blender, click a swatch. The engine generates the
sheet itself and substitutes it for whatever a `.glb` ships with, so changing a
colour updates every vehicle ever exported.

**Vehicles.** The reference rig draws what the simulation believes — chassis
box, wheel positions through their full travel, ground plane, centre of mass —
so you can model against it. Supply a body and one wheel; the game instances
the wheel four times and places them from the physics rig. Or skip modelling
entirely and use the procedural body.

For where the tooling is going, see [`docs/engine-tools.md`](docs/engine-tools.md).

## Music

Drop an audio file into `public/content/` and it plays — `.mp3`, `.ogg`,
`.m4a`, `.wav`, `.opus` or `.flac`, no naming convention and no manifest.
Several files become a playlist. A track can name its own song with a `music`
field, and anything else carries on playing across screen changes rather than
restarting. **MUSIC** and **MUSIC VOLUME** live under Controls.

It streams through an audio element rather than the Web Audio graph the engine
noise uses: a song is minutes long, and decoding it would hold the whole thing
in memory as raw samples and stall the first race.

## Adding content

**Drop the file in `public/content/` and it appears.** Anything named
`*.mtmtrack.json` or `*.mtmvehicle.json` is discovered automatically — no
manifest to edit. A `manifest.json` is still read if present, for files that
don't follow the naming convention; it adds to the scan rather than replacing
it.

An entry whose `id` matches a built-in replaces it, which is how you iterate on
a stock course. Loading is best-effort: a malformed file is skipped with a
console warning rather than stopping the game.

**Live reload.** With `npm run dev` running, editing a track, truck or model
reloads it immediately — including rebuilding the race you are currently
driving. No restart, no reselecting from the menus.

**Artwork.** Tracks can supply their own ground and road images instead of the
procedural textures:

```json
"environment": {
  "surface": "dirt",
  "artwork": {
    "ground": "content/my-dirt.png", "groundRepeat": 90,
    "road": "content/my-road.png",   "roadRepeatMetres": 8
  }
}
```

Both fall back to the procedural theme if the image is missing, so a broken
path costs you a texture rather than the track. Hand-modelled scenery arrives
as a `.glb` from the Blender exporter, textures included.

## Debug overlay

**F1** during a race draws what the simulation actually believes: collision
volumes straight out of the physics world (orange for static, cyan for truck
chassis), checkpoint gates, spawn points and the AI racing line. Because the
shapes come from the physics rather than the source data, a mismatch between
what you modelled and what you collide with shows up immediately.

It also opens a tuning panel — see below.

The examples in `public/content/` show the expected shape, including a
vehicle that loads its body and wheels from a glTF file.

## Tests

```bash
npm run typecheck                        # strict TypeScript
python3 blender/tests/test_convert.py    # Blender <-> game coordinate conversion
python3 blender/tests/test_collision.py  # collider convexity check
python3 blender/tests/test_handling.py   # derived handling numbers
python3 blender/tests/test_generate.py   # terrain and road generation
python3 blender/tests/test_heightmap.py  # sculpted-terrain bake
python3 blender/tests/test_palette.py    # vehicle colour atlas
python3 blender/tests/test_blender.py    # the add-on inside Blender (needs bpy)
```

These cover things whose failure mode is invisible: a wrong axis gives a
silently mirrored track, a concave collider exports and loads perfectly before
letting trucks drive through walls at speed, and a drifted generation port
gives you a Blender preview of a course the game will never build.

The first four stub `bpy` out and run anywhere. `test_blender.py` loads the
add-on into a real headless Blender (`pip install bpy` in a venv) and drives it
through scaffold, carve, paint and export. It skips itself when `bpy` is
missing, and it earns its keep: it immediately found that every scaffolded track
was exporting a 100m terrain patch for a 700m course, because an Empty reports
an all-zero bounding box and the size was read from `bound_box`.

## Steam

The renderer, input and audio are already isolated behind small interfaces, and
the game has no server dependency, so wrapping the build in Electron or Tauri
is the expected path to a desktop release. Gamepad input is already handled
through the standard mapping.
