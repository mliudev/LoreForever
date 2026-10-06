#!/usr/bin/env bash
# Build the public download: dist/LoreForever-<version>.zip with one top-level folder per add-on inside:
#   LoreForever/                 the core: the files its .toc loads (LoreForever.xml and every file it loads, in
#                                scripts/load_order.py's reading), Bindings.xml and the credits file
#   LoreForever_Voice_Default/   the default narration voice pack: its .toc, the files that .toc loads, CREDITS.txt
#                                and the recordings under Audio/ (WoW plays those by path, so they're never in a .toc)
#   LoreForever_Voice_Default_Alliance/, _Horde/    the default voice's lands packs (every subzone and NPC narration)
#   LoreForever_Lang_deDE/, _esES/, _frFR/, _ptBR/  the language packs (they load only when that language is in use)
# Packs that ship in the main download are listed in PACKS below. Nothing else goes in, so pipeline code,
# eval data and key helpers can never slip into the zip. Every folder gets the same checks: Interface 16001, no
# missing files, notes for files left out, audio paths named in the code exist, and a secret scan. Shipped packs
# must follow the core's version and declare themselves as Lore Forever voice or language packs; voice packs also
# need their recordings and every clip their list names, and language packs must be built from the core's lore data
# (## X-LoreForever-DataVersion is the core's ns.DB.version; if not, rebuild them with compile_lua --lang).
# Usage: scripts/build-release.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec python3 - "$ROOT" "$@" <<'PY'
import hashlib, multiprocessing, re, sys, zipfile
from collections import defaultdict
from pathlib import Path

root = Path(sys.argv[1])
sys.path.insert(0, str(root / "scripts"))
from load_order import LoadError, addon_files   # the .toc and the XML load files it lists, as the client reads them
addons = root / "addon"
dist = root / "dist"
CORE = "LoreForever"
# Packs bundled with the core download, in zip order (voice or language).
PACKS = ["LoreForever_Voice_Default", "LoreForever_Voice_Default_Alliance", "LoreForever_Voice_Default_Horde",
         "LoreForever_Voice_Default_Quests", "LoreForever_Lang_deDE", "LoreForever_Lang_esES", "LoreForever_Lang_frFR", "LoreForever_Lang_ptBR"]
# Not in the zip, but released with every version as their own zips (scripts/build-voice-packs.sh), so
# scripts/release.sh stamps the core's version into them too. One not in addon/ yet is skipped by both: the quest
# givers' voices until their recordings land, and the narrators in the language packs' languages (LOR-177,
# LoreForever_Voice_<Default|Female>_<locale>) and their quest dialogue in those languages (LOR-226,
# LoreForever_Voice_<Default|Female>_Quests_<locale>) until they're recorded, and every other question and answer
# (LOR-227, lore.answers: LoreForever_Voice_<Default|Female>_Answers_<Part>[_<locale>]) until its renders land.
RELEASE_PACKS = ["LoreForever_Voice_Female", "LoreForever_Voice_Female_Alliance", "LoreForever_Voice_Female_Horde",
                 "LoreForever_Voice_Female_Quests", "LoreForever_Voice_QuestGivers",
                 "LoreForever_Voice_Default_deDE", "LoreForever_Voice_Female_deDE",
                 "LoreForever_Voice_Default_esES", "LoreForever_Voice_Female_esES",
                 "LoreForever_Voice_Default_frFR", "LoreForever_Voice_Female_frFR",
                 "LoreForever_Voice_Default_ptBR", "LoreForever_Voice_Female_ptBR",
                 "LoreForever_Voice_Default_Quests_deDE", "LoreForever_Voice_Female_Quests_deDE",
                 "LoreForever_Voice_Default_Quests_esES", "LoreForever_Voice_Female_Quests_esES",
                 "LoreForever_Voice_Default_Quests_frFR", "LoreForever_Voice_Female_Quests_frFR",
                 "LoreForever_Voice_Default_Quests_ptBR", "LoreForever_Voice_Female_Quests_ptBR",
                 "LoreForever_Voice_Default_Answers_Places", "LoreForever_Voice_Default_Answers_Lore",
                 "LoreForever_Voice_Default_Answers_People", "LoreForever_Voice_Default_Answers_Quests1",
                 "LoreForever_Voice_Default_Answers_Quests2", "LoreForever_Voice_Default_Answers_Quests3",
                 "LoreForever_Voice_Female_Answers_Places", "LoreForever_Voice_Female_Answers_Lore",
                 "LoreForever_Voice_Female_Answers_People", "LoreForever_Voice_Female_Answers_Quests1",
                 "LoreForever_Voice_Female_Answers_Quests2", "LoreForever_Voice_Female_Answers_Quests3",
                 "LoreForever_Voice_Default_Answers_Places_deDE", "LoreForever_Voice_Default_Answers_Lore_deDE",
                 "LoreForever_Voice_Default_Answers_People_deDE", "LoreForever_Voice_Default_Answers_Quests1_deDE",
                 "LoreForever_Voice_Default_Answers_Quests2_deDE", "LoreForever_Voice_Default_Answers_Quests3_deDE",
                 "LoreForever_Voice_Female_Answers_Places_deDE", "LoreForever_Voice_Female_Answers_Lore_deDE",
                 "LoreForever_Voice_Female_Answers_People_deDE", "LoreForever_Voice_Female_Answers_Quests1_deDE",
                 "LoreForever_Voice_Female_Answers_Quests2_deDE", "LoreForever_Voice_Female_Answers_Quests3_deDE",
                 "LoreForever_Voice_Default_Answers_Places_esES", "LoreForever_Voice_Default_Answers_Lore_esES",
                 "LoreForever_Voice_Default_Answers_People_esES", "LoreForever_Voice_Default_Answers_Quests1_esES",
                 "LoreForever_Voice_Default_Answers_Quests2_esES", "LoreForever_Voice_Default_Answers_Quests3_esES",
                 "LoreForever_Voice_Female_Answers_Places_esES", "LoreForever_Voice_Female_Answers_Lore_esES",
                 "LoreForever_Voice_Female_Answers_People_esES", "LoreForever_Voice_Female_Answers_Quests1_esES",
                 "LoreForever_Voice_Female_Answers_Quests2_esES", "LoreForever_Voice_Female_Answers_Quests3_esES",
                 "LoreForever_Voice_Default_Answers_Places_frFR", "LoreForever_Voice_Default_Answers_Lore_frFR",
                 "LoreForever_Voice_Default_Answers_People_frFR", "LoreForever_Voice_Default_Answers_Quests1_frFR",
                 "LoreForever_Voice_Default_Answers_Quests2_frFR", "LoreForever_Voice_Default_Answers_Quests3_frFR",
                 "LoreForever_Voice_Female_Answers_Places_frFR", "LoreForever_Voice_Female_Answers_Lore_frFR",
                 "LoreForever_Voice_Female_Answers_People_frFR", "LoreForever_Voice_Female_Answers_Quests1_frFR",
                 "LoreForever_Voice_Female_Answers_Quests2_frFR", "LoreForever_Voice_Female_Answers_Quests3_frFR",
                 "LoreForever_Voice_Default_Answers_Places_ptBR", "LoreForever_Voice_Default_Answers_Lore_ptBR",
                 "LoreForever_Voice_Default_Answers_People_ptBR", "LoreForever_Voice_Default_Answers_Quests1_ptBR",
                 "LoreForever_Voice_Default_Answers_Quests2_ptBR", "LoreForever_Voice_Default_Answers_Quests3_ptBR",
                 "LoreForever_Voice_Female_Answers_Places_ptBR", "LoreForever_Voice_Female_Answers_Lore_ptBR",
                 "LoreForever_Voice_Female_Answers_People_ptBR", "LoreForever_Voice_Female_Answers_Quests1_ptBR",
                 "LoreForever_Voice_Female_Answers_Quests2_ptBR", "LoreForever_Voice_Female_Answers_Quests3_ptBR"]
if sys.argv[2:]:
    sys.exit(f"build-release: unknown arguments: {' '.join(sys.argv[2:])} (the one zip carries every bundled pack; "
             "there's no --complete build any more)")
AUDIO = {".mp3", ".ogg"}
MAX_ZIP = 2 * 1024**3   # CurseForge's per-file limit

def fail(msg):
    sys.exit(f"build-release: {msg}")

def read_toc(folder):
    toc = addons / folder / f"{folder}.toc"
    if not toc.is_file():
        fail(f"missing {toc.relative_to(root)}")
    try:
        meta, lua, xml = addon_files(addons / folder)
    except (LoadError, OSError) as e:
        fail(f"{folder}: {e}")
    if meta.get("Interface") != "16001":
        fail(f"{toc.name}: ## Interface is {meta.get('Interface')!r}, expected 16001 (WoW Forever)")
    # Files the client loads: the XML load files, then the Lua files they name, in load order.
    return meta, xml + lua

# folder -> [(source path, path inside the folder)]
ship = {}

meta, listed = read_toc(CORE)
version = meta.get("Version") or fail(f"no ## Version in {CORE}.toc")
src = addons / CORE
ship[CORE] = [(src / f"{CORE}.toc", f"{CORE}.toc")] + [(src / p, p) for p in listed]
ship[CORE] += [(src / "Bindings.xml", "Bindings.xml"), (root / "release" / "CREDITS.txt", "CREDITS.txt"),
               (src / "THIRD_PARTY.txt", "THIRD_PARTY.txt")]   # licence notices for Data/Vectors_*.lua
# The lore data's version (ns.DB = { version = "..." } in Data/Index.lua); bundled language packs must match it.
m = re.search(r'ns\.DB\s*=\s*\{\s*version\s*=\s*"([^"]+)"', (src / "Data" / "Index.lua").read_text(encoding="utf-8"))
data_version = m.group(1) if m else fail(f"no ns.DB version in addon/{CORE}/Data/Index.lua")

VOICE_PACKS = []   # the bundled packs that carry recordings (X-LoreForever-Pack: voice); language packs have none
for pack in PACKS:
    pmeta, plisted = read_toc(pack)
    if pmeta.get("Version") != version:
        fail(f"{pack}.toc has ## Version {pmeta.get('Version')!r}; bundled packs follow the core ({version})")
    if pmeta.get("Dependencies") != CORE:
        fail(f"{pack}.toc needs '## Dependencies: {CORE}' (has {pmeta.get('Dependencies')!r})")
    kind = pmeta.get("X-LoreForever-Pack")
    if kind not in ("voice", "lang"):
        fail(f"{pack}.toc needs '## X-LoreForever-Pack: voice' or 'lang' (has {kind!r})")
    psrc = addons / pack
    files = [(psrc / f"{pack}.toc", f"{pack}.toc")] + [(psrc / p, p) for p in plisted]
    if kind == "voice":
        VOICE_PACKS.append(pack)
        files += [(psrc / "CREDITS.txt", "CREDITS.txt")]
        audio = [(p, p.relative_to(psrc).as_posix()) for p in sorted((psrc / "Audio").rglob("*")) if p.suffix.lower() in AUDIO]
        if not audio:
            fail(f"{pack} has no recordings in Audio/")
        files += audio
    elif pmeta.get("X-LoreForever-DataVersion") != data_version:
        fail(f"{pack} was built from lore data {pmeta.get('X-LoreForever-DataVersion')!r}, not the core's "
             f"{data_version!r}; rebuild it: cd pipeline && uv run python -m lore.compile_lua --lang "
             f"{pmeta.get('X-LoreForever-Locale', '<locale>')}")
    ship[pack] = files

# Drop duplicates (a .toc could list CREDITS.txt too), then make sure everything exists.
for folder, files in ship.items():
    seen, unique = set(), []
    for path, arc in files:
        if arc.lower() not in seen:
            seen.add(arc.lower()); unique.append((path, arc))
    ship[folder] = unique
    for path, _ in unique:
        if not path.is_file():
            fail(f"missing {path.relative_to(root)}")

# Add-on audio is stored with Git LFS. A checkout that never fetched it has small pointer files ("version
# https://git-lfs...") where the recordings should be, and a zip of those would play nothing.
LFS_POINTER = b"version https://git-lfs"
pointers = [path for files in ship.values() for path, _ in files
            if path.suffix.lower() in AUDIO and path.stat().st_size <= 1024
            and path.read_bytes().startswith(LFS_POINTER)]
if pointers:
    fail(f"{len(pointers)} audio files are Git LFS pointers, not recordings (e.g. {pointers[0].relative_to(root)}). "
         "Fetch them first: git -c lfs.fetchexclude= lfs pull")
text_files = [(path, f"{folder}/{arc}", folder) for folder, files in ship.items()
              for path, arc in files if path.suffix.lower() not in AUDIO]

# Anything in an add-on folder that isn't shipped is probably a mistake worth seeing.
for folder, files in ship.items():
    shipped = {p.resolve() for p, _ in files}
    for p in sorted((addons / folder).rglob("*")):
        if p.is_file() and p.resolve() not in shipped:
            print(f"note: not shipped: {p.relative_to(root)}")

# The checks below read every text file (~140 MB of Lua) with these patterns. Each file is read and scanned once, by a
# pool of forked workers (they inherit the patterns), in place of three passes one after another: 13 s down to ~2 s.
AUDIO_REF = re.compile(r"(?:AddOns[\\/]+([\w\-]+)[\\/]+)?Audio[\\/]+([\w\-. ]+\.(?:mp3|ogg))", re.I)
CLIP = re.compile(r"""\[\s*["'](\w+:[\w\-]+(?:#faq\d+|#detail|#progress|#complete)?)["']\s*\]\s*=""")
# Key shapes are matched exactly and case-sensitively, as whole tokens: the generated search index is a long
# base64-like blob, and a loose "AIza..." pattern finds false hits in it.
KEY = re.compile(r"(?<![\w-])(?:AIza[\w-]{35}|sk-(?:ant|proj)-[\w-]{20,}|sk_[0-9a-f]{40,}|sk-[A-Za-z0-9]{40,})(?![\w-])")
NAME = re.compile(r"op://|GEMINI_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY|ELEVENLABS_API_KEY|xi-api-key"
                  r"|-----BEGIN [A-Z ]*PRIVATE KEY", re.I)
def scan(item):
    """(audio paths named, clip ids listed (bundled voice packs' Lua only), the first secret-looking string or None)"""
    path, _, folder = item
    body = path.read_text(encoding="utf-8", errors="replace")
    clips = CLIP.findall(body) if folder in VOICE_PACKS and path.suffix.lower() == ".lua" else []
    m = KEY.search(body) or NAME.search(body)
    return AUDIO_REF.findall(body), clips, m.group(0) if m else None
with multiprocessing.get_context("fork").Pool() as pool:
    scans = pool.map(scan, text_files, chunksize=1)

# Audio files the code names literally must be in the zip, in the folder that ships them. AddOns\<Folder>\Audio\x.mp3
# must be in that add-on's Audio/; a bare Audio\x.mp3 in its own folder's, or, from a folder with no audio of its own
# (the core, which plays pack files), in some bundled folder's. Names built at runtime aren't checked here (bundled
# packs' clip lists are, below), nor are paths into add-ons outside this zip.
audio_names = {folder: {a.lower() for _, a in files if Path(a).suffix.lower() in AUDIO} for folder, files in ship.items()}
for (path, arc, folder), (refs, _, _) in zip(text_files, scans):
    for owner, ref in refs:
        if owner:
            where = [f for f in ship if f.lower() == owner.lower()]
            if not where:
                continue
        else:
            where = [folder] if audio_names[folder] else list(ship)
        if not any("audio/" + ref.lower() in audio_names[f] for f in where):
            fail(f"{arc} names {owner + '/' if owner else ''}Audio/{ref}, which isn't in "
                 + " or ".join(f"addon/{f}/Audio" for f in where))

# A bundled pack's clip list (P.clips["zone:stormwind#faq3"] = "hash", or via a local alias of P.clips) names files
# by derived path (Audio/zone_stormwind__faq3.mp3): every listed clip needs its recording, and recordings no clip
# names are noted.
# Quest dialogue clips (quest:176#detail, #progress, #complete) live in the voices' quest packs: quest_176__detail.mp3.
def stem(clip_id):
    base, sep, part = clip_id.partition("#")
    return re.sub(r"[^\w\-]", "_", base) + (f"__{part}" if sep else "")
for pack in VOICE_PACKS:
    have = {Path(a).stem.lower(): a for a in audio_names[pack] if a.startswith("audio/")}
    named = set()
    for (path, arc, folder), (_, clips, _) in zip(text_files, scans):
        if folder != pack:
            continue
        for cid in clips:
            s = stem(cid).lower()
            if s not in have:
                fail(f"{arc} lists clip {cid}, but {pack}/Audio has no {stem(cid)}.mp3 or .ogg")
            named.add(s)
    for s in sorted(set(have) - named):
        print(f"note: {pack}/{have[s]} isn't in the pack's clip list, so it never plays")

# Refuse to ship anything that looks like a credential or a pointer to one (KEY and NAME, above).
for (path, arc, _), (_, _, secret) in zip(text_files, scans):
    if secret:
        fail(f"{arc} contains something that looks like a secret: {secret[:12]}...")

dist.mkdir(exist_ok=True)
out = dist / f"LoreForever-{version}.zip"
with zipfile.ZipFile(out, "w") as z:
    for folder, files in ship.items():
        for path, arc in files:
            info = zipfile.ZipInfo(f"{folder}/{arc}", date_time=(2026, 1, 1, 0, 0, 0))  # stable bytes per version
            # Audio is already compressed; deflating it again only costs time. Text gets zlib's default level 6: 9
            # took half again as long (8 s against 5) for 0.2% less.
            info.compress_type = zipfile.ZIP_STORED if path.suffix.lower() in AUDIO else zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, path.read_bytes(), compresslevel=6)

# Sizes per add-on folder and subfolder, e.g. "LoreForever/Data/", "LoreForever_Voice_Default/Audio/".
groups = defaultdict(lambda: [0, 0, 0])
with zipfile.ZipFile(out) as z:
    for i in z.infolist():
        parts = i.filename.split("/")
        g = groups[parts[0] + "/" + (parts[1] + "/" if len(parts) > 2 else "(top level)")]
        g[0] += 1; g[1] += i.file_size; g[2] += i.compress_size
width = max(len(n) for n in groups)
for name, (n, raw, packed) in sorted(groups.items()):
    print(f"  {name:<{width}} {n:>4} files  {raw / 1024**2:7.1f} MB -> {packed / 1024**2:6.1f} MB in zip")
size = out.stat().st_size
if size > MAX_ZIP:
    fail(f"{out.name} is {size / 1024**3:.2f} GB; CurseForge takes at most 2 GB per file")
digest = hashlib.sha256(out.read_bytes()).hexdigest()
print(f"built {out.relative_to(root)} ({size / 1024**2:.1f} MB) sha256 {digest}")
PY
