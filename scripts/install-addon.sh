#!/usr/bin/env bash
# Copy the add-on into the WoW Forever beta's AddOns folder (a copy, since Windows can't follow WSL symlinks).
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)/addon/LoreForever"
# WOW_DIR wins; otherwise take the first drive that has the Forever beta installed.
WOW="${WOW_DIR:-}"
if [ -z "$WOW" ]; then
  for drive in e d c f; do
    candidate="/mnt/$drive/BattleNet/World of Warcraft/_classic_beta_"
    if [ -d "$candidate" ]; then WOW="$candidate"; break; fi
  done
fi
[ -n "$WOW" ] || { echo "WoW Forever beta folder not found; set WOW_DIR" >&2; exit 1; }
DEST="$WOW/Interface/AddOns/LoreForever"
mkdir -p "$WOW/Interface/AddOns"
# The add-on used to be called Lorewalker; an old copy would load alongside and fight over /lore.
rm -rf "$WOW/Interface/AddOns/Lorewalker"
# Copy over the existing folder instead of deleting it first: while the game runs it can hold an MP3 open, and a
# failed delete would leave a half-removed add-on. Files the game has locked are skipped (audio rarely changes).
mkdir -p "$DEST"
( cd "$SRC" && find . -type d -exec mkdir -p "$DEST/{}" \; )
( cd "$SRC" && find . -type f | while read -r f; do cp -f "$f" "$DEST/$f" 2>/dev/null || echo "skipped (in use): $f"; done )
# Drop files that no longer exist in the source (old data chunks), again skipping anything locked.
( cd "$DEST" && find . -type f | while read -r f; do [ -e "$SRC/$f" ] || rm -f "$f" 2>/dev/null || true; done )
echo "Installed Lore Forever -> $DEST"
ls -la "$DEST"
