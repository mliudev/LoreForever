// "Willo, send this to Mike" (lib/friend-send.js through functions/api/companion/answer.js, LOR-674): what a question
// asks to send, the friend by the name Willo shows, Willo's fixed words (Patrick's offline line for a friend who's
// away), the send offered as an action for her app, never the answer model and never one of their answers; and the
// question answered as before for a Willo without the action (an older one, the iPhone).
// In-process on node:sqlite (helpers.mjs); Gemini is a stub. Run: node --test 'site/tests/*.test.mjs'
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequest as answer } from "../functions/api/companion/answer.js";
import { findOrCreateUser, setup } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { addFriend, answerRequest, person } from "../lib/friends.js";
import { sendIntent, thingToSend } from "../lib/friend-send.js";
import { promptParts } from "../lib/forever-knowledge.js";
import { d1 } from "./helpers.mjs";

const env = { DB: d1(), GEMINI_API_KEY: "test-key" };
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
const ask = async (token, question, client = "companion/0.22.1") => (await answer({ env, request: new Request(
  "https://example.test/api/companion/answer", { method: "POST", headers: { "X-LF-Client": client,
    Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ prompt: PROMPT(question), persona: "willo" }) }) })).json();

test("what a question asks to send, and what isn't a send", () => {
  const kind = q => sendIntent(q)?.kind ?? null;
  assert.deepEqual(sendIntent("Willo, send this to Aelric"), { name: "Aelric", what: "this", kind: "this" });
  assert.equal(kind("send my location to Aelric please"), "place");
  assert.equal(kind("share the quest with Aelric."), "quest");
  assert.equal(kind("send Aelric my target"), "character");
  assert.equal(kind("pass [Lucky Fishing Hat] to Aelric"), "item");
  assert.equal(kind("send Aelric what you just told me"), "lore");
  // The vision session's blind check (10/18): questions about sending, and lore where someone sends something, are
  // never a send; the requests are.
  for (const q of NEAR_MISSES) assert.equal(sendIntent(q), null, q);
  for (const q of REQUESTS) assert.ok(sendIntent(q), q);
  // Out loud, by its name (no brackets to say): an item, or their quest by its title.
  assert.equal(kind("send the Lucky Fishing Hat to Aelric"), "this");
  const parts = promptParts(PROMPT("send this to Aelric"));
  const card = q => thingToSend(sendIntent(q), parts, PROMPT(q)).card;
  assert.deepEqual(card("send the quest to Aelric"), { kind: "quest", title: "The Defias Brotherhood", ref: "65" });
  assert.deepEqual(card("send where I am to Aelric"), { kind: "place", title: "Sentinel Hill, Westfall" });
  assert.equal(card("send my target to Aelric").title, "Gryan Stoutmantle");
  assert.equal(card("send this to Aelric").kind, "lore", "this, after an answer: what she just told them");
  assert.equal(card("send this to Aelric").title, "Who leads the Defias?");
  assert.deepEqual(card("send the Lucky Fishing Hat to Aelric"), { kind: "item", title: "Lucky Fishing Hat" });
  assert.equal(card("send the Defias Brotherhood to Aelric").kind, "quest");
});

test("a send is offered in Willo's fixed words, as an action; a friend who's away gets the offline line", async () => {
  const me = await player("sam", "Sam"), ana = await player("ana", "Aelric");
  await friends(me, ana, "ana");
  const online = await ask(me.token, "Willo, send the quest to Aelric");
  assert.equal(online.answer, `Aelric's Willo is awake. Want me to send them the quest "The Defias Brotherhood"?`);
  assert.equal(online.action.id, "send_to_friend");
  assert.equal(online.action.label, "Send to Aelric");
  assert.deepEqual({ ...online.action.args, to: "?" }, { to: "?", name: "Aelric", kind: "quest",
    title: "The Defias Brotherhood", ref: "65" });
  assert.equal(online.action.args.to, (await person(env, ana.user.id)).pid);
  assert.equal(calls, 0, "never the answer model");
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM rate_limits WHERE user_id = ? AND bucket LIKE 'companion-answer%'")
    .get(me.user.id).n, 0, "never one of their answers");

  env.DB.sqlite.prepare("UPDATE devices SET last_used = ? WHERE user_id = ?").run(new Date(Date.now() - 3600e3).toISOString(), ana.user.id);
  const away = await ask(me.token, "send where I am to ana");
  assert.equal(away.answer, "Aelric is offline. Would you like me to save this for them? It's where you are, Sentinel Hill, Westfall.");
  assert.equal(away.action.label, "Save it for Aelric");
  assert.equal(away.action.args.kind, "place");

  const stranger = await ask(me.token, "send this to Thrall");
  assert.equal(stranger.answer, "I don't see Thrall among your friends yet. Once you're friends, I can send it.");
  assert.equal(stranger.action, undefined);
});

test("a Willo without the action, and an older iPhone, get the question answered as before", async () => {
  const me = await player("sam", "Sam"), ana = await player("ana", "Aelric");
  await friends(me, ana, "ana");
  // The iPhone's runs it from 0.2.0 (mobile/, PR #1232).
  assert.equal((await ask(me.token, "send this to Aelric", "companion/ios-0.2.0")).action.id, "send_to_friend");
  assert.equal(calls, 0);
  for (const client of ["companion/0.22.0", "companion/ios-0.1.0"]) {
    const res = await ask(me.token, "send this to Aelric", client);
    assert.equal(res.answer, "Hello, friend.", client);
    assert.notEqual(res.action?.id, "send_to_friend");
  }
  assert.equal(calls, 2);
});
