// Willo's answers for /admin (LOR-446): what players said was wrong or were frustrated by (lib/answer-feedback.js),
// and the Forever facts every answer draws on (lib/forever-knowledge.js).
//   GET  /api/admin/willo  -> {"ok": true, "feedback": {counts, rows, zones}, "facts": [...]}
//   GET  /api/admin/willo?answers=1&since=<ISO>&after=<id>&limit=<1-1000>  -> {"ok": true, "answers": {...}}
//        every answer kept for the last 14 days (lib/answer-log.js answerLogReport), oldest first; `next` pages on
//   GET  /api/admin/willo?queue=1&status=open|new|triaged|fixed|all&since=<ISO>&after=<id>&limit=<1-500>
//        -> {"ok": true, "queue": {status, rows, next}}   the review queue (lib/answer-feedback.js queueReport), oldest
//        first, each row with its answer log row (log) when kept: what the accuracy loop reads each night
//   GET  /api/admin/willo?quality=1&days=<1-14>  -> {"ok": true, "quality": {...}}   Willo quality (lib/willo-quality.js):
//        report and frustration rates, top asked and failing topics, the queue's counts, the apps' failure counts
//   POST /api/admin/willo  {"action": "feedback-status", "id": 3, "status": "checked" | "dismissed" | "new",
//                           "note"?}   note: why (the nightly review says what it found)
//                          {"action": "fact-add", "title", "text", "zone"?, "source_title"?, "source_url"?,
//                           "feedback_id"?, "feedback_ids"?, "origin"?}   a checked fact; with feedback_id(s) those
//                           signals are marked "fact". origin: "mike" (default, /admin), "research" (the nightly
//                           review found sources) or "players" (2+ independent players said the same)
//                          {"action": "fact-remove", "id": "<fact id>"}   out of answers (kept as the record)
//                          {"action": "queue-triage", "ids": [3, 4], "class": "missing_fact" | "retrieval" | "model" |
//                           "voice" | "ux" | "not_a_miss", "note"?, "fact_id"?, "gold_id"?}   the accuracy loop's
//                           verdict: rows go "triaged" with what the miss was and what it drafted -> {ok, changed}
//                          {"action": "queue-fixed", "ids": [3], "how": "fact" | "lore" | "prompt" | "code" | "voice",
//                           "ref"?: "fact id or PR #", "note"?}   a fix landed: rows go "fixed", and a player who asked
//                           to hear hears it once, in-world, at their next answer -> {ok, changed}
//                          {"action": "feedback-rehash", "dry_run"?}   rows from before 10/18 keyed by the salted
//                           player key and scrubbed of names (lib/answer-feedback.js rehashFeedback): counts only
//                          {"action": "friend-report-done", "id": 3}   a friend report looked at (lib/friends.js)
//                          {"action": "answer-log-rescrub", "dry_run"?}   the kept answers scrubbed of names again
//                           (lib/answer-log.js rescrubAnswerLog): counts and the changed row ids, never their text
// The GET also has friendReports: reports on players in Willo's friends, not looked at yet (lib/friends.js openReports).
// The nightly review (scheduled task "nightly-willo-feedback") uses the same calls as /admin.
// Same key as /api/admin ("Authorization: Bearer <key>"), and a browser must send it from our own pages (Origin).

import { authorized } from "../../../lib/auth.js";
import { sameOrigin } from "../../../lib/accounts.js";
import { feedbackReport, setFeedbackStatus, queueReport, triageFeedback, markFixed, rehashFeedback }
  from "../../../lib/answer-feedback.js";
import { qualityReport } from "../../../lib/willo-quality.js";
import { answerLogReport, rescrubAnswerLog } from "../../../lib/answer-log.js";
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
  if (q.get("queue")) {
    return json({ ok: true, queue: await queueReport(env, { status: q.get("status") || "open", since: q.get("since"),
      after: q.get("after"), limit: q.get("limit") }) });
  }
  if (q.get("quality")) return json({ ok: true, quality: await qualityReport(env, { days: q.get("days") }) });
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
  const many = [...(Array.isArray(body.ids) ? body.ids : []), ...(body.id !== undefined ? [body.id] : [])];
  if (body.action === "queue-triage") {
    const changed = await triageFeedback(env, many, { cls: body.class, note: body.note, factId: body.fact_id,
      goldId: body.gold_id });
    return changed ? json({ ok: true, changed }) : json({ ok: false, error: "Needs ids and a known class." }, 400);
  }
  if (body.action === "queue-fixed") {
    const changed = await markFixed(env, many, { how: body.how, ref: body.ref, note: body.note });
    return changed ? json({ ok: true, changed }) : json({ ok: false, error: "Needs ids and how it was fixed." }, 400);
  }
  if (body.action === "feedback-rehash") return json({ ok: true, ...await rehashFeedback(env, { dryRun: body.dry_run === true }) });
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
  if (body.action === "answer-log-rescrub") return json({ ok: true, ...await rescrubAnswerLog(env, { dryRun: body.dry_run === true }) });
  return json({ ok: false, error: "Unknown action." }, 400);
}
