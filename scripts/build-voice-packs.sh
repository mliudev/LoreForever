#!/usr/bin/env bash
# Build the narration downloads every release carries besides the main zip, each a zip with its add-on folder(s) at
# the top level, into dist/packs/:
#   LoreForever_Voice_Female.zip                          the female narrator (zone stories, answers, bosses)
#   LoreForever_Voice_Female_Alliance.zip / _Horde.zip    her lands packs
#   LoreForever_Voice_Female-complete.zip                 her three packs in one zip
#   LoreForever_Voice_QuestGivers.zip                     quest givers' voices: quest dialogue in each quest giver's
#                                                         race and gender (its own CurseForge project: under 480 MB)
#   LoreForever_Voice_<Default|Female>_<locale>.zip       either narrator in deDE, esES, frFR or ptBR (LOR-177), one
#                                                         pack each, once recorded
#   LoreForever_Voice_<Default|Female>_Quests_<locale>.zip  either narrator's quest dialogue in one of those languages
#                                                         (LOR-226, the game's own quest text), once recorded
# They all follow the core's version (scripts/release.sh stamps it into their .toc files, like the default pack's).
# A pack whose folder isn't in addon/ is skipped with a note.
# The main download comes from scripts/build-release.sh; it carries the default (male) narrator's core and lands packs.
# dist/packs/manifest.tsv lists file, CurseForge display name and version, for the release workflow's additional
# files. --versioned names the zips <name>-<version>.zip instead (to keep a copy, or upload one by hand).
# Usage: scripts/build-voice-packs.sh [--versioned]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec python3 - "$ROOT" "$@" <<'PY'
import re, sys, zipfile
from pathlib import Path

root = Path(sys.argv[1])
addons, out = root / "addon", root / "dist" / "packs"
VERSIONED = "--versioned" in sys.argv[2:]
AUDIO = {".mp3", ".ogg"}
# zip name -> (folders in it, display name with {v} for the version)
DOWNLOADS = {
    "LoreForever_Voice_Female": (["LoreForever_Voice_Female"], "Female narrator: core {v}"),
    "LoreForever_Voice_Female_Alliance": (["LoreForever_Voice_Female_Alliance"], "Female narrator: Alliance lands {v}"),
    "LoreForever_Voice_Female_Horde": (["LoreForever_Voice_Female_Horde"], "Female narrator: Horde lands {v}"),
    "LoreForever_Voice_Female_Quests": (["LoreForever_Voice_Female_Quests"], "Female narrator: quest dialogue {v}"),
    "LoreForever_Voice_Female-complete": (["LoreForever_Voice_Female", "LoreForever_Voice_Female_Alliance",
                                           "LoreForever_Voice_Female_Horde", "LoreForever_Voice_Female_Quests"],
                                          "Female narrator: complete {v} (all narrations)"),
    "LoreForever_Voice_QuestGivers": (["LoreForever_Voice_QuestGivers"], "Quest givers' voices {v}"),
    # Both narrators in the language packs' languages (LOR-177): one zip per narrator and language, each holding the
    # zone stories, answers, places and people (~340 MB; lore.voicepack locale keeps each under 480 MB). Skipped until
    # recorded (no folder in addon/).
    "LoreForever_Voice_Default_deDE": (["LoreForever_Voice_Default_deDE"], "Male narrator: Deutsch {v}"),
    "LoreForever_Voice_Female_deDE": (["LoreForever_Voice_Female_deDE"], "Female narrator: Deutsch {v}"),
    "LoreForever_Voice_Default_esES": (["LoreForever_Voice_Default_esES"], "Male narrator: Español {v}"),
    "LoreForever_Voice_Female_esES": (["LoreForever_Voice_Female_esES"], "Female narrator: Español {v}"),
    "LoreForever_Voice_Default_frFR": (["LoreForever_Voice_Default_frFR"], "Male narrator: Français {v}"),
    "LoreForever_Voice_Female_frFR": (["LoreForever_Voice_Female_frFR"], "Female narrator: Français {v}"),
    "LoreForever_Voice_Default_ptBR": (["LoreForever_Voice_Default_ptBR"], "Male narrator: Português {v}"),
    "LoreForever_Voice_Female_ptBR": (["LoreForever_Voice_Female_ptBR"], "Female narrator: Português {v}"),
    # Their quest dialogue in those languages, the game's own quest text (LOR-226): one zip per narrator and language
    # (~320-390 MB at 48 kbps; lore.voicepack quests --locale refuses one over the limit). Skipped until recorded.
    "LoreForever_Voice_Default_Quests_deDE": (["LoreForever_Voice_Default_Quests_deDE"],
                                              "Male narrator: quest dialogue, Deutsch {v}"),
    "LoreForever_Voice_Female_Quests_deDE": (["LoreForever_Voice_Female_Quests_deDE"],
                                             "Female narrator: quest dialogue, Deutsch {v}"),
    "LoreForever_Voice_Default_Quests_esES": (["LoreForever_Voice_Default_Quests_esES"],
                                              "Male narrator: quest dialogue, Español {v}"),
    "LoreForever_Voice_Female_Quests_esES": (["LoreForever_Voice_Female_Quests_esES"],
                                             "Female narrator: quest dialogue, Español {v}"),
    "LoreForever_Voice_Default_Quests_frFR": (["LoreForever_Voice_Default_Quests_frFR"],
                                              "Male narrator: quest dialogue, Français {v}"),
    "LoreForever_Voice_Female_Quests_frFR": (["LoreForever_Voice_Female_Quests_frFR"],
                                             "Female narrator: quest dialogue, Français {v}"),
    "LoreForever_Voice_Default_Quests_ptBR": (["LoreForever_Voice_Default_Quests_ptBR"],
                                              "Male narrator: quest dialogue, Português {v}"),
    "LoreForever_Voice_Female_Quests_ptBR": (["LoreForever_Voice_Female_Quests_ptBR"],
                                             "Female narrator: quest dialogue, Português {v}"),
}
# zips a CurseForge project of their own takes as they are (the quest givers' voices, and each narrator and its quest
# dialogue in each language pack's language: release/curseforge.json)
CURSEFORGE_OWN = {"LoreForever_Voice_QuestGivers"} | {n for n in DOWNLOADS if re.fullmatch(
    r"LoreForever_Voice_(Default|Female)(_Quests)?_[a-z]{2}[A-Z]{2}", n)}
CURSEFORGE_MB = 480                                  # its upload API refuses bigger files

def version(folder):
    toc = (addons / folder / f"{folder}.toc").read_text(encoding="utf-8")
    m = re.search(r"^##\s*Version:\s*(\S+)", toc, re.M)
    if not m:
        sys.exit(f"build-voice-packs: no ## Version in {folder}.toc")
    return m.group(1)

core = version("LoreForever") if (addons / "LoreForever" / "LoreForever.toc").is_file() else None
out.mkdir(parents=True, exist_ok=True)
rows = []
for name, (folders, display) in DOWNLOADS.items():
    if not all((addons / f / f"{f}.toc").is_file() for f in folders):
        print(f"skip {name}: {', '.join(f for f in folders if not (addons / f).is_dir()) or 'no .toc'} not in addon/")
        continue
    v = version(folders[0])
    for f in folders:
        if core and version(f) != core:
            sys.exit(f"build-voice-packs: {f}.toc has ## Version {version(f)}; released packs follow the core ({core})")
    for f in folders:
        if not (addons / f / "Clips.lua").is_file() or not any((addons / f / "Audio").glob("*.*")):
            sys.exit(f"build-voice-packs: {f} has no Clips.lua or no recordings")
        # Audio is stored with Git LFS: a checkout that never fetched it has pointer files instead of recordings.
        pointers = [p for p in (addons / f / "Audio").iterdir() if p.is_file() and p.stat().st_size <= 1024
                    and p.read_bytes().startswith(b"version https://git-lfs")]
        if pointers:
            sys.exit(f"build-voice-packs: {len(pointers)} files in {f}/Audio are Git LFS pointers, not recordings "
                     f"(e.g. {pointers[0].name}). Fetch them first: git -c lfs.fetchexclude= lfs pull")
    path = out / (f"{name}-{v}.zip" if VERSIONED else f"{name}.zip")
    with zipfile.ZipFile(path, "w") as z:
        for f in folders:
            for p in sorted((addons / f).rglob("*")):
                if p.is_file():
                    info = zipfile.ZipInfo(f"{f}/{p.relative_to(addons / f).as_posix()}", date_time=(2026, 1, 1, 0, 0, 0))
                    info.compress_type = zipfile.ZIP_STORED if p.suffix.lower() in AUDIO else zipfile.ZIP_DEFLATED
                    info.external_attr = 0o644 << 16
                    z.writestr(info, p.read_bytes(), compresslevel=9)
    rows.append((path.name, display.format(v=v), v))
    print(f"built {path.relative_to(root)} ({path.stat().st_size / 1024**2:.1f} MB)")
    if name in CURSEFORGE_OWN and path.stat().st_size > CURSEFORGE_MB * 1024**2:
        print(f"warning: {path.name} is over CurseForge's {CURSEFORGE_MB} MB upload limit; rebuild the pack at a lower "
              "bitrate (lore.voicepack quests --bitrate, or locale --bitrate for a narrator in another language)")
(out / "manifest.tsv").write_text("".join("\t".join(r) + "\n" for r in rows), encoding="utf-8")
PY
