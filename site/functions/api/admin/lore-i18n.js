// The lore pages in other languages (LOR-809, pipeline/lore/site_i18n.py): one JSON object per page in the STUDIO
// bucket under lore-i18n/<seg>/<type>/<id>.json, plus lore-i18n/index.json (the languages, and which pages each has).
// site_i18n.py upload (scripts/site-lore-i18n.sh) fills it through this API: the changed pages, then the index, then
// deletes what's gone. functions/[lang]/lore/ serves them. Under /api/admin/, so Cloudflare Access covers it (scripts
// send the service token, pipeline/lore/cf_access.py, which opens it like ADMIN_KEY does): FEEDBACK_KEY, the routines' key,
// could otherwise delete every translated page (the Software Architect and DevOps, 10/24; /api/admin/narration too).
//   GET    /api/admin/lore-i18n[?cursor=]                 admin: {objects: {key: sha256}, cursor}, 1,000 at a time
//   GET    /api/admin/lore-i18n?key=index.json            admin: the index itself (site_i18n.py audit reads built_from)
//   PUT    /api/admin/lore-i18n?key=<k>&sha256=<hex>      admin: one page (or index.json) as the body, JSON, at most 512 KB;
//                                                   R2 checks the sha256. {ok, key}
//   DELETE /api/admin/lore-i18n?key=<k>                   admin: removes one. {ok, key}
import { adminOrService } from "../../../lib/auth.js";
import { fail, noStore } from "../../../lib/accounts.js";
import { I18N_PREFIX, I18N_KEY } from "../../../lib/lore.js";

const MAX_BYTES = 512 * 1024;
const SHA256 = /^[0-9a-f]{64}$/;
const ok = (body = {}) => Response.json({ ok: true, ...body }, { headers: noStore });

export async function onRequest({ request, env }) {
  // A verified Access service token (the scripts), or ADMIN_KEY: never FEEDBACK_KEY (lib/auth.js adminOrService).
  const gate = await adminOrService(request, env);
  if (!gate.ok) return fail(gate.status, gate.error);
  if (!env.STUDIO) return fail(503, "The STUDIO R2 binding isn't set up here.");
  const q = new URL(request.url).searchParams;
  if (request.method === "GET" && q.get("key") === "index.json") {
    const obj = await env.STUDIO.get(I18N_PREFIX + "index.json");
    return obj ? new Response(obj.body, { headers: { "Content-Type": "application/json; charset=utf-8", ...noStore } })
      : fail(404, "No index yet.");
  }
  if (request.method === "GET") {
    const page = await env.STUDIO.list({ prefix: I18N_PREFIX, cursor: q.get("cursor") || undefined, limit: 1000,
      include: ["customMetadata"] });
    const objects = {};
    for (const o of page.objects) objects[o.key.slice(I18N_PREFIX.length)] = o.customMetadata?.sha256 || "";
    return ok({ objects, cursor: page.truncated ? page.cursor : null });
  }
  const key = q.get("key") || "";
  if (!I18N_KEY.test(key)) return fail(400, "Needs ?key=<lang>/<type>/<id>.json or index.json.");
  if (request.method === "DELETE") {
    await env.STUDIO.delete(I18N_PREFIX + key);
    return ok({ key });
  }
  if (request.method !== "PUT") return fail(405, "Use GET, PUT or DELETE.");
  const sha = (q.get("sha256") || "").toLowerCase();
  if (!SHA256.test(sha)) return fail(400, "Needs &sha256=<hex>.");
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return fail(413, "That's bigger than any lore page.");
  try {
    JSON.parse(new TextDecoder().decode(body));
  } catch (e) {
    return fail(415, "That isn't JSON.");
  }
  try {
    await env.STUDIO.put(I18N_PREFIX + key, body, { sha256: sha, customMetadata: { sha256: sha },
      httpMetadata: { contentType: "application/json; charset=utf-8" } });
  } catch (e) {
    return fail(400, "The body doesn't match its sha256.");
  }
  return ok({ key });
}
