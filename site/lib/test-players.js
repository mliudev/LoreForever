// Test players on develop (Mike, 10/20 via the PM: "We need to setup test accounts for this because I have no
// friends"). Three made-up players, Mira, Doran and Brann, so Willo's friends, messages and pins can be tried on the
// develop site (develop.lore-forever.pages.dev) by Mike from his phone and by Silver, without anyone's real account:
//   - "Sign in as Mira" (or Doran, Brann) on develop's /link and /account: a session for that test player, never a
//     password, and nobody else's account (testSignIn).
//   - "Add the test friends": the signed-in account (Mike's own Google sign-in there too) becomes friends with Mira and
//     Doran at once, and Doran writes to them (befriendTestPlayers).
//   - Brann has no friends: he's who "add a friend by handle" adds ("brann"). The request waits, as a real one would,
//     until "Brann accepts" (acceptAsTestPlayer).
// Each of these first seeds the three (seedTestPlayers): their accounts, public profiles, Mira and Doran friends,
// where Mira and Doran are (shared with friends), Doran's Willo connected (a device used just now: it shows "away"
// again after friends.js ONLINE_MINUTES, until the next seed), his two messages to Mira, and pins in Mira's notebook.
//
// Never on the live site. testPlayersOn needs all three: the Pages variable TEST_PLAYERS = "1" (set only in the
// Preview environment, which develop and preview deploy to), a request to one of TEST_HOSTS (develop, preview, or a
// local copy of the site), and no live Stripe (Production has STRIPE_LIVE = "1"). Anywhere else the routes answer 404
// (functions/api/test/[action].js) and the pages' panel (public/js/test-players.js) never shows.

import { findOrCreateUser } from "./accounts.js";
import { person, setSharing, savePresence, readPresence, answerRequest } from "./friends.js";
import { dayOn } from "./willo-pins.js";

export const TEST_HOSTS = new Set(["develop.lore-forever.pages.dev", "preview.lore-forever.pages.dev", "localhost", "127.0.0.1"]);

export function testPlayersOn(env, request) {
  if (env?.TEST_PLAYERS !== "1" || env?.STRIPE_LIVE === "1") return false;
  try { return TEST_HOSTS.has(new URL(request.url).hostname); } catch (e) { return false; }
}

// The three. email: an example.test address (a name that can never be a real inbox); sub: their Google id, which a
// real Google sign-in (all digits) can never be. pins: Mira's notebook, under Pins, as Willo writes them
// (lib/willo-pins.js pinLine).
export const TEST_PLAYERS = {
  mira: { name: "Mira", email: "mira@example.test", sub: "test-player:mira",
    profile: { name: "Mira", realm: "Forever", level: 14, race: "Human", className: "Warrior" },
    presence: { character: "Mira", level: 14, zone: "Westfall", sub: "Sentinel Hill", quest: "The Defias Brotherhood" },
    pins: [["Moonbrook cellar", "Defias below, bring a friend", "Moonbrook, Westfall (south, 44, 70)"],
           ["Gold Coast murlocs", "they pull in threes", "Gold Coast Quarry, Westfall (west, 30, 47)"],
           ["Jangolode Mine", "the kobold elite hits hard", "Jangolode Mine, Westfall (north, 43, 25)"]] },
  doran: { name: "Doran", email: "doran@example.test", sub: "test-player:doran", online: true,
    profile: { name: "Doran", realm: "Forever", level: 23, race: "Dwarf", className: "Paladin" },
    presence: { character: "Doran", level: 23, zone: "Duskwood", sub: "Darkshire", quest: "The Night Watch" },
    toMira: ["Made it to Darkshire. The Night Watch could use a warrior, you coming?", "Also: ask Willo about Stitches. Trust me."],
    hello: "Hey! Doran here, a test friend on develop. Send me anything: I can't answer, but you'll see it arrive." },
  brann: { name: "Brann", email: "brann@example.test", sub: "test-player:brann",
    profile: { name: "Brann", realm: "Forever", level: 31, race: "Gnome", className: "Mage" } },
};
export const TEST_FRIENDS = ["mira", "doran"];

const iso = (now = Date.now()) => new Date(now).toISOString();
// Minutes from UTC as the page sends them (-new Date().getTimezoneOffset()), or undefined.
export const offsetOf = v => Number.isInteger(v) && Math.abs(v) <= 840 ? v : undefined;

// Their profile name: theirs ("mira"), or with "-test" on it when a real develop account already has that one.
async function handleFor(env, userId, key) {
  const owner = await env.DB.prepare("SELECT user_id FROM profiles WHERE handle = ?").bind(key).first("user_id");
  return !owner || owner === userId ? key : `${key}-test`;
}

const friendsWith = (env, a, b, now) => ["friends", "friends"].map((state, i) => env.DB.prepare(
  "INSERT INTO friend_edges (user_id, other_id, state, created, updated) VALUES (?, ?, ?, ?, ?) " +
  "ON CONFLICT (user_id, other_id) DO UPDATE SET state = excluded.state, updated = excluded.updated")
  .bind(i ? b : a, i ? a : b, state, iso(now), iso(now)));

// Writes `texts` from one account to another unless they've written to them before.
async function writeOnce(env, from, to, texts, now) {
  const said = await env.DB.prepare("SELECT 1 AS y FROM friend_messages WHERE sender = ? AND recipient = ? LIMIT 1").bind(from, to).first();
  if (said) return;
  await env.DB.batch(texts.map((text, i) => env.DB.prepare(
    "INSERT INTO friend_messages (sender, recipient, body, created) VALUES (?, ?, ?, ?)").bind(from, to, text, iso(now + i))));
}

// Makes (or refreshes) the three: {mira, doran, brann} -> {id, handle, pid}. Safe to run again and again. offset: the
// page's minutes from UTC, so Mira's pins carry the tester's own day (Silver's run, 10/20: "October 20" at 19:46 PT on
// the 19th); without one, UTC.
export async function seedTestPlayers(env, now = Date.now(), { offset } = {}) {
  const out = {};
  for (const [key, p] of Object.entries(TEST_PLAYERS)) {
    const user = await findOrCreateUser(env, { email: p.email, googleSub: p.sub, name: p.name });
    const handle = await handleFor(env, user.id, key);
    await env.DB.prepare("INSERT INTO profiles (user_id, handle, public, data, created, updated) VALUES (?, ?, 1, ?, ?, ?) " +
      "ON CONFLICT (user_id) DO UPDATE SET handle = excluded.handle, public = 1, data = excluded.data, updated = excluded.updated")
      .bind(user.id, handle, JSON.stringify(p.profile), iso(now), iso(now)).run();
    const me = await person(env, user.id, now);
    if (p.presence) {
      await setSharing(env, user.id, true, now);
      await savePresence(env, user.id, readPresence(p.presence), now);
    }
    if (p.online) {
      await env.DB.prepare("INSERT INTO devices (id, token_hash, user_id, label, created, last_used) VALUES (?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT (id) DO UPDATE SET last_used = excluded.last_used")
        .bind(`test-player-${key}`, `test-player-${key}`, user.id, "Test player", iso(now), iso(now)).run();
    }
    out[key] = { id: user.id, handle, pid: me.pid };
  }
  await env.DB.batch(friendsWith(env, out.mira.id, out.doran.id, now));
  await writeOnce(env, out.doran.id, out.mira.id, TEST_PLAYERS.doran.toMira, now);
  // Mira's pins: written once, so a pin taken out or renamed in a test stays that way (any edit moves the page past
  // version 1); with the tester's offset, an untouched page takes their day.
  const day = dayOn(new Date(now), offsetOf(offset));
  const body = "## Pins\n" + TEST_PLAYERS.mira.pins.map(([name, note, where]) => `- ${name}: ${note} · ${where} · ${day}`).join("\n") + "\n";
  await env.DB.prepare("INSERT INTO notebook_pages (user_id, page, title, body, version, updated) VALUES (?, ?, ?, ?, 1, ?) " +
    "ON CONFLICT (user_id, page) DO " + (offsetOf(offset) === undefined ? "NOTHING"
      : "UPDATE SET body = excluded.body, updated = excluded.updated WHERE notebook_pages.version = 1"))
    .bind(out.mira.id, "char:Mira-Forever", "Mira", body, iso(now)).run();
  return out;
}

// The test player `key` stands for, seeded: {id, handle, pid}, or null for a name that isn't one of them.
export async function testPlayer(env, key, now = Date.now(), { offset } = {}) {
  if (!Object.hasOwn(TEST_PLAYERS, key)) return null;
  return (await seedTestPlayers(env, now, { offset }))[key];
}

// "Add the test friends": the account becomes friends with Mira and Doran, and Doran says hello. [{name, handle}].
export async function befriendTestPlayers(env, userId, now = Date.now(), { offset } = {}) {
  const players = await seedTestPlayers(env, now, { offset });
  await person(env, userId, now);
  const added = [];
  for (const key of TEST_FRIENDS) {
    if (players[key].id === userId) continue;
    await env.DB.batch(friendsWith(env, userId, players[key].id, now));
    added.push({ name: TEST_PLAYERS[key].name, handle: players[key].handle });
  }
  if (players.doran.id !== userId) await writeOnce(env, players.doran.id, userId, [TEST_PLAYERS.doran.hello], now);
  return added;
}

// The test player `key` accepts every friend request waiting for them: how many.
export async function acceptAsTestPlayer(env, key, now = Date.now()) {
  const me = await testPlayer(env, key, now);
  if (!me) return 0;
  const { results } = await env.DB.prepare("SELECT p.pid FROM friend_edges e JOIN friend_people p ON p.user_id = e.other_id " +
    "WHERE e.user_id = ? AND e.state = 'asking'").bind(me.id).all();
  for (const r of results) await answerRequest(env, me.id, r.pid, true, now);
  return results.length;
}
