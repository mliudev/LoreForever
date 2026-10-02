// The translator kits in R2 (lib/kits.js), for `python -m lore.kit site` and `lore.kit upload`. Admin key only
// (lib/auth.js). Takes this path before [action].js beside it.
//   GET /api/translations/kits                         {kits: [{name, sha256, size, uploaded}], linked: {name: sha256}}
//                                                      (linked: what this deployment's languages.json points at)
//   PUT /api/translations/kits?name=deDE&sha256=<hex>  the zip as the body, stored at translate-kits/deDE/<hex>.zip
//                                                      (R2 checks the SHA-256); then uploads of that name beyond the
//                                                      newest KEEP are removed, except the one languages.json links
//                                                      to. {ok, stored (false if it was there), removed: [keys]}
// It writes into this deployment's STUDIO bucket: production's (lore-forever-voices) through loreforeverwow.com.
// Previews read their own bucket (lore-forever-voices-preview) first and send what it lacks to production.

import { authorized } from "../../../lib/auth.js";
import { fail, noStore } from "../../../lib/accounts.js";
import { KEEP, MAX_BYTES, NAME, SHA256, kitKey, linkedKits, listKits } from "../../../lib/kits.js";

const ok = (body = {}) => Response.json({ ok: true, ...body }, { headers: noStore });
const isZip = b => b.byteLength >= 4 && new DataView(b).getUint32(0, true) === 0x04034b50;   // "PK\3\4"

async function list({ request, env }) {
  const kits = (await listKits(env.STUDIO)).map(({ name, sha256, size, uploaded }) => ({ name, sha256, size, uploaded }));
  return ok({ kits, linked: await linkedKits(env, request) });
}

async function put({ request, env }) {
  const q = new URL(request.url).searchParams;
  const name = q.get("name") || "";
  const sha = (q.get("sha256") || "").toLowerCase();
  if (!NAME.test(name) || !SHA256.test(sha)) return fail(400, "Needs ?name=<locale, or new>&sha256=<hex>.");
  if (Number(request.headers.get("Content-Length") || 0) > MAX_BYTES) return fail(413, "That's bigger than any kit.");
  const key = kitKey(name, sha);
  let stored = false;
  if (!(await env.STUDIO.head(key))) {
    const body = await request.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return fail(413, "That's bigger than any kit.");
    if (!isZip(body)) return fail(415, "That isn't a zip.");
    try {
      await env.STUDIO.put(key, body, { sha256: sha, httpMetadata: { contentType: "application/zip" } });
    } catch (e) {
      return fail(400, "The file doesn't match its sha256.");
    }
    stored = true;
  }
  const linked = (await linkedKits(env, request))[name];
  const removed = (await listKits(env.STUDIO, name)).slice(KEEP)
    .filter(k => k.key !== key && k.sha256 !== linked).map(k => k.key);
  if (removed.length) await env.STUDIO.delete(removed);
  return ok({ key, stored, removed });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!(await authorized(request, env))) return fail(401, "Needs the admin key.");
  if (!env.STUDIO) return fail(503, "The STUDIO R2 binding isn't set up here.");
  if (request.method === "GET") return list(context);
  if (request.method === "PUT") return put(context);
  return fail(405, "Use GET or PUT.");
}
