// The lore pages in other languages (LOR-809, pipeline/lore/site_i18n.py): one JSON object per page in the STUDIO
// bucket under lore-i18n/<seg>/<type>/<id>.json, plus lore-i18n/index.json (the languages, and which pages each has) and
// lore-i18n/recordings.json (the recordings each language's pages play, for scripts/narration-watch.sh), and each
// language's lore-i18n/<seg>/narration.json (what the /lore list plays in it: functions/[lang]/lore/narration.json.js).
// site_i18n.py upload (scripts/site-lore-i18n.sh) fills it through this API: the changed pages, then the index and the
// recordings list, then deletes what's gone. functions/[lang]/lore/ serves them. Under /api/admin/, so Cloudflare Access covers it (scripts
// send the service token, pipeline/lore/cf_access.py, which opens it like ADMIN_KEY does): FEEDBACK_KEY, the routines' key,
// could otherwise delete every translated page (the Software Architect and DevOps, 10/24; /api/admin/narration too).
//   GET    /api/admin/lore-i18n[?cursor=]                 admin: {objects: {key: sha256}, cursor}, 1,000 at a time
//   GET    /api/admin/lore-i18n?key=index.json            admin: the index itself (site_i18n.py audit reads built_from)
//   GET    /api/admin/lore-i18n?key=recordings.json       admin: the recordings list (scripts/narration-watch.sh)
//   PUT    /api/admin/lore-i18n?key=<k>&sha256=<hex>      admin: one page (or index.json, recordings.json, a narration
//                                                   list) as the body, JSON, at most 512 KB (the lists 16 MB); R2 checks
//                                                   the sha256. {ok, key}
//   DELETE /api/admin/lore-i18n?key=<k>                   admin: removes one. {ok, key}
import { adminOrService } from "../../../lib/auth.js";
import { fail, noStore } from "../../../lib/accounts.js";
import { I18N_PREFIX, I18N_KEY } from "../../../lib/lore.js";

const MAX_BYTES = 512 * 1024;
// recordings.json: about 33,000 keys, 1.5 MB, on 10/26; a language's narration.json: about 400 KB for German.
const MAX_LIST_BYTES = 16 * 1024 * 1024;
const isList = key => key === "recordings.json" || key.endsWith("/narration.json");
const WHOLE = ["index.json", "recordings.json"];   // the files beside the pages, read back whole
const SHA256 = /^[0-9a-f]{64}$/;
const ok = (body = {}) => Response.json({ ok: true, ...body }, { headers: noStore });

export async function onRequest({ request, env }) {
  // A verified Access service token (the scripts), or ADMIN_KEY: never FEEDBACK_KEY (lib/auth.js adminOrService).
  const gate = await adminOrService(request, env);
  if (!gate.ok) return fail(gate.status, gate.error);
  if (!env.STUDIO) return fail(503, "The STUDIO R2 binding isn't set up here.");
  const q = new URL(request.url).searchParams;
  if (request.method === "GET" && WHOLE.includes(q.get("key"))) {
    const obj = await env.STUDIO.get(I18N_PREFIX + q.get("key"));
    return obj ? new Response(obj.body, { headers: { "Content-Type": "application/json; charset=utf-8", ...noStore } })
      : fail(404, `No ${q.get("key")} yet.`);
  }
  if (request.method === "GET") {
    const page = await env.STUDIO.list({ prefix: I18N_PREFIX, cursor: q.get("cursor") || undefined, limit: 1000,
      include: ["customMetadata"] });
    const objects = {};
    for (const o of page.objects) objects[o.key.slice(I18N_PREFIX.length)] = o.customMetadata?.sha256 || "";
    return ok({ objects, cursor: page.truncated ? page.cursor : null });
  }
  const key = q.get("key") || "";
  if (!I18N_KEY.test(key)) return fail(400, "Needs ?key=<lang>/<type>/<id>.json, <lang>/narration.json, index.json or recordings.json.");
  if (request.method === "DELETE") {
    await env.STUDIO.delete(I18N_PREFIX + key);
    return ok({ key });
  }
  if (request.method !== "PUT") return fail(405, "Use GET, PUT or DELETE.");
  const sha = (q.get("sha256") || "").toLowerCase();
  if (!SHA256.test(sha)) return fail(400, "Needs &sha256=<hex>.");
  const body = await request.arrayBuffer();
  if (body.byteLength > (isList(key) ? MAX_LIST_BYTES : MAX_BYTES)) return fail(413, "That's too big.");
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
