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

Upload caches verified bundles in $XDG_CACHE_HOME/lore-forever/audio-bundles (default ~/.cache), up to 8 GiB.
--cache-dir / LORE_AUDIO_CACHE_DIR overrides that directory; --no-cache / LORE_AUDIO_CACHE=0 disables it.
The cache never evicts files: when full, new bundles are built without retention. Remove the dedicated directory
to reclaim its space. Every reuse checks the source recordings and cached archive; outputs are independent copies.

The packs are the voice packs a release ships: PACKS and RELEASE_PACKS in scripts/build-release.sh whose folder is in
addon/ with recordings. Standard library only, plus gh to upload: the public repo's workflow runs fetch.
"""

import argparse
import contextlib
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.parse
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
BUNDLE_FORMAT = "stored-audio-v1"
CACHE_LIMIT = 8 * 1024**3
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
    return [n for n in dict.fromkeys(names)
            if (n.startswith("LoreForever_Voice_") or n.startswith("LoreForever_Edition_") and n.endswith("_Audio"))
            and (ADDONS / n).is_dir()]


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
    try:
        data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    except (ValueError, UnicodeError) as e:
        raise Failure(f"invalid {MANIFEST.relative_to(ROOT)}: {e}") from e
    if not isinstance(data, dict) or not isinstance(data.get("packs"), dict):
        raise Failure(f"{MANIFEST.relative_to(ROOT)} has no 'packs'")
    for pack, entry in data["packs"].items():
        if not re.fullmatch(r"LoreForever_(?:Voice_[A-Za-z0-9_]+|Edition_[A-Za-z0-9_]+_Audio)", pack):
            raise Failure(f"invalid audio pack name: {pack!r}")
        fp = entry.get("fingerprint") if isinstance(entry, dict) else None
        if (not isinstance(fp, str) or not re.fullmatch(r"[0-9a-f]{64}", fp)
                or entry.get("asset") != f"{pack}-{fp[:16]}.zip"
                or type(entry.get("files")) is not int or entry["files"] < 1
                or type(entry.get("bytes")) is not int or entry["bytes"] < 0):
            raise Failure(f"invalid audio manifest entry for {pack}")
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


def reject_pointers(pack: str, files: list[tuple[str, Path]]) -> None:
    pointers = [n for n, p in files if p.stat().st_size <= 1024 and p.read_bytes().startswith(LFS_POINTER)]
    if pointers:
        raise Failure(f"{len(pointers)} files in addon/{pack}/Audio are Git LFS pointers, not recordings (e.g. "
                      f"{pointers[0]}). Fetch them first: git -c lfs.fetchexclude= lfs pull")


def checked_recordings(pack: str, entry: dict) -> list[tuple[str, Path]]:
    files = recordings(pack)
    fp, size = hashlib.sha256(), 0
    for name, path in files:
        content = path.read_bytes()
        if len(content) <= 1024 and content.startswith(LFS_POINTER):
            raise Failure(f"addon/{pack}/Audio/{name} contains Git LFS pointers, not recordings. "
                          "Fetch them first: git -c lfs.fetchexclude= lfs pull")
        size += len(content)
        fp.update(hashlib.sha256(name.encode()).digest() + hashlib.sha256(content).digest())
    if len(files) != entry["files"] or size != entry["bytes"] or fp.hexdigest() != entry["fingerprint"]:
        raise Failure(f"addon/{pack}/Audio changed since {MANIFEST.relative_to(ROOT)} was written; run "
                      "audio_assets.py manifest again")
    return files


def digest(path: Path) -> str:
    with path.open("rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def verify_bundle(path: Path, entry: dict) -> None:
    """Check actual recordings and deterministic ZIP metadata before admitting bytes to the cache."""
    fp, size = hashlib.sha256(), 0
    with zipfile.ZipFile(path) as z:
        infos = z.infolist()
        names = [i.filename for i in infos]
        if len(infos) != entry["files"] or names != sorted(set(names)) or z.comment:
            raise Failure("cached bundle has unexpected entries")
        for info in infos:
            name = info.filename.removeprefix("Audio/")
            if (name == info.filename or any(p in ("", ".", "..") for p in name.split("/"))
                    or "\\" in name or Path(name).suffix.lower() not in AUDIO
                    or info.compress_type != zipfile.ZIP_STORED or info.date_time != DATE
                    or info.external_attr != 0o644 << 16 or info.comment):
                raise Failure("cached bundle has unexpected ZIP metadata")
            with z.open(info) as recording:
                clip_digest = hashlib.file_digest(recording, "sha256").digest()
            fp.update(hashlib.sha256(name.encode()).digest() + clip_digest)
            size += info.file_size
    if size != entry["bytes"] or fp.hexdigest() != entry["fingerprint"]:
        raise Failure("bundle does not hold the manifest's recordings")


def cache_identity(pack: str, entry: dict) -> dict:
    # Python's ZIP writer is part of the format implementation. Changes to either tool invalidate old entries.
    return {"pack": pack, "entry": entry, "format": BUNDLE_FORMAT,
            "tool": digest(Path(__file__)), "zipfile": digest(Path(zipfile.__file__)), "python": sys.version}


@contextlib.contextmanager
def cache_lock(root: Path):
    """Serialize validation/publication and quota accounting across candidate processes."""
    root.mkdir(parents=True, exist_ok=True)
    with (root / ".lock").open("a+b") as lock:
        if os.name == "nt":
            import msvcrt
            if lock.seek(0, os.SEEK_END) == 0:
                lock.write(b"\0")
                lock.flush()
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            if os.name == "nt":
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


def atomic_copy(source: Path, out: Path) -> None:
    # A caller may overwrite its rehearsal output. Hardlinks would silently overwrite the shared cache too.
    with tempfile.TemporaryDirectory(prefix=".audio-copy-", dir=out.parent) as tmp:
        stage = Path(tmp) / out.name
        shutil.copyfile(source, stage)
        os.replace(stage, out)


def cached_bundle(pack: str, files: list[tuple[str, Path]], entry: dict, out: Path,
                  cache: Path | None) -> Path:
    """Reuse verified bytes, retaining at most 8 GiB. Full caches stop admitting entries, never evict them.

    This directory belongs only to audio_assets.py; operators can remove it to reclaim space. Overrides are
    --cache-dir/LORE_AUDIO_CACHE_DIR; --no-cache or LORE_AUDIO_CACHE=0 bypasses reads and writes entirely.
    A lock protects the two atomically replaced files: interrupted publication is a miss on the next read.
    """
    if cache is None:
        with tempfile.TemporaryDirectory(prefix=".audio-build-", dir=out.parent) as tmp:
            stage = bundle(pack, files, Path(tmp) / out.name)
            verify_bundle(stage, entry)
            os.replace(stage, out)
        return out
    identity = cache_identity(pack, entry)
    key = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
    archive, receipt = cache / f"{key}.zip", cache / f"{key}.json"
    with cache_lock(cache):
        try:
            saved = json.loads(receipt.read_text(encoding="utf-8"))
            if saved["identity"] != identity or saved["sha256"] != digest(archive):
                raise Failure("cache receipt mismatch")
            # Admission checked every member against the source manifest. A whole-archive SHA binds those same
            # bytes to this identity without parsing and rehashing every recording a second time on each hit.
        except (Failure, OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile, RuntimeError):
            pass  # Absent, old or corrupted entries are rebuilt from verified source recordings.
        else:
            atomic_copy(archive, out)
            print(f"  audio cache: reused {entry['asset']}")
            return out
        # Build outside the cache: its retained-size bound also holds while new entries are being prepared.
        with tempfile.TemporaryDirectory(prefix=".audio-build-", dir=out.parent) as tmp:
            stage = bundle(pack, files, Path(tmp) / out.name)
            verify_bundle(stage, entry)
            metadata = json.dumps({"identity": identity, "sha256": digest(stage)}, sort_keys=True) + "\n"
            occupied = sum(p.stat().st_size for p in cache.iterdir()
                           if re.fullmatch(r"[0-9a-f]{64}\.(?:zip|json)", p.name) and p.is_file()
                           and p not in (archive, receipt))
            if occupied + stage.stat().st_size + len(metadata.encode()) <= CACHE_LIMIT:
                atomic_copy(stage, archive)
                # Locking readers cannot observe a mixed pair; a crash between replacements fails validation.
                note = Path(tmp) / "receipt.json"
                note.write_text(metadata, encoding="utf-8")
                atomic_copy(note, receipt)
                print(f"  audio cache: stored {entry['asset']}")
            else:
                print(f"  audio cache: full; built {entry['asset']} without retaining it")
            os.replace(stage, out)
    return out


# --- commands ------------------------------------------------------------------------------------------------------

def cmd_manifest(_args) -> int:
    packs = {}
    for pack in shipped_packs():
        from transport_assets import TransportError, validate
        try:
            validate(ROOT / "addon" / pack)
        except TransportError as e:
            raise Failure(str(e)) from e
        files = recordings(pack)
        if not files:
            continue   # build-release.sh refuses a shipped voice pack without recordings
        reject_pointers(pack, files)
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
            files = checked_recordings(pack, e)
            out = Path(args.out) if args.out else Path(tmp)
            out.mkdir(parents=True, exist_ok=True)
            cache = None if args.no_cache else Path(args.cache_dir).expanduser()
            path = cached_bundle(pack, files, e, out / e["asset"], cache)
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
            base = urllib.parse.urlsplit(args.base)
            local = base.scheme == "file" and base.netloc in ("", "localhost") and not (base.query or base.fragment)
            path = (Path(urllib.request.url2pathname(base.path)) / e["asset"] if local
                    else Path(tmp, e["asset"]))
            if not local:
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
            if not local:
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
    up.add_argument("--cache-dir", default=os.environ.get("LORE_AUDIO_CACHE_DIR") or str(
        Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "lore-forever" / "audio-bundles"),
        help="verified local bundle cache (LORE_AUDIO_CACHE_DIR overrides the default)")
    up.add_argument("--no-cache", action="store_true", default=os.environ.get("LORE_AUDIO_CACHE") == "0",
                    help="bypass the bundle cache (also LORE_AUDIO_CACHE=0)")
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
