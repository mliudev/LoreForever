#!/usr/bin/env bash
# Install-Lore-Forever.dmg for players (LOR-1348): built with build.sh, signed with the Developer ID and the hardened
# runtime, notarized by Apple, stapled, then checked the way macOS will check it on a player's Mac: Gatekeeper's word on
# the .dmg and on the app copied out of it with the quarantine a download carries. The same signing as Willo for Mac
# (companion/packaging/mac-release.sh). macOS must show only its usual "downloaded from the Internet" question, so a
# build that fails any check here doesn't go out.
#
#   MAC_CERT_P12 MAC_CERT_PASSWORD NOTARY_KEY_P8 NOTARY_KEY_ID NOTARY_ISSUER_ID     the release environment's secrets
#   release.sh --out <folder> [--wait <minutes>]
#
# Exit 0: <out>/Install-Lore-Forever.dmg and <out>/signature.json, ready to ship. Exit 3: Apple was still notarizing after
# --wait minutes (default 15). Anything else: a failure. The keychain it makes is deleted after.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
out='' wait=15
while [ $# -gt 0 ]; do
  case "$1" in
    --out) out="$2"; shift 2 ;;
    --wait) wait="$2"; shift 2 ;;
    *) echo "release.sh --out <folder> [--wait <minutes>]" >&2; exit 2 ;;
  esac
done
[ -n "$out" ] && [[ "$wait" =~ ^[0-9]+$ ]] || { echo "release.sh --out <folder> [--wait <minutes>]" >&2; exit 2; }
for s in MAC_CERT_P12 MAC_CERT_PASSWORD NOTARY_KEY_P8 NOTARY_KEY_ID NOTARY_ISSUER_ID; do
  [ -n "${!s:-}" ] || { echo "release.sh: $s isn't set" >&2; exit 2; }
done
mkdir -p "$out"
out="$(cd "$out" && pwd)"
tmp="$(mktemp -d)"
kc="$tmp/install-signing.keychain-db" pass="$(uuidgen)" before='' mnt="$tmp/dmg"
cleanup() {
  [ ! -d "$mnt" ] || hdiutil detach -quiet "$mnt" 2>/dev/null || true
  # shellcheck disable=SC2086   # the user's keychains as they were, one word each
  [ -z "$before" ] || security list-keychains -d user -s $before 2>/dev/null || true
  security delete-keychain "$kc" 2>/dev/null || true
  rm -rf "$tmp"
}
trap cleanup EXIT

echo "$MAC_CERT_P12" | base64 --decode > "$tmp/cert.p12"
security create-keychain -p "$pass" "$kc"
security set-keychain-settings -lut 3600 "$kc"
security unlock-keychain -p "$pass" "$kc"
security import "$tmp/cert.p12" -k "$kc" -P "$MAC_CERT_PASSWORD" -T /usr/bin/codesign >/dev/null
security set-key-partition-list -S apple-tool:,apple: -k "$pass" "$kc" >/dev/null
rm -f "$tmp/cert.p12"
before="$(security list-keychains -d user | tr -d '"' | xargs)"
# shellcheck disable=SC2086
security list-keychains -d user -s "$kc" $before
identity="$(security find-identity -v -p codesigning "$kc" | sed -nE 's/.*"(Developer ID Application: [^"]+)".*/\1/p' | head -1)"
[ -n "$identity" ] || { echo "release.sh: no Developer ID Application identity in MAC_CERT_P12" >&2; exit 1; }

MAC_SIGN_IDENTITY="$identity" bash "$here/build.sh" --out "$out"
dmg="$out/Install-Lore-Forever.dmg" app="$out/Install Lore Forever.app"

echo "$NOTARY_KEY_P8" | base64 --decode > "$tmp/notary.p8"
key=(--key "$tmp/notary.p8" --key-id "$NOTARY_KEY_ID" --issuer "$NOTARY_ISSUER_ID")
field() { python3 -c 'import json, sys; print(json.load(sys.stdin)[sys.argv[1]])' "$1"; }
id="$(xcrun notarytool submit "$dmg" "${key[@]}" --output-format json | field id)"
echo "Notarizing: submission $id (up to $wait minutes)"
xcrun notarytool wait "$id" "${key[@]}" --timeout "${wait}m" >/dev/null || true
status="$(xcrun notarytool info "$id" "${key[@]}" --output-format json | field status)"
case "$status" in
  Accepted) ;;
  "In Progress")
    echo "::warning::Apple was still notarizing Install-Lore-Forever.dmg after $wait minutes (submission $id)."
    exit 3 ;;
  *)
    xcrun notarytool log "$id" "${key[@]}" || true
    echo "::error::Apple didn't accept Install-Lore-Forever.dmg (submission $id: $status); its log is above." >&2
    exit 1 ;;
esac
for try in 1 2 3; do
  xcrun stapler staple "$dmg" && break
  [ "$try" = 3 ] && { echo "::error::couldn't staple the .dmg after 3 tries (submission $id was accepted)" >&2; exit 1; }
  echo "Stapling failed (try $try of 3); trying again in 20 s"; sleep 20
done
xcrun stapler validate "$dmg"

gatekeeper="$(spctl --assess --type open --context context:primary-signature -v "$dmg" 2>&1 | sed -nE 's/^source=//p' | head -1)"
[ "$gatekeeper" = "Notarized Developer ID" ] || { echo "::error::Gatekeeper says ${gatekeeper:-nothing} of the .dmg, not Notarized Developer ID" >&2; exit 1; }

# The app as a player gets it: copied out of the .dmg, carrying the quarantine of a download.
mkdir -p "$mnt" "$tmp/player"
hdiutil attach -quiet -nobrowse -readonly -mountpoint "$mnt" "$dmg"
ditto "$mnt/Install Lore Forever.app" "$tmp/player/Install Lore Forever.app"
hdiutil detach -quiet "$mnt"
xattr -w com.apple.quarantine "0081;$(printf '%x' "$(date +%s)");Safari;" "$tmp/player/Install Lore Forever.app"
opened="$(spctl --assess --type execute -v "$tmp/player/Install Lore Forever.app" 2>&1 | sed -nE 's/^source=//p' | head -1)"
[ "$opened" = "Notarized Developer ID" ] || { echo "::error::Gatekeeper says ${opened:-nothing} of the quarantined app" >&2; exit 1; }

signed="$(codesign -dvv "$tmp/player/Install Lore Forever.app" 2>&1)"
authority="$(sed -nE 's/^Authority=//p' <<<"$signed" | head -1)"
team="$(sed -nE 's/^TeamIdentifier=//p' <<<"$signed" | head -1)"
[ -n "$authority" ] && [ "$team" = "V3BN87B6H9" ] || { echo "::error::unexpected signer: $authority ($team)" >&2; exit 1; }
python3 - "$out/signature.json" "$authority" "$team" "$status" "$id" "$gatekeeper" <<'PY'
import json, sys
path, authority, team, status, submission, gatekeeper = sys.argv[1:]
json.dump({"authority": authority, "team": team, "notarization": status, "submission": submission, "stapled": True,
           "gatekeeper": gatekeeper}, open(path, "w"), indent=2)
PY
echo "Install-Lore-Forever.dmg: $(du -h "$dmg" | cut -f1), $authority, notarized ($id), stapled, Gatekeeper passes"
