// How long Willo plans are kept, for /admin's Growth > Retention (lib/retention.js, public/admin-retention.js).
//   GET /api/admin/retention[?paid=1] -> {now, paidOnly, weeks, cohorts: [{week, n, notCharged, cancelled, cancelledBy,
//       kept: [{after, kept, of} | null]}], summary, totals, leftOut: {comped, team, notCharged}, subscribers: [...],
//       cancellations: [...]}: per start week, how many plans are still on after 1, 2, 3... weeks and how many were
//       cancelled, Patrick's one-line summary, each subscriber and the cancellation log, never who. paid=1: only plans
//       that have paid something (the beta's moved plans first pay on November 4).
//       Each cancellation has its id, note ("yes": Patrick can write to that player; else why not: written, taken
//       back, no account, opted out, not counted, not this one) and written ({status, at} once a note went); template is
//       what the box starts with.
//   POST /api/admin/retention {"action": "write", "id" (a cancellation's), "subject", "text"} -> {status}: the note to
//       that player from patrick@loreforeverwow.com (lib/winback.js writeNote): sent, off (no email service here),
//       opted_out, no_address or seen; 400 {error} when it can't go. The player's address never comes back.
// Same key as /api/admin ("Authorization: Bearer <key>"), and a browser must send it from our own pages (Origin).

import { authorized } from "../../../lib/auth.js";
import { sameOrigin, setup } from "../../../lib/accounts.js";
import { retentionReport } from "../../../lib/retention.js";
import { writeNote } from "../../../lib/winback.js";

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
  await setup(env);
  const paidOnly = new URL(request.url).searchParams.get("paid") === "1";
  return json({ ok: true, ...(await retentionReport(env, { paidOnly })) });
}

export async function onRequestPost({ request, env }) {
  const no = await refused(request, env);
  if (no) return no;
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Expected JSON." }, 400); }
  if (body?.action !== "write") return json({ ok: false, error: "Unknown action." }, 400);
  await setup(env);
  const out = await writeNote(env, { id: body.id, subject: body.subject, text: body.text, as: body.as });
  return out.error ? json({ ok: false, error: out.error }, 400) : json({ ok: true, status: out.status });
}
