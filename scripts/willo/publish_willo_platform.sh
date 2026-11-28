#!/usr/bin/env bash
# One platform of a Willo release, from the public willo.yml's publish (Windows) and publish-mac (Mac) jobs:
#   scripts/publish_willo_platform.sh win|mac DIR PROOF FILE
# DIR is download-artifact's folder of this platform's artifacts (every attempt's: the newest is taken), PROOF and FILE
# the proof and the file in it. Env: GH_TOKEN, GH_REPO, TAG, VERSION, REF (the release's Willo commit), NOTES, SIGNED.
# release_staging.py willo-release creates the release with this file, or adds it to the release the other platform
# made (docs/qa/willo-publish-split.md).
set -euo pipefail
platform="$1" dir="$2" proof="$3" file="$4"
# The newest attempt's folder (willo-0.31.2-2 over -1), or nothing; never a failed pipeline (bash -eo pipefail).
# download-artifact puts a lone match straight into the path, with no folder of its own (10/31, 0.34.0's first publish:
# "no willo-0.34.0-* artifact" beside a downloaded willo-0.34.0-1), so then the path is the folder.
newest="$({ ls -d "$dir"/*-"$VERSION"-* 2>/dev/null || true; } | sort -t- -k3 -n | tail -1)"
if [ -z "$newest" ] && [ -n "$(ls -A "$dir" 2>/dev/null)" ]; then newest="$dir"; fi
[ -n "$newest" ] && [ -f "$newest/$proof" ] || { echo "::error::no $platform artifact for $VERSION in $dir"; exit 1; }
notes=() signed=()
if [ -n "${NOTES:-}" ]; then printf '%s\n' "$NOTES" > "$dir/notes.md"; notes=(--notes "$dir/notes.md"); fi
if [ "${SIGNED:-false}" = true ]; then signed=(--signed); fi
python3 "$(dirname "$0")/release_staging.py" --commit "$(git rev-parse HEAD)" willo-release --platform "$platform" \
  --manifest "$newest/$proof" --root "$newest/$file" --companion-ref "$REF" --output "$dir/metadata" \
  "${notes[@]}" "${signed[@]}"
echo "Published $file on https://github.com/$GH_REPO/releases/tag/$TAG (not Latest)" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
