// The translation dashboard's API (/translate/dashboard, /account). Translators sign in with their Lore Forever account
// (lib/accounts.js); each saved edit goes into D1 (translation_edits) and, unless it is rejected as spam or
// vandalism, into the language with the next `python -m lore.kit pull`. There is no approval step: Mike doesn't
// speak these languages, and native speakers review on Discord. The checks in public/translate/check.js guard the form.
// like.js and report.js next to this file take their own paths first.
//
// Signed in (session cookie):
//   GET  /api/translations/me                  {user, languages, stats: {locale: {new, accepted, rejected, pulled}}}
//   GET  /api/translations/edits?locale=deDE   your edits in that language: [{string_id, text, status, updated}]
//   GET  /api/translations/reports?locale=deDE open bad-translation reports for that language (no names or emails)
//   GET  /api/translations/pack?locale=deDE    your test pack: a zip of LoreForever_LangTest_deDE/ with your saved
//                                              edits that aren't pulled or rejected (lib/langtest.js); headers
//                                              X-Strings-Included and X-Strings-Stale count them
//   POST /api/translations/languages  {languages: ["deDE", ...]}
//   POST /api/translations/save       {locale, id, en, text}: saves your edit of one string (empty text withdraws it)
//   POST /api/translations/import     {locale, edits: [{id, en, text}]}: an uploaded kit, up to 200 strings a call
// Admin key (lib/auth.js), for /admin and lore.kit:
//   GET  /api/translations/review?status=new&locale=deDE   recent edits (new = saved, not pulled yet), with who made them
//   POST /api/translations/decide     {ids: [...], status: "rejected" | "new"}: reject spam, or restore
//   GET  /api/translations/export?locale=deDE             saved edits not pulled or rejected, and the language's likes,
//                                                         for lore.kit pull and lore.kit community
//   POST /api/translations/pulled     {ids: [...]}: lore.kit pull marks what it imported (lore.kit community: what
//                                     has landed on main)
// Signed-in POSTs must come from our own pages (Origin check) and send JSON.

import { authorized } from "../../../lib/auth.js";
import { setup, currentUser, fail, noStore, sameOrigin } from "../../../lib/accounts.js";
import { LOCALE, likeCounts } from "../../../lib/translations.js";
import { folderName, packZip, sectionsFor, selectEdits } from "../../../lib/langtest.js";
import { problem } from "../../../public/translate/check.js";
import { perMinute, slowDown } from "../../../lib/ratelimit.js";

const ok = (body = {}) => Response.json({ ok: true, ...body }, { headers: noStore });

const ID = /^(ui\/[0-9a-f]{10}|[a-z]+:[a-z0-9-]+\/[A-Za-z0-9:\/_-]{1,120})$/;
const PER_DAY = 5000;   // edits one translator can save in a day
const MAX_TEXT = 20000;
const IMPORT_BATCH = 200;        // strings per POST import (an uploaded kit)
const IMPORTS_PER_MINUTE = 20;   // import calls per person per minute (lib/ratelimit.js)

function localeParam(request) {
  const locale = new URL(request.url).searchParams.get("locale") || "";
  return LOCALE.test(locale) ? locale : null;
}

async function languagesOf(env, user) {
  const { results } = await env.DB.prepare("SELECT locale FROM translator_languages WHERE user_id = ? ORDER BY created")
    .bind(user.id).all();
  return results.map(r => r.locale);
}

// ---- signed in ----

async function me({ env, request }) {
  const user = await currentUser(env, request);
  if (!user) return ok({ user: null });
  const { results } = await env.DB.prepare(
    "SELECT locale, status, COUNT(*) AS n FROM translation_edits WHERE user_id = ? GROUP BY locale, status"
  ).bind(user.id).all();
  const stats = {};
  for (const r of results) (stats[r.locale] ||= { new: 0, accepted: 0, rejected: 0, pulled: 0 })[r.status] = r.n;
  return ok({
    user: { display_name: user.display_name, email: user.email, show_public: Boolean(user.show_public) },
    languages: await languagesOf(env, user),
    stats,
  });
}

async function edits({ env, request }, user) {
  const locale = localeParam(request);
  if (!locale) return fail(400, "Pick a language.");
  const { results } = await env.DB.prepare(
    "SELECT string_id, text, status, updated FROM translation_edits WHERE user_id = ? AND locale = ? ORDER BY id"
  ).bind(user.id, locale).all();
  return ok({ edits: results });
}

async function reports({ env, request }) {
  const locale = localeParam(request);
  if (!locale) return fail(400, "Pick a language.");
  try {
    const { results } = await env.DB.prepare(
      "SELECT id, created, code, place, wrong, better FROM translation_reports WHERE locale = ? AND status != 'done' " +
      "ORDER BY id DESC LIMIT 200"
    ).bind(locale).all();
    return ok({ reports: results });
  } catch (e) {
    return ok({ reports: [] });   // no report has been sent yet, so the table doesn't exist
  }
}

const SECTION = /^(ui|[a-z]+_\d{2})$/;
async function asset(env, request, path) {
  try {
    const res = await env.ASSETS.fetch(new URL(path, request.url));
    return res.ok ? await res.json() : null;
  } catch (e) {
    return null;
  }
}

// Your test pack: your edits in that language that are still waiting for the next update (new or accepted), each
// against today's English. Same folder name every time, so a new download unzips over the old one.
async function pack({ env, request }, user) {
  const locale = localeParam(request);
  if (!locale) return fail(400, "Pick a language.");
  const { results } = await env.DB.prepare(
    "SELECT id, string_id, en, text, updated FROM translation_edits WHERE user_id = ? AND locale = ? AND status IN ('new', 'accepted') ORDER BY id"
  ).bind(user.id, locale).all();
  if (!results.length) return fail(404, "You have no saved edits in this language waiting for the next update.");
  const fp = await asset(env, request, "/translate/fp.json");
  if (!fp || !fp.entries) return fail(503, "Test packs aren't ready yet. Please try again later.");
  const english = {};
  const sections = await Promise.all(sectionsFor(results, fp).filter(s => SECTION.test(s))
    .map(sid => asset(env, request, `/translate/data/en/${sid}.json`)));
  for (const data of sections) {
    for (const [id, en] of (data && data.strings) || []) english[id] = en;
  }
  const selected = selectEdits(results, english, fp);
  if (!selected.included) {
    return fail(409, `The English changed for all ${selected.stale} of your edits since you saved them, so none can be used. Translate them again first.`);
  }
  const lang = (fp.languages || {})[locale] || {};
  const now = new Date();
  const body = packZip(selected, {
    locale, english: fp.english, interface: fp.interface, languageName: lang.name, ttsVoices: lang.ttsVoices,
    built: now.toISOString().slice(0, 16).replace("T", " ") + " UTC",
  }, now);
  return new Response(body, {
    headers: {
      ...noStore,
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${folderName(locale)}.zip"`,
      "X-Strings-Included": String(selected.included),
      "X-Strings-Stale": String(selected.stale),
    },
  });
}

async function languages({ env }, input, user) {
  const wanted = [...new Set((Array.isArray(input.languages) ? input.languages : []).map(String))]
    .filter(l => LOCALE.test(l)).slice(0, 12);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM translator_languages WHERE user_id = ?").bind(user.id),
    ...wanted.map(l => env.DB.prepare("INSERT INTO translator_languages (user_id, locale, created) VALUES (?, ?, ?)")
      .bind(user.id, l, now)),
  ]);
  return ok({ languages: wanted });
}

async function save({ env }, input, user) {
  const locale = String(input.locale || "");
  const id = String(input.id || "");
  const en = typeof input.en === "string" ? input.en : "";
  const text = String(input.text ?? "").replace(/\r\n?/g, "\n").trim();
  if (!LOCALE.test(locale)) return fail(400, "Pick a language.");
  if (!ID.test(id) || !en || en.length > MAX_TEXT) return fail(400, "That string isn't one of ours. Reload the page.");
  if (text.length > MAX_TEXT) return fail(400, "That's too long to save.");

  const mine = await env.DB.prepare(
    "SELECT id FROM translation_edits WHERE user_id = ? AND locale = ? AND string_id = ? AND status IN ('new', 'accepted') ORDER BY id DESC LIMIT 1"
  ).bind(user.id, locale, id).first();
  const now = new Date().toISOString();
  if (!text) {   // cleared: withdraw the edit that's still waiting
    if (mine) await env.DB.prepare("DELETE FROM translation_edits WHERE id = ?").bind(mine.id).run();
    return ok({ status: null });
  }
  const why = problem(id, en, text);
  if (why) return fail(400, why);
  if (mine) {
    await env.DB.prepare("UPDATE translation_edits SET text = ?, en = ?, updated = ?, status = 'new' WHERE id = ?").bind(text, en, now, mine.id).run();
    return ok({ status: "new", updated: now });
  }
  const today = await env.DB.prepare("SELECT COUNT(*) AS n FROM translation_edits WHERE user_id = ? AND created >= ?")
    .bind(user.id, now.slice(0, 10)).first("n");
  if (today >= PER_DAY) return fail(429, "That's a lot of edits for one day. Thank you! Please carry on tomorrow.");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO translation_edits (user_id, locale, string_id, en, text, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(user.id, locale, id, en, text, now, now),
    // Translating a language adds it to your languages.
    env.DB.prepare("INSERT OR IGNORE INTO translator_languages (user_id, locale, created) VALUES (?, ?, ?)").bind(user.id, locale, now),
  ]);
  return ok({ status: "new", updated: now });
}

// A kit uploaded on the dashboard (LOR-121, public/js/bulk-upload.js): up to IMPORT_BATCH strings per call, each
// checked like save and saved like save (status new; it replaces your edit of that string that's still waiting).
// New strings count against PER_DAY. The page has already left out empty strings, strings whose English changed since
// the kit was made, and strings equal to the current text (kit.py apply_strings' rule), and lore.kit pull checks the
// English again. Returns {saved, results: [{id, error?, capped?}], capped}: capped when PER_DAY stopped some.
async function importEdits({ env }, input, user) {
  const locale = String(input.locale || "");
  if (!LOCALE.test(locale)) return fail(400, "Pick a language.");
  const list = Array.isArray(input.edits) ? input.edits : [];
  if (!list.length || list.length > IMPORT_BATCH) return fail(400, `Send 1 to ${IMPORT_BATCH} strings at a time.`);
  if (!(await perMinute(env, user.id, "translation-import", IMPORTS_PER_MINUTE))) return slowDown();

  const edits = new Map();   // the last of each id wins
  for (const e of list) {
    const id = String(e?.id || "");
    edits.set(id, { id, en: typeof e?.en === "string" ? e.en : "", text: String(e?.text ?? "").replace(/\r\n?/g, "\n").trim() });
  }
  const { results: waiting } = await env.DB.prepare(
    "SELECT id, string_id FROM translation_edits WHERE user_id = ? AND locale = ? AND status IN ('new', 'accepted') ORDER BY id"
  ).bind(user.id, locale).all();
  const mine = new Map(waiting.map(r => [r.string_id, r.id]));   // ordered by id, so the latest wins
  const now = new Date().toISOString();
  let today = await env.DB.prepare("SELECT COUNT(*) AS n FROM translation_edits WHERE user_id = ? AND created >= ?")
    .bind(user.id, now.slice(0, 10)).first("n");
  const writes = [], results = [];
  let capped = false, added = 0;
  for (const { id, en, text } of edits.values()) {
    let why = null;
    if (!ID.test(id) || !en || en.length > MAX_TEXT) why = "That string isn't one of ours.";
    else if (!text) why = "Empty.";
    else if (text.length > MAX_TEXT) why = "That's too long to save.";
    else why = problem(id, en, text);
    if (why) { results.push({ id, error: why }); continue; }
    if (mine.has(id)) {
      writes.push(env.DB.prepare("UPDATE translation_edits SET text = ?, en = ?, updated = ?, status = 'new' WHERE id = ?")
        .bind(text, en, now, mine.get(id)));
    } else {
      if (today >= PER_DAY) { capped = true; results.push({ id, error: "That's a lot of edits for one day. Please carry on tomorrow.", capped: true }); continue; }
      today++;
      added++;
      writes.push(env.DB.prepare("INSERT INTO translation_edits (user_id, locale, string_id, en, text, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(user.id, locale, id, en, text, now, now));
    }
    results.push({ id });
  }
  if (added) {
    writes.push(env.DB.prepare("INSERT OR IGNORE INTO translator_languages (user_id, locale, created) VALUES (?, ?, ?)").bind(user.id, locale, now));
  }
  if (writes.length) await env.DB.batch(writes);
  return ok({ saved: results.filter(r => !r.error).length, results, capped, updated: now });
}

// ---- admin ----

const idList = input => (Array.isArray(input.ids) ? input.ids : []).map(n => Number.parseInt(n, 10)).filter(n => n > 0).slice(0, 5000);

async function review({ env, request }) {
  const url = new URL(request.url);
  const status = ["new", "accepted", "rejected", "pulled"].includes(url.searchParams.get("status")) ? url.searchParams.get("status") : "new";
  const locale = localeParam(request);
  const { results } = await env.DB.prepare(
    "SELECT e.id, e.locale, e.string_id, e.en, e.text, e.status, e.created, e.updated, e.reviewed, " +
    "u.display_name, u.email FROM translation_edits e LEFT JOIN users u ON u.id = e.user_id " +
    "WHERE e.status = ?" + (locale ? " AND e.locale = ?" : "") + " ORDER BY e.id DESC LIMIT 2000"
  ).bind(...(locale ? [status, locale] : [status])).all();
  return ok({ edits: results });
}

async function decide({ env }, input) {
  const ids = idList(input);
  if (!["accepted", "rejected", "new"].includes(input.status) || !ids.length) return fail(400, "Needs ids and a status.");
  const now = new Date().toISOString();
  await env.DB.batch(ids.map(id => env.DB.prepare(
    "UPDATE translation_edits SET status = ?, reviewed = ? WHERE id = ? AND status != 'pulled'"
  ).bind(input.status, input.status === "new" ? null : now, id)));
  return ok({ updated: ids.length });
}

async function exportAccepted({ env, request }) {
  const locale = localeParam(request);
  if (!locale) return fail(400, "Needs ?locale=");
  const { results } = await env.DB.prepare(
    "SELECT e.id, e.string_id, e.en, e.text, e.updated, u.display_name AS credit FROM translation_edits e " +
    "LEFT JOIN users u ON u.id = e.user_id WHERE e.status IN ('new', 'accepted') AND e.locale = ? ORDER BY e.updated, e.id"
  ).bind(locale).all();
  // Likes are per language ("I want this one" on /translate), so they only go in lore.kit community's summary.
  return ok({ edits: results, likes: (await likeCounts(env))[locale] || 0 });
}

async function pulled({ env }, input) {
  const ids = idList(input);
  if (ids.length) {
    await env.DB.batch(ids.map(id => env.DB.prepare(
      "UPDATE translation_edits SET status = 'pulled' WHERE id = ? AND status IN ('new', 'accepted')").bind(id)));
  }
  return ok({ updated: ids.length });
}

const USER_GETS = { edits, reports, pack };
const USER_POSTS = { languages, save, import: importEdits };
const ADMIN_GETS = { review, export: exportAccepted };
const ADMIN_POSTS = { decide, pulled };

export async function onRequest(context) {
  const { request, env, params } = context;
  const action = String(params.action);
  const get = request.method === "GET";
  if (!get && request.method !== "POST") return fail(405, "Use GET or POST.");
  if (!env.DB) return fail(503, "Accounts aren't set up yet.");
  await setup(env);

  if (ADMIN_GETS[action] || ADMIN_POSTS[action]) {
    if (!(await authorized(request, env))) return fail(401, "Needs the admin key.");
    if (get) return ADMIN_GETS[action] ? ADMIN_GETS[action](context) : fail(405, "Use POST.");
    if (!ADMIN_POSTS[action]) return fail(405, "Use GET.");
    let input;
    try { input = await request.json(); } catch (e) { return fail(400, "Expected JSON."); }
    return ADMIN_POSTS[action](context, input);
  }

  if (get && action === "me") return me(context);
  if (get && !USER_GETS[action]) return fail(404, "Not found.");
  if (!get && !USER_POSTS[action]) return fail(404, "Not found.");
  if (!get && !sameOrigin(request)) return fail(403, "Please use the dashboard on loreforeverwow.com.");
  const user = await currentUser(env, request);
  if (!user) return fail(401, "You're signed out. Please sign in again.");
  if (get) return USER_GETS[action](context, user);
  let input;
  try { input = await request.json(); } catch (e) { return fail(400, "Couldn't read that."); }
  return USER_POSTS[action](context, input, user);
}
