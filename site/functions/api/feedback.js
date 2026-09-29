// Player feedback from the /feedback page, stored in the same D1 database as the click counter (bound as DB).
//   POST /api/feedback  saves one report. A JSON post gets {"ok": true} or {"ok": false, "error": ...}; a plain
//                       form post (the page without JavaScript) is sent back to /feedback?sent=1 or ?error=...
//   GET  /api/feedback  returns the reports, newest first. Needs "Authorization: Bearer <FEEDBACK_KEY>".
//                       ?since=<id> returns only reports after that id (for pulling new ones).
// Optional Pages settings (Settings > Variables and Secrets):
//   FEEDBACK_KEY      secret for reading reports; without it GET is disabled
//   TURNSTILE_SECRET  Cloudflare Turnstile secret; when set, every report needs a valid Turnstile token
//   FEEDBACK_WEBHOOK  Discord webhook URL; each report is posted there (without the email address)

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
  sender TEXT NOT NULL
)`;

const KINDS = { lore: "Wrong or missing lore", bug: "Bug", idea: "Idea or zone request", review: "Review" };
const PER_DAY = 10;   // reports one sender can make per day

const clean = (v, max) => String(v ?? "").replace(/\r\n?/g, "\n").trim().slice(0, max);
const fail = (status, error) => Response.json({ ok: false, error }, { status });

// A per-day hash of the sender's IP, only used to cap how many reports one person can send.
async function senderHash(ip, day) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("loreforever:" + day + ":" + ip));
  return [...new Uint8Array(bytes)].slice(0, 12).map(b => b.toString(16).padStart(2, "0")).join("");
}

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
  const lines = [
    `**${KINDS[f.kind]}**${stars}${f.code ? "  `" + f.code.replace(/`/g, "'") + "`" : ""}`,
    f.message.slice(0, 1500),
    f.name ? `— ${f.name}${f.quote_ok ? " (OK to quote)" : ""}` : f.quote_ok ? "(OK to quote)" : "",
    f.email ? "(left an email for a reply)" : "",
  ].filter(Boolean);
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: lines.join("\n"), allowed_mentions: { parse: [] } }),
    });
  } catch (e) {}
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
  let input;
  try {
    input = json ? await request.json() : Object.fromEntries(await request.formData());
  } catch (e) {
    return { status: 400, error: "Couldn't read the form." };
  }

  // Bots fill every field; people never see this one. Pretend it worked.
  if (clean(input.website, 10)) return {};

  const f = {
    kind: KINDS[input.kind] ? input.kind : "review",
    rating: [1, 2, 3, 4, 5].includes(Number(input.rating)) ? Number(input.rating) : null,
    message: clean(input.message, 4000),
    code: clean(input.code, 120) || null,
    email: clean(input.email, 200) || null,
    name: clean(input.name, 60) || null,
    quote_ok: input.quote_ok === true || input.quote_ok === "on" || input.quote_ok === "1" ? 1 : 0,
  };
  if (f.message.length < 3) return { status: 400, error: "Please write a few words." };
  if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) {
    return { status: 400, error: "That email address doesn't look right." };
  }

  const ip = request.headers.get("CF-Connecting-IP") || "";
  if (env.TURNSTILE_SECRET && !(await turnstileOk(env.TURNSTILE_SECRET, input["cf-turnstile-response"], ip))) {
    return { status: 403, error: "The spam check didn't pass. Reload the page and try again." };
  }

  const now = new Date().toISOString();
  const sender = await senderHash(ip, now.slice(0, 10));
  await env.DB.prepare(SETUP).run();
  const sent = await env.DB.prepare("SELECT COUNT(*) AS n FROM feedback WHERE sender = ?").bind(sender).first("n");
  if (sent >= PER_DAY) return { status: 429, error: "That's a lot of reports for one day. Thanks! Please try again tomorrow." };

  await env.DB.prepare(
    "INSERT INTO feedback (created, kind, rating, message, code, email, name, quote_ok, country, sender) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(now, f.kind, f.rating, f.message, f.code, f.email, f.name, f.quote_ok,
         request.cf?.country || null, sender).run();

  if (env.FEEDBACK_WEBHOOK) waitUntil(notify(env.FEEDBACK_WEBHOOK, f));
  return {};
}

export async function onRequestGet({ request, env }) {
  const auth = request.headers.get("Authorization") || "";
  if (!env.FEEDBACK_KEY || auth !== "Bearer " + env.FEEDBACK_KEY) return fail(401, "Needs the feedback key.");
  if (!env.DB) return Response.json({ reports: [] });
  await env.DB.prepare(SETUP).run();
  const since = parseInt(new URL(request.url).searchParams.get("since") || "0", 10) || 0;
  const { results } = await env.DB.prepare(
    "SELECT id, created, kind, rating, message, code, email, name, quote_ok, country " +
    "FROM feedback WHERE id > ? ORDER BY id DESC LIMIT 500"
  ).bind(since).all();
  return Response.json({ reports: results });
}
