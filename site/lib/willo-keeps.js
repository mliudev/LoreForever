// "What Willo keeps" (LOR-666; Mike's pick on the second-brain vision page, 10/18): one page, /willo/keeps, that shows
// everything Willo keeps about a player, per character, where every item can be changed or erased, and "Erase
// everything" erases it all. The page is public/willo/keeps.html with public/js/keeps.js; the API is
// functions/api/keeps/[action].js.
//
// Each kind of kept thing is a keeper in KEEPERS, in the order the page shows them. A feature that keeps something
// about a player (the notebook, reminders, goals, journey pins...) adds its keeper here, in the same PR that starts
// keeping it, so the page never misses one. A keeper:
//   id        the section's name in the API and in the app's change stamps: "notebook", "reminders", ...
//   title     its heading on the page; about: one plain line on what it is and why she keeps it
//   kept?     how long it's kept, when it goes by itself ("Kept 14 days, then erased by itself.")
//   empty     what the page says with nothing kept, teaching how it fills ("No goals yet. Tell Willo: ...")
//   list(env, userId) -> {items, more?}   everything kept for the account, newest first. An item:
//               {id: string, unique in the section; character: the add-on's "Name-Realm" or null (all characters);
//                text: what it says, in the player's or Willo's words (what Edit changes); detail?: a short second
//                line ("When you reach Ironforge", "Asked out loud in Elwynn Forest"); reply?: her answer, shown
//                folded; when: ISO time it was made or last changed; due?: ISO time it's for (a reminder at a time,
//                shown on the viewer's clock); done?: true for a ticked to-do, a reached goal or a reminder said}
//   edit?(env, userId, id, text) -> the changed item, or null when it's gone. Leave it out when items can't be edited
//               (a kept answer is a record of what was said).
//   erase(env, userId, id) -> true when it was there
//   eraseAll(env, userId)   every item; "Erase everything" and the section's "Erase all of these" call it
//   eraseCharacter?(env, userId, character)   every item of one character ("Erase all of these" with one picked);
//               without it, each of that character's items is erased in turn
//   local?    true when Willo's app keeps a copy of this (the notebook's notebook.json): any change here stamps the
//             section (stamp below) so the app drops its copy and reads the site's again
//   textMax?  the longest an edit may be (characters); default TEXT_MAX
// The page and the app never see table names or ids beyond the item's own.
//
// Willo's app keeps two kinds of copies: the site's things it keeps to show at once (local keepers), and her chats,
// which live only in the app. Each change the page makes stamps what changed (keeps_changes); the app asks for the
// stamps (GET /api/keeps/changes) when it starts and every few minutes, drops what's stale, and says which it cleared
// (POST /api/keeps/cleared), so the page can say "cleared on your PC". "Erase everything" stamps "chats" too, unless the
// player keeps them: the app then deletes every chat older than the stamp.

import { diagnosticConsent, storageReady, setDiagnosticConsent, playerScreenshots, eraseDiagnostics } from "./diagnostic-screenshots.js";
import { playerKey, playerAnswers, eraseAnswer, forgetAnswerLog, KEEP_DAYS as ANSWER_DAYS } from "./answer-log.js";
import { playerFeedback, eraseFeedback, forgetFeedback, setupFeedback, REASONS, KEEP_DAYS as FEEDBACK_DAYS }
  from "./answer-feedback.js";
import { profileOf, sheetLine } from "./profiles.js";
import { getCustom, PRESETS } from "./willo-custom.js";
import { MEMORIES as MEMORIES_KEEPER } from "./willo-memories.js";
import { NOTEBOOK_KEEPERS } from "./keeps-notebook.js";
import { STOCK_KEEPER } from "./willo-stock.js";
import { COMPANION_NAME as NAME } from "./brand.js";
import { createMissing } from "./schema.js";

export const TEXT_MAX = 2000;
export const CHATS = "chats";   // the stamp that clears the app's chats

export const KEEPS_SETUP = [
  // what: a keeper's id, or CHATS. at: when the page last changed it (ISO). One row per account and kind.
  `CREATE TABLE IF NOT EXISTS keeps_changes (
    user_id TEXT NOT NULL, what TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (user_id, what))`,
  // Which of the account's apps cleared what, and when: the page's "cleared on your PC".
  `CREATE TABLE IF NOT EXISTS keeps_cleared (
    device_id TEXT NOT NULL, user_id TEXT NOT NULL, what TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (device_id, what))`,
  // "Help improve Willo's answers" from the page (keep_answers 1/0, set_at; null: never set there), and as the app last
  // said it was (reported, reported_at). While keep_answers is 0 nothing is kept, whatever the app sends
  // (lib/answer-log.js keepingOff); the app takes the page's choice at its next check, and a later change in the app
  // becomes the account's (changesFor).
  `CREATE TABLE IF NOT EXISTS keeps_settings (
    user_id TEXT PRIMARY KEY, keep_answers INTEGER, set_at TEXT, reported INTEGER, reported_at TEXT)`,
];

export class KeepsError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const ready = new WeakMap();
export async function setupKeeps(env) {
  if (ready.get(env.DB)) return;
  await createMissing(env, KEEPS_SETUP);
  ready.set(env.DB, true);
}

// "Delete my account" (lib/accounts.js deleteUser): the account's stamps. A function, not a USER_DATA list, so
// lib/accounts.js can import it although this file imports lib/profiles.js, which imports lib/accounts.js.
export async function forgetKeeps(env, userId) {
  await setupKeeps(env);
  await env.DB.batch(["keeps_changes", "keeps_cleared", "keeps_settings"].map(t =>
    env.DB.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(userId)));
}

// {player} is how the answer log keeps a character's name (lib/answer-log.js scrubNames).
const named = s => (typeof s === "string" ? s.replaceAll("{player}", "[your name]") : s);
const npcName = key => String(key || "").replace(/^npc:/, "").replace(/[-_]+/g, " ").replace(/\b\p{Ll}/gu, c => c.toUpperCase());
const where = r => [r.sub, r.zone].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", ");

// What she said back to the questions you asked her, kept 14 days for the nightly check (lib/answer-log.js).
const ANSWERS = {
  id: "answers",
  title: "Your questions",
  about: `What you asked ${NAME} and what she said, so we can find and fix her mistakes. Kept only while the switch ` +
    `below is on (it's "Help improve ${NAME}'s answers" in her Settings too).`,
  kept: `Kept ${ANSWER_DAYS} days, then erased by itself.`,
  empty: `Nothing kept. While the switch above is on, what you ask ${NAME} shows here for ${ANSWER_DAYS} days.`,
  async list(env, userId) {
    const { rows, more } = await playerAnswers(env, userId);
    return { more, items: rows.map(r => ({
      id: String(r.id), character: null, text: named(r.question), reply: named(r.answer) || "",
      detail: [r.operation === "character" ? `Asked ${npcName(r.npc) || "a character"} in person` :
        r.spoken ? "Asked out loud" : "Typed", where(r) ? `in ${where(r)}` : ""].filter(Boolean).join(" ") +
        (String(r.signals || "").split(",").includes("reported") ? " · you marked it Not right" : ""),
      when: r.created })) };
  },
  erase: (env, userId, id) => eraseAnswer(env, userId, id),
  eraseAll: (env, userId) => forgetAnswerLog(env, userId),
};

// What you told her was wrong, or said when an answer missed (lib/answer-feedback.js): the review queue's rows you sent,
// with what became of each.
const HOW = { report: "You marked it Not right", flag: "You pressed Wrong answer", correction: "You told her what's right",
  misheard: "You told her what you meant", frustration: "You said it missed", gave_up: "You said never mind" };
const STATE = { triaged: "We're looking into it", fixed: `Fixed: ${NAME} has learned it`, fact: `Fixed: ${NAME} has learned it`,
  checked: "Checked: her answer stands", dismissed: "Set aside" };
// A report's own words when the player wrote a note, else the question it was about; what they said, for the rest.
const shownSaid = r => (["report", "flag"].includes(r.kind) && (r.said === "Wrong answer" ||
  r.said === r.reasons.map(x => REASONS[x]).join(", ")) ? r.question || r.said : r.said);
const FEEDBACK = {
  id: "wrong",
  title: "Answers you said were wrong",
  about: `When you mark an answer Not right, or tell ${NAME} it's wrong, we keep what you said, the question and her ` +
    `answer, without your name, so we can fix it.`,
  kept: `Kept ${FEEDBACK_DAYS} days, then erased by itself, unless you asked her to tell you when it's fixed: then until ` +
    `it's fixed. A fix we made from it stays.`,
  empty: `Nothing kept. When an answer misses, press Not right under it, or tell ${NAME} "that's wrong".`,
  async list(env, userId) {
    const { rows, more } = await playerFeedback(env, userId);
    return { more, items: rows.map(r => ({
      id: String(r.id), character: null, text: named(shownSaid(r)), reply: named(r.answer) || "",
      detail: [HOW[r.kind] || HOW.report,
        r.reasons.length ? `(${r.reasons.map(x => (REASONS[x] || x).toLowerCase()).join(", ")})` : "",
        where(r) ? `in ${where(r)}` : ""].filter(Boolean).join(" ") +
        (STATE[r.status] ? ` · ${STATE[r.status]}` : r.followup ? " · She'll tell you when it's fixed" : ""),
      done: ["fixed", "fact"].includes(r.status) || undefined,
      when: r.created })) };
  },
  erase: (env, userId, id) => eraseFeedback(env, userId, id),
  eraseAll: async (env, userId) => { await setupFeedback(env); await forgetFeedback(env, userId); },
};

// Her notebook's four (lib/keeps-notebook.js: notes, goals, pins, reminders) first, then what she keeps of your questions.
const SCREENSHOTS = {
  id: "screenshots", title: "Screenshots used to improve answers",
  about: "Only game images already supplied with an answer: reported mistakes and a 1% sample, at most 3 a day per player and no more than 50 a day across all players. Images may contain names or chat; they are not anonymous. Only you and the Lore Forever team can see them. Willo blanks out only the small ring of stars her add-on draws on your screen; nothing else is hidden.",
  kept: "Kept until you erase them. Turning this switch off, or answer logging off, erases them all.",
  empty: "No screenshots kept. This separate choice starts off and needs \"Help improve Willo's answers\" on.",
  async list(env, userId) {
    return { items: (await playerScreenshots(env, userId)).map(r => ({ id: String(r.answer_id),
      character: null, text: named(r.question), reply: named(r.answer), when: r.created,
      detail: r.reason === "report" ? "Reported mistake" : "Random sample", image: `/api/keeps/screenshot?ref=${r.ref}` })) };
  },
  erase: async (env, userId, id) => { await eraseDiagnostics(env, await playerKey(env, userId), Number(id)); return true; },
  eraseAll: async (env, userId) => eraseDiagnostics(env, await playerKey(env, userId)),
};
// What she remembers about you (lib/willo-memories.js, LOR-729): short facts you told her, which her own answers use. Its
// edit checks the new words like a save in her window does, and says why when they are turned away.
const MEMORIES = { ...MEMORIES_KEEPER, async edit(env, userId, id, text) {
  try { return await MEMORIES_KEEPER.edit(env, userId, id, text); }
  catch (e) { throw e?.memory ? new KeepsError(e.message, e.status) : e; }
} };

export const KEEPERS = [...NOTEBOOK_KEEPERS, MEMORIES, STOCK_KEEPER, ANSWERS, FEEDBACK, SCREENSHOTS];

export const keeperOf = id => KEEPERS.find(k => k.id === id) || null;

// The add-on's key for a character, as the notebook keeps it ("Húrin-ClassicBetaPvE").
export const characterKey = (name, realm) => (typeof name === "string" && name ?
  (realm ? `${name}-${realm}` : name).normalize("NFC") : null);

// The journey isn't Willo's: the add-on writes it in the game folder as you play, Willo reads it there, and the site
// keeps a copy for the profile page (lib/profiles.js). The page shows that copy and sends the player to Delete my
// profile on /account to erase it; "Erase everything" leaves it, and says so.
async function journeyCopy(env, userId) {
  const p = await profileOf(env, userId);
  if (!p) return null;
  const moments = Array.isArray(p.journey?.moments) ? p.journey.moments.length : 0;
  return { character: characterKey(p.data.name, p.data.realm), name: p.data.name, realm: p.data.realm || null,
    sheet: sheetLine(p.data), moments, updated: p.updated, handle: p.handle, public: Boolean(p.public) };
}

// What friends see about you (lib/friends.js): whether you share where you are, the note they see while you do, and how
// many friends you have. Your messages with them are kept 90 days and aren't listed here (they're both of yours).
async function friendsOf(env, userId) {
  const [me, count] = await Promise.all([
    env.DB.prepare("SELECT share, progress, progress_at FROM friend_people WHERE user_id = ?").bind(userId).first(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM friend_edges WHERE user_id = ? AND state = 'friends'").bind(userId).first("n"),
  ]);
  let shared = null;
  try { shared = me?.share && me.progress ? JSON.parse(me.progress) : null; } catch (e) { /* none */ }
  return { share: Boolean(me?.share), shared, at: me?.progress_at || null, friends: count || 0 };
}

// How she talks to you (lib/willo-custom.js, /willo/style): your style and your own tales, which reach her answers.
// Changed and deleted on that page.
async function styleOf(env, userId) {
  const custom = await getCustom(env, { id: userId }, null);
  const preset = PRESETS[custom.style.preset];
  return { preset: custom.style.preset === "classic" ? null : preset?.name || null, words: custom.style.text || "",
    tales: custom.tales.map(t => npcName(t.npc)) };
}

// "Help improve Willo's answers": on, off, or null when neither the page nor the app has said yet (on by default).
async function settingsOf(env, userId) {
  return env.DB.prepare("SELECT keep_answers, set_at, reported, reported_at FROM keeps_settings WHERE user_id = ?")
    .bind(userId).first();
}
const keepAnswersOf = row => row?.keep_answers != null ? Boolean(row.keep_answers)
  : row?.reported != null ? Boolean(row.reported) : null;

// The page's switch: off stops keeping at once (lib/answer-log.js keepingOff); the app follows at its next check.
export async function setKeepAnswers(env, userId, on, now = new Date()) {
  if (typeof on !== "boolean") throw new KeepsError("Couldn't read that.");
  await setupKeeps(env);
  if (!on) await setDiagnosticConsent(env, userId, false);
  await env.DB.prepare("INSERT INTO keeps_settings (user_id, keep_answers, set_at) VALUES (?, ?, ?) " +
    "ON CONFLICT (user_id) DO UPDATE SET keep_answers = excluded.keep_answers, set_at = excluded.set_at")
    .bind(userId, on ? 1 : 0, now.toISOString()).run();
  return on;
}

// When the page last changed each kind for the account, and which apps cleared what since.
async function stampsOf(env, userId) {
  const [changes, cleared] = await Promise.all([
    env.DB.prepare("SELECT what, at FROM keeps_changes WHERE user_id = ?").bind(userId).all(),
    env.DB.prepare("SELECT c.device_id, c.what, c.at, d.label FROM keeps_cleared c JOIN devices d ON d.id = c.device_id " +
      "WHERE c.user_id = ?").bind(userId).all(),
  ]);
  return { changes: Object.fromEntries(changes.results.map(r => [r.what, r.at])), cleared: cleared.results };
}

async function stamp(env, userId, whats, now) {
  if (!whats.length) return;
  await env.DB.batch(whats.map(what => env.DB.prepare("INSERT INTO keeps_changes (user_id, what, at) VALUES (?, ?, ?) " +
    "ON CONFLICT (user_id, what) DO UPDATE SET at = excluded.at").bind(userId, what, now.toISOString())));
}

// The page's whole view: each section with its items, the characters they're for, the journey's copy, and whether the
// app has caught up with the last erase (apps: each connected app, and when it last cleared its copies).
export async function keepsView(env, userId) {
  await setupKeeps(env);
  const [sections, journey, stamps, apps, friends, style, settings] = await Promise.all([
    Promise.all(KEEPERS.map(async k => {
      const { items, more = false } = await k.list(env, userId);
      return { id: k.id, title: k.title, about: k.about, kept: k.kept || null, empty: k.empty,
        edit: typeof k.edit === "function", items, more };
    })),
    journeyCopy(env, userId),
    stampsOf(env, userId),
    env.DB.prepare("SELECT id, label, last_used FROM devices WHERE user_id = ? ORDER BY created").bind(userId).all(),
    friendsOf(env, userId),
    styleOf(env, userId),
    settingsOf(env, userId),
  ]);
  const characters = new Map();
  const add = key => {
    if (!key || characters.has(key)) return;
    const [name, ...realm] = key.split("-");
    characters.set(key, { key, name, realm: realm.join("-") || null });
  };
  add(journey?.character);
  for (const s of sections) for (const item of s.items) add(item.character);
  // An app has caught up when it cleared every kind the page changed for a local copy, at or after that change.
  const local = new Set([...KEEPERS.filter(k => k.local).map(k => k.id), CHATS]);
  const pending = Object.entries(stamps.changes).filter(([what]) => local.has(what));
  return {
    sections, journey, characters: [...characters.values()],
    apps: apps.results.map(d => {
      const mine = stamps.cleared.filter(c => c.device_id === d.id);
      const behind = pending.filter(([what, at]) => !mine.some(c => c.what === what && c.at >= at));
      return { label: d.label, last_used: d.last_used, caught_up: !behind.length,
        chats_cleared: mine.find(c => c.what === CHATS)?.at || null };
    }),
    chats_erased: stamps.changes[CHATS] || null,
    friends, style, keep_answers: keepAnswersOf(settings),
    keep_screenshots: Boolean(await diagnosticConsent(env, userId)),
    screenshots_available: Boolean(env.STUDIO && storageReady(env)),
  };
}

// "Download everything": the page as one markdown file, readable as it is. Times in UTC.
export async function keepsExport(env, userId, now = new Date()) {
  const v = await keepsView(env, userId);
  const day = iso => String(iso || "").replace("T", " ").slice(0, 16) + (iso ? " UTC" : "");
  const names = new Map(v.characters.map(c => [c.key, c.realm ? `${c.name} (${c.realm})` : c.name]));
  const out = [`# What ${NAME} keeps`, "", `Everything ${NAME} kept about you on ${now.toISOString().slice(0, 10)}.`];
  for (const s of v.sections) {
    out.push("", `## ${s.title}`, "", s.about + (s.kept ? ` ${s.kept}` : ""), "");
    if (!s.items.length) out.push("Nothing kept.");
    for (const [key, items] of Object.entries(Object.groupBy(s.items, i => i.character || ""))) {
      out.push(`### ${key ? names.get(key) || key : "All characters"}`, "");
      for (const i of items) {
        out.push(`- ${i.done ? "[done] " : ""}${i.text}`, `  ${[i.detail, day(i.when)].filter(Boolean).join(" · ")}`);
        if (i.reply) out.push(`  She said: ${i.reply.replace(/\s+/g, " ")}`);
      }
      out.push("");
    }
  }
  const j = v.journey;
  out.push("", "## Your journey", "", j ? `${j.name}${j.sheet ? `, ${j.sheet}` : ""}: ${j.moments} moments, last copied ` +
    `${day(j.updated)}. Your profile is ${j.public ? "public" : "private"}.` : "No profile, so no copy is kept.");
  const f = v.friends;
  out.push("", "## What your friends see", "", `${f.friends} friend${f.friends === 1 ? "" : "s"}. ` + (f.share
    ? `You share where you are: ${[f.shared?.character, f.shared?.level ? `level ${f.shared.level}` : "",
      [f.shared?.sub, f.shared?.zone].filter(Boolean).join(", "), f.shared?.quest].filter(Boolean).join(" · ") || "nothing yet"}.`
    : "You don't share where you are."));
  const st = v.style;
  out.push("", "## How she talks to you", "", [st.preset ? `Style: ${st.preset}.` : "Style: Classic.",
    st.words ? `Your words: ${st.words}` : "", st.tales.length ? `Your tales: ${st.tales.join(", ")}.` : ""]
    .filter(Boolean).join(" "));
  out.push("", "## Your chats with her", "", "Kept in her window on your computer, never on the site.", "");
  return out.join("\n");
}

const keeper = id => {
  const k = keeperOf(id);
  if (!k) throw new KeepsError("Couldn't tell which part of the page that is.");
  return k;
};
const itemId = id => {
  if (typeof id !== "string" || !id || id.length > 200) throw new KeepsError("Couldn't tell which one that is.");
  return id;
};

export async function editItem(env, userId, { section, id, text }, now = new Date()) {
  const k = keeper(section);
  if (typeof k.edit !== "function") throw new KeepsError("That one can't be changed, only erased.");
  if (typeof text !== "string" || !text.trim()) throw new KeepsError("Write something, or erase it instead.");
  if ([...text].length > (k.textMax || TEXT_MAX)) throw new KeepsError("That's too long.");
  await setupKeeps(env);
  const item = await k.edit(env, userId, itemId(id), text.trim());
  if (!item) throw new KeepsError("That one's already gone.", 404);
  if (k.local) await stamp(env, userId, [k.id], now);
  return item;
}

export async function eraseItem(env, userId, { section, id }, now = new Date()) {
  const k = keeper(section);
  await setupKeeps(env);
  const gone = await k.erase(env, userId, itemId(id));
  if (k.local) await stamp(env, userId, [k.id], now);
  return gone;
}

// Every item of one kind, or only one character's (character: the add-on's key) when the page shows one character.
// A keeper erases one character's itself with eraseCharacter(env, userId, character), or item by item.
export async function eraseSection(env, userId, { section, character }, now = new Date()) {
  const k = keeper(section);
  await setupKeeps(env);
  if (character === undefined) await k.eraseAll(env, userId);
  else if (typeof character !== "string" || !character || character.length > 80) {
    throw new KeepsError("Couldn't tell which character that is.");
  } else if (typeof k.eraseCharacter === "function") await k.eraseCharacter(env, userId, character);
  else {
    const { items } = await k.list(env, userId);
    for (const item of items.filter(i => i.character === character)) await k.erase(env, userId, item.id);
  }
  if (k.local) await stamp(env, userId, [k.id], now);
}

// Erase everything: every keeper's items, and the app's chats unless keepChats. The journey's copy stays (journeyCopy).
export async function eraseEverything(env, userId, { keepChats = false } = {}, now = new Date()) {
  await setupKeeps(env);
  for (const k of KEEPERS) await k.eraseAll(env, userId);
  await stamp(env, userId, [...KEEPERS.filter(k => k.local).map(k => k.id), ...(keepChats ? [] : [CHATS])], now);
}

// ---- Willo's app ----

// GET /api/keeps/changes: {changes: {what: at}, settings} for this account: the stamps the app checks its copies
// against, and the page's choice for "Help improve Willo's answers" ({keep_answers: {on, at}}) when it made one. The app
// says how its own switch is (keepAnswers: true/false, or null from an app that doesn't say) and when it last took the
// page's choice (applied): a switch changed in the app after that becomes the account's choice.
export async function changesFor(env, userId, { keepAnswers = null, applied = "" } = {}, now = new Date()) {
  await setupKeeps(env);
  const [{ changes }, row] = await Promise.all([stampsOf(env, userId), settingsOf(env, userId)]);
  let choice = row;
  if (keepAnswers === false) await setDiagnosticConsent(env, userId, false);
  if (typeof keepAnswers === "boolean") {
    const said = keepAnswers ? 1 : 0;
    const writes = [];
    if (row?.reported !== said) {
      writes.push(env.DB.prepare("INSERT INTO keeps_settings (user_id, reported, reported_at) VALUES (?, ?, ?) " +
        "ON CONFLICT (user_id) DO UPDATE SET reported = excluded.reported, reported_at = excluded.reported_at")
        .bind(userId, said, now.toISOString()));
    }
    if (row?.keep_answers != null && row.keep_answers !== said && typeof applied === "string" && applied >= row.set_at) {
      writes.push(env.DB.prepare("UPDATE keeps_settings SET keep_answers = ?, set_at = ? WHERE user_id = ?")
        .bind(said, now.toISOString(), userId));
      choice = { ...row, keep_answers: said, set_at: now.toISOString() };
    }
    if (writes.length) await env.DB.batch(writes);
  }
  return { changes, settings: choice?.keep_answers != null
    ? { keep_answers: { on: Boolean(choice.keep_answers), at: choice.set_at } } : {} };
}

// POST /api/keeps/cleared {cleared: {what: at}}: the app dropped its copies as of those stamps. Only stamps the page
// made count, and never one later than the page's.
export async function markCleared(env, device, userId, cleared) {
  await setupKeeps(env);
  if (!cleared || typeof cleared !== "object" || Array.isArray(cleared)) throw new KeepsError("Couldn't read that.");
  const { changes } = await stampsOf(env, userId);
  const done = Object.entries(cleared).filter(([what, at]) => typeof at === "string" && Object.hasOwn(changes, what)
    && at <= changes[what]);
  if (!done.length) return [];
  await env.DB.batch(done.map(([what, at]) => env.DB.prepare("INSERT INTO keeps_cleared (device_id, user_id, what, at) " +
    "VALUES (?, ?, ?, ?) ON CONFLICT (device_id, what) DO UPDATE SET at = MAX(at, excluded.at)")
    .bind(device.id, userId, what, at)));
  return done.map(([what]) => what);
}

// ---- By voice ----
// What Willo keeps, asked of her (LOR-844 step 6): "Help improve answers" off at once, and a kind of kept thing, or
// everything, erased only on a plain yes to her read-back with its count (the friends' hold, lib/friend-send.js
// holdChange and changeReply; it does them with keepsChange below). On the site only, so every Willo has it. Her notes,
// reminders, goals, pins and memories have their own tools, and one item is the page's.
export const KEEPS_TOOL = "keeps";
const BY_VOICE = { answers: "questions I kept", wrong: "answers you marked wrong", screenshots: "screenshots",
  saves: "game saves" };
// Every kind said aloud in "erase everything"'s read-back (the Architect, #2057: the page's titles read long).
const SAID_AS = { notebook: "notebook lines", goals: "goals", pins: "pins", reminders: "reminders",
  memories: "things I remember", answers: "questions", screenshots: "screenshots" };
// The end of each read-back, which a yes answers (friend-send.js DOES): one each, so a yes does only what was read back.
export const KEEPS_DOES = { "keeps:answers": "erase your questions", "keeps:wrong": "erase your reports",
  "keeps:screenshots": "erase your screenshots", "keeps:saves": "erase your game saves", "keeps:all": "erase everything" };
export const keepsTool = () => ({ name: KEEPS_TOOL, description: `What you keep of them (What ${NAME} keeps), when ` +
  `they ask to change it. op: answers_off, keep none of their questions from now on ("stop using my questions", "turn ` +
  `off help improve answers"), done at once; erase, take away all of one kind already kept ("erase the questions you ` +
  `kept", "delete my screenshots"), read back with its count for their yes (section: answers, their questions and your answers, kept 14 days; ` +
  `wrong, answers they marked wrong; screenshots; saves, the game saves you read their gear from); erase_all, ` +
  `everything you keep of them and your chats ("forget everything", "wipe all my data"), read back for their yes; ` +
  `page, for one kept answer or turning Help improve answers back on. Notes, reminders, goals, pins and memories have ` +
  `their own tools.`,
  parameters: { type: "object", properties: { op: { type: "string", enum: ["answers_off", "erase", "erase_all", "page"] },
    section: { type: "string", enum: Object.keys(BY_VOICE) } }, required: ["op"] } });

const counted = async (env, userId, k) => {
  const { items = [], more } = await k.list(env, userId);
  return { n: items.length, more: Boolean(more) };
};
const many = ({ n, more }, what) => `${more ? "all " : ""}${n}${more ? "+" : ""} ${what}`;

// Her call: {answer} (answers off, or nothing to erase), {hold: {kind, recipient, body}, answer} (an erase read back,
// held for their yes), or null for any other call.
export async function keepsCall(env, userId, call, now = new Date()) {
  if (call?.name !== KEEPS_TOOL) return null;
  await setupKeeps(env);
  const op = call.args?.op;
  // One item, or the switch turned on under its explanation: the page's (consent is a click there).
  if (op === "page") return { answer: `That's on What ${NAME} keeps: each answer has its own Erase, and Help improve ` +
    `answers is the switch at the top.` };
  if (op === "answers_off") {
    await setKeepAnswers(env, userId, false, now);
    return { answer: `Done: I've stopped keeping your questions to improve my answers. It's on What ${NAME} keeps if you want it back.` };
  }
  if (op === "erase" && Object.hasOwn(BY_VOICE, call.args?.section)) {
    const section = call.args.section, count = await counted(env, userId, keeper(section));
    if (!count.n) return { answer: `There's nothing kept there.` };
    return { hold: { kind: `keeps:${section}`, recipient: "me", body: "" },
      answer: `Erase ${many(count, BY_VOICE[section])}? Say yes and I'll ${KEEPS_DOES[`keeps:${section}`]}.` };
  }
  if (op === "erase_all") {
    const counts = [];
    for (const k of KEEPERS) {
      const c = await counted(env, userId, k);
      if (c.n) counts.push([c, SAID_AS[k.id] || BY_VOICE[k.id] || String(k.title || k.id).toLowerCase()]);
    }
    const top = counts.sort((a, b) => b[0].n - a[0].n).slice(0, 3).map(([c, what]) => many(c, what));
    const rest = counts.length > 3 ? ", and the rest" : "";
    return { hold: { kind: "keeps:all", recipient: "me", body: "" },
      answer: `Erase everything I keep${top.length ? ` (${top.join(", ")}${rest})` : ""}, and our chats? ` +
        `Say yes and I'll ${KEEPS_DOES["keeps:all"]}.` };
  }
  return null;
}
// Their yes to a held erase (friend-send.js doChange): {answer}. What's there then is erased.
export async function keepsChange(env, userId, held, now = new Date()) {
  const section = String(held.kind).slice("keeps:".length);
  if (section === "all") {
    await eraseEverything(env, userId, {}, now);
    return { answer: "Done. Everything I kept is erased, and our chats too." };
  }
  if (!Object.hasOwn(BY_VOICE, section)) return { answer: "I didn't do that one." };
  await eraseSection(env, userId, { section }, now);
  return { answer: `Done. Your ${BY_VOICE[section]} are erased.` };
}
