// A store-only zip (no compression: audio doesn't shrink) written as a stream, so a Function can hand back a pack of
// any size while holding one chunk at a time. Used by the test pack (functions/api/studio/[action].js).
//
// An entry is {name, data: Uint8Array} (small text files) or {name, size, crc, open: () => Promise<ReadableStream>}
// (a file streamed from R2). When `crc` is known up front the local header carries it, so the bytes pass straight
// through; when it's null the CRC is worked out on the way (CPU per byte) and written after the data in a data
// descriptor, and onCrc(crc) is called so the caller can keep it for next time. No ZIP64: packs stay far below 4 GB.

import { crc32 } from "../public/voices/crc32.js";

const UTF8 = 0x0800, DESCRIPTOR = 0x0008;

function dosTime(d) {
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
    date: ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

function bytes(n, fill) {
  const b = new Uint8Array(n);
  fill(new DataView(b.buffer));
  return b;
}

const sizeOf = e => (e.data ? e.data.length : e.size);
const deferred = e => !e.data && e.crc == null;

// The exact length of the zip zipStream writes, for Content-Length.
export function zipLength(entries) {
  const enc = new TextEncoder();
  let n = 22;
  for (const e of entries) {
    const name = enc.encode(e.name).length;
    n += 30 + name + sizeOf(e) + (deferred(e) ? 16 : 0) + 46 + name;
  }
  return n;
}

async function* parts(entries, when) {
  const enc = new TextEncoder();
  const { time, date } = dosTime(when);
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const size = sizeOf(e);
    const later = deferred(e);
    const flags = UTF8 | (later ? DESCRIPTOR : 0);
    let crc = e.data ? crc32(e.data) : later ? 0 : e.crc >>> 0;
    const start = offset;
    const head = bytes(30 + name.length, v => {
      v.setUint32(0, 0x04034b50, true);
      v.setUint16(4, 20, true);
      v.setUint16(6, flags, true);
      v.setUint16(8, 0, true);                     // stored
      v.setUint16(10, time, true);
      v.setUint16(12, date, true);
      v.setUint32(14, crc, true);                  // zero when it follows in the descriptor
      v.setUint32(18, later ? 0 : size, true);
      v.setUint32(22, later ? 0 : size, true);
      v.setUint16(26, name.length, true);
    });
    head.set(name, 30);
    yield head;
    offset += head.length;
    if (e.data) {
      yield e.data;
      offset += size;
    } else {
      const reader = (await e.open()).getReader();
      let got = 0, c = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
        if (later) c = crc32(chunk, c);
        got += chunk.length;
        yield chunk;
      }
      if (got !== size) throw new Error(`${e.name}: expected ${size} bytes, got ${got}`);
      offset += got;
      if (later) {
        crc = c;
        yield bytes(16, v => {
          v.setUint32(0, 0x08074b50, true);
          v.setUint32(4, crc, true);
          v.setUint32(8, size, true);
          v.setUint32(12, size, true);
        });
        offset += 16;
        if (e.onCrc) await e.onCrc(crc);
      }
    }
    central.push({ name, crc, size, flags, start });
  }
  const cdStart = offset;
  for (const f of central) {
    const rec = bytes(46 + f.name.length, v => {
      v.setUint32(0, 0x02014b50, true);
      v.setUint16(4, 20, true);                    // made by: MS-DOS / zip 2.0
      v.setUint16(6, 20, true);
      v.setUint16(8, f.flags, true);
      v.setUint16(10, 0, true);
      v.setUint16(12, time, true);
      v.setUint16(14, date, true);
      v.setUint32(16, f.crc, true);
      v.setUint32(20, f.size, true);
      v.setUint32(24, f.size, true);
      v.setUint16(28, f.name.length, true);
      v.setUint32(42, f.start, true);
    });
    rec.set(f.name, 46);
    yield rec;
    offset += rec.length;
  }
  yield bytes(22, v => {
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, central.length, true);
    v.setUint16(10, central.length, true);
    v.setUint32(12, offset - cdStart, true);
    v.setUint32(16, cdStart, true);
  });
}

// The zip as a ReadableStream that only reads the next file when the client wants more.
export function zipStream(entries, when = new Date()) {
  const it = parts(entries, when);
  return new ReadableStream({
    async pull(ctl) {
      try {
        const { value, done } = await it.next();
        if (done) ctl.close();
        else ctl.enqueue(value);
      } catch (err) {
        ctl.error(err);
      }
    },
    async cancel() { await it.return(); },
  });
}
