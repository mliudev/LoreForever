// Friend messages the moment they come (lib/friend-wait.js, GET /api/friends/wait): the request is held until a message
// to the player lands, looked for twice a second with one index row, and answered as /api/friends/counts. Run:
// node --test site/tests/
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { onRequest as friendsApi } from "../functions/api/friends/[action].js";
import { findOrCreateUser, setup } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { setupReferrals } from "../lib/referrals.js";
import { waitForFriends, WAIT_MAX, CHECK_EVERY } from "../lib/friend-wait.js";
import { d1 } from "./helpers.mjs";

const env = { DB: d1() };
beforeEach(async () => {
  await setup(env);
  await setupReferrals(env);
  for (const t of ["friend_people", "friend_edges", "friend_messages", "profiles", "users", "rate_limits", "devices",
                   "device_links"]) env.DB.sqlite.exec(`DELETE FROM ${t}`);
});

async function player(handle) {
  const user = await findOrCreateUser(env, { email: `${handle}@example.com`, googleSub: handle, name: handle });
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO profiles (user_id, handle, public, data, created, updated) VALUES (?, ?, 0, ?, ?, ?)")
    .bind(user.id, handle, JSON.stringify({ v: 1, name: handle, level: 24 }), now, now).run();
  const link = await startLink(env);
  await decideLink(env, link.user_code, user, true);
  const { token } = await claimToken(env, link.device_code);
  const call = async (action, body, query = "") => {
    const headers = new Headers({ "Content-Type": "application/json", "X-LF-Client": "companion/0.1.0",
                                  Authorization: `Bearer ${token}` });
    const method = body === undefined ? "GET" : "POST";
    const request = new Request(`https://preview.example/api/friends/${action}${query}`,
      { method, headers, body: method === "GET" ? undefined : JSON.stringify(body) });
    const res = await friendsApi({ request, env, params: { action } });
    return { status: res.status, body: await res.json() };
  };
  return { user, call };
}

async function friends() {
  const sam = await player("sam"), ana = await player("ana");
  const sent = await sam.call("add", { who: "ana" });
  const req = (await ana.call("list")).body.incoming[0];
  await ana.call("accept", { id: req.id });
  return { sam, ana, anaId: sent.body.id };
}

// A clock that moves only when the wait sleeps, and runs `at[n]` before the n-th look.
function steps(at = {}) {
  let t = 0, looks = 0;
  return { clock: () => t, looks: () => looks,
           sleep: async ms => { t += ms; looks++; await at[looks]?.(); } };
}

test("a message to the player ends the wait at the next look, half a second later, with the new counts", async () => {
  const { sam, ana, anaId } = await friends();
  const { body: before } = await ana.call("counts");
  const s = steps({ 3: () => sam.call("send", { to: anaId, text: "Booty Bay, now!" }) });
  const got = await waitForFriends(env, ana.user.id, before.stamp, 25, s);
  assert.equal(s.looks(), 3, "found at the look right after it landed");
  assert.equal(got.unread, 1);
  assert.notEqual(got.stamp, before.stamp);
  // The player's own message to a friend doesn't wake their own wait.
  const { body: now } = await sam.call("counts");
  const quiet = steps({ 1: () => sam.call("send", { to: anaId, text: "On my way" }) });
  assert.equal((await waitForFriends(env, sam.user.id, now.stamp, 5, quiet)).stamp, now.stamp);
  assert.equal(quiet.looks(), 5 * 1000 / CHECK_EVERY);
});

test("nothing new: the counts after the wait, which is at most 25 seconds; an old stamp answers at once", async () => {
  const { ana } = await friends();
  const { body: { ok, ...before } } = await ana.call("counts");
  const s = steps();
  assert.deepEqual(await waitForFriends(env, ana.user.id, before.stamp, 600, s), before);
  assert.equal(s.looks(), WAIT_MAX * 1000 / CHECK_EVERY, "never past WAIT_MAX");
  assert.equal(s.clock(), WAIT_MAX * 1000);
  const old = steps();
  assert.deepEqual(await waitForFriends(env, ana.user.id, "0..0", 25, old), before);
  assert.equal(old.looks(), 0);
  // Through the API, with no wait: the counts, as /api/friends/counts gives them.
  const res = await ana.call("wait", undefined, `?stamp=${encodeURIComponent(before.stamp)}&wait=0`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true, ...before });
});

test("each look reads one index row: the newest message to the player, never all of them", async () => {
  await friends();
  await waitForFriends(env, "nobody", "x", 0);
  const plan = env.DB.sqlite.prepare("EXPLAIN QUERY PLAN SELECT COALESCE(MAX(id), 0) AS id FROM friend_messages " +
    "WHERE recipient = ?").all("u").map(r => r.detail).join(" ");
  assert.match(plan, /friend_messages_to_id/);
});
