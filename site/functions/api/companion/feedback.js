// A player flagging one of Willo's answers as wrong (LOR-446): the Wrong answer button in the companion's chat, or
// "that's wrong" said out loud. It comes back to us in /admin (lib/answer-feedback.js) with the question, the answer
// and where they were; corrections and frustration typed as a next question are caught by /api/companion/answer itself.
//   POST /api/companion/feedback  {"question": "...", "answer": "...", "note"?: "what's wrong, in their words",
//                                  "zone"?, "sub"?, "spoken"?: true}   -> {"ok": true}
// Needs the companion's account link (Authorization: Bearer <device token>) and "X-LF-Client: companion/<version>".
// At most FLAGS_PER_DAY per account; nothing here costs a live answer.

import { setup, fail, noStore } from "../../../lib/accounts.js";
import { currentDevice } from "../../../lib/devices.js";
import { perDay } from "../../../lib/ratelimit.js";
import { logFeedback } from "../../../lib/answer-feedback.js";

const CLIENT = /^companion\/[\w.-]{1,24}$/;
const MAX_BODY_BYTES = 8 * 1024;
export const FLAGS_PER_DAY = 50;

export async function onRequestPost({ request, env }) {
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
  if (!str(body.answer).trim()) return fail(400, "Which answer was wrong?");
  if (!(await perDay(env, app.user.id, "companion-flag", FLAGS_PER_DAY))) return fail(429, "Thanks, that's plenty for today.");
  const ok = await logFeedback(env, app.user.id, { kind: "flag", said: str(body.note).trim() || "Wrong answer",
    question: str(body.question), answer: str(body.answer), zone: str(body.zone), sub: str(body.sub), persona: "willo",
    spoken: body.spoken === true });
  return ok ? Response.json({ ok: true }, { headers: noStore }) : fail(503, "Couldn't send that just now.");
}
