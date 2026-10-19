// What Willo keeps (lib/willo-keeps.js, LOR-666) for her notebook (lib/willo-notebook.js, LOR-661): four keepers over
// the same pages and reminders, so each kind has its own section on the page.
//   notebook   every line of the notebook outside the headings below: to-dos, notes and lists
//   goals      the lines under "## Goals" (LOR-665: "- [ ] Riding at level 40: 100 gold"; ticked is reached)
//   pins       the lines under "## Pins" (LOR-664: "- Kobold den: the elite inside hits hard · Fargodeep Mine, Elwynn
//              Forest (south, 41, 65) · October 18")
//   reminders  the notebook's reminders (notebook_reminders, LOR-663): each with its moment, said or not
// A line's id is its page, its place on the page and a short hash of its words, so a change made meanwhile (Willo, a
// hand edit in the tab) is found again by its words. Every write is checked against the page's version.
//
// Erased means erased: a line goes from the page and from its Undo (prev_body), and a page left empty stays as an empty
// page with its version going on, so the Notebook tab's older copy of it can never be saved over it (a deleted page
// would start again at version 1, the version an old tab may still hold). Each is a local keeper: Willo's app drops
// its notebook.json and reads the site again (companion/lore_companion/keeps.py, core erase handlers), which also
// drops what she last said of a goal no longer there (goals.py prune_marks).

import { cleanItem, tidy, reminderWhen, NOTEBOOK_SETUP } from "./willo-notebook.js";
import { COMPANION_NAME as NAME } from "./brand.js";

const ITEM_MAX = 300;         // characters of a line changed on the page
const TRIES = 3;              // writes tried on a page changed meanwhile

const ready = new WeakMap();
async function setupNotebook(env) {
  if (ready.get(env.DB)) return;
  await env.DB.batch(NOTEBOOK_SETUP.map(sql => env.DB.prepare(sql)));
  ready.set(env.DB, true);
}

// ---- The page's lines ----

function lineOf(raw) {
  let m;
  if ((m = /^(#{1,6})\s+(.*)$/.exec(raw))) return { kind: "heading", level: m[1].length, text: m[2].trim(), raw };
  if ((m = /^(\s*[-*+]\s+)\[( |x|X)\]\s*(.*)$/.exec(raw))) return { kind: "todo", lead: `${m[1]}[${m[2]}] `, done: m[2] !== " ", text: m[3].trim(), raw };
  if ((m = /^(\s*(?:[-*+]|\d{1,3}[.)])\s+)(.*)$/.exec(raw))) return { kind: "bullet", lead: m[1], text: m[2].trim(), raw };
  if (!raw.trim()) return { kind: "blank", raw };
  return { kind: "text", lead: "", text: raw.trim(), raw };
}
const linesOf = body => String(body || "").replace(/\r\n?/g, "\n").split("\n").map(lineOf);
const isItem = l => l.kind === "todo" || l.kind === "bullet" || l.kind === "text";
// "Goals", "## goals", "Goal list" are one heading, as lib/willo-notebook.js headingKey reads them.
const headingKey = text => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").replace(/list$/, "").replace(/s$/, "");
const SECTION_OF = { goal: "goals", pin: "pins" };
// Which keeper a line is in: by the heading above it (any level), else the notebook's.
function sectioned(body) {
  let under = "notebook", heading = "";
  return linesOf(body).map((l, i) => {
    if (l.kind === "heading") { under = SECTION_OF[headingKey(l.text)] || "notebook"; heading = l.text; }
    return { ...l, i, under, heading };
  });
}
// A short, stable hash of a line's words (FNV-1a), for finding it again.
const hashOf = s => {
  let h = 0x811c9dc5;
  for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
};
const idOf = (page, l) => `${page}|${l.i}|${hashOf(l.raw.trim())}`;
function readId(id) {
  const m = /^(account|char:[^|]{3,80})\|(\d{1,4})\|([0-9a-z]{1,8})$/u.exec(String(id || ""));
  return m ? { page: m[1], i: Number(m[2]), hash: m[3] } : null;
}
// The line an id names on the page as it is now: at its place when its words are still there, else wherever they are.
function findLine(lines, ref) {
  const at = lines[ref.i];
  if (at && isItem(at) && hashOf(at.raw.trim()) === ref.hash) return at;
  return lines.find(l => isItem(l) && hashOf(l.raw.trim()) === ref.hash) || null;
}
const characterOf = page => (page.startsWith("char:") ? page.slice(5) : null);

// The body without the lines `drop` names, and without a heading left with nothing under it.
function without(lines, drop) {
  const kept = lines.filter(l => !drop(l));
  const out = kept.filter((l, n) => {
    if (l.kind !== "heading") return true;
    const next = kept.slice(n + 1).find(x => x.kind !== "blank");
    return next && !(next.kind === "heading" && next.level <= l.level);
  });
  return tidy(out.map(l => l.raw).join("\n"));
}

// ---- Writing a page ----

const pageRow = (env, userId, page) => env.DB.prepare("SELECT page, body, version, updated FROM notebook_pages " +
  "WHERE user_id = ? AND page = ?").bind(userId, page).first();
// The page changed by `change` (its lines -> the new body, or null for no change), if it's still the version read;
// tried again on a newer one. undo: keep the page before for the tab's Undo (a change), or not (an erase).
async function rewrite(env, userId, page, change, { undo = false, now = new Date() } = {}) {
  for (let tries = 0; tries < TRIES; tries++) {
    const row = await pageRow(env, userId, page);
    if (!row) return null;
    const body = change(sectioned(row.body));
    if (body === null || body === row.body) return { row, changed: false };
    const res = await env.DB.prepare(`UPDATE notebook_pages SET body = ?, prev_body = ${undo ? "body" : "NULL"}, ` +
      "version = version + 1, updated = ? WHERE user_id = ? AND page = ? AND version = ?")
      .bind(body, now.toISOString(), userId, page, row.version).run();
    if (res.meta.changes) return { row: { ...row, body, version: row.version + 1, updated: now.toISOString() }, changed: true };
  }
  return null;
}
// Every page of the account with at least one line of the section (or one character's page).
async function pagesWith(env, userId, section, character = undefined) {
  await setupNotebook(env);
  const { results } = await env.DB.prepare("SELECT page, body, version, updated FROM notebook_pages WHERE user_id = ? " +
    "ORDER BY page = 'account' DESC, updated DESC").bind(userId).all();
  return results.filter(r => (character === undefined || r.page === `char:${character}`)
    && sectioned(r.body).some(l => isItem(l) && l.under === section));
}

// One keeper over the lines of one section of the notebook.
function lineKeeper(section, { title, about, empty, detail }) {
  const itemOf = (row, l) => ({ id: idOf(row.page, l), character: characterOf(row.page), text: l.text,
    detail: detail(l), when: row.updated, ...(l.done ? { done: true } : {}) });
  const eraseWhere = async (env, userId, rows) => {
    for (const r of rows) await rewrite(env, userId, r.page, lines => without(lines, l => isItem(l) && l.under === section));
  };
  return {
    id: section, title, about, empty, local: true, textMax: ITEM_MAX,
    async list(env, userId) {
      const rows = await pagesWith(env, userId, section);
      return { items: rows.flatMap(row => sectioned(row.body).filter(l => isItem(l) && l.under === section)
        .map(l => itemOf(row, l))) };
    },
    async edit(env, userId, id, text) {
      const ref = readId(id);
      const words = cleanItem(text, ITEM_MAX);
      if (!ref || !words) return null;
      let line = null;
      const done = await rewrite(env, userId, ref.page, lines => {
        const l = findLine(lines, ref);
        if (!l || l.under !== section) return null;
        line = l;
        return tidy(lines.map(x => (x === l ? `${l.lead || ""}${words}` : x.raw)).join("\n"));
      }, { undo: true });
      if (!done || !line) return null;
      const now = sectioned(done.row.body)[line.i];
      return now ? itemOf(done.row, now) : null;
    },
    async erase(env, userId, id) {
      const ref = readId(id);
      if (!ref) return false;
      let found = false;
      await rewrite(env, userId, ref.page, lines => {
        const l = findLine(lines, ref);
        if (!l || l.under !== section) return null;
        found = true;
        return without(lines, x => x === l);
      });
      return found;
    },
    eraseAll: async (env, userId) => eraseWhere(env, userId, await pagesWith(env, userId, section)),
    eraseCharacter: async (env, userId, character) => eraseWhere(env, userId, await pagesWith(env, userId, section, character)),
  };
}

const NOTES = lineKeeper("notebook", {
  title: "Notebook",
  about: `Notes, to-dos and lists ${NAME} keeps when you ask her to, one page for each character and one for all of them.`,
  empty: `Nothing in your notebook yet. Tell ${NAME}: "Remember I need 10 linen cloth."`,
  detail: l => [l.heading, l.kind === "todo" ? (l.done ? "Done" : "To do") : ""].filter(Boolean)
    .filter((v, i, a) => a.findIndex(x => x.toLowerCase() === v.toLowerCase()) === i).join(" · "),
});
const GOALS = lineKeeper("goals", {
  title: "Goals",
  about: `What you told ${NAME} you're working toward. She checks your progress from the game as you play, and keeps ` +
    "only the goal itself.",
  empty: `No goals yet. Tell ${NAME}: "I want my mount at 40."`,
  detail: l => (l.done ? "Reached" : "Working on it"),
});
const PINS = lineKeeper("pins", {
  title: "Pins",
  about: `Spots you asked ${NAME} to remember, with what you said about them.`,
  empty: `No pins yet. Where you stand, tell ${NAME}: "Pin this spot."`,
  detail: () => "",
});

// The notebook's reminders: each one's moment, and when she said it.
const REMINDERS = {
  id: "reminders",
  title: "Reminders",
  about: `What you asked ${NAME} to tell you, and when: on reaching a place or a level, or at a time.`,
  empty: `No reminders. Tell ${NAME}: "When I reach Ironforge, remind me to train."`,
  local: true,
  textMax: ITEM_MAX,
  async list(env, userId) {
    await setupNotebook(env);
    const { results } = await env.DB.prepare("SELECT id, page, text, kind, place, level, at, created, fired " +
      "FROM notebook_reminders WHERE user_id = ? ORDER BY fired IS NULL DESC, created DESC").bind(userId).all();
    return { items: results.map(r => ({ id: r.id, character: characterOf(r.page), text: r.text,
      detail: [r.kind === "time" ? "" : reminderWhen(r).replace(/^./, c => c.toUpperCase()), r.fired ? "Said" : ""]
        .filter(Boolean).join(" · "), ...(r.kind === "time" && r.at ? { due: r.at } : {}), when: r.created,
      ...(r.fired ? { done: true } : {}) })) };
  },
  async edit(env, userId, id, text) {
    const words = cleanItem(text, ITEM_MAX);
    if (!words) return null;
    await setupNotebook(env);
    const res = await env.DB.prepare("UPDATE notebook_reminders SET text = ? WHERE id = ? AND user_id = ?")
      .bind(words, String(id), userId).run();
    if (!res.meta.changes) return null;
    return (await REMINDERS.list(env, userId)).items.find(i => i.id === String(id)) || null;
  },
  async erase(env, userId, id) {
    await setupNotebook(env);
    const res = await env.DB.prepare("DELETE FROM notebook_reminders WHERE id = ? AND user_id = ?").bind(String(id), userId).run();
    return res.meta.changes > 0;
  },
  async eraseAll(env, userId) {
    await setupNotebook(env);
    await env.DB.prepare("DELETE FROM notebook_reminders WHERE user_id = ?").bind(userId).run();
  },
  async eraseCharacter(env, userId, character) {
    await setupNotebook(env);
    await env.DB.prepare("DELETE FROM notebook_reminders WHERE user_id = ? AND page = ?").bind(userId, `char:${character}`).run();
  },
};

export const NOTEBOOK_KEEPERS = [NOTES, GOALS, PINS, REMINDERS];

// What she keeps in the notebook her answer read (lib/willo-notebook.js readNotebook: this character's page and the
// account's, and the reminders not said yet), counted here so "what do you know about me?" says it right (the blind
// check: Flash-Lite counted 3 to-dos for 2). "2 to-dos, 1 goal, 1 pin and 1 reminder", or "".
export function keptSummary(pages = [], reminders = []) {
  const n = { "to-do": 0, note: 0, goal: 0, pin: 0, reminder: reminders.filter(r => !r.fired).length };
  for (const p of pages) {
    for (const l of sectioned(p.body).filter(isItem)) {
      if (l.under === "goals") n.goal += l.done ? 0 : 1;
      else if (l.under === "pins") n.pin++;
      else if (l.kind === "todo") n["to-do"] += l.done ? 0 : 1;
      else n.note++;
    }
  }
  const said = Object.entries(n).filter(([, k]) => k).map(([what, k]) => `${k} ${what}${k === 1 ? "" : "s"}`);
  return said.length > 1 ? `${said.slice(0, -1).join(", ")} and ${said.at(-1)}` : said[0] || "";
}
