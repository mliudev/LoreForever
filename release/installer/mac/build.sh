#!/usr/bin/env bash
# Builds "Install Lore Forever.app" and its .dmg (LOR-1348). The .dmg opens to one icon: no Applications shortcut, and
# nothing to drag, since the app installs the add-on and leaves nothing else behind.
#
#   build.sh --out <folder> [--qa]      release build, or --qa with the state renders and a local catalog
#   MAC_SIGN_IDENTITY="Developer ID Application: ..." signs with the hardened runtime; without it, ad hoc
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
out='' config=release
while [ $# -gt 0 ]; do
  case "$1" in
    --out) out="$2"; shift 2 ;;
    --qa) config=debug; shift ;;
    *) echo "build.sh --out <folder> [--qa]" >&2; exit 2 ;;
  esac
done
[ -n "$out" ] || { echo "build.sh --out <folder> [--qa]" >&2; exit 2; }
mkdir -p "$out"
out="$(cd "$out" && pwd)"
version="${LF_INSTALLER_VERSION:-1.0.0}"
identity="${MAC_SIGN_IDENTITY:--}"
name="Install Lore Forever"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

cd "$here"
# Apple Silicon and Intel, as the game runs on both.
build=(swift build -c "$config" --arch arm64 --arch x86_64 --build-path "$work/build")
"${build[@]}"
bin="$("${build[@]}" --show-bin-path)/InstallLoreForever"

app="$out/$name.app"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$bin" "$app/Contents/MacOS/$name"
sed -e "s/@VERSION@/$version/g" "$here/Info.plist" > "$app/Contents/Info.plist"
printf 'APPL????' > "$app/Contents/PkgInfo"

# The icon, from the add-on's logo.
iconset="$work/AppIcon.iconset"
mkdir -p "$iconset"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$here/AppIcon.png" --out "$iconset/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$here/AppIcon.png" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$iconset" -o "$app/Contents/Resources/AppIcon.icns"

if [ "$identity" = "-" ]; then
  codesign --force --deep --sign - --timestamp=none "$app"
else
  codesign --force --options runtime --timestamp --sign "$identity" "$app"
fi
codesign --verify --deep --strict "$app"

[ "$config" = debug ] && { echo "$app"; exit 0; }

stage="$work/dmg"
mkdir -p "$stage"
ditto "$app" "$stage/$name.app"
[ ! -f "$here/dmg.DS_Store" ] || cp "$here/dmg.DS_Store" "$stage/.DS_Store"
dmg="$out/Install-Lore-Forever.dmg"
rw="$work/rw.dmg"
for try in 1 2 3; do
  rm -f "$rw"
  hdiutil create -quiet -volname "$name" -srcfolder "$stage" -fs HFS+ -format UDRW "$rw" && break
  [ "$try" != 3 ] || { echo "build.sh: hdiutil couldn't make the disk" >&2; exit 1; }
  sleep $((try * 5))
done
# The disk opens its window by itself, on the one icon.
mnt="$work/mnt"
mkdir -p "$mnt"
hdiutil attach -quiet -nobrowse -readwrite -mountpoint "$mnt" "$rw"
bless --folder "$mnt" --openfolder "$mnt" 2>/dev/null || true
hdiutil detach -quiet "$mnt"
rm -f "$dmg"
hdiutil convert -quiet "$rw" -format UDZO -imagekey zlib-level=9 -o "$dmg"
if [ "$identity" != "-" ]; then codesign --force --sign "$identity" --timestamp "$dmg"; fi
echo "$app"
echo "$dmg"
