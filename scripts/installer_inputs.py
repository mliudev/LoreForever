#!/usr/bin/env python3
"""Partition frozen release extras into minimal installer inputs and release-only files.

The union of the base/female/quests smoke cases is derived from the generated
download contract. Files are moved without rewriting them; the release job merges
both disjoint artifacts back together. No rendering, network, or publication.
"""
import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path

CONTROLS = ('transport-downloads.json', 'installer-downloads.iss', 'installer-downloads-uninstall.iss')
SELECTIONS = ('base', 'female', 'quests')


def archive_name(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_.-]+\.zip', value) or '..' in value:
        raise ValueError('Unsafe archive name: ' + repr(value))
    return value


def selected_archives(manifest):
    """Return archive -> SHA256 for every download used by the three smoke cases."""
    if manifest.get('version') != 1 or manifest.get('rates') != ['1']:
        raise ValueError('Unsupported installer download contract')
    sources = set()
    for selection in SELECTIONS:
        sources.update(manifest['selections'][selection])
    rows = [row for row in manifest['downloads'] if row['selection'] in SELECTIONS]
    rows += [row for source in sources for row in manifest['packs'].get(source, {}).get('shards', [])]
    result = {}
    for row in rows:
        name = archive_name(row['archive'])
        digest = row['sha256']
        if not isinstance(digest, str) or not re.fullmatch(r'[0-9a-f]{64}', digest):
            raise ValueError('Invalid SHA256: ' + name)
        if name in result and result[name] != digest:
            raise ValueError('Conflicting SHA256: ' + name)
        result[name] = digest
    return result


def split(source, installer, release):
    roots = [path.resolve() for path in (source, installer, release)]
    if any(a == b or a in b.parents or b in a.parents for i, a in enumerate(roots) for b in roots[i + 1:]):
        raise ValueError('Artifact directories must be distinct siblings')
    if any(path.exists() for path in (installer, release)):
        raise ValueError('Artifact destinations must not exist')
    manifest = json.loads((source / CONTROLS[0]).read_text())
    selected = selected_archives(manifest)
    # Validate before moving anything, so a corrupt/missing input leaves the source intact.
    files = {path.name: path for path in source.iterdir()}
    if any(not path.is_file() or path.is_symlink() for path in files.values()):
        raise ValueError('Expected only regular files in frozen release extras')
    for name in (*CONTROLS, *selected):
        if name not in files:
            raise ValueError('Missing installer input: ' + name)
    for name, digest in selected.items():
        with files[name].open('rb') as stream:
            actual = hashlib.file_digest(stream, 'sha256').hexdigest()
        if actual != digest:
            raise ValueError('Installer input SHA256 differs: ' + name)
    installer_names = set(CONTROLS) | selected.keys()
    report = {'installerFiles': len(installer_names), 'installerBytes': 0, 'releaseFiles': 0, 'releaseBytes': 0}
    installer.mkdir(parents=True)
    release.mkdir(parents=True)
    for name, path in sorted(files.items()):
        needed = name in installer_names
        report['installerBytes' if needed else 'releaseBytes'] += path.stat().st_size
        if not needed:
            report['releaseFiles'] += 1
        shutil.move(str(path), (installer if needed else release) / name)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--installer', type=Path, required=True)
    parser.add_argument('--release', type=Path, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(split(args.source, args.installer, args.release)))
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.exit(1, 'installer-inputs: ' + str(error) + '\n')


if __name__ == '__main__':
    main()
