// /audio/clip/<voice>/<stem>-<sha>.<ext>: one narration recording, from R2 (the STUDIO bucket, narration/<same
// path>; uploaded by scripts/upload-narration-r2.sh, see site/LORE_PAGES.md). The address names the recording's
// content (sha = the first 10 hex of its SHA-256), so it never changes and browsers may keep it for a year. Range
// requests get a 206 (Safari won't play audio without them). A recording this deployment's bucket lacks: anywhere but
// loreforeverwow.com (a preview, whose Preview bucket holds no narration, or `wrangler pages dev`) is sent to the same
// address there; loreforeverwow.com itself says 404. The rest of /audio/ is static files.

import { AUDIO_KEY, HOME, R2_PREFIX } from "../../../../lib/lore.js";

const text = (status, body, headers = {}) => new Response(body, {
  status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...headers },
});

// "bytes=a-b" -> {offset, length}, "bytes=a-" -> {offset}, "bytes=-n" -> {suffix}; null for no (or an unusable)
// Range header, which gets the whole file. Only one range: a browser asking for several gets the whole file too.
export function parseRange(header) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || "").trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") return Number(m[2]) > 0 ? { suffix: Number(m[2]) } : null;
  const offset = Number(m[1]);
  if (m[2] === "") return { offset };
  const end = Number(m[2]);
  return end >= offset ? { offset, length: end - offset + 1 } : null;
}

export async function onRequest({ request, env, params }) {
  if (request.method !== "GET" && request.method !== "HEAD") return text(405, "Use GET.\n", { Allow: "GET, HEAD" });
  const key = `${params.voice}/${params.file}`;
  if (!AUDIO_KEY.test(key)) return text(404, "Not found.\n");
  const sha = key.slice(key.lastIndexOf("-") + 1, key.lastIndexOf("."));
  const headers = {
    "Content-Type": key.endsWith(".ogg") ? "audio/ogg" : "audio/mpeg",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Accept-Ranges": "bytes",
    ETag: `"${sha}"`,
  };
  if ((request.headers.get("If-None-Match") || "").includes(`"${sha}"`)) return new Response(null, { status: 304, headers });

  const bucket = env.STUDIO;
  const range = request.method === "GET" ? parseRange(request.headers.get("Range")) : null;
  let obj = null;
  try {
    obj = bucket ? await (request.method === "HEAD" ? bucket.head(R2_PREFIX + key)
      : bucket.get(R2_PREFIX + key, range ? { range } : undefined)) : null;
  } catch (e) {
    if (!range) throw e;
    // R2 refuses a range past the end of the file.
    const whole = await bucket.head(R2_PREFIX + key);
    if (whole) return text(416, "Range not satisfiable.\n", { "Content-Range": `bytes */${whole.size}` });
  }
  if (!obj) {
    if (new URL(request.url).hostname !== HOME) return Response.redirect(`https://${HOME}/audio/clip/${key}`, 302);
    return text(404, "Not found.\n");
  }
  const size = obj.size;
  if (request.method === "HEAD") return new Response(null, { headers: { ...headers, "Content-Length": String(size) } });
  if (!range) return new Response(obj.body, { headers: { ...headers, "Content-Length": String(size) } });
  const start = range.suffix != null ? Math.max(0, size - range.suffix) : range.offset;
  const end = range.length != null ? Math.min(size, start + range.length) - 1 : size - 1;
  if (start >= size) return text(416, "Range not satisfiable.\n", { "Content-Range": `bytes */${size}` });
  return new Response(obj.body, {
    status: 206,
    headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
  });
}
