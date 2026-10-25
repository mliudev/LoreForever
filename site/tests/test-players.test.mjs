// Test players on develop (lib/test-players.js, functions/api/test/[action].js): never on the live site (the flag, the
// host and live Stripe each refuse on their own), a session for a made-up player and nobody else, Mira and Doran seeded
// as friends with where they are and Mira's pins, "Add the test friends" for any account, and Brann answering a
// request sent by his name. D1 is node:sqlite (helpers.mjs). Run: node --test 'site/tests/*.test.mjs'
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { onRequest as testApi } from "../functions/api/test/[action].js";
import { onRequest as friendsApi } from "../functions/api/friends/[action].js";
import { onRequestGet as profileGet } from "../functions/u/[handle].js";
import { findOrCreateUser, startSession, setup } from "../lib/accounts.js";
import { pinsOf } from "../lib/willo-pins.js";
import { testPlayersOn, seedTestPlayers, stubbed } from "../lib/test-players.js";
import { d1 } from "./helpers.mjs";

const DEVELOP = "https://develop.lore-forever.pages.dev";
let env;
beforeEach(async () => {
  env = { DB: d1(), TEST_PLAYERS: "1" };
  await setup(env);
});

const call = async (origin, action, { body, cookie, method = body === undefined ? "GET" : "POST", on = env } = {}) => {
  const res = await testApi({ env: on, params: { action }, request: new Request(`${origin}/api/test/${action}`, { method,
    headers: { Origin: origin, "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.5", ...(cookie ? { Cookie: cookie } : {}) },
    body: method === "GET" ? undefined : JSON.stringify(body) }) });
  return { status: res.status, body: await res.json(), cookie: (res.headers.get("Set-Cookie") || "").split(";")[0] };
};
const friends = async cookie => (await (await friendsApi({ env, params: { action: "list" },
  request: new Request(`${DEVELOP}/api/friends/list`, { headers: { Cookie: cookie } }) })).json());
const count = sql => env.DB.sqlite.prepare(sql).get().n;

test("each test player's public profile page shows their road (develop's walkthrough, 10/24)", async () => {
  await seedTestPlayers(env, Date.parse("2026-10-24T20:00:00Z"));
  for (const [handle, place] of [["mira", "Sentinel Hill"], ["doran", "Darkshire"], ["brann", "Lakeshire"]]) {
    const res = await profileGet({ request: new Request(`${DEVELOP}/u/${handle}`), env, params: { handle } });
    assert.equal(res.status, 200, handle);
    assert.ok((await res.text()).includes(place), `${handle}'s page names ${place}`);
  }
});

test("never on the live site: the host, the flag and live Stripe each refuse, and nothing is made", async () => {
  for (const origin of ["https://loreforeverwow.com", "https://www.loreforeverwow.com", "https://lore-forever.pages.dev",
                        "https://abc123.lore-forever.pages.dev", "https://evil.example"]) {
    for (const action of ["status", "sign-in"]) {
      const res = await call(origin, action, action === "status" ? {} : { body: { who: "mira" } });
      assert.equal(res.status, 404, `${origin} ${action}`);
      assert.equal(res.cookie, "", `${origin}: no session`);
    }
  }
  assert.equal((await call(DEVELOP, "sign-in", { body: { who: "mira" }, on: { ...env, TEST_PLAYERS: undefined } })).status, 404,
    "develop without TEST_PLAYERS");
  assert.equal((await call(DEVELOP, "sign-in", { body: { who: "mira" }, on: { ...env, STRIPE_LIVE: "1" } })).status, 404,
    "Production's live Stripe, whatever the host says");
  assert.equal(count("SELECT COUNT(*) AS n FROM users"), 0, "no test player was made");
  assert.equal(testPlayersOn({ TEST_PLAYERS: "1" }, new Request("https://loreforeverwow.com/link")), false);
  assert.equal(testPlayersOn({ TEST_PLAYERS: "1" }, new Request(`${DEVELOP}/link`)), true);
});

test("signing in as a test player: a session for Mira, with Doran a friend, where they are, his messages and her pins", async () => {
  assert.deepEqual((await call(DEVELOP, "status")).body.players.map(p => p.key), ["mira", "doran", "brann"]);
  assert.equal((await call(DEVELOP, "sign-in", { body: { who: "mike" } })).status, 400, "only the test players");
  assert.equal((await call("https://evil.example", "sign-in", { body: { who: "mira" }, on: env })).status, 404);
  const mira = await call(DEVELOP, "sign-in", { body: { who: "mira" } });
  assert.equal(mira.status, 200);
  assert.match(mira.cookie, /^lf_session=[0-9a-f]{64}$/);
  assert.equal(mira.body.user.email, "mira@example.test");

  const list = await friends(mira.cookie);
  assert.deepEqual(list.friends.map(f => [f.name, f.handle, f.online]), [["Doran", "doran", true]], "his Willo connected");
  assert.match(JSON.stringify(list.friends[0]), /Duskwood/, "where he is");
  assert.equal(list.unread, 2, "his two messages");
  const page = env.DB.sqlite.prepare("SELECT body FROM notebook_pages WHERE page = 'char:Mira-Forever'").get();
  assert.deepEqual(pinsOf(page.body).map(p => p.name), ["Moonbrook cellar", "Gold Coast murlocs", "Jangolode Mine"]);

  // Again: nothing doubles.
  await call(DEVELOP, "sign-in", { body: { who: "doran" } });
  assert.equal(count("SELECT COUNT(*) AS n FROM users"), 3);
  assert.equal(count("SELECT COUNT(*) AS n FROM friend_messages"), 2);
  assert.equal(count("SELECT COUNT(*) AS n FROM profiles WHERE handle IN ('mira', 'doran', 'brann')"), 3);
});

test("any account adds Mira and Doran in one tap; Brann answers a request sent by his name", async () => {
  const mike = await findOrCreateUser(env, { email: "mike@example.com", googleSub: "1234567890", name: "Mike" });
  const cookie = (await startSession(env, new Request(DEVELOP), mike.id)).split(";")[0];
  assert.equal((await call(DEVELOP, "friends", { body: {} })).status, 401);
  const added = await call(DEVELOP, "friends", { body: {}, cookie });
  assert.deepEqual(added.body.added.map(a => a.name), ["Mira", "Doran"]);
  let list = await friends(cookie);
  assert.equal(list.friends.length, 2);
  assert.equal(list.unread, 1, "Doran's hello");

  // Add a friend by name: Brann gets the request, and accepts it when asked to.
  assert.match((await call(DEVELOP, "accept", { body: { who: "brann" } })).body.accepted.toString(), /^0$/);
  const add = await (await friendsApi({ env, params: { action: "add" }, request: new Request(`${DEVELOP}/api/friends/add`, {
    method: "POST", headers: { Cookie: cookie, Origin: DEVELOP, "Content-Type": "application/json" }, body: JSON.stringify({ who: "brann" }) }) })).json();
  assert.equal(add.state, "asked");
  assert.equal((await call(DEVELOP, "accept", { body: { who: "brann" } })).body.accepted, 1);
  list = await friends(cookie);
  assert.equal(list.friends.length, 3);
  assert.equal(list.outgoing.length, 0);
});

test("Mira's pins carry the tester's own day, and a page they changed is left alone", async () => {
  const at = Date.parse("2026-10-20T02:46:00Z");          // 19:46 on the 19th in California
  const days = () => [...new Set(pinsOf(env.DB.sqlite.prepare("SELECT body FROM notebook_pages WHERE page = 'char:Mira-Forever'")
    .get().body).map(p => p.day))];
  await seedTestPlayers(env, at, { offset: -420 });
  assert.deepEqual(days(), ["October 19"]);
  await seedTestPlayers(env, at);
  assert.deepEqual(days(), ["October 19"], "no offset: as it was");
  await seedTestPlayers(env, at, { offset: 60 });
  assert.deepEqual(days(), ["October 20"]);
  env.DB.sqlite.exec("UPDATE notebook_pages SET version = 2 WHERE page = 'char:Mira-Forever'");   // they took a pin out
  await seedTestPlayers(env, at, { offset: -420 });
  assert.deepEqual(days(), ["October 20"], "an edited page stays theirs");
});

test("load players get app tokens on develop, and only their answers with the header get the stand-in model", async () => {
  assert.equal((await call("https://loreforeverwow.com", "load-players", { body: { count: 2 } })).status, 404);
  const res = await call(DEVELOP, "load-players", { body: { count: 2 } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.players.map(p => p.email), ["load-001@example.test", "load-002@example.test"]);
  assert.ok(res.body.players.every(p => /^[0-9a-f]{64}$/.test(p.token)));
  const ask = (origin, headers = { "X-Load-Test": "stub" }) => new Request(origin + "/api/companion/answer", { headers });
  const load = { email: "load-001@example.test" };
  assert.equal(stubbed(env, ask(DEVELOP), load), true);
  assert.equal(stubbed(env, ask(DEVELOP, {}), load), false, "no header");
  assert.equal(stubbed(env, ask(DEVELOP), { email: "mira@example.test" }), false, "not a load player");
  assert.equal(stubbed(env, ask("https://loreforeverwow.com"), load), false, "live site");
  assert.equal(stubbed({ ...env, STRIPE_LIVE: "1" }, ask(DEVELOP), load), false, "live Stripe");
});
