// The companion app keeps a player's profile up to date (LOR-148): linking it to an account with a code
// (/api/device/*, lib/devices.js), its token on POST /api/profile/sync, Disconnect from either side, what an update
// never does (switch characters, rewrite an unchanged profile) and when it writes a new story (lib/profiles.js
// storyDue). D1 is node:sqlite (helpers.mjs); Gemini is a stub on globalThis.fetch. Run: node --test site/tests/
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onRequest as deviceApi } from "../functions/api/device/[action].js";
import { onRequest as profileApi } from "../functions/api/profile/[action].js";
import { findOrCreateUser, startSession, setup, deleteUser, sha256 } from "../lib/accounts.js";
import { newUserCode, normalizeCode, LINK_MINUTES } from "../lib/devices.js";
import { storyBasis, movedOn, storyDue, STORY_SYNC_HOURS } from "../lib/profiles.js";
import { parseRecord } from "../lib/journey.js";
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

async function sync(token, record, { origin } = {}) {
  const h = new Headers({ "Content-Type": "application/json", "X-LF-Client": CLIENT });
  if (token) h.set("Authorization", "Bearer " + token);
  if (origin) h.set("Origin", origin);
  const request = new Request(`${ORIGIN}/api/profile/sync`, { method: "POST", headers: h, body: JSON.stringify({ record }) });
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

test("link codes: 8 readable characters, typed any way", () => {
  for (let i = 0; i < 50; i++) assert.match(newUserCode(), /^[BCDFGHJKMNPQRSTVWXZ2-9]{4}-[BCDFGHJKMNPQRSTVWXZ2-9]{4}$/);
  assert.equal(normalizeCode(" bcdf ghjk "), "BCDF-GHJK");
  assert.equal(normalizeCode("BCDFGHJK"), "BCDF-GHJK");
  for (const bad of ["BCDF-GHJ", "BCDF-GHJO", "AEIO-UUUU", "", null, "BCDF-GHJK-X"]) assert.equal(normalizeCode(bad), null, String(bad));
});

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

    // A paste still writes one each time (within the daily allowance).
    await importRecord(me.cookie, RECORD.replace("Level 24", "Level 26"));
    assert.equal(calls.length, 3);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a profile whose story was never written gets one on its first update", async () => {
  const me = await signIn("aelric");
  await importRecord(me.cookie, RECORD);   // no key yet: the summary
  assert.equal((await row(me.user.id)).story_source, "template");
  env.GEMINI_API_KEY = "test-key";
  try {
    const calls = gemini();
    const token = await connect(me);
    const res = await sync(token, RECORD.replace("12 quests done", "13 quests done"));
    assert.equal(res.body.story.why, "written");
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("storyDue and movedOn: what counts as something new to tell", () => {
  const d = parseRecord(RECORD);
  const basis = storyBasis(d);
  assert.deepEqual([basis.level, basis.quests, basis.bosses, basis.dungeons], [24, 12, 2, ["The Deadmines"]]);
  assert.equal(movedOn(basis, d), false);
  assert.equal(movedOn(null, d), true);
  const more = (from, to) => parseRecord(RECORD.replace(from, to));
  assert.equal(movedOn(basis, more("12 quests done", "16 quests done")), false);
  assert.equal(movedOn(basis, more("12 quests done", "17 quests done")), true);
  assert.equal(movedOn(basis, more("2 bosses", "3 bosses")), true);
  assert.equal(movedOn(basis, more("Menethil Harbor, Wetlands · by boat", "Menethil Harbor, Wetlands · by boat\n- Oct 03 12:00  Thelsamar, Loch Modan")), true);
  assert.equal(movedOn(basis, more("Striped Nightsaber", "Spotted Frostsaber")), true);
  const now = new Date("2026-10-04T12:00:00Z");
  const p = (h, source = "written") => ({ story_source: source, story_at: new Date(now - h * 3600e3).toISOString(), story_basis: JSON.stringify(basis) });
  assert.equal(storyDue(null, d, now), true);
  assert.equal(storyDue(p(1, "template"), d, now), false);
  assert.equal(storyDue(p(7, "template"), d, now), true);
  assert.equal(storyDue({ story_source: "template" }, d, now), true);
  assert.equal(storyDue(p(7), d, now), false, "nothing new");
  assert.equal(storyDue(p(7), more("Level 24", "Level 25"), now), true);
  assert.equal(storyDue(p(5), more("Level 24", "Level 25"), now), false);
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

test("the pages: /link connects, /account lists connected apps and says the companion can update the profile", () => {
  const read = f => readFileSync(new URL(`../public/${f}`, import.meta.url), "utf8");
  const link = read("link.html");
  assert.match(link, /<meta name="robots" content="noindex">/);
  assert.match(link, /\/api\/device\/approve/);
  assert.match(link, /\/api\/device\/link\?code=/);
  const account = read("account.html");
  assert.match(account, /id="apps"/);
  assert.match(account, /\/api\/device\/list/);
  assert.match(account, /\/api\/device\/revoke/);
  assert.match(account, /features\.companion/);
  assert.match(read("_headers"), /\/link\n {2}X-Robots-Tag: noindex, nofollow\n {2}Cache-Control: no-store/);
  for (const html of [link, account]) assert.ok(!/\b(AI|chatbot|model)\b/.test(html.replace(/<[^>]+>/g, " ")), "no wording about models");
});
