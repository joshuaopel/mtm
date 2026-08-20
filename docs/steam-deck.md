# Shipping it: desktop, Steam, and the Steam Deck

Yes — one build covers all three. A Steam Deck is an x86-64 Linux PC, so the
same Linux artifact you would put in a Steam depot is the one that runs on the
Deck. There is no separate "Deck build".

```bash
npm run desktop:pack     # release/linux-unpacked/  — a runnable folder
npm run desktop:dist     # the above, plus a .tar.gz
```

That wraps the same `dist/` the web build produces in Electron and gives you
an executable. Nothing in the game changes: the renderer, input and audio were
already behind small interfaces with no server dependency, so this is a
packaging step rather than a port.

| Command | Output |
| --- | --- |
| `npm run desktop` | Runs it locally, fullscreen, for a quick look |
| `npm run desktop:windowed` | Same, in a window |
| `npm run desktop:pack` | `release/linux-unpacked/` |
| `npm run desktop:dist` | Adds `release/mtm-<version>.tar.gz` |
| `npx electron-builder --win dir` | `release/win-unpacked/` for desktop Steam |

The Linux folder is about 310MB, most of which is Chromium. That is the price
of the approach: the game itself is under 2MB.

---

## What the desktop shell actually does

Two problems a plain "open the HTML file" wrapper would have, and how
`electron/main.cjs` solves them:

**The game fetches its content at startup, and `fetch()` is blocked on
`file://`.** So the app is served over a custom `mtm://` scheme, registered as
standard and secure, which gives the page a real origin and makes fetch behave
exactly as it does over HTTP — with no socket open and no port to collide with
anything.

**Dropping a file into a folder is how content works everywhere else in this
project**, and burying `content/` inside the app archive would take that away.
So content ships as a real folder beside the executable, the handler looks
there before the bundled copy, and the content index is rebuilt by listing
that folder on every request. A track copied in after the build is found
without rebuilding anything — verified by doing exactly that against a
packaged build.

That makes the packaged game a genuinely useful test target for the Blender
tools: export a track on your PC, copy two files into `content/`, restart.

---

## Putting it on a Deck

1. `npm run desktop:pack` on your PC
2. Copy `release/linux-unpacked/` to the Deck — USB stick, `scp`, Warpinator,
   whatever. Put it somewhere like `~/Games/MonsterTruckMania`
3. In Desktop Mode, make it executable if the copy did not preserve that:
   `chmod +x ~/Games/MonsterTruckMania/monster-truck-mania`
4. **Steam → Games → Add a Non-Steam Game**, **Browse**, filter to **All
   Files**, pick `monster-truck-mania`
5. Set the controller layout — see below

No browser to install, no launcher script, no local server.

### The controller layout is the step that matters

Steam Input decides what the Deck's controls look like to an application, and
for a **non-Steam game** it defaults to a desktop keyboard-and-mouse layout.
Under that layout the Gamepad API sees no pad at all, so the sticks and
triggers do nothing — while the buttons still work through the menus, because
they arrive as key presses. It looks like half the controller is broken.

In Gaming Mode: the game's library page → the **controller icon** → choose
**Gamepad**. Once, and it sticks.

A game published on Steam properly does not have this problem: declare
controller support on the partner site and Steam applies a gamepad template by
default.

---

## Publishing to Steam

The unpacked folder *is* the depot. Nothing needs restructuring.

- **Linux depot** — the contents of `release/linux-unpacked/`, launch option
  `monster-truck-mania`. This covers both Linux desktop and the Deck, natively,
  with no Proton involved.
- **Windows depot** — the contents of `release/win-unpacked/`, launch option
  `Monster Truck Mania.exe`. electron-builder cross-builds this from Linux.
- Mark the launch options with the right OS so Steam picks per platform.

Worth knowing before you get far into this:

- **Declare controller support** in the app's Steam Input settings. That is
  what makes the Deck hand the game a gamepad instead of a mouse, which is the
  single biggest difference between "it works" and "the sticks are dead".
- **Steam Deck Verified** has requirements beyond controls — default launch
  configuration, readable text at 1280x800, no external launcher. The HUD SIZE
  setting under Controls exists for the text one; 150% is about right handheld.
- **The Steam overlay with Electron on Linux is unreliable.** It is a known
  rough edge, not something this project does wrong. If you need the overlay,
  test it early rather than assuming.
- **Achievements and cloud saves** need the Steamworks SDK wired into the main
  process (`steamworks.js` or similar). Nothing here does that yet, and there
  is nothing to save at the moment — settings reset each launch.

---

## Controls

Everything maps to the standard gamepad layout, so the Deck's own labels are
correct:

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

The triggers are read as analogue values rather than on/off, so part-throttle
and trail-braking both work. The stick has an 18% deadzone with the remaining
range rescaled to a full 0–1, so small inputs off-centre still steer finely
instead of giving you a dead patch and then a jump.

<kbd>F11</kbd> toggles fullscreen. Escape is deliberately not bound to leaving
fullscreen, because the game uses it to pause.

## Make the HUD readable

The Deck's screen is a desktop pixel count at a third of the physical size, so
the interface is small at arm's length. **Controls → HUD SIZE** cycles 100% →
125% → 150% → 175%. It scales the interface only; the 3D keeps its own
**RESOLUTION** setting.

Neither is saved between launches yet.

---

## The no-packaging alternative

If you just want it on the Deck in the next ten minutes and do not care about
a real executable, `deck/monster-truck-mania.sh` serves `dist/` on localhost
and opens it in a kiosk browser. Add the script to Steam the same way. It
needs Chrome from Discover, and the same controller-layout step applies.

The packaged build is better in every way that matters — no browser
dependency, no launcher, and it is the thing you would actually ship — but the
script is a smaller thing to get wrong when you are only testing.

---

## Troubleshooting

| What you see | What it is |
| --- | --- |
| Sticks and triggers dead, buttons work | Controller layout is still Desktop. See above. |
| Nothing responds at all | Chromium only exposes a gamepad after its first button press. Press A once more. |
| Black window | The `content` folder or `resources` folder did not come across. Copy the whole unpacked folder, not just the executable. |
| Refuses to start, no window, no message | Try launching from a terminal to see stderr. If it mentions the sandbox, add `--no-sandbox` to the Steam launch options: `%command% --no-sandbox`. |
| Your own track does not appear | It goes in `content/` **beside the executable**, not inside `resources`. Restart the game; the index is rebuilt at launch. |
| Sound silent until you touch something | Browsers block audio until the page is interacted with. The first button press releases it. |

---

## What has actually been tested

Verified here, on Linux x86-64:

- The packaged executable launches, loads over the custom scheme, and plays —
  driven start to finish with a synthetic standard-mapping gamepad, reaching a
  race and holding 68 mph.
- Drop-in content survives packaging: a track written into `content/` *after*
  the build appeared in the game's index.
- The Windows folder cross-builds from Linux and produces an `.exe`.

**Not** verified:

- Any of it on real Deck hardware, or under Steam. There is no Deck here, so
  the Steam Input and depot steps come from documentation rather than from
  running them.
- The Windows build has never been executed — only produced.
- Real GPU rendering. Everything here ran on SwiftShader, software-only.
