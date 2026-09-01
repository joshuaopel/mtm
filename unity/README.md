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
C:\unity projects\MTM\Assets\MonsterTruckMania\
```

Unity will import it and generate `.meta` files on first open. No packages
need adding — it uses only URP and UGUI, both of which the Universal 3D
template already includes.

Then, in Unity:

1. **Monster Truck Mania → Create Track In Scene**
2. **Monster Truck Mania → Add Retro Camera To Main Camera**

That gives you a starter oval with terrain carved under it, materials wired
up, and the 240p render pass running. Both menu items are idempotent.

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

The generation core — value noise, the Catmull-Rom spline, the road resampler,
the terrain field — has no `UnityEngine` dependency and compiles standalone,
which is how it is tested:

```bash
cd unity/tests
dotnet run
```

44 checks against reference values printed from the original TypeScript. The
noise matches bit for bit; the curve matches three.js to 1e-9.

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

**Verified:** the generation core, by compiling and running it against the
original's reference values.

**Not verified:** everything that needs Unity to compile — the authoring
components, the editor tooling, the shaders. They were written without a Unity
install to build against, so expect to fix compile errors on first import
rather than assuming they are correct. The generation half underneath them is
solid; the Unity half is a first draft.

Not yet ported: vehicle physics, AI drivers, race director, UI. The web game
in the parent folder still has all of that.
