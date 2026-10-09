#!/usr/bin/env python3
"""What goes to CurseForge besides the add-on: the narration projects in release/curseforge.json, and the add-on's own
file without them. The public repo's release workflow runs it (its curseforge and curseforge-voices jobs).

Translation projects use `upload --from-release --languages`: their versioned ZIPs come from the separate
languages release after publish-language-packs.sh finishes uploading them. The CurseForge languages workflow
checks them against the requested core release and keeps its upload record in languages.json, separately from
narration's voices.json. Default uploads select narration only.

CurseForge's WoW site takes one file per project (additional files are refused, errorCode 1011), and its upload API
refuses files over about 500 MB (Cloudflare answers 413; 0.7.0's 701 MB zip got one). So each narrator is two
projects, its stories and its quest dialogue, and each project's file is some add-on folders of a release zip, byte
for byte. A project needs Lore Forever, and the CurseForge app installs that along with it. A project without an id
yet is skipped, so nothing uploads until it exists.

A project uploads only when the narration in it changed since its last upload: CurseForge refuses an unchanged
re-upload, and players shouldn't download the same recordings with every release. Its files are fingerprinted with
the .toc files' "## Version:" lines left out (every release stamps the core's version into them), and each project's
last upload is recorded in voices.json on the public repo's "curseforge" release. Version numbers still follow the
core ("Lore Forever female narrator 0.7.0" is the narration that came with Lore Forever 0.7.0), and an older upload
keeps working with a newer add-on: a recording whose text has changed since just doesn't play. Projects only upload
with the newest release, never from a rebuild of an older tag.

Once a project is live (approved by CurseForge), the add-on's own file leaves its folders out and lists it as a
required or optional dependency. The app installs required dependencies with the add-on. Quest dialogue is always
optional and excluded from the add-on's file, even before its project is live. Other bundled narration stays until
its project is live, unless that would put the file over the limit.

  curseforge_voices.py core ZIP OUTDIR        the add-on's file: OUTDIR/<ZIP's name> without the folders that go to
                                              CurseForge on their own, OUTDIR/relations.json for its upload's
                                              "relations", OUTDIR/notes.md for its changelog (maybe empty). With
                                              core_upload "manual" in release/curseforge.json, only OUTDIR/manual
                                              (ZIP's size in MB): one package goes up by hand (see package)
  curseforge_voices.py package DIR OUT        that package, from the release's zips in DIR: the main zip and the
                                              female narrator's narration bundle, merged, excluding quest dialogue; without her
                                              only if that's over the website's 2 GB
  curseforge_voices.py upload --from-release  the projects' files from the zips of release $TAG (default: the newest);
                                              uploads the ones that changed and records them. Needs CF_API_TOKEN, and
                                              GH_TOKEN and GH_REPO for gh. $VERSION defaults to the tag's.
  curseforge_voices.py upload --dir DIR       the same from the zips in DIR (a local build)
  ... --dry-run [--state FILE]                only prints what would upload, with each upload's metadata

Standard library only, plus curl, gh and (if there) zip: the public repo's workflows run it.
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "release" / "curseforge.json"
CORE_TOC = ROOT / "addon" / "LoreForever" / "LoreForever.toc"
API = "https://wow.curseforge.com/api"
CORE_ID, CORE_SLUG = 1715510, "lore-forever"
MAIN_ZIP = "LoreForever.zip"   # the release's main download, the add-on's own file's source
CAP = 480 * 1024 * 1024      # under CurseForge's upload limit (about 500 MB; 0.6.0's 388 MB went through)
WEB_CAP = 2 * 1000 ** 3      # what the website takes by hand (2 GB), for core_upload "manual"
PACKAGE_WITH = ["LoreForever_Voice_Female-complete.zip"]   # merged into the main zip for that one package
FOREVER = 88568              # CurseForge's "Forever" game version type
SITE = "https://loreforeverwow.com"
STATE_TAG, STATE_FILE = "curseforge", "voices.json"
STATE_NOTES = ("Bookkeeping for the release workflow, not a download. voices.json and languages.json record the last "
               "uploads of narration and translation projects on CurseForge, so unchanged packs aren't uploaded again "
               "(scripts/curseforge_voices.py).")
VERSION_LINE = re.compile(rb"^## Version:[^\n]*(\n|$)", re.M)
RELEASE_TAG = re.compile(r"^v(\d+)\.(\d+)\.(\d+)$")
MB = 1024 * 1024


class Failure(Exception):
    pass


def sources(project: dict, version: str | None = None) -> list[str]:
    """The release zips a project's folders come from ('from': one name, or a list)."""
    names = [project["from"]] if isinstance(project["from"], str) else list(project["from"])
    return [s.format(v=version) for s in names] if version else names


def language_project(project: dict) -> bool:
    return all(f.startswith("LoreForever_Lang_") for f in project["folders"])


def validate_translation(zip_path: Path, project: dict, version: str) -> None:
    """A translation must target this core build before it can reach CurseForge."""
    index = CORE_TOC.parent / "Data" / "Index.lua"
    match = re.search(r'ns\.DB\s*=\s*\{\s*version\s*=\s*"([^"]+)"', index.read_text(encoding="utf-8"))
    if not match:
        raise Failure("core has no data version")
    with zipfile.ZipFile(zip_path) as z:
        for folder in project["folders"]:
            text = z.read(f"{folder}/{folder}.toc").decode("utf-8")
            fields = dict(re.findall(r"^## ([\w-]+):[ \t]*(.*?)\r?$", text, re.M))
            if fields.get("Version") != version or fields.get("X-LoreForever-DataVersion") != match.group(1):
                raise Failure(f"{folder}: translations don't match Lore Forever {version}'s data; rebuild the pack")


def quest_dialogue(folder: str) -> bool:
    """Quest dialogue folders that players install deliberately, including language and quest giver packs."""
    return folder == "LoreForever_Voice_QuestGivers" or bool(re.fullmatch(
        r"LoreForever_Voice_(Default|Female)_Quests(?:_[a-z]{2}[A-Z]{2})?", folder))


def load_config(path: Path | None = None) -> list[dict]:
    """The projects in release/curseforge.json, checked."""
    path = path or CONFIG
    projects = json.loads(path.read_text(encoding="utf-8")).get("projects")
    if not isinstance(projects, list):
        raise Failure(f"{path.name}: no 'projects' list")
    keys = [p.get("key") for p in projects]
    for p in projects:
        name = p.get("key") or p
        for k in ("key", "name", "about", "file"):
            if not isinstance(p.get(k), str) or not p[k].strip():
                raise Failure(f"{path.name}: {name} needs '{k}'")
        if "{v}" not in p["file"]:
            raise Failure(f"{path.name}: {name}'s 'file' needs {{v}} for the version")
        src = p.get("from")
        if not ((isinstance(src, str) and src.endswith(".zip")) or (isinstance(src, list) and src and all(
                isinstance(s, str) and s.endswith(".zip") for s in src) and len(set(src)) == len(src))):
            raise Failure(f"{path.name}: {name}'s 'from' is a release zip, like LoreForever.zip, or a list of them")
        p.setdefault("suggests", [])
        if not (isinstance(p["suggests"], list) and all(s in keys and s != p["key"] for s in p["suggests"])):
            raise Failure(f"{path.name}: {name}'s 'suggests' names other projects' keys")
        folders = p.get("folders")
        if not (isinstance(folders, list) and folders and all(isinstance(f, str) and re.fullmatch(
                r"LoreForever_(?:Voice_\w+|Lang_[a-z]{2}[A-Z]{2})", f) for f in folders)):
            raise Failure(f"{path.name}: {name}'s 'folders' are add-on folders, like LoreForever_Voice_Female")
        if p.get("core") not in ("required", "optional"):
            raise Failure(f"{path.name}: {name}'s 'core' is required or optional")
        if any(f.startswith("LoreForever_Lang_") for f in folders):
            if not language_project(p) or p["core"] != "optional":
                raise Failure(f"{path.name}: {name}: translations must be a separate optional project")
        if any(quest_dialogue(f) for f in folders) and p["core"] != "optional":
            raise Failure(f"{path.name}: {name}: quest dialogue must be optional for the core")
        if not (isinstance(p.get("requires"), list) and all(r in keys and r != p["key"] for r in p["requires"])):
            raise Failure(f"{path.name}: {name}'s 'requires' names other projects' keys")
        pid, slug = p.get("id"), p.get("slug")
        if pid is not None and not (type(pid) is int and pid > 0):
            raise Failure(f"{path.name}: {name}'s id must be a project number or null, not {pid!r}")
        if pid == CORE_ID or slug == CORE_SLUG:
            raise Failure(f"{path.name}: {name}: that's the add-on's own project")
        if slug is not None and not (isinstance(slug, str) and re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", slug)):
            raise Failure(f"{path.name}: {name}'s slug must be the project's address, like lore-forever-x")
        if type(p.get("live")) is not bool:
            raise Failure(f"{path.name}: {name}'s 'live' is true or false")
        if p["live"] and not (pid and slug):
            raise Failure(f"{path.name}: {name} is live, so it needs its id and slug")
    for k in ("key", "name", "id", "slug"):
        seen = [p[k] for p in projects if p.get(k) is not None]
        if len(seen) != len(set(seen)):
            raise Failure(f"{path.name}: two projects have the same {k}")
    folders = [f for p in projects for f in p["folders"]]
    if len(folders) != len(set(folders)):
        raise Failure(f"{path.name}: a folder can only belong to one project")
    return projects


# --- zips ----------------------------------------------------------------------------------------------------------

def tops(zip_path: Path) -> list[str]:
    """The zip's top-level folders, in zip order."""
    with zipfile.ZipFile(zip_path) as z:
        return list(dict.fromkeys(n.split("/")[0] for n in z.namelist() if "/" in n))


def subset(src: Path, out: Path, keep: list[str] | None = None, drop: list[str] | None = None) -> Path:
    """`out`: `src` with only the top-level folders in `keep`, or without those in `drop`; the files that stay are
    byte for byte the same (zip -d), or the same contents where zip isn't installed."""
    have = tops(src)
    if keep is not None:
        missing = [f for f in keep if f not in have]
        if missing:
            raise Failure(f"{src.name} has no {', '.join(missing)}")
        drop = [f for f in have if f not in keep]
    drop = [f for f in (drop or []) if f in have]
    out.parent.mkdir(parents=True, exist_ok=True)
    out.unlink(missing_ok=True)
    if shutil.which("zip"):
        shutil.copyfile(src, out)
        if drop:
            run(["zip", "-q", "-d", str(out), *[f"{f}/*" for f in drop]])
        return out
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(out, "w") as zout:
        for info in zin.infolist():
            if info.filename.split("/")[0] not in drop:
                zout.writestr(info, zin.read(info))
    return out


def fingerprint(zip_path: Path) -> str:
    """The zip's files, names and contents, as one sha256; .toc files without their ## Version line."""
    h = hashlib.sha256()
    with zipfile.ZipFile(zip_path) as z:
        for info in sorted(z.infolist(), key=lambda i: i.filename):
            if info.is_dir():
                continue
            data = z.read(info)
            if info.filename.lower().endswith(".toc"):
                data = VERSION_LINE.sub(b"", data)
            h.update(hashlib.sha256(info.filename.encode()).digest() + hashlib.sha256(data).digest())
    return h.hexdigest()



def source_fingerprints(projects: list[dict], files: dict[str, Path], version: str) -> dict:
    """Fingerprint each project's exact selected files without repacking its immutable source archives."""
    result = {}
    for project in projects:
        wanted = sources(project, version)
        have = [n for n in wanted if n in files]
        entries, found = {}, set()
        for archive in have:
            with zipfile.ZipFile(files[archive]) as z:
                available = {i.filename.split('/')[0] for i in z.infolist() if not i.is_dir()}
                keep = set(project['folders']) & available
                found.update(keep)
                locales = {m.group(1) for f in keep if (m := re.search(r'_([a-z]{2}[A-Z]{2})$', f))}
                keep.update('LoreForever_Lang_' + loc for loc in locales if 'LoreForever_Lang_' + loc in available)
                for info in z.infolist():
                    if info.is_dir() or info.filename.split('/')[0] not in keep:
                        continue
                    data = z.read(info)
                    if info.filename.lower().endswith('.toc'):
                        data = VERSION_LINE.sub(b'', data)
                    digest = hashlib.sha256(data).digest()
                    if info.filename in entries and entries[info.filename] != digest:
                        raise Failure('Conflicting source file: ' + info.filename)
                    entries[info.filename] = digest
        if not entries or (len(have) == len(wanted) and set(project['folders']) - found):
            continue   # the ordinary preparation path reports absent/missing packs
        h = hashlib.sha256()
        for filename, digest in sorted(entries.items()):
            h.update(hashlib.sha256(filename.encode()).digest() + digest)
        result[str(project['id'])] = {'key': project['key'], 'folders': sorted(project['folders']),
                                     'sources': wanted, 'archives': have, 'fingerprint': h.hexdigest()}
    return result


def release_fingerprints(tag: str) -> dict:
    """Read only a small server-digest-verified catalog; old releases keep their existing preparation path."""
    repo = os.environ.get('GH_REPO', 'mliudev/LoreForever')
    release = json.loads(run(['gh', 'api', f'repos/{repo}/releases/tags/{tag}']).stdout)
    remote = {a['name']: a for a in release['assets']}
    asset = remote.get('release-manifest.json')
    if asset is None:
        return {}
    body = run(['gh', 'release', 'download', tag, '-R', repo, '-p', 'release-manifest.json', '-O', '-']).stdout
    if asset.get('digest') != 'sha256:' + hashlib.sha256(body.encode()).hexdigest():
        raise Failure('Release fingerprint manifest digest differs')
    manifest = json.loads(body)
    bound = manifest.get('binding', {})
    if (manifest.get('version'), bound.get('tag'), bound.get('repository')) != (1, tag, repo) or release.get('draft'):
        raise Failure('Release fingerprint catalog binding differs')
    rows = {r['name']: r for r in manifest['assets']}
    for n, r in rows.items():
        actual = remote.get(n, {})
        if (actual.get('state'), actual.get('size'), actual.get('digest')) != ('uploaded', r['bytes'], 'sha256:' + r['sha256']):
            raise Failure('Release fingerprint source asset differs: ' + n)
    return {'projects': manifest['curseforge'], 'assets': rows}


def unchanged_projects(projects: list[dict], catalog: dict, state: dict, version: str) -> list[dict]:
    """Accepted file IDs stay intact, including files still awaiting moderation."""
    unchanged = []
    for p in projects:
        entry = catalog.get('projects', {}).get(str(p['id']), {})
        last = state.get(str(p['id']), {})
        if (entry.get('key'), entry.get('folders'), entry.get('sources')) != (p['key'], sorted(p['folders']), sources(p, version)):
            continue
        if not entry.get('archives') or any(n not in catalog.get('assets', {}) for n in entry['archives']):
            continue
        if (type(last.get('file')) is int and last['file'] > 0 and last.get('fingerprint') == entry.get('fingerprint')):
            unchanged.append({'project': p, 'action': 'unchanged', 'last': last, 'fingerprint': entry['fingerprint']})
    return unchanged

def contents(zip_path: Path) -> list[tuple[str, str, int]]:
    """[(folder, its .toc's title, recordings)] for each add-on folder in the zip, in zip order."""
    titles, counts = {}, {}
    with zipfile.ZipFile(zip_path) as z:
        for name in z.namelist():
            parts = name.split("/")
            folder = parts[0]
            counts.setdefault(folder, 0)
            if len(parts) >= 3 and parts[1] == "Audio" and parts[-1]:
                counts[folder] += 1
            elif parts[1:] == [f"{folder}.toc"]:
                m = re.search(r"^## Title:[ \t]*(.+?)[ \t]*\r?$", z.read(name).decode("utf-8", "replace"), re.M)
                if m:
                    titles[folder] = m.group(1)
    return [(f, titles.get(f, f), n) for f, n in counts.items()]


# --- the add-on's own file -----------------------------------------------------------------------------------------

def core_upload(path: Path | None = None) -> str:
    """How the add-on's own file gets to CurseForge (release/curseforge.json's core_upload): "auto", the release
    workflow uploads it, leaving out what doesn't fit under the API's limit; or "manual", one package, the whole
    release zip, uploaded by hand on the website, which takes up to 2 GB (the API about 500 MB)."""
    path = path or CONFIG
    mode = json.loads(path.read_text(encoding="utf-8")).get("core_upload", "auto")
    if mode not in ("auto", "manual"):
        raise Failure(f"{path.name}: core_upload is auto or manual, not {mode!r}")
    return mode


def core(zip_path: Path, outdir: Path, projects: list[dict]) -> tuple[Path, dict, str]:
    """The add-on's file for CurseForge (from the release's main zip, `zip_path`), its upload's relations and the lines
    for its changelog."""
    mine = [p for p in projects if MAIN_ZIP in sources(p)]
    live = [p for p in mine if p["live"]]
    dialogue = [f for f in tops(zip_path) if quest_dialogue(f)]
    out = subset(zip_path, outdir / zip_path.name, drop=dialogue + [f for p in live for f in p["folders"]])
    notes = []
    if out.stat().st_size > CAP:
        later = [p for p in mine if not p["live"]]
        if later:
            size = out.stat().st_size
            out = subset(zip_path, out, drop=dialogue + [f for p in live + later for f in p["folders"]])
            print(f"::warning::{size // MB} MB is over CurseForge's upload limit: uploading "
                  f"{out.stat().st_size // MB} MB, without {', '.join(f for p in later for f in p['folders'])}")
            notes.append("Too big for CurseForge's file limit, so this download leaves out: "
                         + "; ".join(p["about"] for p in later) + f". Get the full download at {SITE}")
        if out.stat().st_size > CAP:
            raise Failure(f"{out.stat().st_size // MB} MB{' without them' if later else ''} is over CurseForge's "
                          "upload limit. Give another pack a project of its own in release/curseforge.json.")
    relations = {"projects": [{"slug": p["slug"], "type": ("optionalDependency" if any(
        quest_dialogue(f) for f in p["folders"]) else f"{p['core']}Dependency")} for p in projects if p["live"]]}
    return out, relations, "".join(f"\n{n}\n" for n in notes)


# --- the projects' own files ---------------------------------------------------------------------------------------

def changelog(version: str, parts: list[tuple[str, str, int]], before: dict | None) -> str:
    """The upload's notes: what's in it, with the change in each part's count since the last upload."""
    if all(f.startswith("LoreForever_Lang_") for f, _, _ in parts):
        return "\n".join([f"Translations for Lore Forever {version}.", "",
                          *[f"- {title}" for _, title, _ in parts], "",
                          "Needs Lore Forever (the CurseForge app installs it too). In game, type /reload after "
                          "installing, then choose your language in Options."])
    total = sum(n for _, _, n in parts)
    lines = [f"Narration for Lore Forever {version}: {total:,} recordings.", ""]
    for folder, title, n in parts:
        was = (before or {}).get(folder)
        diff = "" if was is None or was == n else f" ({n - was:+,})"
        lines.append(f"- {title}: {n:,}{diff}")
    lines += ["", "Needs Lore Forever (the CurseForge app installs it too). In game, type /reload after installing, "
                  "then choose your voices in Options > Narration voices."]
    return "\n".join(lines)


def relations(project: dict, projects: list[dict]) -> dict:
    """The add-on, the projects it requires and the ones it suggests (CurseForge's optional dependencies: listed, not
    installed with it), each only once it's live (a file can only name an approved project)."""
    by_key = {p["key"]: p for p in projects}
    rel = [{"slug": CORE_SLUG, "type": "requiredDependency"}]
    for kind, keys in (("requiredDependency", project["requires"]), ("optionalDependency", project.get("suggests", []))):
        rel += [{"slug": by_key[k]["slug"], "type": kind} for k in keys if by_key[k]["live"]]
    return {"projects": rel}


def metadata(project: dict, projects: list[dict], version: str, game_version: int, notes: str) -> dict:
    return {
        "displayName": project["file"].format(v=version),
        "gameVersions": [game_version],
        "releaseType": "release",
        "changelog": notes,
        "changelogType": "markdown",
        "relations": relations(project, projects),
    }


def merge(parts: list[Path], out: Path, drop: list[str] | None = None) -> Path:
    """Merge packages without duplicate translation files or any `drop` folders."""
    out.unlink(missing_ok=True)
    seen = {}
    with zipfile.ZipFile(out, "w") as zout:
        for part in parts:
            with zipfile.ZipFile(part) as zin:
                for info in zin.infolist():
                    if info.filename.split("/")[0] in (drop or []):
                        continue
                    data = zin.read(info)
                    digest = hashlib.sha256(data).digest()
                    if info.filename in seen:
                        if seen[info.filename] != digest:
                            raise Failure(f"conflicting shared file {info.filename} in {part.name}")
                        continue
                    seen[info.filename] = digest
                    zout.writestr(info, data)
    return out


def prepare(projects: list[dict], source_dir: Path, work: Path, version: str) -> list[dict]:
    """Each project with an id: its file (its folders, from its release zips), or why there isn't one. A release
    without any of the project's zips is "absent" (a pack is only built once its folder exists), not an error; with
    some of them, the file has the folders those hold."""
    steps = []
    for p in projects:
        if not p.get("id"):
            continue
        source_names = sources(p, version)
        have = [source_dir / s for s in source_names if (source_dir / s).is_file()]
        if not have:
            steps.append({"project": p, "absent": f"there's no {' or '.join(source_names)} (its pack isn't built yet)"})
            continue
        out = work / f"{p['folders'][0]}-{version}.zip"
        try:
            parts = []
            for i, src in enumerate(have):
                available = tops(src)
                keep = [f for f in p["folders"] if f in available]
                if keep:
                    # Translations are shared installation data, not uniquely owned voice folders. New foreign
                    # component zips include their matching language add-on. Older releases did not (their main
                    # zip already carried it), so an absent language folder remains backwards compatible.
                    locales = {m.group(1) for f in keep if (m := re.search(r"_([a-z]{2}[A-Z]{2})$", f))}
                    keep += [f"LoreForever_Lang_{loc}" for loc in sorted(locales)
                             if f"LoreForever_Lang_{loc}" in available and f"LoreForever_Lang_{loc}" not in keep]
                    parts.append(subset(src, work / f"part{i}-{out.name}", keep=keep))
            found = {f for part in parts for f in tops(part)}
            lacking = [f for f in p["folders"] if f not in found]
            if lacking and len(have) == len(sources(p)):
                raise Failure(f"{', '.join(sources(p))} hold no {', '.join(lacking)}")
            if not parts:
                raise Failure(f"{', '.join(s.name for s in have)} hold none of {', '.join(p['folders'])}")
            if len(parts) == 1:
                parts[0].replace(out)
            else:
                merge(parts, out)
                for part in parts:
                    part.unlink()
            if language_project(p):
                validate_translation(out, p, version)
        except Failure as e:
            steps.append({"project": p, "error": str(e)})
            continue
        if out.stat().st_size > CAP:
            steps.append({"project": p, "error": f"{out.stat().st_size // MB} MB is over CurseForge's upload limit; "
                                                 "split its folders into two projects"})
            continue
        steps.append({"project": p, "zip": out})
    return steps


def plan(steps: list[dict], state: dict) -> list[dict]:
    """Marks each prepared file upload, or unchanged (with its last upload) when its narration is what was sent."""
    for s in steps:
        if "zip" not in s:
            s["action"] = "absent" if "absent" in s else "missing"
            continue
        s["fingerprint"], s["last"] = fingerprint(s["zip"]), state.get(str(s["project"]["id"]))
        same = bool(s["last"]) and s["last"].get("fingerprint") == s["fingerprint"]
        s["action"] = "unchanged" if same else "upload"
    return steps


# --- the outside world: curl for CurseForge, gh for releases -------------------------------------------------------

def run(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess:
    r = subprocess.run(cmd, capture_output=True, text=True)
    if check and r.returncode != 0:
        raise Failure(f"{' '.join(cmd[:3])} failed: {(r.stderr or r.stdout).strip()}")
    return r


def toc_field(toc: Path, field: str) -> str:
    m = re.search(rf"^## {field}:[ \t]*(\S+)", toc.read_text(encoding="utf-8"), re.M)
    if not m:
        raise Failure(f"no ## {field} in {toc.name}")
    return m.group(1)


def game_version(headers: Path) -> int:
    """CurseForge's id for the core's game version (## Interface 16001 -> Forever 1.60.1), or the newest Forever one."""
    iface = toc_field(CORE_TOC, "Interface")
    name = f"{int(iface[:-4])}.{int(iface[-4:-2])}.{int(iface[-2:])}"
    out = run(["curl", "-sSf", "--retry", "3", "-H", f"@{headers}", f"{API}/game/wow/versions"]).stdout
    forever = [v for v in json.loads(out) if v.get("gameVersionTypeID") == FOREVER]
    exact = [v for v in forever if v.get("name") == name]
    if exact:
        return exact[0]["id"]
    if not forever:
        raise Failure("CurseForge lists no Forever game versions")
    newest = max(forever, key=lambda v: v["id"])
    print(f"::warning::CurseForge has no Forever version {name}; tagging the newest one, {newest['name']}")
    return newest["id"]


def upload(project: dict, zip_path: Path, meta: dict, headers: Path) -> int:
    with tempfile.TemporaryDirectory() as tmp:
        meta_path, out = Path(tmp, "metadata.json"), Path(tmp, "result.json")
        meta_path.write_text(json.dumps(meta), encoding="utf-8")
        r = run(["curl", "-sS", "--retry", "3", "--retry-delay", "10", "-o", str(out), "-w", "%{http_code}",
                 "-H", f"@{headers}", "-F", f"metadata=<{meta_path}", "-F", f"file=@{zip_path}",
                 f"{API}/projects/{project['id']}/upload-file"], check=False)
        body = out.read_text(encoding="utf-8", errors="replace").strip() if out.exists() else ""
        print(body)
        if r.returncode != 0 or r.stdout.strip() != "200":
            raise Failure(f"HTTP {r.stdout.strip() or '?'} {r.stderr.strip()}".strip())
        try:
            return int(json.loads(body)["id"])
        except (ValueError, KeyError, TypeError):
            raise Failure(f"no file id in CurseForge's answer: {body[:300]}") from None


def newest_release() -> str | None:
    rows = json.loads(run(["gh", "release", "list", "--limit", "100", "--json", "tagName,isDraft"]).stdout)
    tags = [r["tagName"] for r in rows if not r["isDraft"] and RELEASE_TAG.match(r["tagName"])]
    return max(tags, key=lambda t: tuple(int(x) for x in RELEASE_TAG.match(t).groups()), default=None)


def fetch(names: set[str], tag: str, folder: Path) -> None:
    """These assets of release `tag` into `folder`; one the release doesn't have is left out."""
    have = {a["name"] for a in json.loads(run(["gh", "release", "view", tag, "--json", "assets"]).stdout)["assets"]}
    for name in sorted(names & have):
        run(["gh", "release", "download", tag, "-p", name, "-D", str(folder), "--clobber"])


def load_state(state_file: str = STATE_FILE) -> dict:
    r = run(["gh", "release", "view", STATE_TAG, "--json", "assets"], check=False)
    if r.returncode != 0:
        if "not found" in r.stderr.lower():
            return {}   # nothing uploaded yet
        raise Failure(f"couldn't read the {STATE_TAG} release: {r.stderr.strip()}")
    if state_file not in [a["name"] for a in json.loads(r.stdout).get("assets", [])]:
        return {}
    return json.loads(run(["gh", "release", "download", STATE_TAG, "-p", state_file, "-O", "-"]).stdout or "{}")


def save_state(state: dict, state_file: str = STATE_FILE) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp, state_file)
        path.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        if run(["gh", "release", "view", STATE_TAG], check=False).returncode != 0:
            # A prerelease is never the repo's Latest, which the site's download links follow.
            run(["gh", "release", "create", STATE_TAG, "--title", "CurseForge uploads", "--prerelease",
                 "--latest=false", "--notes", STATE_NOTES])
        run(["gh", "release", "upload", STATE_TAG, str(path), "--clobber"])


def summary(line: str) -> None:
    print(line)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
            f.write(line + "\n\n")


# --- commands ------------------------------------------------------------------------------------------------------

def cmd_core(args) -> int:
    outdir = Path(args.outdir)
    if core_upload() == "manual":
        size = Path(args.zip).stat().st_size // MB
        outdir.mkdir(parents=True, exist_ok=True)
        (outdir / "manual").write_text(f"{size}\n", encoding="utf-8")
        print(f"CurseForge gets one package, {Path(args.zip).name} ({size} MB) with the female narrator merged in "
              "(curseforge_voices.py package): upload by hand on the website (release/curseforge.json, "
              "core_upload: manual)")
        return 0
    out, rel, notes = core(Path(args.zip), outdir, load_config())
    (outdir / "relations.json").write_text(json.dumps(rel) + "\n", encoding="utf-8")
    (outdir / "notes.md").write_text(notes, encoding="utf-8")
    print(f"CurseForge's copy: {out} ({out.stat().st_size // MB} MB), "
          f"{len(rel['projects'])} narration project(s) as dependencies")
    return 0


def cmd_package(args) -> int:
    """core_upload "manual": merge the main zip and female narration bundle, excluding quest dialogue.
    Over the website's 2 GB, leave out the female bundle."""
    src, out = Path(args.dir), Path(args.out)
    if not (src / MAIN_ZIP).exists():
        raise Failure(f"{src} has no {MAIN_ZIP}")
    extra = [src / n for n in PACKAGE_WITH if (src / n).exists()]
    out.parent.mkdir(parents=True, exist_ok=True)
    # Older release zips can still contain dialogue; a core package always leaves it out.
    dialogue = [f for part in [src / MAIN_ZIP, *extra] for f in tops(part) if quest_dialogue(f)]
    merge([src / MAIN_ZIP, *extra], out, drop=dialogue)
    if extra and out.stat().st_size > WEB_CAP:
        print(f"::warning::{out.stat().st_size // MB} MB is over the website's 2 GB: the package leaves out "
              f"{', '.join(p.name for p in extra)}")
        extra = []
        merge([src / MAIN_ZIP], out, drop=dialogue)
    if out.stat().st_size > WEB_CAP:
        raise Failure(f"{out.stat().st_size // MB} MB is over the website's 2 GB even without the female narrator")
    with zipfile.ZipFile(out) as z:
        bad = z.testzip()
    if bad:
        raise Failure(f"{out.name}: {bad} doesn't read back")
    print(f"CurseForge package: {out} ({out.stat().st_size // MB} MB): {MAIN_ZIP}"
          + "".join(f" + {p.name}" for p in extra) + f"; folders: {', '.join(tops(out))}")
    return 0


def cmd_upload(args) -> int:
    projects = load_config()
    todo = [p for p in projects if p.get("id") and language_project(p) == args.languages]
    if not todo:
        print("No matching pack project has a CurseForge id yet (release/curseforge.json); nothing to upload.")
        return 0
    token = os.environ.get("CF_API_TOKEN", "")
    if not token and not args.dry_run:
        raise Failure("CF_API_TOKEN is empty, so nothing was uploaded. Set it (gh secret set CF_API_TOKEN) and rerun "
                      "this job.")
    tag = os.environ.get("TAG", "")
    if args.from_release or not args.dry_run:
        newest = newest_release()
        tag = tag or newest or ""
        if not tag:
            raise Failure("no release to upload from")
        if not args.dry_run and newest and tag != newest:
            print(f"{tag} isn't the newest release ({newest}); narration only uploads with the newest one.")
            return 0
    version = os.environ.get("VERSION") or tag.removeprefix("v")
    if not RELEASE_TAG.match(f"v{version}"):
        raise Failure(f"no version to upload as (TAG={tag!r}, VERSION={os.environ.get('VERSION')!r})")
    state_file = "languages.json" if args.languages else STATE_FILE
    state = json.loads(Path(args.state).read_text(encoding="utf-8")) if args.state else load_state(state_file)
    with tempfile.TemporaryDirectory() as tmp:
        source_dir = Path(args.dir) if args.dir else Path(tmp, "release")
        unchanged = []
        if args.from_release:
            if not args.languages:
                unchanged = unchanged_projects(todo, release_fingerprints(tag), state, version)
                skipped = {s['project']['id'] for s in unchanged}
                todo = [p for p in todo if p['id'] not in skipped]
            source_dir.mkdir(parents=True, exist_ok=True)
            if todo:
                fetch({s for p in todo for s in sources(p, version)}, "languages" if args.languages else tag, source_dir)
        steps = unchanged + (plan(prepare(todo, source_dir, Path(tmp, "files"), version), state) if todo else [])
        return send(steps, projects, state, version, token, args.dry_run, source=tag or str(source_dir),
                    state_file=state_file)


def send(steps: list[dict], projects: list[dict], state: dict, version: str, token: str, dry_run: bool,
         source: str, state_file: str = STATE_FILE) -> int:
    failed = 0
    for s in steps:
        p = s["project"]
        if s["action"] == "absent":
            print(f"::warning::{p['key']}: {source}: {s['absent']}, so nothing went to CurseForge project {p['id']}")
        elif s["action"] == "missing":
            print(f"::error::{p['key']}: {source}: {s['error']}, so nothing went to CurseForge project {p['id']}")
            failed += 1
        elif s["action"] == "unchanged":
            summary(f"{p['key']}: unchanged since {s['last'].get('version')} (CurseForge file "
                    f"{s['last'].get('file')}), not uploaded")
    todo = [s for s in steps if s["action"] == "upload"]
    if not todo:
        return 1 if failed else 0
    with tempfile.TemporaryDirectory() as tmp:
        headers = Path(tmp, "headers")
        headers.write_text(f"X-Api-Token: {token}\n", encoding="utf-8")
        os.chmod(headers, 0o600)
        game = 0 if dry_run else game_version(headers)
        for s in todo:
            p, parts = s["project"], contents(s["zip"])
            meta = metadata(p, projects, version, game, changelog(version, parts, (s["last"] or {}).get("counts")))
            if dry_run:
                print(f"{p['key']}: would upload {s['zip'].name} ({s['zip'].stat().st_size // MB} MB) to CurseForge "
                      f"project {p['id']} (fingerprint {s['fingerprint'][:12]})")
                print(json.dumps(meta, indent=2))
                continue
            try:
                file_id = upload(p, s["zip"], meta, headers)
            except Failure as e:
                print(f"::error::{p['key']}: the upload to CurseForge project {p['id']} failed: {e}")
                failed += 1
                continue
            state[str(p["id"])] = {"key": p["key"], "version": version, "file": file_id,
                                   "fingerprint": s["fingerprint"], "counts": {f: n for f, _, n in parts}}
            save_state(state, state_file)   # record each success before attempting the next project
            where = f"https://www.curseforge.com/wow/addons/{p['slug']}" if p.get("slug") else f"project {p['id']}"
            summary(f"{p['key']}: uploaded {meta['displayName']} to {where} as CurseForge file {file_id}; it goes "
                    f"live after moderation")
    return 1 if failed else 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("core")
    c.add_argument("zip")
    c.add_argument("outdir")
    pk = sub.add_parser("package")
    pk.add_argument("dir", help="a folder with the release's zips")
    pk.add_argument("out")
    up = sub.add_parser("upload")
    where = up.add_mutually_exclusive_group(required=True)
    where.add_argument("--from-release", action="store_true", help="the zips of GitHub release $TAG (default: newest)")
    where.add_argument("--dir", help="the zips in this folder")
    up.add_argument("--dry-run", action="store_true")
    up.add_argument("--state", help="read the upload record from this file instead of the curseforge release")
    up.add_argument("--languages", action="store_true",
                    help="only translation projects, from the languages release; narration is the default")
    args = ap.parse_args(argv)
    try:
        return {"core": cmd_core, "package": cmd_package, "upload": cmd_upload}[args.cmd](args)
    except (Failure, OSError, zipfile.BadZipFile) as e:
        print(f"::error::curseforge_voices: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
