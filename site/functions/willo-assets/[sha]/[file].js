// /willo-assets/<sha256>/<file>: the one-time downloads Willo makes on a player's PC (voice, ears, lore search), kept
// here so a first run does not depend on GitHub or Hugging Face being up. Files from R2 (the STUDIO bucket, willo-assets/<same
// path>), put there by scripts/mirror-willo-assets.py through /api/admin/willo-assets. The address names the file's
// SHA-256, so it never changes and may be kept for a year; Willo checks the hash itself and falls back to the
// file's original address if this fails (companion/lore_companion/assets.py). Range requests get a 206.
// Licenses and credits: /willo-assets/NOTICE.txt (a static file).

import { parseRange } from "../../audio/clip/[voice]/[file].js";

export const KEY = /^[0-9a-f]{64}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
export const PREFIX = "willo-assets/";

const text = (status, body, headers = {}) => new Response(body, {
  status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...headers },
});

export async function onRequest({ request, env, params }) {
  if (request.method !== "GET" && request.method !== "HEAD") return text(405, "Use GET.\n", { Allow: "GET, HEAD" });
  const key = `${params.sha}/${params.file}`;
  if (!KEY.test(key) || !env.STUDIO) return text(404, "Not found.\n");
  const headers = {
    "Content-Type": "application/octet-stream",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Accept-Ranges": "bytes",
    ETag: `"${params.sha}"`,
    "X-Robots-Tag": "noindex",
  };
  if ((request.headers.get("If-None-Match") || "").includes(`"${params.sha}"`)) return new Response(null, { status: 304, headers });

  const range = request.method === "GET" ? parseRange(request.headers.get("Range")) : null;
  let obj = null;
  try {
    obj = await (request.method === "HEAD" ? env.STUDIO.head(PREFIX + key)
      : env.STUDIO.get(PREFIX + key, range ? { range } : undefined));
  } catch (e) {
    if (!range) throw e;
    const whole = await env.STUDIO.head(PREFIX + key);   // R2 refuses a range past the end of the file
    if (whole) return text(416, "Range not satisfiable.\n", { "Content-Range": `bytes */${whole.size}` });
  }
  if (!obj) return text(404, "Not found.\n");
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
