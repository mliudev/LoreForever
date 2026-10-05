#!/usr/bin/env python3
"""The narration recordings, kept out of the public repo's git history (LOR-133).

The public repo (mliudev/LoreForever) keeps the add-on's code and data and each voice pack's .toc and Clips.lua, but
not its recordings: every re-recording would stay in its git history for good (its .git was 1.3 GB on 2026-10-03).
The recordings go to its "audio" release instead, one zip per voice pack and version of its recordings, named by
their content (LoreForever_Voice_Female-3fa9c1d2e4b5a6f7.zip), so an upload never replaces a zip an older tag needs.
release/audio.json, written and committed with each release, says which zip holds each pack's recordings. The public
release workflow puts those back into addon/<pack>/Audio/ before it builds, so its zips come out byte for byte the
same as the private build that QA tested.

  audio_assets.py manifest                   write release/audio.json for the recordings in addon/ (no network)
  audio_assets.py upload [--repo OWNER/NAME] upload the zips release/audio.json names that the audio release doesn't
                                             have yet (gh); --dry-run lists them, --out DIR writes them there instead
  audio_assets.py fetch [--base URL]         put the recordings release/audio.json names into addon/<pack>/Audio/.
                                             A pack whose Audio/ has recordings already is left alone (tags from
                                             before LOR-133 kept them in git), and so is a pack this checkout lacks.

The packs are the voice packs a release ships: PACKS and RELEASE_PACKS in scripts/build-release.sh whose folder is in
addon/ with recordings. Standard library only, plus gh to upload: the public repo's workflow runs fetch.
"""

import argparse
import hashlib
import json
import re
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ADDONS = ROOT / "addon"
MANIFEST = ROOT / "release" / "audio.json"
REPO, TAG = "mliudev/LoreForever", "audio"
BASE = f"https://github.com/{REPO}/releases/download/{TAG}"
AUDIO = {".mp3", ".ogg"}
DATE = (2026, 1, 1, 0, 0, 0)   # fixed, so a pack's zip is the same bytes whenever its recordings are
LFS_POINTER = b"version https://git-lfs"
README = ("Which zip on the public repo's \"audio\" release holds each voice pack's recordings, which aren't in its "
          "git history (LOR-133). scripts/release.sh writes it with each release (scripts/audio_assets.py manifest); "
          "the release workflow puts the recordings back from it (fetch). Don't edit it by hand.")
NOTES = ("The recordings of Lore Forever's voice packs, one zip per pack and version of its recordings. They aren't in "
         "this repo's git history: the release workflow takes the zips each tag's release/audio.json names "
         "(scripts/audio_assets.py fetch). Not a download for players: get the add-on from the latest release.")


class Failure(Exception):
    pass


def shipped_packs() -> list[str]:
    """The voice pack folders a release ships (build-release.sh PACKS and RELEASE_PACKS) that are in addon/."""
    src = (ROOT / "scripts" / "build-release.sh").read_text(encoding="utf-8")
    names = [n for m in re.findall(r"^(?:RELEASE_)?PACKS = \[(.*?)\]", src, re.M | re.S) for n in re.findall(r'"([^"]+)"', m)]
    return [n for n in dict.fromkeys(names) if n.startswith("LoreForever_Voice_") and (ADDONS / n).is_dir()]


def recordings(pack: str) -> list[tuple[str, Path]]:
    """[(path under the pack's Audio/, file)] in name order."""
    audio = ADDONS / pack / "Audio"
    if not audio.is_dir():
        return []
    return sorted((p.relative_to(audio).as_posix(), p) for p in audio.rglob("*")
                  if p.is_file() and p.suffix.lower() in AUDIO)


def fingerprint(files: list[tuple[str, Path]]) -> str:
    """The recordings' names and contents, as one sha256."""
    h = hashlib.sha256()
    for name, path in files:
        h.update(hashlib.sha256(name.encode()).digest() + hashlib.sha256(path.read_bytes()).digest())
    return h.hexdigest()


def load_manifest() -> dict:
    if not MANIFEST.is_file():
        raise Failure(f"no {MANIFEST.relative_to(ROOT)}")
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    if not isinstance(data.get("packs"), dict):
        raise Failure(f"{MANIFEST.relative_to(ROOT)} has no 'packs'")
    return data


def bundle(pack: str, files: list[tuple[str, Path]], out: Path) -> Path:
    """A pack's recordings as a zip of Audio/<name> entries, stored as they are, the same bytes every time."""
    with zipfile.ZipFile(out, "w") as z:
        for name, path in files:
            info = zipfile.ZipInfo(f"Audio/{name}", date_time=DATE)
            info.compress_type = zipfile.ZIP_STORED
            info.external_attr = 0o644 << 16
            z.writestr(info, path.read_bytes())
    return out


# --- commands ------------------------------------------------------------------------------------------------------

def cmd_manifest(_args) -> int:
    packs = {}
    for pack in shipped_packs():
        files = recordings(pack)
        if not files:
            continue   # build-release.sh refuses a shipped voice pack without recordings
        pointers = [n for n, p in files if p.stat().st_size <= 1024 and p.read_bytes().startswith(LFS_POINTER)]
        if pointers:
            raise Failure(f"{len(pointers)} files in addon/{pack}/Audio are Git LFS pointers, not recordings (e.g. "
                          f"{pointers[0]}). Fetch them first: git -c lfs.fetchexclude= lfs pull")
        fp = fingerprint(files)
        packs[pack] = {"asset": f"{pack}-{fp[:16]}.zip", "fingerprint": fp, "files": len(files),
                       "bytes": sum(p.stat().st_size for _, p in files)}
    MANIFEST.write_text(json.dumps({"_readme": README, "packs": packs}, indent=2) + "\n", encoding="utf-8")
    total = sum(e["bytes"] for e in packs.values())
    print(f"{MANIFEST.relative_to(ROOT)}: {len(packs)} voice packs, {total / 1e6:.0f} MB of recordings")
    return 0


def gh(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    r = subprocess.run(["gh", *args], capture_output=True, text=True)
    if check and r.returncode != 0:
        raise Failure(f"gh {' '.join(args[:3])} failed: {(r.stderr or r.stdout).strip()}")
    return r


def cmd_upload(args) -> int:
    packs = load_manifest()["packs"]
    if args.out:
        have = set()
    else:
        r = gh("release", "view", TAG, "-R", args.repo, "--json", "assets", check=False)
        if r.returncode == 0:
            have = {a["name"] for a in json.loads(r.stdout)["assets"]}
        elif "not found" in r.stderr.lower():
            have = None   # no audio release yet
        else:
            raise Failure(f"couldn't read {args.repo}'s {TAG} release: {r.stderr.strip()}")
    todo = [(pack, e) for pack, e in packs.items() if e["asset"] not in (have or set())]
    size = sum(e["bytes"] for _, e in todo)
    if not todo:
        print(f"recordings: the {TAG} release has all {len(packs)} packs' zips already")
        return 0
    print(f"recordings: {len(todo)} of {len(packs)} packs to upload ({size / 1e6:.0f} MB): "
          + ", ".join(e["asset"] for _, e in todo))
    if args.dry_run:
        return 0
    if have is None:
        # A prerelease is never the repo's Latest, which the site's download links follow.
        gh("release", "create", TAG, "-R", args.repo, "--title", "Narration recordings", "--prerelease",
           "--latest=false", "--notes", NOTES)
    with tempfile.TemporaryDirectory() as tmp:
        for pack, e in todo:
            files = recordings(pack)
            if fingerprint(files) != e["fingerprint"]:
                raise Failure(f"addon/{pack}/Audio changed since {MANIFEST.relative_to(ROOT)} was written; run "
                              "audio_assets.py manifest again")
            out = Path(args.out) if args.out else Path(tmp)
            out.mkdir(parents=True, exist_ok=True)
            path = bundle(pack, files, out / e["asset"])
            if not args.out:
                gh("release", "upload", TAG, str(path), "-R", args.repo)
                # An upload cut short could leave a partial asset that a rerun would skip as there already.
                assets = json.loads(gh("release", "view", TAG, "-R", args.repo, "--json", "assets").stdout)["assets"]
                size = next((a.get("size") for a in assets if a["name"] == e["asset"]), None)
                if size != path.stat().st_size:
                    gh("release", "delete-asset", TAG, e["asset"], "-R", args.repo, "--yes", check=False)
                    raise Failure(f"{e['asset']} reached the {TAG} release as {size} bytes, not "
                                  f"{path.stat().st_size}; removed it, run the upload again")
                path.unlink()
            print(f"  {e['asset']} ({e['bytes'] / 1e6:.0f} MB)")
    return 0


def download(url: str, out: Path, tries: int = 4) -> None:
    for attempt in range(1, tries + 1):
        try:
            with urllib.request.urlopen(url, timeout=120) as r, open(out, "wb") as f:
                while chunk := r.read(1 << 20):
                    f.write(chunk)
            return
        except OSError as e:
            if attempt == tries:
                raise Failure(f"couldn't download {url}: {e}") from None
            time.sleep(10 * attempt)


def cmd_fetch(args) -> int:
    if not MANIFEST.is_file():
        print(f"no {MANIFEST.relative_to(ROOT)}: this checkout keeps its recordings in git")
        return 0
    packs = load_manifest()["packs"]
    done = kept = 0
    with tempfile.TemporaryDirectory() as tmp:
        for pack, e in packs.items():
            if not (ADDONS / pack).is_dir():
                continue
            if recordings(pack):
                kept += 1
                continue
            path = Path(tmp, e["asset"])
            download(f"{args.base.rstrip('/')}/{e['asset']}", path)
            audio = ADDONS / pack / "Audio"
            with zipfile.ZipFile(path) as z:
                for info in z.infolist():
                    name = info.filename
                    if info.is_dir():
                        continue
                    rel = name.removeprefix("Audio/")
                    parts = rel.split("/")
                    if rel == name or not rel or any(p in ("", ".", "..") for p in parts) or "\\" in rel:
                        raise Failure(f"{e['asset']}: unexpected entry {name!r}")
                    target = audio.joinpath(*parts)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(z.read(info))
            path.unlink()
            files = recordings(pack)
            if len(files) != e["files"] or fingerprint(files) != e["fingerprint"]:
                raise Failure(f"{e['asset']} doesn't hold the recordings {MANIFEST.relative_to(ROOT)} names for {pack}")
            done += 1
            print(f"  {pack}: {len(files)} recordings ({e['asset']})")
    print(f"recordings: put back {done} packs' from the {TAG} release"
          + (f"; {kept} already had theirs" if kept else ""))
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("manifest")
    up = sub.add_parser("upload")
    up.add_argument("--repo", default=REPO)
    up.add_argument("--dry-run", action="store_true")
    up.add_argument("--out", help="write the zips here instead of uploading them")
    fe = sub.add_parser("fetch")
    fe.add_argument("--base", default=BASE, help="where the zips are (default: the audio release)")
    args = ap.parse_args(argv)
    try:
        return {"manifest": cmd_manifest, "upload": cmd_upload, "fetch": cmd_fetch}[args.cmd](args)
    except (Failure, OSError, zipfile.BadZipFile) as e:
        print(f"audio_assets: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
