// The companion's journey data on a profile (LOR-248): readJourney (lib/journey.js), POST /api/profile/sync with
// {record, journey}, the moments it gives the page (quests taken and turned in, by ID) and the road chart
// (lib/roadchart.js). D1 is node:sqlite (helpers.mjs). Run: node --test site/tests/
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onRequest as deviceApi } from "../functions/api/device/[action].js";
import { onRequest as profileApi } from "../functions/api/profile/[action].js";
import { onRequestGet as profileGet } from "../functions/u/[handle].js";
import { findOrCreateUser, startSession, setup } from "../lib/accounts.js";
import { parseRecord, readJourney, MAX_MOMENTS } from "../lib/journey.js";
import { linker, moments, journeySection, LINKS, SHOWN } from "../lib/trails.js";
import { route, fitView, roadChart, LANDS, W, H } from "../lib/roadchart.js";
import { d1, assets, SITE } from "./helpers.mjs";
import { RECORD } from "./fixtures/journey/record.mjs";

const NOW = new Date("2026-10-04T12:00:00Z");
const DATA = JSON.parse(readFileSync(`${SITE}public/lore/data/links.json`, "utf8"));
const NAMES = linker(DATA);
const at = iso => Date.parse(iso) / 1000;

// What the companion sends for Aelric (profile.py journey_payload), plus what it must never keep.
const SENT = {
  v: 1, tz: -420, moments: [
    { t: at("2026-10-01T21:00:00Z"), k: "zone", z: "Teldrassil", s: "Shadowglen", new: 1 },
    { t: at("2026-10-01T21:05:00Z"), k: "npc", n: "Conservator Ilthalaine", z: "Teldrassil", s: "Shadowglen" },
    { t: at("2026-10-01T21:06:00Z"), k: "qa", id: 456, n: "The Balance of Nature", z: "Teldrassil", s: "Shadowglen" },
    { t: at("2026-10-01T21:30:00Z"), k: "qt", id: 456, n: "The Balance of Nature", z: "Teldrassil", s: "Shadowglen", pt: ["Dwarf Priest"] },
    { t: at("2026-10-02T03:00:00Z"), k: "zone", z: "Darkshore", s: "Auberdine", new: 1, how: "boat", at: "148:381:439" },
    { t: at("2026-10-02T03:10:00Z"), k: "death", z: "Darkshore", s: "Auberdine", by: "Murloc Forager" },
    { t: at("2026-10-02T03:20:00Z"), k: "death", z: "Darkshore", s: "Auberdine", by: "Gravenx" },
    { t: at("2026-10-02T03:30:00Z"), k: "spell", n: "Bear Form" },
    { t: at("2026-10-02T03:31:00Z"), k: "zone", z: "Darkshore", s: "Auberdine" },
    { t: at("2026-10-03T16:00:00Z"), k: "zone", z: "Westfall", s: "Sentinel Hill", new: 1, how: "flight" },
    { t: at("2026-10-03T16:05:00Z"), k: "npc", n: "Gryan Stoutmantle", z: "Westfall", s: "Sentinel Hill" },
    { t: at("2026-10-03T16:06:00Z"), k: "qa", id: 65, n: "The Defias Brotherhood", z: "Westfall", s: "Sentinel Hill" },
    { t: at("2026-10-03T17:00:00Z"), k: "zone", z: "The Deadmines", inst: 1, how: "instance" },
    { t: at("2026-10-03T17:20:00Z"), k: "kill", n: "Foreman Thistlenettle", cls: "elite", z: "The Deadmines" },
    { t: at("2026-10-03T17:25:00Z"), k: "kill", n: "Defias Thug", z: "The Deadmines" },
    { t: at("2026-10-03T17:40:00Z"), k: "boss", n: "Edwin VanCleef", z: "The Deadmines", pt: ["Dwarf Priest", "Human Warrior"] },
    { t: at("2026-10-03T18:30:00Z"), k: "qt", id: 65, n: "The Defias Brotherhood", z: "Westfall", s: "Sentinel Hill" },
    { t: at("2026-10-03T18:31:00Z"), k: "loot", n: "Westfall Gloves", ql: 2, qid: 65, z: "Westfall", s: "Sentinel Hill" },
    { t: at("2026-10-03T19:00:00Z"), k: "lvl", lv: 24, z: "Wetlands" },
    { t: at("2030-01-01T00:00:00Z"), k: "npc", n: "From the future" },
    { t: "soon", k: "npc", n: "No time" },
  ],
};

test("readJourney keeps the moments and fields it knows, and nothing about anyone else", () => {
  const j = readJourney(SENT, parseRecord(RECORD, NOW), NOW);
  assert.equal(j.v, 1);
  assert.equal(j.tz, -420);
  assert.deepEqual(j.moments.map(m => m.k), ["zone", "npc", "qa", "qt", "zone", "death", "death", "zone", "npc", "qa",
    "zone", "kill", "boss", "qt", "loot", "lvl"]);
  const json = JSON.stringify(j);
  for (const gone of ["Dwarf Priest", "Gravenx", "Bear Form", "Defias Thug", "148:381:439", "From the future", "No time"]) {
    assert.ok(!json.includes(gone), gone);
  }
  assert.deepEqual(j.moments[4], { t: SENT.moments[4].t, k: "zone", z: "Darkshore", s: "Auberdine", new: 1, how: "boat" });
  assert.equal(j.moments[5].by, "Murloc Forager");   // a foe the record lists
  assert.equal(j.moments[6].by, undefined);          // could be a player
  assert.deepEqual(j.moments[14], { t: SENT.moments[17].t, k: "loot", n: "Westfall Gloves", z: "Westfall", s: "Sentinel Hill", ql: 2, qid: 65 });
  // Names are tidied and capped; nonsense reads as nothing.
  const odd = readJourney({ v: 1, moments: [{ t: at("2026-10-01T00:00:00Z"), k: "npc", n: "A".repeat(500) + "\u0000" }] }, null, NOW);
  assert.equal(odd.moments[0].n.length, 80);
  assert.equal(odd.tz, 0);
  for (const bad of [null, "x", { v: 2, moments: [] }, { v: 1 }, { v: 1, moments: [{ k: "npc" }] }, { v: 1, moments: "x" }]) {
    assert.equal(readJourney(bad, null, NOW), null);
  }
  const many = { v: 1, moments: Array.from({ length: MAX_MOMENTS + 50 }, (_, i) => ({ t: at("2026-09-01T00:00:00Z") + i, k: "npc", n: `P${i}` })) };
  assert.equal(readJourney(many, null, NOW).moments.length, MAX_MOMENTS);
  assert.equal(readJourney(many, null, NOW).moments[0].n, "P50", "the newest are kept");
});

test("the page's moments from the journey: taken and turned in by ID, days on the player's clock, IDs link out", () => {
  const j = readJourney(SENT, parseRecord(RECORD, NOW), NOW);
  const ms = moments(parseRecord(RECORD, NOW), NAMES, j);
  const [took, done] = ms.filter(m => m.e.title === "The Defias Brotherhood");
  assert.deepEqual([took.k, done.k], ["taken", "quests"]);
  assert.equal(done.taken, took);
  assert.equal(took.done, done);
  assert.equal(done.quest.p, "/lore/quest/65-the-defias-brotherhood");
  assert.equal(took.giver, "Gryan Stoutmantle");
  assert.equal(took.met, ms.find(m => m.k === "people" && m.e.name === "Gryan Stoutmantle"));
  assert.equal(done.out.url, "https://www.wowhead.com/forever/quest=65");
  assert.equal(ms.find(m => m.k === "loot").reward, done);
  // 03:00 UTC on Oct 2 is the evening of Oct 1 on the player's clock (UTC-7).
  assert.equal(ms.find(m => m.k === "places" && m.e.zone === "Darkshore").day, "2026-10-01");
  assert.equal(ms.find(m => m.k === "places" && m.e.zone === "Darkshore").e.how, "boat");

  const html = journeySection(ms, { lore: NAMES });
  assert.ok(html.includes('Took on <a href="/lore/quest/65-the-defias-brotherhood">The Defias Brotherhood</a>'));
  assert.match(html, /Taken at <a class="pf-go" href="#m-\d+" aria-label="Where it was taken: Took on The Defias Brotherhood, Oct 3, 2026">Sentinel Hill<\/a>/);
  assert.match(html, /Turned in at <a class="pf-go" href="#m-\d+"[^>]*>Sentinel Hill<\/a>/);
  assert.match(html, / data-land="the deadmines"/);
  const ids = new Set([...html.matchAll(/ id="(m-\d+)"/g)].map(m => m[1]));
  for (const t of html.matchAll(/href="#(m-\d+)"/g)) assert.ok(ids.has(t[1]), t[1]);
  assert.ok(!/\b\d{1,2}:\d\d\b/.test(html), "never the time of day");
});

test("a long journey shows its newest moments, and a trail to an older one is just its name", () => {
  const base = at("2026-09-01T00:00:00Z");
  const long = { v: 1, tz: 0, moments: [
    { t: base, k: "npc", n: "Gryan Stoutmantle", z: "Westfall", s: "Sentinel Hill" },
    ...Array.from({ length: SHOWN + 99 }, (_, i) => ({ t: base + 60 + i * 60, k: "npc", n: `Person ${i}`, z: "Elwynn Forest" })),
    { t: base + 99999, k: "qa", id: 65, n: "The Defias Brotherhood", z: "Westfall", s: "Sentinel Hill" },
  ] };
  const ms = moments(parseRecord(RECORD, NOW), NAMES, readJourney(long, null, NOW));
  const html = journeySection(ms);
  assert.equal([...html.matchAll(/ id="m-\d+"/g)].length, SHOWN);
  assert.ok(html.includes(`The latest ${SHOWN} of ${SHOWN + 101} moments.`));
  assert.ok(html.includes("Taken from Gryan Stoutmantle") && !html.includes('href="#m-0"'), "Gryan's moment isn't on the page");
});

test("the road chart: lands in the order reached, the legs between them, flights dashed, only reached lands named", () => {
  const j = readJourney(SENT, parseRecord(RECORD, NOW), NOW);
  const ms = moments(parseRecord(RECORD, NOW), NAMES, j);
  const { lands, legs, unknown } = route(ms);
  assert.deepEqual([...lands.keys()], ["teldrassil", "darkshore", "westfall", "deadmines", "wetlands"]);
  assert.deepEqual(legs.map(l => `${l.from}>${l.to}:${l.how}`),
    ["teldrassil>darkshore:boat", "darkshore>westfall:flight", "westfall>deadmines:instance", "deadmines>westfall:null",
     "westfall>wetlands:null"]);
  assert.deepEqual(unknown, []);
  const html = roadChart(ms, { name: "Aelric" });
  assert.match(html, /<figure class="pf-chart" id="road-chart">/);
  assert.match(html, /aria-label="Road chart of the lands Aelric has reached"/);
  assert.equal([...html.matchAll(/class="pf-ch-stop /g)].length, 5);
  assert.match(html, /data-land="westfall" data-x="632" data-name="Westfall" aria-label="Westfall: reached 3rd, 5 moments"/);
  assert.match(html, /class="pf-ch-road pf-ch-travel"/, "the boat and the flight are dashed");
  assert.match(html, /pf-ch-stop pf-ch-z pf-ch-now"[^>]*data-land="wetlands"/, "the latest land");
  assert.ok(!html.includes("Silithus") && !html.includes("Stranglethorn"), "lands not reached have no name");
  assert.match(html, /flights, boats, hearthstones and portals are dashed/);
  // Every stop links to a moment on the page.
  const page = journeySection(ms);
  for (const t of html.matchAll(/href="#(m-\d+)"/g)) assert.ok(page.includes(`id="${t[1]}"`), t[1]);

  // A pasted record: the lands in order, no travel kinds, and a name no land matches listed under the chart.
  const pasted = roadChart(moments(parseRecord(RECORD.replace("Menethil Harbor, Wetlands", "Menethil Harbor, Sumpfland"), NOW), NAMES));
  assert.match(pasted, /The lands in the order they were reached\./);
  assert.ok(!pasted.includes("pf-ch-travel"));
  assert.match(pasted, /Not on the chart: Sumpfland\./);
  assert.equal(roadChart(moments({ timeline: [["places", 0, null]], places: [{ zone: "Westfall" }] })), "", "one land: no chart");
});

test("a building or another name the game gives as the zone counts for its land on the chart and its filter", () => {
  // As Húrin's record has them (10/5): Forever's name for the Stockade, a tower and a town hall named instead of the zone.
  const places = [{ zone: "Elwynn Forest" }, { zone: "Stormwind Stockade", dungeon: true }, { zone: "Westfall" },
    { zone: "Sentinel Tower" }, { zone: "Lakeshire Town Hall" }, { zone: "Deeprun Tram" }, { zone: "Ironforge" }];
  const ms = moments({ places, timeline: places.map((_, i) => ["places", i, null]) });
  const { lands, legs, unknown } = route(ms);
  assert.deepEqual([...lands.keys()], ["elwynn", "stockade", "westfall", "redridge", "ironforge"]);
  assert.equal(lands.get("westfall").n, 2, "Sentinel Tower is in Westfall");
  assert.deepEqual(legs.map(l => `${l.from}>${l.to}`), ["elwynn>stockade", "stockade>westfall", "westfall>redridge", "redridge>ironforge"]);
  assert.deepEqual(unknown, ["Deeprun Tram"], "the tram is no land");
  const html = roadChart(ms);
  assert.match(html, /href="#m-1" data-land="the stockade" data-x="636" data-name="The Stockade"/);
  assert.match(html, /Not on the chart: Deeprun Tram\./);
  // Picking a land on the chart shows its moments (public/js/journey.js matches data-land): the tower's are Westfall's.
  const page = journeySection(ms);
  assert.match(page, /id="m-3" data-g="places" data-land="westfall"/);
  assert.match(page, /id="m-4" data-g="places" data-land="redridge mountains"/);
  assert.match(page, /Reached <strong>Sentinel Tower<\/strong>/, "the moment keeps the name it was recorded with");
});

test("the chart's first view fits the lands reached, in the chart's shape and inside it", () => {
  for (const pts of [[[632, 542], [606, 558]], [[135, 70], [822, 588]], [[100, 52]], []]) {
    const [x, y, w, h] = fitView(pts);
    assert.ok(Math.abs(w / h - W / H) < 0.01, `${w}x${h}`);
    assert.ok(x >= 0 && y >= 0 && x + w <= W + 0.1 && y + h <= H + 0.1, `${x},${y},${w},${h}`);
    for (const [px, py] of pts) assert.ok(px >= x && px <= x + w && py >= y && py <= y + h);
  }
  const keys = new Set(LANDS.map(l => l[0]));
  assert.equal(keys.size, LANDS.length, "each land once");
  for (const [, , x, y] of LANDS) assert.ok(x > 0 && x < W && y > 0 && y < H);
});

// ---- POST /api/profile/sync with the journey, and the page ----

const ORIGIN = "https://preview.example";
const env = { DB: d1(), ASSETS: assets({ [LINKS]: DATA }) };
beforeEach(async () => {
  await setup(env);
  for (const t of ["profiles", "sessions", "users", "rate_limits", "devices", "device_links"]) env.DB.sqlite.exec(`DELETE FROM ${t}`);
  delete env.SITE_FEATURES;
});

async function signIn(sub) {
  const user = await findOrCreateUser(env, { email: `${sub}@example.com`, googleSub: sub, name: `Real Name ${sub}` });
  return { user, cookie: (await startSession(env, new Request(ORIGIN), user.id)).split(";")[0] };
}
async function device(action, { body, cookie } = {}) {
  const h = new Headers({ "Content-Type": "application/json" });
  if (cookie) { h.set("Cookie", cookie); h.set("Origin", ORIGIN); } else h.set("X-LF-Client", "companion/0.2.0");
  const res = await deviceApi({ request: new Request(`${ORIGIN}/api/device/${action}`, { method: "POST", headers: h,
    body: JSON.stringify(body ?? {}) }), env, params: { action } });
  return res.json();
}
async function connect(who) {
  const start = await device("start");
  await device("approve", { cookie: who.cookie, body: { code: start.user_code } });
  return (await device("token", { body: { device_code: start.device_code } })).token;
}
async function sync(token, body) {
  const res = await profileApi({ request: new Request(`${ORIGIN}/api/profile/sync`, { method: "POST", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", "X-LF-Client": "companion/0.2.0", Authorization: `Bearer ${token}` } }),
    env, params: { action: "sync" } });
  return { status: res.status, body: await res.json() };
}
async function post(action, cookie, body) {
  const res = await profileApi({ request: new Request(`${ORIGIN}/api/profile/${action}`, { method: "POST", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: cookie } }), env, params: { action } });
  return res.json();
}
const stored = async id => {
  const r = await env.DB.prepare("SELECT journey FROM profiles WHERE user_id = ?").bind(id).first();
  return r?.journey ? JSON.parse(r.journey) : null;
};

test("sync keeps the journey in its own column; same again changes nothing; old companions and pastes keep it", async () => {
  const me = await signIn("aelric");
  const token = await connect(me);
  const first = await sync(token, { record: RECORD, journey: SENT });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal((await stored(me.user.id)).moments.length, 16);
  assert.equal((await sync(token, { record: RECORD, journey: SENT })).body.unchanged, true);
  // One more moment: an update.
  const more = { ...SENT, moments: [...SENT.moments, { t: at("2026-10-03T20:00:00Z"), k: "npc", n: "Marshal Gryan", z: "Westfall" }] };
  const again = await sync(token, { record: RECORD, journey: more });
  assert.ok(!again.body.unchanged);
  assert.equal((await stored(me.user.id)).moments.length, 17);
  // A companion that sends only the record, and a paste of the same character: the journey stays.
  assert.equal((await sync(token, { record: RECORD })).body.unchanged, true);
  await post("import", me.cookie, { record: RECORD });
  assert.equal((await stored(me.user.id)).moments.length, 17);
  // Journey data that doesn't read keeps what's there.
  await sync(token, { record: RECORD, journey: { v: 9, moments: [] } });
  assert.equal((await stored(me.user.id)).moments.length, 17);
  // Another character's record (a paste) drops it.
  await post("import", me.cookie, { record: RECORD.replace("Aelric - Forever", "Brakka - Forever") });
  assert.equal(await stored(me.user.id), null);
});

test("/u/<handle> with the companion's journey: the chart, the quest trails, lore links once the pages are on", async () => {
  const me = await signIn("aelric");
  const token = await connect(me);
  await sync(token, { record: RECORD, journey: SENT });
  await post("settings", me.cookie, { public: true });
  env.SITE_FEATURES = "-lore";   // the off state first: the lore pages are on by default since #300
  const view = async cookie => {
    const res = await profileGet({ request: new Request(`${ORIGIN}/u/aelric`, { headers: cookie ? { Cookie: cookie } : {} }),
      env, params: { handle: "aelric" } });
    return { status: res.status, html: await res.text() };
  };
  const { status, html } = await view();
  assert.equal(status, 200);
  // A shared link lands on the trek: Map and Timeline right under the head, before the stats, each with its own link.
  assert.match(html, /<nav class="pf-views" aria-label="Follow the journey" hidden>\s*<a href="#map" data-view="map">Map<\/a><a href="#timeline" data-view="timeline">Timeline<\/a>/);
  const [head, mapAt, timelineAt, stats] = ['class="vpr-head', 'id="map"', 'id="timeline"', 'class="pf-stats"'].map(s => html.indexOf(s));
  assert.ok(head < mapAt && mapAt < timelineAt && timelineAt < stats, [head, mapAt, timelineAt, stats].join());
  assert.ok(!html.includes("data-copy"), "no owner bar for visitors");
  const mine = (await view(me.cookie)).html;
  for (const b of ['data-share-text="Aelric&#39;s journey in WoW Forever">Share', 'data-copy="map">Copy map link',
    'data-copy="timeline">Copy timeline link']) {
    assert.ok(mine.includes(b), b);
  }
  assert.match(html, /<figure class="pf-chart" id="road-chart">/);
  assert.match(html, /<script src="\/js\/roadchart\.js" defer><\/script>/);
  assert.match(html, /Taken at <a class="pf-go"/);
  assert.match(html, /Turned in at <a class="pf-go"/);
  assert.ok(html.includes('href="https://www.wowhead.com/forever/quest=65"'));
  assert.ok(!html.includes('href="/lore/'), "the lore pages are off");
  assert.ok(!html.includes("Gravenx") && !html.includes("Dwarf Priest") && !html.includes("381:439"));
  env.SITE_FEATURES = "lore";
  assert.ok((await view()).html.includes('Took on <a href="/lore/quest/65-the-defias-brotherhood">'));
  // Private again: nobody else sees any of it.
  await post("settings", me.cookie, { public: false });
  assert.equal((await view()).status, 404);
});
