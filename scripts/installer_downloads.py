#!/usr/bin/env python3
"""Freeze source ZIPs and external transport shards into verified installer downloads.

No publication or encoding. Run after build-voice-packs.sh with --transport DIR,
--packs dist/packs --output dist/installer --version VERSION. Compile Setup with
/DDownloadIss=<output>/installer-downloads.iss. JSON is also the QA contract.
"""
import argparse
import hashlib
import json
import re
import shutil
import zipfile
import urllib.request
from pathlib import Path

CORE_PACKS = ['LoreForever_Voice_Default', 'LoreForever_Voice_Default_Alliance', 'LoreForever_Voice_Default_Horde']
QUEST_PACKS = ['LoreForever_Voice_Default_Quests'] + ['LoreForever_Voice_Default_Answers_' + part for part in ('Places', 'Lore', 'People', 'Quests1', 'Quests2', 'Quests3')]
NAME = re.compile(r'LoreForever(?:_[A-Za-z0-9_-]+)?')
LIMIT = 480 * 1024 * 1024


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
            text = archive.read(folder + '/' + folder + '.toc').decode('utf-8')
            if not re.search(r'^## Version: ' + re.escape(version) + r'\s*$', text, re.M):
                raise ValueError('ZIP version mismatch: ' + folder)
        return folders


def build(transport, packs, output, version, base, source_commit, candidate_zip):
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('Invalid release version')
    if not re.fullmatch(r'https://[^\s\"\']+', base):
        raise ValueError('Require an HTTPS release URL')
    if not re.fullmatch(r'[a-f0-9]{40}', source_commit):
        raise ValueError('Require the exact source commit')
    zip_folders(candidate_zip, version)
    output.mkdir(parents=True, exist_ok=True)
    result = {'version': 1, 'releaseVersion': version, 'sourceCommit': source_commit, 'candidateZipSha256': sha(candidate_zip), 'packs': {}, 'downloads': [], 'selections': {'base': CORE_PACKS, 'female': [], 'quests': []}, 'unavailable': []}
    # Only explicit options; languages remain available as manual source pack selections.
    female = packs / 'LoreForever_Voice_Female-complete.zip'
    for selection, archives in [('female', [female]), ('quests', [packs / (name + '.zip') for name in QUEST_PACKS])]:
        for path in archives:
            if not path.is_file():
                result['unavailable'].append({'selection': selection, 'archive': path.name, 'reason': 'not yet recorded or built'})
                continue
            folders = zip_folders(path, version)
            target = output / path.name
            if target.resolve() != path.resolve():
                shutil.copyfile(path, target)
            if selection == 'female':
                expected = ['LoreForever_Voice_Female', 'LoreForever_Voice_Female_Alliance', 'LoreForever_Voice_Female_Horde']
                if folders != expected:
                    raise ValueError('Unexpected female archive folders')
                result['selections']['female'] = folders
            else:
                if folders != [path.stem]:
                    raise ValueError('Unexpected quest archive folders: ' + str(path))
                result['selections']['quests'] += folders
            result['downloads'].append({'selection': selection, 'archive': path.name, 'folders': folders,
                                        'sha256': sha(path), 'url': base.rstrip('/') + '/' + path.name, 'bytes': path.stat().st_size})
    manifest_path = transport / 'transport-downloads.json'
    data = json.loads(manifest_path.read_text()) if manifest_path.is_file() else {'version': 1, 'rates': ['1'], 'packs': {}}
    if data.get('version') != 1 or data.get('rates') != ['1']:
        raise ValueError('Unsupported transport manifest')
    result['rates'] = data['rates']
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
            published.append(dict(row, sourceVersion=source_version.group(1), releaseVersion=version, sha256=sha(archive), url=base.rstrip('/') + '/' + archive.name, archiveBytes=archive.stat().st_size))
        result['packs'][source] = dict(pack, shards=published)
    # Missing future render coverage keeps the working recording/text fallback.
    for selection, sources in result['selections'].items():
        for source in sources:
            if source not in result['packs']:
                result['unavailable'].append({'selection': selection, 'source': source, 'reason': 'transport not yet built; existing recording fallback'})
    (output / 'transport-downloads.json').write_text(json.dumps(result, indent=2) + '\n')
    lines = ['// Generated from exact release archives; do not hand edit.', 'procedure InstallVerifiedDownloads();', 'var', '  Ok: Boolean;', 'begin']
    for row in result['downloads']:
        lines += ["  if VoiceChosen('%s') then InstallDownload('%s', '%s', '%s', '', '');" % (row['selection'], row['archive'], row['sha256'], ';'.join(row['folders']))]
    for source, pack in result['packs'].items():
        # Sources outside the selected groups are available in JSON but never auto-installed.
        groups = [key for key, sources in result['selections'].items() if source in sources]
        if not groups:
            continue
        condition = ' or '.join('True' if group == 'base' else "VoiceChosen('%s')" % group for group in groups)
        lines += ['  if (' + condition + ") and FileExists(AddOnsDir() + '\\%s\\%s.toc') then begin" % (source, source), '    BeginDownloadGroup();', '    Ok := True;']
        for row in pack['shards']:
            lines += ["    if not PrepareDownload('%s', '%s', '%s', '%s', '%s') then Ok := False;" % (row['archive'], row['sha256'], row['addon'], source, row['receiptSha256'])]
        lines += ["    if FinishDownloadGroup(Ok) then PruneTransport('%s', '%s');" % (source, ';'.join(pack['required'])), '  end;']
    lines += ['end;', '', 'procedure ConfigureAvailableVoices();', 'begin']
    for index, selection in enumerate(('female', 'quests')):
        if result['selections'][selection]:
            lines.append("  VoiceFolders[%s] := '%s';" % (index, ';'.join(result['selections'][selection])))
    indices = [index for index, selection in enumerate(('female', 'quests')) if result['selections'][selection]]
    for target, original in enumerate(indices):
        if target != original:
            for field in ('VoiceIds', 'VoiceNames', 'VoiceAssets', 'VoiceFolders'):
                lines.append('  %s[%s] := %s[%s];' % (field, target, field, original))
    for field in ('VoiceIds', 'VoiceNames', 'VoiceAssets', 'VoiceFolders', 'VoiceWanted'):
        lines.append('  SetArrayLength(%s, %s);' % (field, len(indices)))
    lines += ['end;', '']
    (output / 'installer-downloads.iss').write_text('\n'.join(lines))
    uninstall = []
    for selection, sources in result['selections'].items():
        folders = list(sources) if selection != 'base' else []
        folders += [row['addon'] for source in sources for row in result['packs'].get(source, {}).get('shards', [])]
        for folder in folders:
            check = '' if selection == 'base' else "; Check: VoiceChosen('%s')" % selection
            uninstall.append('Type: filesandordirs; Name: "{app}\\_classic_beta_\\Interface\\AddOns\\' + folder + '"' + check)
    (output / 'installer-downloads-uninstall.iss').write_text('\n'.join(uninstall) + '\n')
    return result


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
    for name in ('transport', 'packs', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--version', required=True)
    parser.add_argument('--base-url', required=True)
    parser.add_argument('--source-commit', required=True)
    parser.add_argument('--candidate-zip', type=Path, required=True)
    parser.add_argument('--published-transport', type=Path)
    args = parser.parse_args()
    try:
        if args.published_transport and args.published_transport.is_file():
            fetch_transport(args.published_transport, args.transport)
        result = build(args.transport, args.packs, args.output, args.version, args.base_url, args.source_commit, args.candidate_zip)
    except (OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
        parser.exit(1, 'installer-downloads: ' + str(error) + '\n')
    print(json.dumps({'status': 'built', 'packs': len(result['packs']), 'downloads': len(result['downloads'])}))


if __name__ == '__main__':
    main()
