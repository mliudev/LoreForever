"""Transport v1 receipts and release checks. Standard library only; safe in the public build."""
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
from pathlib import Path, PurePosixPath

RATES = ('1', '1.25', '1.33', '1.5', '1.75', '2')
LIMIT = 480 * 1000**2
FRAME_SECONDS = 1152 / 44100   # one transport MP3 frame
# Pause and resume (LOR-346): a recording with cut points (Transport.json "cuts", from `lore.transport cuts`) ships as
# pieces split inside its sentence pauses (pause_split), which the add-on plays back to back, so pausing keeps the
# listener's place. The pieces are the recording's own bytes, so nothing is re-encoded and no audio is added.
# Complete stories split as they are. Answers, quest dialogue and overviews longer than MIN_SPLIT_SECONDS use the bit
# reservoir (a frame's data can start in the frames before it), so each later piece opens with a frame or two of
# silence that carries those bytes (bridge); shorter ones play whole and start again from the top.
MIN_SPLIT_SECONDS = 20
KBPS = (0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320)   # MPEG-1 Layer III


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
        if entry.get('chain'):
            lines.append('  chain = true,')
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


def index_fullclips(index_lua):
    """The core's complete-story hashes (ns.DB.fullclips in Data/Index.lua) when they're for English, else {}. English
    packs only play while the add-on shows English, and Lang.lua replaces the table for any other language."""
    if not re.search(r'^\s*fullclipsLocale = "enUS",', index_lua, re.M):
        return {}
    m = re.search(r'^\s*fullclips = \{(.*?)\},$', index_lua, re.M)
    return dict(re.findall(r'\["([^"\\]+)"\]="([0-9a-f]{6})"', m[1])) if m else {}


def whole_replaces_overview(pack, manifest, fullclips):
    """Clip keys whose overview recording (Audio/<stem>.mp3) the add-on never plays, given this pack's validated
    receipt and the core's fullclips that ship with it: the add-on plays the current whole-story recording instead
    (Voice.Transport(key, pack, true), whose checks these are; validate() already tied each row's hash to Clips.lua).
    A row that goes stale after a lore edit isn't listed, so its overview stays in the build. A story split at its
    pauses (chain) counts too: the add-on plays its pieces back to back."""
    if manifest is None or 'sourcePack' in manifest:
        return set()
    out = set()
    for key, entry in manifest['clips'].items():
        text, base = entry.get('text'), entry.get('1')
        if (isinstance(entry.get('fullHash'), str) and entry['fullHash'] == fullclips.get(key)
                and entry.get('assetPack', Path(pack).name) == Path(pack).name
                and isinstance(base, list) and (len(base) == 1 or (entry.get('chain') and base)) and isinstance(base[0], dict)
                and re.fullmatch(r'Audio/[A-Za-z0-9_.\-/]+\.mp3', str(base[0].get('file'))) and '..' not in base[0]['file']
                and isinstance(text, str) and text.strip() and len(text.encode()) <= 65536):
            out.add(key)
    return out


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


def frame_starts(data, name):
    """Byte offsets of a transport MP3's frames: all mono MPEG1/44.1kHz/48kbps, without Xing or ID3 tags."""
    pos, starts = 0, []
    while pos < len(data):
        if pos + 4 > len(data) or data[pos] != 255 or data[pos + 1] != 251 or data[pos + 2] & 252 != 48 or data[pos + 3] >> 6 != 3:
            raise TransportError(f'not an independently playable constant-bitrate transport MP3: {name}')
        size = 144 * 48000 // 44100 + ((data[pos + 2] >> 1) & 1)
        if pos + size > len(data) or data[pos + 21:pos + 25] in (b'Xing', b'Info'):
            raise TransportError(f'truncated/tagged transport MP3: {name}')
        if not starts and not standalone(data, pos):
            raise TransportError(f'segment references an earlier MP3 reservoir: {name}')
        starts.append(pos)
        pos += size
    if not starts:
        raise TransportError(f'empty transport MP3: {name}')
    return starts


def standalone(data, pos):
    """The frame at pos keeps all its audio data (main_data_begin 0), so playback can start there."""
    return not (data[pos + 4] or data[pos + 5] & 128)


def cbr_frames(path):
    """All generated MP3 frames must be mono MPEG1/44.1kHz/48kbps, without Xing or ID3 tags."""
    return len(frame_starts(path.read_bytes(), path.name)) * FRAME_SECONDS


def check_cuts(cuts, frames, name):
    if (not isinstance(cuts, list) or not cuts or len(cuts) > 4095
            or any(isinstance(c, bool) or not isinstance(c, int) for c in cuts)
            or any(b <= a for a, b in zip([0] + cuts, cuts)) or cuts[-1] >= frames):
        raise TransportError(f'invalid cut points: {name}')


def split_points(data, cuts, name):
    """Byte offsets where a story's pieces begin, from its cut points (frame numbers, each a standalone frame inside
    a pause; `lore.transport cuts` picks them)."""
    starts = frame_starts(data, name)
    check_cuts(cuts, len(starts), name)
    for c in cuts:
        if not standalone(data, starts[c]):
            raise TransportError(f'cut point {c} needs an earlier frame: {name}')
    return [0] + [starts[c] for c in cuts]


def stem(key):
    """A clip's recording name, as the add-on derives it (Voice.ClipPath): zone:stormwind#faq3 -> zone_stormwind__faq3."""
    base, sep, part = key.partition('#')
    return re.sub(r'[^\w\-]', '_', base) + (f'__{part}' if sep else '')


def audio_frames(data, name):
    """(offset, size, main_data_begin) of each audio frame of a mono 44.1 kHz MPEG-1 Layer III recording at one
    bitrate, after its ID3v2 tag and Xing/Info tag frame if it has them (an ID3v1 tag at the end is left out).
    main_data_begin: how many bytes before the frame its audio data starts (0 = the frame stands alone)."""
    pos, out, first = 0, [], True
    if data[:3] == b'ID3' and len(data) >= 10:
        pos = 10 + ((data[6] & 127) << 21 | (data[7] & 127) << 14 | (data[8] & 127) << 7 | data[9] & 127)
        pos += 10 if data[5] & 16 else 0
    while pos < len(data):
        if data[pos:pos + 3] == b'TAG' and len(data) - pos == 128:
            break
        if (pos + 21 > len(data) or data[pos] != 255 or data[pos + 1] & 254 != 250 or data[pos + 2] >> 4 in (0, 15)
                or data[pos + 2] & 12 or data[pos + 3] >> 6 != 3 or out and data[pos + 2] >> 4 != data[out[0][0] + 2] >> 4):
            raise TransportError(f'not a constant-bitrate mono 44.1 kHz MP3: {name}')
        size = 144 * KBPS[data[pos + 2] >> 4] * 1000 // 44100 + ((data[pos + 2] >> 1) & 1)
        side = pos + 4 + (0 if data[pos + 1] & 1 else 2)
        if pos + size > len(data):
            raise TransportError(f'truncated MP3: {name}')
        if first and data[side + 17:side + 21] in (b'Xing', b'Info'):
            first, pos = False, pos + size   # the tag frame (no audio)
            continue
        first = False
        out.append((pos, size, data[side] << 1 | data[side + 1] >> 7))
        pos += size
    if not out or out[0][2]:
        raise TransportError(f'no MP3 audio that starts in its first frame: {name}')
    return out


def bridge(data, frames, k):
    """What a piece starting at audio frame k plays first: frame k's audio data starts main_data_begin bytes back, in
    the frames before it (the bit reservoir), so silent frames at its bitrate carry those bytes. b'' when it needs
    none. Each frame is 26 ms; at most four (511 bytes) at 48 kbps."""
    pos, _, need = frames[k]
    if not need:
        return b''
    carried, j = b'', k
    while len(carried) < need:
        j -= 1
        if j < 0:
            raise TransportError('MP3 frame data starts before the recording')
        p, s, _ = frames[j]
        carried = data[p + 21 + (0 if data[p + 1] & 1 else 2):p + s] + carried
    header = bytes((255, 251, data[pos + 2] & 253, data[pos + 3]))   # frame k's, without CRC or padding
    room = 144 * KBPS[data[pos + 2] >> 4] * 1000 // 44100 - 21    # audio data bytes after the side information
    count = -(-need // room)
    start = count * room - need                                   # where the carried bytes begin
    stream = bytes(start) + carried[-need:]
    out = []
    for i in range(count):
        # Its own audio data (none: every granule is empty, so it's silence) begins where the carried bytes do,
        # so a decoder keeps them for frame k.
        back = max(0, i * room - start)
        out.append(header + bytes((back >> 1, (back & 1) << 7)) + bytes(15) + stream[i * room:(i + 1) * room])
    return b''.join(out)


def bridge_split(data, cuts, name):
    """An answer, quest dialogue or overview recording split at its cut points (audio frame numbers inside pauses):
    [(bridge, frames)] per piece, its own frames from that cut to the next after the silent frames that carry what the
    first of them needs (bridge(); the first piece needs none). Tags are left out."""
    frames = audio_frames(data, name)
    check_cuts(cuts, len(frames), name)
    bounds = [0] + cuts + [len(frames)]
    return [(bridge(data, frames, a), data[frames[a][0]:frames[b - 1][0] + frames[b - 1][1]])
            for a, b in zip(bounds, bounds[1:])]


def piece_seconds(data, name):
    """Length of a bridged piece (bridge_split): untagged MP3 frames, the first standing alone."""
    frames = audio_frames(data, name)
    if frames[0][0]:
        raise TransportError(f'tagged transport MP3: {name}')
    return len(frames) * FRAME_SECONDS


def pause_split(pack, stage):
    """A copy of `pack` in `stage` (hard links) where each current complete story with cut points is split at them:
    its whole recording becomes Audio/Transport/<its folder>/partNN.mp3, its row lists the pieces, marked chain with
    the whole file's sha256, and Transport.lua follows. So does each answer, quest dialogue or overview recording with
    cut points (Audio/<stem>.mp3, by its sha256) that has no row of its own: its row (hash: Clips.lua's; no script) lists
    its bridged pieces (bridge_split; each piece's "bridge" bytes come first), chain = the sha256 of its audio frames,
    and the TOC loads Transport.lua. Returns (copy, the clips split, the files left out); with nothing to split, the
    copy is the pack itself. The copy is validated like any pack."""
    pack = Path(pack)
    manifest = validate(pack)
    cuts = (manifest or {}).get('cuts') or {}
    if not manifest or 'sourcePack' in manifest or not cuts:
        return pack, [], set()
    split, replaced, written = [], set(), {}
    listed = (pack / 'Clips.lua').read_text(encoding='utf-8')
    for key, h in ([] if re.search(r'^P\.ext\s*=', listed, re.M) else
                   re.findall(r'^c\["([^"\\]+)"\]\s*=\s*"([0-9a-f]{6})"', listed, re.M)):
        name = f'Audio/{stem(key)}.mp3'
        path = pack / name
        # (smaller than MIN_SPLIT_SECONDS at 32 kbps: never cut, so not worth hashing)
        if key in manifest['clips'] or path.is_symlink() or not path.is_file() or path.stat().st_size < MIN_SPLIT_SECONDS * 4000:
            continue
        data = path.read_bytes()
        whole = hashlib.sha256(data).hexdigest()
        if whole not in cuts:
            continue
        folder = f'Audio/Transport/{stem(key)}-{whole[:10]}'
        pieces, start, audio = [], 0.0, hashlib.sha256()
        for i, (lead, frames) in enumerate(bridge_split(data, cuts[whole], name), 1):
            file = f'{folder}/part{i:02d}.mp3'
            written[file] = lead + frames
            audio.update(frames)
            seconds = piece_seconds(written[file], file)
            pieces.append({'file': file, 'start': round(start, 6), 'duration': seconds,
                           'sha256': hashlib.sha256(written[file]).hexdigest(), **({'bridge': len(lead)} if lead else {})})
            start += seconds
        manifest['clips'][key] = {'hash': h, 'source': {'sha256': whole, 'duration': start}, 'chain': audio.hexdigest(),
                                  '1': pieces}
        replaced.add(name)
        split.append(key)
    for key, entry in sorted(manifest['clips'].items()):
        base = entry.get('1')
        if not (entry.get('fullHash') and len(base) == 1 and base[0]['sha256'] in cuts
                and entry.get('assetPack', pack.name) == pack.name and set(entry) & set(RATES) == {'1'}):
            continue
        whole = base[0]
        data = confined(pack, whole['file']).read_bytes()
        bounds = split_points(data, cuts[whole['sha256']], whole['file'])
        folder = whole['file'].replace('\\', '/').rsplit('/', 1)[0]
        pieces, start = [], 0.0
        for i, (a, b) in enumerate(zip(bounds, bounds[1:] + [len(data)]), 1):
            name = f'{folder}/part{i:02d}.mp3'
            written[name] = data[a:b]
            seconds = len(frame_starts(data[a:b], name)) * FRAME_SECONDS
            pieces.append({'file': name, 'start': round(start, 6), 'duration': seconds,
                           'sha256': hashlib.sha256(data[a:b]).hexdigest()})
            start += seconds
        entry['1'], entry['chain'] = pieces, whole['sha256']
        replaced.add(whole['file'].replace('\\', '/'))
        split.append(key)
    if not split:
        return pack, [], set()
    del manifest['cuts']
    copy = Path(stage) / pack.name
    toc = next(pack.glob('*.toc'))
    loads = toc.read_text(encoding='utf-8-sig')
    own = {'Transport.json', 'Transport.lua'} | ({toc.name} if 'Transport.lua' not in loads.split() else set())
    for p in pack.rglob('*'):
        rel = p.relative_to(pack).as_posix()
        if p.is_file() and rel not in replaced and rel not in written and rel not in own:
            dest = copy / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            try:
                os.link(p, dest)
            except OSError:
                shutil.copyfile(p, dest)
    for name, data in written.items():
        (copy / name).parent.mkdir(parents=True, exist_ok=True)
        (copy / name).write_bytes(data)
    (copy / 'Transport.json').write_text(json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + '\n',
                                         encoding='utf-8')
    (copy / 'Transport.lua').write_text(render(pack.name, manifest), encoding='utf-8')
    if toc.name in own:   # a pack whose rows are all new here (answers, quest dialogue): load them after Clips.lua
        (copy / toc.name).write_text(loads.rstrip('\n') + '\nTransport.lua\n', encoding='utf-8')
    validate(copy)
    return copy, split, replaced


def split_note(manifest, split):
    """What pause_split did, for build output: '3 of 5 complete stories and 40 other recordings ship in pieces'."""
    full = sum(1 for e in manifest['clips'].values() if e.get('fullHash'))
    stories = sum(1 for k in split if manifest['clips'][k].get('fullHash'))
    return (f'{stories} of {full} complete stories and ' if full else '') + (
        f'{len(split) - stories} other recordings ship in pieces for pause and resume')


def pause_split_coverage(manifest):
    """(complete stories in the pack, how many have cut points), for build output."""
    if not manifest:
        return 0, 0
    cuts = manifest.get('cuts') or {}
    full = [e for e in manifest['clips'].values() if e.get('fullHash')]
    return len(full), sum(1 for e in full if e.get('chain') or (len(e['1']) == 1 and e['1'][0]['sha256'] in cuts))


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
        # A receipt with only cut points (a pack of answers or quest dialogue in the repo) has nothing for the game to load.
        cuts_only = not manifest['clips'] and not manifest.get('retired') and not lua.exists() and not transport_dir.exists()
        if not cuts_only and (loaded.count('Transport.lua') != 1 or (source_pack == pack and (
                'Clips.lua' not in loaded or loaded.index('Clips.lua') > loaded.index('Transport.lua')))):
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
            # An answer, quest dialogue or overview in pieces (pause_split): Clips.lua's hash binds it, as it does the
            # recording it replaces, so it carries no script.
            split = entry.get('chain') is not None and not entry.get('fullHash')
            text = entry.get('text')
            if not (split and text is None):
                if not isinstance(text, str) or not text or any(ord(c) < 32 and c not in '\n\t\r' for c in text):
                    raise TransportError(f'{key}: invalid script')
                expected = entry.get('fullHash', entry['hash'])
                if not re.fullmatch('[0-9a-f]{6}', expected) or text_hash(text) != expected:
                    raise TransportError(f'{key}: stale script hash')
            source = entry['source']
            if not entry.get('fullHash') and not split and not source.get('file'):
                raise TransportError(f'{key}: legacy transport must retain its source recording binding')
            if split and source.get('file'):
                raise TransportError(f'{key}: pieces replace their recording')
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
                    bridge = seg.get('bridge', 0)
                    if split:
                        data = file.read_bytes()
                        frames = audio_frames(data, file.name)
                        if bridge and (index == 0 or isinstance(bridge, bool) or not isinstance(bridge, int)
                                       or bridge not in {p for p, _, _ in frames[1:5]}):
                            raise TransportError(f'{key}: invalid bridge: {file.name}')
                        frame_seconds = piece_seconds(data, file.name)
                    elif bridge:
                        raise TransportError(f'{key}: only answers, quest dialogue and overviews have bridges')
                    else:
                        frame_seconds = cbr_frames(file)
                    if abs(frame_seconds - seconds) > .03:
                        raise TransportError(f'{key}: frame duration does not match receipt')
                    if probe and abs(duration(file) - seconds) > .01:
                        raise TransportError(f'{key}: wrong probed duration')
            if entry.get('chain') is not None:
                # Pieces of one recording, split at its pauses (pause_split): together, without their bridges, they're
                # a complete story's file, or another recording's audio frames.
                whole = hashlib.sha256()
                for seg in arrays[0]:
                    whole.update(confined(pack, seg['file']).read_bytes()[seg.get('bridge', 0):])
                if rates != ['1'] or not isinstance(entry['chain'], str) or whole.hexdigest() != entry['chain']:
                    raise TransportError(f'{key}: pieces are not one recording')
        # Cut points by the sha256 of the file they split: a complete story's (checked here) or another recording's
        # (Audio/<stem>.mp3; pause_split checks those). A key no current file has (it was re-recorded) is ignored until
        # `lore.transport cuts` tidies it.
        cuts = manifest.get('cuts', {})
        if not isinstance(cuts, dict) or any(not re.fullmatch('[0-9a-f]{64}', k) for k in cuts):
            raise TransportError('invalid cut points')
        for key, entry in manifest['clips'].items():
            base = entry['1']
            if len(base) == 1 and base[0]['sha256'] in cuts:
                if not entry.get('fullHash'):
                    raise TransportError(f'{key}: only complete stories are split at their pauses')
                split_points(confined(pack, base[0]['file']).read_bytes(), cuts[base[0]['sha256']], key)
        if not cuts_only and lua.read_text(encoding='utf-8') != render(pack.name, manifest):
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
