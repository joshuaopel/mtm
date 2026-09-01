# Monster Truck Mania — Unity

A Unity port of the web game in the parent folder, built around a different
idea: **the track is generated in the editor, not at load time.** You drag the
spline, press Rebuild, and the ground is there in the scene — a real mesh you
can look at, sculpt, paint, drop props onto and drive on. What you see is what
ships.

Requires **Unity 6.5 (6000.5)** with **URP**.

---

## Installing it into your project

The `Assets/MonsterTruckMania` folder is self-contained. Copy it into your
Unity project's `Assets` folder:

```
C:\Unity Projects\MTM\My project\Assets\MonsterTruckMania\
```

Unity will import it and generate `.meta` files on first open. No packages
need adding — it uses only URP and UGUI, both of which the Universal 3D
template already includes.

Then, in Unity:

1. **Monster Truck Mania → Create Track In Scene**
2. **Monster Truck Mania → Add Retro Camera To Main Camera**
3. **Monster Truck Mania → Set Up Race In Scene**

That gives you a starter oval with terrain carved under it, materials wired
up, the 240p render pass running, and a six-truck race on it. Press Play and
drive. All three menu items are idempotent.

The trucks have no bodies yet — they are four raycast wheels under an
invisible box — which is deliberate: it means a course is driveable before
anything has been modelled, and the first thing you want to know about a new
track is whether it drives, not whether it looks right.

---

## Driving

| Action | Keyboard |
| --- | --- |
| Accelerate | Up / W |
| Brake, then reverse | Down / S |
| Steer | Left / Right, A / D |
| Handbrake | Space |
| Reset truck | R |
| Change camera | C |
| Look back | B |

A gamepad works through the default `Horizontal` and `Vertical` axes.

`PlayerDriver` is written against the legacy `UnityEngine.Input` class, so the
folder still needs no packages adding. If the project is set to **Input System
Package (New)** under Player → Active Input Handling, switch it to **Both** —
or replace that one component, since nothing else reads input.

Two global physics settings are owned by `RaceRunner` and applied while a race
is running: **gravity at 2g** (-19.6), so trucks land instead of floating, and
a **60Hz fixed step**, matching the original's simulation rate. Every
suspension, drive and grip number in the project is calibrated against both.
They are restored when the race stops, so entering play mode does not quietly
reconfigure your project.

---

## The trucks

Six of them, with the same numbers the web game ships — transcribed
mechanically from `src/data/vehicles.ts` rather than retyped. **Set Up Race In
Scene** writes each one out as a `VehicleAsset` you can edit in the inspector,
and leaves an existing asset alone so your tuning survives running the menu
item again.

The physics is a raycast vehicle: four rays, a spring and damper per corner,
and grip in proportion to the load on each wheel. Deliberately not
`WheelCollider` — the handling is tuned against a suspension whose force is
`(stiffness * compression - damping * closingSpeed) * mass`, and every tuning
number means something in those terms. `WheelCollider` has its own spring model
in its own units, so using it would mean re-tuning six trucks by feel and
losing the reference numbers that keep the ports honest.

One thing worth knowing before you tune: **`brakeForce` is an impulse cap, not
a force.** Drive contributes `engineForce * dt` per step and braking is capped
at `brakeForce` directly, which is how the original's solver handles them. That
is why 62 sits next to an engine force of 4200 and is not a typo — at 60Hz the
drive impulse is 70, so the two are comparable. Read `brakeForce` as newtons
and you get a truck with no brakes.

The derived numbers — ride frequency, damping ratios, resting squat, how close
the truck runs to lifting its nose — come from `Handling`, which is checked
against the web game's to twelve decimal places.

---

## The race

`RaceRunner` builds the grid, spawns the field, drives the AI and steps the
race director. Everything that decides anything is in `Runtime/Simulation`,
free of Unity and covered by the offline tests: gate order, lap times,
standings, and what each AI asks for.

Checkpoints and start slots are generated from the road rather than authored,
which is what makes a new track raceable the moment its spline exists. Gates
must be taken in sequence — that is what stops a truck cutting the infield and
claiming a lap — and they are deliberately generous, because they exist to
prove you went the long way round rather than to punish a wide line.

Any truck that goes nowhere for five seconds, or lands on its roof, is put back
at **the last gate it actually passed** — not at the nearest point on the
racing line, which would pay out whatever distance a shortcut across the
infield had covered. It applies to the whole field: an AI truck wedged against
a rock is both a dead opponent and a permanent obstacle for everyone else.

`RaceHud` draws position, lap, clock, running order and speed with IMGUI. That
is on purpose — a UGUI HUD is prefabs and layout groups and a font asset, none
of which can be authored outside the editor, and the point of this project is
that a track becomes driveable without any of that. Replace it with a canvas
when the game has art; nothing else depends on it.

---

## The track editor

Select the **Track** object. The inspector has a **Rebuild** button and four
tool modes.

### Spline

Drag the orange handles. The line drawn between them is the **actual generated
centreline**, sampled from the same code that carves the terrain — not an
approximation of it. The white lines are the road edges, the blue ones the
outer edge of the shoulder, which is how much landscape the road eats.

- **Shift-click** near a segment to insert a point there
- Select a point and press **Delete** to remove it
- **Auto** rebuilds when you release a handle. Turn it off on a large field.

This is why the project does not use Unity's Splines package: Splines is
Bézier, and the road is centripetal Catmull-Rom, ported line-for-line from the
web game. Authoring with one curve and building with another means the editor
shows you a road you are not going to get.

### Sculpt

Raise, lower, smooth or flatten. Hold **Ctrl** to invert.

Sculpting is stored as **offsets on top of the generated ground**, not as a
replacement for it. That is what lets you move the spline afterwards, or
change the seed, and keep your hand work — the generator rebuilds the base and
the offsets go back on top.

### Paint

Four layers, blended by vertex colour. Ground you have not painted falls back
to automatic rules: rock on slopes past 32°, a worn verge along the racing
line. So a fresh track already looks deliberate, and the brush is for saying
something specific rather than for doing all the work.

Layer textures and their tiling scale are on the track asset.

### Custom assets

Everything is ordinary Unity geometry, so props are ordinary prefabs — drag
them into the scene and place them. The terrain has a real MeshCollider, so
they can be snapped to it however you normally would.

---

## The PS1 look

Three separate pieces, because the look is not one effect:

**Vertex snapping** (`MTM_Retro.hlsl`) quantises vertices onto a low-resolution
screen grid. The console's rasteriser had no sub-pixel precision, so vertices
landed on whole pixels and geometry visibly wobbles as the camera moves. Set
`_SnapResolution` to 0 on anything that must not shimmer.

**Affine texture mapping** is the `noperspective` interpolator on the UVs. The
console had no perspective-correct texturing, which is why its textures swim
and shear across large polygons. Getting the real artifact from the hardware
interpolator is better than faking it in the fragment shader.

**Low-resolution rendering** (`RetroCamera`) renders the scene at 240p into a
point-filtered target and scales it up, then dithers and quantises to 32
levels per channel. The geometry is genuinely rasterised small — a filter over
a crisp modern render does not look the same.

Materials use `Monster Truck Mania/Terrain` for the ground and
`Monster Truck Mania/Prop` for everything else.

**Texture import settings matter more than the shaders.** For period-correct
assets: Point filtering, no mip maps, and small — 64×64 or 128×128. A 2K
texture through a PS1 shader still looks like a 2K texture.

---

## Tests

The generation core and the simulation — value noise, the Catmull-Rom spline,
the road resampler, the terrain field, the handling maths, the drive model, the
AI and the race director — have no `UnityEngine` dependency and compile
standalone, which is how they are tested:

```bash
cd unity/tests
dotnet run
```

175 checks against reference values printed from the original TypeScript. The
noise matches bit for bit; the curve matches three.js to 1e-9; the derived
handling numbers for all six trucks match to 1e-12.

Keeping the simulation out of `UnityEngine` is what makes this possible. The
race director is driven round a square loop by teleporting racers from gate to
gate, with no physics under it at all, because what is being checked is the
bookkeeping — progress across the start/finish line, a field classified mid-lap
when the player finishes — and those are exactly the cases you do not want to
be debugging through a running race.

That separation is deliberate. Three implementations of this maths now exist —
TypeScript for the web game, Python for the Blender add-on, C# here — and they
are only safe to have because all three are pinned to the same numbers.

---

## Layout

```
Assets/MonsterTruckMania/
  Runtime/
    Generation/      Pure C#, no Unity, offline-testable
      Vec3.cs          Double-precision vector
      Noise.cs         Value noise, bit-identical to the web game
      CatmullRomCurve.cs  Ported from three.js, line for line
      RoadPath.cs      Resampled centreline + spatial lookup
      TerrainField.cs  Height grid: noise, features, road carve
    Authoring/
      TrackAsset.cs    The track, as a ScriptableObject
      TrackBuilder.cs  Generation to Unity meshes
      TrackAuthoring.cs  The scene component with Rebuild
    Simulation/      Pure C#, no Unity, offline-testable
      VehicleSpec.cs   A truck's tuning numbers
      StockVehicles.cs The six-truck roster, from the web game
      Handling.cs      Derived numbers: ride frequency, damping, wheelie margin
      DriveModel.cs    The arcade control layer
      AIDriver.cs      Waypoint AI with difficulty profiles
      RaceCourse.cs    Gates and start grid, generated from the road
      RaceDirector.cs  Laps, checkpoint order, positions, timing
      Rng.cs           The web game's PRNG, so seeded choices match
    Vehicles/
      VehicleAsset.cs  A truck as an inspector-editable asset
      TruckController.cs  Raycast suspension and tyre forces
    Racing/
      RaceRunner.cs    Builds the grid, spawns the field, steps the race
      PlayerDriver.cs  Keyboard and gamepad
      ChaseCamera.cs   Follows the truck's yaw only
      RaceHud.cs       Position, lap, clock, order, speed
    Rendering/
      RetroCamera.cs   Low-res target and presentation
  Editor/
    TrackAuthoringEditor.cs  Handles, rebuild, sculpt, paint
    TrackSetupMenu.cs        One-click scene setup
  Shaders/
    MTM_Retro.hlsl     Shared vertex snap, dither, quantise
    MTM_Terrain.shader Four-layer ground
    MTM_Prop.shader    Everything else
    MTM_RetroBlit.shader  The screen pass
```

---

## Status

**Verified:** the generation core and the whole simulation layer — noise,
spline, road, terrain, handling maths, drive model, race director — by
compiling and running them against the original's reference values. 175 checks.

**Compile-checked only:** the Unity-facing code — `TruckController`,
`RaceRunner`, `PlayerDriver`, `ChaseCamera`, `RaceHud` and the setup menu. They
build cleanly against a stub of the API surface they use, which rules out
typos, wrong member names and signature mismatches, but is not the same as
Unity compiling them. Expect to fix something on first import.

**Not verified at all:** the older authoring components, the editor tooling and
the shaders, which predate that check.

**Not yet ported:** menus and a select screen, procedural truck bodies, engine
audio, the drop-in JSON content pipeline, and the mirror. The web game in the
parent folder still has all of that. What is here is a race you can drive.
