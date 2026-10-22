// A player rating one of Willo's answers (LOR-446; the feedback loop, 10/18): 👎 "Not right" under an answer in her
// window, her chat over the game, the answer window over the game or the iPhone, with optional quick reasons and a
// note; or a quiet 👍. A 👎 lands in the review queue (lib/answer-feedback.js) with the question, the answer and where
// they were, and tags the answer's row in the answer log ("reported"); a 👍 only tags it ("liked"), nothing else.
// Corrections said or typed as a next question are caught by /api/companion/answer itself.
//   POST /api/companion/feedback  {"question": "...", "answer": "...", "answer_id"?: the answer's id (its reply's
//                                  answer_id), "good"?: true (👍), "reasons"?: ["wrong_fact", ...] (REASONS),
//                                  "note"?: "what's wrong, in their words", "followup"?: true ("Tell me when it's
//                                  fixed": kept until then, and Willo says once that she's learned it),
//                                  "source"?: "window" | "overgame" | "overlay" | "iphone", "zone"?, "sub"?,
//                                  "spoken"?: true}
//   -> {"ok": true, "line": what Willo says back, in-world}
// Needs the companion's account link (Authorization: Bearer <device token>) and "X-LF-Client: companion/<version>".
// At most FLAGS_PER_DAY 👎 and LIKES_PER_DAY 👍 per account; nothing here costs a live answer.

import { setup, fail, noStore } from "../../../lib/accounts.js";
import { currentDevice } from "../../../lib/devices.js";
import { perDay } from "../../../lib/ratelimit.js";
import { logFeedback, REASONS } from "../../../lib/answer-feedback.js";
import { diagnosticConsent, storageReady, setupDiagnostics } from "../../../lib/diagnostic-screenshots.js";
import { playerKey, tagAnswer } from "../../../lib/answer-log.js";
import { ANSWER_ID } from "../../../lib/answer-signals.js";

const CLIENT = /^companion\/[\w.-]{1,24}$/;
const MAX_BODY_BYTES = 8 * 1024;
export const FLAGS_PER_DAY = 50;
export const LIKES_PER_DAY = 300;
// Her words back: thanks, in the world, never a ticket or a form (Mike's immersion rule).
export const THANKS = "Thanks for telling me. I'll look into that one.";
export const THANKS_FOLLOWUP = "Thanks for telling me. I'll let you know once I've learned it.";

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return fail(503, "Accounts aren't set up yet.");
  if (!CLIENT.test(request.headers.get("X-LF-Client") || "") || request.headers.get("Origin"))
    return fail(403, "This is for the Lore Forever companion app.");
  await setup(env);
  const app = await currentDevice(env, request);
  if (!app) return fail(401, "Connect the companion to your account to send feedback.");
  let body;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return fail(413, "That's too long to send.");
    body = JSON.parse(text);
  } catch { return fail(400, "Couldn't read that feedback."); }
  const str = v => (typeof v === "string" ? v : "");
  const ref = ANSWER_ID.test(str(body.answer_id)) ? body.answer_id : null;
  if (body.good === true) {
    // Quiet: a tag on the kept answer, when there is one, and nothing to say back.
    if (!(await perDay(env, app.user.id, "companion-like", LIKES_PER_DAY))) return Response.json({ ok: true }, { headers: noStore });
    await tagAnswer(env, app.user.id, { ref, tags: ["liked"], question: ref ? null : str(body.question) || null });
    return Response.json({ ok: true }, { headers: noStore });
  }
  if (!str(body.answer).trim()) return fail(400, "Which answer was wrong?");
  if (!(await perDay(env, app.user.id, "companion-flag", FLAGS_PER_DAY))) return fail(429, "Thanks, that's plenty for today.");
  const reasons = [...new Set((Array.isArray(body.reasons) ? body.reasons : []).filter(r => Object.hasOwn(REASONS, r)))];
  const note = str(body.note).trim();
  // An app that sends the answer's id or reasons has the 👎 with reasons ("report"); an older one, Wrong answer ("flag").
  const kind = ref || reasons.length || body.source ? "report" : "flag";
  const said = note || (reasons.length ? reasons.map(r => REASONS[r]).join(", ") : "Wrong answer");
  const followup = kind === "report" && body.followup === true;
  const ok = await logFeedback(env, app.user.id, { kind, said, question: str(body.question), answer: str(body.answer),
    zone: str(body.zone), sub: str(body.sub), persona: "willo", spoken: body.spoken === true, answerRef: ref, reasons,
    source: str(body.source), followup }, { context, client: request.headers.get("X-LF-Client") });
  if (!ok) return fail(503, "Couldn't send that just now.");
  // Mark the report before requesting its image, so the separate upload can verify that report.
  const tagging = tagAnswer(env, app.user.id, { ref, tags: ["reported"], question: ref ? null : str(body.question) || null });
  // With screenshot storage off, as before: the tag goes on after the reply.
  if (!(env.STUDIO && storageReady(env))) {
    if (context.waitUntil) context.waitUntil(tagging); else await tagging;
    return Response.json({ ok: true, line: followup ? THANKS_FOLLOWUP : THANKS }, { headers: noStore });
  }
  await tagging;
  // No screenshot is sent unless the server already holds its exact answer receipt and consent is still on.
  let diagnosticUpload = false;
  try { if (ref && env.STUDIO && storageReady(env) && await diagnosticConsent(env, app.user.id)) {
    await setupDiagnostics(env);
    diagnosticUpload = Boolean(await env.DB.prepare("SELECT ref FROM diagnostic_screenshots WHERE ref=? AND player=? AND state='candidate'")
      .bind(ref, await playerKey(env, app.user.id)).first());
  } } catch { /* Diagnostic failure must never fail a report. */ }
  return Response.json({ ok: true, line: followup ? THANKS_FOLLOWUP : THANKS, ...(diagnosticUpload ? { diagnostic_upload: true } : {}) }, { headers: noStore });
}
