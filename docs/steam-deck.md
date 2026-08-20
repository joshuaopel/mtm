# Running it on a Steam Deck

Yes, and it does not need packaging into an executable. The game is a static
build, SteamOS already has everything needed to serve and display it, and the
gamepad support is real rather than a keyboard emulation layer — the whole
field can be driven from the pad, with analogue triggers and a proper
deadzone.

What you end up with is an entry in your Steam library that boots straight
into the game in Gaming Mode.

---

## 1. Build it on your PC

```bash
npm run build
```

That writes `dist/` — the whole game, about 2MB, with the drop-in content
from `public/content/` copied in beside it.

## 2. Copy two things to the Deck

Put these together in one folder, `dist` **inside** the folder next to the
script:

```
MonsterTruckMania/
  monster-truck-mania.sh     <- from deck/ in this repo
  dist/                      <- what npm run build produced
```

Anywhere in `~` works; `~/Games/MonsterTruckMania` is a reasonable home. Get
them across however you like — a USB stick, `scp` from your PC, Warpinator,
or a cloud folder. Nothing here is architecture-specific, so the same `dist`
runs on the Deck, a Mac, or a phone.

Then, in Desktop Mode, make the script runnable:

```bash
chmod +x ~/Games/MonsterTruckMania/monster-truck-mania.sh
```

## 3. Install a browser

Open **Discover** and install **Google Chrome** (or Brave, or Chromium). The
launcher will use whichever it finds. Chrome is the easy choice: it has a
proper kiosk mode, so there is no address bar for a controller to get stuck
in.

Firefox works too and the launcher will fall back to it, but you will have to
press <kbd>F11</kbd> for fullscreen yourself.

**Why a browser at all?** The game fetches its track and vehicle files at
startup, and `fetch()` is blocked on `file://` URLs. Opening `index.html`
directly gives you a black screen. The launcher runs a tiny local web server
to get around that — it is three lines of Python that SteamOS already ships,
listening on localhost only, and it shuts down when you quit the game.

## 4. Add it to Steam

In Desktop Mode:

1. **Steam → Games → Add a Non-Steam Game to My Library**
2. **Browse**, set the file-type filter to **All Files**, and pick
   `monster-truck-mania.sh`
3. **Add Selected Programs**

Give it a sensible name in the library — right-click → Properties.

## 5. The one setting that matters: the controller layout

This is the step that decides whether the game sees a gamepad or nothing at
all, and it is not the default.

Steam Input decides what the Deck's controls look like to an application. For
a non-Steam game it defaults to a **desktop / keyboard-and-mouse** layout,
which sends key presses and mouse movement — the browser's Gamepad API sees no
pad, so the game gets nothing from the sticks or triggers.

Fix it once:

1. Back in **Gaming Mode**, open the game's library page
2. Press the **controller icon** (bottom right of the page)
3. Choose **Gamepad** — or **Gamepad with Joystick Trackpad** if you want the
   right trackpad as a mouse for the desktop underneath
4. Launch it

The Deck now presents itself as a standard Xbox-style controller, which is
exactly what the game reads.

If the sticks do nothing but the buttons navigate menus, this is the setting
you missed.

---

## Controls on the Deck

Everything maps to the standard layout, so the Deck's own labels are correct:

| Action | Deck |
| --- | --- |
| Accelerate | Right trigger (analogue) |
| Brake, then reverse | Left trigger (analogue) |
| Steer | Left stick |
| Handbrake | X |
| Reset truck | Y |
| Change camera | R1 |
| Look back | L1 |
| Rear-view mirror | View (⧉) |
| Pause | Menu (☰) |
| Menus | A confirms, B backs out, d-pad moves |

The triggers are read as analogue values, not on/off, so part-throttle and
trail-braking both work. The stick has an 18% deadzone with the remaining
range rescaled to a full 0–1, so small inputs off-centre still give you fine
steering rather than a dead patch followed by a jump.

## Make the HUD readable

The Deck's screen is 1280x800 in the same pixel count as a desktop window, at
a third of the physical size, so the interface is small at arm's length.

**Controls → HUD SIZE** cycles 100% → 125% → 150% → 175%. 150% is about right
for handheld. It scales the interface only; the 3D keeps its own
**RESOLUTION** setting.

Both reset when you quit — settings are not saved yet.

## Performance

The Deck is far more machine than this needs. The game renders at 320x240
internally by default and scales up, which is the point of the look, and the
physics is a fixed 60Hz step. If you want it sharper, **Controls →
RESOLUTION** goes to 480x360 and 720x540.

## Adding your own tracks and trucks

The same drop-in rule applies on the Deck: put `*.mtmtrack.json`,
`*.mtmvehicle.json`, a `.glb`, or a music file into `dist/content/` and it
appears at the next launch. No manifest to edit.

That makes the Deck a genuinely useful test target — export from Blender on
your PC, copy the two files across, and drive it on a controller.

---

## Troubleshooting

| What you see | What it is |
| --- | --- |
| Sticks and triggers do nothing, buttons work | Controller layout is still Desktop. See step 5. |
| Nothing happens at all when you press anything | Browsers only expose a gamepad after its first button press, for fingerprinting reasons. Press A once more. |
| Black screen | The build is missing or in the wrong place. `dist/` must sit next to the script, and `dist/index.html` must exist. |
| "No browser found" | Install Chrome from Discover. |
| It launches to a desktop window, not fullscreen | Firefox fallback — press <kbd>F11</kbd>. Install Chrome for proper kiosk mode. |
| Sound is silent until you touch something | Browsers block audio until the page is interacted with. The first button press releases it. |

To pick a different port — if something else on the Deck already has 8421 —
set `MTM_PORT` in the game's Steam launch options:
`MTM_PORT=9000 %command%`.

---

## If you want a real executable later

Wrapping the same `dist/` in Electron or Tauri gives you a binary with no
browser dependency and no launcher script, and is the expected path to a
desktop release. The renderer, input and audio are already behind small
interfaces and there is no server dependency, so nothing in the game has to
change — it is a packaging job, not a port.

The browser route above is worth doing first regardless: it is the fastest way
to get the thing in your hands and find out how it actually feels on a
controller.
