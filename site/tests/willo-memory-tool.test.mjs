// Her memory as a tool (LOR-844 step 6, phase 1 of the memory plan): "remember that…", "forget…", "forget everything"
// and "what do you remember about me?", by voice or typing. Her call is checked on what she keeps before it reaches her
// app: a plain ask runs at once with Undo, a forget names only the notes the player's words do, "forget everything"
// waits for a yes, and what isn't a plain ask ("remember when…", "never mind, forget it") does nothing.
// Together and Gemini are mocked through fetch; D1 is node:sqlite.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/companion/answer.js";
import { onRequest as memoriesApi } from "../functions/api/willo/memories.js";
import { findOrCreateUser, setup } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { setupWilloMemories, MEMORIES_PAID } from "../lib/willo-memories.js";
import { TOGETHER_URL, resetBreaker } from "../lib/together.js";
import { d1 } from "./helpers.mjs";

const env = { DB: d1(), GEMINI_API_KEY: "test-key", TOGETHER_AI_API_KEY: "together-key",
  WILLO_ANSWER_HOST: "together:deepseek-ai/DeepSeek-V4.1-Flash" };
const CAPS = "actions/1 memory.remember memory.forget memory.forget_all memory.list";
const originalFetch = globalThis.fetch;
const enc = new TextEncoder();
const sse = list => new Response(new ReadableStream({ start(c) {
  for (const e of list) c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
  c.enqueue(enc.encode("data: [DONE]\n\n"));
  c.close();
} }), { headers: { "Content-Type": "text/event-stream" } });
const calls = (name, args) => sse([{ choices: [{ delta: { tool_calls: [{ index: 0, function: { name,
  arguments: JSON.stringify(args) } }] } }] },
{ choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 300, completion_tokens: 20 } }]);
let together, gemini, asked;

beforeEach(async () => {
  resetBreaker();
  await setup(env);
  await setupWilloMemories(env);
  for (const table of ["devices", "device_links", "rate_limits", "answer_spend", "free_pool_days", "notebook_pages",
    "willo_memories", "users"]) env.DB.sqlite.exec(`DELETE FROM ${table}`);
  asked = [];
  together = () => calls("answer_only", { answer: "Hogger prowls the hills of Elwynn." });
  gemini = () => ({ text: "Hogger prowls the hills of Elwynn." });
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (String(url) === TOGETHER_URL) {
      asked.push({ to: "together", tools: (body.tools || []).map(t => t.function.name) });
      return together(body);
    }
    if (!body.contents) return Response.json({});
    asked.push({ to: "gemini", tools: (body.tools?.[0]?.functionDeclarations || []).map(d => d.name) });
    return Response.json({ candidates: [{ content: { parts: [gemini(body)] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 20 } });
  };
});
afterEach(() => { globalThis.fetch = originalFetch; });

async function linked() {
  const user = await findOrCreateUser(env, { email: "keep@example.com", googleSub: "keep", name: "keep" });
  const link = await startLink(env);
  await decideLink(env, link.user_code, user, true);
  return { id: user.id, token: (await claimToken(env, link.device_code)).token };
}
const note = (me, id, text, character = null) => env.DB.sqlite.prepare("INSERT INTO willo_memories (user_id, id, text, " +
  "source, status, character, created, updated) VALUES (?, ?, ?, 'player', 'ok', ?, '2026-10-26T09:00:00', '2026-10-26T09:00:00')")
  .run(me.id, id, text, character);
const ask = async (me, question, { on = env, caps = CAPS } = {}) => {
  const res = await onRequest({ env: on, request: new Request("https://example.test/api/companion/answer", {
    method: "POST", headers: { "X-LF-Client": "companion/0.31.0", Authorization: `Bearer ${me.token}`,
      "Content-Type": "application/json", "X-LF-Capabilities": caps },
    body: JSON.stringify({ prompt: `PLAYER CONTEXT\nzone: Westfall\nrace: Dwarf\nclass: Priest\nlevel: 14\n\nSOURCES\n\nQUESTION\n${question}`,
      persona: "willo", notebook: { character: "Tess-Stormrage" } }) }) });
  return (await res.text()).trim().split("\n").map(l => JSON.parse(l)).at(-1);
};
const TECH = /\b(?:memory|memories|saved?|stored?|database|data)\b/i;

test("a plain ask to remember is done at once in her words; one she knows already, or can't keep, isn't sent", async () => {
  const me = await linked();
  together = () => calls("memory", { answer: "I'll keep that in mind.", op: "remember", text: "I'm saving gold for my first mount" });
  const kept = await ask(me, "remember that I'm saving gold for my first mount");
  assert.deepEqual([kept.action?.id, kept.action?.args?.op, kept.action?.args?.text, kept.action?.now],
    ["memory", "remember", "I'm saving gold for my first mount", true]);
  assert.doesNotMatch(kept.answer, TECH);
  // The check runs after, in her app: her words never say it's kept before then.
  assert.doesNotMatch(kept.answer, /keep that in mind/i);
  // For the whole account unless their words say this character, whatever the model picked.
  together = () => calls("memory", { answer: "I'll keep that in mind.", op: "remember", text: "I main a hunter", scope: "character" });
  const account = await ask(me, "remember that I main a hunter");
  assert.equal(account.action?.args?.character, undefined);
  // Just this character's, when she's asked to keep it for them.
  together = () => calls("memory", { answer: "I'll keep that in mind.", op: "remember", text: "I'm a healer", scope: "character" });
  const mine = await ask(me, "please remember I'm a healer on this one");
  assert.match(mine.action?.args?.character || "", /^tess-stormrage$/i);
  // Said before what it is, it's still hers, never a goal ("Tell me what you're aiming for", the lab).
  together = () => calls("memory", { answer: "I'll keep that in mind.", op: "remember", text: "I'm going for Argent Dawn reputation" });
  const argent = await ask(me, "remember that on this character I'm going for Argent Dawn reputation");
  assert.match(argent.action?.args?.character || "", /^tess-stormrage$/i);
  note(me, "m1", "I'm saving gold for my first mount");
  together = () => calls("memory", { answer: "I'll keep that in mind.", op: "remember", text: "I'm saving gold for my first mount" });
  const again = await ask(me, "remember that I'm saving gold for my first mount");
  assert.ok(!again.action, JSON.stringify(again.action));
  assert.match(again.answer, /already/i);
  together = () => calls("memory", { answer: "I'll keep that in mind.", op: "remember", text: "My password is hunter2" });
  const secret = await ask(me, "remember my password is hunter2");
  assert.ok(!secret.action, JSON.stringify(secret.action));
  assert.doesNotMatch(secret.answer, /keep that in mind/i);
});

test("one the check turns away, or with no room left, is told before she answers, never okay and then a refusal", async () => {
  // Mike's QA, 10/26: "I'll keep in mind…", then "I couldn't keep that one…".
  const me = await linked();
  const checking = body => /check one short fact/i.test(body.systemInstruction?.parts?.[0]?.text || "");
  const reason = "I can't keep that one: it isn't mine to hold.";
  gemini = body => ({ text: checking(body) ? JSON.stringify({ ok: false, reason }) : "Hogger prowls the hills of Elwynn." });
  together = () => calls("memory", { answer: "I'll keep that in mind.", op: "remember", text: "I trade on the auction house" });
  const turned = await ask(me, "remember that I trade on the auction house");
  assert.deepEqual([turned.action, turned.answer], [undefined, reason]);
  gemini = body => ({ text: checking(body) ? JSON.stringify({ ok: true, reason: "" }) : "Hogger prowls the hills of Elwynn." });
  assert.equal((await ask(me, "remember that I trade on the auction house")).action?.args?.op, "remember");
  for (let i = 0; i < MEMORIES_PAID; i++) note(me, `f${i}`, `Fact number ${i}`);
  const full = await ask(me, "remember that I trade on the auction house");
  assert.ok(!full.action, JSON.stringify(full.action));
  assert.match(full.answer, /forget one/i);
});

test("their own words are the note, and the save doesn't check those words again; other words it does", async () => {
  const me = await linked();
  const checks = () => asked.filter(a => a.to === "gemini" && !a.tools.length).length;
  gemini = body => ({ text: /check one short fact/i.test(body.systemInstruction?.parts?.[0]?.text || "")
    ? JSON.stringify({ ok: true, reason: "" }) : "Hogger prowls the hills of Elwynn." });
  // Her rewording adds what they didn't say (the lab, 10/27: "…so playing WoW Forever less").
  together = () => calls("memory", { answer: "I'll keep that in mind.", op: "remember", text: "Works night shifts as a nurse in WoW" });
  const kept = await ask(me, "remember that I work night shifts as a nurse");
  assert.equal(kept.action?.args?.text, "I work night shifts as a nurse");
  assert.equal(checks(), 1);
  const save = text => memoriesApi({ env, request: new Request("https://example.test/api/willo/memories", { method: "POST",
    headers: { Authorization: `Bearer ${me.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ text, asked: true }) }) });
  assert.equal((await save(kept.action.args.text)).status, 200);
  assert.equal(checks(), 1, "the words checked before her answer aren't checked again");
  assert.equal((await save("I work night shifts as a nurse in Stormwind")).status, 200);
  assert.equal(checks(), 2, "other words are");
});

test("a forget lets go of only the notes the player's words name, and one she doesn't know gets her line", async () => {
  const me = await linked();
  note(me, "m1", "My main is a dwarf priest");
  note(me, "m2", "I'm saving gold for my first mount");
  note(me, "m3", "I play on weekends");
  together = () => calls("memory", { answer: "I've let that go.", op: "forget", text: "saving for a mount" });
  const gone = await ask(me, "forget that I'm saving for a mount");
  assert.deepEqual([gone.action?.args?.op, gone.action?.args?.ids, gone.action?.now], ["forget", ["m2"], true]);
  // No words of hers for it (Flash-Lite, 1 time of 3): the player's own say which.
  together = () => calls("memory", { answer: "I've let that go.", op: "forget" });
  const theirs = await ask(me, "forget that I play on weekends");
  assert.deepEqual(theirs.action?.args?.ids, ["m3"]);
  together = () => calls("memory", { answer: "I've let that go.", op: "forget", text: "my cat" });
  const none = await ask(me, "forget about my cat");
  assert.ok(!none.action, JSON.stringify(none.action));
  assert.doesNotMatch(none.answer, /let that go/i);
  // More than a few at once is read back with the count first, as everything is (the Architect, 10/26).
  for (const [id, text] of [["h1", "My hunter is named Rook"], ["h2", "My hunter tames wolves"], ["h3", "I level my hunter on weekends"],
    ["h4", "My hunter has a pet bear"]]) note(me, id, text);
  together = () => calls("memory", { answer: "I've let that go.", op: "forget", text: "my hunter" });
  const many = await ask(me, "forget the stuff about my hunter");
  assert.deepEqual([many.action?.args?.op, [...many.action?.args?.ids || []].sort(), many.action?.now],
    ["forget", ["h1", "h2", "h3", "h4"], undefined]);
  assert.match(many.answer, /\b4\b[^?]*\?\s*$/, "asks before forgetting them");
});

test("forget everything reads back how many she knows and waits for their yes", async () => {
  const me = await linked();
  note(me, "m1", "My main is a dwarf priest");
  note(me, "m2", "I play on weekends");
  note(me, "m3", "I'm saving gold for my first mount");
  together = () => calls("memory", { answer: "Done, all gone.", op: "forget_all" });
  const all = await ask(me, "forget everything you know about me");
  assert.equal(all.action?.args?.op, "forget_all");
  assert.ok(!all.action.now, "never at once");
  assert.match(all.answer, /\b3\b[^?]*\?\s*$/, "asks before forgetting them");
  assert.doesNotMatch(all.answer, /all gone/i);
  // Never the notebook's clear-all ("You have no lines on Húrin's page to take off", the phase 1 lab).
  const erased = await ask(me, "erase everything you remember about me");
  assert.equal(erased.action?.args?.op, "forget_all");
  assert.match(erased.answer, /\b3\b/);
  // Everything about someone else is a forget of those, never all of them, whatever the model picked.
  note(me, "b1", "My brother Sam plays a tauren");
  note(me, "b2", "My brother likes fishing");
  together = () => calls("memory", { answer: "Done.", op: "forget_all" });
  const brother = await ask(me, "forget everything about my brother");
  assert.deepEqual([brother.action?.args?.op, [...brother.action?.args?.ids || []].sort()], ["forget", ["b1", "b2"]]);
});

test("what isn't a plain ask about the player never touches what she keeps", async () => {
  const me = await linked();
  note(me, "m1", "I play on weekends");
  for (const [question, call] of [
    ["remember when we killed Hogger?", { op: "remember", text: "We killed Hogger" }],
    ["do you remember the Third War?", { op: "remember", text: "The Third War" }],
    ["remember to buy arrows before Duskwood", { op: "remember", text: "Buy arrows before Duskwood" }],
    ["never mind, forget it", { op: "forget", text: "weekends" }],
    ["who leads the Defias?", { op: "list" }],
  ]) {
    together = () => calls("memory", { answer: "Of course.", ...call });
    const reply = await ask(me, question);
    assert.ok(!reply.action, `${question}: ${JSON.stringify(reply.action)}`);
  }
  together = () => calls("memory", { answer: "Here's what you've told me.", op: "list" });
  const list = await ask(me, "what do you remember about me?");
  assert.deepEqual([list.action?.args?.op, list.action?.now], ["list", true]);
});

test("a to-do or a reminder stays their notebook's, and forgetting a fact about them is never a goal", async () => {
  const me = await linked();
  const fast = { ...env, WILLO_ANSWER_HOST: "" };
  for (const question of ["remember that I need to buy arrows", "forget the Ironforge reminder"]) {
    gemini = () => ({ functionCall: { name: "memory", args: { answer: "I've let that go.", op: "forget", text: "the Ironforge reminder" } } });
    const reply = await ask(me, question, { on: fast });
    assert.ok(asked.at(-1).tools.some(t => t.startsWith("notebook")), `${question}: ${JSON.stringify(asked.at(-1))}`);
    assert.ok(reply.action?.id !== "memory", `${question}: ${JSON.stringify(reply.action)}`);
  }
  note(me, "m1", "I'm saving gold for my first mount");
  together = () => calls("memory", { answer: "I've let that go.", op: "forget", text: "saving for a mount" });
  // Its goal words once offered only a goal ("Goal kept: riding at level 40"), never her memory.
  const gone = await ask(me, "forget that I'm saving for a mount");
  assert.deepEqual([gone.action?.id, gone.action?.args?.ids], ["memory", ["m1"]]);
  assert.doesNotMatch(gone.answer, /goal/i);
});

test("without DeepSeek, she's offered her memory only for a question that may ask for it", async () => {
  const me = await linked();
  const fast = { ...env, WILLO_ANSWER_HOST: "" };
  await ask(me, "who leads the Defias?", { on: fast });
  assert.ok(!asked.at(-1).tools.includes("memory"), JSON.stringify(asked));
  gemini = () => ({ functionCall: { name: "memory", args: { answer: "I'll keep that in mind.", op: "remember", text: "I main a hunter" } } });
  const kept = await ask(me, "remember that I main a hunter", { on: fast });
  assert.equal(asked.at(-1).to, "gemini");
  assert.deepEqual([kept.action?.id, kept.action?.args?.text], ["memory", "I main a hunter"]);
});

// The phase 1 lab on DeepSeek (10/27): "remember that you can tell me spoilers" was kept as theirs, and "you can forget
// about my mount now, I got it" kept a mount goal instead.
test("a rule for her is never kept as theirs, and a goal called on a forget of theirs goes back to her once", async () => {
  const me = await linked();
  together = () => calls("memory", { answer: "Okay.", op: "remember", text: "I'd rather hear spoilers" });
  const rule = await ask(me, "remember that you can tell me spoilers from now on");
  assert.ok(!rule.action, JSON.stringify(rule.action));
  note(me, "m1", "I'm saving gold for my first mount");
  let tries = 0;
  together = () => ++tries === 1 ? calls("goal", { answer: "Goal kept: riding at level 40.", op: "set", what: "level", level: 40 })
    : calls("memory", { answer: "Okay.", op: "forget", text: "my mount" });
  const gone = await ask(me, "you can forget about my mount now, I got it");
  assert.deepEqual([tries, gone.action?.args?.op, gone.action?.args?.ids], [2, "forget", ["m1"]]);
  assert.doesNotMatch(gone.answer, /goal/i);
  // A goal picked again on the second try: their words say which.
  tries = 0;
  together = () => ++tries && calls("goal", { answer: "That goal's off the list.", op: "set", what: "level", level: 40 });
  const twice = await ask(me, "you can forget about my mount now, I got it");
  assert.deepEqual([tries, twice.action?.args?.op, twice.action?.args?.ids], [2, "forget", ["m1"]]);
  // Answered with no call at all: their words say which, and what to keep.
  together = () => calls("answer_only", { answer: "Congratulations on the mount!" });
  const said = await ask(me, "you can forget about my mount now, I got it");
  assert.deepEqual([said.action?.args?.op, said.action?.args?.ids], ["forget", ["m1"]]);
  together = () => calls("answer_only", { answer: "An hour is plenty for a quest or two." });
  const hour = await ask(me, "bear in mind that I only have an hour a night to play");
  assert.deepEqual([hour.action?.args?.op, hour.action?.args?.text, hour.action?.now], ["remember", "I only have an hour a night to play", true]);
  // Never a forget for "don't forget…", nor anything for a question about the world.
  together = () => calls("answer_only", { answer: "Got it." });
  assert.equal((await ask(me, "don't forget I'm a tank")).action?.args?.op, "remember");
  assert.ok(!(await ask(me, "do you remember the Third War?")).action);
  for (const question of ["forget about Westfall, where should I go instead?", "forget the cat thing"]) {
    const kept = await ask(me, question);
    assert.deepEqual([kept.action, kept.answer], [undefined, "Got it."], question);
  }
  // What they ask besides stays out of the note; a forget about the world leaves a note that names it (the Architect).
  const both = await ask(me, "Remember I main a hunter, and what level is the Deadmines?");
  assert.deepEqual([both.action?.args?.op, both.action?.args?.text], ["remember", "I main a hunter"]);
  note(me, "w1", "I play in the evenings, mostly Westfall");
  assert.ok(!(await ask(me, "Forget about Westfall, let's head to Duskwood")).action);
});
