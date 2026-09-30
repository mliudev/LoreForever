// Volunteer narrator submissions from /voices/submit, stored in the same D1 database as feedback (bound as DB).
//   POST /api/voices  saves one submission. A JSON post gets {"ok": true} or {"ok": false, "error": ...}; a plain
//                     form post (the page without JavaScript) is sent on to /voices/thanks, or gets a short error page.
//   GET  /api/voices  returns the submissions, newest first. Needs the admin key (lib/auth.js).
// Optional Pages setting (Settings > Variables and Secrets):
//   VOICES_WEBHOOK    Discord webhook URL; each submission is posted there (never the email address or signature)
//
// RELEASE_VERSION is the narrator release the form asks people to agree to (public/voices/release.html). When the
// release changes, give it a new version there, here and in public/voices/submit.html; a form loaded before the
// change is then turned away with a request to read the new one.

import { authorized } from "../../lib/auth.js";
import { clean, ticked, EMAIL, senderHash, postWebhook } from "../../lib/form.js";

const RELEASE_VERSION = "2026-09-29";

const SETUP = `CREATE TABLE IF NOT EXISTS voice_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created TEXT NOT NULL,
  credit TEXT NOT NULL,
  email TEXT,
  discord TEXT,
  pack TEXT NOT NULL,
  link TEXT NOT NULL,
  clips TEXT NOT NULL,
  note TEXT,
  release_version TEXT NOT NULL,
  adult_or_guardian INTEGER NOT NULL,
  signature TEXT NOT NULL,
  country TEXT,
  sender TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new'
)`;

const PER_DAY = 5;   // submissions one sender can make per day

// Shared-folder links we can open: Google Drive, Dropbox, OneDrive (personal and work).
const FOLDER_HOSTS = [/^(drive|docs)\.google\.com$/, /^(www\.)?dropbox\.com$/, /^db\.tt$/, /^onedrive\.live\.com$/,
                      /^1drv\.ms$/, /^[\w-]+(-my)?\.sharepoint\.com$/];

function folderLink(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && FOLDER_HOSTS.some(h => h.test(u.hostname.toLowerCase())) ? u.href : null;
  } catch (e) {
    return null;
  }
}

const fail = (status, error) => Response.json({ ok: false, error }, { status, headers: { "Cache-Control": "no-store" } });
const escape = s => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Without JavaScript the form posts here directly, so an error comes back as a page of its own.
function errorPage(status, error) {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Not sent yet - Lore Forever</title>
<link rel="icon" href="/img/logo.svg" type="image/svg+xml"><link rel="stylesheet" href="/style.css"></head>
<body><header class="top"><div class="wrap"><span class="crumb"><a href="/">Lore Forever</a> &rsaquo;
<a href="/voices">Voices</a> &rsaquo; Send your recordings</span></div></header>
<main class="wrap fb-page"><h1>Not sent yet</h1>
<div class="fb-done"><p>${escape(error)}</p>
<p>Use your browser's Back button to fix it: what you typed is still there. Or <a href="/voices/submit">start over</a>.</p></div>
</main></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

function notify(webhook, s) {
  const lines = [
    `**Voice submission #${s.id}: ${s.pack}**`,
    `Credit: ${s.credit}`,
    `Clips: ${s.clips.slice(0, 500)}`,
    `Recordings: <${s.link}>`,
    s.note ? `Note: ${s.note.slice(0, 800)}` : "",
    s.discord ? `Discord: ${s.discord}` : "",
    s.email ? "(left an email; see /admin)" : "",
    `Agreed to the narrator release ${s.release_version}`,
  ].filter(Boolean);
  return postWebhook(webhook, lines.join("\n"));
}

export async function onRequestPost(context) {
  const { request } = context;
  const json = (request.headers.get("Content-Type") || "").includes("application/json");
  const { status, error } = await save(context, json);
  if (json) return error ? fail(status, error) : Response.json({ ok: true });
  if (error) return errorPage(status, error);
  return Response.redirect(new URL("/voices/thanks", request.url).href, 303);
}

// Returns {} when the submission was saved, or {status, error} with a message for the narrator.
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

  const s = {
    credit: clean(input.credit, 100),
    email: clean(input.email, 200).toLowerCase() || null,
    discord: clean(input.discord, 40).replace(/^@/, "") || null,
    pack: clean(input.pack, 60),
    link: clean(input.link, 1000),
    clips: clean(input.clips, 1000),
    note: clean(input.note, 2000) || null,
    release_version: clean(input.release, 20),
    adult_or_guardian: ticked(input.adult) ? 1 : 0,
    signature: clean(input.signature, 100),
  };
  if (!s.credit) return { status: 400, error: "Tell us how to credit you (a name, a handle, or Anonymous)." };
  if (!s.email && !s.discord) return { status: 400, error: "Leave an email address or a Discord handle so we can reach you." };
  if (s.email && !EMAIL.test(s.email)) return { status: 400, error: "That email address doesn't look right." };
  if (!s.pack) return { status: 400, error: "Give your pack a name. You can change it later." };
  s.link = folderLink(s.link);
  if (!s.link) return { status: 400, error: "The recordings link needs to be a shared Google Drive, Dropbox or OneDrive link starting with https://." };
  if (!s.clips) return { status: 400, error: "Tell us which clips you recorded, or roughly how many." };
  if (!ticked(input.agree)) return { status: 400, error: "Please read the narrator release and tick the box to agree to it." };
  if (s.release_version !== RELEASE_VERSION) {
    return { status: 409, error: "The narrator release was updated since this page loaded. Reload the page, read the new version, and agree again." };
  }
  if (!s.adult_or_guardian) return { status: 400, error: "Please confirm you're 18 or older, or that a parent or guardian agrees." };
  if (s.signature.length < 2) return { status: 400, error: "Type your full name as your signature." };

  const ip = request.headers.get("CF-Connecting-IP") || "";
  const now = new Date().toISOString();
  const sender = await senderHash(ip, now.slice(0, 10));
  await env.DB.prepare(SETUP).run();
  const sent = await env.DB.prepare("SELECT COUNT(*) AS n FROM voice_submissions WHERE sender = ? AND created >= ?")
    .bind(sender, now.slice(0, 10)).first("n");
  if (sent >= PER_DAY) return { status: 429, error: "That's a lot of submissions for one day. Please try again tomorrow, or ask on Discord." };

  const row = await env.DB.prepare(
    "INSERT INTO voice_submissions (created, credit, email, discord, pack, link, clips, note, release_version, " +
    "adult_or_guardian, signature, country, sender) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id"
  ).bind(now, s.credit, s.email, s.discord, s.pack, s.link, s.clips, s.note, s.release_version,
         s.adult_or_guardian, s.signature, request.cf?.country || null, sender).first();

  if (env.VOICES_WEBHOOK) waitUntil(notify(env.VOICES_WEBHOOK, { ...s, id: row?.id }));
  return {};
}

export async function onRequestGet({ request, env }) {
  if (!(await authorized(request, env))) return fail(401, "Needs the admin key.");
  if (!env.DB) return Response.json({ submissions: [] });
  await env.DB.prepare(SETUP).run();
  const { results } = await env.DB.prepare(
    "SELECT id, created, credit, email, discord, pack, link, clips, note, release_version, adult_or_guardian, " +
    "signature, country, status FROM voice_submissions ORDER BY id DESC LIMIT 1000"
  ).all();
  return Response.json({ submissions: results }, { headers: { "Cache-Control": "no-store" } });
}
