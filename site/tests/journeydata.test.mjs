// The companion's journey data on a profile (LOR-248): readJourney (lib/journey.js), POST /api/profile/sync with
// {record, journey}, the moments it gives the page (quests taken and turned in, by ID) and the road chart
// (lib/roadchart.js). D1 is node:sqlite (helpers.mjs). Run: node --test site/tests/
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onRequest as deviceApi } from "../functions/api/device/[action].js";
import { onRequest as profileApi } from "../functions/api/profile/[action].js";

import { findOrCreateUser, startSession, setup } from "../lib/accounts.js";
import { parseRecord, readJourney, MAX_MOMENTS } from "../lib/journey.js";
import { LINKS } from "../lib/trails.js";

import { d1, assets, SITE } from "./helpers.mjs";
import { RECORD } from "./fixtures/journey/record.mjs";

const NOW = new Date("2026-10-04T12:00:00Z");
const DATA = JSON.parse(readFileSync(`${SITE}public/lore/data/links.json`, "utf8"));

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


test("canonical sync preserves an allowlisted story language and scoped journey identity", async () => {
  const me = await signIn("canonical"), token = await connect(me), character = "a".repeat(64);
  const read = async () => JSON.parse((await env.DB.prepare("SELECT data FROM profiles WHERE user_id = ?").bind(me.user.id).first()).data);
  for (const [record_locale, locale] of [["esES","es"],["ruRU","ru"],["ukUA","uk"],["enUS","en"]]) {
    assert.equal((await sync(token,{record:RECORD, record_locale, journey:{...SENT,character}})).status,200);
    assert.equal((await read()).locale,locale);
    assert.equal((await stored(me.user.id)).character,character);
  }
  assert.equal((await sync(token,{record:RECORD,record_locale:"__proto__"})).status,200);
  assert.equal((await read()).locale,"en");
  assert.equal(readJourney({...SENT,character:"Account/PRIVATE"}).character,undefined);
});
