// Lore Forever's error reports from the companion app (lib/addon-errors.js), sent only once the player said yes to
// "Send Lore Forever's error reports":
//   POST /api/companion/addon-errors  {"v": 1, "install", "companion", "addon", "client", "locale", "errors": [...]}
//                                     -> {"ok": true, "kept": n}. Needs "X-LF-Client: companion/<version>" and no
//                                     Origin (a page on another site can't send it without a preflight we never
//                                     answer). No account, cookie or name, and the IP isn't kept: it only counts the
//                                     hourly limit, hashed. 400 for anything else, 413 past MAX_BODY, 429 past
//                                     PER_HOUR sends from one install, 503 when the database fails (the app tries
//                                     again later).
//   GET  /api/companion/addon-errors  the admin key (lib/auth.js): {errors: [{sig, msg, stack, installs, n, first,
//                                     last, versions, locales}]}, the most players first (the routines' read).
// A message no install had sent before goes to Slack #player-feedback, once (lib/slack-feedback.js "addon-error").

import { readAddonErrors, saveAddonErrors, addonErrorReport, MAX_BODY, PER_HOUR } from "../../../lib/addon-errors.js";
import { perHour } from "../../../lib/ratelimit.js";
import { authorized } from "../../../lib/auth.js";
import { setup as setupAccounts } from "../../../lib/accounts.js";
import { forwardAll } from "../../../lib/slack-feedback.js";
import { isCompanion } from "../../../lib/client-version.js";

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
const fail = (status, error) => Response.json({ ok: false, error }, { status, headers: NO_STORE });

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isCompanion(request.headers.get("X-LF-Client"), { loose: true }) ||request.headers.get("Origin")) {
    return fail(400, "Only the companion app sends these.");
  }
  if (Number(request.headers.get("Content-Length") || 0) > MAX_BODY) return fail(413, "Too long.");
  let input = null;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY) return fail(413, "Too long.");
    input = JSON.parse(raw);
  } catch (e) { /* not JSON */ }
  const report = readAddonErrors(input);
  if (!report) return fail(400, "That isn't an error report.");
  if (!env.DB) return fail(503, "Not switched on yet.");
  try {
    await setupAccounts(env);   // rate_limits lives with the accounts' tables
    if (!(await perHour(env, "install:" + report.install, "addon-errors", PER_HOUR))) {
      return Response.json({ ok: false, error: "Too many reports this hour.", retryAfter: 3600 },
                           { status: 429, headers: { ...NO_STORE, "Retry-After": "3600" } });
    }
    const fresh = await saveAddonErrors(env, report);
    forwardAll(context, "addon-error", fresh);
    return Response.json({ ok: true, kept: report.errors.length }, { headers: NO_STORE });
  } catch (e) {
    return fail(503, "Couldn't keep that now. Try again later.");
  }
}

export async function onRequestGet({ request, env }) {
  if (!(await authorized(request, env))) return fail(401, "Needs the admin key.");
  if (!env.DB) return Response.json({ errors: [] }, { headers: NO_STORE });
  return Response.json({ errors: await addonErrorReport(env) }, { headers: NO_STORE });
}
