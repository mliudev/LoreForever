// Click trails and lore links on player profiles (LOR-248): the record's moments in time order (lib/journey.js
// timeline), the name lookups over public/lore/data/links.json (lib/trails.js), and the journey on /u/<handle>.
// Run: node --test site/tests/
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onRequest as profileApi } from "../functions/api/profile/[action].js";
import { onRequestGet as profileGet } from "../functions/u/[handle].js";
import { findOrCreateUser, startSession, setup } from "../lib/accounts.js";
import { parseRecord } from "../lib/journey.js";
import { linker, moments, journeySection, norm, dayText, RECENT, LINKS } from "../lib/trails.js";
import { profilePage } from "../lib/profiles.js";
import { d1, assets, SITE } from "./helpers.mjs";
import { RECORD } from "./fixtures/journey/record.mjs";

const NOW = new Date("2026-10-04T12:00:00Z");
const DATA = JSON.parse(readFileSync(`${SITE}public/lore/data/links.json`, "utf8"));
const INDEX = JSON.parse(readFileSync(`${SITE}public/lore/data/index.json`, "utf8"));
const NAMES = linker(DATA);

// ---- The timeline the parser keeps ----

test("the record's moments come back in time order, with the day and never the hour", () => {
  const d = parseRecord(RECORD, NOW);
  const at = d.timeline.map(([k, i, day]) => `${day} ${k}:${i}`);
  // Oct 01 14:00 Shadowglen, 14:05 met Ilthalaine, 14:30 her quest; the same minute (10:41/Oct 03 11:00) in TIMELINE order.
  assert.deepEqual(at.slice(0, 4), ["2026-10-01 places:0", "2026-10-01 people:0", "2026-10-01 quests:0", "2026-10-01 places:1"]);
  assert.ok(at.indexOf("2026-10-03 places:6") < at.indexOf("2026-10-03 levels:0"), "Menethil Harbor, then level 24, both 11:00");
  // Every moment section, every entry, once; spells, professions and screenshots aren't moments.
  for (const k of ["places", "quests", "people", "bosses", "kills", "loot", "levels", "mounts", "rep", "books", "deaths"]) {
    assert.deepEqual(d.timeline.filter(t => t[0] === k).map(t => t[1]).sort(), d[k].map((_, i) => i), k);
  }
  assert.ok(!d.timeline.some(t => ["spells", "profs", "shots"].includes(t[0])));
  assert.ok(!/\d\d:\d\d/.test(JSON.stringify(d)), "no time of day is kept");
  // The latest standing with a faction is the moment, at its own time.
  assert.deepEqual(d.timeline.filter(t => t[0] === "rep"), [["rep", 0, "2026-10-03"]]);
});

test("the year: the latest one that doesn't put a moment in the future", () => {
  const rec = "Journey record: Aelric - Forever\nLevel 24 Night Elf Druid, Alliance\n\nQuests done\n" +
    "- Dec 30 20:00  The Balance of Nature · Shadowglen, Teldrassil\n- Jan 02 09:00  Verdant Sigil · Shadowglen, Teldrassil\n" +
    "-   Webwood Venom · Shadowglen, Teldrassil\n";
  const d = parseRecord(rec, new Date("2027-01-03T08:00:00Z"));
  assert.deepEqual(d.timeline, [["quests", 2, null], ["quests", 0, "2026-12-30"], ["quests", 1, "2027-01-02"]]);
  // A player's clock a day ahead of the server's is still this year.
  const ahead = parseRecord(rec.replace("Jan 02 09:00", "Jan 04 09:00"), new Date("2027-01-03T08:00:00Z"));
  assert.equal(ahead.timeline.at(-1)[2], "2027-01-04");
  // A squeezed paste keeps its times too.
  const squeezed = parseRecord(RECORD.replace("- Oct 01 14:30  The Balance", "- Oct 01 14:30 The Balance"), NOW);
  assert.deepEqual(squeezed.timeline.slice(0, 3).map(t => t[0]), ["places", "people", "quests"]);
});

// ---- Names to pages ----

test("links.json names only pages that exist, and a storyline's quests come in chapter order", () => {
  const paths = new Set(INDEX.pages.map(p => p.p));
  for (const [, , p] of DATA.places) assert.ok(paths.has(p), p);
  for (const [, p] of DATA.people) assert.ok(paths.has(p), p);
  for (const [, , p, , sl] of DATA.quests) {
    assert.ok(paths.has(p), p);
    assert.ok(sl === 0 || DATA.storylines[sl - 1], p);
  }
  const defias = DATA.quests.filter(q => q[0] === "The Defias Brotherhood" && q[4]).map(q => q[2].match(/\/(\d+)-/)[1]);
  assert.deepEqual(defias, ["65", "132", "135", "141", "142", "155", "166"]);
});

test("names find their pages: places by zone, people, quests by title and where they were handed in", () => {
  assert.equal(norm("  Gor’kan  “the” Tamer (Northshire) "), "gor'kan the tamer");
  assert.equal(norm("Rut'theran Village"), norm("Rut’theran Village"));
  assert.equal(NAMES.zone("Westfall"), "/lore/zone/westfall");
  assert.equal(NAMES.zone("The Deadmines"), "/lore/zone/deadmines");
  assert.equal(NAMES.place("Sentinel Hill", "Westfall"), "/lore/subzone/sentinel-hill");
  assert.equal(NAMES.place("Sentinel Hill", "Duskwood"), null);
  assert.equal(NAMES.person("Edwin VanCleef"), "/lore/npc/edwin-vancleef");
  assert.equal(NAMES.person("Nobody At All"), null);
  const balance = NAMES.quest("The Balance of Nature", "Teldrassil");
  assert.equal(balance.p, "/lore/quest/456-the-balance-of-nature");
  assert.equal(balance.giver, "Conservator Ilthalaine");
  assert.deepEqual(NAMES.storyline(balance.sl), { name: "The Balance of Nature", zone: "Teldrassil" });
  assert.equal(NAMES.quest("Not A Quest", "Westfall"), null);
  // Quests started by a poster, not a person, have no giver.
  assert.equal(NAMES.quest('Wanted: "Hogger"', "Elwynn Forest").giver, null);
});

test("same-titled chapters: the nth one done is the nth chapter, so a link never runs ahead of the player", () => {
  const chapter = n => NAMES.quest("The Defias Brotherhood", "Westfall", n).p.match(/\/(\d+)-/)[1];
  assert.deepEqual([0, 1, 2].map(chapter), ["65", "132", "135"]);
  assert.equal(chapter(40), "166");   // more than there are: the last, which they've done
  // Same title, unrelated quests in different zones: only the zone it was handed in tells them apart.
  const two = linker({ quests: [["Lost", "Duskwood", "/lore/quest/1-lost", "", 0], ["Lost", "Darkshore", "/lore/quest/2-lost", "", 0]] });
  assert.equal(two.quest("Lost", "Darkshore").p, "/lore/quest/2-lost");
  assert.equal(two.quest("Lost", "Westfall"), null);
});

// ---- The trails ----

// A small links.json for the fixture record: Gryan gives both Defias chapters in one storyline; Ilthalaine gives
// The Balance of Nature; Mor'Ladim and Mother Fang have pages.
const SMALL = linker({
  places: [["Westfall", "", "/lore/zone/westfall"], ["Sentinel Hill", "Westfall", "/lore/subzone/sentinel-hill"],
    ["Teldrassil", "", "/lore/zone/teldrassil"], ["Shadowglen", "Teldrassil", "/lore/subzone/shadowglen"],
    ["The Deadmines", "", "/lore/zone/deadmines"], ["Darnassus", "", "/lore/zone/darnassus"]],
  people: [["Gryan Stoutmantle", "/lore/npc/gryan-stoutmantle"], ["Edwin VanCleef", "/lore/npc/edwin-vancleef"],
    ["Murloc Forager", "/lore/npc/murloc-forager"]],
  quests: [["The Balance of Nature", "Teldrassil", "/lore/quest/456-the-balance-of-nature", "Conservator Ilthalaine", 1],
    ["The Defias Brotherhood", "Westfall", "/lore/quest/65-the-defias-brotherhood", "Gryan Stoutmantle", 2],
    ["The Defias Brotherhood", "Westfall", "/lore/quest/132-the-defias-brotherhood", "Wiley the Black", 2]],
  storylines: [["The Balance of Nature", "Teldrassil"], ["The Defias Brotherhood", "Westfall"]],
});

// RECORD plus a second Defias chapter, a return to Sentinel Hill and Murloc Forager beaten after it killed Aelric.
const LONGER = RECORD
  .replace("- Oct 03 10:30  The Defias Brotherhood · Sentinel Hill, Westfall · with Dwarf Priest, Human Warrior",
    "- Oct 03 10:30  The Defias Brotherhood · Sentinel Hill, Westfall · with Dwarf Priest, Human Warrior\n" +
    "- Oct 03 13:00  The Defias Brotherhood · Sentinel Hill, Westfall")
  .replace("- Oct 03 10:20  Foreman Thistlenettle", "- Oct 02 15:00  Murloc Forager · elite · Auberdine, Darkshore\n- Oct 03 10:20  Foreman Thistlenettle");

test("trails: who gave a quest and when they were met, a storyline, a place visited again, a reward, a foe beaten later", () => {
  const ms = moments(parseRecord(LONGER, NOW), SMALL);
  const find = (k, f) => ms.find(m => m.k === k && f(m.e));
  const gryan = find("people", e => e.name === "Gryan Stoutmantle");
  const [first, second] = ms.filter(m => m.k === "quests" && m.e.title === "The Defias Brotherhood");
  assert.equal(first.quest.p, "/lore/quest/65-the-defias-brotherhood");
  assert.equal(second.quest.p, "/lore/quest/132-the-defias-brotherhood");
  assert.equal(first.giver, "Gryan Stoutmantle");
  assert.equal(first.met, gryan);
  assert.deepEqual(gryan.gave, [first]);
  assert.deepEqual(first.story, { name: "The Defias Brotherhood", zone: "Westfall" });
  assert.equal(first.nextStory, second);
  assert.equal(second.prevStory, first);
  assert.equal(first.prevStory, null);
  // Sentinel Hill, back and forth with the Deadmines: met Gryan, the first chapter, the gloves, then the second.
  const gloves = find("loot", e => e.name === "Westfall Gloves");
  assert.deepEqual([gryan.prevHere, gryan.nextHere, first.prevHere, first.nextHere, second.prevHere, second.nextHere],
    [null, first, gryan, gloves, gloves, null]);
  // Shadowglen and Ilthalaine's quest there: one visit, nothing to go back to.
  const balance = find("quests", e => e.title === "The Balance of Nature");
  assert.deepEqual([balance.prevHere, balance.nextHere], [null, null]);
  // The gloves were the reward for the first chapter (the one done before them).
  assert.equal(gloves.reward, first);
  // Killed by a Murloc Forager on Oct 2 at 13:00, beat one at 15:00.
  const death = find("deaths", e => e.by === "Murloc Forager");
  assert.equal(death.avenged, find("kills", e => e.name === "Murloc Forager"));
});

test("the journey section: newest first by day, every trail link lands on a moment, lore links only when asked", () => {
  const ms = moments(parseRecord(LONGER, NOW), SMALL);
  const off = journeySection(ms);
  assert.match(off, /<section class="vp-section pf-journey" id="journey"/);
  assert.ok(off.indexOf("Oct 3, 2026") < off.indexOf("Oct 1, 2026"), "newest day first");
  const ids = new Set([...off.matchAll(/ id="(m-\d+)"/g)].map(m => m[1]));
  assert.equal(ids.size, ms.length);
  const targets = [...off.matchAll(/href="#(m-\d+)"/g)].map(m => m[1]);
  assert.ok(targets.length > 5);
  for (const t of targets) assert.ok(ids.has(t), t);
  assert.ok(!off.includes('href="/lore/'), "no lore links while the lore pages are off");
  for (const bit of ["Taken from <a class=\"pf-go\"", "Storyline &middot; Westfall: The Defias Brotherhood", "&larr; Last time here",
    "Next time here &rarr;", "Reward for <a class=\"pf-go\"", ">Beaten later</a>", "Their quests: ", 'class="pf-filter" role="group"']) {
    assert.ok(off.includes(bit), bit);
  }
  assert.ok(!/\b\d{1,2}:\d\d\b/.test(off), "no time of day");
  assert.ok(!/(step|chapter|part) \d|\d+\/\d+/i.test(off.replace(/<[^>]+>/g, " ")), "no step numbers on storylines");

  const on = journeySection(ms, { lore: SMALL });
  for (const p of ["/lore/quest/65-the-defias-brotherhood", "/lore/quest/132-the-defias-brotherhood", "/lore/npc/gryan-stoutmantle",
    "/lore/subzone/sentinel-hill", "/lore/zone/westfall", "/lore/npc/edwin-vancleef", "/lore/zone/deadmines"]) {
    assert.ok(on.includes(`href="${p}"`), p);
  }
  // An item, a book, a mount and a faction have no page: their moment links the place it happened.
  assert.match(on, /New mount: <strong>Striped Nightsaber<\/strong><\/p>\s*<p class="pf-m-where"><a href="\/lore\/zone\/darnassus">Darnassus<\/a>/);
});

test("a long journey folds all but the latest moments; a profile from before keeps its old page", () => {
  const places = Array.from({ length: RECENT + 7 }, (_, i) => `- Sep ${String(1 + (i % 28)).padStart(2, "0")} 10:${String(i).padStart(2, "0")}  Spot ${i}, Westfall`);
  const d = parseRecord(`Journey record: Aelric - Forever\nLevel 24 Night Elf Druid, Alliance\n\nNew places, in order\n${places.join("\n")}\n`, NOW);
  const html = journeySection(moments(d, SMALL));
  assert.match(html, /<details class="pf-older"><summary>Show 7 earlier moments<\/summary>/);
  assert.equal(journeySection(moments({ ...d, timeline: undefined }, SMALL)), "");
  assert.equal(journeySection(moments({ places: [{ zone: "Westfall" }], timeline: [["places", 9, null], ["constructor", 0, null], "x"] })), "");
  assert.equal(dayText("2026-10-04"), "Oct 4, 2026");
  assert.equal(dayText("nope"), "");
});

// ---- On the page ----

const ORIGIN = "https://preview.example";
const env = { DB: d1(), ASSETS: assets({ [LINKS]: DATA }) };
beforeEach(async () => {
  await setup(env);
  for (const table of ["profiles", "sessions", "users", "rate_limits"]) env.DB.sqlite.exec(`DELETE FROM ${table}`);
  delete env.SITE_FEATURES;
});

async function signIn(sub) {
  const user = await findOrCreateUser(env, { email: `${sub}@example.com`, googleSub: sub, name: `Real Name ${sub}` });
  return { user, cookie: (await startSession(env, new Request(ORIGIN), user.id)).split(";")[0] };
}
async function api(action, cookie, body) {
  const request = new Request(`${ORIGIN}/api/profile/${action}`, { method: "POST", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: cookie } });
  const res = await profileApi({ request, env, params: { action } });
  return res.json();
}
async function view(handle, cookie) {
  const headers = new Headers(cookie ? { Cookie: cookie } : {});
  const res = await profileGet({ request: new Request(`${ORIGIN}/u/${handle}`, { headers }), env, params: { handle } });
  return { status: res.status, html: await res.text() };
}

test("/u/<handle>: the journey with its trails; lore links once the lore pages are on; private stays private", async () => {
  const me = await signIn("aelric");
  await api("import", me.cookie, { record: RECORD });
  assert.equal((await view("aelric")).status, 404, "private: nobody else sees the journey");
  await api("settings", me.cookie, { public: true });

  const { status, html } = await view("aelric");
  assert.equal(status, 200);
  assert.match(html, /<h2 id="journey-title">The journey, moment by moment<\/h2>/);
  assert.match(html, /<script src="\/js\/journey\.js" defer><\/script>/);
  assert.ok(html.includes("Taken from <a class=\"pf-go\""), "Gryan gave the quest, and Aelric met him");
  assert.ok(html.includes("Storyline &middot; Westfall: The Defias Brotherhood"));
  assert.ok(!html.includes('href="/lore/'), "the lore pages are off: nothing links to them");
  assert.ok(!html.includes("Dwarf Priest") && !html.includes("Gravenx"), "other players stay out");

  env.SITE_FEATURES = "lore";
  const lore = (await view("aelric")).html;
  const pages = new Set(INDEX.pages.map(p => p.p));
  const linked = [...lore.matchAll(/href="(\/lore\/[^"#]+)"/g)].map(m => m[1]);
  for (const p of ["/lore/quest/65-the-defias-brotherhood", "/lore/npc/edwin-vancleef", "/lore/zone/deadmines",
    "/lore/subzone/sentinel-hill", "/lore/npc/gryan-stoutmantle"]) assert.ok(linked.includes(p), p);
  for (const p of linked) assert.ok(pages.has(p), `${p} is a lore page`);
  // The road and the cards link too.
  assert.match(lore, /<ol class="pf-road"><li><a href="\/lore\/zone\/teldrassil">Teldrassil<\/a><\/li>/);
  assert.ok(lore.includes('<a href="/lore/npc/edwin-vancleef">Edwin VanCleef</a> <span class="pf-where">'));
});

test("a profile saved before the timeline: the page as it was, and a nudge for its owner only", async () => {
  const me = await signIn("brakka");
  await api("import", me.cookie, { record: RECORD });
  const r = await env.DB.prepare("SELECT data FROM profiles WHERE user_id = ?").bind(me.user.id).first();
  const old = JSON.parse(r.data);
  delete old.timeline;
  await env.DB.prepare("UPDATE profiles SET data = ?, public = 1 WHERE user_id = ?").bind(JSON.stringify(old), me.user.id).run();
  const mine = (await view("aelric", me.cookie)).html;
  assert.ok(!mine.includes('id="journey"') && !mine.includes("/js/journey.js"));
  assert.match(mine, /to see\s+your journey here moment by moment/);
  const theirs = (await view("aelric")).html;
  assert.ok(theirs.includes("The road so far") && !theirs.includes("moment by moment"));
});

test("without links.json the journey still shows, its trails between moments too, with nothing linked", () => {
  const p = { handle: "aelric", public: 1, story: "A story.", story_source: "template", updated: "2026-10-04T00:00:00Z",
    data: parseRecord(RECORD, NOW) };
  const html = profilePage(p, { lore: true });
  assert.match(html, /id="journey"/);
  assert.ok(html.includes("&larr; Last time here") || html.includes("Next time here &rarr;") || html.includes("Their quests"), "some trail");
  assert.ok(!html.includes('href="/lore/'));
});
