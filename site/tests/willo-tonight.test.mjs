// Willo's Tonight card (LOR-733, lib/willo-tonight.js, POST /api/willo/tonight): the previously line from a seeded journey,
// picks from goals, to-dos and friends, nothing beyond the player's level, Free's locked card, the gap's title and news by
// date, no out-of-world words, and one batch of reads. D1 is node:sqlite (helpers.mjs). Run: node --test site/tests/
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { onRequest as tonightApi } from "../functions/api/willo/tonight.js";
import { tonight, tonightFor, sessionParts, openTodos, short, LOCKED_LINE } from "../lib/willo-tonight.js";
import { newsFor, inGap } from "../lib/willo-news.js";
import { stockOf } from "../lib/willo-goals.js";
import { findOrCreateUser, setup } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { setupBilling } from "../lib/billing.js";

import { d1 } from "./helpers.mjs";

const ORIGIN = "https://preview.example";
const CHAR = "Tester-ClassicBetaPvE", PAGE = `char:${CHAR}`;
const NOW = new Date("2026-10-21T20:00:00Z");
const at = (iso, minutes = 0) => Date.parse(iso) / 1000 + minutes * 60;

// Words the card never says (the immersion rule), scanned over everything it returns.
const FORBIDDEN = /https?:|www\.|\b(?:save|saved|saves|sync|synced|syncing|app|apps|computer|reload|log|logs|logged|data|database|server|addon|add-on|website|download|browser|url|ai|model)\b/i;
// Things the card never claims about a beta character.
const NO_CLAIMS = /\b(?:wipe|wiped|wipes|keep|keeps|kept|carry|carries|carried|transfer|transferred|reset|erased|delete|deleted|lost)\b/i;
const words = body => JSON.stringify(body);

// The last session (an evening before) and one long before it, in the synced journey's own shape.
const LAST = "2026-10-20T01:00:00Z", OLDER = "2026-10-12T01:00:00Z";
const journey = {
  v: 1, tz: 0,
  moments: [
    { t: at(OLDER), k: "zone", z: "Elwynn Forest", new: 1 },
    { t: at(OLDER, 20), k: "qt", id: 1, n: "Wolves Across the Border" },
    { t: at(LAST), k: "zone", z: "Westfall", new: 1 },
    { t: at(LAST, 15), k: "npc", n: "Salma Saldean" },
    { t: at(LAST, 40), k: "qt", id: 2, n: "The Defias Brotherhood", z: "Westfall" },
    { t: at(LAST, 55), k: "zone", z: "Sentinel Hill", new: 1 },
    { t: at(LAST, 70), k: "lvl", lv: 22 },
  ],
};
const profileRow = (extra = {}) => ({ user_id: "u1", handle: "tester", public: 0,
  data: JSON.stringify({ v: 1, name: "Tester", realm: "ClassicBetaPvE", level: 22 }), journey: JSON.stringify(journey), ...extra });
const NOTEBOOK = `## Goals
- [ ] Riding at level 40: 100 gold
- [ ] Level 30

## To do
- [ ] Bring the vials to Salma
- [x] Buy arrows
- [ ] Buy bandages
`;
const page = (body = NOTEBOOK, name = PAGE) => ({ page: name, title: "Tester", body, version: 1, updated: NOW.toISOString() });
const stock = stockOf({ t: Math.floor(NOW.getTime() / 1000) - 600, level: 22, xp: 100, xpMax: 1000, money: 640000, riding: 0, race: "Human" });
const friend = (name, extra = {}) => ({ pid: name.toLowerCase(), name, online: 1, share: 1, progress: JSON.stringify({ level: 20, zone: "Redridge Mountains" }),
  progress_at: new Date(NOW.getTime() - 5 * 60e3).toISOString(), ...extra });

// A card from rows given directly: [pages, profile, friends] as the one batch returns them.
function card({ pages = [page()], profile = profileRow(), friends = [friend("Mira")], plan = { id: "hero" }, when = NOW, ...rest } = {}) {
  return tonight({ results: [{ results: pages }, { results: profile ? [profile] : [] }, { results: friends }],
    plan, current: PAGE, stock, now: when, ...rest });
}

test("previously is one past-tense line from the last session of the journey, then the first open to-do", () => {
  const c = card();
  assert.equal(c.previously, 'Previously: you came to Sentinel Hill, met Salma Saldean and turned in "The Defias Brotherhood". ' +
    "Still on your list: Bring the vials to Salma.");
  assert.equal(c.title, "Tonight");
  assert.equal(c.character, "Tester");
  // The older session isn't in it.
  assert.doesNotMatch(c.previously, /Elwynn|Wolves/);
});

test("the recap tells the story first, at most three things: place, people, quests, level, then falls and foes", () => {
  const s = [{ k: "zone", z: "Duskwood", new: 1 }, { k: "qt", n: "A" }, { k: "qt", n: "B" }, { k: "boss", n: "Lupos" },
    { k: "kill", n: "Old Blanchy", cls: "elite" }, { k: "npc", n: "Mira" }, { k: "death", by: "Lupos" }, { k: "death" }];
  assert.deepEqual(sessionParts(s), ["came to Duskwood", "met Mira", "finished 2 quests"]);
  // One name and "among others": the line never has a second "and".
  assert.deepEqual(sessionParts([{ k: "npc", n: "A" }, { k: "npc", n: "B" }, { k: "npc", n: "C" }, { k: "death" }, { k: "death", by: "Wolf" }]),
    ["met A among others", "fell 2 times"]);
  assert.deepEqual(sessionParts([{ k: "death", by: "a Defias Thug", z: "Westfall" }]), ["were last in Westfall", "fell to a Defias Thug"]);
  assert.deepEqual(sessionParts([{ k: "zone", z: "Deadmines", inst: 1 }]), ["entered Deadmines"]);
  assert.deepEqual(sessionParts([{ k: "lvl", lv: 21 }, { k: "lvl", lv: 22 }]), ["rose to level 22"]);
});

test("a session of fighting leads with the place and the person met, and says foes only as a short tail", () => {
  const fights = Array.from({ length: 12 }, (_, i) => ({ k: "kill", n: `Nightbane Shadow Weaver ${i}`, cls: "elite" }));
  const s = [{ k: "zone", z: "Westfall", new: 1 }, { k: "npc", n: "Commander Althea Ebonlocke" }, ...fights, { k: "boss", n: "Edwin VanCleef" }];
  assert.deepEqual(sessionParts(s), ["came to Westfall", "met Commander Althea Ebonlocke", "saw off a few foes"]);
  const c = card({ profile: profileRow({ journey: JSON.stringify({ v: 1, tz: 0, moments: s.map((m, i) => ({ t: at(LAST, i), ...m })) }) }), pages: [] });
  assert.equal(c.previously, "Previously: you came to Westfall, met Commander Althea Ebonlocke and saw off a few foes.");
  assert.doesNotMatch(c.previously, /Nightbane|VanCleef|defeated/);
  // With three better things to tell there is no tail at all; trash (a kill that isn't elite or rare) is never counted.
  assert.deepEqual(sessionParts([{ k: "zone", z: "Westfall", new: 1 }, { k: "npc", n: "Salma" }, { k: "qt", n: "Q" }, ...fights]),
    ["came to Westfall", "met Salma", 'turned in "Q"']);
  assert.deepEqual(sessionParts([{ k: "zone", z: "Westfall", new: 1 }, { k: "kill", n: "Gnoll" }, { k: "kill", n: "Gnoll", cls: "normal" }]), ["came to Westfall"]);
  // No sentence of the line says "and" twice.
  assert.ok(!/ and .* and /.test(card().previously.split(". ")[0]));
});

test("long names are cut at a word boundary with an ellipsis, in quotes for a quest, and never followed by a period", () => {
  assert.equal(short("Short name"), "Short name");
  assert.equal(short("The Legend of the Lost Brotherhood of the Hills", 32), "The Legend of the Lost…");
  assert.equal(short("Supercalifragilisticexpialidocious-and-more", 32), "Supercalifragilisticexpialidoci…");
  const quest = "A Very Long Quest Name That Goes On And On Across The Whole Of Westfall And Beyond To The Very Edge Of The Map";
  const places = "The Sentinel Hill Watchtower Overlooking Moonbrook";
  const j = { v: 1, tz: 0, moments: [{ t: at(LAST), k: "zone", z: places, new: 1 }, { t: at(LAST, 5), k: "qt", id: 3, n: quest }] };
  const long = "Collect every single linen cloth, wool cloth and silk cloth I can find for the bags";
  const c = card({ profile: profileRow({ journey: JSON.stringify(j) }), pages: [page(`- [ ] ${long}\n- [ ] ${long}\n`)], friends: [] });
  assert.match(c.previously, /^Previously: you came to The Sentinel Hill Watchtower… and turned in /);
  assert.match(c.previously, /turned in "A Very Long Quest Name That…"\./);
  assert.match(c.previously, /Still on your list: Collect every single linen cloth, wool…$/);
  assert.doesNotMatch(c.previously, /…\.(?!")/);
  assert.equal(c.picks[0].title.endsWith("…"), true);
  assert.ok(c.picks[0].title.length <= 45);
  const gap = card({ profile: profileRow({ journey: JSON.stringify(j) }), pages: [page(`- [ ] ${long}\n- [ ] ${long}\n`)], friends: [], when: new Date("2026-10-26T20:00:00Z") });
  assert.ok(gap.picks[0].title.endsWith("…") && !gap.picks[0].title.endsWith("….") && gap.picks[0].title.startsWith("When the gates open: Collect"));
});

test("the first to-do is said once: in Previously, and the pick is the next one", () => {
  const c = card({ friends: [] });
  assert.match(c.previously, /Still on your list: Bring the vials to Salma\.$/);
  assert.ok(!c.picks.some(p => /vials/.test(p.title)));
  assert.equal(c.picks[1].title, "Buy bandages");
  // One to-do alone is only in Previously.
  const one = card({ pages: [page("- [ ] Mail the ore\n")], friends: [] });
  assert.match(one.previously, /Still on your list: Mail the ore\.$/);
  assert.deepEqual(one.picks, []);
});

test("another character's journey is never told as theirs; with none, only the list is said", () => {
  const other = profileRow({ data: JSON.stringify({ v: 1, name: "Someoneelse", realm: "ClassicBetaPvE", level: 40 }) });
  const c = card({ profile: other });
  assert.equal(c.previously, "Still on your list: Bring the vials to Salma.");
  assert.equal(card({ profile: null, pages: [] }).previously, "");
});

test("picks: the nearest goal with its numbers, an open to-do, and a friend who is on", () => {
  const c = card();
  assert.equal(c.picks.length, 3);
  assert.equal(c.picks[0].title, "Work toward riding at level 40 for 100 gold");
  assert.match(c.picks[0].sub, /^18 levels and 36 gold to go$/);
  assert.deepEqual(c.picks[1], { title: "Buy bandages", sub: "On your list" });
  assert.deepEqual(c.picks[2], { title: "Say hello to Mira", sub: "On now, in Redridge Mountains" });
  assert.equal(c.locked, undefined);
});

test("a goal without a save is named with no numbers; a goal in their own words stands alone", () => {
  const body = "## Goals\n- [ ] Finish the Onyxia attunement\n";
  const noStock = tonight({ results: [{ results: [page(body)] }, { results: [profileRow()] }, { results: [] }], plan: { id: "hero" },
    current: PAGE, stock: null, now: NOW });
  assert.deepEqual(noStock.picks, [{ title: "Finish the Onyxia attunement", sub: "A goal from your list" }]);
  const riding = tonight({ results: [{ results: [page("## Goals\n- [ ] Riding at level 40: 100 gold\n")] }, { results: [profileRow()] }, { results: [] }],
    plan: { id: "hero" }, current: PAGE, stock: null, now: NOW });
  assert.deepEqual(riding.picks, [{ title: "Work toward riding at level 40 for 100 gold", sub: "A goal from your list" }]);
});

test("a goal already reached is not a pick; to-dos under Goals are not to-dos", () => {
  const body = "## Goals\n- [x] Level 30\n- [ ] Tailoring 150\n\n## Later\n- [ ] Mail the ore\n- [ ] Call Mira\n";
  assert.deepEqual(openTodos({ [PAGE]: page(body) }, PAGE), ["Mail the ore", "Call Mira"]);
  const c = card({ pages: [page(body)], friends: [] });
  assert.equal(c.picks[0].title, "Work toward Tailoring 150");
  assert.equal(c.picks[1].title, "Call Mira");
});

test("the account's list counts after the character's", () => {
  const account = page("- [ ] Water the garden\n", "account");
  const c = card({ pages: [account, page("- [ ] Mail the ore\n")], friends: [] });
  assert.match(c.previously, /Still on your list: Mail the ore\.$/);
  assert.deepEqual(c.picks.map(p => p.title), ["Water the garden"]);
});

test("spoiler-safe: a friend past the player's level is on, but their zone isn't named", () => {
  const ahead = friend("Doran", { progress: JSON.stringify({ level: 41, zone: "Duskwood" }) });
  const c = card({ friends: [ahead] });
  const pick = c.picks.find(p => p.title.startsWith("Say hello"));
  assert.deepEqual(pick, { title: "Say hello to Doran", sub: "On now" });
  assert.doesNotMatch(words(c), /Duskwood/);
  // No note shared, or no level in it: no zone either.
  assert.equal(card({ friends: [friend("Brann", { share: 0 })] }).picks.at(-1).sub, "On now");
  assert.equal(card({ friends: [friend("Brann", { progress: JSON.stringify({ zone: "Duskwood" }) })] }).picks.at(-1).sub, "On now");
  // Their own level unknown (no save, no profile level): no zone.
  const unknown = tonight({ results: [{ results: [page()] }, { results: [profileRow({ data: JSON.stringify({ v: 1, name: "Tester", realm: "ClassicBetaPvE" }) })] },
    { results: [friend("Mira")] }], plan: { id: "hero" }, current: PAGE, stock: null, now: NOW });
  assert.equal(unknown.picks.at(-1).sub, "On now");
});

test("friends: those off or long gone are not picks; one seen a while ago is said as that", () => {
  const away = friend("Away", { online: 0, progress_at: new Date(NOW.getTime() - 5 * 3600e3).toISOString() });
  assert.equal(card({ friends: [away], pages: [] }).picks.length, 0);
  const lately = friend("Lately", { online: 0, progress_at: new Date(NOW.getTime() - 90 * 60e3).toISOString() });
  assert.deepEqual(card({ friends: [lately], pages: [] }).picks, [{ title: "Say hello to Lately", sub: "Was around a little while ago" }]);
  const both = card({ friends: [lately, friend("Mira")], pages: [] });
  assert.equal(both.picks[0].title, "Say hello to Mira");
});

test("Free gets no picks, a plain line offering the plan, and still the recap and the news", () => {
  const c = card({ plan: { id: "free" } });
  assert.deepEqual(c.picks, []);
  assert.equal(c.locked, true);
  assert.equal(c.offer, LOCKED_LINE);
  assert.match(c.previously, /^Previously: you came to Sentinel Hill/);
  assert.match(c.news, /^Word from the realm/);
  // While plans are off nobody is locked.
  assert.equal(card({ plan: null }).locked, undefined);
  assert.equal(card({ plan: null }).picks.length, 3);
});

test("the news and the title follow the date: until the 23rd, the gap, then nothing", () => {
  const on = day => card({ when: new Date(`${day}Z`) });
  const before = on("2026-10-22T23:59:00");
  assert.equal(before.news, "Word from the realm: the gates close on Friday the 23rd.");
  assert.equal(before.title, "Tonight");
  assert.equal(before.gap, false);

  const first = on("2026-10-23T00:00:00");
  assert.equal(first.title, "Before the gates open");
  assert.equal(first.gap, true);
  assert.equal(first.news, "Word from the realm: the gates open for good on November 4, in 12 days.");

  assert.match(on("2026-11-03T12:00:00").news, /in 1 day\.$/);
  assert.match(on("2026-10-30T12:00:00").news, /in 5 days\.$/);

  const open = on("2026-11-04T00:00:00");
  assert.equal(open.title, "Tonight");
  assert.equal(open.gap, false);
  assert.equal(open.news, undefined);
  assert.equal(on("2026-12-25T12:00:00").news, undefined);
});

test("in the gap the picks are plans for launch night, with no numbers of a beta character and no claim about it", () => {
  const c = card({ when: new Date("2026-10-26T20:00:00Z") });
  assert.deepEqual(c.picks.map(p => p.title), ["When the gates open: Work toward riding at level 40 for 100 gold",
    "When the gates open: Buy bandages", "When the gates open: Say hello to Mira"]);
  assert.equal(c.picks[0].sub, "A goal from your list");
  // A friend is no one "on now" and has no zone before the gates open.
  assert.equal(c.picks[2].sub, "Rides with you when the gates open");
  assert.doesNotMatch(words(c), /On now|Redridge/);
  assert.doesNotMatch(words(c), NO_CLAIMS);
  assert.doesNotMatch(words(c), /36 gold/);
});

test("in the gap every title starts with a capital after the prefix, and the player's own words keep their case", () => {
  const gap = new Date("2026-10-26T20:00:00Z");
  const titles = (body, when = gap) => card({ pages: [page(body)], friends: [], when }).picks.map(p => p.title);
  assert.deepEqual(titles("## To do\n- [ ] Skip\n- [ ] NPC census\n- [ ] Mira needs ore\n"),
    ["When the gates open: NPC census", "When the gates open: Mira needs ore"]);
  assert.deepEqual(titles("## To do\n- [ ] Skip\n- [ ] iron bar\n- [ ] Buy bandages\n"), ["When the gates open: Iron bar", "When the gates open: Buy bandages"]);
  assert.deepEqual(titles("## Goals\n- [ ] Finish the Onyxia attunement\n"), ["When the gates open: Finish the Onyxia attunement"]);
  assert.deepEqual(titles("## Goals\n- [ ] Riding at level 40: 100 gold\n"), ["When the gates open: Work toward riding at level 40 for 100 gold"]);
  assert.deepEqual(titles("## To do\n- [ ] Skip\n- [ ] Buy bandages\n", NOW), ["Buy bandages"]);
});

test("the dated list: an entry holds from its day to the day it ends, and a list of our own can end", () => {
  const list = [{ id: "a", from: "2026-01-02", to: "2026-01-04", text: "A, {days}." }];
  assert.equal(newsFor(new Date("2026-01-01T23:59:00Z"), list), null);
  assert.equal(newsFor(new Date("2026-01-02T00:00:00Z"), list).text, "A, 0 days.");
  assert.equal(newsFor(new Date("2026-01-04T00:00:00Z"), list), null);
  assert.equal(inGap(new Date("2026-10-22T23:59:59Z")), false);
  assert.equal(inGap(new Date("2026-10-23T00:00:00Z")), true);
  assert.equal(inGap(new Date("2026-11-03T23:59:59Z")), true);
  assert.equal(inGap(new Date("2026-11-04T00:00:00Z")), false);
});

test("the player's own words are said as they are, only links are left out; our own words pass the scan", () => {
  const body = "## Goals\n- [ ] Sync the addon on my computer\n\n## To do\n- [ ] Save 100 gold for my mount\n- [ ] Read https://example.com/guide\n" +
    "- [ ] Log the herbs in the guild bank\n- [ ] Buy bandages\n";
  assert.deepEqual(openTodos({ [PAGE]: page(body) }, PAGE), ["Save 100 gold for my mount", "Log the herbs in the guild bank", "Buy bandages"]);
  const c = card({ pages: [page(body)], friends: [friend("Data Dave"), friend("Mira")] });
  assert.equal(c.previously.endsWith("Still on your list: Save 100 gold for my mount."), true);
  assert.deepEqual(c.picks.map(p => p.title), ["Sync the addon on my computer", "Log the herbs in the guild bank", "Say hello to Data Dave"]);
  assert.doesNotMatch(words(card({ pages: [page("- [ ] a\n- [ ] see www.example.net now\n")], friends: [friend("http://x.example")] })), /www\.|http/);
  // Every state of the card built from clean notes passes the scan: it is our template words.
  const states = [card(), card({ plan: { id: "free" } }), card({ plan: null }), card({ when: new Date("2026-10-23T09:00:00Z") }),
    card({ when: new Date("2026-11-04T09:00:00Z") }), card({ friends: [], pages: [] }), card({ profile: null })];
  for (const st of states) {
    assert.doesNotMatch(words({ ...st, fold_key: "", ok: true }), FORBIDDEN, words(st));
    assert.doesNotMatch(words(st), NO_CLAIMS, words(st));
    assert.doesNotMatch(words(st), /\bbeta\b/i, words(st));
  }
  // A quest or a foe whose name has such a word is said all the same.
  assert.deepEqual(sessionParts([{ k: "qt", n: "The Log Run" }]), ['turned in "The Log Run"']);
  assert.deepEqual(sessionParts([{ k: "boss", n: "Server Smasher" }, { k: "boss", n: "Lupos" }]), ["saw off a few foes"]);
});

test("fold_key is steady for the same card, ignores the days counting down, and changes with the content", () => {
  const a = card({ when: new Date("2026-10-24T20:00:00Z") }), b = card({ when: new Date("2026-10-25T20:00:00Z") });
  assert.notEqual(a.news, b.news);
  assert.equal(a.fold_key, b.fold_key);
  assert.equal(card().fold_key, card().fold_key);
  assert.match(card().fold_key, /^[0-9a-z]{4,}$/);
  assert.notEqual(card().fold_key, card({ pages: [page(NOTEBOOK + "- [ ] Feed the cat\n")] }).fold_key);
  assert.notEqual(card().fold_key, card({ friends: [] }).fold_key);
  assert.notEqual(card().fold_key, card({ plan: { id: "free" } }).fold_key);
  assert.notEqual(card({ when: new Date("2026-10-22T20:00:00Z") }).fold_key, card({ when: new Date("2026-10-23T20:00:00Z") }).fold_key);
  // The line that changes the news changes the key too.
  const swapped = card({ news: () => ({ id: "other", text: "Word from the realm: something else." }) });
  assert.notEqual(swapped.fold_key, card().fold_key);
});

// ---- Against the database ----

const env = { DB: d1() };
const TABLES = ["users", "sessions", "devices", "device_links", "profiles", "notebook_pages", "friend_people", "friend_edges",
  "rate_limits", "entitlements", "starter_claims", "best_first", "answer_user_spend"];
beforeEach(async () => {
  await setup(env);
  await setupBilling(env);
  for (const t of TABLES) env.DB.sqlite.exec(`DELETE FROM ${t}`);
  delete env.SITE_FEATURES;
});

async function player(handle) {
  const user = await findOrCreateUser(env, { email: `${handle}@example.com`, googleSub: handle, name: handle });
  const link = await startLink(env);
  await decideLink(env, link.user_code, user, true);
  const { token } = await claimToken(env, link.device_code);
  return { user, token };
}
const seedProfile = (user, name, realm, level, j = journey) => env.DB.prepare(
  "INSERT INTO profiles (user_id, handle, public, data, journey, created, updated) VALUES (?, ?, 0, ?, ?, ?, ?)")
  .bind(user.id, name.toLowerCase(), JSON.stringify({ v: 1, name, realm, level }), JSON.stringify(j), NOW.toISOString(), NOW.toISOString()).run();
const seedPage = (user, page, body) => env.DB.prepare(
  "INSERT INTO notebook_pages (user_id, page, title, body, version, updated) VALUES (?, ?, ?, ?, 1, ?)")
  .bind(user.id, page, page, body, NOW.toISOString()).run();
async function befriend(me, other, { share = 1, level = 20, zone = "Redridge Mountains", online = true } = {}) {
  const now = new Date().toISOString();
  await seedProfile(other.user, "Mira", "ClassicBetaPvE", level, { v: 1, tz: 0, moments: [] }).catch(() => {});
  await env.DB.prepare("INSERT INTO friend_people (user_id, pid, share, progress, progress_at, created) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(other.user.id, "aaaaaaaaaaaaaaaa", share, JSON.stringify({ level, zone }), now, now).run();
  await env.DB.prepare("INSERT INTO friend_people (user_id, pid, share, created) VALUES (?, ?, 0, ?)").bind(me.user.id, "bbbbbbbbbbbbbbbb", now).run();
  await env.DB.prepare("INSERT INTO friend_edges (user_id, other_id, state, created, updated) VALUES (?, ?, 'friends', ?, ?)")
    .bind(me.user.id, other.user.id, now, now).run();
  if (online) env.DB.sqlite.prepare("UPDATE devices SET last_used = ? WHERE user_id = ?").run(new Date().toISOString(), other.user.id);
}

// Counts what the card asks of D1: one batch, and nothing on its own.
function counting(db) {
  const seen = { batches: 0, single: 0, statements: 0 };
  const wrap = s => ({ _s: s, bind: (...a) => wrap(s.bind(...a)),
    first: (...a) => { seen.single++; return s.first(...a); }, all: (...a) => { seen.single++; return s.all(...a); },
    run: (...a) => { seen.single++; return s.run(...a); } });
  return { seen, sqlite: db.sqlite, prepare: sql => wrap(db.prepare(sql)),
    batch: list => { seen.batches++; seen.statements += list.length; return db.batch(list.map(s => s._s || s)); } };
}

test("one batch of reads builds the whole card from the database", async () => {
  const me = await player("tester"), other = await player("mira");
  await seedProfile(me.user, "Tester", "ClassicBetaPvE", 22);
  await seedPage(me.user, PAGE, NOTEBOOK);
  await befriend(me, other);
  const counted = counting(env.DB);
  const c = await tonightFor({ DB: counted }, me.user.id, { character: CHAR, stock, now: NOW });
  assert.equal(counted.seen.batches, 1);
  assert.equal(counted.seen.single, 0, "no read outside the batch");
  assert.equal(counted.seen.statements, 3);
  // The journey is from October 20; the clock here is today's, so the card is the ordinary one.
  assert.match(c.previously, /^Previously: you came to Sentinel Hill/);
  assert.deepEqual(c.picks.map(p => p.title), ["Work toward riding at level 40 for 100 gold", "Buy bandages", "Say hello to Mira"]);
  assert.equal(c.picks[2].sub, "On now, in Redridge Mountains");
});

test("a friend who hides when their Willo is on, or isn't a friend yet, is not a pick", async () => {
  const me = await player("tester"), other = await player("mira");
  await seedProfile(me.user, "Tester", "ClassicBetaPvE", 22);
  await befriend(me, other);
  env.DB.sqlite.exec("UPDATE friend_people SET hide_online = 1");
  assert.deepEqual((await tonightFor(env, me.user.id, { character: CHAR, stock })).picks, []);
  env.DB.sqlite.exec("UPDATE friend_people SET hide_online = 0; UPDATE friend_edges SET state = 'asked'");
  assert.deepEqual((await tonightFor(env, me.user.id, { character: CHAR, stock })).picks, []);
});

async function call({ token, method = "POST", body, headers = {}, query = "" }) {
  const h = new Headers({ "Content-Type": "application/json", "X-LF-Client": "companion/0.1.0", ...headers });
  if (token) h.set("Authorization", `Bearer ${token}`);
  const res = await tonightApi({ request: new Request(`${ORIGIN}/api/willo/tonight${query}`, { method, headers: h,
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined }), env });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

test("the endpoint: signed out is turned away; a connected Willo gets the card, no-store, from a POST or a GET", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });   // the endpoint reads the clock; its picks change in the gap
  assert.equal((await call({ body: {} })).status, 401);
  const me = await player("tester");
  await seedProfile(me.user, "Tester", "ClassicBetaPvE", 22);
  await seedPage(me.user, PAGE, NOTEBOOK);
  const post = await call({ token: me.token, body: { character: CHAR, stock: { level: 22, money: 640000, t: Math.floor(Date.now() / 1000) } } });
  assert.equal(post.status, 200);
  assert.equal(post.headers.get("Cache-Control"), "no-store");
  assert.equal(post.body.ok, true);
  assert.match(post.body.previously, /^Previously: you came to Sentinel Hill/);
  assert.equal(post.body.picks[0].sub, "18 levels and 36 gold to go");
  const get = await call({ token: me.token, method: "GET", query: `?character=${encodeURIComponent(CHAR)}` });
  assert.equal(get.status, 200);
  assert.equal(get.body.picks[0].sub, "A goal from your list");
  // A page of ours needs our Origin on a POST; a bad body is turned away.
  assert.equal((await call({ method: "POST", headers: { "X-LF-Client": "", Origin: "https://elsewhere.example" } })).status, 401);
  assert.equal((await call({ token: me.token, body: [] })).status, 400);
  assert.equal((await call({ token: me.token, method: "PUT" })).status, 405);
});

test("the endpoint with plans on: a free account is locked, a Hero's picks are open", async () => {
  env.SITE_FEATURES = "plans";
  const me = await player("tester");
  await seedProfile(me.user, "Tester", "ClassicBetaPvE", 22);
  await seedPage(me.user, PAGE, NOTEBOOK);
  const free = await call({ token: me.token, body: { character: CHAR } });
  assert.equal(free.status, 200);
  assert.equal(free.body.locked, true);
  assert.deepEqual(free.body.picks, []);
  assert.match(free.body.previously, /^Previously/);
  const end = new Date(Date.now() + 20 * 86400e3).toISOString();
  await env.DB.prepare("INSERT OR REPLACE INTO entitlements (user_id, subscription_id, plan, status, current_period_end, updated) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(me.user.id, "sub_1", "hero", "active", end, new Date().toISOString()).run();
  const hero = await call({ token: me.token, body: { character: CHAR } });
  assert.equal(hero.body.locked, undefined);
  assert.equal(hero.body.picks.length >= 2, true);
});
