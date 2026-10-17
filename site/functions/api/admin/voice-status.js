// Voice work status for /admin/voices.html (lib/voice-status.js): the Voice Coordinator's PC posts one JSON snapshot
// every 10 minutes, the page shows the latest.
//   POST /api/admin/voice-status  <the snapshot: {"format": 1, "generated_at": "<ISO time>", "machines", "jobs", "matrix",
//                                 "prs", "events", "decisions"}, at most 1 MB>
//                                 -> {"ok": true, "generated_at", "received_at"}   400 unless it is format 1 with a generated_at
//   GET  /api/admin/voice-status  -> {"ok": true, "status": <the latest snapshot, or null>, "received_at",
//                                 "history": [{"at", "current", "count", "done", "total"}, ... oldest first]}
// Same key as /api/admin ("Authorization: Bearer <key>"), and a browser must send it from our own pages (Origin).

import { authorized } from "../../../lib/auth.js";
import { sameOrigin } from "../../../lib/accounts.js";
import { MAX_BYTES, saveSnapshot, latestSnapshot } from "../../../lib/voice-status.js";

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
const json = (body, status = 200) => Response.json(body, { status, headers: NO_STORE });

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
    if (new TextEncoder().encode(text).length > MAX_BYTES) return json({ ok: false, error: "Too big." }, 413);
    body = JSON.parse(text);
  } catch (e) {
    return json({ ok: false, error: "Expected JSON." }, 400);
  }
  try {
    return json({ ok: true, ...(await saveSnapshot(env, body)) });
  } catch (e) {
    if (e instanceof RangeError) return json({ ok: false, error: e.message }, 400);
    throw e;
  }
}

export async function onRequestGet({ request, env }) {
  const refused = await allowed(request, env);
  return refused || json({ ok: true, ...(await latestSnapshot(env)) });
}
