// Player feedback from the /feedback page, stored in the same D1 database as the click counter (bound as DB).
//   POST /api/feedback  saves one report from a signed-in player (lib/accounts.js, Google sign-in; LOR-106), tied to
//                       their account (user_id). No email field: a reply goes to the account's email. A JSON post gets
//                       {"ok": true} or {"ok": false, "error": ...} (401 when signed out); a plain form post (the
//                       page without JavaScript) is sent back to /feedback?sent=1 or ?error=...
//   GET  /api/feedback  returns the reports, newest first. Needs "Authorization: Bearer <FEEDBACK_KEY>".
//                       ?since=<id> returns only reports after that id (for pulling new ones). `email` is the one
//                       typed on the form (reports from before sign-in) or else the account's; it's null once the
//                       account is deleted. `user_id` is null for reports from before sign-in.
// Optional Pages settings (Settings > Variables and Secrets):
//   FEEDBACK_KEY      secret for reading reports; without it GET is disabled
//   TURNSTILE_SECRET  Cloudflare Turnstile secret; when set, every report needs a valid Turnstile token
//   FEEDBACK_WEBHOOK  Discord webhook URL; each report is posted there (never the email address)
// A report code from the add-on's "Copy report" (LOR-120, public/report-code.js) is decoded on save: the decoded
// question context is kept as JSON in `report`, and spelled out in the Discord post. With a code, the message is
// optional (it defaults to the reason).

import { clean, ticked, senderHash, postWebhook } from "../../lib/form.js";
import { hasBearer } from "../../lib/auth.js";
import { currentUser, sameOrigin, setup as setupAccounts } from "../../lib/accounts.js";
import { decodeReport, describeReport, REASONS } from "../../public/report-code.js";

const SETUP = `CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created TEXT NOT NULL,
  kind TEXT NOT NULL,
  rating INTEGER,
  message TEXT NOT NULL,
  code TEXT,
  email TEXT,
  name TEXT,
  quote_ok INTEGER NOT NULL DEFAULT 0,
  country TEXT,
  sender TEXT NOT NULL,
  user_id TEXT,
  report TEXT
)`;
// Columns added after the table was first made (user_id: LOR-106, report: LOR-120). ALTER fails once a column
// exists; that's fine.
const MIGRATE = ["ALTER TABLE feedback ADD COLUMN user_id TEXT", "ALTER TABLE feedback ADD COLUMN report TEXT"];

async function setupTable(env) {
  await env.DB.prepare(SETUP).run();
  for (const sql of MIGRATE) {
    try { await env.DB.prepare(sql).run(); } catch (e) {}
  }
}

const KINDS = { lore: "Wrong or missing lore", bug: "Bug", idea: "Idea or zone request", review: "Review" };
const PER_DAY = 10;   // reports one account can make per day

const fail = (status, error) => Response.json({ ok: false, error }, { status, headers: { "Cache-Control": "no-store" } });

async function turnstileOk(secret, token, ip) {
  if (!token) return false;
  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    return (await r.json()).success === true;
  } catch (e) {
    return false;
  }
}

async function notify(webhook, f) {
  const stars = f.rating ? " " + "★".repeat(f.rating) + "☆".repeat(5 - f.rating) : "";
  const tick = s => "`" + String(s).replace(/`/g, "'") + "`";
  // A report code is spelled out under the message (Discord's limit is 2000 characters per post). A message that
  // is only the reason filled in for the player (save) isn't repeated.
  const report = f.report ? describeReport(f.report).map(l => "> " + l.slice(0, 200)) : [];
  const filled = f.report && f.message === REASONS[f.report.reason];
  const lines = [
    `**${KINDS[f.kind]}**${stars}${f.code ? "  " + tick(f.code) : ""}`,
    ...(filled ? [] : [f.message.slice(0, report.length ? 900 : 1500)]),
    ...report,
    (f.name ? `— ${f.name}` : "— (no name)") + (f.quote_ok ? " (OK to quote)" : ""),
    // A short account tag, so repeat reporters stand out; the reply email is in /admin and GET /api/feedback.
    `account ${f.user_id.slice(0, 8)}`,
  ];
  await postWebhook(webhook, lines.join("\n"));
}

export async function onRequestPost(context) {
  const { request } = context;
  const json = (request.headers.get("Content-Type") || "").includes("application/json");
  const { status, error } = await save(context, json);
  if (json) return error ? fail(status, error) : Response.json({ ok: true });
  const query = error ? "error=" + encodeURIComponent(error) : "sent=1";
  return Response.redirect(new URL("/feedback?" + query, request.url).href, 303);
}

// Returns {} when the report was saved, or {status, error} with a message for the player.
async function save({ request, env, waitUntil }, json) {
  if (!env.DB) return { status: 503, error: "Feedback isn't set up yet." };
  if (!sameOrigin(request)) return { status: 403, error: "Please use the form on loreforeverwow.com." };

  // Only signed-in players can send feedback, so every report has someone to reply to.
  const user = await currentUser(env, request);
  if (!user) return { status: 401, error: "Please sign in with Google to send feedback." };

  let input;
  try {
    input = json ? await request.json() : Object.fromEntries(await request.formData());
  } catch (e) {
    return { status: 400, error: "Couldn't read the form." };
  }

  // Bots fill every field; people never see this one. Pretend it worked.
  if (clean(input.website, 10)) return {};

  // A pasted feedback link or Discord message still finds the report code in it.
  const report = decodeReport(clean(input.code, 2000));
  const f = {
    kind: KINDS[input.kind] ? input.kind : report ? "lore" : "review",
    rating: [1, 2, 3, 4, 5].includes(Number(input.rating)) ? Number(input.rating) : null,
    message: clean(input.message, 4000),
    code: report ? report.code.slice(0, 160) : clean(input.code, 120) || null,
    report,
    name: clean(input.name, 60) || null,
    quote_ok: ticked(input.quote_ok) ? 1 : 0,
    user_id: user.id,
  };
  if (report && !f.message) f.message = REASONS[report.reason];
  if (f.message.length < 3) return { status: 400, error: "Please write a few words." };

  const ip = request.headers.get("CF-Connecting-IP") || "";
  if (env.TURNSTILE_SECRET && !(await turnstileOk(env.TURNSTILE_SECRET, input["cf-turnstile-response"], ip))) {
    return { status: 403, error: "The spam check didn't pass. Reload the page and try again." };
  }

  const now = new Date().toISOString();
  const sender = await senderHash(env, ip, now.slice(0, 10));
  await setupTable(env);
  const sent = await env.DB.prepare("SELECT COUNT(*) AS n FROM feedback WHERE user_id = ? AND created >= ?")
    .bind(user.id, now.slice(0, 10)).first("n");
  if (sent >= PER_DAY) return { status: 429, error: "That's a lot of reports for one day. Thanks! Please try again tomorrow." };

  await env.DB.prepare(
    "INSERT INTO feedback (created, kind, rating, message, code, email, name, quote_ok, country, sender, user_id, " +
    "report) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)"
  ).bind(now, f.kind, f.rating, f.message, f.code, f.name, f.quote_ok,
         request.cf?.country || null, sender, f.user_id, report ? JSON.stringify(report) : null).run();

  if (env.FEEDBACK_WEBHOOK) waitUntil(notify(env.FEEDBACK_WEBHOOK, f));
  return {};
}

export async function onRequestGet({ request, env }) {
  if (!(await hasBearer(request, env.FEEDBACK_KEY))) return fail(401, "Needs the feedback key.");   // constant time
  if (!env.DB) return Response.json({ reports: [] });
  await setupTable(env);
  await setupAccounts(env);
  const since = parseInt(new URL(request.url).searchParams.get("since") || "0", 10) || 0;
  const { results } = await env.DB.prepare(
    "SELECT f.id, f.created, f.kind, f.rating, f.message, f.code, COALESCE(f.email, u.email) AS email, f.name, " +
    "f.quote_ok, f.country, f.user_id, f.report FROM feedback f LEFT JOIN users u ON u.id = f.user_id " +
    "WHERE f.id > ? ORDER BY f.id DESC LIMIT 500"
  ).bind(since).all();
  // `report` is the decoded report code (or null); codes saved before LOR-120 are decoded now.
  for (const r of results) r.report = r.report ? JSON.parse(r.report) : decodeReport(r.code);
  return Response.json({ reports: results });
}
