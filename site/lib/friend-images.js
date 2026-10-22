// Private screenshots (LOR-713). R2 is the existing STUDIO binding, but none of its public routes serve this prefix.
// A confirmation uploads and sends in one operation. Receipts survive unsend/removal, so a retry cannot redeliver.
import { FriendError, needFriend, asMessage, MESSAGE_KEEP_DAYS, friendImageKey } from "./friends.js";

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_MAX_EDGE = 4096;
export const IMAGE_MAX_PIXELS = 12 * 1024 * 1024;
export const IMAGE_BODY_MAX = IMAGE_MAX_BYTES + 64 * 1024;
const NONCE = /^[A-Za-z0-9_-]{16,80}$/;
const invalid = () => new FriendError(400, "Choose a valid JPEG or PNG game screenshot.");
const missing = () => new FriendError(404, "That screenshot isn't available any more.");
const dimensions = (width, height) => {
  if (!width || !height || width > IMAGE_MAX_EDGE || height > IMAGE_MAX_EDGE || width * height > IMAGE_MAX_PIXELS) {
    throw new FriendError(400, "That screenshot is too large. Use an image up to 4096 pixels across and 12 megapixels.");
  }
};
const join = chunks => {
  const out = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
};

// Read with a hard cap even when Content-Length is absent or false. Also used for bounded PNG inflation.
export async function cappedBytes(stream, limit, error = new FriendError(413, "That screenshot is too large. Use a file up to 5 MB.")) {
  if (!stream) throw invalid();
  const reader = stream.getReader(), chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) { await reader.cancel(); throw error; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return join(chunks);
}

// formData() otherwise buffers an unbounded request before the file limit can be checked.
export async function readImageUpload(request) {
  if (!/^multipart\/form-data\s*;/i.test(request.headers.get("Content-Type") || "")) throw invalid();
  if (Number(request.headers.get("Content-Length")) > IMAGE_BODY_MAX) throw new FriendError(413, "That screenshot is too large.");
  const bytes = await cappedBytes(request.body, IMAGE_BODY_MAX);
  let form;
  try { form = await new Response(bytes, { headers: { "Content-Type": request.headers.get("Content-Type") } }).formData(); }
  catch { throw invalid(); }
  if ([...form.keys()].length !== 3 || !["to", "nonce", "image"].every(key => form.getAll(key).length === 1)) throw invalid();
  const to = form.get("to"), nonce = form.get("nonce"), image = form.get("image");
  if (typeof to !== "string" || typeof nonce !== "string" || !NONCE.test(nonce)
      || !image || typeof image.arrayBuffer !== "function") throw invalid();
  if (image.size > IMAGE_MAX_BYTES) throw new FriendError(413, "That screenshot is too large. Use a file up to 5 MB.");
  return { to, nonce, bytes: new Uint8Array(await image.arrayBuffer()) };
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc;
});
function crc32(bytes) {
  let crc = -1;
  for (const b of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ b) & 255];
  return (crc ^ -1) >>> 0;
}

// Only simple, nonanimated PNGs. Keep rendering chunks, discard EXIF/text/profiles and every other ancillary chunk.
// Verify checksums and inflated scanline sizes, bounded by the dimensions, before storing anything.
async function png(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const kept = [bytes.subarray(0, 8)], compressed = [];
  let offset = 8, width, height, channels, depth, palette = false, ended = false, idatEnded = false;
  while (offset + 12 <= bytes.length) {
    const size = view.getUint32(offset), end = offset + 12 + size;
    if (end > bytes.length) throw invalid();
    const name = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (!/^[A-Za-z]{4}$/.test(name) || crc32(bytes.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4)) throw invalid();
    const data = offset + 8;
    if (!width && name !== "IHDR") throw invalid();
    if (compressed.length && name !== "IDAT") idatEnded = true;
    if (name === "IHDR") {
      if (width || size !== 13) throw invalid();
      width = view.getUint32(data); height = view.getUint32(data + 4); depth = bytes[data + 8];
      const color = bytes[data + 9];
      channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 })[color];
      if (!channels || depth !== 8 || bytes[data + 10] !== 0 || bytes[data + 11] !== 0 || bytes[data + 12] !== 0) throw invalid();
      palette = color === 3;
      dimensions(width, height);
    } else if (name === "PLTE") {
      if (compressed.length || !size || size > 768 || size % 3) throw invalid();
      palette = false;
    } else if (name === "tRNS") {
      if (compressed.length || size > 256) throw invalid();
    } else if (name === "IDAT") {
      if (idatEnded || palette) throw invalid();
      compressed.push(bytes.subarray(data, data + size));
    } else if (name === "IEND") {
      if (size || !compressed.length || end !== bytes.length) throw invalid();
      ended = true;
    } else if (!(bytes[offset + 4] & 32)) throw invalid(); // unknown critical chunk
    if (["IHDR", "PLTE", "tRNS", "IDAT", "IEND"].includes(name)) kept.push(bytes.subarray(offset, end));
    offset = end;
    if (ended) break;
  }
  if (!ended) throw invalid();
  const stride = width * channels + 1, expected = stride * height;
  try {
    const inflated = await cappedBytes(new Blob(compressed).stream().pipeThrough(new DecompressionStream("deflate")), expected, invalid());
    if (inflated.length !== expected) throw invalid();
    for (let row = 0; row < height; row++) if (inflated[row * stride] > 4) throw invalid();
  } catch { throw invalid(); }
  return { bytes: join(kept), width, height, type: "image/png" };
}

// JPEG segment lengths and scan boundaries must be complete. Strip all APP and COM segments (EXIF, location,
// thumbnails, profiles, comments); retain only the JPEG coding segments. Accept baseline and progressive Huffman.
function jpeg(bytes) {
  const kept = [bytes.subarray(0, 2)];
  let offset = 2, width, height, scans = 0, quantized = false, huffman = false;
  while (offset < bytes.length) {
    const start = offset;
    if (bytes[offset++] !== 255) throw invalid();
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      if (!width || !scans || offset !== bytes.length) throw invalid();
      kept.push(bytes.subarray(start, offset));
      return { bytes: join(kept), width, height, type: "image/jpeg" };
    }
    if (offset + 2 > bytes.length) throw invalid();
    const size = bytes[offset] * 256 + bytes[offset + 1], end = offset + size;
    if (size < 2 || end > bytes.length) throw invalid();
    const metadata = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
    if (!metadata && ![0xc0, 0xc2, 0xc4, 0xdb, 0xdd, 0xda].includes(marker)) throw invalid();
    if (marker === 0xc0 || marker === 0xc2) {
      if (width || size < 11 || bytes[offset + 2] !== 8) throw invalid();
      height = bytes[offset + 3] * 256 + bytes[offset + 4];
      width = bytes[offset + 5] * 256 + bytes[offset + 6];
      const components = bytes[offset + 7];
      if (![1, 3].includes(components) || size !== 8 + components * 3) throw invalid();
      dimensions(width, height);
    }
    if (marker === 0xdb || marker === 0xc4) {
      let table = offset + 2;
      while (table < end) {
        const kind = bytes[table++];
        if ((kind & 15) > 3 || (kind >> 4) > 1) throw invalid();
        if (marker === 0xdb) table += 64 * ((kind >> 4) + 1);
        else {
          if (table + 16 > end) throw invalid();
          let symbols = 0;
          for (let i = 0; i < 16; i++) symbols += bytes[table++];
          if (!symbols || symbols > 256) throw invalid();
          table += symbols;
        }
      }
      if (table !== end || size <= 2) throw invalid();
      if (marker === 0xdb) quantized = true;
      else huffman = true;
    }
    if (marker === 0xdd && size !== 4) throw invalid();
    if (!metadata) kept.push(bytes.subarray(start, end));
    offset = end;
    if (marker === 0xda) {
      if (!width || !quantized || !huffman || size < 8 || size !== 6 + bytes[end - size + 2] * 2) throw invalid();
      scans++;
      const scan = offset;
      while (offset < bytes.length) {
        if (bytes[offset] !== 255) { offset++; continue; }
        let next = offset + 1;
        while (bytes[next] === 255) next++;
        if (bytes[next] === 0 || (bytes[next] >= 0xd0 && bytes[next] <= 0xd7)) { offset = next + 1; continue; }
        break;
      }
      if (offset === scan) throw invalid();
      kept.push(bytes.subarray(scan, offset));
    }
  }
  throw invalid();
}

export async function cleanScreenshot(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!bytes.length) throw invalid();
  if (bytes.length > IMAGE_MAX_BYTES) throw new FriendError(413, "That screenshot is too large. Use a file up to 5 MB.");
  if (bytes[0] === 255 && bytes[1] === 216) return jpeg(bytes);
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)) return png(bytes);
  throw invalid();
}
const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
  .map(b => b.toString(16).padStart(2, "0")).join("");
const cutoff = now => new Date(now - MESSAGE_KEEP_DAYS * 864e5).toISOString();

export async function sendScreenshot(env, userId, pid, nonce, input, { now = Date.now(), allowSend = async () => {} } = {}) {
  if (!NONCE.test(typeof nonce === "string" ? nonce : "")) throw new FriendError(400, "Choose a new screenshot confirmation.");
  if (!env.STUDIO) throw new FriendError(503, "Screenshot sharing isn't available yet.");
  const other = await needFriend(env, userId, pid);
  const image = await cleanScreenshot(input), digest = await hash(image.bytes);
  const receipt = () => env.DB.prepare("SELECT recipient, digest, message_id FROM friend_image_sends WHERE sender = ? AND nonce = ?")
    .bind(userId, nonce).first();
  const delivered = async record => {
    if (record.recipient !== other || record.digest !== digest) throw new FriendError(409, "That confirmation belongs to a different screenshot or friend.");
    const message = record.message_id && await env.DB.prepare("SELECT * FROM friend_messages WHERE id = ? AND created > ?")
      .bind(record.message_id, cutoff(now)).first();
    if (!message) throw new FriendError(410, "That screenshot has already been removed. Choose a new screenshot to send.");
    await needFriend(env, userId, pid);
    return asMessage(userId, message);
  };
  const previous = await receipt();
  if (previous) return delivered(previous);
  await allowSend();
  const key = await friendImageKey(userId, nonce, other, digest);
  const metadata = { key, width: image.width, height: image.height, type: image.type, bytes: image.bytes.length };
  await env.STUDIO.put(key, image.bytes, { httpMetadata: { contentType: image.type, cacheControl: "private, no-store" } });
  const created = new Date(now).toISOString();
  // D1 batch is one transaction. changes() gates the message on winning the unique receipt insert. The second
  // friendship check is inside that transaction, so a removal during upload cannot resurrect a conversation.
  await env.DB.batch([
    env.DB.prepare("INSERT INTO friend_image_sends (sender, nonce, recipient, digest, created) VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT (sender, nonce) DO NOTHING").bind(userId, nonce, other, digest, created),
    env.DB.prepare("INSERT INTO friend_messages (sender, recipient, body, created, image) SELECT ?, ?, ?, ?, ? WHERE changes() = 1 " +
      "AND EXISTS (SELECT 1 FROM friend_edges WHERE user_id = ? AND other_id = ? AND state = 'friends') " +
      "AND EXISTS (SELECT 1 FROM friend_edges WHERE user_id = ? AND other_id = ? AND state = 'friends')")
      .bind(userId, other, "Shared a screenshot", created, JSON.stringify(metadata), userId, other, other, userId),
    env.DB.prepare("UPDATE friend_image_sends SET message_id = last_insert_rowid() WHERE sender = ? AND nonce = ? " +
      "AND message_id IS NULL AND changes() = 1").bind(userId, nonce),
  ]);
  return delivered(await receipt());
}

export async function screenshotResponse(env, userId, id, now = Date.now()) {
  if (!/^[1-9]\d{0,14}$/.test(String(id || ""))) throw missing();
  const authorized = () => env.DB.prepare("SELECT m.image FROM friend_messages m " +
    "JOIN friend_edges a ON a.user_id = m.sender AND a.other_id = m.recipient AND a.state = 'friends' " +
    "JOIN friend_edges b ON b.user_id = m.recipient AND b.other_id = m.sender AND b.state = 'friends' " +
    "WHERE m.id = ? AND (m.sender = ? OR m.recipient = ?) AND m.created > ? AND m.image IS NOT NULL")
    .bind(Number(id), userId, userId, cutoff(now)).first();
  const row = await authorized();
  if (!row || !env.STUDIO) throw missing();
  const image = JSON.parse(row.image);
  if (!/^friend-images\/[0-9a-f]{64}\/[0-9a-f]{64}$/.test(image.key)) throw missing();
  const object = await env.STUDIO.get(image.key);
  if (!object || object.size !== image.bytes || object.size > IMAGE_MAX_BYTES) throw missing();
  // A block/unsend may finish while R2 is being read. Recheck before making the response body available.
  if (!(await authorized())) { await object.body.cancel(); throw missing(); }
  return new Response(object.body, { headers: { "Content-Type": image.type, "Content-Length": String(image.bytes),
    "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff",
    "Content-Disposition": "inline", "Cross-Origin-Resource-Policy": "same-origin", "Vary": "Cookie, Authorization" } });
}
