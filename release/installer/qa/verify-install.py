"""Check an isolated installer journey against exact candidate/download bytes."""
import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify(candidate, directory, manifest_path, selection):
    data = json.loads(manifest_path.read_text(encoding='utf-8-sig'))
    addons = directory / '_classic_beta_' / 'Interface' / 'AddOns'
    wanted = list(data['selections']['base'])
    if selection != 'base':
        wanted += data['selections'][selection]
    archives = [candidate]
    downloads = [row for row in data['downloads'] if row['selection'] == selection]
    for source in wanted:
        downloads += [dict(row, sha256=row['sha256']) for row in data['packs'].get(source, {}).get('shards', [])]
    failures = []
    expected = {}
    status_file = directory / 'lore-download-status.tsv'
    receipts = {}
    if status_file.is_file():
        for line in status_file.read_text(encoding='utf-8-sig').splitlines():
            asset, digest, status = line.split('\t')
            receipts[asset] = (digest, status)
    if sha(candidate) != data['candidateZipSha256']:
        failures.append('Candidate ZIP changed')
    for row in downloads:
        archive = manifest_path.parent / row['archive']
        if not archive.is_file() or sha(archive) != row['sha256']:
            failures.append('Download bytes changed or missing: ' + row['archive'])
            continue
        if receipts.get(row['archive']) != (row['sha256'], 'passed'):
            failures.append('Missing passing verified download receipt: ' + row['archive'])
        archives.append(archive)
    if set(receipts) != {row['archive'] for row in downloads}:
        failures.append('Unexpected or missing selected downloads')
    for archive in archives:
        with zipfile.ZipFile(archive) as package:
            for member in package.infolist():
                if member.is_dir():
                    continue
                if member.filename.startswith('/') or '..' in Path(member.filename).parts:
                    raise ValueError('Unsafe ZIP path')
                digest = hashlib.sha256(package.read(member)).hexdigest()
                if member.filename in expected and expected[member.filename] != digest:
                    failures.append('Conflicting release member: ' + member.filename)
                expected[member.filename] = digest
    for name, digest in expected.items():
        target = addons / name
        if not target.is_file() or sha(target) != digest:
            failures.append('Missing or changed installed member: ' + name)
    actual = {item.relative_to(addons).as_posix() for item in addons.rglob('*') if item.is_file()}
    failures += ['Unexpected installed member: ' + name for name in sorted(actual - set(expected))]
    expected_folders = {name.split('/')[0] for name in expected}
    for folder in expected_folders:
        toc = addons / folder / (folder + '.toc')
        if not toc.is_file():
            continue
        text = toc.read_text(encoding='utf-8-sig')
        if not re.search(r'^## Version: ' + re.escape(data['releaseVersion']) + r'\s*$', text, re.M):
            failures.append('Installed version differs: ' + folder)
        dependencies = re.search(r'^## Dependencies:\s*(.+)$', text, re.M)
        if dependencies:
            for required in re.split(r'[, ]+', dependencies.group(1).strip()):
                if required and required not in expected_folders:
                    failures.append('Missing dependency: ' + folder + ' -> ' + required)
    return {'status': 'failed' if failures else 'passed', 'selection': selection, 'checkedFiles': len(expected),
            'selectedSources': wanted, 'downloads': [row['archive'] for row in downloads], 'unavailable': [row for row in data.get('unavailable', []) if row['selection'] in ('base', selection)], 'failures': failures}


if __name__ == '__main__':
    result = verify(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), sys.argv[4])
    print(json.dumps(result, indent=2))
    sys.exit(result['status'] != 'passed')
