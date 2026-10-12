// CurseForge author-dashboard numbers for /admin (LOR-421, lib/stores.js importAuthorStats): unique downloaders per
// day and week, totals per project and per release. A routine reads them in Mike's browser on authors.curseforge.com
// and posts them here from his /admin tab; no CurseForge credential ever reaches the site.
//   POST /api/admin/curseforge  {"fetched_at": "<ISO time>", "days_back": 90, "queries": {"1": <response>, "2": ...,
//                                "3", "4", "6", "7", "10", "11", "12"}}   each response as the dashboard's
//                                /_api/statistics-new/queries/<n> answered it ({"id", "queryResult": {"data", "legend"}});
//                                q6 and q7 for the add-on alone (project_ids 1715510)
//                               -> {"ok": true, "values": N, "queries": [...], "first": day, "last": day}
//                               Idempotent: the same numbers again change nothing, so each run can resend 90 days.
//   GET  /api/admin/curseforge  -> {"ok": true, "values", "first", "last", "updated", "projects"}: what's stored
// Same key as /api/admin ("Authorization: Bearer <key>"), and a browser must send it from our own pages (Origin).

import { authorized } from "../../../lib/auth.js";
import { sameOrigin } from "../../../lib/accounts.js";
import { importAuthorStats, authorSummary } from "../../../lib/stores.js";

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
const json = (body, status = 200) => Response.json(body, { status, headers: NO_STORE });
const MAX_BYTES = 8 * 1024 * 1024;

async function allowed(request, env) {
  if (request.headers.get("Origin") && !sameOrigin(request)) return json({ ok: false, error: "Send it from /admin." }, 403);
  if (!(await authorized(request, env))) return json({ ok: false, error: "Needs the admin key." }, 401);
  if (!env.DB) return json({ ok: false, error: "No D1 database bound as DB" }, 503);
  return null;
}

export async function onRequestPost({ request, env }) {
  const refused = await allowed(request, env);
  if (refused) return refused;
  if (Number(request.headers.get("Content-Length") || 0) > MAX_BYTES) return json({ ok: false, error: "Too big." }, 413);
  let body;
  try {
    const text = await request.text();
    if (text.length > MAX_BYTES) return json({ ok: false, error: "Too big." }, 413);
    body = JSON.parse(text);
  } catch (e) {
    return json({ ok: false, error: "Expected JSON." }, 400);
  }
  try {
    return json({ ok: true, ...(await importAuthorStats(env, body)) });
  } catch (e) {
    if (e instanceof RangeError) return json({ ok: false, error: e.message }, 400);
    throw e;
  }
}

export async function onRequestGet({ request, env }) {
  const refused = await allowed(request, env);
  return refused || json({ ok: true, ...(await authorSummary(env)) });
}
