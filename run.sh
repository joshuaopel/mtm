#!/usr/bin/env bash
# ---------------------------------------------------------------------
#  Monster Truck Mania - start the game.
#
#  ./run.sh
#
#  Checks Node is present and new enough, installs the dependencies the
#  first time, then starts the dev server and opens your browser.
#  Ctrl-C stops it.
# ---------------------------------------------------------------------
set -euo pipefail

# Run from this script's own folder, whatever directory it was called from.
cd "$(dirname "$0")"

REQUIRED="20.19.0"

printf '\n  MONSTER TRUCK MANIA\n  ===================\n\n'

if ! command -v node >/dev/null 2>&1; then
  printf '  Node.js was not found on your PATH.\n\n'
  printf '  Install the LTS build from https://nodejs.org/ then run this again.\n\n'
  exit 1
fi

version="$(node --version)"        # e.g. v22.22.2
# `sort -V` does version-aware ordering, so the older of the two sorts first.
if [ "$(printf '%s\n%s\n' "$REQUIRED" "${version#v}" | sort -V | head -n 1)" != "$REQUIRED" ]; then
  printf '  Node %s is too old - this needs %s or newer.\n\n' "$version" "$REQUIRED"
  printf '  Update from https://nodejs.org/ then run this again.\n\n'
  exit 1
fi

printf '  Node %s - ok\n' "$version"

if [ ! -d node_modules ]; then
  printf '\n  First run, so installing dependencies. This takes a minute\n'
  printf '  and only happens once.\n\n'
  npm install
fi

printf '\n  Starting at http://127.0.0.1:5173/\n'
printf '  Your browser should open by itself.\n\n'
printf '  Drop tracks, trucks and music into public/content and they\n'
printf '  appear without a restart. Ctrl-C to stop.\n\n'

exec npm run dev -- --open
