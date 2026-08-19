# Engine tools

Where the tooling stands, what it costs to extend, and what I'd build next.
This is a working document for deciding direction, not a commitment.

## What exists today

**Content is data, and drop-in.** Tracks and vehicles are JSON validated
against `src/game/formats.ts`. Put a `*.mtmtrack.json` or `*.mtmvehicle.json`
in `public/content/` and it is discovered by name — no manifest to maintain,
though one is still honoured for oddly-named files. A custom file whose `id`
matches a built-in replaces it, so a stock course can be iterated on without
renaming. Bad files are skipped with a console warning rather than breaking
the game.

**The edit loop is live.** With the dev server running, saving a track,
vehicle or model reloads it at once, rebuilding the race in progress. Model
caches and the browser's HTTP cache are both invalidated, so an edited `.glb`
really does come back changed.

**Tracks can carry their own artwork.** Ground and road images override the
procedural surfaces per track, and hand-modelled scenery arrives as a `.glb`
with its textures. Both fall back to the procedural theme if a file is
missing.

**Blender is the level editor.** Tag objects with a role — road spline,
collider, scenery, wall, prop, spawn, checkpoint, terrain feature — and the
exporter walks the scene and writes the JSON plus a `.glb` of the scenery.
Build tools generate start grids, checkpoint runs, barrier walls and roadside
scatter along the road. Colours-by-role and select-untagged make a big scene
readable.

**Blender shows you the course before you export it.** The road ribbon and the
generated terrain don't exist as geometry in the .blend — the game builds both
at load time — so authoring used to be editing a curve in empty space. The
Course Preview builds them as real meshes from a Python port of the game's own
generation code, verified against the TypeScript to within the float32 the
runtime stores heights in. If you would rather sculpt, a mesh tagged Terrain
bakes onto the same grid at export.

**Blender is the vehicle editor.** The reference rig draws the physics — the
chassis box, wheel positions at droop/rest/bump, the ground plane, and the
centre of mass — so you can model against what the simulation actually
believes. Model a body and one wheel, and the exporter writes a `.glb` the
runtime uses in place of the procedural truck.

**The engine loads real geometry.** `src/core/Assets.ts` loads and caches
glTF, converts imported materials to flat-shaded Lambert so they sit in the
same visual language as everything else, and hands out clones. Models are
fetched during the loading screen, before the (synchronous) race build.

**Validation is where the leverage is.** Both exporters refuse to write files
the game can't load, and warn about the things that produce a technically
valid file that plays badly: concave colliders, suspension too soft for the
mass, a body modelled off the centre of mass, scenery with no collision.

## The constraints worth knowing

These shape what tooling is worth building.

- **Collision must be convex.** cannon resolves box and convex-hull contacts
  properly; its triangle meshes only collide reliably with spheres and rays.
  A concave collider silently lets truck bodies through. Concave shapes have
  to be authored as several convex pieces — hence the convexity check in the
  exporter rather than a "just works" auto-collider.
- **The ground is a heightfield, whichever way it is authored.** One height
  array feeds the visible mesh, the physics heightfield and the height queries.
  The default is procedural — noise plus authored features — and sculpting is
  supported by baking a mesh onto that same grid at export, which is why
  overhangs and caves are out either way. The alternative was trimesh
  collision, and that runs straight into the convexity limit above.
- **Race construction is synchronous.** Everything from the network has to be
  resolved first. That's why there's a `collectModelUrls` pass.
- **The look is a budget, not a filter.** 320x240, flat shading, no shadows.
  Imported models get pulled towards that on load. High-poly art will render,
  but it will look out of place long before it runs slowly.

## What I'd build next, roughly in order of value

### ~~1. In-game live reload~~ — done
Editing anything in `public/content/` now rebuilds it immediately, including
the race you are driving. Drop-in discovery landed alongside it: files are
found by name, so there is no manifest to keep in step.

### ~~2. A debug overlay~~ — done
F1 draws collision volumes, gates, spawns and the AI racing line, plus a
tuning panel with the derived handling numbers and live suspension travel.
The collision wireframes are built from the physics world rather than the
source data, so a mismatch between art and collision is visible at a glance.

### 3. Ghost/replay recording
Record the player's inputs and chassis transform per fixed step, and play it
back. Cheap because physics is already deterministic and fixed-step. Gives
time trials, a reference for tuning AI pace, and a way to reproduce a physics
bug exactly rather than describing it.

### 4. Surface types
Per-material grip and drag, so mud is genuinely slower than hardpack and the
verge punishes you for running wide. Currently one friction value covers the
whole world, which is why the surface themes are only cosmetic. Needs a
surface id on the collider/terrain and a lookup in the wheel friction path.

### 5. AI racing lines
The AI drives the road centreline with a wander offset. An authored or
computed racing line — with braking points — would let it take proper
apexes. Related: it brakes for horizontal curvature but not for gradient, so
it doesn't slow for jumps. That's a real gap on the current tracks.

### 6. Track validation flythrough
An offline pass that drives an AI truck round a newly exported track a few
times and reports where it got stuck, where it left the road, and lap time
spread. Catches unraceable geometry before a human drives it. The autopilot
harness used during development already does most of this.

### 7. Damage and part breakage
Visible deformation, wheels that come off, engine that loses power. Big
gameplay change, big art/tooling change; worth its own conversation before
anyone starts.

## Things deliberately not done

- **A full in-browser editor.** Blender is already a better modelling tool
  than anything worth writing here, and the tag-based approach means the
  add-on is a few hundred lines rather than an application. An in-browser
  editor would make sense for *placement* tweaks (props, spawns, gates) if
  the round-trip through Blender starts to chafe — but not for geometry.
- **Trimesh collision.** See the constraint above. It would appear to work
  and fail unpredictably at speed.
- **A material/shader editor.** The look is deliberately a fixed budget. The
  interesting knobs (fog, palette, surface theme) are already in the track
  format.
