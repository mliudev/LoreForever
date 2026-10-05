// The narration recordings in R2 for the lore pages (lib/lore.js, site/LORE_PAGES.md): the STUDIO bucket, under
// narration/<voice>/<stem>-<sha>.<ext>, plus narration/manifest.json listing them. pipeline/lore/site_lore.py upload
// (scripts/upload-narration-r2.sh) fills it through this API with the admin key (lib/auth.js), like the translator
// kits; the pages play only what the manifest lists.
//   GET  /api/narration/live                         public: {keys: [...]}, the recordings the manifest lists (a
//                                                    preview without its own asks loreforeverwow.com). Cached 5 min.
//   GET  /api/narration/audio                        admin: {keys: [...]}, every recording in the bucket
//   PUT  /api/narration/audio?key=<k>&sha256=<hex>   admin: one recording as the body (MP3 or Ogg Vorbis, at most
//                                                    25 MB; the key's sha must start the file's SHA-256, which R2
//                                                    checks). {ok, key, stored (false if it was there)}
//   POST /api/narration/manifest                     admin: lists the bucket into narration/manifest.json. {ok, files}
// Nothing here deletes: an old recording stays until someone removes it by hand (R2 storage is cheap, and a
// rollback keeps playing).

import { authorized } from "../../../lib/auth.js";
import { fail, noStore } from "../../../lib/accounts.js";
import { sniff } from "../../../lib/studio.js";
import { AUDIO_KEY, MANIFEST_KEY, R2_PREFIX, liveKeys } from "../../../lib/lore.js";

export const MAX_BYTES = 25 * 1024 * 1024;
const SHA256 = /^[0-9a-f]{64}$/;
const ok = (body = {}) => Response.json({ ok: true, ...body }, { headers: noStore });

export async function listAudio(bucket) {
  const out = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix: R2_PREFIX, cursor, limit: 1000 });
    for (const o of page.objects) {
      const k = o.key.slice(R2_PREFIX.length);
      if (AUDIO_KEY.test(k)) out.push(k);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out.sort();
}

async function put(request, env) {
  const q = new URL(request.url).searchParams;
  const key = q.get("key") || "";
  const sha = (q.get("sha256") || "").toLowerCase();
  if (!AUDIO_KEY.test(key) || !SHA256.test(sha)) return fail(400, "Needs ?key=<voice>/<stem>-<sha>.<mp3|ogg>&sha256=<hex>.");
  if (!sha.startsWith(key.slice(key.lastIndexOf("-") + 1, key.lastIndexOf(".")))) {
    return fail(400, "The sha in the key isn't the start of the file's sha256.");
  }
  if (Number(request.headers.get("Content-Length") || 0) > MAX_BYTES) return fail(413, "That's bigger than any narration.");
  if (await env.STUDIO.head(R2_PREFIX + key)) return ok({ key, stored: false });
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return fail(413, "That's bigger than any narration.");
  const kind = sniff(body);
  if (!kind || kind.ext !== key.slice(key.lastIndexOf(".") + 1)) return fail(415, "That isn't an MP3 or Ogg Vorbis file matching its name.");
  try {
    await env.STUDIO.put(R2_PREFIX + key, body, { sha256: sha, httpMetadata: { contentType: kind.type } });
  } catch (e) {
    return fail(400, "The file doesn't match its sha256.");
  }
  return ok({ key, stored: true });
}

export async function onRequest({ request, env, params }) {
  const action = String(params.action || "");
  if (action === "live") {
    if (request.method !== "GET" && request.method !== "HEAD") return fail(405, "Use GET.");
    const keys = [...(await liveKeys(env, request))].sort();
    return Response.json({ keys }, { headers: { "Cache-Control": "public, max-age=300" } });
  }
  if (action !== "audio" && action !== "manifest") return fail(404, "Not found.");
  if (!(await authorized(request, env))) return fail(401, "Needs the admin key.");
  if (!env.STUDIO) return fail(503, "The STUDIO R2 binding isn't set up here.");
  if (action === "audio" && request.method === "GET") return ok({ keys: await listAudio(env.STUDIO) });
  if (action === "audio" && request.method === "PUT") return put(request, env);
  if (action === "manifest" && request.method === "POST") {
    const keys = await listAudio(env.STUDIO);
    await env.STUDIO.put(MANIFEST_KEY, JSON.stringify({ updated: new Date().toISOString(), keys }),
      { httpMetadata: { contentType: "application/json" } });
    return ok({ files: keys.length });
  }
  return fail(405, action === "audio" ? "Use GET or PUT." : "Use POST.");
}
