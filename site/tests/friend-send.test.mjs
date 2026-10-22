// Screenshot requests resolve accepted friends and prepare desktop capture only; old cards are never offered.
// In-process on node:sqlite (helpers.mjs); Gemini is a stub. Run: node --test 'site/tests/*.test.mjs'
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequest as answer } from "../functions/api/companion/answer.js";
import { findOrCreateUser, setup } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { addFriend, answerRequest, person } from "../lib/friends.js";
import { sendIntent } from "../lib/friend-send.js";
import { d1 } from "./helpers.mjs";

// The lore library's places, as pinPlaces reads them (public/lore/data/index.json).
const INDEX = { zones: [{ key: "elwynn", name: "Elwynn Forest" }],
  pages: [{ n: "Elwynn Forest", k: "zone", z: "elwynn" }, { n: "Fargodeep Mine", k: "subzone", z: "elwynn" },
          { n: "Goldshire", k: "subzone", z: "elwynn" }] };
const env = { DB: d1(), GEMINI_API_KEY: "test-key", ASSETS: { fetch: async () => Response.json(INDEX) } };
const originalFetch = globalThis.fetch;
let calls;

beforeEach(async () => {
  await setup(env);
  for (const t of ["friend_people", "friend_edges", "friend_messages", "profiles", "rate_limits", "devices", "device_links"])
    env.DB.sqlite.exec(`DELETE FROM ${t}`);
  calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "Hello, friend." }] } }],
      usageMetadata: { promptTokenCount: 400, candidatesTokenCount: 20 } });
  };
});
afterEach(() => { globalThis.fetch = originalFetch; });

// A player with a character on their profile, and Willo connected: {user, token}.
async function player(handle, character) {
  const user = await findOrCreateUser(env, { email: `${handle}@example.com`, googleSub: handle, name: handle });
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO profiles (user_id, handle, public, data, created, updated) VALUES (?, ?, 0, ?, ?, ?)")
    .bind(user.id, handle, JSON.stringify({ v: 1, name: character }), now, now).run();
  const link = await startLink(env);
  await decideLink(env, link.user_code, user, true);
  return { user, token: (await claimToken(env, link.device_code)).token };
}
async function friends(a, b, handleB) {
  await addFriend(env, a.user.id, handleB);
  await answerRequest(env, b.user.id, (await person(env, a.user.id)).pid, true);
}
// The vision session's blind-check lists (10/18, ~/lab/willo-second-brain/check/send/crafted.json).
const NEAR_MISSES = ["Why did Thrall share the location with Jaina?", "Did Uther show Arthas the map?",
  "Did Arthas pass the weapon to Muradin?", "Who did Medivh send the story to Khadgar?", "Why did Varian send the quest to Bolvar?",
  "Did Jaina share this area with Thrall?", "When did Magni pass the throne to Moira?", "Did Kel'Thuzad send the plague to Andorhal?",
  "Why did the Kirin Tor share the zone with Dalaran?", "Did Sylvanas show Varimathras the place?",
  "Did Turalyon pass the armor to Alleria?", "How did Gul'dan send the item to Teron?", "How do I share the quest with my party?",
  "How do I share this quest with Aelric?", "Can I share quests with Bob?", "How do I send mail to my alt?",
  "How do I send gold to Brynn?", "How do I pass loot to Jorin?", "Can you show me the way to Ironforge?", "Show me the map",
  "Where do I send this letter to Gryan?", "How do I forward my mail to Stormwind?", "Should I share my gear with Brynn?",
  "Do I pass the loot to Hogger?", "Can I send this item to my bank?", "How do I send the boss to Hogger?",
  "Is it rude to share the zone with Aelric?", "Show Mankrik where his wife is", "I want to share this spot with a friend, how?",
  "Which flight master can send me to Booty Bay?", "Send me to Booty Bay", "send help to Westfall",
  "share your thoughts with me", "send my regards to Thrall", "tell me about Thrall", "send this to me",
  "Can I pass the quest to a guildmate?", "the guard will send the quest to Lakeshire"];
const REQUESTS = ["Send this to Mike", "Willo, send my location to Aelric", "send the quest to Brynn",
  "share where I am with Aelric", "pass [Lucky Fishing Hat] to Mike", "send Mike this", "show Aelric my target",
  "Hey Willow, send what you just told me to Mike please", "Can you send this to Mike?", "forward the story to Brynn"];
const PROMPT = question => "PLAYER CONTEXT\nzone: Westfall\nsub: Sentinel Hill\ntarget: Gryan Stoutmantle\n" +
  "quest in their log: The Defias Brotherhood (ID 65)\n\nRECENT CONVERSATION (oldest first)\n" +
  JSON.stringify([{ player: "Who leads the Defias?", willo: "Edwin VanCleef leads the Defias Brotherhood from the Deadmines. " +
    "He was a stonemason of Stormwind, wronged over unpaid wages." }]) + `\n\nQUESTION\n${question}`;
const ask = async (token, question, client = "companion/0.24.0", capabilities = "game-screenshot-sharing") => (await answer({ env, request: new Request(
  "https://example.test/api/companion/answer", { method: "POST", headers: { "X-LF-Client": client, "X-LF-Capabilities": capabilities,
    Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ prompt: PROMPT(question), persona: "willo" }) }) })).json();

test("screenshot commands are distinct from questions and old game cards", () => {
  for (const q of ["Willo take a screenshot of the game and send it to Patrick", "Willo, send a picture of my game to Patrick",
    "Can you share this screenshot with Patrick?", "send Patrick this screenshot", "send this to Patrick", "send a screenshot to Patrick please",
    "take a screen shot and send it to Patrick", "send a screenshot to Patrick Smith"]) {
    assert.equal(sendIntent(q)?.kind, "screenshot", q);
  }
  for (const q of NEAR_MISSES) assert.notEqual(sendIntent(q)?.kind, "screenshot", q);
  assert.equal(sendIntent("send the quest to Patrick")?.kind, "retired");
  assert.equal(sendIntent("send a screenshot to Patrick Smith")?.name, "Patrick Smith");
});

test("accepted friend resolved into capture preview only, with no model or sent message", async () => {
  const me = await player("sam", "Sam"), ana = await player("ana", "Aelric");
  await friends(me, ana, "ana");
  const r = await ask(me.token, "Willo take a screenshot of the game and send it to Aelric");
  assert.deepEqual(r.action, { id: "capture_game_to_friend", label: "Preview screenshot",
    args: { to: (await person(env, ana.user.id)).pid, name: "Aelric" } });
  assert.match(r.answer, /prepare a screenshot/);
  assert.match(r.answer, /see the picture and choose Send before anything is shared/);
  assert.equal(calls, 0);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM friend_messages").get().n, 0);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM rate_limits WHERE user_id = ? AND bucket LIKE 'companion-answer%'").get(me.user.id).n, 0);
  env.DB.sqlite.prepare("UPDATE devices SET last_used = ? WHERE user_id = ?").run(new Date(Date.now() - 3600e3).toISOString(), ana.user.id);
  const away = await ask(me.token, "send this to ana");
  assert.equal(away.action.id, "capture_game_to_friend");
  assert.doesNotMatch(away.answer, /is awake|is offline|saved|sent it/i, "no capture or send claimed, presence still independent");
});

test("older desktop and phone require desktop capture and never fall through to game mail advice", async () => {
  const me = await player("sam", "Sam"), ana = await player("ana", "Aelric");
  await friends(me, ana, "ana");
  for (const client of ["companion/0.24.0", "companion/99.0.0", "companion/ios-0.2.0", "companion/ios-0.1.0"]) {
    const r = await ask(me.token, "take a screenshot of the game and send it to Aelric", client, "");
    assert.equal(r.action, undefined);
    assert.match(r.answer, /PC or Mac/);
    assert.match(r.answer, /can't capture/);
  }
  const retired = await ask(me.token, "send the quest to Aelric");
  assert.equal(retired.action, undefined);
  assert.match(retired.answer, /don't send game cards anymore/);
  assert.equal(calls, 0);
});

test("missing and ambiguous friends never get a capture action", async () => {
  const me = await player("sam", "Sam");
  const stranger = await ask(me.token, "send a screenshot to Patrick");
  assert.match(stranger.answer, /don't see Patrick among your friends/);
  assert.equal(stranger.action, undefined);
  const one = await player("patrick-one", "Patrick One"), two = await player("patrick-two", "Patrick Two");
  await friends(me, one, "patrick-one"); await friends(me, two, "patrick-two");
  const ambiguous = await ask(me.token, "send a screenshot to Patrick");
  assert.match(ambiguous.answer, /more than one friend/);
  assert.equal(ambiguous.action, undefined);
  assert.equal((await ask(me.token, "send a screenshot to Patrick One")).action.args.to, (await person(env, one.user.id)).pid);
  assert.equal(calls, 0);
});

test("missing screenshot recipients and ambiguous names can be clarified in the next turn", async () => {
  const me = await player("sam", "Sam"), first = await player("ana-one", "Ana One"), second = await player("ana-two", "Ana Two");
  await friends(me, first, "ana-one"); await friends(me, second, "ana-two");
  for (const question of ["send a screenshot", "take a screenshot of the game and send it", "send a screenshot to a friend"]) {
    const missing = await ask(me.token, question);
    assert.match(missing.answer, /Which friend/); assert.equal(missing.action, undefined);
  }
  const follow = async (prior, said, reply) => {
    const prompt = `PLAYER CONTEXT\nzone: Westfall\n\nRECENT CONVERSATION (oldest first)\n${JSON.stringify([{player: prior, willo: said}])}\n\nQUESTION\n${reply}`;
    return (await answer({ env, request: new Request("https://example.test/api/companion/answer", {
      method: "POST", headers: { "X-LF-Client": "companion/0.24.0", "X-LF-Capabilities": "game-screenshot-sharing", Authorization: `Bearer ${me.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({prompt, persona: "willo"}),
    }) })).json();
  };
  const missing = await ask(me.token, "send a screenshot");
  assert.equal((await follow("send a screenshot", missing.answer, "@ana-one")).action.args.to, (await person(env, first.user.id)).pid);
  const ambiguous = await ask(me.token, "send a screenshot to Ana");
  assert.match(ambiguous.answer, /more than one friend/);
  assert.equal((await follow("send a screenshot to Ana", ambiguous.answer, "Ana Two")).action.args.to, (await person(env, second.user.id)).pid);
  assert.equal(calls, 0);
});
