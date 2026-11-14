"""What a narration pack zip holds and its bytes (scripts/build-voice-packs.sh).

Everything here decides a zip's contents, so build-voice-packs.sh's zip cache (the release rehearsal's only) keys on
this file as a whole, with the pause splits' transport_assets.py and the language files' load_order.py (LOR-1007).
Code that picks or changes a zip's entries goes here, never in build-voice-packs.sh, or a cached zip could be the old
one while the Release workflow (which never reads the cache) writes the new.
"""

import os
import zipfile
from pathlib import Path

AUDIO = {".mp3", ".ogg"}   # stored as they are; every other file deflated at level 9


def zip_files(folders, source, lang=None):
    """The entries of a zip of these pack folders: [(folder, src, paths)], each folder's files from source(folder) (its
    pause-split copy, else the folder), then the language pack's client-loaded files when it carries one:
    lang = (folder, its listed paths, that folder)."""
    files = [(f, source(f), sorted(source(f).rglob("*"))) for f in folders]
    if lang:
        lf, listed, folder = lang
        files.append((lf, folder, [folder / p for p in listed]))
    return files


def write_zip(path: Path, files):
    """One download's zip: files is zip_files()'s, each path's entry under folder/ by its place in src. The same bytes
    whichever process writes it (fixed dates and modes, entries in the order given), so zips are written side by side.
    Written beside and moved into place: path may be a link to a zip cache entry, which writing in place would change."""
    part = path.with_name(f".{path.name}.{os.getpid()}.part")
    try:
        with zipfile.ZipFile(part, "w") as z:
            for f, src, paths in files:
                for p in paths:
                    if p.is_file():
                        info = zipfile.ZipInfo(f"{f}/{p.relative_to(src).as_posix()}", date_time=(2026, 1, 1, 0, 0, 0))
                        info.compress_type = zipfile.ZIP_STORED if p.suffix.lower() in AUDIO else zipfile.ZIP_DEFLATED
                        info.external_attr = 0o644 << 16
                        z.writestr(info, p.read_bytes(), compresslevel=9)
        os.replace(part, path)
    finally:
        part.unlink(missing_ok=True)
    return path.stat().st_size
