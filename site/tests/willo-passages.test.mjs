// Story as you play on the phone (slice 5, docs/story-beats.md): the PC's app sends the story beats a character has
// opened with their save (POST /api/profile/sync `stock.beats`), and Willo for iPhone asks for the hidden passages the
// question's entries have that those beats open (POST /api/companion/passages). "Who leads the Defias?" names the
// Defias Brotherhood: before quest 135/141 (or VanCleef's death) nothing comes back that names VanCleef; after, the
// Westfall passage does. The passages live in lib/story-passages.js, never in the public lore files.
// In-process on node:sqlite (helpers.mjs). Run: node --test site/tests/willo-passages.test.mjs
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { onRequestPost as passagesApi } from "../functions/api/companion/passages.js";
import { onRequest as profileApi } from "../functions/api/profile/[action].js";
import { findOrCreateUser, setup } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { stockOf } from "../lib/willo-goals.js";
import { passagesFor, OWN_MAX, RELATED_MAX } from "../lib/willo-passages.js";
import { PASSAGES, RELATED } from "../lib/story-passages.js";
import { d1 } from "./helpers.mjs";
import { RECORD } from "./fixtures/journey/record.mjs";

const ORIGIN = "https://example.test";
const env = { DB: d1() };
const AELRIC = "Aelric-Forever";
const NOW = Math.floor(Date.now() / 1000);
const DEFIAS = ["topic:defias-brotherhood"];      // what the phone's namedIn finds in "who leads the Defias?"
// What opening quest 135/141 (or killing VanCleef) opens, as the PC's profile.opened_beats sends it.
const AFTER_141 = ["defias.masons", "defias.network"];

beforeEach(async () => {
  await setup(env);
  for (const table of ["willo_stock", "rate_limits"]) env.DB.sqlite.exec(`DELETE FROM ${table}`);
});

let n = 0;
async function linked() {
  const sub = `passages${++n}`;
  const user = await findOrCreateUser(env, { email: `${sub}@example.com`, googleSub: sub, name: sub });
  const link = await startLink(env);
  await decideLink(env, link.user_code, user, true);
  return { user, token: (await claimToken(env, link.device_code)).token };
}
const save = (over = {}) => ({ character: AELRIC, t: NOW - 600, level: 22, money: 41000, ...over });

async function sync(token, stock) {
  env.DB.sqlite.exec("DELETE FROM rate_limits");
  const res = await profileApi({ env, params: { action: "sync" }, request: new Request(`${ORIGIN}/api/profile/sync`, {
    method: "POST", headers: { "X-LF-Client": "companion/0.25.0", Authorization: `Bearer ${token}`,
      "Content-Type": "application/json" }, body: JSON.stringify({ record: RECORD, stock }) }) });
  assert.equal(res.status, 200);
}
async function ask(token, body, headers = {}) {
  const res = await passagesApi({ env, request: new Request(`${ORIGIN}/api/companion/passages`, { method: "POST",
    headers: { "X-LF-Client": "companion/ios-1.0", ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }) });
  return { status: res.status, body: await res.json() };
}
const said = passages => passages.map(p => `${p.title}\n${p.text}`).join("\n");

test("the save keeps the opened beats; anything else in them is dropped", () => {
  const s = stockOf(save({ beats: ["defias.masons", "s96.3", "defias.masons", "<script>", 5, "x".repeat(80)] }));
  assert.deepEqual(s.beats, ["defias.masons", "s96.3"]);
  assert.equal(stockOf(save()).beats, undefined);
  assert.equal(stockOf(save({ beats: "defias.masons" })).beats, undefined);
  assert.equal(stockOf({ t: NOW, beats: ["defias.masons"] }), null, "beats alone aren't a save");
});

test("who leads the Defias? Before quest 135/141 no passage names VanCleef; after, Westfall's does", async () => {
  const { token } = await linked();
  // A save from before the reveal: only a progress beat.
  await sync(token, save({ beats: ["defias.network"] }));
  let out = await ask(token, { character: AELRIC, keys: DEFIAS });
  assert.equal(out.status, 200);
  assert.deepEqual(out.body.passages, []);
  // Quest 141 done: the masons beat opens.
  await sync(token, save({ t: NOW - 60, beats: AFTER_141 }));
  out = await ask(token, { character: AELRIC, keys: DEFIAS });
  assert.equal(out.status, 200);
  assert.match(said(out.body.passages), /VanCleef/);
  const ids = out.body.passages.map(p => p.id);
  assert.ok(ids.includes("zone:westfall#section4"), ids.join(", "));
  // The Brotherhood's own "From Masons to Marauders" opens too: The Collector's ring (q123.3) tells a piece of the
  // same fact, which defias.masons implies, so it doesn't wait for that quest as well (beats.waits_for).
  assert.ok(ids.includes("topic:defias-brotherhood#section3"), ids.join(", "));
  for (const p of out.body.passages) {
    const row = PASSAGES[p.key].find(r => r[0] === p.id);
    assert.ok(row[3].every(b => AFTER_141.includes(b)), `${p.id} waits for ${row[3]}`);
  }
});

test("no passages without a save, for another character, the account page, or when signed out", async () => {
  const { token } = await linked();
  assert.deepEqual((await ask(token, { character: AELRIC, keys: DEFIAS })).body.passages, []);
  await sync(token, save({ beats: AFTER_141 }));
  assert.deepEqual((await ask(token, { character: "Brynn-Forever", keys: DEFIAS })).body.passages, []);
  assert.deepEqual((await ask(token, { character: "account", keys: DEFIAS })).body.passages, []);
  assert.deepEqual((await ask(token, { keys: DEFIAS })).body.passages, []);
  assert.deepEqual((await ask(token, { character: AELRIC, keys: [] })).body.passages, []);
  assert.equal((await ask(null, { character: AELRIC, keys: DEFIAS })).status, 401);
  assert.equal((await ask(token, { character: AELRIC, keys: DEFIAS }, { Origin: ORIGIN })).status, 403);
});

test("a passage opens only when all of its beats are, own entries first, then a few related ones", () => {
  const data = {
    PASSAGES: {
      "topic:a": [["topic:a#section2", "One", "one", ["x"]], ["topic:a#section3", "Both", "both", ["x", "y"]]],
      "zone:b": [["zone:b#section1", "B", "b", ["x"]]], "zone:c": [["zone:c#section1", "C", "c", ["x"]]],
      "zone:d": [["zone:d#section1", "D", "d", ["x"]]],
    },
    RELATED: { "topic:a": ["zone:b", "zone:c", "zone:d"] },
  };
  assert.deepEqual(passagesFor(["x"], ["topic:a"], { data }).map(p => p.id),
    ["topic:a#section2", ...["zone:b#section1", "zone:c#section1"].slice(0, RELATED_MAX)]);
  assert.deepEqual(passagesFor(["x", "y"], ["topic:a"], { data }).slice(0, 2).map(p => p.id),
    ["topic:a#section2", "topic:a#section3"]);
  assert.deepEqual(passagesFor([], ["topic:a"], { data }), []);
  assert.deepEqual(passagesFor(["x"], ["../etc", 5], { data }), []);
  assert.ok(OWN_MAX >= 1);
});

test("hidden passages never reach the public lore files", () => {
  assert.ok(Object.keys(PASSAGES).length > 50);
  for (const [key, rows] of Object.entries(PASSAGES)) {
    const file = new URL(`../public/lore/data/e/${key.replace(":", "_")}.json`, import.meta.url);
    if (!existsSync(file)) continue;
    const page = readFileSync(file, "utf8");
    for (const [id, , text] of rows) assert.ok(!page.includes(text.slice(0, 120)), `${id} is in ${key}'s public page`);
  }
  for (const near of Object.values(RELATED)) for (const k of near) assert.ok(PASSAGES[k], k);
});
