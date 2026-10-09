#!/usr/bin/env python3
"""Source-bound producer uploads and verified draft promotion. No large final-job downloads.

Published-tag rebuilds keep the previous local-artifact path. New tags and failed
unpublished runs stage into a draft; only complete, digest-verified outputs go live.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import zipfile
from pathlib import Path

from installer_inputs import CONTROLS, SELECTIONS, selected_archives
import curseforge_voices as cv


class Failure(RuntimeError):
    pass


def run(*args, binary=None):
    result = subprocess.run(['gh', *map(str, args)], stdout=binary or subprocess.PIPE,
                            stderr=subprocess.PIPE, text=binary is None)
    if result.returncode:
        error = result.stderr if binary is None else result.stderr.decode(errors='replace')
        raise Failure(error.strip() or 'gh failed')
    return result.stdout


def api(repo, endpoint):
    return json.loads(run('api', f'repos/{repo}/{endpoint}'))


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def name(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_.-]+', value) or '..' in value:
        raise Failure('Unsafe asset name: ' + repr(value))
    return value


def row(path, asset=None):
    if not path.is_file() or path.is_symlink():
        raise Failure('Expected a regular asset: ' + str(path))
    return {'name': name(asset or path.name), 'bytes': path.stat().st_size, 'sha256': sha(path)}


def binding(args):
    if not re.fullmatch(r'v\d+\.\d+\.\d+', args.tag) or not re.fullmatch(r'[0-9a-f]{40}', args.commit):
        raise Failure('Require exact version tag and source commit')
    if not str(args.run).isdigit() or not str(args.attempt).isdigit():
        raise Failure('Require current workflow run and attempt')
    return {'repository': args.repo, 'tag': args.tag, 'sourceCommit': args.commit,
            'runId': str(args.run), 'runAttempt': str(args.attempt)}



def same_binding(actual, expected):
    """A failed-job retry may reuse a successful producer from this run, with identical immutable inputs."""
    return (all(actual.get(k) == expected[k] for k in ('repository', 'tag', 'sourceCommit', 'runId'))
            and str(actual.get('runAttempt', '')).isdigit()
            and 1 <= int(actual['runAttempt']) <= int(expected['runAttempt']))

def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + '\n', encoding='utf-8')


def get_release(repo, tag):
    try:
        return api(repo, 'releases/tags/' + tag)
    except Failure as error:
        if '(HTTP 404)' in str(error):
            return None
        raise


def prepare(args):
    version = args.tag.removeprefix('v')
    toc = Path('addon/LoreForever/LoreForever.toc').read_text()
    actual = re.search(r'^## Version: *([^\r\n]+)', toc, re.M)
    if not actual or actual[1] != version:
        raise Failure('Tag does not match the .toc version')
    binding(args)
    release = get_release(args.repo, args.tag)
    if release is None:
        run('release', 'create', args.tag, '-R', args.repo, '--verify-tag', '--draft',
            '--title', 'Lore Forever ' + version, '--notes', 'Release preparation in progress.')
        release = get_release(args.repo, args.tag)
    published = not release['draft']
    if release.get('prerelease'):
        raise Failure('Version tag points to a prerelease')
    message = subprocess.run(['git', 'for-each-ref', 'refs/tags/' + args.tag, '--format=%(contents)'],
                             capture_output=True, text=True, check=True).stdout
    hashes = re.findall(r'^zip-sha256: *([^\r\n]*)$', message, re.M)
    if any(not re.fullmatch('[0-9a-f]{64}', h) for h in hashes):
        raise Failure('Invalid QA ZIP binding in tag')
    if len(hashes) > 1:
        raise Failure('Duplicate QA ZIP binding in tag')
    outputs = {'version': version, 'source_commit': args.commit, 'published': str(published).lower(),
               'zip_sha256': hashes[0] if hashes else ''}
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as stream:
            for key, value in outputs.items():
                stream.write(f'{key}={value}\n')
    print(json.dumps(outputs))


def linux_manifest(args):
    bound = binding(args)
    version = args.tag.removeprefix('v')
    downloads = read(args.extras / CONTROLS[0])
    candidate = row(args.core, 'LoreForever.zip')
    if (downloads.get('releaseVersion'), downloads.get('sourceCommit'), downloads.get('candidateZipSha256')) != (
            version, args.commit, candidate['sha256']):
        raise Failure('Installer downloads differ from this tag/source/QA ZIP')
    archives = []
    for line in (args.extras / 'manifest.tsv').read_text().splitlines():
        fields = line.split('\t')
        if len(fields) != 3 or fields[2] != version or not name(fields[0]).endswith('.zip'):
            raise Failure('Invalid release extras inventory')
        archives.append(fields[0])
    if 'LoreForever.zip' in archives or len(set(archives)) != len(archives):
        raise Failure('Duplicate release archive')
    if set(archives) != {p.name for p in args.extras.glob('*.zip')}:
        raise Failure('Release extras inventory differs from the built archives')
    files = {'LoreForever.zip': args.core, **{n: args.extras / n for n in archives},
             'transport-downloads.json': args.extras / CONTROLS[0]}
    selected = selected_archives(downloads)
    inputs = [candidate | {'name': 'LoreForever.zip'}]
    for n in sorted(set(CONTROLS) | selected.keys()):
        info = row(args.extras / n)
        if n in selected and info['sha256'] != selected[n]:
            raise Failure('Selected installer archive differs: ' + n)
        inputs.append(info | {'name': 'extra/' + n})
    projects = [p for p in cv.load_config() if p.get('id') and not cv.language_project(p)]
    fingerprints = cv.source_fingerprints(projects, files, version)
    proof = {'version': 1, 'producer': 'linux', 'binding': bound, 'assets': [row(p, n) for n, p in sorted(files.items())],
             'installerInputs': inputs, 'candidateZipSha256': candidate['sha256'], 'curseforge': fingerprints,
             'smokeSelections': {s: s == 'base' or bool(downloads['selections'][s]) for s in SELECTIONS}}
    write(args.output, proof)
    print(json.dumps({'releaseFiles': len(files), 'releaseBytes': sum(p.stat().st_size for p in files.values()),
                      'windowsFiles': len(inputs), 'windowsBytes': sum(r['bytes'] for r in inputs)}))


def check_row(actual, expected):
    if (actual.get('state'), actual.get('size'), actual.get('digest')) != (
            'uploaded', expected['bytes'], 'sha256:' + expected['sha256']):
        raise Failure('Remote size/SHA256 differs: ' + expected['name'])


def assets(release):
    result = {a['name']: a for a in release['assets']}
    if len(result) != len(release['assets']):
        raise Failure('Duplicate remote assets')
    return result


def locate(roots, expected):
    matches = [p for root in roots for p in ([root] if root.is_file() else root.rglob(expected['name']))
               if p.is_file() and p.name == expected['name']]
    if not matches:
        raise Failure('Missing local asset: ' + expected['name'])
    for path in matches:
        if row(path) != expected:
            raise Failure('Local size/SHA256 differs: ' + expected['name'])
    return matches[0]


def upload(repo, tag, path, expected, published=False):
    release = get_release(repo, tag)
    if release is None or (not release['draft'] and not published):
        raise Failure('Producer uploads require an unpublished draft')
    current = assets(release).get(expected['name'])
    if current and (current.get('state'), current.get('size'), current.get('digest')) == (
            'uploaded', expected['bytes'], 'sha256:' + expected['sha256']):
        print('reused ' + expected['name'] + ' ' + str(expected['bytes']) + ' bytes', flush=True)
        return 0
    for attempt in range(3):
        try:
            run('release', 'upload', tag, '-R', repo, path, '--clobber')
            check_row(assets(get_release(repo, tag))[expected['name']], expected)
            print('uploaded ' + expected['name'] + ' ' + str(expected['bytes']) + ' bytes', flush=True)
            return expected['bytes']
        except Failure:
            if attempt == 2:
                raise
            time.sleep(2)
    return 0


def stage(args):
    proof = read(args.manifest)
    if proof['binding'] != binding(args):
        raise Failure('Producer proof belongs to another source/run')
    transferred = sum(upload(args.repo, args.tag, locate(args.root, r), r) for r in proof['assets'])
    print(json.dumps({'producer': proof['producer'], 'completedUploadBytes': transferred}))


def bundle(args):
    proof = read(args.manifest)
    if proof['binding'] != binding(args) or args.output.exists():
        raise Failure('Bundle binding differs or destination already exists')
    args.output.mkdir(parents=True)
    for expected in proof['installerInputs']:
        relative = expected['name']
        local = expected | {'name': relative.split('/')[-1]}
        source = locate(args.root, local)
        target = args.output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            os.link(source, target)
        except OSError:
            shutil.copyfile(source, target)
    write(args.output / 'inputs.json', {'version': 1, 'binding': proof['binding'], 'files': proof['installerInputs'],
                                       'candidateZipSha256': proof['candidateZipSha256']})


def verify_inputs(folder, bound):
    contract = read(folder / 'inputs.json')
    if contract.get('version') != 1 or not same_binding(contract['binding'], bound):
        raise Failure('Installer inputs belong to another tag/source/run attempt')
    expected = contract['files']
    names = [r['name'] for r in expected]
    if len(set(names)) != len(names) or set(names) != {str(p.relative_to(folder)).replace('\\', '/')
            for p in folder.rglob('*') if p.is_file() and p != folder / 'inputs.json'}:
        raise Failure('Installer input file set differs')
    for r in expected:
        if not re.fullmatch(r'(extra/)?[A-Za-z0-9_.-]+', r['name']) or '..' in r['name']:
            raise Failure('Unsafe installer input path')
        path = folder / r['name']
        if row(path, r['name'].split('/')[-1]) != (r | {'name': r['name'].split('/')[-1]}):
            raise Failure('Installer input digest differs: ' + r['name'])
    return contract


def extract_artifact(repo, artifact_id, output):
    if output.exists():
        raise Failure('Artifact destination already exists')
    with tempfile.TemporaryDirectory() as tmp:
        archive = Path(tmp) / 'artifact.zip'
        with archive.open('wb') as stream:
            run('api', f'repos/{repo}/actions/artifacts/{artifact_id}/zip', binary=stream)
        with zipfile.ZipFile(archive) as z:
            seen = set()
            for item in z.infolist():
                parts = item.filename.rstrip('/').split('/')
                if (not parts or any(not re.fullmatch(r'[A-Za-z0-9_.-]+', part) or '..' in part for part in parts)
                        or item.filename in seen or (item.external_attr >> 16) & 0o170000 == 0o120000):
                    raise Failure('Unsafe or duplicate artifact path')
                seen.add(item.filename)
            z.extractall(output)


def legacy_receive(args):
    bound = binding(args)
    artifacts = api(args.repo, f'actions/runs/{args.run}/artifacts?per_page=100')['artifacts']
    for producer in ('linux', 'installer'):
        proof = read(latest_proof(args.proofs, producer, bound))
        artifact_name = producer + '-payload-' + proof['binding']['runAttempt']
        choices = [a for a in artifacts if a['name'] == artifact_name and not a['expired']]
        if len(choices) != 1:
            raise Failure('Missing or duplicate legacy payload artifact: ' + artifact_name)
        extract_artifact(args.repo, choices[0]['id'], args.output / producer)


def receive(args):
    if args.timeout <= 0 or args.interval <= 0:
        raise Failure('Receive timeout and interval must be positive')
    bound, deadline = binding(args), time.monotonic() + args.timeout
    while True:
        response = api(args.repo, f'actions/runs/{args.run}/artifacts?per_page=100')
        snapshot = api(args.repo, f'actions/runs/{args.run}/attempts/{args.attempt}/jobs?per_page=100')
        producer = next((j for j in snapshot['jobs'] if j['name'] == 'zip'), None)
        # If Linux is rerunning, wait for its new inputs. Installer-only retries reuse the successful earlier producer.
        candidates = [a for a in response['artifacts'] if not a['expired']
                      and re.fullmatch(r'installer-inputs-[0-9]+', a['name'])
                      and int(a['name'].rsplit('-', 1)[1]) <= int(args.attempt)]
        target = int(args.attempt) if producer else max(
            (int(a['name'].rsplit('-', 1)[1]) for a in candidates), default=0)
        found = [a for a in candidates if a['name'] == 'installer-inputs-' + str(target)]
        if len(found) > 1:
            raise Failure('Duplicate installer artifact')
        if found:
            extract_artifact(args.repo, found[0]['id'], args.output)
            contract = verify_inputs(args.output, bound)
            print(json.dumps({'downloadedFiles': len(contract['files']), 'downloadedBytes': sum(r['bytes'] for r in contract['files'])}))
            return
        if time.monotonic() >= deadline:
            raise Failure('Timed out waiting for current-attempt installer inputs')
        if producer and producer['status'] == 'completed' and producer['conclusion'] != 'success':
            raise Failure('Linux producer failed before installer inputs were available')
        time.sleep(args.interval)


def installer_manifest(args):
    bound = binding(args)
    inputs = verify_inputs(args.inputs, bound)
    proof = {'version': 1, 'producer': 'installer', 'binding': bound, 'assets': [row(args.setup)],
             'candidateZipSha256': inputs['candidateZipSha256'], 'installerInputs': inputs['files'],
             'signature': read(args.signature), 'smoke': read(args.smoke)}
    write(args.output, proof)


def combined(linux, installer, bound, signed):
    if linux.get('version') != 1 or installer.get('version') != 1 or linux['producer'] != 'linux' or installer['producer'] != 'installer':
        raise Failure('Invalid producer proof')
    if not same_binding(linux['binding'], bound) or not same_binding(installer['binding'], bound):
        raise Failure('Proof source/run bindings differ')
    if linux['candidateZipSha256'] != installer['candidateZipSha256'] or linux['installerInputs'] != installer['installerInputs']:
        raise Failure('Installer did not use the exact Linux inputs')
    sig = installer['signature']
    if sig.get('required') is not signed or (signed and (sig.get('status') != 'Valid' or not sig.get('thumbprint'))):
        raise Failure('Required installer signature evidence is missing')
    expected = {s: 'passed' if available else 'unavailable' for s, available in linux['smokeSelections'].items()}
    if installer['smoke'] != expected or expected.get('base') != 'passed':
        raise Failure('Installer smoke evidence is incomplete')
    rows = linux['assets'] + installer['assets']
    names = [name(r['name']) for r in rows]
    if len(set(names)) != len(names) or not {'LoreForever.zip', 'LoreForever-Setup.exe', 'transport-downloads.json'} <= set(names):
        raise Failure('Required assets are missing or duplicated')
    if [r['name'] for r in installer['assets']] != ['LoreForever-Setup.exe']:
        raise Failure('Installer producer asset set differs')
    if next(r['sha256'] for r in rows if r['name'] == 'LoreForever.zip') != linux['candidateZipSha256']:
        raise Failure('Candidate ZIP binding differs')
    for r in rows:
        if type(r['bytes']) is not int or r['bytes'] <= 0 or not re.fullmatch('[0-9a-f]{64}', r['sha256']):
            raise Failure('Invalid asset digest/size')
    return {'version': 1, 'binding': bound, 'assets': rows, 'candidateZipSha256': linux['candidateZipSha256'],
            'signature': sig, 'smoke': installer['smoke'], 'curseforge': linux['curseforge']}



def latest_proof(folder, producer, bound):
    choices = []
    for path in folder.rglob(producer + '-proof.json'):
        value = read(path)
        if same_binding(value.get('binding', {}), bound):
            choices.append((int(value['binding']['runAttempt']), path))
    if not choices:
        raise Failure('Missing current-run ' + producer + ' proof')
    newest = max(n for n, _ in choices)
    matches = [path for n, path in choices if n == newest]
    if len(matches) != 1:
        raise Failure('Duplicate producer proof')
    return matches[0]

def finalize(args):
    bound = binding(args)
    if args.proofs:
        args.linux = latest_proof(args.proofs, 'linux', bound)
        args.installer = latest_proof(args.proofs, 'installer', bound)
    if not args.linux or not args.installer:
        raise Failure('Require both producer proofs')
    proof = combined(read(args.linux), read(args.installer), bound, args.signed)
    release = get_release(args.repo, args.tag)
    if release is None:
        raise Failure('Final promotion requires the prepared release')
    if not release['draft'] and not args.legacy:
        # A publication response can be lost after promotion. A final-job retry only verifies it;
        # a new workflow run must use the explicit published-tag rebuild path.
        remote = assets(release)
        manifest_asset = remote.get('release-manifest.json', {})
        body = run('release', 'download', args.tag, '-R', args.repo, '-p', 'release-manifest.json', '-O', '-')
        existing = json.loads(body)
        if not same_binding(existing.get('binding', {}), bound) or (
                existing | {'binding': bound}) != proof:
            raise Failure('Published release belongs to a different run or producer outputs')
        check_row(manifest_asset, {'name': 'release-manifest.json', 'bytes': len(body.encode()),
                                  'sha256': hashlib.sha256(body.encode()).hexdigest()})
        rows = proof['assets'] + [{'name': 'release-manifest.json', 'bytes': manifest_asset['size'],
                                  'sha256': manifest_asset['digest'].removeprefix('sha256:')}]
        sums = ''.join(r['sha256'] + '  ' + r['name'] + '\n' for r in sorted(rows, key=lambda r: r['name']))
        rows.append({'name': 'SHA256SUMS.txt', 'bytes': len(sums.encode()),
                     'sha256': hashlib.sha256(sums.encode()).hexdigest()})
        if set(remote) != {r['name'] for r in rows}:
            raise Failure('Published asset inventory differs')
        for r in rows:
            check_row(remote[r['name']], r)
        print(json.dumps({'verifiedAssets': len(rows), 'finalJobPayloadDownloadBytes': 0,
                          'alreadyPublishedByThisRun': True}))
        return
    if args.legacy:
        # Only an already-public tag rebuild takes the previous full-artifact path.
        # Validate every local output before replacing any public asset.
        paths = [locate(args.root, r) for r in proof['assets']]
        for path, r in zip(paths, proof['assets']):
            upload(args.repo, args.tag, path, r, published=True)
    remote = assets(get_release(args.repo, args.tag))
    for r in proof['assets']:
        if r['name'] not in remote:
            raise Failure('Missing staged asset: ' + r['name'])
        check_row(remote[r['name']], r)
    args.output.mkdir(parents=True, exist_ok=True)
    manifest = args.output / 'release-manifest.json'
    write(manifest, proof)
    all_rows = proof['assets'] + [row(manifest)]
    sums = args.output / 'SHA256SUMS.txt'
    sums.write_text(''.join(r['sha256'] + '  ' + r['name'] + '\n' for r in sorted(all_rows, key=lambda r: r['name'])))
    for path in (manifest, sums):
        upload(args.repo, args.tag, path, row(path), published=args.legacy)
    all_rows.append(row(sums))
    remote = assets(get_release(args.repo, args.tag))
    if set(remote) != {r['name'] for r in all_rows}:
        raise Failure('Staged asset set differs from complete expected inventory')
    for r in all_rows:
        check_row(remote[r['name']], r)
    if not args.legacy:
        # A rebuild only replaces already-public assets; preserve its notes/title and the newer Latest release.
        if args.notes is None:
            generated = json.loads(run('api', f'repos/{args.repo}/releases/generate-notes',
                                       '--method', 'POST', '-f', 'tag_name=' + args.tag))
            args.notes = args.output / 'notes.md'
            args.notes.write_text(generated['body'], encoding='utf-8')
        notes = ['--notes-file', str(args.notes)]
        run('release', 'edit', args.tag, '-R', args.repo, '--draft=false', '--latest',
            '--title', 'Lore Forever ' + args.tag.removeprefix('v'), *notes)
    print(json.dumps({'verifiedAssets': len(all_rows), 'finalJobPayloadDownloadBytes':
                     sum(r['bytes'] for r in proof['assets']) if args.legacy else 0, 'legacyPublishedTagRebuild': args.legacy}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', default=os.environ.get('GH_REPO'))
    parser.add_argument('--tag', default=os.environ.get('TAG'))
    parser.add_argument('--commit', required=True)
    parser.add_argument('--run', default=os.environ.get('GITHUB_RUN_ID'))
    parser.add_argument('--attempt', default=os.environ.get('GITHUB_RUN_ATTEMPT'))
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('prepare')
    linux = sub.add_parser('linux-manifest')
    linux.add_argument('--core', type=Path, required=True)
    linux.add_argument('--extras', type=Path, required=True)
    linux.add_argument('--output', type=Path, required=True)
    for command in ('bundle', 'stage'):
        p = sub.add_parser(command)
        p.add_argument('--manifest', type=Path, required=True)
        p.add_argument('--root', type=Path, action='append', required=True)
        if command == 'bundle': p.add_argument('--output', type=Path, required=True)
    p = sub.add_parser('receive')
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--timeout', type=float, default=1800)
    p.add_argument('--interval', type=float, default=10)
    p = sub.add_parser('installer-manifest')
    for key in ('inputs', 'setup', 'signature', 'smoke', 'output'):
        p.add_argument('--' + key, type=Path, required=True)
    p = sub.add_parser('legacy-receive')
    p.add_argument('--proofs', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p = sub.add_parser('finalize')
    for key in ('linux', 'installer', 'proofs'):
        p.add_argument('--' + key, type=Path)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--root', type=Path, action='append', default=[])
    p.add_argument('--notes', type=Path)
    p.add_argument('--signed', action='store_true')
    p.add_argument('--legacy', action='store_true')
    args = parser.parse_args()
    try:
        if not args.repo or not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', args.repo):
            raise Failure('Require a repository')
        {'prepare': prepare, 'linux-manifest': linux_manifest, 'bundle': bundle, 'stage': stage,
         'receive': receive, 'legacy-receive': legacy_receive, 'installer-manifest': installer_manifest, 'finalize': finalize}[args.command](args)
    except (Failure, OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile) as error:
        parser.exit(1, 'release-staging: ' + str(error) + '\n')


if __name__ == '__main__':
    main()
