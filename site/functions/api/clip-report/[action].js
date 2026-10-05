// Clip reports (LOR-232) besides sending one (that's functions/api/clip-report.js). See site/CLIP_REPORT_API.md.
//   GET  /api/clip-report/counts[?clips=a,b][&voice=X][&by=voice]  public: open reports per clip, never their text.
//                                  {ok, counts: {"zone:stormwind": 2}} (by=voice: {"zone:stormwind": {"<voice>": 2}})
//   GET  /api/clip-report/export[?status=open|all|done|kept|rejected][&since=<id>]   admin key: every field
//   POST /api/clip-report/resolve  {ids: [...], status: "done" | "kept" | "open"}    admin key (lore.clipreports done)
//   POST /api/clip-report/reject   {uploader, restore?: true}   admin key: spam; restore brings them back (/admin)
// The admin key is the one /api/admin takes (lib/auth.js: Authorization: Bearer <ADMIN_KEY or FEEDBACK_KEY>).

import { authorized } from "../../../lib/auth.js";
import { noStore } from "../../../lib/accounts.js";
import { openCounts, exportReports, resolveReports, rejectUploader, fail, STATUSES } from "../../../lib/clipreports.js";
import { CLIP_ID, normalizeVoice } from "../../../public/clip-report-code.js";

const ADMIN = { ...noStore, "X-Robots-Tag": "noindex" };

async function counts(request, env) {
  if (!env.DB) return Response.json({ ok: true, counts: {} });
  const url = new URL(request.url);
  // ?clips=a,b or ?clip=a,b; an id may carry its @hash (counts are per clip, whatever the take).
  const clips = [...new Set((url.searchParams.get("clips") || url.searchParams.get("clip") || "").split(",")
    .map(s => s.trim().split("@")[0]).filter(s => CLIP_ID.test(s)))].slice(0, 90);
  const v = url.searchParams.get("voice");
  const voice = v ? normalizeVoice(v) : null;
  if (v && !voice) return fail(400, "No such voice.");
  const out = await openCounts(env, { clips, voice, byVoice: url.searchParams.get("by") === "voice" });
  return Response.json({ ok: true, counts: out }, { headers: { "Cache-Control": "public, max-age=300" } });
}

export async function onRequest({ request, env, params }) {
  const action = params.action;
  if (action === "counts") {
    return request.method === "GET" ? counts(request, env) : fail(405, "Use GET.");
  }
  if (!["export", "resolve", "reject"].includes(action)) return fail(404, "No such action.");
  if (!(await authorized(request, env))) return Response.json({ ok: false, error: "Needs the admin key." }, { status: 401, headers: ADMIN });
  if (!env.DB) return Response.json({ ok: false, error: "No D1 database bound as DB" }, { status: 503, headers: ADMIN });

  if (action === "export") {
    if (request.method !== "GET") return fail(405, "Use GET.");
    const url = new URL(request.url);
    const status = url.searchParams.get("status") || "open";
    if (status !== "all" && !STATUSES.includes(status)) return fail(400, "status: open, done, kept, rejected or all.");
    const since = Number.parseInt(url.searchParams.get("since") || "0", 10) || 0;
    const reports = await exportReports(env, { status, since });
    return Response.json({ ok: true, reports }, { headers: ADMIN });
  }
  if (request.method !== "POST") return fail(405, "Use POST.");
  let body;
  try { body = await request.json(); } catch (e) { return fail(400, "Expected JSON."); }
  if (action === "resolve") {
    if (!["done", "kept", "open"].includes(body.status)) return fail(400, "status: done, kept or open.");
    const changed = await resolveReports(env, body.ids, body.status);
    return Response.json({ ok: true, changed }, { headers: ADMIN });
  }
  const changed = await rejectUploader(env, body.uploader, body.restore === true);
  return Response.json({ ok: true, changed }, { headers: ADMIN });
}
