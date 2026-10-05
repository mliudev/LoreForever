// Community Forever text, read side (LOR-235, LOR-236). POST /api/contribute itself is functions/api/contribute.js.
//   GET  /api/contribute/stats         public, cached 5 minutes: {lines, verified, accepted, shipped, contributors,
//                                      last_upload, by_kind: {quest, gossip, book, say}}
//   GET  /api/contribute/contributors  public, cached 5 minutes: [{name, lines_accepted, first_found}]
//   GET  /api/contribute/receipt?id=   public: one upload's lines and their statuses (the receipt page's data)
//   GET  /api/contribute/export?since=<unix>&status=accepted   admin key: {now, lines: [{id, kind, ref_id, part,
//                                      locale, build, text, status, accepted, uploaders, found_by, first_seen, ...}]}
//   POST /api/contribute/shipped       admin key: {ids: [...], release: "0.8.0"} -> those lines become shipped
// The admin key is /api/admin's (lib/auth.js), as "Authorization: Bearer <key>" or "X-Admin-Key: <key>".

import { authorized } from "../../../lib/auth.js";
import { noStore, fail, setup as setupAccounts } from "../../../lib/accounts.js";
import { setup, stats, contributors, exportLines, markShipped, receipt, EXPORT_STATUSES, nowSec }
  from "../../../lib/contribute.js";

const cached = body => Response.json(body, { headers: { "Cache-Control": "public, max-age=300" } });

async function ready(env) {
  await setupAccounts(env);
  await setup(env);
}

export async function onRequestGet({ request, env, params }) {
  const url = new URL(request.url);
  if (!env.DB) {
    if (params.action === "stats") {
      return cached({ lines: 0, verified: 0, accepted: 0, shipped: 0, contributors: 0, last_upload: null,
                      by_kind: { quest: 0, gossip: 0, book: 0, say: 0 } });
    }
    if (params.action === "contributors") return cached([]);
    return fail(503, "Sharing text isn't switched on yet.");
  }
  if (params.action === "stats") {
    await ready(env);
    return cached(await stats(env));
  }
  if (params.action === "contributors") {
    await ready(env);
    return cached(await contributors(env));
  }
  if (params.action === "receipt") {
    await ready(env);
    const r = await receipt(env, url.searchParams.get("id") || "");
    if (!r) return fail(404, "No upload with that id.");
    return Response.json({ ok: true, ...r }, { headers: noStore });
  }
  if (params.action === "export") {
    if (!(await authorized(request, env))) return fail(401, "Needs the admin key.");
    await ready(env);
    const status = url.searchParams.get("status") || "accepted";
    if (!EXPORT_STATUSES.includes(status)) return fail(400, `status: one of ${EXPORT_STATUSES.join(", ")}`);
    const since = Math.max(0, parseInt(url.searchParams.get("since") || "0", 10) || 0);
    const limit = Math.min(50000, Math.max(1, parseInt(url.searchParams.get("limit") || "20000", 10) || 20000));
    const now = nowSec();
    return Response.json({ ok: true, now, lines: await exportLines(env, { since, status, limit, now }) },
                         { headers: noStore });
  }
  return fail(404, "Unknown.");
}

export async function onRequestPost({ request, env, params }) {
  if (params.action !== "shipped") return fail(404, "Unknown.");
  if (!(await authorized(request, env))) return fail(401, "Needs the admin key.");
  if (!env.DB) return fail(503, "No D1 database bound as DB");
  let body;
  try { body = await request.json(); } catch (e) { return fail(400, "Expected JSON."); }
  const ids = Array.isArray(body?.ids) ? body.ids.map(Number).filter(n => Number.isInteger(n) && n > 0) : [];
  if (!ids.length || ids.length > 50000) return fail(400, "ids: a list of line ids.");
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,4}$/.test(String(body.release || ""))) return fail(400, "release: like 0.8.0.");
  await ready(env);
  return Response.json({ ok: true, shipped: await markShipped(env, ids, body.release) }, { headers: noStore });
}
