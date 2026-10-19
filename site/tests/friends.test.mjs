// Friends in Willo (lib/friends.js, /api/friends/*): adding by name or share link, both sides saying yes, messages
// only ever between friends, blocking and reporting, sharing where you are only after saying yes, and "Delete my
// account" taking all of it. D1 is node:sqlite (helpers.mjs). Run: node --test site/tests/
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { onRequest as friendsApi } from "../functions/api/friends/[action].js";
import { findOrCreateUser, setup, deleteUser } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { parseWho, cleanMessage, MESSAGE_MAX, friendOffer } from "../lib/friends.js";
import { shareCode, newShareCode, codeOwner, setupReferrals } from "../lib/referrals.js";
import { escape } from "../lib/voices.js";

import { d1 } from "./helpers.mjs";

const ORIGIN = "https://preview.example";
const env = { DB: d1() };
const TABLES = ["friend_people", "friend_edges", "friend_messages", "friend_reports", "profiles", "users", "rate_limits",
                "devices", "device_links"];
beforeEach(async () => {
  await setup(env);
  await setupReferrals(env);
  for (const t of [...TABLES, "share_codes", "referrals", "creators"]) env.DB.sqlite.exec(`DELETE FROM ${t}`);
});

// A player with a profile (handle, character name) and Willo connected.
async function player(handle, name = handle[0].toUpperCase() + handle.slice(1)) {
  const user = await findOrCreateUser(env, { email: `${handle}@example.com`, googleSub: handle, name: `Real Name ${handle}` });
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO profiles (user_id, handle, public, data, created, updated) VALUES (?, ?, 0, ?, ?, ?)")
    .bind(user.id, handle, JSON.stringify({ v: 1, name, level: 24 }), now, now).run();
  const link = await startLink(env);
  await decideLink(env, link.user_code, user, true);
  const { token } = await claimToken(env, link.device_code);
  const call = async (action, body, query = "") => {
    const headers = new Headers({ "Content-Type": "application/json", "X-LF-Client": "companion/0.1.0",
                                  Authorization: `Bearer ${token}` });
    const method = body === undefined ? "GET" : "POST";
    const request = new Request(`${ORIGIN}/api/friends/${action}${query}`,
      { method, headers, body: method === "GET" ? undefined : JSON.stringify(body) });
    const res = await friendsApi({ request, env, params: { action } });
    return { status: res.status, body: await res.json() };
  };
  return { user, call, handle };
}

async function befriend(a, b) {
  const sent = await a.call("add", { who: b.handle });
  assert.equal(sent.body.state, "asked");
  const req = (await b.call("list")).body.incoming[0];
  assert.equal(req.name, a.handle[0].toUpperCase() + a.handle.slice(1));
  assert.equal((await b.call("accept", { id: req.id })).status, 200);
  return { aId: req.id, bId: sent.body.id };
}

test("a request by name needs the other side's yes; then they write to each other and see unread counts", async () => {
  const sam = await player("sam"), ana = await player("ana");
  const sent = await sam.call("add", { who: "@ana" });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.state, "asked");
  assert.equal(sent.body.outgoing[0].name, "Ana");
  // Not friends yet: no writing.
  assert.equal((await sam.call("send", { to: sent.body.id, text: "hi" })).status, 403);
  const incoming = (await ana.call("list")).body.incoming;
  assert.equal(incoming.length, 1);
  assert.equal((await ana.call("counts")).body.incoming, 1);
  const accepted = await ana.call("accept", { id: incoming[0].id });
  assert.equal(accepted.body.friends[0].name, "Sam");
  // Never the account's real name or email.
  assert.doesNotMatch(JSON.stringify(accepted.body), /Real Name|example\.com/);

  const before = (await ana.call("counts")).body.stamp;
  const msg = await sam.call("send", { to: sent.body.id, text: "  Meet at the Crossroads?\n\n\n\n\nBring water  " });
  assert.equal(msg.status, 200);
  assert.equal(msg.body.message.text, "Meet at the Crossroads?\n\n\nBring water");
  const counts = (await ana.call("counts")).body;
  assert.equal(counts.unread, 1);
  assert.notEqual(counts.stamp, before);
  const list = (await ana.call("list")).body;
  assert.equal(list.unread, 1);
  assert.equal(list.friends[0].last.text, "Meet at the Crossroads?\n\n\nBring water");
  assert.equal(list.friends[0].last.mine, false);

  const read = await ana.call("messages", undefined, `?with=${incoming[0].id}`);
  assert.deepEqual(read.body.messages.map(m => [m.mine, m.text]), [[false, "Meet at the Crossroads?\n\n\nBring water"]]);
  assert.equal((await ana.call("counts")).body.unread, 0);
  await ana.call("send", { to: incoming[0].id, text: "On my way" });
  const after = await sam.call("messages", undefined, `?with=${sent.body.id}&after=${msg.body.message.id}`);
  assert.deepEqual(after.body.messages.map(m => [m.mine, m.text]), [[false, "On my way"]]);
});

test("messages never reach or show to anyone but the two friends", async () => {
  const sam = await player("sam"), ana = await player("ana"), eve = await player("eve");
  const { aId: samId, bId: anaId } = await befriend(sam, ana);
  await sam.call("send", { to: anaId, text: "secret plans" });
  // Eve knows both ids (say they leaked) but isn't a friend of either.
  for (const id of [samId, anaId]) {
    assert.equal((await eve.call("messages", undefined, `?with=${id}`)).status, 403);
    assert.equal((await eve.call("send", { to: id, text: "hey" })).status, 403);
  }
  assert.equal((await eve.call("list")).body.friends.length, 0);
  assert.doesNotMatch(JSON.stringify((await eve.call("list")).body), /secret/);
  // Removing a friend ends the conversation for both.
  await ana.call("remove", { id: samId });
  assert.equal((await sam.call("send", { to: anaId, text: "still there?" })).status, 403);
  assert.equal((await sam.call("list")).body.friends.length, 0);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM friend_messages").get().n, 0);
});

test("a block removes the friend, hides it from them, and stops them adding back; a report keeps their messages", async () => {
  const sam = await player("sam"), ana = await player("ana");
  const { aId: samId, bId: anaId } = await befriend(sam, ana);
  await sam.call("send", { to: anaId, text: "rude words" });
  const reported = await ana.call("report", { id: samId, note: "spam" });
  assert.equal(reported.status, 200);
  assert.equal(reported.body.friends.length, 0);
  assert.deepEqual(reported.body.blocked.map(b => b.name), ["Sam"]);
  const report = env.DB.sqlite.prepare("SELECT * FROM friend_reports").get();
  assert.equal(report.note, "spam");
  assert.deepEqual(JSON.parse(report.messages).map(m => m.body), ["rude words"]);
  // Sam sees nothing of Ana any more and can't add her back.
  assert.deepEqual((await sam.call("list")).body.friends, []);
  assert.equal((await sam.call("add", { who: "ana" })).status, 403);
  assert.equal((await sam.call("send", { to: anaId, text: "?" })).status, 403);
  // Ana can unblock, and then they're simply strangers.
  await ana.call("unblock", { id: samId });
  assert.equal((await sam.call("add", { who: "ana" })).body.state, "asked");
});

test("where you are is shared only after you say yes, only with friends, and turning it off deletes it", async () => {
  const sam = await player("sam"), ana = await player("ana"), eve = await player("eve");
  const { bId: anaId } = await befriend(sam, ana);
  const where = { character: "Ana", level: 24, zone: "Duskwood", sub: "Darkshire", quest: "The Night Watch" };
  // Off by default: nothing is kept.
  assert.equal((await ana.call("presence", where)).body.stored, false);
  assert.equal((await sam.call("list")).body.friends[0].progress, null);
  assert.equal((await ana.call("share", { on: true })).body.me.share, true);
  assert.equal((await ana.call("presence", where)).body.stored, true);
  const seen = (await sam.call("list")).body.friends.find(f => f.id === anaId).progress;
  assert.equal(seen.zone, "Duskwood");
  assert.equal(seen.quest, "The Night Watch");
  assert.equal(seen.level, 24);
  assert.doesNotMatch(JSON.stringify((await eve.call("list")).body), /Duskwood/);
  await ana.call("share", { on: false });
  assert.equal((await sam.call("list")).body.friends[0].progress, null);
  assert.equal(env.DB.sqlite.prepare("SELECT progress FROM friend_people WHERE progress IS NOT NULL").all().length, 0);
});

test("a shared note carries the guild and the week, cleaned, and a week older than a week goes", async () => {
  const sam = await player("sam"), ana = await player("ana");
  const { bId: anaId } = await befriend(sam, ana);
  await Promise.all([sam.call("share", { on: true }), ana.call("share", { on: true })]);
  await sam.call("presence", { guild: "Dawnbringers" });
  await ana.call("presence", { zone: "Duskwood", guild: "Dawnbringers",
    week: { levels: 3, quests: -5, zones: ["Duskwood", 7, "x".repeat(200)], bosses: ["A", "B", "C", "D"], extra: 1 } });
  const list = (await sam.call("list")).body;
  assert.equal(list.me.guild, "Dawnbringers");
  const p = list.friends.find(f => f.id === anaId).progress;
  assert.equal(p.guild, "Dawnbringers");
  assert.deepEqual(p.week, { levels: 3, zones: ["Duskwood", "x".repeat(64)], quests: 0, bosses: ["A", "B", "C"] });
  env.DB.sqlite.prepare("UPDATE friend_people SET progress_at = ? WHERE user_id = ?")
    .run(new Date(Date.now() - 8 * 864e5).toISOString(), ana.user.id);
  const old = (await sam.call("list")).body.friends.find(f => f.id === anaId).progress;
  assert.equal(old.week, null);
  assert.equal(old.zone, "Duskwood");
});

// A creator's link as /admin makes it (lib/referrals.js saveCreator, without Stripe).
function creatorLink(code) {
  env.DB.sqlite.prepare("INSERT INTO creators (code, name, discount, share_pct, months, gift, created) " +
    "VALUES (?, 'Ziqo', 50, 20, 3, 100, '2026-10-16')").run(code);
  env.DB.sqlite.prepare("INSERT INTO share_codes (code, kind, created) VALUES (?, 'creator', '2026-10-16')").run(code);
}

test("a player's share link makes friends at once; a creator's link or a retired one adds no one", async () => {
  const sam = await player("sam"), ana = await player("ana"), bo = await player("bo-1");
  const old = await shareCode(env, ana.user.id), code = await newShareCode(env, ana.user.id);
  creatorLink("ziqo");
  assert.equal((await sam.call("add", { who: `https://loreforeverwow.com/w/${code.toUpperCase()}` })).body.state, "friends");
  assert.equal((await ana.call("list")).body.friends[0].name, "Sam");
  const creator = await sam.call("add", { who: "loreforeverwow.com/w/ziqo?src=yt" });
  assert.equal(creator.status, 400);
  assert.match(creator.body.error, /creator's link/);
  assert.equal((await bo.call("add", { who: `loreforeverwow.com/w/${old}` })).status, 404);    // "New link" retired it
  assert.equal((await sam.call("add", { who: "loreforeverwow.com/w/nosuch2" })).status, 404);
  assert.equal((await sam.call("add", { who: "sam" })).status, 400);
});

test("someone a friend's link brought to Willo is offered to add them, until they do or say Not now", async () => {
  const ana = await player("ana"), sam = await player("sam"), bo = await player("bo-1");
  const code = await shareCode(env, ana.user.id);
  const brought = (friend) => env.DB.sqlite.prepare("INSERT INTO referrals (user_id, code, kind, sharer_id, created) " +
    "VALUES (?, ?, 'player', ?, '2026-10-16')").run(friend.user.id, code, ana.user.id);
  brought(sam);
  brought(bo);
  // Ana's name only once her profile is public (Share Willo's rule), never her account's name.
  assert.equal((await sam.call("list")).body.suggested.name, null);
  env.DB.sqlite.prepare("UPDATE profiles SET public = 1 WHERE user_id = ?").run(ana.user.id);
  const offer = (await sam.call("list")).body.suggested;
  assert.equal(offer.name, "Ana");
  assert.doesNotMatch(JSON.stringify(offer), /Real Name|example\.com/);
  assert.equal((await sam.call("add", { who: offer.who })).body.state, "friends");
  assert.equal((await sam.call("list")).body.suggested, null);
  assert.equal((await bo.call("pass", { id: (await bo.call("list")).body.suggested.id })).body.suggested, null);
  assert.deepEqual((await bo.call("list")).body.friends, []);
  // Adding them after all still works.
  assert.equal((await bo.call("add", { who: "ana" })).body.state, "asked");
});

test("/willo?shared=<code> offers a signed-in visitor to add the link's player, never to themselves", async () => {
  const ana = await player("ana"), sam = await player("sam");
  const owner = await codeOwner(env, await shareCode(env, ana.user.id));
  const offer = await friendOffer(env, owner, sam.user, escape);
  assert.match(offer, /data-add-friend="[a-z0-9]{7}"/);
  assert.match(offer, /Add them as a friend/);          // Ana's profile isn't public: no name for a stranger
  assert.equal(await friendOffer(env, owner, ana.user, escape), "");
  assert.equal(await friendOffer(env, owner, null, escape), "");
  await sam.call("add", { who: owner.code });
  assert.match(await friendOffer(env, owner, sam.user, escape), /are friends in Willo/);
});

test("Delete my account removes their friends, messages, shared whereabouts and reports, on both sides", async () => {
  const sam = await player("sam"), ana = await player("ana");
  const { aId: samId, bId: anaId } = await befriend(sam, ana);
  await sam.call("share", { on: true });
  await sam.call("presence", { zone: "Duskwood" });
  await sam.call("send", { to: anaId, text: "hello" });
  await ana.call("send", { to: samId, text: "hi" });
  await ana.call("report", { id: samId });
  await deleteUser(env, sam.user);
  for (const t of ["friend_messages", "friend_reports"]) {
    assert.equal(env.DB.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n, 0, t);
  }
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM friend_edges WHERE user_id = ? OR other_id = ?")
    .get(sam.user.id, sam.user.id).n, 0);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM friend_people WHERE user_id = ?").get(sam.user.id).n, 0);
  const list = (await ana.call("list")).body;
  assert.deepEqual([list.friends, list.blocked], [[], []]);
});

test("the API needs a connected Willo or our own pages", async () => {
  const request = new Request(`${ORIGIN}/api/friends/list`, { headers: { "X-LF-Client": "companion/0.1.0",
    Authorization: `Bearer ${"f".repeat(64)}` } });
  assert.equal((await friendsApi({ request, env, params: { action: "list" } })).status, 401);
  const foreign = new Request(`${ORIGIN}/api/friends/send`, { method: "POST", headers: { Origin: "https://evil.example",
    "Content-Type": "application/json" }, body: "{}" });
  assert.equal((await friendsApi({ request: foreign, env, params: { action: "send" } })).status, 401);
});

test("what players type to add someone, and what a message keeps", () => {
  assert.deepEqual(parseWho("https://loreforeverwow.com/w/k7p2qmx"), { code: "k7p2qmx" });
  assert.deepEqual(parseWho("loreforeverwow.com/u/Aelric-2"), { handle: "aelric-2" });
  assert.deepEqual(parseWho(" @Aelric "), { handle: "aelric", code: "Aelric" });
  assert.equal(parseWho("two words"), null);
  assert.equal(parseWho(""), null);
  assert.equal(cleanMessage("a\u0000b‮c\r\nd"), "abc\nd");
  assert.equal(cleanMessage(" \n "), "");
  assert.equal([...cleanMessage("é".repeat(MESSAGE_MAX + 5))].length, MESSAGE_MAX);
});

// LOR-674: a friend shows as Willo connected while their Willo has been in touch lately, away after, and nothing at all
// once they turn "Show when my Willo is on" off; the minute poll's stamp moves when someone comes or goes.
test("friends see each other as online or away, never more, and only while each shows it", async () => {
  const sam = await player("sam"), ana = await player("ana");
  const { bId: anaId } = await befriend(sam, ana);
  const ana_ = () => (sam.call("list")).then(r => r.body.friends.find(f => f.id === anaId));
  assert.equal((await ana_()).online, true, "Willo connected");
  const was = (await sam.call("counts")).body.stamp;
  const quiet = new Date(Date.now() - 20 * 60e3).toISOString();
  env.DB.sqlite.prepare("UPDATE devices SET last_used = ? WHERE user_id = ?").run(quiet, ana.user.id);
  assert.equal((await ana_()).online, false, "away after a while without a word from her Willo");
  assert.notEqual((await sam.call("counts")).body.stamp, was, "the poll sees her go");
  assert.doesNotMatch(JSON.stringify((await sam.call("list")).body), new RegExp(quiet), "never when she was last on");
  const off = await ana.call("online", { show: false });
  assert.equal(off.body.me.online, false);
  assert.equal((await ana_()).online, null, "not shown at all once she turns it off");
  assert.equal((await ana.call("online", { show: true })).body.me.online, true);
});

// LOR-674: "Willo, send this to Mike": a message may carry a card, whose words stand in for the text for a Willo that
// shows only text; and the sender can take a message back while it's unread.
test("a shared quest goes as a card with plain words beside it; an unread message can be taken back", async () => {
  const sam = await player("sam"), ana = await player("ana");
  const { aId: samId, bId: anaId } = await befriend(sam, ana);
  const card = { kind: "quest", title: "The Defias  Brotherhood", detail: "Westfall, from Gryan Stoutmantle", ref: "65" };
  const sent = (await sam.call("send", { to: anaId, card })).body.message;
  assert.equal(sent.text, "Shared a quest: The Defias Brotherhood\nWestfall, from Gryan Stoutmantle");
  assert.deepEqual(sent.card, { kind: "quest", title: "The Defias Brotherhood", detail: "Westfall, from Gryan Stoutmantle", ref: "65" });
  assert.equal((await sam.call("send", { to: anaId, card: { kind: "gold", title: "1,000 gold" } })).status, 400);
  assert.equal((await sam.call("send", { to: anaId, card: { kind: "place" } })).status, 400, "a card needs a title");
  const withText = (await sam.call("send", { to: anaId, text: "Meet me here", card: { kind: "place", title: "Goldshire, Elwynn Forest" } })).body.message;
  assert.equal(withText.text, "Meet me here");
  assert.equal((await ana.call("list")).body.friends[0].last.kind, "place");

  // Taken back while unread; not someone else's, not once read.
  assert.equal((await ana.call("unsend", { id: withText.id })).status, 404);
  assert.deepEqual((await sam.call("unsend", { id: withText.id })).body, { ok: true, removed: true });
  assert.equal((await sam.call("unsend", { id: withText.id })).status, 404);
  const read = (await ana.call("messages", undefined, `?with=${samId}`)).body.messages;
  assert.deepEqual(read.map(m => m.card?.kind), ["quest"]);
  assert.equal((await sam.call("unsend", { id: sent.id })).status, 409, "she read it");
  const mine = (await sam.call("messages", undefined, `?with=${anaId}`)).body.messages;
  assert.equal(mine[0].seen, true);
});
