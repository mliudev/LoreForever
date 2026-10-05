// Volunteer narrator submissions from /voices/submit, stored in the same D1 database as feedback (bound as DB).
//   POST /api/voices  saves one submission from a signed-in contributor (lib/accounts.js), tied to their account and
//                     to a voice of theirs (D1 table voices, pending until we publish it). A JSON post gets {"ok": true} or {"ok": false, "error": ...}; a plain
//                     form post (the page without JavaScript) is sent on to /voices/thanks, or gets a short error page.
//   GET  /api/voices  returns the submissions, newest first. Needs the admin key (lib/auth.js).
// Optional Pages setting (Settings > Variables and Secrets):
//   VOICES_WEBHOOK    Discord webhook URL; each submission is posted there (never the email address or signature)
// The table, the release version and the webhook message are in lib/submissions.js, shared with the upload page.

import { authorized } from "../../lib/auth.js";
import { clean, ticked, EMAIL, senderHash } from "../../lib/form.js";
import { currentUser, claimVoice } from "../../lib/accounts.js";
import { loadVoices } from "../../lib/voices.js";
import { RELEASE_VERSION, PER_DAY, setupSubmissions, sentToday, insertSubmission, notify } from "../../lib/submissions.js";

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
<a href="/voices/studio">Record your voice</a> &rsaquo; Send your recordings</span></div></header>
<main class="wrap fb-page"><h1>Not sent yet</h1>
<div class="fb-done"><p>${escape(error)}</p>
${status === 401
  ? `<p><a href="/account?next=/voices/submit">Sign in or create your Lore Forever account</a>, then send the form again.</p>`
  : `<p>Use your browser's Back button to fix it: what you typed is still there. Or <a href="/voices/submit">start over</a>.</p>`}</div>
</main></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
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

  // Only contributors with an account can send a voice, so it can be tied to them and shown on their profile.
  const user = await currentUser(env, request);
  if (!user) return { status: 401, error: "Please sign in to your Lore Forever account first. It takes a minute with your Google account." };

  const s = {
    credit: clean(input.credit, 100),
    email: clean(input.email, 200).toLowerCase() || user.email || null,
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
  if (!s.adult_or_guardian) return { status: 400, error: "Please confirm you're 18 or older. Sending a voice is for adults only." };
  if (s.signature.length < 2) return { status: 400, error: "Type your full name as your signature." };

  const ip = request.headers.get("CF-Connecting-IP") || "";
  const now = new Date().toISOString();
  const sender = await senderHash(env, ip, now.slice(0, 10));
  await setupSubmissions(env);
  const sent = await sentToday(env, sender, now.slice(0, 10));
  if (sent >= PER_DAY) return { status: 429, error: "That's a lot of submissions for one day. Please try again tomorrow, or ask on Discord." };

  const listed = new Set((await loadVoices(env, request)).map(v => v.id));
  const voiceId = await claimVoice(env, user, s.pack, listed);
  const row = { ...s, created: now, country: request.cf?.country || null, sender, user_id: user.id, voice_id: voiceId };
  row.id = await insertSubmission(env, row);

  if (env.VOICES_WEBHOOK) waitUntil(notify(env.VOICES_WEBHOOK, row));
  return {};
}

export async function onRequestGet({ request, env }) {
  if (!(await authorized(request, env))) return fail(401, "Needs the admin key.");
  if (!env.DB) return Response.json({ submissions: [] });
  await setupSubmissions(env);
  const { results } = await env.DB.prepare(
    "SELECT id, created, credit, email, discord, pack, link, clips, note, release_version, adult_or_guardian, " +
    "signature, country, status, user_id, voice_id FROM voice_submissions ORDER BY id DESC LIMIT 1000"
  ).all();
  return Response.json({ submissions: results }, { headers: { "Cache-Control": "no-store" } });
}
