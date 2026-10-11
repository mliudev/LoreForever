// What players use (LOR-413): the companion's per-day usage counts on POST /api/profile/sync (lib/usage.js), what
// /admin adds up from them, "Delete my account" removing them, site downloads counted by their link's ?src=, and the
// profile views and shares the site counts (LOR-151).
// The handlers run in-process on node:sqlite (helpers.mjs); nothing here requests the live site. Run: node --test site/tests/
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { onRequest as deviceApi } from "../functions/api/device/[action].js";
import { onRequest as profileApi } from "../functions/api/profile/[action].js";
import { onRequestGet as adminGet } from "../functions/api/admin.js";
import { onRequestGet as download } from "../functions/download/[file].js";
import { onRequestGet as profilePage } from "../functions/u/[handle].js";
import { onRequestPost as countApi } from "../functions/api/count/[what].js";
import { findOrCreateUser, startSession, setup, deleteUser } from "../lib/accounts.js";
import { readUsage, saveUsage, USAGE_KEEP_DAYS } from "../lib/usage.js";

import { d1 } from "./helpers.mjs";
import { RECORD } from "./fixtures/journey/record.mjs";

const ORIGIN = "https://preview.example";
const KEY = "admin-test-key";
const env = { DB: d1(), ADMIN_KEY: KEY };
const day = (offset = 0) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
beforeEach(async () => {
  await setup(env);
  env.DB.sqlite.exec("DROP TABLE IF EXISTS site_counts");
  for (const t of ["profiles", "sessions", "users", "rate_limits", "devices", "device_links", "usage_days"]) {
    env.DB.sqlite.exec(`DELETE FROM ${t}`);
  }
});

async function connect(sub) {
  const user = await findOrCreateUser(env, { email: `${sub}@example.com`, googleSub: sub, name: `Real Name ${sub}` });
  const cookie = (await startSession(env, new Request(ORIGIN), user.id)).split(";")[0];
  const call = async (action, body, headers) => (await deviceApi({ env, params: { action }, request: new Request(
    `${ORIGIN}/api/device/${action}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body) }) })).json();
  const start = await call("start", {}, { "X-LF-Client": "companion/0.1.0" });
  await call("approve", { code: start.user_code }, { Cookie: cookie, Origin: ORIGIN });
  const { token } = await call("token", { device_code: start.device_code }, { "X-LF-Client": "companion/0.1.0" });
  return { user, token, cookie };
}

async function sync(token, usage) {
  const request = new Request(`${ORIGIN}/api/profile/sync`, { method: "POST",
    headers: { "Content-Type": "application/json", "X-LF-Client": "companion/0.1.0", Authorization: "Bearer " + token },
    body: JSON.stringify({ record: RECORD, ...(usage ? { usage } : {}) }) });
  const res = await profileApi({ request, env, params: { action: "sync" } });
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
}

const stored = userId => Object.fromEntries(env.DB.sqlite.prepare(
  "SELECT day, counts FROM usage_days WHERE user_id = ? ORDER BY day").all(userId).map(r => [r.day, JSON.parse(r.counts)]));

test("a sync keeps the usage counts per day, only known counts as numbers, the larger count winning", async () => {
  const { user, token } = await connect("aelric");
  await sync(token, { v: 1, days: {
    [day(-1)]: { play: { zone: 3, answer: 1, "Edwin VanCleef": 2 }, done: { zone: 2 }, ask: 2, panel: 4,
                 chat: 3, newchat: 1, q: "who is the lich king", pic: -1, journey: 1.5, live: 1e9 },
    [day(-60)]: { ask: 1 }, [day(5)]: { ask: 1 }, Aelric: { ask: 1 },
  } });
  assert.deepEqual(stored(user.id), {
    [day(-1)]: { "play.zone": 3, "play.answer": 1, "done.zone": 2, ask: 2, panel: 4, chat: 3, newchat: 1 },
    [day()]: { sync: 1 },                      // synced today: a syncing player even before playing today
  });
  const all = JSON.stringify(env.DB.sqlite.prepare("SELECT * FROM usage_days").all());
  for (const gone of ["Edwin", "lich king", "Aelric", "Real Name"]) assert.ok(!all.includes(gone), gone);

  // The same day again (every sync sends the newest days): smaller counts never shrink it, larger ones grow it.
  await sync(token, { v: 1, days: { [day(-1)]: { ask: 1, panel: 6, play: { zone: 3 } } } });
  assert.deepEqual(stored(user.id)[day(-1)], { "play.zone": 3, "play.answer": 1, "done.zone": 2, ask: 2, panel: 6,
                                             chat: 3, newchat: 1 });
  // An add-on without counts (or a broken table) still syncs.
  await sync(token, "not usage");
  await sync(token);
  assert.equal(Object.keys(stored(user.id)).length, 2);
  // Unchanged counts cost no write.
  assert.equal(await saveUsage(env, user.id, readUsage({ v: 1, days: { [day(-1)]: { ask: 2 } } })), 0);
});

test("counts older than the keeping period go", async () => {
  const { user } = await connect("morwen");
  env.DB.sqlite.prepare("INSERT INTO usage_days (user_id, day, counts) VALUES (?, ?, ?)")
    .run(user.id, day(-USAGE_KEEP_DAYS - 1), JSON.stringify({ ask: 1 }));
  await saveUsage(env, user.id, null);
  assert.deepEqual(Object.keys(stored(user.id)), [day()]);
});

test("/admin adds up syncing players, feature use and heard-to-the-end by kind", async () => {
  const a = await connect("aelric"), b = await connect("brann"), c = await connect("cairne");
  await sync(a.token, { v: 1, days: { [day(-1)]: { play: { zone: 4, answer: 2 }, done: { zone: 3, answer: 2 }, ask: 1 },
                                      [day(-20)]: { ask: 9 } } });
  await sync(b.token, { v: 1, days: { [day(-1)]: { play: { zone: 2 }, done: { zone: 1 }, panel: 2 } } });
  await sync(c.token);                          // an older add-on: syncs, sends no counts
  const get = headers => adminGet({ env, request: new Request(ORIGIN + "/api/admin", { headers }) });
  assert.equal((await get({})).status, 401);
  const { usage } = await (await get({ Authorization: "Bearer " + KEY })).json();
  const yesterday = usage.days.find(d => d.day === day(-1)), today = usage.days.find(d => d.day === day());
  assert.deepEqual([yesterday.players, yesterday.counted], [2, 2]);
  assert.deepEqual([today.players, today.counted], [3, 0]);
  assert.deepEqual([usage.window.players, usage.window.counted, usage.week], [3, 2, 3]);
  const m = usage.window.metrics;
  assert.deepEqual([m["play.zone"], m["done.zone"], m["play.answer"], m["done.answer"]],
    [{ n: 6, players: 2 }, { n: 4, players: 2 }, { n: 2, players: 1 }, { n: 2, players: 1 }]);
  assert.deepEqual([m.ask, m.panel], [{ n: 1, players: 1 }, { n: 2, players: 1 }]);   // day -20 is outside the 14
  assert.equal(m.sync, undefined);
  assert.deepEqual(usage.metrics.find(x => x.day === day(-1) && x.metric === "play.zone"),
    { day: day(-1), metric: "play.zone", n: 6, players: 2 });
});

test("Delete my account removes the usage counts", async () => {
  const { user, token } = await connect("aelric");
  await sync(token, { v: 1, days: { [day(-1)]: { ask: 1 } } });
  await deleteUser(env, user);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM usage_days").get().n, 0);
});

test("profile views, opens from outside links and shares count per day, never the owner or a link preview", async () => {
  const { user, token, cookie } = await connect("aelric");
  await sync(token);
  env.DB.sqlite.prepare("UPDATE profiles SET public = 1 WHERE user_id = ?").run(user.id);
  const { handle } = env.DB.sqlite.prepare("SELECT handle FROM profiles WHERE user_id = ?").get(user.id);
  const open = async headers => (await profilePage({ env, params: { handle },
    request: new Request(`${ORIGIN}/u/${handle}`, { headers }) })).status;
  for (const headers of [{}, { Referer: "https://discord.com/" }, { Referer: ORIGIN + "/u/someone" },
                         { Cookie: cookie }, { "User-Agent": "Mozilla/5.0 (compatible; Discordbot/2.0)" }]) {
    assert.equal(await open(headers), 200);
  }
  const share = async headers => (await countApi({ env, params: { what: "share" },
    request: new Request(`${ORIGIN}/api/count/share`, { method: "POST", headers }) })).status;
  assert.equal(await share({ Origin: ORIGIN }), 204);
  assert.equal(await share({ Origin: "https://elsewhere.example" }), 204);   // not from our pages: not counted
  const { site } = await (await adminGet({ env, request: new Request(ORIGIN + "/api/admin",
    { headers: { Authorization: "Bearer " + KEY } }) })).json();
  assert.deepEqual(Object.fromEntries(site.map(r => [r.metric, r.n])),
    { "profile.view": 3, "profile.outside": 2, "profile.share": 1 });
});

test("site downloads count by their link's ?src=, as a short slug", async () => {
  const db = d1();
  const get = (file, query = "") => download({ env: { DB: db }, params: { file },
    request: new Request(`https://loreforeverwow.com/download/${file}${query}`) });
  for (const [file, query] of [["installer", "?src=lore"], ["zip", "?src=LORE"], ["installer", "?src=lore"],
                               ["installer", "?src=%3Cscript%3E"], ["installer", ""], ["zip", "?src="]]) {
    const res = await get(file, query);
    assert.equal(res.status, 302);
    assert.ok(!res.headers.get("Location").includes("src"), "the release download carries nothing of it");
  }
  const rows = db.sqlite.prepare("SELECT file, src, n FROM download_sources ORDER BY file, src").all().map(r => ({ ...r }));
  assert.deepEqual(rows, [{ file: "installer", src: "lore", n: 2 }, { file: "installer", src: "other", n: 1 },
                          { file: "zip", src: "lore", n: 1 }]);
  const total = db.sqlite.prepare("SELECT SUM(n) AS n FROM downloads").get().n;
  assert.equal(total, 6, "every download still counts in the day's totals");
});
