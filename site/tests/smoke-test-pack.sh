#!/usr/bin/env bash
# Smoke test for the narrator test pack on a deployed site (a PR preview, or `wrangler pages dev`): agree to the
# release, make a voice, upload two lines, download the pack, unzip it and check what's inside.
#
#   LF_SESSION=<lf_session cookie value> site/tests/smoke-test-pack.sh https://<branch>.lore-forever.pages.dev
#
# Uses the signed-in account of LF_SESSION. Only point it at a preview or a local server: Preview has its own D1 and
# R2, and what this uploads there is disposable. Needs curl and python3; the audio is the default pack's.
set -euo pipefail
BASE=${1:?usage: LF_SESSION=... $0 BASE_URL}
BASE=${BASE%/}
: "${LF_SESSION:?set LF_SESSION to an lf_session cookie value}"
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
AUDIO=$ROOT/addon/LoreForever_Voice_Default/Audio
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
C=(-sS --fail-with-body -H "Cookie: lf_session=$LF_SESSION" -H "Origin: $BASE")

json() { python3 -c "import json,sys; d=json.load(sys.stdin); print(d$1)"; }

release=$(curl "${C[@]}" "$BASE/api/studio/state" | json "['release']['version']")
curl "${C[@]}" -H 'Content-Type: application/json' -o /dev/null "$BASE/api/studio/release" \
  -d "{\"agree\":true,\"adult\":true,\"signature\":\"Smoke Test\",\"release\":\"$release\"}"
voice=$(curl "${C[@]}" "$BASE/api/studio/state" | json "['voices'][0]['id'] if d['voices'] else ''")
if [ -z "$voice" ]; then
  voice=$(curl "${C[@]}" -H 'Content-Type: application/json' "$BASE/api/studio/voice" \
    -d '{"name":"Smoke Test Voice","locale":"enUS"}' | json "['id']")
fi
echo "voice: $voice"

for line in zone:stormwind zone:elwynn; do
  f=$AUDIO/${line/:/_}.mp3
  crc=$(python3 -c "import sys,zlib; print('%08x' % zlib.crc32(open(sys.argv[1],'rb').read()))" "$f")
  curl "${C[@]}" -X PUT --data-binary "@$f" -H "X-CRC32: $crc" -H "X-File-Name: $(basename "$f")" \
    "$BASE/api/studio/take?voice=$voice&line=$line" | json "['take']['ext']" >/dev/null
  echo "uploaded $line"
done

curl "${C[@]}" -D "$TMP/headers" -o "$TMP/pack.zip" "$BASE/api/studio/pack?voice=$voice"
grep -i '^content-disposition\|^content-length\|^x-pack-lines' "$TMP/headers"
python3 -c "import sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; z.extractall(sys.argv[2])" \
  "$TMP/pack.zip" "$TMP/out"
folder=$(ls "$TMP/out")
echo "folder: $folder"
[[ $folder == LoreForever_Voice_Test* ]]
test -f "$TMP/out/$folder/$folder.toc"
grep -q '^## X-LoreForever-Pack: voice$' "$TMP/out/$folder/$folder.toc"
grep -q '^c\["zone:stormwind"\] = ' "$TMP/out/$folder/Clips.lua"
grep -q '^c\["zone:elwynn"\] = ' "$TMP/out/$folder/Clips.lua"
cmp "$TMP/out/$folder/Audio/zone_stormwind.mp3" "$AUDIO/zone_stormwind.mp3"
cmp "$TMP/out/$folder/Audio/zone_elwynn.mp3" "$AUDIO/zone_elwynn.mp3"
(cd "$TMP/out" && find . -type f | sort)
cat "$TMP/out/$folder/$folder.toc"
echo "ok: test pack for $voice"
