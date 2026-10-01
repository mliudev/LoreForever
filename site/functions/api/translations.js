// Translation submissions from /translate/submit, stored in the same D1 database as feedback (bound as DB).
//   POST /api/translations  saves one submission from a signed-in translator (lib/accounts.js): a link to their kit
//                           files, or a short fix pasted in.
//                           A JSON post gets {"ok": true} or {"ok": false, "error": ...}; a plain form post (the page
//                           without JavaScript) is sent on to /translate/thanks, or gets a short error page.
//   GET  /api/translations  returns the submissions, newest first. Needs the admin key (lib/auth.js).
// Optional Pages setting (Settings > Variables and Secrets):
//   TRANSLATIONS_WEBHOOK  Discord webhook URL; each submission and bad-translation report is posted there (never the
//                         email address)
// Bad-translation reports are functions/api/translations/report.js; likes are functions/api/translations/like.js.
//
// TERMS_VERSION is the contributor agreement the form shows (public/translate/submit.html). When its wording changes,
// give it a new version there and here; a form loaded before the change is then turned away with a request to reload.

import { authorized } from "../../lib/auth.js";
import { clean, ticked, EMAIL, senderHash, postWebhook } from "../../lib/form.js";
import { errorPage, LOCALE } from "../../lib/translations.js";
import { currentUser } from "../../lib/accounts.js";

const TERMS_VERSION = "2026-09-30";

const SETUP = `CREATE TABLE IF NOT EXISTS translation_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created TEXT NOT NULL,
  locale TEXT NOT NULL,
  language TEXT,
  credit TEXT NOT NULL,
  email TEXT,
  discord TEXT,
  link TEXT,
  fix TEXT,
  note TEXT,
  terms_version TEXT NOT NULL,
  country TEXT,
  sender TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  user_id TEXT
)`;

// A column added after the table was first made (LOR-96). ALTER fails once it exists; that's fine.
async function setupTable(env) {
  await env.DB.prepare(SETUP).run();
  try { await env.DB.prepare("ALTER TABLE translation_submissions ADD COLUMN user_id TEXT").run(); } catch (e) {}
}

const PER_DAY = 10;   // submissions one sender can make per day

// Places a kit can be shared from that we can open: Google Drive, Dropbox, OneDrive (personal and work), GitHub.
const FOLDER_HOSTS = [/^(drive|docs)\.google\.com$/, /^(www\.)?dropbox\.com$/, /^db\.tt$/, /^onedrive\.live\.com$/,
                      /^1drv\.ms$/, /^[\w-]+(-my)?\.sharepoint\.com$/, /^(gist\.)?github\.com$/];

function shareLink(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && FOLDER_HOSTS.some(h => h.test(u.hostname.toLowerCase())) ? u.href : null;
  } catch (e) {
    return null;
  }
}

const fail = (status, error) => Response.json({ ok: false, error }, { status, headers: { "Cache-Control": "no-store" } });

function notify(webhook, s) {
  const lines = [
    `**Translation #${s.id}: ${s.language || s.locale}**`,
    `Credit: ${s.credit}`,
    s.link ? `Files: <${s.link}>` : "",
    s.fix ? `Fix:\n${s.fix.slice(0, 1200)}` : "",
    s.note ? `Note: ${s.note.slice(0, 600)}` : "",
    s.discord ? `Discord: ${s.discord}` : "",
    s.email ? "(left an email; see /admin)" : "",
  ].filter(Boolean);
  return postWebhook(webhook, lines.join("\n"));
}

export async function onRequestPost(context) {
  const { request } = context;
  const json = (request.headers.get("Content-Type") || "").includes("application/json");
  const { status, error } = await save(context, json);
  if (json) return error ? fail(status, error) : Response.json({ ok: true });
  if (error) return errorPage(status, error, "/translate/submit", "Send a translation");
  return Response.redirect(new URL("/translate/thanks", request.url).href, 303);
}

// Returns {} when the submission was saved, or {status, error} with a message for the translator.
async function save({ request, env, waitUntil }, json) {
  if (!env.DB) return { status: 503, error: "Submissions aren't set up yet. Please ask on Discord." };
  let input;
  try {
    input = json ? await request.json() : Object.fromEntries(await request.formData());
  } catch (e) {
    return { status: 400, error: "Couldn't read the form." };
  }

  // Bots fill every field; people never see this one. Pretend it worked.
  if (clean(input.website, 10)) return {};

  // Sending a translation needs a Lore Forever account, so it is credited to someone we can reach (LOR-96).
  const user = await currentUser(env, request);
  if (!user) return { status: 401, error: "Please sign in to your Lore Forever account first. It takes a minute with your Google account." };

  const s = {
    locale: clean(input.locale, 8),
    language: clean(input.language, 60) || null,
    credit: clean(input.credit, 100),
    email: clean(input.email, 200).toLowerCase() || user.email || null,
    discord: clean(input.discord, 40).replace(/^@/, "") || null,
    link: clean(input.link, 1000),
    fix: clean(input.fix, 8000) || null,
    note: clean(input.note, 2000) || null,
    terms_version: clean(input.terms, 20),
  };
  if (s.locale !== "other" && !LOCALE.test(s.locale)) return { status: 400, error: "Pick the language you translated into." };
  if (s.locale === "other" && !s.language) return { status: 400, error: "Tell us which language you translated into." };
  if (!s.credit) return { status: 400, error: "Tell us how to credit you (a name, a handle, or Anonymous)." };
  if (!s.email && !s.discord) return { status: 400, error: "Leave an email address or a Discord handle so we can reach you." };
  if (s.email && !EMAIL.test(s.email)) return { status: 400, error: "That email address doesn't look right." };
  if (s.link) {
    s.link = shareLink(s.link);
    if (!s.link) return { status: 400, error: "The link needs to be a shared Google Drive, Dropbox, OneDrive or GitHub link starting with https://." };
  } else {
    s.link = null;
  }
  if (!s.link && !s.fix) return { status: 400, error: "Add a link to your files, or paste your fix in the box." };
  if (!ticked(input.agree)) return { status: 400, error: "Please tick the box to agree to share your translation under CC BY-SA 4.0." };
  if (s.terms_version !== TERMS_VERSION) {
    return { status: 409, error: "The contributor agreement was updated since this page loaded. Reload the page, read it again, and tick the box." };
  }

  const ip = request.headers.get("CF-Connecting-IP") || "";
  const now = new Date().toISOString();
  const sender = await senderHash(ip, now.slice(0, 10));
  await setupTable(env);
  const sent = await env.DB.prepare("SELECT COUNT(*) AS n FROM translation_submissions WHERE sender = ? AND created >= ?")
    .bind(sender, now.slice(0, 10)).first("n");
  if (sent >= PER_DAY) return { status: 429, error: "That's a lot of submissions for one day. Please try again tomorrow, or ask on Discord." };

  const row = await env.DB.prepare(
    "INSERT INTO translation_submissions (created, locale, language, credit, email, discord, link, fix, note, " +
    "terms_version, country, sender, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id"
  ).bind(now, s.locale, s.language, s.credit, s.email, s.discord, s.link, s.fix, s.note, s.terms_version,
         request.cf?.country || null, sender, user.id).first();

  if (env.TRANSLATIONS_WEBHOOK) waitUntil(notify(env.TRANSLATIONS_WEBHOOK, { ...s, id: row?.id }));
  return {};
}

export async function onRequestGet({ request, env }) {
  if (!(await authorized(request, env))) return fail(401, "Needs the admin key.");
  if (!env.DB) return Response.json({ submissions: [] });
  await setupTable(env);
  const { results } = await env.DB.prepare(
    "SELECT id, created, locale, language, credit, email, discord, link, fix, note, terms_version, country, status, user_id " +
    "FROM translation_submissions ORDER BY id DESC LIMIT 1000"
  ).all();
  return Response.json({ submissions: results }, { headers: { "Cache-Control": "no-store" } });
}
