// "My contributions" on /account (LOR-621): every translation edit, shared Forever text line, voice submission and clip
// report the signed-in player sent, each with what became of it: shipped in X.Y.Z, not used and why, rejected and why,
// or waiting and for what. GET /api/contributions answers with mine(). Only the player's own items, and never another
// contributor's name: a line shows how many players sent it, nothing more. Nothing here is emailed.
// Kept outside functions/ so Pages doesn't route it.

import { shownStatus, nowSec, ACCEPT_AFTER } from "./contribute.js";
import { setupSubmissions } from "./submissions.js";
import { communityPacks, narratorReports } from "./clipreports.js";
import { setupReports, reportOutcome } from "./reports.js";

const LIMIT = 100;   // items listed per kind, newest first; the counts cover everything
const safe = async query => { try { return await query; } catch (e) { return null; } };   // a table not made yet
const rows = async query => (await safe(query))?.results || [];
const state = (key, label) => ({ key, label });

// ---- Translation edits (translation_edits; lore.kit community says what became of each, LOR-621) ----

export function editState(e) {
  const reason = String(e.reason || "").trim().replace(/[.\s]+$/, "");
  if (e.status === "new" || e.status === "accepted") return state("waiting", "Waiting: checked and added at the next nightly import");
  if (e.status === "rejected") return state("rejected", `Rejected: ${reason || "set aside in review"}`);
  if (e.status === "pulled") {
    if (e.outcome === "unusable") return state("unused", reason ? `Not used: ${reason}` : "Not used");
    if (e.outcome === "superseded") return state("unused", "Not used: a later edit of this line went in instead");
    if (e.shipped_in) return state("shipped", `Shipped in ${e.shipped_in}`);
    if (e.outcome === "landed" || e.outcome === "same") return state("in", "In the language: goes out with the next update");
    return state("in", "Imported");   // pulled before lore.kit said what became of each edit
  }
  return state("waiting", "Waiting");
}

async function translations(env, user) {
  const list = await rows(env.DB.prepare(
    `SELECT locale, string_id, text, status, reason, outcome, shipped_in, updated FROM translation_edits
     WHERE user_id = ? ORDER BY updated DESC, id DESC`).bind(user.id).all());
  const counts = {};
  const items = list.map(e => {
    const s = editState(e);
    counts[s.key] = (counts[s.key] || 0) + 1;
    return { locale: e.locale, string_id: e.string_id, text: e.text, when: e.updated, state: s };
  });
  const files = (await rows(env.DB.prepare(
    "SELECT created, language, status FROM translation_submissions WHERE user_id = ? ORDER BY id DESC LIMIT 50"
  ).bind(user.id).all())).map(f => ({ when: f.created, language: f.language,
    state: f.status === "done" ? state("done", "Done: we've gone through it") : state("waiting", "Waiting: we read every file") }));
  return { counts, items: items.slice(0, LIMIT), total: items.length, files };
}

// ---- Shared Forever text (contrib_lines, through this account's contrib_uploads) ----

// lib/contribute.js shownStatus in the words of this page: what it's waiting for, or where it went.
export function lineState(l, now = nowSec()) {
  if (l.rejected) return state("rejected", "Rejected: set aside as spam");
  const s = shownStatus(l, now);
  switch (s.key) {
    case "shipped": return state("shipped", l.shipped_in ? `Shipped in ${l.shipped_in}` : "In Lore Forever");
    case "verified":
    case "accepted": return state("accepted", "Accepted: goes into Lore Forever with an update");
    case "new": return state("waiting", "Waiting: accepted after 48 hours, or sooner when a second player sends it");
    case "conflict": return state("waiting", "Waiting: another player sent different words; a second player or a review picks one");
    case "held": return state("waiting", "Waiting: held until a second player sends the same words");
    case "unused": return state("unused", l.pick_reason ? `Not used: ${l.pick_reason}` : "Not used: another version of it was picked");
    default: return state("rejected", "Not used");
  }
}

async function lines(env, user, now) {
  const mine = `FROM contrib_uploads u JOIN contrib_lines l ON l.id = u.line_id WHERE u.user_id = ?`;
  const [list, counted, batches] = await Promise.all([
    rows(env.DB.prepare(
      `SELECT l.kind, l.ref_id, l.part, l.text, l.status, l.first_seen, l.shipped_in, l.flagged, l.pick_reason,
         json_extract(l.speaker, '$.name') AS speaker, MAX(u.created_at) AS sent, MIN(u.rejected) AS rejected
       ${mine} GROUP BY l.id ORDER BY sent DESC LIMIT ${LIMIT}`).bind(user.id).all()),
    rows(env.DB.prepare(
      `SELECT status, flagged, first_seen < ? AS old, shipped_in IS NOT NULL AS has_release, rejected, COUNT(*) AS n
       FROM (SELECT l.status, l.flagged, l.first_seen, l.shipped_in, MIN(u.rejected) AS rejected ${mine} GROUP BY l.id)
       GROUP BY 1, 2, 3, 4, 5`).bind(now - ACCEPT_AFTER, user.id).all()),
    rows(env.DB.prepare(
      "SELECT upload_id, created_at FROM contrib_batches WHERE user_id = ? ORDER BY created_at DESC LIMIT 10"
    ).bind(user.id).all()),
  ]);
  const counts = {};
  let total = 0;
  for (const c of counted) {
    const key = lineState({ status: c.status, flagged: c.flagged, rejected: c.rejected, shipped_in: c.has_release ? "x" : null,
      first_seen: c.old ? 0 : now }, now).key;
    counts[key] = (counts[key] || 0) + c.n;
    total += c.n;
  }
  const items = list.map(l => ({ kind: l.kind, ref_id: l.ref_id, part: l.part, speaker: l.speaker, text: l.text,
    when: new Date(l.sent * 1000).toISOString(), state: lineState(l, now) }));
  return { counts, items, total, receipts: batches.map(b => ({ id: b.upload_id, when: new Date(b.created_at * 1000).toISOString() })) };
}

// ---- Voices: what was sent for review from the upload page, a lent voice, and zone claims ----

export function submissionState(s, live = false) {
  if (s.status === "rejected") return state("rejected", `Not used: ${String(s.reason || "").trim() || "we couldn't use it this time"}`);
  if (live || s.voice_status === "published") return state("shipped", "On the Voices page");
  if (s.status === "done") return state("done", "Reviewed: being built into your pack");
  return state("waiting", "Waiting: we listen to every line");
}

const DONATION = {
  donated: ["waiting", "Waiting: we make a voice from your sample"], rendering: ["waiting", "Being made from your sample"],
  ready: ["waiting", "A test pack is ready: try it from the Lend your voice page"], published: ["shipped", "Published"],
  declined: ["rejected", "Not used: we couldn't make a voice from this recording"], withdrawn: ["withdrawn", "Withdrawn"],
};
const CLAIM = {
  active: ["waiting", "Claimed: recording"], done: ["shipped", "Done: every line recorded"],
  expired: ["withdrawn", "Expired: no upload for 14 days"], released: ["withdrawn", "Let go"],
};

async function voices(env, user, packs) {
  const live = new Set([...packs.values()].filter(c => c.live).map(c => c.id));
  const [sent, lent, claims] = await Promise.all([
    rows(env.DB.prepare(
      `SELECT s.created, s.pack, s.status, s.reason, s.voice_id, v.status AS voice_status FROM voice_submissions s
       LEFT JOIN voices v ON v.id = s.voice_id WHERE s.user_id = ? ORDER BY s.id DESC LIMIT 50`).bind(user.id).all()),
    rows(env.DB.prepare(
      "SELECT created, status, pack_title, reason FROM voice_donations WHERE owner = ? ORDER BY created DESC LIMIT 10").bind(user.id).all()),
    rows(env.DB.prepare(
      "SELECT zone, locale, status, created FROM studio_claims WHERE owner = ? ORDER BY id DESC LIMIT 20").bind(user.id).all()),
  ]);
  return [
    ...sent.map(s => ({ what: "sent", name: s.pack, when: s.created, state: submissionState(s, live.has(s.voice_id)) })),
    ...lent.map(d => ({ what: "lent", name: d.pack_title || "Your lent voice", when: d.created,
      state: d.status === "declined" && d.reason ? state("rejected", `Not used: ${d.reason}`)
        : state(...(DONATION[d.status] || ["waiting", d.status])) })),
    ...claims.map(c => ({ what: "claim", name: c.zone, locale: c.locale, when: c.created,
      state: state(...(CLAIM[c.status] || ["waiting", c.status])) })),
  ].sort((a, b) => String(b.when).localeCompare(String(a.when)));
}

// ---- Reports on recordings (clip_reports; lib/clipreports.js) ----

export const REASONS = { name: "A name said wrong", voice: "The wrong voice", cut: "Cut off", quality: "Sound quality",
  stage: "Stage directions read aloud", text: "The wrong words", other: "Something else" };

// community: the report is on a player's voice (lib/clipreports.js communityPacks), which its narrator records again.
export function reportState(r, community = false) {
  if (r.status === "done") {
    if (r.fixed_in) return state("shipped", `Fixed in ${r.fixed_in}`);
    return state("shipped", community ? "Fixed: its narrator recorded it again" : "Fixed: goes out with the next update");
  }
  if (r.status === "kept") return state("done", "Checked: nothing to change");
  if (r.status === "rejected") return state("rejected", "Rejected: set aside as spam");
  if (community) return state("waiting", "Waiting: sent to the narrator of that voice");
  return state("waiting", "Waiting: we look at every report");
}

async function reports(env, user, packs) {
  const list = await rows(env.DB.prepare(
    `SELECT * FROM clip_reports WHERE user_id = ? ORDER BY id DESC LIMIT ${LIMIT}`).bind(user.id).all());
  return list.map(r => ({ clip: r.clip, voice: r.voice, reason: REASONS[r.reason] || r.reason, name: r.name,
    when: r.created, state: reportState(r, packs.has(r.voice)) }));
}

// Reports on this player's own voices (LOR-621): the lines to record again in the upload page, what's wrong with each,
// never who reported it.
async function onMyVoices(env, user, packs) {
  const mine = [...packs].filter(([, c]) => c.owner === user.id);
  const list = (await safe(narratorReports(env, mine.map(([pack]) => pack)))) || [];
  const byPack = new Map(mine);
  return list.map(r => ({ voice: byPack.get(r.voice)?.name || r.voice, voice_id: byPack.get(r.voice)?.id || null,
    clip: r.clip, reason: REASONS[r.reason] || r.reason, name: r.name, say_as: r.say_as, note: r.note, when: r.created }));
}

// Feedback and bad-translation reports sent while signed in, and Willo's "Wrong answer" flags and corrections (kept
// 90 days, lib/answer-feedback.js; matched by the same hash of the account id it keeps), each with what became of it.
const FEEDBACK_KINDS = { lore: "Wrong or missing lore", bug: "Something broken", idea: "An idea or zone request", review: "A review" };
const WILLO_STATE = { new: ["waiting", "Waiting: we look at every one"], checked: ["done", "Checked: nothing to change"],
  fact: ["shipped", "Fixed: Willo knows it now"], dismissed: ["done", "Set aside"] };
async function sentReports(env, user) {
  await safe(setupReports(env));
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`answer-feedback:${user.id}`)))]
    .map(b => b.toString(16).padStart(2, "0")).join("");
  const [fb, tr, flags] = await Promise.all([
    rows(env.DB.prepare(`SELECT created, kind, message, status, resolution, reason, fixed_in FROM feedback
      WHERE user_id = ? ORDER BY id DESC LIMIT ${LIMIT}`).bind(user.id).all()),
    rows(env.DB.prepare(`SELECT created, locale, wrong, status, resolution, reason, fixed_in FROM translation_reports
      WHERE user_id = ? ORDER BY id DESC LIMIT ${LIMIT}`).bind(user.id).all()),
    rows(env.DB.prepare(`SELECT created, kind, said, question, status FROM answer_feedback
      WHERE user_hash = ? AND kind IN ('flag', 'correction') ORDER BY id DESC LIMIT ${LIMIT}`).bind(hash).all()),
  ]);
  return {
    feedback: fb.map(f => ({ what: FEEDBACK_KINDS[f.kind] || "Feedback", text: f.message, when: f.created, state: reportOutcome(f) })),
    translation_reports: tr.map(r => ({ locale: r.locale, text: r.wrong, when: r.created, state: reportOutcome(r) })),
    willo: flags.map(f => ({ question: f.question, text: f.said, when: f.created,
      state: state(...(WILLO_STATE[f.status] || WILLO_STATE.new)) })),
  };
}

export async function mine(env, user, { request, now = nowSec() } = {}) {
  await safe(setupSubmissions(env));   // voice_submissions.reason
  const packs = request ? await communityPacks(env, request) : new Map();
  const [tr, text, vo, rep, queue, sent] = await Promise.all([translations(env, user), lines(env, user, now),
    voices(env, user, packs), reports(env, user, packs), onMyVoices(env, user, packs), sentReports(env, user)]);
  return { translations: tr, lines: text, voices: vo, reports: rep, voice_reports: queue, ...sent };
}
