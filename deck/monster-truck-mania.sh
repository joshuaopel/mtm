#!/usr/bin/env bash
# ---------------------------------------------------------------------
#  Monster Truck Mania - Steam Deck launcher.
#
#  Serves the built game on localhost and opens it fullscreen in a
#  browser. Add this script to Steam as a non-Steam game and it works
#  from Gaming Mode like anything else.
#
#  Everything it needs is already on SteamOS. Nothing is installed, and
#  nothing is written outside this folder.
# ---------------------------------------------------------------------
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# The build sits next to this script once you have copied it over.
ROOT="$HERE/dist"
PORT="${MTM_PORT:-8421}"
URL="http://127.0.0.1:$PORT/"

die() {
  printf '\n  %s\n\n' "$1" >&2
  # In Gaming Mode there is no terminal to read, so say it on screen too
  # if we can. zenity ships with the KDE desktop image.
  command -v zenity >/dev/null 2>&1 && zenity --error --no-markup --text="$1" 2>/dev/null
  exit 1
}

[ -f "$ROOT/index.html" ] || die "No build found at $ROOT.
Run 'npm run build' on your PC and copy the dist folder next to this script."

# ---------------------------------------------------------------------
#  A static file server.
#
#  The game fetches its content files at startup, and fetch() is blocked
#  on file:// URLs, so opening index.html directly shows a black screen.
#  A server is not optional.
#
#  Tried in order of what SteamOS actually has. python3 is part of the
#  base image; the others are fallbacks for a Deck that has been
#  customised, or for any other Linux box.
# ---------------------------------------------------------------------
start_server() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$ROOT" >/dev/null 2>&1 &
    echo $!
    return 0
  fi
  if command -v busybox >/dev/null 2>&1; then
    busybox httpd -f -p "127.0.0.1:$PORT" -h "$ROOT" >/dev/null 2>&1 &
    echo $!
    return 0
  fi
  if command -v npx >/dev/null 2>&1; then
    npx --yes serve -l "$PORT" "$ROOT" >/dev/null 2>&1 &
    echo $!
    return 0
  fi
  return 1
}

SERVER_PID="$(start_server)" || die "No way to serve files: python3, busybox and npx are all missing."

# Stop the server whenever the browser exits, including on a Steam
# force-quit, so nothing is left holding the port.
cleanup() {
  kill "$SERVER_PID" 2>/dev/null
  wait "$SERVER_PID" 2>/dev/null
}
trap cleanup EXIT INT TERM

# Wait for it to answer rather than sleeping and hoping.
#
# The probe runs in a subshell so the descriptor it opens dies with it. Do
# not try to close it from out here: `exec 3>&-` on a descriptor this shell
# never opened is a redirection error, and a redirection error on `exec`
# terminates a non-interactive shell outright — silently, if you have
# helpfully pointed its stderr at /dev/null.
for _ in $(seq 1 50); do
  if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
    break
  fi
  sleep 0.1
done

# ---------------------------------------------------------------------
#  A browser, in kiosk mode so there is no address bar to fight with a
#  controller.
#
#  Flatpak first: that is how SteamOS ships browsers, and a `flatpak run`
#  command is what most Decks will have available.
# ---------------------------------------------------------------------
CHROME_FLAGS=(
  --kiosk
  --start-fullscreen
  --no-first-run
  --noerrdialogs
  --disable-pinch
  --overscroll-history-navigation=0
  # The Deck's screen is 1280x800; letting the page own all of it keeps
  # the 4:3 render pillarboxed rather than stretched.
  --window-size=1280,800
  --autoplay-policy=no-user-gesture-required
  "$URL"
)

if flatpak info com.google.Chrome >/dev/null 2>&1; then
  flatpak run com.google.Chrome "${CHROME_FLAGS[@]}"
elif flatpak info com.brave.Browser >/dev/null 2>&1; then
  flatpak run com.brave.Browser "${CHROME_FLAGS[@]}"
elif flatpak info org.chromium.Chromium >/dev/null 2>&1; then
  flatpak run org.chromium.Chromium "${CHROME_FLAGS[@]}"
elif command -v chromium >/dev/null 2>&1; then
  chromium "${CHROME_FLAGS[@]}"
elif command -v google-chrome >/dev/null 2>&1; then
  google-chrome "${CHROME_FLAGS[@]}"
elif flatpak info org.mozilla.firefox >/dev/null 2>&1; then
  # Firefox has no kiosk flag worth using here; F11 gets you fullscreen.
  flatpak run org.mozilla.firefox --new-window "$URL"
elif command -v firefox >/dev/null 2>&1; then
  firefox --new-window "$URL"
else
  die "No browser found. Install one from the Discover store — Google Chrome is the easy choice — then run this again."
fi
