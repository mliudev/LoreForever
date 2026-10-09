// The companion app keeps a player's profile up to date (LOR-148): linking it to an account with a code
// (/api/device/*, lib/devices.js), its token on POST /api/profile/sync, Disconnect from either side, what an update
// never does (switch characters, rewrite an unchanged profile) and when it writes a new story (lib/profiles.js
// storyDue). D1 is node:sqlite (helpers.mjs); Gemini is a stub on globalThis.fetch. Run: node --test site/tests/
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { onRequest as deviceApi } from "../functions/api/device/[action].js";
import { onRequest as profileApi } from "../functions/api/profile/[action].js";
import { findOrCreateUser, startSession, setup, deleteUser, sha256 } from "../lib/accounts.js";
import { LINK_MINUTES } from "../lib/devices.js";
import { STORY_SYNC_HOURS } from "../lib/profiles.js";

import { d1 } from "./helpers.mjs";
import { RECORD } from "./fixtures/journey/record.mjs";

const ORIGIN = "https://preview.example";
const CLIENT = "companion/0.1.0";
const env = { DB: d1() };
beforeEach(async () => {
  await setup(env);
  for (const t of ["profiles", "sessions", "users", "rate_limits", "story_spend", "devices", "device_links"]) {
    env.DB.sqlite.exec(`DELETE FROM ${t}`);
  }
  delete env.GEMINI_API_KEY;
});

async function signIn(sub) {
  const user = await findOrCreateUser(env, { email: `${sub}@example.com`, googleSub: sub, name: `Real Name ${sub}` });
  const set = await startSession(env, new Request(ORIGIN), user.id);
  return { user, cookie: set.split(";")[0] };
}

// The companion: no Origin, its client header, maybe its token.
async function app(action, { token, body, method = action === "status" ? "GET" : "POST", ip = "203.0.113.7", headers = {} } = {}) {
  const h = new Headers({ "Content-Type": "application/json", "X-LF-Client": CLIENT, "CF-Connecting-IP": ip, ...headers });
  if (token) h.set("Authorization", "Bearer " + token);
  const request = new Request(`${ORIGIN}/api/device/${action}`, { method, headers: h, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) });
  const res = await deviceApi({ request, env, params: { action } });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

// Our pages: signed in, with our Origin.
async function page(action, { cookie, body, method = "POST", query = "" } = {}) {
  const h = new Headers({ "Content-Type": "application/json" });
  if (cookie) h.set("Cookie", cookie);
  if (method !== "GET") h.set("Origin", ORIGIN);
  const request = new Request(`${ORIGIN}/api/device/${action}${query}`, { method, headers: h, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) });
  const res = await deviceApi({ request, env, params: { action } });
  return { status: res.status, body: await res.json() };
}

async function sync(token, record, { origin, refreshStory = false } = {}) {
  const h = new Headers({ "Content-Type": "application/json", "X-LF-Client": CLIENT });
  if (token) h.set("Authorization", "Bearer " + token);
  if (origin) h.set("Origin", origin);
  const request = new Request(`${ORIGIN}/api/profile/sync`, { method: "POST", headers: h, body: JSON.stringify({ record, refreshStory }) });
  const res = await profileApi({ request, env, params: { action: "sync" } });
  return { status: res.status, body: await res.json() };
}

async function importRecord(cookie, record) {
  const request = new Request(`${ORIGIN}/api/profile/import`, { method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: ORIGIN }, body: JSON.stringify({ record }) });
  return (await profileApi({ request, env, params: { action: "import" } })).json();
}

// Links an app to `who`'s account the way a player does; returns its token.
async function connect(who) {
  const start = await app("start");
  assert.equal(start.status, 200, JSON.stringify(start.body));
  assert.equal((await page("approve", { cookie: who.cookie, body: { code: start.body.user_code } })).status, 200);
  const got = await app("token", { body: { device_code: start.body.device_code } });
  assert.equal(got.status, 200, JSON.stringify(got.body));
  return got.body.token;
}

const row = async userId => env.DB.prepare("SELECT * FROM profiles WHERE user_id = ?").bind(userId).first();
const realFetch = globalThis.fetch;
const STORY = "Aelric stepped out of the moonlit glades of Shadowglen with nothing but a staff and a stubborn streak. " +
  "The road ran north to Darkshore and on through the whispering boughs of Ashenvale.\n\n" +
  "In the dark of the Deadmines, Aelric stood against Edwin VanCleef and walked out into the daylight again, " +
  "a little bruised and a great deal wiser. Few in Darnassus now doubt the young druid's resolve.";
function gemini() {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ story: STORY }) }] } }],
                           usageMetadata: { promptTokenCount: 2000, candidatesTokenCount: 300 } });
  };
  return calls;
}

test("connecting: the companion gets a code, the player clicks Connect, the companion gets its token once", async () => {
  const me = await signIn("aelric");
  const start = await app("start");
  assert.equal(start.status, 200);
  const { device_code, user_code, verification_uri, verification_uri_complete, expires_in, interval } = start.body;
  assert.match(device_code, /^[0-9a-f]{64}$/);
  assert.deepEqual([verification_uri, verification_uri_complete, expires_in, interval],
    [`${ORIGIN}/link`, `${ORIGIN}/link?code=${user_code}`, LINK_MINUTES * 60, 3]);
  // D1 keeps only the hash of the device code.
  const stored = env.DB.sqlite.prepare("SELECT * FROM device_links").get();
  assert.equal(stored.code_hash, await sha256(device_code));
  assert.ok(!JSON.stringify(stored).includes(device_code));

  // Waiting for the player.
  assert.equal((await app("token", { body: { device_code } })).status, 202);
  // The page: signed in, the code is shown; signed out, nothing.
  assert.equal((await page("link", { method: "GET", query: `?code=${user_code}` })).status, 401);
  const shown = await page("link", { cookie: me.cookie, method: "GET", query: `?code=${user_code.toLowerCase().replace("-", " ")}` });
  assert.equal(shown.body.link.code, user_code);
  assert.equal((await page("approve", { cookie: me.cookie, body: { code: user_code } })).body.connected, true);
  assert.equal((await page("approve", { cookie: me.cookie, body: { code: user_code } })).status, 404, "only once");

  const got = await app("token", { body: { device_code } });
  assert.equal(got.status, 200);
  assert.match(got.body.token, /^[0-9a-f]{64}$/);
  const again = await app("token", { body: { device_code } });
  assert.deepEqual([again.status, again.body.expired], [410, true], "the token is handed out once");
  const device = env.DB.sqlite.prepare("SELECT * FROM devices").get();
  assert.deepEqual([device.user_id, device.token_hash], [me.user.id, await sha256(got.body.token)]);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM device_links").get().n, 0);

  // Its status: connected, no profile yet.
  const st = await app("status", { token: got.body.token });
  assert.deepEqual([st.status, st.body.connected, st.body.profile], [200, true, null]);
  // /account lists it.
  const list = await page("list", { cookie: me.cookie, method: "GET" });
  assert.equal(list.body.devices.length, 1);
  assert.equal(list.body.devices[0].label, "Lore Forever companion");
});

test("Not now, an expired code and a made-up one never connect anything", async () => {
  const me = await signIn("aelric");
  const a = (await app("start")).body;
  assert.equal((await page("deny", { cookie: me.cookie, body: { code: a.user_code } })).status, 200);
  const denied = await app("token", { body: { device_code: a.device_code } });
  assert.deepEqual([denied.status, denied.body.denied], [403, true]);
  assert.equal((await app("token", { body: { device_code: a.device_code } })).status, 410);

  const b = (await app("start")).body;
  env.DB.sqlite.prepare("UPDATE device_links SET expires = ?").run(new Date(Date.now() - 1000).toISOString());
  assert.equal((await page("link", { cookie: me.cookie, method: "GET", query: `?code=${b.user_code}` })).status, 404);
  assert.equal((await page("approve", { cookie: me.cookie, body: { code: b.user_code } })).status, 404);
  assert.equal((await app("token", { body: { device_code: b.device_code } })).status, 410);

  assert.equal((await page("approve", { cookie: me.cookie, body: { code: "nope" } })).status, 400);
  assert.equal((await app("token", { body: { device_code: "0".repeat(64) } })).status, 410);
  assert.equal((await app("token", { body: {} })).status, 410);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM devices").get().n, 0);
});

test("only the companion talks to the companion's endpoints, and only our pages approve", async () => {
  const me = await signIn("aelric");
  assert.equal((await app("start", { headers: { Origin: "https://evil.example" } })).status, 403);
  assert.equal((await app("start", { headers: { "X-LF-Client": "" } })).status, 403);
  assert.equal((await app("start", { method: "GET" })).status, 405);
  const { user_code } = (await app("start")).body;
  const evil = new Request(`${ORIGIN}/api/device/approve`, { method: "POST",
    headers: { "Content-Type": "application/json", Cookie: me.cookie, Origin: "https://evil.example" }, body: JSON.stringify({ code: user_code }) });
  assert.equal((await deviceApi({ request: evil, env, params: { action: "approve" } })).status, 403);
  assert.equal((await page("approve", { body: { code: user_code } })).status, 401, "signed out");
  assert.equal((await page("nope", { cookie: me.cookie })).status, 404);
});

test("a token updates its account's profile; a bad, revoked or disconnected one can't", async () => {
  const me = await signIn("aelric");
  const token = await connect(me);
  const res = await sync(token, RECORD);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.created, true);
  assert.deepEqual([res.body.profile.name, res.body.profile.public, res.body.profile.url], ["Aelric", false, "/u/aelric"]);
  assert.equal((await row(me.user.id)).public, 0, "private, like a paste");
  const st = await app("status", { token });
  assert.deepEqual([st.body.profile.name, st.body.profile.realm, st.body.profile.handle], ["Aelric", "Forever", "aelric"]);
  assert.ok(st.body.device.last_sync, "it notes when it last updated");

  assert.equal((await sync("f".repeat(64), RECORD)).status, 401);
  assert.equal((await sync(null, RECORD)).status, 401);
  assert.equal((await sync(token, RECORD, { origin: "https://evil.example" })).status, 403);
  assert.equal((await sync(token, "hello")).status, 400);

  // Disconnect on /account: it stops working at once.
  const id = (await page("list", { cookie: me.cookie, method: "GET" })).body.devices[0].id;
  const other = await signIn("brakka");
  assert.equal((await page("revoke", { cookie: other.cookie, body: { id } })).status, 404, "not theirs");
  assert.equal((await page("revoke", { cookie: me.cookie, body: { id } })).body.devices.length, 0);
  assert.equal((await sync(token, RECORD)).status, 401);
  assert.equal((await app("status", { token })).status, 401);

  // Disconnect in the companion.
  const second = await connect(me);
  assert.equal((await app("disconnect", { token: second })).status, 200);
  assert.equal((await sync(second, RECORD)).status, 401);

  // A token unused for a year stops working.
  const third = await connect(me);
  env.DB.sqlite.prepare("UPDATE devices SET created = ?, last_used = ?").run("2020-01-01T00:00:00.000Z", "2020-01-02T00:00:00.000Z");
  assert.equal((await sync(third, RECORD)).status, 401);
});

test("Delete my profile disconnects the apps, so none makes it again", async () => {
  const me = await signIn("aelric");
  const token = await connect(me);
  await sync(token, RECORD);
  const request = new Request(`${ORIGIN}/api/profile/delete`, { method: "POST",
    headers: { "Content-Type": "application/json", Cookie: me.cookie, Origin: ORIGIN }, body: "{}" });
  assert.equal((await profileApi({ request, env, params: { action: "delete" } })).status, 200);
  assert.equal(await row(me.user.id), null);
  assert.equal((await sync(token, RECORD)).status, 401);
  assert.equal(await row(me.user.id), null);
});

test("Delete my account takes the connected apps and open links with it", async () => {
  const me = await signIn("aelric");
  const token = await connect(me);
  await sync(token, RECORD);
  const { user_code } = (await app("start")).body;
  await page("approve", { cookie: me.cookie, body: { code: user_code } });
  await deleteUser(env, me.user);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM devices").get().n, 0);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM device_links WHERE user_id IS NOT NULL").get().n, 0);
  assert.equal((await sync(token, RECORD)).status, 401);
});

test("an update never switches the profile to another character, and an unchanged record changes nothing", async () => {
  const me = await signIn("aelric");
  await importRecord(me.cookie, RECORD);
  const token = await connect(me);
  const before = await row(me.user.id);

  const same = await sync(token, RECORD);
  assert.deepEqual([same.status, same.body.unchanged], [200, true]);
  assert.equal((await row(me.user.id)).updated, before.updated, "nothing written");

  const alt = await sync(token, RECORD.replace("Aelric - Forever", "Brakka - Forever"));
  assert.equal(alt.status, 409);
  assert.deepEqual(alt.body.profile, { name: "Aelric", realm: "Forever" });
  assert.match(alt.body.error, /Your profile shows Aelric \(Forever\), not Brakka/);
  const after = await row(me.user.id);
  assert.deepEqual([after.handle, JSON.parse(after.data).name], ["aelric", "Aelric"]);

  const newer = await sync(token, RECORD.replace("Level 24", "Level 25"));
  assert.deepEqual([newer.status, newer.body.profile.sheet, newer.body.profile.handle], [200, "Level 25 Night Elf Druid", "aelric"]);
  // A paste still switches characters, as before.
  const pasted = await importRecord(me.cookie, RECORD.replace("Aelric - Forever", "Brakka - Forever"));
  assert.deepEqual(pasted.switched, { from: "Aelric", to: "Brakka" });
});

test("stories from updates: the first one at once, then only with something new and 6 hours since the last try", async () => {
  env.GEMINI_API_KEY = "test-key";
  const me = await signIn("aelric");
  try {
    const calls = gemini();
    const token = await connect(me);
    const first = await sync(token, RECORD);
    assert.deepEqual(first.body.story, { source: "written", why: "written" });
    assert.equal(calls.length, 1);
    let r = await row(me.user.id);
    assert.ok(r.story_at);
    assert.deepEqual(JSON.parse(r.story_basis).level, 24);

    // A little more played, right after: the profile follows, the story waits.
    const plusQuest = RECORD.replace("12 quests done", "13 quests done");
    const soon = await sync(token, plusQuest);
    assert.deepEqual(soon.body.story, { source: "written", why: "later" });
    assert.equal(calls.length, 1);
    assert.equal(JSON.parse((await row(me.user.id)).data).totals.quests, 13);

    // Six hours on, but nothing new to tell (one quest): still waits.
    const ago = h => new Date(Date.now() - h * 3600e3).toISOString();
    env.DB.sqlite.prepare("UPDATE profiles SET story_at = ?").run(ago(STORY_SYNC_HOURS + 1));
    assert.equal((await sync(token, RECORD.replace("12 quests done", "14 quests done"))).body.story.why, "later");
    // A level up, but too soon: waits.
    env.DB.sqlite.prepare("UPDATE profiles SET story_at = ?").run(ago(1));
    assert.equal((await sync(token, RECORD.replace("Level 24", "Level 25"))).body.story.why, "later");
    assert.equal(calls.length, 1);
    // A level up and six hours: a new story.
    env.DB.sqlite.prepare("UPDATE profiles SET story_at = ?").run(ago(STORY_SYNC_HOURS));
    assert.equal((await sync(token, RECORD.replace("Level 24", "Level 26"))).body.story.why, "written");
    assert.equal(calls.length, 2);
    r = await row(me.user.id);
    assert.deepEqual([r.story_count, JSON.parse(r.story_basis).level], [2, 26]);

    // Replaying the current facts through the manual path shares its written story.
    assert.equal((await importRecord(me.cookie, RECORD.replace("Level 24", "Level 26"))).story.why, "current");
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("rate limits: links per sender, approvals per account", async () => {
  for (let i = 0; i < 20; i++) assert.equal((await app("start", { ip: "198.51.100.1" })).status, 200);
  const over = await app("start", { ip: "198.51.100.1" });
  assert.equal(over.status, 429);
  assert.ok(Number(over.headers.get("Retry-After")) > 0);
  assert.equal((await app("start", { ip: "198.51.100.2" })).status, 200, "another sender");

  const me = await signIn("guesser");
  let last;
  for (let i = 0; i < 11; i++) last = await page("approve", { cookie: me.cookie, body: { code: "BCDF-GHJK" } });
  assert.equal(last.status, 429, "no guessing other people's codes");
});

test("an unchanged saved record catches up its stale story after the cooldown", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-07T12:00:00Z") });
  env.GEMINI_API_KEY = "test-key";
  const me = await signIn("catchup");
  try {
    const calls = gemini();
    const token = await connect(me);
    await sync(token, RECORD);
    const newer = RECORD.replace("Level 24", "Level 25");
    assert.equal((await sync(token, newer)).body.story.why, "later");
    assert.equal(JSON.parse((await row(me.user.id)).data).level, 25);
    assert.equal(JSON.parse((await row(me.user.id)).story_basis).level, 24);
    t.mock.timers.tick(STORY_SYNC_HOURS * 3600e3 + 1);
    const catchup = await sync(token, newer);
    assert.equal(catchup.body.story?.why, "written");
    assert.equal(calls.length, 2);
    assert.equal(JSON.parse((await row(me.user.id)).story_basis).level, 25);
  } finally { globalThis.fetch = realFetch; }
});

test("explicit sync refreshes inside the cooldown, while identical replays share the story", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-07T12:00:00Z") });
  env.GEMINI_API_KEY = "test-key";
  const me = await signIn("explicit");
  try {
    const calls = gemini(), token = await connect(me);
    await sync(token, RECORD);
    const newer = RECORD.replace("Level 24", "Level 25");
    const refreshed = await sync(token, newer, { refreshStory: true });
    assert.equal(refreshed.body.story.why, "written");
    assert.equal(calls.length, 2);
    assert.equal(JSON.parse((await row(me.user.id)).story_basis).level, 25);
    const replay = await sync(token, newer, { refreshStory: true });
    assert.equal(replay.body.story.why, "current");
    assert.equal(calls.length, 2);
    assert.equal((await importRecord(me.cookie, newer)).story.why, "current");
    assert.equal(calls.length, 2);
    assert.equal((await sync(token, RECORD.replace("Level 24", "Level 26"))).body.story.why, "later");
  } finally { globalThis.fetch = realFetch; }
});

test("overlapping explicit syncs save facts immediately and charge one writer", async () => {
  const me = await signIn("overlap"), token = await connect(me);
  await sync(token, RECORD);
  env.GEMINI_API_KEY = "test-key";
  let release, started;
  const entered = new Promise(resolve => started = resolve);
  const delayed = new Promise(resolve => release = resolve);
  let calls = 0;
  globalThis.fetch = async () => {
    calls++; started(); await delayed;
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ story: STORY }) }] } }],
      usageMetadata: { promptTokenCount: 2000, candidatesTokenCount: 300 } });
  };
  try {
    const newer = RECORD.replace("Level 24", "Level 25");
    const first = sync(token, newer, { refreshStory: true });
    await entered;
    assert.equal(JSON.parse((await row(me.user.id)).data).level, 25, "facts delivered before writer completes");
    const duplicate = await sync(token, newer, { refreshStory: true });
    assert.equal(duplicate.body.story.why, "pending");
    assert.equal(calls, 1);
    release();
    assert.equal((await first).body.story.why, "written");
    assert.equal(calls, 1);
  } finally { release?.(); globalThis.fetch = realFetch; }
});

test("delayed stories cannot overwrite newer facts or a switched character", async () => {
  const me = await signIn("delayed"), token = await connect(me);
  await sync(token, RECORD);
  env.GEMINI_API_KEY = "test-key";
  let release, started;
  const entered = new Promise(resolve => started = resolve);
  const delayed = new Promise(resolve => release = resolve);
  globalThis.fetch = async () => {
    started(); await delayed;
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ story: STORY }) }] } }],
      usageMetadata: { promptTokenCount: 2000, candidatesTokenCount: 300 } });
  };
  try {
    const writing = sync(token, RECORD.replace("Level 24", "Level 25"), { refreshStory: true });
    await entered;
    delete env.GEMINI_API_KEY;
    await importRecord(me.cookie, RECORD.replace("Aelric - Forever", "Brakka - Forever"));
    release();
    assert.equal((await writing).body.story.why, "pending");
    const after = await row(me.user.id);
    assert.equal(JSON.parse(after.data).name, "Brakka");
    assert.equal(after.story_source, "template");
    assert.ok(!after.story.includes("Aelric"));
  } finally { release?.(); globalThis.fetch = realFetch; }
});

test("story failures and daily/monthly limits retain delivered facts and the working story", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-07T12:00:00Z") });
  env.GEMINI_API_KEY = "test-key";
  const me = await signIn("limits");
  try {
    const calls = gemini(), token = await connect(me);
    await sync(token, RECORD);
    globalThis.fetch = async () => { calls.push("failed"); throw new Error("mock offline"); };
    assert.equal((await sync(token, RECORD.replace("Level 24", "Level 25"), { refreshStory: true })).body.story.why, "network");
    assert.equal(JSON.parse((await row(me.user.id)).data).level, 25);
    assert.equal((await row(me.user.id)).story, STORY);
    await sync(token, RECORD.replace("Level 24", "Level 26"), { refreshStory: true });
    const limited = await sync(token, RECORD.replace("Level 24", "Level 27"), { refreshStory: true });
    assert.equal(limited.body.story.why, "daily");
    assert.ok(limited.body.storyRetryAt > Date.now());
    assert.equal(calls.length, 3);
    assert.equal(JSON.parse((await row(me.user.id)).data).level, 27);
    env.STORY_BUDGET_USD = "0";
    const budget = await importRecord(me.cookie, RECORD.replace("Level 24", "Level 28"));
    assert.equal(budget.story.why, "budget");
    assert.equal(calls.length, 3);
    assert.equal(JSON.parse((await row(me.user.id)).data).level, 28);
    assert.equal((await row(me.user.id)).story, STORY);
  } finally { globalThis.fetch = realFetch; delete env.STORY_BUDGET_USD; }
});

test("a character switched during fact delivery cannot be switched back by a stale sync", async () => {
  const me = await signIn("switch-during-delivery"), token = await connect(me);
  await sync(token, RECORD);
  const prepare = env.DB.prepare;
  let release, entered, intercepted = false;
  const paused = new Promise(resolve => release = resolve);
  const started = new Promise(resolve => entered = resolve);
  env.DB.prepare = sql => {
    const statement = prepare(sql);
    if (sql !== "SELECT * FROM profiles WHERE user_id = ?" || intercepted) return statement;
    intercepted = true;
    const bind = statement.bind;
    statement.bind = (...args) => {
      const bound = bind(...args), first = bound.first;
      bound.first = async (...args) => { const snapshot = await first(...args); entered(); await paused; return snapshot; };
      return bound;
    };
    return statement;
  };
  try {
    const stale = sync(token, RECORD.replace("Level 24", "Level 25"));
    await started;
    await importRecord(me.cookie, RECORD.replace("Aelric - Forever", "Brakka - Forever"));
    release();
    assert.equal((await stale).status, 409);
    assert.equal(JSON.parse((await row(me.user.id)).data).name, "Brakka");
  } finally { release?.(); env.DB.prepare = prepare; }
});

test("disconnecting a device during generation prevents its delayed story from attaching", async () => {
  const me = await signIn("disconnect-during-story"), token = await connect(me);
  await sync(token, RECORD);
  env.GEMINI_API_KEY = "test-key";
  let release, entered;
  const paused = new Promise(resolve => release = resolve);
  const started = new Promise(resolve => entered = resolve);
  globalThis.fetch = async () => {
    entered(); await paused;
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ story: STORY }) }] } }],
      usageMetadata: { promptTokenCount: 2000, candidatesTokenCount: 300 } });
  };
  try {
    const writing = sync(token, RECORD.replace("Level 24", "Level 25"), { refreshStory: true });
    await started;
    const devices = await page("list", { cookie: me.cookie, method: "GET" });
    await page("revoke", { cookie: me.cookie, body: { id: devices.body.devices[0].id } });
    release();
    assert.equal((await writing).body.story.why, "pending");
    const kept = await row(me.user.id);
    assert.equal(kept.story_source, "template");
    assert.equal(kept.story_count, 0);
    assert.equal(JSON.parse(kept.data).level, 25);
    assert.equal((await sync(token, RECORD)).status, 401);
  } finally { release?.(); globalThis.fetch = realFetch; }
});

test("overlapping changed syncs only acknowledge delivered facts and the loser retries", async () => {
  const me = await signIn("facts-race"), token = await connect(me);
  await sync(token, RECORD);
  const prepare = env.DB.prepare;
  let reads = 0, releaseReads, resolveFirstWrite;
  const bothRead = new Promise(resolve => releaseReads = resolve);
  const firstWrite = new Promise(resolve => resolveFirstWrite = resolve);
  env.DB.prepare = sql => {
    const wrap = args => {
      const statement = prepare(sql).bind(...args);
      return { ...statement, bind: (...newArgs) => wrap(newArgs),
        first: async (...args) => {
          const snapshot = await statement.first(...args);
          if (sql === "SELECT * FROM profiles WHERE user_id = ?" && reads < 2) {
            if (++reads === 2) releaseReads();
            await bothRead;
          }
          return snapshot;
        },
        run: async () => {
          if (sql.startsWith("UPDATE profiles SET data = ?") && JSON.parse(args[0]).level === 26) await firstWrite;
          const out = await statement.run();
          if (sql.startsWith("UPDATE profiles SET data = ?") && JSON.parse(args[0]).level === 25) resolveFirstWrite();
          return out;
        },
      };
    };
    return wrap([]);
  };
  try {
    const [older, newer] = await Promise.all([25, 26].map(level =>
      sync(token, RECORD.replace("Level 24", "Level " + level), { refreshStory: true })));
    assert.equal(older.status, 200);
    assert.equal(newer.status, 409, "a failed compare-and-save never acknowledges unsaved level 26");
    assert.equal(newer.body.retry, true);
    assert.equal(JSON.parse((await row(me.user.id)).data).level, 25);
    env.DB.prepare = prepare;
    const retried = await sync(token, RECORD.replace("Level 24", "Level 26"), { refreshStory: true });
    assert.equal(retried.status, 200);
    assert.equal(JSON.parse((await row(me.user.id)).data).level, 26);
  } finally { env.DB.prepare = prepare; releaseReads?.(); resolveFirstWrite?.(); }
});
