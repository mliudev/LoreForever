// Reads a zip in the browser without extracting anything to disk (LOR-121: uploading a zip on /voices/studio and the
// translation dashboard). It reads the central directory from the end of the file, then inflates one entry at a time
// when asked, so a big zip of recordings never sits in memory all at once. Deflate goes through the browser's own
// DecompressionStream("deflate-raw") (and Node's, for site/tests), so there is no library to ship.
//
//   const zip = await openZip(file, { maxFiles, maxBytes, maxRatio });   // throws ZipError with a message for people
//   for (const e of zip.entries) { ... e.name, e.size ... ; const bytes = await zip.read(e); }
//
// Limits (a zip bomb, or simply the wrong zip): at most maxFiles entries, maxBytes uncompressed in total, and no
// entry that expands more than maxRatio times its compressed size. Each entry is inflated with a hard stop at the size
// the directory declares, and its CRC-32 is checked. Zip64, encryption and methods other than store/deflate are
// refused. Entry names are returned as stored ("folder/file.mp3"); nothing here ever writes a file.

import { crc32 } from "../voices/crc32.js";   // relative, so site/tests can import this under Node

export class ZipError extends Error {}

const SIG_EOCD = 0x06054b50, SIG_CENTRAL = 0x02014b50, SIG_LOCAL = 0x04034b50;

async function bytesOf(blob, start, end) {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

export async function openZip(blob, { maxFiles = 2000, maxBytes = 1024 ** 3, maxRatio = 100 } = {}) {
  // The end-of-central-directory record is in the last 22 bytes plus a comment of up to 64 KB.
  const tailStart = Math.max(0, blob.size - 22 - 65535);
  const tail = await bytesOf(blob, tailStart, blob.size);
  const tv = new DataView(tail.buffer);
  let at = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tv.getUint32(i, true) === SIG_EOCD) { at = i; break; }
  if (at < 0) throw new ZipError("This isn't a zip file we can read. Make a new .zip of the folder and try again.");
  const count = tv.getUint16(at + 10, true), dirSize = tv.getUint32(at + 12, true), dirStart = tv.getUint32(at + 16, true);
  if (count === 0xffff || dirStart === 0xffffffff) throw new ZipError("This zip is too large to read here. Upload the folder in smaller zips.");
  if (count > maxFiles) throw new ZipError(`This zip has ${count} files; we take at most ${maxFiles} at once. Upload it in parts.`);
  if (dirStart + dirSize > blob.size) throw new ZipError("This zip is damaged or incomplete. Make it again and retry.");

  const dir = await bytesOf(blob, dirStart, dirStart + dirSize);
  const dv = new DataView(dir.buffer);
  const utf8 = new TextDecoder("utf-8"), latin = new TextDecoder("latin1");
  const entries = [];
  let p = 0, total = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > dir.length || dv.getUint32(p, true) !== SIG_CENTRAL) throw new ZipError("This zip is damaged. Make it again and retry.");
    const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true), csize = dv.getUint32(p + 20, true), size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const raw = dir.subarray(p + 46, p + 46 + nameLen);
    const name = (flags & 0x800 ? utf8 : (raw.every(b => b < 0x80) ? utf8 : latin)).decode(raw).replace(/\\/g, "/");
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;   // a folder
    if (flags & 1) throw new ZipError(`${name} is encrypted. Make the zip without a password.`);
    if (csize === 0xffffffff || size === 0xffffffff || local === 0xffffffff) throw new ZipError("This zip is too large to read here. Upload it in parts.");
    if (method !== 0 && method !== 8) throw new ZipError(`${name} uses a kind of compression we can't read. Make the zip with your system's own "Compress" or "Send to zip".`);
    if (size > Math.max(csize, 1) * maxRatio && size > 1024 * 1024) {
      throw new ZipError(`${name} expands far more than any recording or text file would. We stopped reading this zip.`);
    }
    total += size;
    if (total > maxBytes) throw new ZipError(`This zip unpacks to more than ${Math.round(maxBytes / 1024 ** 2)} MB. Upload it in parts.`);
    entries.push({ name, size, csize, method, crc, local });
  }
  return { entries, size: total, read: e => readEntry(blob, e) };
}

async function readEntry(blob, e) {
  const head = await bytesOf(blob, e.local, e.local + 30);
  const hv = new DataView(head.buffer);
  if (head.length < 30 || hv.getUint32(0, true) !== SIG_LOCAL) throw new ZipError(`${e.name}: this zip is damaged.`);
  const start = e.local + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
  const packed = blob.slice(start, start + e.csize);
  let out;
  if (e.method === 0) {
    out = new Uint8Array(await packed.arrayBuffer());
  } else {
    // Inflate, stopping as soon as the output passes the declared size.
    out = new Uint8Array(e.size);
    let n = 0;
    const reader = packed.stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (n + value.length > e.size) throw new ZipError(`${e.name} is bigger than the zip says. We stopped reading this zip.`);
        out.set(value, n);
        n += value.length;
      }
    } catch (err) {
      reader.cancel().catch(() => {});
      throw err instanceof ZipError ? err : new ZipError(`${e.name} is damaged in this zip. Make it again and retry.`);
    }
    if (n !== e.size) throw new ZipError(`${e.name} is damaged in this zip. Make it again and retry.`);
  }
  if (out.length !== e.size || crc32(out) !== e.crc) throw new ZipError(`${e.name} is damaged in this zip. Make it again and retry.`);
  return out;
}
