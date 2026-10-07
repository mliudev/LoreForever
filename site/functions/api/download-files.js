// Public release-file metadata, shared at the edge rather than calling GitHub from every visitor's browser.
// GET /api/download-files -> { latestTag, byTag: { latest: { filename: bytes }, "<tag>": { filename: bytes } } }
import { downloadFiles } from "../../lib/download-files.js";

const TTL = 300; // two GitHub calls per five minutes, per edge location
const UNAVAILABLE = { error: "Download file details are temporarily unavailable." };
const noStore = { "Cache-Control": "no-store" };

async function save(cache, key, response, waitUntil) {
  if (!cache) return;
  const put = cache.put(key, response.clone()).catch(() => {});
  if (waitUntil) waitUntil(put); else await put;
}

export async function onRequestGet({ request, env, waitUntil }) {
  const cache = globalThis.caches?.default;
  // Queries and incoming credentials do not alter this public metadata or its upstream URL.
  const key = new Request(new URL("/api/download-files", request.url).toString());
  const cooldownKey = new Request(new URL("/api/download-files?internal=cooldown", request.url).toString());
  const hit = cache && await cache.match(key).catch(() => null);
  if (hit) return hit;
  const held = cache && await cache.match(cooldownKey).catch(() => null);
  if (held) {
    try {
      const { status, body } = await held.json();
      if (status === 200 || status === 503) return Response.json(body, { status, headers: noStore });
    } catch (e) {}
  }

  let result, status = 200;
  try { result = await downloadFiles(env); }
  catch (e) {
    result = { data: UNAVAILABLE, complete: false, retryAfter: e.retryAfter || 60 };
    status = 503;
  }
  const res = Response.json(result.data,
    { status, headers: { "Cache-Control": result.complete ? `public, max-age=${TTL}` : "no-store" } });
  if (result.complete) await save(cache, key, res, waitUntil);
  else {
    // Cache a separate 200 envelope internally: outward failures and partial answers always remain no-store.
    // This contains only the current result, never metadata from an older complete response or secrets.
    const seconds = Number.isFinite(result.retryAfter) ? Math.min(3600, Math.max(60, Math.ceil(result.retryAfter))) : 60;
    const envelope = Response.json({ status, body: result.data },
      { headers: { "Cache-Control": `public, max-age=${seconds}` } });
    await save(cache, cooldownKey, envelope, waitUntil);
  }
  return res;
}
