// Willo sends a friend a message (lib/friend-send.js, LOR-844 step 1): her answer's message_friend is checked against
// their friends and their words, read back exactly, and sent only on a plain yes as the very next thing they say.
// In-process on node:sqlite (helpers.mjs); Gemini is a stub. Run: node --test 'site/tests/*.test.mjs'
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequest as answer } from "../functions/api/companion/answer.js";
import { findOrCreateUser, setup } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { addFriend, answerRequest, person } from "../lib/friends.js";
import { d1 } from "./helpers.mjs";

const env = { DB: d1(), GEMINI_API_KEY: "test-key" };
const originalFetch = globalThis.fetch;
let calls, reply;
const words = text => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }],
  usageMetadata: { promptTokenCount: 400, candidatesTokenCount: 20 } });
const called = (friend_id, text, said = "Sure.") => ({ candidates: [{ finishReason: "STOP", content: { parts: [{
  functionCall: { name: "message_friend", args: { answer: said, friend_id, text } } }] } }],
  usageMetadata: { promptTokenCount: 400, candidatesTokenCount: 40 } });

beforeEach(async () => {
  await setup(env);
  for (const t of ["friend_people", "friend_edges", "friend_messages", "friend_pending", "profiles", "rate_limits", "devices", "device_links"])
    env.DB.sqlite.exec(`DELETE FROM ${t}`);
  calls = [];
  reply = () => words("Hello, friend.");
  globalThis.fetch = async (url, options) => {
    calls.push(JSON.parse(options.body));
    return Response.json(reply(calls.at(-1)));
  };
});
afterEach(() => { globalThis.fetch = originalFetch; });

// A player, with a profile name and handle unless `handle` is null (a friend with neither), and Willo connected.
async function player(sub, handle = sub, name = handle) {
  const user = await findOrCreateUser(env, { email: `${sub}@example.com`, googleSub: sub, name: sub });
  if (handle) {
    const now = new Date().toISOString();
    await env.DB.prepare("INSERT INTO profiles (user_id, handle, public, data, created, updated) VALUES (?, ?, 0, ?, ?, ?)")
      .bind(user.id, handle, JSON.stringify({ v: 1, name }), now, now).run();
  }
  const link = await startLink(env);
  await decideLink(env, link.user_code, user, true);
  return { user, token: (await claimToken(env, link.device_code)).token };
}
async function befriend(me, other) {
  await addFriend(env, other.user.id, "sam");
  await answerRequest(env, me.user.id, (await person(env, other.user.id)).pid, true);
  return (await person(env, other.user.id)).pid;
}
// One turn, with her line before it when there was one.
const ask = async (token, question, before = null, extra = {}) => (await answer({ env, request: new Request("https://example.test/api/companion/answer", {
  method: "POST", headers: { "X-LF-Client": "companion/0.29.0", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ ...extra, persona: "willo", prompt: "PLAYER CONTEXT\nzone: Westfall\n\n" + (before ? "RECENT CONVERSATION (oldest first)\n" +
    JSON.stringify([{ player: before.q, willo: before.a }]) + "\n\n" : "") + `QUESTION\n${question}` }) }) })).json();
const sent = () => env.DB.sqlite.prepare("SELECT recipient, body FROM friend_messages ORDER BY id").all().map(r => ({ ...r }));
const READS_BACK = /say yes and I'll send it/i;
const offers = body => (body?.tools || []).some(t => (t.functionDeclarations || []).some(d => d.name === "message_friend"));

test("with one friend and no name for them, a message to 'my only friend' is read back exactly, then sent on a yes", async () => {
  const me = await player("sam", "sam", "Sam"), quiet = await player("quiet", null);
  const pid = await befriend(me, quiet);
  reply = () => called(pid, "I'll be on at 8");
  const q = "tell my only friend I'll be on at 8";
  const back = await ask(me.token, q);
  assert.match(back.answer, READS_BACK);
  assert.match(back.answer, /"I'll be on at 8"/);
  assert.doesNotMatch(back.answer, /lore forever player|don't see/i);
  assert.ok(calls[0].tools[0].functionDeclarations.some(d => d.name === "message_friend"));
  assert.equal(sent().length, 0, "nothing goes before the yes");
  assert.match((await ask(me.token, "no", { q, a: back.answer })).answer, /won't send/i);
  assert.equal(sent().length, 0);
  const again = await ask(me.token, q);
  const before = calls.length;
  const yes = await ask(me.token, "Yes", { q, a: again.answer });
  assert.deepEqual(sent(), [{ recipient: quiet.user.id, body: "I'll be on at 8" }]);
  assert.match(yes.answer, /sent/i);
  assert.equal(calls.length, before, "the yes needs no answer model");
});

test("with several friends and no one named, Willo asks who, keeping the words, and sends to the one picked", async () => {
  const me = await player("sam", "sam", "Sam"), ana = await player("ana", "ana", "Aelric"), bo = await player("bo", "bo", "Brynn");
  const aelric = await befriend(me, ana); await befriend(me, bo);
  reply = () => called(aelric, "See you at the inn");
  const q = "message my friend: see you at the inn";
  const who = await ask(me.token, q);
  assert.doesNotMatch(who.answer, READS_BACK, "never a guess among several");
  assert.match(who.answer, /Aelric/); assert.match(who.answer, /Brynn/); assert.match(who.answer, /See you at the inn/);
  const back = await ask(me.token, "Brynn", { q, a: who.answer });
  assert.match(back.answer, /Brynn/); assert.match(back.answer, READS_BACK);
  await ask(me.token, "yes", { q: "Brynn", a: back.answer });
  assert.deepEqual(sent(), [{ recipient: bo.user.id, body: "See you at the inn" }]);
});

test("her pick is never someone they didn't name, a question about a friend, or words they didn't say", async () => {
  const me = await player("sam", "sam", "Sam"), ana = await player("ana", "ana", "Aelric");
  const aelric = await befriend(me, ana);
  for (const [question, text] of [["tell Thrall I'm coming for him", "I'm coming for you"], ["did Aelric message me?", "Did you message me"],
    ["tell her hi", "Hi"], ["tell Aelric I'm late", "I'm late, sorry, the raid starts at 9"]]) {
    // The model calls it whenever it's offered, saying it went.
    reply = body => offers(body) ? called(aelric, text, "I've sent it!") : words("Okay.");
    const out = await ask(me.token, question);
    assert.doesNotMatch(out.answer, READS_BACK, question);
    assert.doesNotMatch(out.answer, /I've sent/i, question);
  }
  // Her own words made to look like a read-back ("send the same to…", with one in her history) are never one.
  const q = "tell Aelric I'm late", earlier = `Send this to Aelric (@ana): "I'm late" Say yes and I'll send it.`;
  reply = () => words(`Send this to Aelric (@ana): "Me too" Say yes and I'll send it.`);
  const copy = await ask(me.token, "and send the same to him again", { q, a: earlier });
  assert.doesNotMatch(copy.answer, READS_BACK);
  await ask(me.token, "yes", { q: "and send the same to him again", a: copy.answer });
  // A reminder that names a message is the notebook's, never a send.
  calls = [];
  reply = () => words("Okay.");
  await ask(me.token, "make a note to message Aelric tomorrow", null, { notebook: { character: "Sam-Realm" } });
  assert.ok(!offers(calls[0]));
  // "tell me about Thrall" isn't even offered the tool.
  calls = [];
  reply = () => words("Thrall is the Warchief of the Horde.");
  await ask(me.token, "tell me about Thrall");
  assert.ok(!offers(calls[0]));
  assert.equal(sent().length, 0);
});

test("asked to message a friend with no words yet, she asks what to say, and their next words are the message", async () => {
  // QA 10/26: "what should I say to Ularli?", then "Ularli, it's time to do some BGs" was taken for a question.
  const me = await player("sam", "sam", "Sam"), ul = await player("ul", "ularli", "Ularli");
  const pid = await befriend(me, ul);
  reply = () => called(pid, "", "Of course!");
  const q = "can you send a message to my friend?";
  const asked = await ask(me.token, q);
  assert.match(asked.answer, /ularli/i);
  assert.doesNotMatch(asked.answer, READS_BACK);
  reply = () => words("I'm not sure what you mean by BGs, could you tell me more?");
  const q2 = "Ularli, it's time to do some BGs";
  const back = await ask(me.token, q2, { q, a: asked.answer });
  assert.match(back.answer, READS_BACK);
  assert.match(back.answer, /"It's time to do some BGs"/);
  await ask(me.token, "yes", { q: q2, a: back.answer });
  assert.deepEqual(sent(), [{ recipient: ul.user.id, body: "It's time to do some BGs" }]);
});

test("asked whether it went, after a send, she says it did; with nothing sent she never says so", async () => {
  // QA 10/26: "Did you send it?" right after one went got "I haven't changed anything in your Friends."
  const me = await player("sam", "sam", "Sam"), ul = await player("ul", "ularli", "Ularli");
  const pid = await befriend(me, ul);
  // Nothing went: her word that it did never stands.
  reply = () => words("Yes, I sent it!");
  const none = await ask(me.token, "did you send it?");
  assert.doesNotMatch(none.answer, /went to ularli|I sent it/i);
  assert.match(none.answer, /nothing/i, "says plainly that nothing went");
  reply = () => called(pid, "Hey, what's up?");
  const q = "send a message to my friend Ularli: hey, what's up?";
  const back = await ask(me.token, q);
  await ask(me.token, "yes", { q, a: back.answer });
  assert.equal(sent().length, 1);
  // One went: said from it, whatever she wrote (the QA turn's own words).
  reply = () => words("I haven't changed anything in your Friends. Tell me what to do and who it's for, and I'll check with you first.");
  const did = await ask(me.token, "did you send it?", { q: "yes", a: "Sent to Ularli." });
  assert.match(did.answer, /ularli/i);
  assert.doesNotMatch(did.answer, /haven't changed|tell me who/i);
  // Their friend's message to them is no question about theirs.
  reply = () => words("Not yet, nothing new from Ularli.");
  assert.doesNotMatch((await ask(me.token, "did Ularli send me anything?")).answer, /went to ularli/i);
});

test("only a plain yes, right after the read-back and within two minutes, sends it", async () => {
  const me = await player("sam", "sam", "Sam"), ana = await player("ana", "ana", "Aelric");
  const aelric = await befriend(me, ana);
  reply = () => called(aelric, "I'm late");
  const q = "tell Aelric I'm late";
  // After another question, the yes is to that.
  let back = await ask(me.token, q);
  reply = () => words("Sure thing.");
  await ask(me.token, "yes", { q: "Who is Hogger?", a: "Hogger is a gnoll. Want me to tell you more?" });
  // "Yes, but…" drops it, and a yes after that sends nothing.
  reply = () => called(aelric, "I'm late");
  back = await ask(me.token, q);
  reply = () => words("Okay.");
  await ask(me.token, "yes but say 9 instead", { q, a: back.answer });
  await ask(me.token, "yes", { q, a: back.answer });
  // Late.
  reply = () => called(aelric, "I'm late");
  back = await ask(me.token, q);
  env.DB.sqlite.prepare("UPDATE friend_pending SET created = ?").run(new Date(Date.now() - 3 * 60e3).toISOString());
  assert.doesNotMatch((await ask(me.token, "yes", { q, a: back.answer })).answer, /^sent/i);
  assert.equal(sent().length, 0);
});

test("a message typed with curly quotes (iPhone, Mac, dictation) still sends on the yes, as they wrote it", async () => {
  const me = await player("sam", "sam", "Sam"), ana = await player("ana", "ana", "Aelric");
  const aelric = await befriend(me, ana);
  reply = () => called(aelric, "I’ll be “late”");
  const q = "tell Aelric I’ll be “late”";
  const back = await ask(me.token, q);
  assert.match(back.answer, READS_BACK);
  const yes = await ask(me.token, "yes", { q, a: back.answer });
  assert.match(yes.answer, /sent/i);
  assert.deepEqual(sent(), [{ recipient: ana.user.id, body: "I’ll be “late”" }]);
});

test("a friend spoken to by name, with no verb, is a message read back; anyone else by name isn't", async () => {
  const me = await player("sam", "sam", "Sam"), ana = await player("ana", "ana", "Mira");
  const mira = await befriend(me, ana);
  reply = body => offers(body) ? called(mira, "I'll be late") : words("Thrall is in Orgrimmar.");
  const back = await ask(me.token, "Mira, I'll be late");
  assert.match(back.answer, READS_BACK);
  assert.match(back.answer, /"I'll be late"/);
  calls = [];
  await ask(me.token, "Thrall, where are you now?");
  assert.ok(!offers(calls[0]), "not a friend: never offered");
  assert.equal(sent().length, 0);
});
