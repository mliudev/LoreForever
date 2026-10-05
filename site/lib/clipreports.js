// Clip reports (LOR-232): players report a recording that's wrong (a name said wrong, the wrong voice, cut off...),
// from the add-on's link (/clip-report#c=LCR1~...) or a page's report button. No sign-in needed; a signed-in report
// counts for more in the pipeline (lore.clipreports: 2+ reporters, or 1 signed in, and the clip is recorded again
// overnight). Nobody reviews them: /admin only rejects spam. Each clip's open count is public, the text isn't.
// API and fields: site/CLIP_REPORT_API.md. Kept outside functions/ so Pages doesn't route it.
//
// Table clip_reports (created in lib/accounts.js SETUP, so "Delete my account" can remove a user's reports):
//   clip, hash, voice    the clip id, the hash of the text its recording read, the voice pack's folder name
//   reason               name | voice | cut | quality | stage | text | other
//   name, say_as, note   free text (a name, how it should sound, a note), capped at 60 / 80 / 300 characters
//   uploader             who sent it: "u:<user id>" signed in, else "ip:<sender>"; one open report per uploader,
//                        clip and voice (sending again updates it)
//   sender               the day's hash of the sender's IP (lib/form.js senderHash), for the daily cap
//   status               open | done (recorded again, or the text changed) | kept (nothing to change) | rejected (spam)

import { setup as setupAccounts, currentUser, sameOrigin, noStore } from "./accounts.js";
import { senderHash } from "./form.js";
import { REASONS, MAX, normalizeVoice, splitClip, cleanText, decodeClipReport } from "../public/clip-report-code.js";

export const PER_DAY = 30;                         // new reports one sender can make per day
export const STATUSES = ["open", "done", "kept", "rejected"];
export const SOURCES = ["addon", "site", "companion"];

export const fail = (status, error) => Response.json({ ok: false, error }, { status, headers: noStore });

export async function setup(env) { await setupAccounts(env); }

// A report from a request body, checked. {report} or {error}. A body with a `code` (the add-on's) takes its fields from
// the code; the free text may be edited on the page, so name, say_as and note in the body win when present.
export function readReport(input) {
  input = input && typeof input === "object" ? input : {};
  let r;
  if (input.code) {
    const d = decodeClipReport(String(input.code).slice(0, 4000));
    if (!d) return { error: "That isn't a report link from Lore Forever." };
    if (!d.ok) return { error: d.error === "checksum" || d.error === "cut"
      ? "The link looks cut short. Copy the whole link from the game again."
      : "That report link isn't one we can read." };
    r = { ...d, source: "addon" };
  } else {
    const clip = splitClip(input.clip, input.hash);
    if (!clip) return { error: "That isn't a narration we know." };
    const voice = normalizeVoice(input.voice);
    if (!voice) return { error: "Say which voice it was." };
    r = { ...clip, voice, reason: String(input.reason || ""), version: null, locale: null,
          source: SOURCES.includes(input.source) ? input.source : "site" };
    if (typeof input.locale === "string" && /^[a-z]{2}[A-Z]{2}$/.test(input.locale)) r.locale = input.locale;
  }
  if (!REASONS[r.reason]) return { error: "Pick what's wrong with it." };
  const pick = (k, max, lines) => (input[k] !== undefined && input[k] !== null ? cleanText(input[k], max, lines) : r[k] || "") || null;
  r.note = pick("note", MAX.note, true);
  r.name = r.reason === "name" ? pick("name", MAX.name) : null;
  r.say_as = r.reason === "name" ? pick("say_as", MAX.say_as) : null;
  return { report: r };
}

// The open reports of each clip ({clip: n}, every voice together), or per voice ({clip: {voice: n}}). `clips`: only
// these ids; `voice`: only this voice.
export async function openCounts(env, { clips = null, voice = null, byVoice = false } = {}) {
  await setup(env);
  const where = ["status = 'open'"], args = [];
  if (voice) { where.push("voice = ?"); args.push(voice); }
  if (clips && clips.length) { where.push(`clip IN (${clips.map(() => "?").join(", ")})`); args.push(...clips); }
  const { results } = await env.DB.prepare(
    `SELECT clip, voice, COUNT(*) AS n FROM clip_reports WHERE ${where.join(" AND ")} GROUP BY clip, voice`
  ).bind(...args).all();
  const out = {};
  for (const row of results) {
    if (byVoice) (out[row.clip] ||= {})[row.voice] = row.n;
    else out[row.clip] = (out[row.clip] || 0) + row.n;
  }
  return out;
}

// Saves one report. Returns {status, body} for the response.
export async function saveReport(env, request, input) {
  if (!env.DB) return { status: 503, body: { ok: false, error: "Reports aren't set up yet. Please tell us on Discord." } };
  if (input && String(input.website || "").trim()) return { status: 200, body: { ok: true } };   // honeypot
  const { report: r, error } = readReport(input);
  if (error) return { status: 400, body: { ok: false, error } };

  await setup(env);
  const now = new Date().toISOString();
  const sender = await senderHash(env, request.headers.get("CF-Connecting-IP") || "", now.slice(0, 10));
  // The account only counts from our own pages (browsers send Origin on a POST); elsewhere it's an anonymous report.
  const user = sameOrigin(request) ? await currentUser(env, request) : null;
  const uploader = user ? "u:" + user.id : "ip:" + sender;

  // One open report per person, clip and voice: sending again replaces what it says.
  const mine = await env.DB.prepare(
    "SELECT id FROM clip_reports WHERE uploader = ? AND clip = ? AND voice = ? AND status IN ('open', 'rejected') ORDER BY id DESC LIMIT 1"
  ).bind(uploader, r.clip, r.voice).first();
  let id;
  if (mine) {
    // A rejected uploader's report stays rejected: updating it doesn't bring it back.
    await env.DB.prepare(
      "UPDATE clip_reports SET updated = ?, hash = ?, reason = ?, name = ?, say_as = ?, note = ?, version = COALESCE(?, version), " +
      "locale = COALESCE(?, locale), source = ? WHERE id = ?"
    ).bind(now, r.hash, r.reason, r.name, r.say_as, r.note, r.version, r.locale, r.source, mine.id).run();
    id = mine.id;
  } else {
    const today = await env.DB.prepare("SELECT COUNT(*) AS n FROM clip_reports WHERE sender = ? AND created >= ?")
      .bind(sender, now.slice(0, 10)).first("n");
    if (today >= PER_DAY) {
      return { status: 429, body: { ok: false, error: "That's a lot of reports for one day. Thank you! Please send the rest tomorrow." } };
    }
    const row = await env.DB.prepare(
      "INSERT INTO clip_reports (created, updated, clip, hash, voice, reason, name, say_as, note, version, locale, source, " +
      "user_id, sender, uploader, country, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open') RETURNING id"
    ).bind(now, now, r.clip, r.hash, r.voice, r.reason, r.name, r.say_as, r.note, r.version, r.locale, r.source,
           user ? user.id : null, sender, uploader, request.cf?.country || null).first();
    id = row?.id;
  }
  const open = (await openCounts(env, { clips: [r.clip], voice: r.voice }))[r.clip] || 0;
  return { status: 200, body: { ok: true, id, open, signedIn: Boolean(user) } };
}

// For the pipeline and /admin: reports with every field, newest first. status: open (default), all, or one status.
export async function exportReports(env, { status = "open", since = 0, limit = 5000 } = {}) {
  await setup(env);
  const where = ["id > ?"], args = [since];
  if (status !== "all") { where.push("status = ?"); args.push(status); }
  const { results } = await env.DB.prepare(
    "SELECT id, created, updated, clip, hash, voice, reason, name, say_as, note, version, locale, source, uploader, " +
    `user_id IS NOT NULL AS signed_in, country, status, resolved FROM clip_reports WHERE ${where.join(" AND ")} ` +
    "ORDER BY id DESC LIMIT ?"
  ).bind(...args, Math.min(Math.max(1, limit), 5000)).all();
  for (const r of results) r.signed_in = Boolean(r.signed_in);
  return results;
}

// Marks reports done (recorded again), kept (nothing to change) or open again. Rejected ones stay rejected.
export async function resolveReports(env, ids, status) {
  await setup(env);
  ids = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(n => Number.isInteger(n) && n > 0))].slice(0, 5000);
  if (!["done", "kept", "open"].includes(status) || !ids.length) return 0;
  let changed = 0;
  for (let i = 0; i < ids.length; i += 90) {   // D1 takes at most 100 bound values per statement
    const part = ids.slice(i, i + 90);
    const res = await env.DB.prepare(
      `UPDATE clip_reports SET status = ?, resolved = ? WHERE status != 'rejected' AND status != ? AND id IN (${part.map(() => "?").join(", ")})`
    ).bind(status, status === "open" ? null : new Date().toISOString(), status, ...part).run();
    changed += res.meta?.changes || 0;
  }
  return changed;
}

// Rejects everything one uploader sent that's still open (spam, vandalism), or with restore, brings it back.
export async function rejectUploader(env, uploader, restore = false) {
  await setup(env);
  if (!/^(u|ip):[\w-]{1,80}$/.test(String(uploader || ""))) return 0;
  const res = await env.DB.prepare(restore
    ? "UPDATE clip_reports SET status = 'open', resolved = NULL WHERE uploader = ? AND status = 'rejected'"
    : "UPDATE clip_reports SET status = 'rejected', resolved = ? WHERE uploader = ? AND status = 'open'"
  ).bind(...(restore ? [uploader] : [new Date().toISOString(), uploader])).run();
  return res.meta?.changes || 0;
}
