#!/usr/bin/env bash
# Build the narration downloads every release carries besides the main zip, each a zip with its add-on folder(s) at
# the top level, into dist/packs/:
#   LoreForever_Voice_Female.zip                          the female narrator (zone stories, answers, bosses)
#   LoreForever_Voice_Female_Alliance.zip / _Horde.zip    her lands packs
#   LoreForever_Voice_Female-complete.zip                 her core and lands stories in one zip
#   LoreForever_Voice_Female_enUS-complete.zip            available English female stories and answers
#   LoreForever_Voice_<Default|Female>_<locale>-complete.zip  available stories and answers plus translated text
#   LoreForever_Voice_<Default|Female>_Quests.zip         optional English quest dialogue, downloaded deliberately
#   LoreForever_Voice_QuestGivers.zip                     quest givers' voices: quest dialogue in each quest giver's
#                                                         race and gender (its own CurseForge project: under 480 MB)
#   LoreForever_Voice_<Default|Female>_<locale>.zip       either narrator in deDE, esES, frFR or ptBR (LOR-177), one
#                                                         pack each, once recorded
#   LoreForever_Voice_<Default|Female>_Quests_<locale>.zip  either narrator's quest dialogue in one of those languages
#                                                         (LOR-226, the game's own quest text), once recorded
#   LoreForever_Voice_<Default|Female>_Answers_<Part>[_<locale>].zip  every other question and answer (LOR-227,
#                                                         lore.answers: Places, Lore, People, Quests1-3), in English or
#                                                         one of those languages, once its renders land
# They all follow the core's version (scripts/release.sh stamps it into their .toc files, like the default pack's).
# A pack whose folder isn't in addon/ is skipped with a note.
# The main download comes from scripts/build-release.sh; it carries the default (male) narrator's core and lands packs.
# dist/packs/manifest.tsv lists file, CurseForge display name and version, for the release workflow's additional
# files. --versioned names the zips <name>-<version>.zip instead (to keep a copy, or upload one by hand).
# Usage: scripts/build-voice-packs.sh [--versioned]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# A sparse worktree (scripts/new-worktree.sh) has no voice audio or translated lore: refuse rather than build
# without them.
[ "$(git -C "$ROOT" config --get lore.sparse 2>/dev/null)" != true ] \
  || [ "$(git -C "$ROOT" config --bool core.sparseCheckout 2>/dev/null)" != true ] \
  || { echo "${0##*/}: this worktree is sparse; run 'git sparse-checkout disable' here first, or use" \
         "~/git/lore-forever" >&2; exit 1; }
exec python3 - "$ROOT" "$@" <<'PY'
import atexit, re, shutil, sys, tempfile, zipfile, subprocess
from pathlib import Path

root = Path(sys.argv[1])
sys.path.insert(0, str(root / "scripts"))
from transport_assets import TransportError, pause_split, pause_split_coverage, split_note, validate as validate_transport
from load_order import LoadError, addon_files
addons, out = root / "addon", root / "dist" / "packs"
VERSIONED = "--versioned" in sys.argv[2:]
AUDIO = {".mp3", ".ogg"}
# zip name -> (folders in it, display name with {v} for the version)
DOWNLOADS = {
    "LoreForever_Voice_Default_Quests": (["LoreForever_Voice_Default_Quests"], "Male narrator: quest dialogue {v}"),
    "LoreForever_Voice_Female": (["LoreForever_Voice_Female"], "Female narrator: core {v}"),
    "LoreForever_Voice_Female_Alliance": (["LoreForever_Voice_Female_Alliance"], "Female narrator: Alliance lands {v}"),
    "LoreForever_Voice_Female_Horde": (["LoreForever_Voice_Female_Horde"], "Female narrator: Horde lands {v}"),
    "LoreForever_Voice_Female_Quests": (["LoreForever_Voice_Female_Quests"], "Female narrator: quest dialogue {v}"),
    "LoreForever_Voice_Female-complete": (["LoreForever_Voice_Female", "LoreForever_Voice_Female_Alliance",
                                           "LoreForever_Voice_Female_Horde"],
                                          "Female narrator: stories and lands {v}"),
    "LoreForever_Voice_QuestGivers": (["LoreForever_Voice_QuestGivers"], "Quest givers' voices {v}"),
    # Both narrators in the language packs' languages (LOR-177): one zip per narrator and language, each holding the
    # zone stories, answers, places and people (~340 MB; lore.voicepack locale keeps each under 480 MB). Skipped until
    # recorded (no folder in addon/).
    "LoreForever_Voice_Default_ukUA": (["LoreForever_Voice_Default_ukUA"], "Pekelnyj / UALL: Ukrainian stories and answers {v}"),
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
# Every other question and answer (LOR-227, lore.answers PARTS): one zip per narrator, part and language (each under
# 470 MB at 48 kbps; lore.voicepack answers refuses one over). Skipped until rendered.
ANSWER_PARTS = {"Places": "zones and places", "Lore": "lore and items", "People": "people",
                "Quests1": "quests, levels 1-13", "Quests2": "quests, levels 14-22", "Quests3": "quests, level 23 and up"}
LANGUAGES = {"": "", "_deDE": ", Deutsch", "_esES": ", Español", "_frFR": ", Français", "_ptBR": ", Português"}
for loc, lang in LANGUAGES.items():
    for voice, who in (("Default", "Male"), ("Female", "Female")):
        for part, what in ANSWER_PARTS.items():
            folder = f"LoreForever_Voice_{voice}_Answers_{part}{loc}"
            DOWNLOADS[folder] = ([folder], f"{who} narrator: answers about {what}{lang} {{v}}")
# New manual bundles use only available story and answer components. Quest dialogue stays a separate opt-in pack.
FULL_BUNDLES = {}
for loc, lang in (("enUS", "English"), *((k[1:], v[2:]) for k, v in LANGUAGES.items() if k)):
    for voice, who in (("Default", "Male"), ("Female", "Female")):
        if loc == "enUS" and voice == "Default":
            continue   # English male core and lands stay in the main download.
        suffix = "" if loc == "enUS" else f"_{loc}"
        base = f"LoreForever_Voice_{voice}"
        folders = [base, base + "_Alliance", base + "_Horde"] if not suffix else [base + suffix]
        folders += [base + "_Answers_" + part + suffix for part in ANSWER_PARTS]
        FULL_BUNDLES[f"{base}_{loc}-complete"] = (folders, f"{who} narrator: {lang}, stories and answers {{v}}")
DOWNLOADS.update(FULL_BUNDLES)
# zips a CurseForge project of their own takes as they are (the quest givers' voices, and each narrator and its quest
# dialogue in each language pack's language: release/curseforge.json), and the answers packs, sized for one
CURSEFORGE_OWN = {"LoreForever_Voice_QuestGivers", "LoreForever_Voice_Default_Quests",
                  "LoreForever_Voice_Female_Quests"} | {n for n in DOWNLOADS if re.fullmatch(
    r"LoreForever_Voice_(Default|Female)((_Quests)?_[a-z]{2}[A-Z]{2}|_Answers_\w+)", n)}
CURSEFORGE_MB = 480                                  # its upload API refuses bigger files

def version(folder):
    toc = (addons / folder / f"{folder}.toc").read_text(encoding="utf-8")
    m = re.search(r"^##\s*Version:\s*(\S+)", toc, re.M)
    if not m:
        sys.exit(f"build-voice-packs: no ## Version in {folder}.toc")
    return m.group(1)

core = version("LoreForever") if (addons / "LoreForever" / "LoreForever.toc").is_file() else None

def language_files(locale):
    """Only the language add-on's client-loaded files, checked against this release's core and lore data."""
    folder = f"LoreForever_Lang_{locale}"
    src = addons / folder
    try:
        meta, lua, xml = addon_files(src)
    except (LoadError, OSError) as e:
        sys.exit(f"build-voice-packs: {folder}: {e}")
    for field, expected in (("Interface", "16001"), ("Version", core), ("Dependencies", "LoreForever"),
                            ("X-LoreForever-Pack", "lang"), ("X-LoreForever-Locale", locale)):
        if expected is None or meta.get(field) != expected:
            sys.exit(f"build-voice-packs: {folder}.toc has {field} {meta.get(field)!r}, expected {expected!r}")
    index = addons / "LoreForever" / "Data" / "Index.lua"
    m = re.search(r'ns\.DB\s*=\s*\{\s*version\s*=\s*"([^"]+)"', index.read_text(encoding="utf-8"))
    if not m or meta.get("X-LoreForever-DataVersion") != m.group(1):
        sys.exit(f"build-voice-packs: {folder} was built from different lore data; rebuild with compile_lua --lang {locale}")
    listed = list(dict.fromkeys([f"{folder}.toc", *xml, *lua]))
    # These language files previously received build-release.sh's secret scan inside the main zip. Keep the guard
    # when moving them into voice downloads, along with the restricted list of client-loaded files.
    secret = re.compile(r"(?<![\w-])(?:AIza[\w-]{35}|sk-(?:ant|proj)-[\w-]{20,}|sk_[0-9a-f]{40,}|sk-[A-Za-z0-9]{40,})(?![\w-])"
                        r"|op:[/][/]|GEMINI[_]API[_]KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY|ELEVENLABS[_]API[_]KEY|xi[-]api[-]key"
                        r"|-----BEGIN [A-Z ]*PRIVATE KEY", re.I)
    for name in listed:
        if not (src / name).is_file():
            sys.exit(f"build-voice-packs: missing {folder}/{name}")
        if secret.search((src / name).read_text(encoding="utf-8", errors="replace")):
            sys.exit(f"build-voice-packs: {folder}/{name} contains something that looks like a secret")
    return folder, listed

out.mkdir(parents=True, exist_ok=True)
rows = []

# Pause and resume (LOR-346, transport_assets.pause_split): a pack's recordings with cut points (complete stories,
# answers, quest dialogue, overviews) ship as their pieces, from a split copy of the pack (made once, whichever zips it
# goes in).
SOURCES, STAGE = {}, None
def source(folder):
    global STAGE
    if folder not in SOURCES:
        SOURCES[folder] = addons / folder
        try:
            manifest = validate_transport(addons / folder)
            stories, cut = pause_split_coverage(manifest)
            if (manifest or {}).get("cuts"):
                if STAGE is None:
                    STAGE = Path(tempfile.mkdtemp(prefix=".pause-split-", dir=out))
                    atexit.register(shutil.rmtree, STAGE, True)
                SOURCES[folder], split, _ = pause_split(addons / folder, STAGE)
                if split:
                    print(f"{folder}: {split_note(validate_transport(SOURCES[folder]), split)}")
            if stories and not cut:
                print(f"{folder}: none of its {stories} complete stories has cut points, so they play whole")
        except TransportError as e:
            sys.exit(f"build-voice-packs: {e}")
    return SOURCES[folder]
for name, (folders, display) in DOWNLOADS.items():
    if name in FULL_BUNDLES:
        folders = [f for f in folders if (addons / f / f"{f}.toc").is_file()]
        if not folders:
            print(f"skip {name}: no recorded components in addon/")
            continue
    if not all((addons / f / f"{f}.toc").is_file() for f in folders):
        print(f"skip {name}: {', '.join(f for f in folders if not (addons / f).is_dir()) or 'no .toc'} not in addon/")
        continue
    v = version(folders[0])
    for f in folders:
        if core and version(f) != core:
            sys.exit(f"build-voice-packs: {f}.toc has ## Version {version(f)}; released packs follow the core ({core})")
    for f in folders:
        try:
            validate_transport(addons / f)
        except TransportError as e:
            sys.exit(f"build-voice-packs: {e}")
        if not (addons / f / "Clips.lua").is_file() or not any((addons / f / "Audio").glob("*.*")):
            sys.exit(f"build-voice-packs: {f} has no Clips.lua or no recordings")
        # Audio is stored with Git LFS: a checkout that never fetched it has pointer files instead of recordings.
        pointers = [p for p in (addons / f / "Audio").rglob("*") if p.is_file() and p.stat().st_size <= 1024
                    and p.read_bytes().startswith(b"version https://git-lfs")]
        if pointers:
            sys.exit(f"build-voice-packs: {len(pointers)} files in {f}/Audio are Git LFS pointers, not recordings "
                     f"(e.g. {pointers[0].name}). Fetch them first: git -c lfs.fetchexclude= lfs pull")
    path = out / (f"{name}-{v}.zip" if VERSIONED else f"{name}.zip")
    locale = re.search(r"_([a-z]{2}[A-Z]{2})(?:-complete)?$", name)
    lang = language_files(locale.group(1)) if locale and locale.group(1) != "enUS" else None
    files = [(f, source(f), sorted(source(f).rglob("*"))) for f in folders]   # before the zip: a split can fail
    if lang:
        f, listed = lang
        files.append((f, addons / f, [addons / f / p for p in listed]))
    with zipfile.ZipFile(path, "w") as z:
        for f, src, paths in files:
            for p in paths:
                if p.is_file():
                    info = zipfile.ZipInfo(f"{f}/{p.relative_to(src).as_posix()}", date_time=(2026, 1, 1, 0, 0, 0))
                    info.compress_type = zipfile.ZIP_STORED if p.suffix.lower() in AUDIO else zipfile.ZIP_DEFLATED
                    info.external_attr = 0o644 << 16
                    z.writestr(info, p.read_bytes(), compresslevel=9)
    rows.append((path.name, display.format(v=v), v))
    print(f"built {path.relative_to(root)} ({path.stat().st_size / 1024**2:.1f} MB)")
    if name in CURSEFORGE_OWN and path.stat().st_size > CURSEFORGE_MB * 1024**2:
        print(f"warning: {path.name} is over CurseForge's {CURSEFORGE_MB} MB upload limit; rebuild the pack at a lower "
              "bitrate (lore.voicepack quests --bitrate, or locale --bitrate for a narrator in another language), or "
              "split an answers part (lore.answers PARTS)")
# A contributor edition must remain a single paired artifact. Its validator also
# rejects a lone component, mismatched pairing identity and unhydrated audio.
edition_names = ("LoreForever_Edition_Densuad_esES_Text", "LoreForever_Edition_Densuad_esES_Audio")
if any((addons / name).exists() for name in edition_names):
    command = [sys.executable, str(root / "scripts" / "contributor_bundle.py"),
               "--addons", str(addons), "--out", str(out)]
    if VERSIONED:
        command.append("--versioned")
    path = Path(subprocess.check_output(command, cwd=root, text=True).strip())
    rows.append((path.name, f"Densuad: Spanish text and narration {core}", core))
    print(f"built {path.relative_to(root)} ({path.stat().st_size / 1024**2:.1f} MB)")
(out / "manifest.tsv").write_text("".join("\t".join(r) + "\n" for r in rows), encoding="utf-8")
PY
