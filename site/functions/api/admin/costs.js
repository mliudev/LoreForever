// What Lore Forever costs, for the Costs tab on /admin (lib/costs.js has the shape and the storage).
//   POST /api/admin/costs  a snapshot ({"taken_at": "2026-10-16", "budget_monthly": 100, "revenue": {...}, "services": [...],
//                          "not_checked": [...]}, documented in site/README.md "Costs") -> {"ok": true, "taken_at", "services"}
//                          The same taken_at again replaces that snapshot; the newest 30 are kept.
//   GET  /api/admin/costs  -> {"ok": true, "snapshot": {...} | null, "kept": N}: the newest one
// Same key as /api/admin ("Authorization: Bearer <key>"), and a browser must send it from our own pages (Origin).
// Never cached and never public: these are Mike's bills.

import { authorized } from "../../../lib/auth.js";
import { sameOrigin } from "../../../lib/accounts.js";
import { saveSnapshot, latestSnapshot } from "../../../lib/costs.js";

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
const json = (body, status = 200) => Response.json(body, { status, headers: NO_STORE });
const MAX_BYTES = 64 * 1024;

async function allowed(request, env) {
  if (request.headers.get("Origin") && !sameOrigin(request)) return json({ ok: false, error: "Send it from /admin." }, 403);
  if (!(await authorized(request, env))) return json({ ok: false, error: "Needs the admin key." }, 401);
  if (!env.DB) return json({ ok: false, error: "No D1 database bound as DB" }, 503);
  return null;
}

export async function onRequestPost({ request, env }) {
  const refused = await allowed(request, env);
  if (refused) return refused;
  let body;
  try {
    const text = await request.text();
    if (text.length > MAX_BYTES) return json({ ok: false, error: "Too big." }, 413);
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
