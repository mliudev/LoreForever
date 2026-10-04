#!/usr/bin/env bash
# Copy the add-on, its default voice pack and any language packs built next to it (addon/LoreForever_Lang_*) into
# the WoW Forever beta's AddOns folder (a copy, since Windows can't follow WSL symlinks).
set -euo pipefail
ADDONS_SRC="$(cd "$(dirname "$0")/.." && pwd)/addon"
FOLDERS=(LoreForever LoreForever_Voice_Default)
for d in "$ADDONS_SRC"/LoreForever_Lang_*; do [ -d "$d" ] && FOLDERS+=("$(basename "$d")"); done
# WOW_DIR wins; otherwise take the first drive that has the Forever beta installed.
WOW="${WOW_DIR:-}"
if [ -z "$WOW" ]; then
  for drive in e d c f; do
    candidate="/mnt/$drive/BattleNet/World of Warcraft/_classic_beta_"
    if [ -d "$candidate" ]; then WOW="$candidate"; break; fi
  done
fi
[ -n "$WOW" ] || { echo "WoW Forever beta folder not found; set WOW_DIR" >&2; exit 1; }
# Audio is stored with Git LFS. A checkout that never fetched it has small pointer files where the recordings should
# be; installing those would leave the narration silent, so stop before copying anything.
for name in "${FOLDERS[@]}"; do
  [ -d "$ADDONS_SRC/$name/Audio" ] || continue
  n="$(find "$ADDONS_SRC/$name/Audio" -type f -size -1025c -print0 \
       | xargs -0 -r grep -l '^version https://git-lfs' | wc -l || true)"
  if [ "$n" -gt 0 ]; then
    echo "install-addon: $n files in addon/$name/Audio are Git LFS pointers, not recordings." >&2
    echo "Fetch them first: git -c lfs.fetchexclude= lfs pull (CONTRIBUTING.md has the one-time setup)" >&2
    exit 1
  fi
done
mkdir -p "$WOW/Interface/AddOns"
# The add-on used to be called Lorewalker; an old copy would load alongside and fight over /lore.
rm -rf "$WOW/Interface/AddOns/Lorewalker"
for name in "${FOLDERS[@]}"; do
  SRC="$ADDONS_SRC/$name"
  DEST="$WOW/Interface/AddOns/$name"
  [ -d "$SRC" ] || { echo "missing $SRC" >&2; exit 1; }
  # A development link to a checkout (CONTRIBUTING.md, "Fast dev loop") already shows that checkout: copying into it
  # would write into the checkout.
  if [ -L "$DEST" ]; then echo "Skipped $name: $DEST is a link to a checkout, not a copy"; continue; fi
  # Copy over the existing folder instead of deleting it first: while the game runs it can hold an MP3 open, and a
  # failed delete would leave a half-removed add-on. Files the game has locked are skipped (audio rarely changes).
  mkdir -p "$DEST"
  ( cd "$SRC" && find . -type d -exec mkdir -p "$DEST/{}" \; )
  ( cd "$SRC" && find . -type f | while read -r f; do cp -f "$f" "$DEST/$f" 2>/dev/null || echo "skipped (in use): $name/$f"; done )
  # Drop files that no longer exist in the source (old data chunks), again skipping anything locked.
  ( cd "$DEST" && find . -type f | while read -r f; do [ -e "$SRC/$f" ] || rm -f "$f" 2>/dev/null || true; done )
  echo "Installed $name -> $DEST"
done
# Narration used to live in LoreForever/Audio; it's in the voice pack now. (Never through a development link: that
# would delete from the checkout.) A /reload then picks everything up, new add-on folders too (client 1.60.1.70205).
[ -d "$ADDONS_SRC/LoreForever/Audio" ] || [ -L "$WOW/Interface/AddOns/LoreForever" ] \
  || rm -rf "$WOW/Interface/AddOns/LoreForever/Audio" 2>/dev/null || true
ls -la "$WOW/Interface/AddOns/LoreForever"
