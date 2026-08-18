# Monster Truck Madness

A web arcade racer in the spirit of the 1996 PC original: low-resolution
rendering, dithered 16-bit colour, fog you can taste, and trucks with far too
much suspension travel.

Everything you see is generated at runtime. There are no art assets — terrain,
textures, trucks and scenery are all built from code, and tracks and vehicles
are plain JSON. A Blender add-on (`blender/`) exports both formats.

```bash
npm install
npm run dev      # http://127.0.0.1:5173
npm run build    # typecheck + production bundle into dist/
```

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
| Pause | Esc | Start |

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
    Input.ts           keyboard + gamepad, mapped to named actions
    Textures.ts        procedural 64x64 surface/wall/sky textures
    Noise.ts           seeded PRNG and value noise
    Audio.ts           synthesised engine, tyre noise and impacts
  game/
    formats.ts         MTMTrack / MTMVehicle schemas (the Blender contract)
    RoadPath.ts        racing line: road ribbon, terrain carve, AI path
    Terrain.ts         heightfield mesh + cannon collision from one array
    Track.ts           assembles scene, physics bodies, gates, spawns
    Props.ts           low-poly scenery
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

Two things about `RaycastVehicle` cost real debugging time and are worth
knowing before changing `Vehicle.ts`:

- **`axleLocal` must be `(1, 0, 0)`.** Cannon derives the side-friction axle
  from a hardcoded `directions[indexRightAxis]`, not from the vector you pass.
  Any other value leaves the steering geometry and the friction axis mirrored;
  the wheels then fight each other and roll the truck onto its roof under
  straight-line acceleration.
- **`updateWheelTransform` clears `isInContact`** as its first act, so wheel
  contact must be latched immediately after `world.step` and before the meshes
  are synced. Reading it later always reports "airborne".

Also: `Body.applyForce`'s second argument is an offset *from the centre of
mass*, not a world point. Passing a world position turns a small downforce into
an enormous torque.

## Adding content

Tracks and vehicles are data. Drop exported JSON into `public/content/` and
list it in `public/content/manifest.json`:

```json
{
  "tracks": ["my-track.mtmtrack.json"],
  "vehicles": ["my-truck.mtmvehicle.json"]
}
```

Custom entries appear in the select screens next to the built-ins, and an entry
whose `id` matches a built-in replaces it — handy for iterating on a stock
course. Loading is best-effort: a malformed file is skipped with a console
warning rather than stopping the game.

The two example files in `public/content/` show the expected shape.

See [`blender/README.md`](blender/README.md) for the authoring tools.

## Tests

```bash
npm run typecheck                     # strict TypeScript
python3 blender/tests/test_convert.py  # Blender <-> game coordinate conversion
```

The coordinate tests matter more than they look: the failure mode of a wrong
axis is a silently mirrored track that seems fine until you drive it.

## Steam

The renderer, input and audio are already isolated behind small interfaces, and
the game has no server dependency, so wrapping the build in Electron or Tauri
is the expected path to a desktop release. Gamepad input is already handled
through the standard mapping.
