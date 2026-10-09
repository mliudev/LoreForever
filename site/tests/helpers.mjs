// Test doubles for Pages Functions: D1 on node:sqlite, R2 in memory, ASSETS serving public/, plus a small zip reader.
// Node 22.5+ (node:sqlite).

import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { crc32 } from "../public/voices/crc32.js";

export const SITE = fileURLToPath(new URL("..", import.meta.url));
export const ROOT = fileURLToPath(new URL("../..", import.meta.url));

export function d1() {
  const db = new DatabaseSync(":memory:");
  const plain = r => (r ? { ...r } : null);
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    async first(col) {
      const r = plain(db.prepare(sql).get(...args));
      return r && col ? r[col] : r;
    },
    async all() { return { results: db.prepare(sql).all(...args).map(plain) }; },
    async run() { return { meta: { changes: Number(db.prepare(sql).run(...args).changes) } }; },
  });
  return {
    sqlite: db,
    prepare: sql => stmt(sql),
    async batch(list) { return Promise.all(list.map(s => s.run())); },
  };
}

// R2: put/head/get/delete/list. get() streams the body in small chunks, like R2 does, and takes a `range` option
// ({offset, length} or {suffix}; the body is then that part, size stays the whole object's, and a range past the end
// throws, as R2 does). put() checks a `sha256` option like R2 (throws on a mismatch), and each put is uploaded a
// second after the one before.
export function r2(chunk = 7) {
  const objects = new Map();
  let clock = Date.parse("2026-01-01T00:00:00Z");
  const meta = (key, o) => ({ key, size: o.bytes.length, uploaded: o.uploaded });
  return {
    objects,
    async put(key, body, opts = {}) {
      const bytes = new Uint8Array(body instanceof ArrayBuffer ? body : await new Response(body).arrayBuffer());
      if (opts.sha256 && createHash("sha256").update(bytes).digest("hex") !== opts.sha256) {
        throw new Error("put: The SHA-256 checksum you specified did not match what we received.");
      }
      objects.set(key, { bytes, opts, uploaded: new Date((clock += 1000)) });
    },
    async head(key) {
      const o = objects.get(key);
      return o ? meta(key, o) : null;
    },
    async get(key, opts = {}) {
      const o = objects.get(key);
      if (!o) return null;
      let bytes = o.bytes;
      if (opts.range) {
        const r = opts.range;
        const start = r.suffix != null ? Math.max(0, bytes.length - r.suffix) : r.offset;
        if (start >= bytes.length) throw new Error("get: The requested range is not satisfiable.");
        bytes = bytes.slice(start, r.length != null ? start + r.length : undefined);
      }
      let i = 0;
      return {
        ...meta(key, o),
        range: opts.range,
        body: new ReadableStream({
          pull(ctl) {
            if (i >= bytes.length) return ctl.close();
            ctl.enqueue(bytes.slice(i, i + chunk));
            i += chunk;
          },
        }),
        writeHttpMetadata(h) { if (o.opts.httpMetadata?.contentType) h.set("Content-Type", o.opts.httpMetadata.contentType); },
      };
    },
    async delete(keys) { for (const key of [].concat(keys)) objects.delete(key); },
    async list({ prefix = "", limit = 1000, cursor } = {}) {
      const keys = [...objects.keys()].filter(k => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const page = keys.slice(start, start + limit);
      const truncated = start + limit < keys.length;
      return { objects: page.map(key => meta(key, objects.get(key))), truncated,
               cursor: truncated ? String(start + limit) : undefined };
    },
  };
}

// ASSETS.fetch for the given static files ({path: object}); anything else 404s.
export function assets(files) {
  return { async fetch(url) {
    const p = new URL(url).pathname;
    return p in files ? Response.json(files[p]) : new Response("not found", { status: 404 });
  } };
}

// Entries of a zip, checking each CRC and that the central directory agrees with the local headers.
export function unzip(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();
  let eocd = bytes.length - 22;
  while (eocd >= 0 && v.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("no end of central directory");
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  if (p + v.getUint32(eocd + 12, true) !== eocd) throw new Error("central directory size is off");
  const out = [];
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error("bad central header");
    const flags = v.getUint16(p + 8, true), method = v.getUint16(p + 10, true), crc = v.getUint32(p + 16, true);
    const size = v.getUint32(p + 20, true), nameLen = v.getUint16(p + 28, true), extra = v.getUint16(p + 30, true);
    const comment = v.getUint16(p + 32, true), local = v.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    if (v.getUint32(local, true) !== 0x04034b50) throw new Error(`${name}: bad local header`);
    const localName = dec.decode(bytes.subarray(local + 30, local + 30 + v.getUint16(local + 26, true)));
    if (localName !== name) throw new Error(`${name}: local name ${localName}`);
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    if (method !== 0) throw new Error(`${name}: compressed`);
    if (crc32(data) !== crc) throw new Error(`${name}: CRC mismatch`);
    if (flags & 8) {
      if (v.getUint32(start + size, true) !== 0x08074b50 || v.getUint32(start + size + 4, true) !== crc) {
        throw new Error(`${name}: bad data descriptor`);
      }
    } else if (v.getUint32(local + 14, true) !== crc || v.getUint32(local + 18, true) !== size) {
      throw new Error(`${name}: local header disagrees`);
    }
    out.push({ name, data, descriptor: Boolean(flags & 8) });
    p += 46 + nameLen + extra + comment;
  }
  return out;
}
