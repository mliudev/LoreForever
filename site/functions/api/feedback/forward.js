// Feedback from outside the site, handed over by the feedback forwarder Worker (workers/feedback, LOR-641) for Slack
// #player-feedback: mail to hello@, new Discord posts, and YouTube and CurseForge comments. The site formats, masks and
// rate-limits it like its own feedback (lib/slack-feedback.js), so the Slack webhook and its privacy rules live in one
// place.
//   POST /api/feedback/forward  {"source": "email" | "discord" | "youtube" | "curseforge", "items": [{...}, ...]}
//                               -> {"ok": true, "queued": n}
// The items go out after the answer (waitUntil), one after another in their order. `queued` is 0 while
// SLACK_FEEDBACK_WEBHOOK isn't set. Each item is posted once, ever (its source's key), so a poll may send the same
// ones again. No items: a burst's waiting digest goes out (the Worker's schedule calls it every few minutes).
// Pages secret: FEEDBACK_FORWARD_KEY, the same value as the Worker's. Without it the endpoint answers 404.

import { hasBearer } from "../../../lib/auth.js";
import { EXTERNAL, forwardAll, forwarding, flushDigest } from "../../../lib/slack-feedback.js";

const MAX_BODY_BYTES = 256 * 1024;
const MAX_ITEMS = 50;
const reply = (status, body) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.FEEDBACK_FORWARD_KEY) return reply(404, { ok: false, error: "Not found." });
  if (!(await hasBearer(request, env.FEEDBACK_FORWARD_KEY))) return reply(401, { ok: false, error: "Needs the forward key." });
  let body;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return reply(413, { ok: false, error: "Too big." });
    body = JSON.parse(text);
  } catch (e) {
    return reply(400, { ok: false, error: "Couldn't read that." });
  }
  if (!EXTERNAL.includes(body?.source)) return reply(400, { ok: false, error: "Unknown source." });
  const items = (Array.isArray(body.items) ? body.items : [])
    .filter(i => i && typeof i === "object" && (typeof i.id === "string" || typeof i.id === "number") && String(i.id).length <= 200)
    .slice(0, MAX_ITEMS);
  if (!forwarding(env)) return reply(200, { ok: true, queued: 0 });
  if (!items.length) {
    context.waitUntil?.(flushDigest(env, new URL(request.url).origin));
    return reply(200, { ok: true, queued: 0 });
  }
  forwardAll(context, body.source, items);
  return reply(200, { ok: true, queued: items.length });
}
