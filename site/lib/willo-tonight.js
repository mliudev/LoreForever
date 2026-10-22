// Willo's Tonight card (LOR-733, picked 10/21 as B1): at the top of Chat whenever the game is closed, on the PC window now
// and later on the desktop panel and the phone. POST /api/willo/tonight builds it here, from what the player already keeps,
// in templates: the answer model is never called, so it costs no answer and says the same thing every time.
//   previously  one line, past tense: the last play session of the synced journey (what the add-on's own "Welcome back"
//               recap picks: the last place, quests, the level, foes, people met, deaths; at most three of them), then
//               "Still on your list: ..." with the first open to-do of the notebook.
//   picks       two or three for the next session, from Hero up: the player's nearest goal with its numbers
//               (lib/willo-goals.js), an open to-do, a friend who is on. Never a thing beyond the player's level.
//   news        one dated line we write (lib/willo-news.js).
//   gap         the days between the beta closing and the launch: the title is "Before the gates open", the picks are
//               plans for launch night, and nothing says what becomes of a beta character.
//   fold_key    changes only when the card's content does, so a client can stay folded until then.
// All the reads are one D1 batch (the notebook's pages, the profile with its journey, the friends), beside the plan.

import { plansOn, planFor } from "./billing.js";
import { profileStatement, profileFromRow } from "./profiles.js";
import { journeyFrom } from "./saved-journey.js";
import { pagesStatement, linesOf, headingKey, pageOf, titleOf, ACCOUNT_PAGE } from "./willo-notebook.js";
import { goalsOf, progressOf, paceOf, goalSaid } from "./willo-goals.js";
import { friendsTonightStatement } from "./friends.js";
import { newsFor, inGap } from "./willo-news.js";

// A session ends where the moments stop for this long (the synced journey has no logins, only the moments between them).
const SESSION_GAP = 2 * 3600;
const SESSION_MAX = 14 * 3600;
const PARTS = 3;          // what "Previously" says of the session, at most
const PICKS = 3;
const FRIEND_RECENT_MINUTES = 3 * 60;
const TITLE = "Tonight", GAP_TITLE = "Before the gates open", GAP_LEAD = "When the gates open: ";
export const LOCKED_LINE = "Picks for your evenings come with the Hero plan.";

// Links are never said. The player's own words (a to-do, a goal, a friend's name) and the game's names are theirs and
// are said as they are: the out-of-world word rule is for our own template words, and the tests scan those.
const LINK = /https?:|www\.|\w\.(?:com|net|org|gg|io)\b/i;
const clean = text => {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  return t && !LINK.test(t) ? t : "";
};
// A name that is too long for one line, cut at a word boundary with "…" (never a period after it).
const NAME_MAX = 32, TODO_MAX = 44;
export function short(text, max = NAME_MAX) {
  const t = String(text ?? "").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const word = cut.replace(/[\s,;:.\-–—]+\S*$/, "");
  return `${(word && word !== cut ? word : cut).replace(/[\s,;:.\-–—]+$/, "")}…`;
}
// A sentence's end: a period, but never right after "…" (a cut name in quotes still gets one after the closing quote).
const stop = t => t.endsWith("…") ? t : `${t}.`;
const upper = t => t.charAt(0).toUpperCase() + t.slice(1);
const list = items => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
const fnv = text => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
};

// ---- The reads ----

// The statements of the one batch, and what to make of its results.
export function reads(env, userId, current, now) {
  return [pagesStatement(env, userId, current), profileStatement(env, userId), friendsTonightStatement(env, userId, now.getTime())];
}

// ---- Previously ----

// The latest session of the journey: its moments, oldest first.
function lastSession(journey) {
  const moments = journey?.moments || [];
  if (!moments.length) return [];
  const out = [moments.at(-1)];
  for (let i = moments.length - 2; i >= 0; i--) {
    if (out[0].t - moments[i].t > SESSION_GAP || moments.at(-1).t - moments[i].t > SESSION_MAX) break;
    out.unshift(moments[i]);
  }
  return out;
}

const NOTABLE = new Set(["elite", "rare", "rareelite", "worldboss"]);
const names = (moments, kinds) => [...new Set(moments.filter(m => kinds.includes(m.k)).map(m => short(clean(m.n))).filter(Boolean))];

// What a session was, as clauses after "you", the story first: place, people met, quests, level, then falls and foes;
// the first PARTS there are, so foes (only named, elite or boss ones, said as "a few foes", never by name) come up only
// when there is little else to tell.
export function sessionParts(session) {
  const parts = [];
  const zones = session.filter(m => m.k === "zone" && clean(m.z));
  const lastZone = zones.at(-1);
  if (lastZone) parts.push(`${lastZone.inst ? "entered" : "came to"} ${short(clean(lastZone.z))}`);
  else {
    const where = session.filter(m => clean(m.z)).at(-1);
    if (where) parts.push(`were last in ${short(clean(where.z))}`);
  }
  // One name, and "among others" for more: no second "and" in the line.
  const people = names(session, ["npc"]);
  if (people.length) parts.push(`met ${people[0]}${people.length > 1 ? " among others" : ""}`);
  const quests = session.filter(m => m.k === "qt");
  if (quests.length === 1) {
    const q = short(clean(quests[0].n));
    parts.push(q ? `turned in "${q}"` : "finished a quest");
  } else if (quests.length > 1) parts.push(`finished ${quests.length} quests`);
  const level = Math.max(0, ...session.filter(m => m.k === "lvl" && Number.isInteger(m.lv)).map(m => m.lv));
  if (level) parts.push(`rose to level ${level}`);
  const deaths = session.filter(m => m.k === "death");
  if (deaths.length === 1) {
    const by = short(clean(deaths[0].by));
    parts.push(by ? `fell to ${by}` : "fell once");
  } else if (deaths.length > 1) parts.push(`fell ${deaths.length} times`);
  if (session.some(m => m.k === "boss" || (m.k === "kill" && NOTABLE.has(m.cls)))) parts.push("saw off a few foes");
  return parts.slice(0, PARTS);
}

// ---- The notebook ----

// The open to-dos of the character's page, then the account's, not those under a Goals heading: [text].
export function openTodos(pages, current) {
  const out = [];
  for (const page of [current, ACCOUNT_PAGE].filter((p, i, a) => p && a.indexOf(p) === i)) {
    let goals = false, level = 0;
    for (const l of linesOf(pages[page]?.body)) {
      if (l.kind === "heading") {
        if (goals && l.level <= level) goals = false;
        if (headingKey(l.text) === "goals") [goals, level] = [true, l.level];
        continue;
      }
      if (goals || l.kind !== "todo" || l.done) continue;
      const text = short(clean(l.text).replace(/[.!]+$/, ""), TODO_MAX);
      if (text) out.push(text);
    }
  }
  return out;
}

// ---- The picks ----

// The goal nearest to done: the first open one with a number to say, else the first open one.
function nearestGoal(pages, current, stock) {
  const view = { current, pages, refs: new Map() };
  const open = goalsOf(view).filter(g => !g.done);
  const pace = paceOf(stock);
  const counted = open.map(g => ({ g, p: progressOf(g.goal, stock, { pace }) }));
  return counted.find(c => c.p.togo) || counted[0] || null;
}

// The friends worth a word tonight: on now, or seen a little while ago. A zone only when the friend isn't past the
// player's level (a zone ahead is a spoiler).
function friendsOn(rows, level, now) {
  const out = [];
  for (const r of rows) {
    const name = short(clean(r.name));
    if (!name) continue;
    let progress = null;
    try { progress = r.share && r.progress ? JSON.parse(r.progress) : null; } catch (e) { /* no note */ }
    const ago = progress && r.progress_at ? Math.round((now.getTime() - Date.parse(r.progress_at)) / 60000) : null;
    const recent = ago !== null && ago >= 0 && ago <= FRIEND_RECENT_MINUTES;
    if (!r.online && !recent) continue;
    const near = Number.isInteger(progress?.level) && Number.isInteger(level) && progress.level <= level;
    const zone = near ? short(clean(progress.zone)) : "";
    out.push({ name, online: Boolean(r.online), zone });
  }
  return out.sort((a, b) => Number(b.online) - Number(a.online));
}

// {lead, rest, sub}: lead is our template's own words (lowercased after "When the gates open:"), rest the player's.
function picksFor({ pages, current, stock, level, friends, gap, now }) {
  const picks = [];
  const goal = nearestGoal(pages, current, stock);
  if (goal) {
    const text = goal.g.goal.kind === "other" ? short(clean(goal.g.goal.text), TODO_MAX) : goalSaid(goal.g.goal);
    if (text) {
      const counted = !gap && goal.p.togo;
      picks.push({ lead: goal.g.goal.kind === "other" ? "" : "Work toward ", rest: text,
        sub: counted ? upper(goal.p.togo) : "A goal from your list" });
    }
  }
  // The first open to-do is in "Previously" ("Still on your list"); the pick is the next one, never the same twice.
  const todos = openTodos(pages, current).slice(1);
  if (todos.length) picks.push({ lead: "", rest: upper(todos[0]), sub: todos.length > 1 ? `On your list, with ${todos.length - 1} more` : "On your list" });
  const on = friendsOn(friends, level, now);
  if (on.length) {
    const f = on[0];
    picks.push({ lead: "Say hello to ", rest: f.name,
      // Before the gates open nobody can play: no online state and no zone, only the plan.
      sub: gap ? "Rides with you when the gates open"
        : f.online ? (f.zone ? `On now, in ${f.zone}` : "On now") : "Was around a little while ago" });
  }
  // Two at least when the notebook has them: one more to-do.
  for (let i = 1; picks.length < 2 && i < todos.length; i++) picks.push({ lead: "", rest: upper(todos[i]), sub: "On your list" });
  return picks.slice(0, PICKS).map(p => ({
    title: gap ? `${GAP_LEAD}${p.lead}${p.rest}` : `${p.lead}${p.rest}`, sub: p.sub }));
}

// ---- The card ----

// input: {current (the notebook page of the character, or null), stock (lib/willo-goals.js stockOf, or null), now}.
// reads: the results of reads()'s batch, in its order. plan: the account's plan, or null while plans are off.
export function tonight({ results, plan, current, stock = null, now = new Date(), news = newsFor }) {
  const [pagesRes, profileRes, friendsRes] = results;
  const pages = Object.fromEntries((pagesRes?.results || []).map(p => [p.page, p]));
  const saved = current ? journeyFrom(profileFromRow(profileRes?.results?.[0] || null), current) : { journey: null, theirs: false, level: null };
  const level = stock?.level ?? (saved.theirs ? saved.level : null);
  const gap = inGap(now);
  const locked = Boolean(plan) && plan.id === "free";

  const session = current && saved.theirs ? lastSession(saved.journey) : [];
  const parts = session.length ? sessionParts(session) : [];
  const todos = openTodos(pages, current);
  const previously = [parts.length ? stop(`Previously: you ${list(parts)}`) : "", todos.length ? stop(`Still on your list: ${todos[0]}`) : ""]
    .filter(Boolean).join(" ");

  const picks = locked ? [] : picksFor({ pages, current, stock, level, friends: friendsRes?.results || [], gap, now });
  const line = news(now);
  const title = gap ? GAP_TITLE : TITLE;
  const body = { ok: true, title, character: current ? titleOf(current) : "", previously, picks,
    ...(line ? { news: line.text } : {}), gap, ...(locked ? { locked: true, offer: LOCKED_LINE } : {}) };
  // The news counts its days down, so only which line it is goes in the key.
  return { ...body, fold_key: fnv(JSON.stringify([title, previously, picks, line?.id || "", locked])) };
}

// The card for a player: one batch of reads, in step with the plan's. character: the add-on's key ("Húrin-ClassicBetaPvE").
export async function tonightFor(env, userId, { character = null, stock = null, now = new Date() } = {}) {
  const page = pageOf(character);
  const current = page && page !== ACCOUNT_PAGE ? page : null;
  const [results, plan] = await Promise.all([env.DB.batch(reads(env, userId, current, now)),
    plansOn(env) ? planFor(env, userId, now) : null]);
  return tonight({ results, plan, current, stock, now });
}
