#!/usr/bin/env python3
"""Freeze source ZIPs, standalone narration manifest entries, and transport shards into verified installer downloads.

No publication or encoding. Run with --narration-manifest FILE (or legacy --packs dist/packs) and --transport DIR,
--output dist/installer --version VERSION. Compile Setup with /DDownloadIss=<output>/installer-downloads.iss.
JSON is also the QA contract.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import zipfile
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

try:
    from installer_inputs import SELECTIONS as SMOKE_SELECTIONS
except ImportError:
    SMOKE_SELECTIONS = ('female', 'quests', 'original')

CORE_PACKS = ['LoreForever_Voice_Default', 'LoreForever_Voice_Default_Alliance', 'LoreForever_Voice_Default_Horde',
              'LoreForever_Voice_QuestGivers_Start']   # (the starting zones' quest givers, LOR-1408)
# Quest dialogue: the first pack, then the rest of the game's quests (levels 26-45, 46-59, 60: voicepack.QUEST_MORE_PACKS), each
# its own zip under CurseForge's limit. (The answers packs are retired: LOR-561.) A zip not built yet is left out.
QUEST_PACKS = ['LoreForever_Voice_Default_Quests', 'LoreForever_Voice_Default_Quests2',
               'LoreForever_Voice_Default_Quests3', 'LoreForever_Voice_Default_Quests4']
FEMALE_QUEST_PACKS = ['LoreForever_Voice_Female_Quests', 'LoreForever_Voice_Female_Quests2',
                      'LoreForever_Voice_Female_Quests3', 'LoreForever_Voice_Female_Quests4']
GIVER_PACKS = ['LoreForever_Voice_QuestGivers', 'LoreForever_Voice_QuestGivers2',
               'LoreForever_Voice_QuestGivers3', 'LoreForever_Voice_QuestGivers4']
# More places and people, item stories and quest stories (complete stories only): a choice of their own per narrator,
# so the rows match the downloads page's cards (LOR-848: The add-on, Storyteller = + these, Everything = + quest
# dialogue and the quest givers). One folder per zip, installed once built.
MORE = ('MorePlaces', 'MorePeople', 'MoreItems', 'MoreQuests0', 'MoreQuests1', 'MoreQuests2', 'MoreQuests3')
MORE_PACKS = {'female-more': ['LoreForever_Voice_Female_' + s for s in MORE],
              'more': ['LoreForever_Voice_Default_' + s for s in MORE],
              'original': ['LoreForever_Voice_Original_MorePlaces', 'LoreForever_Voice_Original_MorePeople']}
# A narrator's stories and lands in one zip (build-voice-packs.sh's <voice>-complete), the first zip of its choice:
# the female narrator, and the original male narrator (his own voice since the Chronicler took over the default packs).
COMPLETE = {'female': ['LoreForever_Voice_Female', 'LoreForever_Voice_Female_Alliance', 'LoreForever_Voice_Female_Horde'],
            'original': ['LoreForever_Voice_Original', 'LoreForever_Voice_Original_Alliance',
                         'LoreForever_Voice_Original_Horde']}
# The optional choices, in the order of the installer's voice table (release/installer/LoreForever.iss InitVoices).
# 'female' and 'quests' keep their ids (the Release workflow's install checks, installer_inputs.SELECTIONS); the
# original male narrator stays for the players who have him, off the voice page (Mike, 10/26).
CHOICES = ('female', 'female-more', 'female-quests', 'more', 'quests', 'givers', 'original')
NAME = re.compile(r'LoreForever(?:_[A-Za-z0-9_-]+)?')
VERSION_SUFFIX = re.compile(r'-\d+\.\d+\.\d+(?:\.\d+)?$')
LIMIT = 480 * 1024 * 1024


def offered_archives():
    """The zips Setup.exe offers, by choice, in the order build() reads them. build-voice-packs.sh builds these first,
    so the Release workflow can hand them to the Windows job while the other narration packs build."""
    zips = lambda names: [name + '.zip' for name in names]
    return {'female': ['LoreForever_Voice_Female-complete.zip'],
            'female-more': zips(MORE_PACKS['female-more']),
            'female-quests': zips(FEMALE_QUEST_PACKS),
            'more': zips(MORE_PACKS['more']),
            'quests': zips(QUEST_PACKS),
            'givers': zips(GIVER_PACKS),
            'original': ['LoreForever_Voice_Original-complete.zip'] + zips(MORE_PACKS['original'])}


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def safe_name(value):
    if not isinstance(value, str) or not NAME.fullmatch(value):
        raise ValueError('Invalid add-on name: ' + repr(value))
    return value


def zip_folders(path, version):
    with zipfile.ZipFile(path) as archive:
        files = archive.namelist()
        for name in files:
            if name.startswith('/') or '\\' in name or '..' in Path(name).parts or len(Path(name).parts) < 2:
                raise ValueError('Unsafe ZIP member: ' + name)
        folders = sorted({safe_name(name.split('/')[0]) for name in files})
        for folder in folders:
            text = archive.read(folder + '/' + folder + '.toc').decode('utf-8-sig')
            if not re.search(r'^## Version: ' + re.escape(version) + r'\s*$', text, re.M):
                raise ValueError('ZIP version mismatch: ' + folder)
        return folders


def load_holds(holds_path=None):
    """Load release/pack-holds.json fail-closed; None means no holds file requested."""
    if holds_path is None:
        return set()
    path = Path(holds_path)
    if not path.exists() or path.is_symlink():
        raise ValueError(f'Missing pack holds file: {path}')
    doc = json.loads(path.read_text(encoding='utf-8-sig'))
    if not isinstance(doc, dict) or not isinstance(doc.get('holds'), dict):
        raise ValueError(f'Invalid pack holds schema in {path}: expected object with dict "holds"')
    for pack, reason in doc['holds'].items():
        if not isinstance(pack, str) or not pack or not isinstance(reason, str):
            raise ValueError(f'Invalid pack holds entry in {path}: expected string pack name and reason')
    return set(doc['holds'].keys())


def matches_held(name_or_stem, held):
    if not held:
        return False
    stem = _archive_stem(name_or_stem)
    return (stem in held
            or stem.removesuffix('-complete') in held
            or any(stem.startswith(h + '_Transport_') for h in held))


def _verify_asset_file(path, asset_name, expected_sha=None, expected_size=None):
    if not path.is_file() or path.is_symlink():
        raise ValueError('Downloaded asset is missing: ' + asset_name)
    if expected_size is not None and path.stat().st_size != expected_size:
        raise ValueError(f'Downloaded asset size differs for {asset_name}: {path.stat().st_size} != {expected_size}')
    if expected_sha is not None:
        actual = sha(path)
        if actual != expected_sha:
            raise ValueError(f'Downloaded asset SHA256 differs for {asset_name}: {actual} != {expected_sha}')


def _safe_asset_name(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_.-]+', value) or '..' in value:
        raise ValueError('Unsafe asset name: ' + repr(value))
    return value


def _fetch_asset(voices_url, repo, asset_name, dest_path, *, expected_sha=None, expected_size=None,
                 retries=2, retry_delay=1.0):
    """Download asset_name from R2 voices_url with retry + GitHub `voices` fallback, verifying size/sha fail-closed."""
    asset_name = _safe_asset_name(asset_name)
    url = voices_url.rstrip('/') + '/' + asset_name
    if not re.fullmatch(r'https://[^\s\"\']+', url):
        raise ValueError('Require an HTTPS download URL: ' + repr(url))
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    last_error = None
    tid = threading.get_ident()
    for attempt in range(retries):
        tmp = dest_path.with_name(f'.{dest_path.name}.{os.getpid()}.{tid}.part')
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'LoreForever-release (bot)'})
            with urllib.request.urlopen(req, timeout=120) as response, tmp.open('wb') as stream:
                shutil.copyfileobj(response, stream, 1024 * 1024)
            _verify_asset_file(tmp, asset_name, expected_sha=expected_sha, expected_size=expected_size)
            os.replace(tmp, dest_path)
            return dest_path
        except (OSError, ValueError, urllib.error.URLError) as error:
            tmp.unlink(missing_ok=True)
            last_error = error
            if attempt + 1 < retries and retry_delay > 0:
                time.sleep(retry_delay)
    with tempfile.TemporaryDirectory(prefix='.gh-voice-') as tmpdir:
        tmp_dir = Path(tmpdir)
        proc = subprocess.run(
            ['gh', 'release', 'download', 'voices', '-R', repo, '-p', asset_name, '-D', str(tmp_dir), '--clobber'],
            capture_output=True, text=True,
        )
        if proc.returncode != 0:
            raise ValueError(f'Failed to fetch {asset_name} from {url} ({last_error}) and gh fallback ({proc.stderr.strip()})')
        candidate = tmp_dir / asset_name
        _verify_asset_file(candidate, asset_name, expected_sha=expected_sha, expected_size=expected_size)
        stage = dest_path.with_name(f'.{dest_path.name}.{os.getpid()}.{tid}.gh.part')
        try:
            shutil.copyfile(candidate, stage)
            os.replace(stage, dest_path)
        finally:
            stage.unlink(missing_ok=True)
    return dest_path


def fetch_narration_and_smoke(voices_url, repo, packs_dir, manifest_out, *, held=None, workers=4, retry_delay=1.0):
    """Fetch narration-latest.json, verify immutable narration-<v>.json, and fetch only installer smoke zips."""
    if not re.fullmatch(r'https://[^\s\"\']+', voices_url):
        raise ValueError('Require an HTTPS voices URL')
    if not repo or not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repo):
        raise ValueError('Invalid repository slug: ' + repr(repo))
    packs_dir.mkdir(parents=True, exist_ok=True)
    manifest_out.parent.mkdir(parents=True, exist_ok=True)
    latest_path = manifest_out.parent / 'narration-latest.json'
    _fetch_asset(voices_url, repo, 'narration-latest.json', latest_path, retry_delay=retry_delay)
    latest = json.loads(latest_path.read_text(encoding='utf-8'))
    if not isinstance(latest, dict):
        raise ValueError('Invalid narration-latest.json schema')
    nm_version = latest.get('version')
    manifest_name = latest.get('manifest')
    manifest_sha = latest.get('sha256')
    manifest_size = latest.get('size')
    if (not isinstance(nm_version, str) or not re.fullmatch(r'\d+\.\d+\.\d+\.\d+', nm_version)
            or manifest_name != f'narration-{nm_version}.json'
            or not isinstance(manifest_sha, str) or not re.fullmatch(r'[0-9a-f]{64}', manifest_sha)):
        raise ValueError('Invalid narration-latest.json pointer fields')
    if manifest_size is not None and (isinstance(manifest_size, bool) or not isinstance(manifest_size, int) or manifest_size <= 0):
        raise ValueError('Invalid narration-latest.json size')
    _fetch_asset(voices_url, repo, manifest_name, manifest_out,
                 expected_sha=manifest_sha, expected_size=manifest_size, retry_delay=retry_delay)
    nm_data = json.loads(manifest_out.read_text(encoding='utf-8'))
    if not isinstance(nm_data, dict) or nm_data.get('version') != nm_version or not isinstance(nm_data.get('zips'), dict):
        raise ValueError('Narration manifest schema/version differs from narration-latest.json')

    offered = offered_archives()
    to_fetch = {}
    selected_sources = set(CORE_PACKS)
    non_held_smoke_offered = 0
    resolved_smoke = 0
    for selection in SMOKE_SELECTIONS:
        if selection == 'base':
            continue
        for base_name in offered.get(selection, []):
            if held and matches_held(base_name, held):
                continue
            non_held_smoke_offered += 1
            entry = nm_data['zips'].get(base_name)
            if entry is None:
                continue
            if not isinstance(entry, dict):
                raise ValueError('Invalid narration manifest entry: ' + base_name)
            archive_name = _safe_asset_name(entry.get('file'))
            digest = entry.get('sha256')
            size = entry.get('size')
            folders = entry.get('folders')
            if (not isinstance(digest, str) or not re.fullmatch(r'[0-9a-f]{64}', digest)
                    or isinstance(size, bool) or not isinstance(size, int) or size <= 0
                    or not isinstance(folders, list) or not all(isinstance(f, str) for f in folders)):
                raise ValueError('Invalid narration manifest download metadata: ' + base_name)
            if held and (matches_held(archive_name, held)
                         or any(matches_held(f, held) for f in folders)):
                non_held_smoke_offered -= 1
                continue
            to_fetch[archive_name] = (digest, size)
            resolved_smoke += 1
            selected_sources.update(folders)
    if non_held_smoke_offered > 0 and resolved_smoke == 0:
        raise ValueError('Narration manifest resolved zero non-held smoke downloads')
    nm_packs = nm_data.get('packs')
    if nm_packs is not None:
        if not isinstance(nm_packs, dict):
            raise ValueError('Invalid narration manifest packs section')
        for source in sorted(selected_sources):
            if held and matches_held(source, held):
                continue
            pack = nm_packs.get(source)
            if not isinstance(pack, dict):
                continue
            shards = pack.get('shards') or []
            if not isinstance(shards, list):
                raise ValueError('Invalid narration manifest transport shards: ' + source)
            for row in shards:
                if not isinstance(row, dict):
                    raise ValueError('Invalid transport shard row: ' + source)
                shard_archive = _safe_asset_name(row.get('archive'))
                shard_sha = row.get('sha256')
                shard_size = row.get('archiveBytes') if row.get('archiveBytes') is not None else row.get('bytes')
                if not isinstance(shard_sha, str) or not re.fullmatch(r'[0-9a-f]{64}', shard_sha):
                    raise ValueError('Invalid transport shard sha256: ' + shard_archive)
                if shard_size is not None and (isinstance(shard_size, bool) or not isinstance(shard_size, int) or shard_size <= 0):
                    raise ValueError('Invalid transport shard size: ' + shard_archive)
                to_fetch[shard_archive] = (shard_sha, shard_size)

    if to_fetch:
        pool_workers = max(1, min(workers, len(to_fetch)))
        with ThreadPoolExecutor(pool_workers) as pool:
            futures = [
                pool.submit(_fetch_asset, voices_url, repo, archive_name, packs_dir / archive_name,
                            expected_sha=digest, expected_size=size, retry_delay=retry_delay)
                for archive_name, (digest, size) in sorted(to_fetch.items())
            ]
            for future in futures:
                future.result()
    return manifest_out


def _add_manifest_downloads(packs, output, result, narration_manifest, voices_url, held=None):
    nm_data = json.loads(Path(narration_manifest).read_text(encoding='utf-8'))
    if not isinstance(nm_data, dict) or not isinstance(nm_data.get('zips'), dict):
        raise ValueError('Invalid narration manifest schema')
    nm_version = nm_data.get('version')
    if not isinstance(nm_version, str) or not re.fullmatch(r'\d+\.\d+\.\d+\.\d+', nm_version):
        raise ValueError('Invalid narration manifest version: ' + repr(nm_version))
    result['narrationManifest'] = f'narration-{nm_version}.json'
    result['narrationVersion'] = nm_version
    offered = offered_archives()
    seen_prefixes = set()
    non_held_offered = 0
    for selection, names in offered.items():
        for base_name in names:
            is_held_name = bool(held and matches_held(base_name, held))
            if not is_held_name:
                non_held_offered += 1
            entry = nm_data['zips'].get(base_name)
            if entry is None:
                if is_held_name:
                    result['unavailable'].append({'selection': selection, 'archive': base_name, 'reason': 'held by release/pack-holds.json'})
                else:
                    result['unavailable'].append({'selection': selection, 'archive': base_name, 'reason': 'not yet recorded or built'})
                continue
            if not isinstance(entry, dict):
                raise ValueError('Invalid narration manifest entry: ' + base_name)
            pack_version = entry.get('version')
            if not isinstance(pack_version, str) or not re.fullmatch(r'\d+\.\d+\.\d+(?:\.\d+)?', pack_version):
                raise ValueError('Invalid pack version in manifest for ' + base_name)
            stem = base_name[:-len('.zip')]
            archive_name = entry.get('file')
            if not isinstance(archive_name, str) or not re.fullmatch(re.escape(stem) + r'-' + re.escape(pack_version) + r'\.zip', archive_name):
                raise ValueError('Unexpected archive filename in manifest for ' + base_name + ': ' + repr(archive_name))
            digest = entry.get('sha256')
            if not isinstance(digest, str) or not re.fullmatch(r'[0-9a-f]{64}', digest):
                raise ValueError('Invalid sha256 in manifest for ' + archive_name)
            size = entry.get('size')
            if not isinstance(size, int) or isinstance(size, bool) or size <= 0:
                raise ValueError('Invalid size in manifest for ' + archive_name)
            raw_folders = entry.get('folders')
            if not isinstance(raw_folders, list) or not raw_folders or len(set(raw_folders)) != len(raw_folders):
                raise ValueError('Invalid folders in manifest for ' + archive_name)
            folders = sorted(safe_name(folder) for folder in raw_folders)
            if held and (is_held_name or matches_held(archive_name, held)
                         or any(matches_held(folder, held) for folder in folders)):
                if not is_held_name:
                    non_held_offered -= 1
                result['unavailable'].append({'selection': selection, 'archive': base_name, 'reason': 'held by release/pack-holds.json'})
                continue
            if selection in COMPLETE and base_name == offered[selection][0]:
                if folders != sorted(COMPLETE[selection]):
                    raise ValueError('Unexpected ' + selection + ' archive folders')
                selected_folders = list(COMPLETE[selection])
                result['selections'][selection] = selected_folders + result['selections'][selection]
            else:
                if folders != [stem]:
                    raise ValueError('Unexpected ' + selection + ' archive folders: ' + archive_name)
                selected_folders = folders
                result['selections'][selection] += folders
            if voices_url:
                url = voices_url.rstrip('/') + '/' + archive_name
            else:
                url = entry.get('url')
                if not isinstance(url, str) or not re.fullmatch(r'https://[^\s\"\']+', url) or not url.endswith('/' + archive_name):
                    raise ValueError('Invalid download URL in manifest for ' + archive_name)
            seen_prefixes.add(url[:-len(archive_name)])
            if packs is not None:
                local_path = packs / archive_name
                if local_path.is_file():
                    if local_path.stat().st_size != size:
                        raise ValueError('Staged ZIP size mismatch: ' + archive_name)
                    if sha(local_path) != digest:
                        raise ValueError('Staged ZIP SHA256 mismatch: ' + archive_name)
                    if zip_folders(local_path, pack_version) != folders:
                        raise ValueError('Staged ZIP folders mismatch: ' + archive_name)
                    target = output / archive_name
                    if target.resolve() != local_path.resolve():
                        shutil.copyfile(local_path, target)
            result['downloads'].append({'selection': selection, 'archive': archive_name, 'version': pack_version, 'folders': selected_folders,
                                        'sha256': digest, 'url': url, 'bytes': size})
    if len(seen_prefixes) > 1:
        raise ValueError('Mixed voice download URL bases in narration manifest')
    if non_held_offered > 0 and not result['downloads']:
        raise ValueError('Narration manifest resolved zero non-held offered downloads')
    default_voice_base = voices_url.rstrip('/') + '/' if voices_url else 'https://downloads.loreforeverwow.com/voices/'
    result['voiceBaseUrl'] = next(iter(seen_prefixes)) if seen_prefixes else default_voice_base
    return nm_data, nm_version


def _add_manifest_transport_shards(packs, output, result, nm_data, nm_version, voices_url, held=None):
    nm_packs = nm_data.get('packs')
    if nm_packs is None:
        return
    if not isinstance(nm_packs, dict):
        raise ValueError('Invalid narration manifest packs section')
    shard_prefixes = set()
    for source, pack in sorted(nm_packs.items()):
        safe_name(source)
        if held and matches_held(source, held):
            continue
        if not isinstance(pack, dict) or not isinstance(pack.get('shards'), list) or not isinstance(pack.get('required'), list):
            raise ValueError('Invalid narration manifest transport entry: ' + source)
        if source in result['packs']:
            raise ValueError('Duplicate transport source: ' + source)
        shards = pack['shards']
        if any(not isinstance(row, dict) for row in shards):
            raise ValueError('Invalid transport shard row: ' + source)
        if pack['required'] != [row.get('addon') for row in shards] or len(set(pack['required'])) != len(shards):
            raise ValueError('Transport required/shards mismatch: ' + source)
        published = []
        for row in shards:
            addon = safe_name(row.get('addon'))
            if not re.fullmatch(re.escape(source) + r'_Transport_\d{3}_[a-f0-9]{10}', addon) or row.get('archive') != addon + '.zip':
                raise ValueError('Shard ownership mismatch: ' + addon)
            shard_sha = row.get('sha256')
            receipt_sha = row.get('receiptSha256')
            if not (isinstance(shard_sha, str) and re.fullmatch(r'[0-9a-f]{64}', shard_sha)) or not (isinstance(receipt_sha, str) and re.fullmatch(r'[0-9a-f]{64}', receipt_sha)):
                raise ValueError('Invalid transport shard digest: ' + addon)
            shard_version = row.get('version') or row.get('releaseVersion') or nm_version
            if not isinstance(shard_version, str) or not re.fullmatch(r'\d+\.\d+\.\d+(?:\.\d+)?', shard_version):
                raise ValueError('Invalid transport shard version: ' + addon)
            if voices_url:
                url = voices_url.rstrip('/') + '/' + row['archive']
            else:
                url = row.get('url')
                if not isinstance(url, str) or not re.fullmatch(r'https://[^\s\"\']+', url) or not url.endswith('/' + row['archive']):
                    raise ValueError('Invalid transport shard URL: ' + addon)
            shard_prefixes.add(url[:-len(row['archive'])])
            if packs is not None:
                local_shard = packs / row['archive']
                if local_shard.is_file():
                    if sha(local_shard) != shard_sha:
                        raise ValueError('Staged transport ZIP SHA256 mismatch: ' + row['archive'])
                    if zip_folders(local_shard, shard_version) != [addon]:
                        raise ValueError('Staged transport ZIP mismatch: ' + row['archive'])
                    target = output / row['archive']
                    if target.resolve() != local_shard.resolve():
                        shutil.copyfile(local_shard, target)
            published.append(dict(row, version=shard_version, url=url))
        result['packs'][source] = dict(pack, shards=published)
    if shard_prefixes:
        combined = shard_prefixes | ({result['voiceBaseUrl']} if result['downloads'] else set())
        if len(combined) > 1:
            raise ValueError('Mixed transport and voice download URL bases in narration manifest')
        if not result['downloads']:
            result['voiceBaseUrl'] = next(iter(shard_prefixes))


def build(transport, packs, output, version, base, source_commit, candidate_zip,
          *, narration_manifest=None, voices_url=None, held=None):
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('Invalid release version')
    if (narration_manifest is None or base) and not re.fullmatch(r'https://[^\s\"\']+', base):
        raise ValueError('Require an HTTPS release URL')
    if voices_url is not None and not re.fullmatch(r'https://[^\s\"\']+', voices_url):
        raise ValueError('Require an HTTPS voices URL')
    if not re.fullmatch(r'[a-f0-9]{40}', source_commit):
        raise ValueError('Require the exact source commit')
    if narration_manifest is None and packs is None:
        raise ValueError('Require --packs when --narration-manifest is omitted')
    zip_folders(candidate_zip, version)
    output.mkdir(parents=True, exist_ok=True)
    result = {'version': 1, 'releaseVersion': version, 'sourceCommit': source_commit, 'candidateZipSha256': sha(candidate_zip), 'packs': {}, 'downloads': [], 'selections': {'base': CORE_PACKS, **{choice: [] for choice in CHOICES}}, 'unavailable': []}
    nm_data, nm_version = (None, None)
    if narration_manifest is not None:
        nm_data, nm_version = _add_manifest_downloads(packs, output, result, narration_manifest, voices_url, held=held)
    else:
        # Only explicit options; languages remain available as manual source pack selections.
        offered = offered_archives()
        complete = {packs / offered[choice][0]: choice for choice in COMPLETE}
        for selection, names in offered.items():
            for path in (packs / name for name in names):
                if not path.is_file():
                    result['unavailable'].append({'selection': selection, 'archive': path.name, 'reason': 'not yet recorded or built'})
                    continue
                folders = zip_folders(path, version)
                target = output / path.name
                if target.resolve() != path.resolve():
                    shutil.copyfile(path, target)
                if path in complete:
                    if folders != COMPLETE[complete[path]]:
                        raise ValueError('Unexpected ' + selection + ' archive folders')
                    result['selections'][selection] = folders + result['selections'][selection]
                else:
                    if folders != [path.stem]:
                        raise ValueError('Unexpected ' + selection + ' archive folders: ' + str(path))
                    result['selections'][selection] += folders
                result['downloads'].append({'selection': selection, 'archive': path.name, 'version': version, 'folders': folders,
                                            'sha256': sha(path), 'url': base.rstrip('/') + '/' + path.name, 'bytes': path.stat().st_size})
        result['voiceBaseUrl'] = f'https://downloads.loreforeverwow.com/v{version}/'
    manifest_path = transport / 'transport-downloads.json'
    data = json.loads(manifest_path.read_text()) if manifest_path.is_file() else {'version': 1, 'rates': ['1'], 'packs': {}}
    if data.get('version') != 1 or data.get('rates') != ['1']:
        raise ValueError('Unsupported transport manifest')
    result['rates'] = data['rates']
    if data['packs'] and not re.fullmatch(r'https://[^\s\"\']+', base):
        raise ValueError('Require an HTTPS release URL')
    for source, pack in sorted(data['packs'].items()):
        safe_name(source)
        shards = pack['shards']
        if pack['required'] != [row['addon'] for row in shards] or len(set(pack['required'])) != len(shards):
            raise ValueError('Transport required/shards mismatch: ' + source)
        published = []
        for row in shards:
            addon = safe_name(row['addon'])
            if not re.fullmatch(re.escape(source) + r'_Transport_\d{3}_[a-f0-9]{10}', addon) or row['archive'] != addon + '.zip':
                raise ValueError('Shard ownership mismatch: ' + addon)
            folder = transport / addon
            if sha(folder / 'Transport.json') != row['receiptSha256']:
                raise ValueError('Changed transport receipt: ' + addon)
            receipt = json.loads((folder / 'Transport.json').read_text())
            if receipt.get('sourcePack') != source or receipt.get('pack') != addon:
                raise ValueError('Transport receipt ownership mismatch: ' + addon)
            if receipt.get('rates', ['1']) != ['1'] or receipt.get('config', {}).get('rates', ['1']) != ['1']:
                raise ValueError('Alternate-speed transport is disabled: ' + addon)
            named_audio = set()
            for clip, rates in receipt['clips'].items():
                numeric_rates = {key for key in rates if re.fullmatch(r'\d+(?:\.\d+)?', key)}
                if numeric_rates != {'1'} or rates.get('config', {}).get('rates', ['1']) != ['1']:
                    raise ValueError('Alternate-speed transport is disabled: ' + addon + ': ' + clip)
                if rates.get('assetPack', addon) != addon:
                    raise ValueError('Transport clip asset ownership mismatch')
                for segment in rates['1']:
                    relative = segment['file'].replace('\\', '/')
                    if not relative.startswith('Audio/') or '..' in Path(relative).parts:
                        raise ValueError('Unsafe transport segment path')
                    if sha(folder / relative) != segment['sha256']:
                        raise ValueError('Changed transport segment: ' + relative)
                    named_audio.add(relative)
            actual_audio = {item.relative_to(folder).as_posix() for item in (folder / 'Audio').rglob('*') if item.is_file()}
            if actual_audio != named_audio:
                raise ValueError('Unreceipted transport audio: ' + addon)
            toc = (folder / (addon + '.toc')).read_text()
            if not re.search(r'^## Dependencies: ' + re.escape(source) + r'\s*$', toc, re.M):
                raise ValueError('Shard dependency mismatch: ' + addon)
            source_version = re.search(r'^## Version: (\d+\.\d+\.\d+)\s*$', toc, re.M)
            if not source_version:
                raise ValueError('Missing shard version: ' + addon)
            release_toc = re.sub(r'^## Version: [^\r\n]+', '## Version: ' + version, toc, flags=re.M)
            archive = output / row['archive']
            with zipfile.ZipFile(archive, 'w') as package:
                for item in sorted(folder.rglob('*')):
                    if item.is_file():
                        info = zipfile.ZipInfo(addon + '/' + item.relative_to(folder).as_posix(), date_time=(2026, 1, 1, 0, 0, 0))
                        info.compress_type = zipfile.ZIP_STORED if item.suffix in ('.mp3', '.ogg') else zipfile.ZIP_DEFLATED
                        info.external_attr = 0o644 << 16
                        body = release_toc.encode('utf-8') if item.name == addon + '.toc' else item.read_bytes()
                        package.writestr(info, body)
            if archive.stat().st_size > LIMIT:
                archive.unlink()
                raise ValueError('Transport ZIP exceeds 480 MB: ' + addon)
            published.append(dict(row, version=version, sourceVersion=source_version.group(1), releaseVersion=version, sha256=sha(archive), url=base.rstrip('/') + '/' + archive.name, archiveBytes=archive.stat().st_size))
        result['packs'][source] = dict(pack, shards=published)
    if nm_data is not None:
        _add_manifest_transport_shards(packs, output, result, nm_data, nm_version, voices_url, held=held)
    # Missing future render coverage keeps the working recording/text fallback.
    for selection, sources in result['selections'].items():
        for source in sources:
            if source not in result['packs']:
                result['unavailable'].append({'selection': selection, 'source': source, 'reason': 'transport not yet built; existing recording fallback'})
    (output / 'transport-downloads.json').write_text(json.dumps(result, indent=2) + '\n')
    write_setup_code(result, output)
    return result


# A pack's name while Setup fetches it, as the downloads page names it (site/public/data/packs.json), without the narrator
# (the player picked one). A zip not listed keeps Setup's older wording.
LABELS = {'MorePlaces': 'More places', 'MorePeople': 'More people', 'MoreItems': 'Item stories',
          'MoreQuests0': 'Quest stories, levels 1-10', 'MoreQuests1': 'Quest stories, levels 1-19', 'MoreQuests2': 'Quest stories, levels 20-39',
          'MoreQuests3': 'Quest stories, levels 40+ and in-world books',
          'Quests': 'Quest dialogue, levels 1-25', 'Quests2': 'Quest dialogue, levels 26-45',
          'Quests3': 'Quest dialogue, levels 46-59', 'Quests4': 'Quest dialogue, level 60',
          'QuestGivers': "Quest givers' voices, levels 1-20",
          'QuestGivers2': "Quest givers' voices, levels 21-40", 'QuestGivers3': "Quest givers' voices, levels 41-55",
          'QuestGivers4': "Quest givers' voices, levels 56+"}
# What a player needs first comes first (PM, ask 14711: "the add-on, then the starting zones' packs, then the rest"):
# Setup itself carries the add-on; then a narrator's own stories and lands, then the packs for levels 1-30.
STARTING_ZONES = ('_Quests', '_QuestGivers', '_MoreQuests0', '_MoreQuests1')


def _archive_stem(archive):
    stem = archive[:-len('.zip')] if archive.endswith('.zip') else archive
    return VERSION_SUFFIX.sub('', stem)


def label(archive):
    stem = _archive_stem(archive)
    if stem.endswith('-complete'):
        return ('Original male' if '_Original' in stem else 'Female') + ' narrator: stories and lands'
    return LABELS.get(re.sub(r'^LoreForever_Voice_(Default_|Female_|Original_)?', '', stem), stem)


def priority(row):
    stem = _archive_stem(row['archive'])
    if stem.endswith('-complete'):
        return (0, 0)
    starting = [index for index, tail in enumerate(STARTING_ZONES) if stem.endswith(tail)]
    return (1, starting[0]) if starting else (2, 0)


def write_setup_code(result, output):
    """installer-downloads.iss and its uninstall entries from a build() result (or a release's transport-downloads.json).
    The plain downloads go into one queue, most needed first, that Setup fetches several at a time (RunDownloadQueue)."""
    pascal = lambda text: text.replace("'", "''")
    voice_base = result.get('voiceBaseUrl') or 'https://downloads.loreforeverwow.com/voices/'
    if not voice_base.endswith('/'):
        voice_base += '/'
    if not re.fullmatch(r'https://[^\s\"\']+/', voice_base):
        raise ValueError('Invalid voiceBaseUrl: ' + repr(voice_base))
    lines = ['// Generated from exact release archives; do not hand edit.', 'procedure InstallVerifiedDownloads();', 'var', '  Ok: Boolean;', 'begin']
    lines += ["  VoiceDefaultBase := '%s';" % pascal(voice_base)]
    for row in sorted(result['downloads'], key=priority):
        expected_ver = row.get('version') or result['releaseVersion']
        lines += ["  if VoiceChosen('%s') then QueueDownload('%s', '%s', '%s', '%s', '%s', %d);" % (
            row['selection'], row['archive'], row['sha256'], ';'.join(row['folders']),
            pascal(label(row['archive'])), pascal(expected_ver), row['bytes'])]
    lines += ['  RunDownloadQueue();']
    for source, pack in result['packs'].items():
        # Sources outside the selected groups are available in JSON but never auto-installed.
        groups = [key for key, sources in result['selections'].items() if source in sources]
        if not groups:
            continue
        condition = ' or '.join('True' if group == 'base' else "VoiceChosen('%s')" % group for group in groups)
        lines += ['  if (' + condition + ") and FileExists(AddOnsDir() + '\\%s\\%s.toc') then begin" % (source, source), '    BeginDownloadGroup();', '    Ok := True;']
        for row in pack['shards']:
            expected_ver = row.get('version') or row.get('releaseVersion') or result['releaseVersion']
            lines += ["    if not PrepareDownload('%s', '%s', '%s', '%s', '%s', '%s') then Ok := False;" % (
                row['archive'], row['sha256'], row['addon'], source, row['receiptSha256'], pascal(expected_ver))]
        lines += ["    if FinishDownloadGroup(Ok) then PruneTransport('%s', '%s');" % (source, ';'.join(pack['required'])), '  end;']
    lines += ['end;', '', 'procedure ConfigureAvailableVoices();', 'begin']
    for index, selection in enumerate(CHOICES):
        if result['selections'][selection]:
            lines.append("  VoiceFolders[%s] := '%s';" % (index, ';'.join(result['selections'][selection])))
    indices = [index for index, selection in enumerate(CHOICES) if result['selections'][selection]]
    for target, original in enumerate(indices):
        if target != original:
            for field in ('VoiceIds', 'VoiceNames', 'VoiceAssets', 'VoiceFolders'):
                lines.append('  %s[%s] := %s[%s];' % (field, target, field, original))
    for field in ('VoiceIds', 'VoiceNames', 'VoiceAssets', 'VoiceFolders', 'VoiceWanted'):
        lines.append('  SetArrayLength(%s, %s);' % (field, len(indices)))
    lines += ['end;', '']
    # What a choice downloads, for the size on Setup's first screen (the same zips and bytes as the downloads page).
    lines += ['function DownloadSizeOf(Id: String; var Packs: Integer): Int64;', 'begin', '  Result := 0;', '  Packs := 0;']
    for row in result['downloads']:
        lines.append("  if Id = '%s' then begin Result := Result + %d; Packs := Packs + 1; end;" % (row['selection'], row['bytes']))
    lines += ['end;', '']
    (output / 'installer-downloads.iss').write_text('\n'.join(lines))
    uninstall = []
    for selection, sources in result['selections'].items():
        folders = list(sources) if selection != 'base' else []
        folders += [row['addon'] for source in sources for row in result['packs'].get(source, {}).get('shards', [])]
        for folder in folders:
            check = '' if selection == 'base' else "; Check: VoiceChosen('%s')" % selection
            uninstall.append('Type: filesandordirs; Name: "{app}\\{code:GameFlavor}\\Interface\\AddOns\\' + folder + '"' + check)
    (output / 'installer-downloads-uninstall.iss').write_text('\n'.join(uninstall) + '\n')


def fetch_transport(manifest, output):
    """Fetch already published transport archives; never render or publish audio."""
    data = json.loads(manifest.read_text())
    if data.get('version') != 1 or data.get('rates') != ['1']:
        raise ValueError('Only normal-speed resume segments are enabled')
    output.mkdir(parents=True, exist_ok=True)
    for source, pack in data['packs'].items():
        safe_name(source)
        for row in pack['shards']:
            addon = safe_name(row['addon'])
            if row['archive'] != addon + '.zip' or not re.fullmatch(r'https://[^\s]+', row['url']):
                raise ValueError('Unsafe transport download')
            archive = output / row['archive']
            temporary = archive.with_suffix('.part')
            try:
                with urllib.request.urlopen(row['url'], timeout=60) as response, temporary.open('wb') as stream:
                    shutil.copyfileobj(response, stream)
                if temporary.stat().st_size > LIMIT or sha(temporary) != row['sha256']:
                    raise ValueError('Transport archive hash/size differs: ' + addon)
                with zipfile.ZipFile(temporary) as package:
                    for name in package.namelist():
                        if not name.startswith(addon + '/') or '..' in Path(name).parts or '\\' in name:
                            raise ValueError('Unsafe transport archive member')
                    package.extractall(output)
                temporary.replace(archive)
            finally:
                temporary.unlink(missing_ok=True)
    (output / 'transport-downloads.json').write_text(json.dumps(data, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('transport', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--packs', type=Path)
    parser.add_argument('--version', required=True)
    parser.add_argument('--base-url', default='')
    parser.add_argument('--source-commit', required=True)
    parser.add_argument('--candidate-zip', type=Path, required=True)
    parser.add_argument('--published-transport', type=Path)
    parser.add_argument('--narration-manifest', type=Path)
    parser.add_argument('--narration-out', type=Path)
    parser.add_argument('--voices-url')
    parser.add_argument('--fetch-narration', action='store_true')
    parser.add_argument('--repo', default=os.environ.get('GH_REPO') or 'mliudev/LoreForever')
    parser.add_argument('--holds', type=Path)
    args = parser.parse_args()
    if not args.fetch_narration and args.narration_manifest is None and (args.packs is None or not args.base_url):
        parser.error('--packs and --base-url are required unless --narration-manifest or --fetch-narration is given')
    if args.fetch_narration and args.packs is None:
        parser.error('--packs is required with --fetch-narration')
    try:
        held = load_holds(args.holds)
        if args.published_transport and args.published_transport.is_file():
            fetch_transport(args.published_transport, args.transport)
        narration_manifest = args.narration_manifest
        voices_url = args.voices_url
        if args.fetch_narration:
            voices_url = voices_url or 'https://downloads.loreforeverwow.com/voices/'
            narration_manifest = args.narration_out or (args.output / 'narration-manifest.json')
            fetch_narration_and_smoke(voices_url, args.repo, args.packs, narration_manifest, held=held)
        result = build(args.transport, args.packs, args.output, args.version, args.base_url, args.source_commit, args.candidate_zip,
                       narration_manifest=narration_manifest, voices_url=voices_url, held=held)
    except (OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
        parser.exit(1, 'installer-downloads: ' + str(error) + '\n')
    print(json.dumps({'status': 'built', 'packs': len(result['packs']), 'downloads': len(result['downloads'])}))


if __name__ == '__main__':
    main()
