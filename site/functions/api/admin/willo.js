// Willo's answers for /admin (LOR-446): what players said was wrong or were frustrated by (lib/answer-feedback.js),
// and the Forever facts every answer draws on (lib/forever-knowledge.js).
//   GET  /api/admin/willo  -> {"ok": true, "feedback": {counts, rows, zones}, "facts": [...]}
//   GET  /api/admin/willo?answers=1&since=<ISO>&after=<id>&limit=<1-1000>  -> {"ok": true, "answers": {...}}
//        every answer kept for the last 14 days (lib/answer-log.js answerLogReport), oldest first; `next` pages on
//   POST /api/admin/willo  {"action": "feedback-status", "id": 3, "status": "checked" | "dismissed" | "new",
//                           "note"?}   note: why (the nightly review says what it found)
//                          {"action": "fact-add", "title", "text", "zone"?, "source_title"?, "source_url"?,
//                           "feedback_id"?, "feedback_ids"?, "origin"?}   a checked fact; with feedback_id(s) those
//                           signals are marked "fact". origin: "mike" (default, /admin), "research" (the nightly
//                           review found sources) or "players" (2+ independent players said the same)
//                          {"action": "fact-remove", "id": "<fact id>"}   out of answers (kept as the record)
//                          {"action": "friend-report-done", "id": 3}   a friend report looked at (lib/friends.js)
// The GET also has friendReports: reports on players in Willo's friends, not looked at yet (lib/friends.js openReports).
// The nightly review (scheduled task "nightly-willo-feedback") uses the same calls as /admin.
// Same key as /api/admin ("Authorization: Bearer <key>"), and a browser must send it from our own pages (Origin).

import { authorized } from "../../../lib/auth.js";
import { sameOrigin } from "../../../lib/accounts.js";
import { feedbackReport, setFeedbackStatus } from "../../../lib/answer-feedback.js";
import { answerLogReport } from "../../../lib/answer-log.js";
import { addFact, removeFact, listFacts } from "../../../lib/forever-knowledge.js";
import { openReports, closeReport } from "../../../lib/friends.js";

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
const json = (body, status = 200) => Response.json(body, { status, headers: NO_STORE });

async function refused(request, env) {
  if (request.headers.get("Origin") && !sameOrigin(request)) return json({ ok: false, error: "Send it from /admin." }, 403);
  if (!(await authorized(request, env))) return json({ ok: false, error: "Needs the admin key." }, 401);
  if (!env.DB) return json({ ok: false, error: "No D1 database bound as DB" }, 503);
  return null;
}

export async function onRequestGet({ request, env }) {
  const no = await refused(request, env);
  if (no) return no;
  const q = new URL(request.url).searchParams;
  if (q.get("answers")) {
    return json({ ok: true, answers: await answerLogReport(env, { since: q.get("since"), after: q.get("after"),
      limit: q.get("limit") }) });
  }
  const [feedback, facts, friendReports] = await Promise.all([feedbackReport(env), listFacts(env), openReports(env)]);
  return json({ ok: true, feedback, facts, friendReports });
}

export async function onRequestPost({ request, env }) {
  const no = await refused(request, env);
  if (no) return no;
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Expected JSON." }, 400); }
  const id = Number.parseInt(body.id, 10);
  if (body.action === "feedback-status" && ["new", "checked", "dismissed"].includes(body.status)) {
    return json({ ok: await setFeedbackStatus(env, id, body.status, { note: body.note }) });
  }
  if (body.action === "friend-report-done") return json({ ok: await closeReport(env, id) });
  if (body.action === "fact-add") {
    const origin = ["mike", "research", "players"].includes(body.origin) ? body.origin : "mike";
    const factId = await addFact(env, body, origin);
    if (!factId) return json({ ok: false, error: "A fact needs a title and its text." }, 400);
    const signals = [body.feedback_id, ...(Array.isArray(body.feedback_ids) ? body.feedback_ids : [])]
      .map(v => Number.parseInt(v, 10)).filter(v => v > 0).slice(0, 50);
    for (const signal of signals) await setFeedbackStatus(env, signal, "fact", { factId });
    return json({ ok: true, id: factId });
  }
  if (body.action === "fact-remove") return json({ ok: await removeFact(env, body.id) });
  return json({ ok: false, error: "Unknown action." }, 400);
}
