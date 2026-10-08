"""Transport v1 receipts and release checks. Standard library only; safe in the public build."""
import hashlib
import json
import math
import re
import subprocess
from pathlib import Path, PurePosixPath

RATES = ('1', '1.25', '1.33', '1.5', '1.75', '2')
LIMIT = 480 * 1000**2


class TransportError(ValueError):
    pass


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def text_hash(text):
    return hashlib.sha1(' '.join(text.split()).encode()).hexdigest()[:6]


def lua_string(text):
    # JSON quoting is Lua compatible after Unicode is left intact and JSON's optional escapes are avoided.
    return json.dumps(text, ensure_ascii=False).replace('\\/', '/')


def render(pack_name, manifest):
    source_pack = manifest.get('sourcePack', pack_name)
    lines = [f'local P = LoreForeverPacks.Begin({lua_string(source_pack)})',
             'P.transportVersion = 1', 'P.transport = P.transport or {}' if source_pack != pack_name else 'P.transport = {}']
    for key, entry in sorted(manifest['clips'].items()):
        lines.append(f'P.transport[{lua_string(key)}] = {{')
        for field in ('hash', 'fullHash', 'text', 'assetPack'):
            if field in entry:
                lines.append(f'  {field} = {lua_string(entry[field])},')
        for rate in RATES:
            if rate not in entry:
                continue
            lines.append(f'  [{lua_string(rate)}] = {{')
            for seg in entry[rate]:
                lines.append('    {file = %s, duration = %.9g, start = %.9g},' %
                             (lua_string(seg['file']), seg['duration'], seg['start']))
            lines.append('  },')
        lines.append('}')
    return '\n'.join(lines) + '\n'


def confined(pack, file):
    if not isinstance(file, str) or '\x00' in file:
        raise TransportError('invalid segment path')
    name = file.replace('\\', '/')
    p = PurePosixPath(name)
    if p.is_absolute() or any(c in ('', '.', '..') for c in name.split('/')) or ':' in name:
        raise TransportError(f'unsafe segment path: {file}')
    if len(p.parts) < 3 or p.parts[:2] != ('Audio', 'Transport') or p.suffix != '.mp3':
        raise TransportError(f'not a transport MP3: {file}')
    target = pack.joinpath(*p.parts)
    if not target.resolve().is_relative_to(pack.resolve()) or any(
            parent.is_symlink() for parent in (target, *target.parents) if parent != pack.parent):
        raise TransportError(f'unsafe symlink: {file}')
    return target


def number(n, label, positive=False):
    if isinstance(n, bool) or not isinstance(n, (int, float)) or not math.isfinite(n) or n < 0 or (positive and n == 0):
        raise TransportError(f'invalid {label}: {n!r}')
    return n


def duration(path):
    result = subprocess.run(['ffprobe', '-v', 'error', '-show_entries',
                             'format=duration:stream=codec_name,sample_rate,channels', '-of', 'json', str(path)],
                            capture_output=True, text=True, check=True)
    data = json.loads(result.stdout)
    seconds = number(float(data['format']['duration']), 'audio duration', True)
    if len(data['streams']) != 1 or data['streams'][0]['codec_name'] != 'mp3':
        raise TransportError(f'not one MP3 audio stream: {path}')
    stream = data['streams'][0]
    if int(stream['sample_rate']) not in (44100, 48000) or stream['channels'] != 1:
        raise TransportError(f'unsupported sample rate/channels: {path}')
    return seconds


def effective_size(path):
    """Account for unhydrated original recordings without fetching them."""
    size = path.stat().st_size
    if size <= 1024:
        b = path.read_bytes()
        if b.startswith(b'version https://git-lfs'):
            m = re.search(rb'^size (\d+)$', b, re.M)
            if not m:
                raise TransportError(f'malformed LFS pointer: {path}')
            return int(m[1])
    return size


def pack_bytes(pack):
    return sum(effective_size(p) for p in pack.rglob('*') if p.is_file())


def zip_bound(pack):
    # Stored ZIP members plus central-directory/name overhead; compressed metadata only gets smaller.
    files = [p for p in pack.rglob('*') if p.is_file()]
    return pack_bytes(pack) + 65536 + sum(128 + 2 * len((pack.name + '/' + p.relative_to(pack).as_posix()).encode()) for p in files)


def cbr_frames(path):
    """All generated MP3 frames must be mono MPEG1/44.1kHz/48kbps, without Xing or ID3 tags."""
    data = path.read_bytes()
    pos, frames = 0, 0
    while pos < len(data):
        if pos + 4 > len(data) or data[pos] != 255 or data[pos + 1] != 251 or data[pos + 2] & 252 != 48 or data[pos + 3] >> 6 != 3:
            raise TransportError(f'not an independently playable constant-bitrate transport MP3: {path.name}')
        size = 144 * 48000 // 44100 + ((data[pos + 2] >> 1) & 1)
        if pos + size > len(data) or data[pos + 21:pos + 25] in (b'Xing', b'Info'):
            raise TransportError(f'truncated/tagged transport MP3: {path.name}')
        if frames == 0 and (data[pos + 4] or data[pos + 5] & 128):
            raise TransportError(f'segment references an earlier MP3 reservoir: {path.name}')
        pos += size
        frames += 1
    if not frames:
        raise TransportError(f'empty transport MP3: {path.name}')
    return frames * 1152 / 44100


def validate(pack, *, probe=False, limit=LIMIT, replacing=frozenset(), source_root=None):
    """No-op for legacy packs. Receipts bind runtime metadata to scripts and actual segment bytes."""
    pack = Path(pack)
    receipt, lua = pack / 'Transport.json', pack / 'Transport.lua'
    transport_dir = pack / 'Audio' / 'Transport'
    if not receipt.exists() and not lua.exists() and not transport_dir.exists():
        return None
    try:
        manifest = json.loads(receipt.read_text(encoding='utf-8'))
        if manifest.get('version') != 1 or manifest.get('pack') != pack.name or not isinstance(manifest.get('clips'), dict):
            raise TransportError('unsupported transport receipt')
        tocs = list(pack.glob('*.toc'))
        if len(tocs) != 1:
            raise TransportError('transport requires one TOC')
        loaded = [s.strip() for s in tocs[0].read_text(encoding='utf-8-sig').splitlines() if s.strip() and not s.startswith('#')]
        source_pack = pack
        if 'sourcePack' in manifest:
            name = manifest['sourcePack']
            if not isinstance(name, str) or not re.fullmatch(r'LoreForever_Voice_[A-Za-z0-9_]+', name) or name == pack.name:
                raise TransportError('invalid source pack dependency')
            source_pack = Path(source_root or pack.parent) / name
            if source_pack.is_symlink() or not source_pack.is_dir():
                raise TransportError('missing source pack dependency')
            fields = dict(re.findall(r'^## ([^:]+):\s*(.*)$', tocs[0].read_text(), re.M))
            if name not in [s.strip() for s in fields.get('Dependencies', '').split(',')]:
                raise TransportError('TOC must depend on source pack')
        if loaded.count('Transport.lua') != 1 or (source_pack == pack and ('Clips.lua' not in loaded or loaded.index('Clips.lua') > loaded.index('Transport.lua'))):
            raise TransportError('TOC must load Transport.lua after Clips.lua')
        legacy = dict(re.findall(r'^c\["([^"\\]+)"\]\s*=\s*"([0-9a-f]{6})"',
                                 (source_pack / 'Clips.lua').read_text(encoding='utf-8'), flags=re.M))
        used = set()
        declared = manifest.get('rates')
        actual_rates = [r for r in RATES if any(r in e for e in manifest['clips'].values() if isinstance(e, dict))]
        if declared is not None and declared != actual_rates:
            raise TransportError('declared rates differ from recording arrays')
        for key, entry in manifest['clips'].items():
            if not isinstance(entry, dict) or key not in legacy or (key not in replacing and entry.get('hash') != legacy.get(key)):
                raise TransportError(f'{key}: stale legacy hash')
            if entry.get('assetPack', pack.name) != pack.name or (source_pack != pack and entry.get('assetPack') != pack.name):
                raise TransportError(f'{key}: invalid asset pack')
            text = entry.get('text')
            if not isinstance(text, str) or not text or any(ord(c) < 32 and c not in '\n\t\r' for c in text):
                raise TransportError(f'{key}: invalid script')
            expected = entry.get('fullHash', entry['hash'])
            if not re.fullmatch('[0-9a-f]{6}', expected) or text_hash(text) != expected:
                raise TransportError(f'{key}: stale script hash')
            source = entry['source']
            if not entry.get('fullHash') and not source.get('file'):
                raise TransportError(f'{key}: legacy transport must retain its source recording binding')
            source_seconds = number(source['duration'], 'source duration', True)
            if not re.fullmatch('[0-9a-f]{64}', source['sha256']):
                raise TransportError(f'{key}: missing source provenance')
            if source.get('file') and key not in replacing:
                filename = source['file']
                if not re.fullmatch(r'Audio/[A-Za-z0-9_-]+\.mp3', filename):
                    raise TransportError(f'{key}: unsafe source path')
                original = source_pack / filename
                if original.is_symlink() or not original.resolve().is_relative_to(source_pack.resolve()) or digest(original) != source['sha256']:
                    raise TransportError(f'{key}: source recording changed')
            rates = [r for r in RATES if r in entry]
            if '1' not in rates or any(re.fullmatch(r'[0-9]+(?:\.[0-9]+)?', k) and k not in RATES for k in entry):
                raise TransportError(f'{key}: unsupported or missing normal rate')
            arrays = [entry[r] for r in rates]
            if not arrays[0] or len(arrays[0]) > 4096 or any(len(a) != len(arrays[0]) for a in arrays):
                raise TransportError(f'{key}: rate segment counts differ')
            starts = [number(seg['start'], 'start') for seg in arrays[0]]
            if starts[0] != 0 or any(b <= a for a, b in zip(starts, starts[1:])) or starts[-1] >= source_seconds:
                raise TransportError(f'{key}: invalid boundaries')
            for rate, segments in zip(rates, arrays):
                for index, seg in enumerate(segments):
                    if number(seg['start'], 'start') != starts[index]:
                        raise TransportError(f'{key}: boundaries differ across rates')
                    seconds = number(seg['duration'], 'duration', True)
                    content = (starts[index + 1] if index + 1 < len(starts) else source_seconds) - starts[index]
                    if seconds > 600 or abs(seconds * float(rate) - content) > .75:
                        raise TransportError(f'{key}: inconsistent segment duration')
                    file = confined(pack, seg['file'])
                    if file in used:
                        raise TransportError(f'{key}: duplicate segment file')
                    used.add(file)
                    if digest(file) != seg['sha256']:
                        raise TransportError(f'{key}: segment recording changed: {file.name}')
                    if abs(cbr_frames(file) - seconds) > .03:
                        raise TransportError(f'{key}: frame duration does not match receipt')
                    if probe and abs(duration(file) - seconds) > .01:
                        raise TransportError(f'{key}: wrong probed duration')
        if lua.read_text(encoding='utf-8') != render(pack.name, manifest):
            raise TransportError('Transport.lua differs from its receipt')
        for seg in manifest.get('retired', []):
            file = confined(pack, seg['file'])
            if file in used or digest(file) != seg['sha256']:
                raise TransportError('invalid retired generation receipt')
            cbr_frames(file)
            used.add(file)
        actual = {p for p in transport_dir.rglob('*') if p.is_file()}
        if actual != used:
            raise TransportError('unlisted or missing transport files')
        if zip_bound(pack) > limit:
            raise TransportError(f'pack exceeds {limit / 1000**2:g} MB limit')
        return manifest
    except (OSError, KeyError, TypeError, ValueError, subprocess.CalledProcessError) as e:
        if isinstance(e, TransportError):
            raise
        raise TransportError(f'invalid transport in {pack.name}: {e}') from e
