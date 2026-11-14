#!/usr/bin/env bash
# Build the narration downloads every release carries besides the main zip, each a zip with its add-on folder(s) at
# the top level, into dist/packs/:
#   LoreForever_Voice_Female.zip                          the female narrator (zone stories, answers, bosses)
#   LoreForever_Voice_Female_Alliance.zip / _Horde.zip    her lands packs
#   LoreForever_Voice_Female-complete.zip                 her core and lands stories in one zip
#   LoreForever_Voice_<Default|Female>_<locale>-complete.zip  available stories and answers plus translated text (once
#                                                         it holds more than the narrator's own language pack zip)
#   LoreForever_Voice_<Default|Female>_Quests.zip         optional English quest dialogue, downloaded deliberately
#   LoreForever_Voice_<Default|Female>_MorePlaces.zip / _MorePeople.zip  more subzone and people stories (complete
#                                                         stories only), once registered
#   LoreForever_Voice_<Default|Female>_MoreItems.zip / _MoreQuests1.zip / _MoreQuests2.zip / _MoreQuests3.zip  item stories and quest
#                                                         stories (levels 1-19, 20+), the same way
#   LoreForever_Voice_<Default|Female>_Quests2.zip / _Quests3.zip  the rest of the game's quest dialogue (levels up to
#                                                         50, 51-60: the quests without a lore entry), once recorded
#   LoreForever_Voice_QuestGivers2.zip / QuestGivers3.zip  the same for quest levels 31-50 and 51-60, once recorded
#   LoreForever_Voice_QuestGivers.zip                     quest givers' voices: quest dialogue in each quest giver's
#                                                         race and gender (its own CurseForge project: under 480 MB)
#   LoreForever_Voice_<Default|Female>_<locale>.zip       either narrator in deDE, esES, frFR, ptBR, itIT or zhCN (LOR-177),
#                                                         one pack each, once recorded; MorePeople_<locale> (and for zhCN, itIT, deDE and frFR,
#                                                         MoreItems_<locale> and MoreQuests1-3_<locale>) the rest of its stories
#   LoreForever_Voice_<Default|Female>_Quests_<locale>.zip  either narrator's quest dialogue in one of those languages
#                                                         (LOR-226, the game's own quest text), once recorded
# They all follow the core's version (scripts/release.sh stamps it into their .toc files, like the default pack's).
# A pack whose folder isn't in addon/ is skipped with a note.
# The main download comes from scripts/build-release.sh; it carries the default (male) narrator's core and lands packs.
# dist/packs/manifest.tsv lists file, CurseForge display name and version, for the release workflow's additional
# files. --versioned names the zips <name>-<version>.zip instead (to keep a copy, or upload one by hand).
# --sizes builds nothing: after the same checks, one line per folder of each zip it would build, "size<TAB>zip<TAB>
# folder<TAB>bytes" (that folder's share of the zip: its recordings stored, the rest deflated as here, plus zip
# headers), and "skipped<TAB>zip<TAB>why" for a bundle over GitHub's limit (scripts/release_sizes.py, LOR-443).
# --pack NAME (repeatable) limits it to the zips made only of those packs, and hydrates only those from the asset
# store: `--sizes --pack <a store pack>` works in a pointers worktree (new-worktree.sh --pointers), where no other
# pack's recordings are needed.
# Usage: scripts/build-voice-packs.sh [--versioned | --sizes] [--pack NAME ...]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# A sparse worktree without the language folders would do English only: stop, with the line that adds them.
[ ! -f "$ROOT/scripts/need_langs.py" ] || python3 "$ROOT/scripts/need_langs.py" "${0##*/}" || exit 1   # (a fixture copy of this script has no checkout)
# A sparse worktree (scripts/new-worktree.sh) has no voice audio or translated lore, and the main checkout no voice
# audio: refuse rather than build without them.
{ [ "$(git -C "$ROOT" config --get lore.sparse 2>/dev/null)" != true ] \
    || [ "$(git -C "$ROOT" config --bool core.sparseCheckout 2>/dev/null)" != true ]; } \
  && [ "$(git -C "$ROOT" ls-files -t -- addon/LoreForever_Voice_Default/Audio/ 2>/dev/null | head -c 1)" != S ] \
  || { echo "${0##*/}: this checkout is sparse. In your own worktree, run 'git sparse-checkout disable' first; or make" \
         "a full one: scripts/new-worktree.sh --pointers <path>" \
         "(and 'python3 scripts/audio_store.py hydrate' there for the recordings)" >&2; exit 1; }
# Packs in the asset store (LOR-440): their recordings into the gitignored Audio/ first, every clip checked against
# its manifest. The public repo has no store (its workflow puts recordings back with audio_assets.py fetch).
ONLY=()
args=("$@")
for i in "${!args[@]}"; do
  if [ "${args[$i]}" = --pack ]; then
    [ -n "${args[$((i + 1))]:-}" ] || { echo "build-voice-packs.sh: --pack needs a pack name" >&2; exit 2; }
    ONLY+=("--pack=${args[$((i + 1))]}")
  fi
done
if [ -f "$ROOT/scripts/audio_store.py" ] && [ -d "$ROOT/release/audio-store" ]; then
  python3 "$ROOT/scripts/audio_store.py" hydrate --quiet "${ONLY[@]}" \
    || { echo "build-voice-packs.sh: couldn't fill in the asset store's recordings (above)" >&2; exit 1; }
fi
exec python3 - "$ROOT" "$@" <<'PY'
import atexit, functools, multiprocessing, os, re, shutil, sys, tempfile, zipfile, zlib, subprocess
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

root = Path(sys.argv[1])
sys.path.insert(0, str(root / "scripts"))
from transport_assets import TransportError, pause_split_report, validate as validate_transport
from load_order import LoadError, addon_files
from pack_zip import AUDIO, write_zip, zip_files   # what a zip holds and its bytes: the zip cache keys on that file
import build_jobs   # sized by free memory too, so builds started together can't take it all (scripts/build_jobs.py)
SPLIT_WORKER_MB = 400
# LORE_PACKS_OUT (an absolute folder) puts the zips elsewhere: the release rehearsal's go beside its zip cache, on
# another disk than these recordings (LOR-1007). The pause splits' hard-linked copies stay in dist/, beside them.
addons, out = root / "addon", Path(os.environ.get("LORE_PACKS_OUT") or root / "dist" / "packs")
def shown(path):   # a zip as this log names it: from the checkout's root, or whole when LORE_PACKS_OUT is elsewhere
    return path.relative_to(root) if path.is_relative_to(root) else path
VERSIONED = "--versioned" in sys.argv[2:]
SIZES = "--sizes" in sys.argv[2:]
ONLY = {a for i, a in enumerate(sys.argv[2:]) if i and sys.argv[2:][i - 1] == "--pack"}   # --pack NAME ...
DEFLATED = {}   # path -> its deflated size (a language pack's files go in several zips)

# The zip writers: forked here, before the pause-split pool starts its threads, and only for a build that writes zips.
# Disk-bound past a few, so at most LORE_PACK_ZIP_JOBS (default 8). LORE_PACK_ZIP_JOBS=1 writes them in this process.
ZIP_POOL = None
if not SIZES and int(os.environ.get("LORE_PACK_ZIP_JOBS", "8") or 8) > 1:
    _zip_slot = build_jobs.reserve("build-voice-packs zips", 150, cap=int(os.environ.get("LORE_PACK_ZIP_JOBS", "8") or 8))
    atexit.register(_zip_slot.release)
    if _zip_slot.workers > 1:
        ZIP_POOL = ProcessPoolExecutor(_zip_slot.workers, mp_context=multiprocessing.get_context("fork"))
        ZIP_POOL.submit(int, 0).result()   # every worker forked now (fork pools start them all at the first submit)
        atexit.register(lambda: ZIP_POOL.shutdown(wait=False, cancel_futures=True))

# LORE_PACK_ZIP_CACHE=DIR (release.sh's rehearsal only; never the Release workflow, which builds every zip): a zip whose
# inputs match one built before is linked from DIR instead of written again (the 2nd and later candidates of a version).
# Its key: what decides a zip's contents and bytes (Python, scripts/pack_zip.py whole, the pause splits'
# transport_assets.py and the language files' load_order.py), the zip's name and folders, each folder's recordings by release/audio.json's fingerprint (their
# names and contents; the count and bytes checked here too), and every other file of the folders and of the language
# pack it carries, by content. A pack without a fingerprint is always built. Not the rest of this script or
# build-release.sh: they change most days (twice between 1.8.0's two candidates, never in how a zip is written), and with
# them in the key no candidate ever hit (LOR-1007). A zip from the cache still gets its packs' checks, so a check added
# since runs on every pack. (Only the rehearsal reads the cache: the Release workflow writes every zip itself.)
CACHE = Path(os.environ["LORE_PACK_ZIP_CACHE"]) if os.environ.get("LORE_PACK_ZIP_CACHE") and not SIZES else None
import time
BUILD_START = time.time()
AUDIO_JSON = {}
if CACHE:
    try:
        import json
        AUDIO_JSON = json.loads((root / "release" / "audio.json").read_text(encoding="utf-8"))["packs"]
        CACHE.mkdir(parents=True, exist_ok=True)
    except (OSError, ValueError, KeyError) as e:
        print(f"note: no zip cache ({e})")
        CACHE = None
def _sha(b):
    import hashlib
    return hashlib.sha256(b).hexdigest()
_BUILD = _sha(sys.version.encode() + b"".join((root / "scripts" / n).read_bytes()
                                              for n in ("pack_zip.py", "transport_assets.py", "load_order.py")))
def zip_key(name, folders, lang):
    parts = [_BUILD, name]
    for f in folders:
        entry = AUDIO_JSON.get(f)
        if not isinstance(entry, dict) or not entry.get("fingerprint"):
            return None
        n = size = 0
        rest = []
        for p in sorted((addons / f).rglob("*")):
            if not p.is_file():
                continue
            if p.suffix.lower() in AUDIO and "Audio" in p.relative_to(addons / f).parts[:1]:
                n += 1
                size += p.stat().st_size
            else:
                rest.append(p.relative_to(addons / f).as_posix() + ":" + _sha(p.read_bytes()))
        if n != entry.get("files") or size != entry.get("bytes"):
            return None   # the recordings here aren't the ones the fingerprint names
        parts += [f, entry["fingerprint"], *rest]
    if lang:
        lf, listed = lang
        parts += [lf, *(p + ":" + _sha((addons / lf / p).read_bytes()) for p in listed)]
    return _sha("\n".join(parts).encode())
def from_cache(key, path):
    hit = CACHE / f"{core}-{key}.zip"
    if not hit.is_file():
        return False
    path.unlink(missing_ok=True)
    try:
        try:
            os.link(hit, path)
        except OSError:
            shutil.copyfile(hit, path)
        os.utime(hit)
    except OSError:   # pruned by another build since: write it
        path.unlink(missing_ok=True)
        return False
    return True
CACHE_NOTED = []
def to_cache(key, path):
    tmp = CACHE / f".{core}-{key}.{os.getpid()}.tmp"
    try:
        os.link(path, tmp)   # the same disk only: a copy would double what the build writes
        os.replace(tmp, CACHE / f"{core}-{key}.zip")
    except OSError as e:
        tmp.unlink(missing_ok=True)
        if not CACHE_NOTED:
            CACHE_NOTED.append(1)
            print(f"note: zip cache not filled ({e.strerror}: {CACHE} is on another disk than dist/packs?)")

def zip_bytes(folder, src, paths):
    """What these files add to a zip as written below: each entry's local and central headers (30 and 46 bytes plus
    its name, twice), its recording stored or its text deflated at level 9. The pieces of a pause split hold the same
    frames as the recording, so the unsplit folder stands in for them."""
    total = 0
    for p in paths:
        if not p.is_file():
            continue
        name = len(f"{folder}/{p.relative_to(src).as_posix()}".encode())
        if p.suffix.lower() in AUDIO:
            size = p.stat().st_size
        else:
            if p not in DEFLATED:
                c = zlib.compressobj(9, zlib.DEFLATED, -15)
                DEFLATED[p] = len(c.compress(p.read_bytes()) + c.flush())
            size = DEFLATED[p]
        total += 76 + 2 * name + size
    return total
# zip name -> (folders in it, display name with {v} for the version)
DOWNLOADS = {
    "LoreForever_Voice_Default_Quests": (["LoreForever_Voice_Default_Quests"], "Male narrator: quest dialogue, levels 1-25 {v}"),
    "LoreForever_Voice_Female": (["LoreForever_Voice_Female"], "Female narrator: core {v}"),
    "LoreForever_Voice_Female_Alliance": (["LoreForever_Voice_Female_Alliance"], "Female narrator: Alliance lands {v}"),
    "LoreForever_Voice_Female_Horde": (["LoreForever_Voice_Female_Horde"], "Female narrator: Horde lands {v}"),
    "LoreForever_Voice_Female_Quests": (["LoreForever_Voice_Female_Quests"], "Female narrator: quest dialogue, levels 1-25 {v}"),
    # The rest of the game's quest dialogue (voicepack.QUEST_MORE_PACKS): levels 26-50, and 51-60 (_Quests holds 1-25).
    "LoreForever_Voice_Default_Quests2": (["LoreForever_Voice_Default_Quests2"],
                                          "Male narrator: more quest dialogue, levels 26-50 {v}"),
    "LoreForever_Voice_Default_Quests3": (["LoreForever_Voice_Default_Quests3"],
                                          "Male narrator: more quest dialogue, levels 51-60 {v}"),
    "LoreForever_Voice_Female_Quests2": (["LoreForever_Voice_Female_Quests2"],
                                         "Female narrator: more quest dialogue, levels 26-50 {v}"),
    "LoreForever_Voice_Female_Quests3": (["LoreForever_Voice_Female_Quests3"],
                                         "Female narrator: more quest dialogue, levels 51-60 {v}"),
    "LoreForever_Voice_Female-complete": (["LoreForever_Voice_Female", "LoreForever_Voice_Female_Alliance",
                                           "LoreForever_Voice_Female_Horde"],
                                          "Female narrator: stories and lands {v}"),
    "LoreForever_Voice_QuestGivers": (["LoreForever_Voice_QuestGivers"], "Quest givers' voices {v}"),
    # The quest givers' voices for levels 31-50 and 51-60 (voicepack.QUEST_GIVER_PARTS), once recorded.
    "LoreForever_Voice_QuestGivers2": (["LoreForever_Voice_QuestGivers2"], "Quest givers' voices, levels 31-50 {v}"),
    "LoreForever_Voice_QuestGivers3": (["LoreForever_Voice_QuestGivers3"], "Quest givers' voices, levels 51-60 {v}"),
    # More places and people (complete stories only, voicepack.MORE_PACKS): one zip each, never in the main zip. Skipped
    # until register_full_stories.py makes the folder.
    "LoreForever_Voice_Default_MorePlaces": (["LoreForever_Voice_Default_MorePlaces"], "Male narrator: more places {v}"),
    "LoreForever_Voice_Default_MorePeople": (["LoreForever_Voice_Default_MorePeople"], "Male narrator: more people {v}"),
    "LoreForever_Voice_Female_MorePlaces": (["LoreForever_Voice_Female_MorePlaces"], "Female narrator: more places {v}"),
    "LoreForever_Voice_Female_MorePeople": (["LoreForever_Voice_Female_MorePeople"], "Female narrator: more people {v}"),
    # Item stories and quest stories (levels 1-19, 20-39, 40+), the same way.
    "LoreForever_Voice_Default_MoreItems": (["LoreForever_Voice_Default_MoreItems"], "Male narrator: item stories {v}"),
    "LoreForever_Voice_Default_MoreQuests1": (["LoreForever_Voice_Default_MoreQuests1"],
                                              "Male narrator: quest stories, levels 1-19 {v}"),
    "LoreForever_Voice_Default_MoreQuests2": (["LoreForever_Voice_Default_MoreQuests2"],
                                              "Male narrator: quest stories, levels 20-39 {v}"),
    "LoreForever_Voice_Default_MoreQuests3": (["LoreForever_Voice_Default_MoreQuests3"],
                                              "Male narrator: quest stories, levels 40+ {v}"),
    "LoreForever_Voice_Female_MoreItems": (["LoreForever_Voice_Female_MoreItems"], "Female narrator: item stories {v}"),
    "LoreForever_Voice_Female_MoreQuests1": (["LoreForever_Voice_Female_MoreQuests1"],
                                             "Female narrator: quest stories, levels 1-19 {v}"),
    "LoreForever_Voice_Female_MoreQuests2": (["LoreForever_Voice_Female_MoreQuests2"],
                                             "Female narrator: quest stories, levels 20-39 {v}"),
    "LoreForever_Voice_Female_MoreQuests3": (["LoreForever_Voice_Female_MoreQuests3"],
                                             "Female narrator: quest stories, levels 40+ {v}"),
    # The original male narrator (voicepack.OWN_PACKS), a voice of his own since the Chronicler took over the main
    # download's stories: his stories and lands in one zip, as the female narrator's, and his more places and people.
    "LoreForever_Voice_Original": (["LoreForever_Voice_Original"], "Original male narrator: core {v}"),
    "LoreForever_Voice_Original_Alliance": (["LoreForever_Voice_Original_Alliance"],
                                            "Original male narrator: Alliance lands {v}"),
    "LoreForever_Voice_Original_Horde": (["LoreForever_Voice_Original_Horde"], "Original male narrator: Horde lands {v}"),
    "LoreForever_Voice_Original-complete": (["LoreForever_Voice_Original", "LoreForever_Voice_Original_Alliance",
                                             "LoreForever_Voice_Original_Horde"],
                                            "Original male narrator: stories and lands {v}"),
    "LoreForever_Voice_Original_MorePlaces": (["LoreForever_Voice_Original_MorePlaces"],
                                              "Original male narrator: more places {v}"),
    "LoreForever_Voice_Original_MorePeople": (["LoreForever_Voice_Original_MorePeople"],
                                              "Original male narrator: more people {v}"),
    "LoreForever_Voice_Original_Quests": (["LoreForever_Voice_Original_Quests"],
                                          "Original male narrator: quest dialogue {v}"),
    # Both narrators in the language packs' languages (LOR-177): one zip per narrator and language, each holding the
    # zone stories, answers, places and people (~340 MB; lore.voicepack locale keeps each under 480 MB). Skipped until
    # recorded (no folder in addon/).
    "LoreForever_Voice_Default_ukUA": (["LoreForever_Voice_Default_ukUA"], "Pekelnyj / UALL: Ukrainian stories and answers {v}"),
    # Voices sent from the upload page go out on their own now, on the public repo's "voices" release
    # (lore.voicepack publish-studio, LOR-621), not with each release.
    "LoreForever_Voice_Default_deDE": (["LoreForever_Voice_Default_deDE"], "Male narrator: Deutsch {v}"),
    "LoreForever_Voice_Female_deDE": (["LoreForever_Voice_Female_deDE"], "Female narrator: Deutsch {v}"),
    "LoreForever_Voice_Default_esES": (["LoreForever_Voice_Default_esES"], "Male narrator: Español {v}"),
    "LoreForever_Voice_Female_esES": (["LoreForever_Voice_Female_esES"], "Female narrator: Español {v}"),
    # Their people and lore topics in German, Castilian, Brazilian Portuguese and French (LOR-567; French 10/19): one narrator's ~1,600 stories in those languages
    # don't fit in one zip, so these extend the narrator like English MorePeople. Skipped until recorded.
    "LoreForever_Voice_Default_MorePeople_deDE": (["LoreForever_Voice_Default_MorePeople_deDE"],
                                                  "Male narrator: more people, Deutsch {v}"),
    "LoreForever_Voice_Female_MorePeople_deDE": (["LoreForever_Voice_Female_MorePeople_deDE"],
                                                 "Female narrator: more people, Deutsch {v}"),
    # German v3 (LOR-1082): every story, split as Chinese's and Italian's are. Skipped until recorded.
    "LoreForever_Voice_Default_MoreItems_deDE": (["LoreForever_Voice_Default_MoreItems_deDE"], "Male narrator: item stories, Deutsch {v}"),
    "LoreForever_Voice_Female_MoreItems_deDE": (["LoreForever_Voice_Female_MoreItems_deDE"], "Female narrator: item stories, Deutsch {v}"),
    "LoreForever_Voice_Default_MoreQuests1_deDE": (["LoreForever_Voice_Default_MoreQuests1_deDE"], "Male narrator: quest stories 1-19, Deutsch {v}"),
    "LoreForever_Voice_Female_MoreQuests1_deDE": (["LoreForever_Voice_Female_MoreQuests1_deDE"], "Female narrator: quest stories 1-19, Deutsch {v}"),
    "LoreForever_Voice_Default_MoreQuests2_deDE": (["LoreForever_Voice_Default_MoreQuests2_deDE"], "Male narrator: quest stories 20-39, Deutsch {v}"),
    "LoreForever_Voice_Female_MoreQuests2_deDE": (["LoreForever_Voice_Female_MoreQuests2_deDE"], "Female narrator: quest stories 20-39, Deutsch {v}"),
    "LoreForever_Voice_Default_MoreQuests3_deDE": (["LoreForever_Voice_Default_MoreQuests3_deDE"], "Male narrator: quest stories 40+, Deutsch {v}"),
    "LoreForever_Voice_Female_MoreQuests3_deDE": (["LoreForever_Voice_Female_MoreQuests3_deDE"], "Female narrator: quest stories 40+, Deutsch {v}"),
    "LoreForever_Voice_Default_MorePeople_esES": (["LoreForever_Voice_Default_MorePeople_esES"],
                                                  "Male narrator: more people, Español {v}"),
    "LoreForever_Voice_Female_MorePeople_esES": (["LoreForever_Voice_Female_MorePeople_esES"],
                                                 "Female narrator: more people, Español {v}"),
    "LoreForever_Voice_Default_MorePeople_ptBR": (["LoreForever_Voice_Default_MorePeople_ptBR"],
                                                  "Male narrator: more people, Português {v}"),
    "LoreForever_Voice_Female_MorePeople_ptBR": (["LoreForever_Voice_Female_MorePeople_ptBR"],
                                                 "Female narrator: more people, Português {v}"),
    "LoreForever_Voice_Default_MorePeople_frFR": (["LoreForever_Voice_Default_MorePeople_frFR"],
                                                  "Male narrator: more people, Français {v}"),
    "LoreForever_Voice_Female_MorePeople_frFR": (["LoreForever_Voice_Female_MorePeople_frFR"],
                                                 "Female narrator: more people, Français {v}"),
    "LoreForever_Voice_Default_frFR": (["LoreForever_Voice_Default_frFR"], "Male narrator: Français {v}"),
    "LoreForever_Voice_Female_frFR": (["LoreForever_Voice_Female_frFR"], "Female narrator: Français {v}"),
    # French v3 (LOR-1082): every story, split as Chinese's and Italian's are. Skipped until recorded.
    "LoreForever_Voice_Default_MoreItems_frFR": (["LoreForever_Voice_Default_MoreItems_frFR"], "Male narrator: item stories, Français {v}"),
    "LoreForever_Voice_Female_MoreItems_frFR": (["LoreForever_Voice_Female_MoreItems_frFR"], "Female narrator: item stories, Français {v}"),
    "LoreForever_Voice_Default_MoreQuests1_frFR": (["LoreForever_Voice_Default_MoreQuests1_frFR"], "Male narrator: quest stories 1-19, Français {v}"),
    "LoreForever_Voice_Female_MoreQuests1_frFR": (["LoreForever_Voice_Female_MoreQuests1_frFR"], "Female narrator: quest stories 1-19, Français {v}"),
    "LoreForever_Voice_Default_MoreQuests2_frFR": (["LoreForever_Voice_Default_MoreQuests2_frFR"], "Male narrator: quest stories 20-39, Français {v}"),
    "LoreForever_Voice_Female_MoreQuests2_frFR": (["LoreForever_Voice_Female_MoreQuests2_frFR"], "Female narrator: quest stories 20-39, Français {v}"),
    "LoreForever_Voice_Default_MoreQuests3_frFR": (["LoreForever_Voice_Default_MoreQuests3_frFR"], "Male narrator: quest stories 40+, Français {v}"),
    "LoreForever_Voice_Female_MoreQuests3_frFR": (["LoreForever_Voice_Female_MoreQuests3_frFR"], "Female narrator: quest stories 40+, Français {v}"),
    # Italian (10/18): the stories the Italian community's pack has, read by native narrators. Skipped until recorded.
    "LoreForever_Voice_Default_itIT": (["LoreForever_Voice_Default_itIT"], "Male narrator: Italiano {v}"),
    "LoreForever_Voice_Female_itIT": (["LoreForever_Voice_Female_itIT"], "Female narrator: Italiano {v}"),
    # Italian's other stories (LOR-1375), split as Chinese's are. Skipped until recorded.
    "LoreForever_Voice_Default_MorePeople_itIT": (["LoreForever_Voice_Default_MorePeople_itIT"], "Male narrator: more people, Italiano {v}"),
    "LoreForever_Voice_Female_MorePeople_itIT": (["LoreForever_Voice_Female_MorePeople_itIT"], "Female narrator: more people, Italiano {v}"),
    "LoreForever_Voice_Default_MoreItems_itIT": (["LoreForever_Voice_Default_MoreItems_itIT"], "Male narrator: item stories, Italiano {v}"),
    "LoreForever_Voice_Female_MoreItems_itIT": (["LoreForever_Voice_Female_MoreItems_itIT"], "Female narrator: item stories, Italiano {v}"),
    "LoreForever_Voice_Default_MoreQuests1_itIT": (["LoreForever_Voice_Default_MoreQuests1_itIT"], "Male narrator: quest stories 1-19, Italiano {v}"),
    "LoreForever_Voice_Female_MoreQuests1_itIT": (["LoreForever_Voice_Female_MoreQuests1_itIT"], "Female narrator: quest stories 1-19, Italiano {v}"),
    "LoreForever_Voice_Default_MoreQuests2_itIT": (["LoreForever_Voice_Default_MoreQuests2_itIT"], "Male narrator: quest stories 20-39, Italiano {v}"),
    "LoreForever_Voice_Female_MoreQuests2_itIT": (["LoreForever_Voice_Female_MoreQuests2_itIT"], "Female narrator: quest stories 20-39, Italiano {v}"),
    "LoreForever_Voice_Default_MoreQuests3_itIT": (["LoreForever_Voice_Default_MoreQuests3_itIT"], "Male narrator: quest stories 40+, Italiano {v}"),
    "LoreForever_Voice_Female_MoreQuests3_itIT": (["LoreForever_Voice_Female_MoreQuests3_itIT"], "Female narrator: quest stories 40+, Italiano {v}"),
    # Chinese (LOR-1318): ~2,100 complete stories a narrator, split like English (lore.voicepack LOCALE_PARTS): zones
    # and places, people, items, and quests by their English part. Skipped until recorded.
    "LoreForever_Voice_Default_zhCN": (["LoreForever_Voice_Default_zhCN"], "Male narrator: 简体中文 {v}"),
    "LoreForever_Voice_Female_zhCN": (["LoreForever_Voice_Female_zhCN"], "Female narrator: 简体中文 {v}"),
    "LoreForever_Voice_Default_MorePeople_zhCN": (["LoreForever_Voice_Default_MorePeople_zhCN"], "Male narrator: more people, 简体中文 {v}"),
    "LoreForever_Voice_Female_MorePeople_zhCN": (["LoreForever_Voice_Female_MorePeople_zhCN"], "Female narrator: more people, 简体中文 {v}"),
    "LoreForever_Voice_Default_MoreItems_zhCN": (["LoreForever_Voice_Default_MoreItems_zhCN"], "Male narrator: item stories, 简体中文 {v}"),
    "LoreForever_Voice_Female_MoreItems_zhCN": (["LoreForever_Voice_Female_MoreItems_zhCN"], "Female narrator: item stories, 简体中文 {v}"),
    "LoreForever_Voice_Default_MoreQuests1_zhCN": (["LoreForever_Voice_Default_MoreQuests1_zhCN"], "Male narrator: quest stories 1-19, 简体中文 {v}"),
    "LoreForever_Voice_Female_MoreQuests1_zhCN": (["LoreForever_Voice_Female_MoreQuests1_zhCN"], "Female narrator: quest stories 1-19, 简体中文 {v}"),
    "LoreForever_Voice_Default_MoreQuests2_zhCN": (["LoreForever_Voice_Default_MoreQuests2_zhCN"], "Male narrator: quest stories 20-39, 简体中文 {v}"),
    "LoreForever_Voice_Female_MoreQuests2_zhCN": (["LoreForever_Voice_Female_MoreQuests2_zhCN"], "Female narrator: quest stories 20-39, 简体中文 {v}"),
    "LoreForever_Voice_Default_MoreQuests3_zhCN": (["LoreForever_Voice_Default_MoreQuests3_zhCN"], "Male narrator: quest stories 40+, 简体中文 {v}"),
    "LoreForever_Voice_Female_MoreQuests3_zhCN": (["LoreForever_Voice_Female_MoreQuests3_zhCN"], "Female narrator: quest stories 40+, 简体中文 {v}"),
    # Brazilian Portuguese (LOR-567): both recast in native voices; the male narrator is back 10/19, the female one 10/21.
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
# The answers packs (LOR-227, LoreForever_Voice_<Default|Female>_Answers_<Part>[_<locale>]) are retired (LOR-547,
# LOR-561; Mike 2026-10-15): Willo reads the short answers aloud, so they're no longer built or published. Copies
# players already have keep playing while their text matches.
LANGUAGES = {"": "", "_deDE": ", Deutsch", "_esES": ", Español", "_frFR": ", Français", "_ptBR": ", Português",
             "_itIT": ", Italiano", "_zhCN": ", 简体中文"}
# New manual bundles use only available story components. Quest dialogue stays a separate opt-in pack.
FULL_BUNDLES = {}
# English has no bundle here: the male narrator's core and lands stay in the main download, and the female narrator's is
# LoreForever_Voice_Female-complete above (the installer, CurseForge and the site's links name it). A second name for
# the same three folders was a second 665 MB asset, built, uploaded and stored twice (0.29.0).
for loc, lang in ((k[1:], v[2:]) for k, v in LANGUAGES.items() if k):
    for voice, who in (("Default", "Male"), ("Female", "Female")):
        base = f"LoreForever_Voice_{voice}"
        FULL_BUNDLES[f"{base}_{loc}-complete"] = ([f"{base}_{loc}"], f"{who} narrator: {lang}, stories {{v}}")
DOWNLOADS.update(FULL_BUNDLES)
# Narration taken back until it's recorded again (build-release.sh PAUSED_PACKS, LOR-567): no zip has it, neither its own
# nor a bundle, and a bundle named for it (its narrator's -complete in that language) isn't built at all.
_paused = re.search(r"^PAUSED_PACKS = \[(.*?)\]", (root / "scripts" / "build-release.sh").read_text(encoding="utf-8"),
                    re.M | re.S)
PAUSED = set(re.findall(r'"([^"]+)"', _paused.group(1))) if _paused else set()
DOWNLOADS = {name: entry for name, entry in DOWNLOADS.items()
             if name not in PAUSED and name.removesuffix("-complete") not in PAUSED and not PAUSED & set(entry[0])}
FULL_BUNDLES = {name: entry for name, entry in FULL_BUNDLES.items() if name in DOWNLOADS}
# zips a CurseForge project of their own takes as they are (the quest givers' voices, and each narrator and its quest
# dialogue in each language pack's language: release/curseforge.json), and the answers packs, sized for one
CURSEFORGE_OWN = {"LoreForever_Voice_QuestGivers", "LoreForever_Voice_QuestGivers2", "LoreForever_Voice_QuestGivers3",
                  "LoreForever_Voice_Default_Quests", "LoreForever_Voice_Female_Quests",
                  "LoreForever_Voice_Original-complete", "LoreForever_Voice_Original_Quests"} | {
    n for n in DOWNLOADS if re.fullmatch(
    r"LoreForever_Voice_(Default|Female|Original)((_Quests|_MorePeople|_MoreItems|_MoreQuests[123])?_[a-z]{2}[A-Z]{2}"
    r"|_More(Places|People|Items|Quests[12]))", n)}
CURSEFORGE_MB = 480                                  # its upload API refuses bigger files
GITHUB_ASSET_MAX = 2 * 1024**3 - 64 * 1024**2        # GitHub's release asset limit (2 GiB), less room for zip overhead

def version(folder):
    toc = (addons / folder / f"{folder}.toc").read_text(encoding="utf-8")
    m = re.search(r"^##\s*Version:\s*(\S+)", toc, re.M)
    if not m:
        sys.exit(f"build-voice-packs: no ## Version in {folder}.toc")
    return m.group(1)

core = version("LoreForever") if (addons / "LoreForever" / "LoreForever.toc").is_file() else None
# The cache holds one version: its zips are named <core version>-<key>.zip, and a whole build first drops every other
# version's (they hold that version's .toc: none can match). So it never holds more than one version's zips, ~23 GB
# at 1.9.0, where a new version's first build used to keep the last one's too until its end (LOR-1007).
if CACHE and not ONLY and core:
    for old in CACHE.glob("*.zip"):
        if not old.name.startswith(f"{core}-"):
            old.unlink(missing_ok=True)

@functools.cache   # each language goes in several zips; its checks (a secret scan over ~35 MB) hold for all
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

if not SIZES:
    out.mkdir(parents=True, exist_ok=True)
rows = []

# Pause and resume (LOR-346, transport_assets.pause_split): a pack's recordings with cut points (complete stories,
# answers, quest dialogue, overviews) ship as their pieces, from a split copy of the pack (made once, whichever zips it
# goes in).
# goes in). The splits are pure Python (about two minutes for every pack, one after another), so every pack's starts
# at once, one worker process each (LOR-475), and each is taken, with its notes and errors, where it was made before:
# the same copies, the same output in the same order.
SOURCES, STAGE, SPLITS = {}, None, None
def source(folder):
    global STAGE, SPLITS
    if SPLITS is None:
        (root / "dist").mkdir(exist_ok=True)
        STAGE = Path(tempfile.mkdtemp(prefix=".pause-split-", dir=root / "dist"))   # hard links: the recordings' disk
        atexit.register(shutil.rmtree, STAGE, True)
        # Only the packs a zip that gets built holds: with --pack, the rest are never read (a zip is built only when all
        # its folders are in ONLY), so they must not each start a worker either (10/25: 6 runs x 16 workers).
        packs = [f for f in dict.fromkeys(f for fs, _ in DOWNLOADS.values() for f in fs)
                 if (addons / f / f"{f}.toc").is_file() and (not ONLY or f in ONLY)]
        # A split peaks near 365 MB (measured 10/25 on MoreQuests2, the biggest of the quest packs; 280 on Quests_deDE)
        slot = build_jobs.reserve("build-voice-packs", SPLIT_WORKER_MB, tasks=len(packs))
        atexit.register(slot.release)
        # fork: workers that start from this process, scripts/ on their path (it comes from stdin: nothing to import)
        pool = ProcessPoolExecutor(slot.workers, mp_context=multiprocessing.get_context("fork"))
        SPLITS = {f: pool.submit(pause_split_report, addons / f, STAGE) for f in packs}
    if folder not in SOURCES:
        src, notes, error = (SPLITS[folder].result() if folder in SPLITS
                             else pause_split_report(addons / folder, STAGE))
        if error:
            sys.exit(f"build-voice-packs: {error}")
        print("\n".join(notes), end="\n" if notes else "")
        SOURCES[folder] = src
    return SOURCES[folder]
CHECKED = set()   # a pack's checks hold for every zip it goes in
# The installer's downloads first (installer_downloads.offered_archives: what Setup.exe offers and the Release
# workflow's three install checks fetch), their recordings split first too. Once each of them is built or skipped,
# the file LORE_INSTALLER_PACKS_READY names gets the ones built, one a line, and the workflow hands them to the
# Windows job while the rest build. manifest.tsv keeps the table's order.
TABLE = {name: i for i, name in enumerate(DOWNLOADS)}
try:
    from installer_downloads import offered_archives
    FIRST = [n for names in offered_archives().values() for n in (a.removesuffix(".zip") for a in names) if n in TABLE]
except ImportError:   # a scratch copy without it: the table's order, and no marker (nothing would say what's first)
    FIRST = None
if FIRST is not None:
    DOWNLOADS = {**{n: DOWNLOADS[n] for n in FIRST}, **DOWNLOADS}
READY = os.environ.get("LORE_INSTALLER_PACKS_READY") if FIRST is not None and not SIZES else None
RANK = {}   # zip file name -> its place in the table
def installer_packs_ready():
    global READY
    if READY:
        part = Path(READY + ".part")
        part.write_text("".join(r[0] + "\n" for r in rows), encoding="utf-8")
        os.replace(part, READY)   # whole or not there: the workflow polls for it
        READY = None
def check_packs(folders):
    """Each pack's checks, once whichever zips it goes in (a zip from the cache too)."""
    for f in folders:
        if f in CHECKED:
            continue
        CHECKED.add(f)
        try:
            validate_transport(addons / f)
        except TransportError as e:
            sys.exit(f"build-voice-packs: {e}")
        # (A pack of complete stories only, MorePlaces/MorePeople, has its recordings under Audio/Transport/.)
        if not (addons / f / "Clips.lua").is_file() or not any(p.is_file() for p in (addons / f / "Audio").rglob("*.*")):
            sys.exit(f"build-voice-packs: {f} has no Clips.lua or no recordings")
        # Audio lived in Git LFS until 10/18: a checkout of an older commit has pointer files instead of recordings.
        pointers = [p for p in (addons / f / "Audio").rglob("*") if p.is_file() and p.stat().st_size <= 1024
                    and p.read_bytes().startswith(b"version https://git-lfs")]
        if pointers:
            sys.exit(f"build-voice-packs: {len(pointers)} files in {f}/Audio are Git LFS pointers, not recordings "
                     f"(e.g. {pointers[0].name}). Fetch them first: python3 scripts/audio_store.py hydrate")
# Zips being written, in the table's order: each is taken (its line, its row, the cache) in that order once it's done,
# so the log and manifest read as before. READY_MARK stands where the installer's downloads end.
PENDING, HITS, BUILT, READY_MARK = [], [], 0, object()
def drain(block):
    global BUILT
    while PENDING:
        head = PENDING[0]
        if head is READY_MARK:
            PENDING.pop(0)
            installer_packs_ready()
            continue
        name, path, display, v, job, key, hit = head
        if job is not None and not block and not job.done():
            return
        PENDING.pop(0)
        if job is not None:
            job.result()   # a writer's error stops the build here, with its traceback
        rows.append((path.name, display.format(v=v), v))
        RANK[path.name] = TABLE[name]
        if hit:
            HITS.append(name)
            print(f"built {shown(path)} ({path.stat().st_size / 1024**2:.1f} MB, from the zip cache)")
        else:
            BUILT += 1
            if key:
                to_cache(key, path)
            print(f"built {shown(path)} ({path.stat().st_size / 1024**2:.1f} MB)")
        if name in CURSEFORGE_OWN and path.stat().st_size > CURSEFORGE_MB * 1024**2:
            print(f"warning: {path.name} is over CurseForge's {CURSEFORGE_MB} MB upload limit; rebuild the pack at a lower "
                  "bitrate (lore.voicepack quests --bitrate, or locale --bitrate for a narrator in another language), or "
                  "split an answers part (lore.answers PARTS)")
sys.path.insert(0, str(root / "scripts"))
from contributor_bundle import EDITIONS, names as edition_pair   # every contributor edition, one zip each
EDITION_PAIRS = {e: edition_pair(e) for e in EDITIONS}
marked = False
for name, (folders, display) in DOWNLOADS.items():
    if name not in (FIRST or ()) and not marked:
        PENDING.append(READY_MARK)
        marked = True
    if ONLY and not set(folders) <= ONLY:
        continue
    if name in FULL_BUNDLES:
        folders = [f for f in folders if (addons / f / f"{f}.toc").is_file()]
        if not folders:
            print(f"skip {name}: no recorded components in addon/")
            continue
        # A bundle of one pack that's a download of its own (a narrator's language before its answers are recorded) is
        # that zip's bytes under a second name: 0.17.0 uploaded 1.6 GB twice that way. The site offers a language's
        # bundle only when the release has it, and otherwise the pack itself, which is the same files.
        if len(folders) == 1 and DOWNLOADS.get(folders[0], ([],))[0] == folders:
            print(f"skip {name}: the same zip as {folders[0]}.zip, its only recorded part")
            continue
        # GitHub refuses a release asset of 2 GiB or more (0.15.0's English female bundle: HTTP 422). A bundle is a
        # convenience: its packs are downloads of their own and the site only links a bundle the release has.
        size = sum(p.stat().st_size for f in folders for p in (addons / f).rglob("*") if p.is_file())
        if size > GITHUB_ASSET_MAX:
            print(f"skip {name}: about {size / 1024**2:.0f} MB, over GitHub's 2 GB release file limit; its packs "
                  "download separately", file=sys.stderr if SIZES else sys.stdout)
            if SIZES:
                print(f"skipped\t{name}.zip\tabout {size / 1024**2:.0f} MB, over GitHub's 2 GB limit; its packs download "
                      "separately")
            continue
    if not all((addons / f / f"{f}.toc").is_file() for f in folders):
        print(f"skip {name}: {', '.join(f for f in folders if not (addons / f).is_dir()) or 'no .toc'} not in addon/")
        continue
    v = version(folders[0])
    for f in folders:
        if core and version(f) != core:
            sys.exit(f"build-voice-packs: {f}.toc has ## Version {version(f)}; released packs follow the core ({core})")
    path = out / (f"{name}-{v}.zip" if VERSIONED else f"{name}.zip")
    locale = re.search(r"_([a-z]{2}[A-Z]{2})(?:-complete)?$", name)
    lang = language_files(locale.group(1)) if locale and locale.group(1) != "enUS" else None
    if SIZES:
        check_packs(folders)
        for f in folders:
            print(f"size\t{name}.zip\t{f}\t{zip_bytes(f, addons / f, sorted((addons / f).rglob('*')))}")
        if lang:
            f, listed = lang
            print(f"size\t{name}.zip\t{f}\t{zip_bytes(f, addons / f, [addons / f / p for p in listed])}")
        continue
    key = zip_key(name, folders, lang) if CACHE else None
    if key and from_cache(key, path):
        check_packs(folders)   # the checks as of this build, on a zip written by an earlier one
        PENDING.append((name, path, display, v, None, None, True))
        drain(False)
        continue
    check_packs(folders)
    # Before the zip: a split can fail.
    files = zip_files(folders, source, (lang[0], lang[1], addons / lang[0]) if lang else None)
    job = ZIP_POOL.submit(write_zip, path, files) if ZIP_POOL else None
    if job is None:
        write_zip(path, files)
    PENDING.append((name, path, display, v, job, key, False))
    drain(False)
drain(True)
if CACHE and HITS:
    print(f"zip cache: {len(HITS)} of {len(HITS) + BUILT} zips had the same inputs as before and were linked from it")
installer_packs_ready()   # every zip was one of the installer's (or there were none)
if CACHE:
    # A whole build keeps only the zips it used or wrote (a hit is touched): the next candidate of this version can
    # reuse those, and no other zip can match it (each holds its version's .toc). Two days of them was 60 GB on 11/12
    # and filled the disk the rehearsal writes to (LOR-1007). A --pack build keeps the rest; stray .tmp go after a day.
    # Two versions stay, this one and the newest other (docs/qa/release-branches.md: a release branch's candidates and
    # main's next version's take turns, and neither may empty the other's): a whole build drops the zips of any older one.
    newest = {}
    for z in CACHE.glob("*.zip"):
        v = z.name.rsplit("-", 1)[0]
        if v != core:
            try:
                newest[v] = max(newest.get(v, 0), z.stat().st_mtime)
            except OSError:
                pass
    other = max(newest, key=newest.get) if newest else None
    for old in [*CACHE.glob("*.zip"), *CACHE.glob(".*.tmp")]:
        try:
            age = old.stat().st_mtime
            v = old.name.rsplit("-", 1)[0]
            if (old.suffix == ".zip" and not ONLY and ((v == core and age < BUILD_START - 60) or v not in (core, other))) \
                    or (old.suffix == ".tmp" and age < time.time() - 86400):
                old.unlink(missing_ok=True)
        except OSError:   # another build took it first
            pass
    def size(z):   # another build may prune it between the listing and the stat
        try:
            return z.stat().st_size
        except OSError:
            return None
    kept = [n for n in map(size, CACHE.glob("*.zip")) if n is not None]
    print(f"zip cache: holds {len(kept)} zips, {sum(kept) / 1024**3:.1f} GB ({CACHE})")
rows.sort(key=lambda r: RANK[r[0]])
if ONLY and not any(set(fs) <= ONLY for fs, _ in DOWNLOADS.values()) and not any(set(p) <= ONLY for p in EDITION_PAIRS.values()):
    sys.exit(f"build-voice-packs: no download is made only of {', '.join(sorted(ONLY))} (each --pack is an addon/ folder)")
# A contributor edition must remain a single paired artifact. Its validator also
# rejects a lone component, mismatched pairing identity and unhydrated audio.
if SIZES:
    for edition, edition_names in EDITION_PAIRS.items():   # contributor_bundle.py zips both folders as they are
        for f in edition_names:
            if (addons / f).is_dir() and (not ONLY or set(edition_names) <= ONLY):
                print(f"size\t{EDITIONS[edition]['folder']}.zip\t{f}\t{zip_bytes(f, addons / f, sorted((addons / f).rglob('*')))}")
    sys.exit(0)
for edition, edition_names in EDITION_PAIRS.items():
    if any((addons / name).exists() for name in edition_names) and (not ONLY or set(edition_names) <= ONLY):
        command = [sys.executable, str(root / "scripts" / "contributor_bundle.py"),
                   "--addons", str(addons), "--out", str(out), "--edition", edition]
        if VERSIONED:
            command.append("--versioned")
        path = Path(subprocess.check_output(command, cwd=root, text=True).strip())
        e = EDITIONS[edition]
        rows.append((path.name, f"{e['credit']}: {e['language_en']} text and narration {core}", core))
        print(f"built {shown(path)} ({path.stat().st_size / 1024**2:.1f} MB)")
(out / "manifest.tsv").write_text("".join("\t".join(r) + "\n" for r in rows), encoding="utf-8")
PY
