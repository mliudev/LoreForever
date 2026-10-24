#!/usr/bin/env bash
# Copy the add-on, its default voice pack and any language packs built next to it (addon/LoreForever_Lang_*) into
# WoW Forever's AddOns folder (_forever_, else the beta's _classic_beta_; a copy, since Windows can't follow WSL symlinks).
# FLAVOR=_retail_ (or _classic_era_, ...) installs into another client instead, as a stand-in for UI work while there's
# no Forever world: the installed copies then carry that client's Interface number (set_interface below).
set -euo pipefail
ADDONS_SRC="$(cd "$(dirname "$0")/.." && pwd)/addon"
FOLDERS=(LoreForever LoreForever_Voice_Default)
for d in "$ADDONS_SRC"/LoreForever_Lang_*; do [ -d "$d" ] && FOLDERS+=("$(basename "$d")"); done
# WOW_DIR wins; otherwise take the first drive that has the flavor (default WoW Forever: _forever_, else the beta's
# _classic_beta_) installed.
WOW="${WOW_DIR:-}"
if [ -z "$WOW" ]; then
  for drive in e d c f; do
    for flavor in ${FLAVOR:-_forever_ _classic_beta_}; do
      candidate="/mnt/$drive/BattleNet/World of Warcraft/$flavor"
      if [ -d "$candidate" ]; then WOW="$candidate"; break 2; fi
    done
  done
fi
[ -n "$WOW" ] || { echo "WoW ${FLAVOR:-Forever} folder not found; set WOW_DIR" >&2; exit 1; }

# The "## Interface:" number the client in $1 (a flavor folder) loads, from World of Warcraft\.build.info's row for
# its product (.flavor.info): version a.b.c is a*10000 + b*100 + c (1.60.1 -> 16001, 12.1.5 -> 120105). Empty for the
# Forever clients (wow_classic_beta, wowf), whose number the .toc files already carry, or when it can't tell.
client_interface() {
  local product version
  product="$(tail -n 1 "$1/.flavor.info" 2>/dev/null | tr -d '\r' || true)"
  case "$product" in wow_classic_beta|wowf|"") return 0 ;; esac
  version="$(awk -F'|' -v p="$product" '{ sub(/\r$/, "") } NR == 1 { for (i = 1; i <= NF; i++) { split($i, h, "!"); col[h[1]] = i }; next }
    $col["Product"] == p { print $col["Version"] }' "$1/../.build.info" 2>/dev/null | tr -d '\r' | head -n 1 || true)"
  [[ "$version" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+) ]] || return 0
  echo $(( BASH_REMATCH[1] * 10000 + BASH_REMATCH[2] * 100 + BASH_REMATCH[3] ))
}

# Another client than Forever's: the installed .toc files say its number, so it loads them (Retail ignores "Load out
# of date AddOns" for a number this old). Only the installed copies change; the repo's, which players get, stay
# Forever's. Willo's own add-on (LoreForever_Willo) copies the number from LoreForever.toc. INTERFACE=<n> overrides.
set_interface() {
  local n="${INTERFACE:-$(client_interface "$WOW")}" toc
  [ -n "$n" ] || return 0
  for name in "${FOLDERS[@]}"; do
    toc="$WOW/Interface/AddOns/$name/$name.toc"
    [ -f "$toc" ] && [ ! -L "$WOW/Interface/AddOns/$name" ] || continue
    sed -i "s/^## Interface:.*/## Interface: $n/" "$toc"
  done
  echo "Interface set to $n for this client (a stand-in for Forever; the repo's .toc files are unchanged)"
}
# Packs in the asset store (LOR-440): their recordings fetched into the gitignored Audio/ first.
STORE="$ADDONS_SRC/../scripts/audio_store.py"
[ ! -f "$STORE" ] || python3 "$STORE" hydrate --quiet $(printf -- '--pack %s ' "${FOLDERS[@]}")
# Audio lived in Git LFS until 10/18. A checkout of an older commit has small pointer files where the recordings
# should be; installing those would leave the narration silent, so stop before copying anything.
for name in "${FOLDERS[@]}"; do
  # A store pack with no recordings here would install silent: say so instead (hydrate above fills the packs it names).
  if [ -f "$ADDONS_SRC/../release/audio-store/$name.json" ] && ! grep -q '"files": 0,' "$ADDONS_SRC/../release/audio-store/$name.json" \
     && [ -z "$(find "$ADDONS_SRC/$name/Audio" -type f -print -quit 2>/dev/null)" ]; then
    echo "install-addon: addon/$name/Audio has no recordings. Fetch them first: python3 scripts/audio_store.py hydrate --pack $name" >&2
    exit 1
  fi
  [ -d "$ADDONS_SRC/$name/Audio" ] || continue
  n="$(find "$ADDONS_SRC/$name/Audio" -type f -size -1025c -print0 \
       | xargs -0 -r grep -l '^version https://git-lfs' | wc -l || true)"
  if [ "$n" -gt 0 ]; then
    echo "install-addon: $n files in addon/$name/Audio are Git LFS pointers, not recordings." >&2
    echo "Fetch them first: python3 scripts/audio_store.py hydrate" >&2
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
  ( cd "$SRC" && find . -type f | while read -r f; do cp -f --no-preserve=mode "$f" "$DEST/$f" 2>/dev/null || echo "skipped (in use): $name/$f"; done )
  # Drop files that no longer exist in the source (old data chunks), again skipping anything locked.
  ( cd "$DEST" && find . -type f | while read -r f; do [ -e "$SRC/$f" ] || rm -f "$f" 2>/dev/null || true; done )
  echo "Installed $name -> $DEST"
done
# Narration used to live in LoreForever/Audio; it's in the voice pack now. (Never through a development link: that
# would delete from the checkout.) A /reload then picks everything up, new add-on folders too (client 1.60.1.70205).
[ -d "$ADDONS_SRC/LoreForever/Audio" ] || [ -L "$WOW/Interface/AddOns/LoreForever" ] \
  || rm -rf "$WOW/Interface/AddOns/LoreForever/Audio" 2>/dev/null || true
set_interface
ls -la "$WOW/Interface/AddOns/LoreForever"
