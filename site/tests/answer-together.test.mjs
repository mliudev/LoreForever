// Her answers on Together (lib/together.js), behind WILLO_ANSWER_HOST: typed and spoken answers come from it, and when
// Together errs, refuses (429) or sends no first words within FIRST_WORD_MS, Gemini answers instead, so a player never
// sees Together fail. Together and Gemini are mocked through fetch; D1 is node:sqlite.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/companion/answer.js";
import { findOrCreateUser, setup } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { TOGETHER_URL, FIRST_WORD_MS, viaTogether, resetBreaker, noteTogether, breakerOpen, BREAKER_RUN, BREAKER_OPEN_MS }
  from "../lib/together.js";
import { setupAnswerLog } from "../lib/answer-log.js";
import { d1 } from "./helpers.mjs";

const env = { DB: d1(), GEMINI_API_KEY: "test-key", TOGETHER_AI_API_KEY: "together-key",
  WILLO_ANSWER_HOST: "together:deepseek-ai/DeepSeek-V4.1-Flash" };
const originalFetch = globalThis.fetch;
const FROM_TOGETHER = "Thrall leads the Horde from Orgrimmar, in Durotar.";
const FROM_GEMINI = "Thrall rules from Grommash Hold in Orgrimmar.";
let together, calls, called;

const enc = new TextEncoder();
const events = list => new ReadableStream({ start(c) { for (const e of list) c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)); c.enqueue(enc.encode("data: [DONE]\n\n")); c.close(); } });
const words = text => ({ model: "deepseek-ai/DeepSeek-V4.1-Flash", choices: [{ delta: { content: text } }] });
const end = { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 300, completion_tokens: 20 } };

beforeEach(async () => {
  resetBreaker();
  await setup(env);
  await setupAnswerLog(env);
  for (const table of ["devices", "device_links", "rate_limits", "answer_spend", "free_pool_days", "users"]) env.DB.sqlite.exec(`DELETE FROM ${table}`);
  calls = [];
  let saw;
  called = new Promise(r => { saw = r; });
  together = () => new Response(events([words(FROM_TOGETHER.slice(0, 20)), words(FROM_TOGETHER.slice(20)), end]),
    { headers: { "Content-Type": "text/event-stream" } });
  globalThis.fetch = async (url, options) => {
    calls.push(String(url));
    if (String(url) === TOGETHER_URL) { saw(); return together(options); }
    const result = { candidates: [{ content: { parts: [{ text: FROM_GEMINI }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 20 } };
    if (!String(url).includes(":streamGenerateContent")) return Response.json(result);
    return new Response(`data: ${JSON.stringify(result)}\r\n\r\n`, { headers: { "Content-Type": "text/event-stream" } });
  };
});
afterEach(() => { globalThis.fetch = originalFetch; });

async function linked() {
  const user = await findOrCreateUser(env, { email: "together@example.com", googleSub: "together", name: "together" });
  const link = await startLink(env);
  await decideLink(env, link.user_code, user, true);
  return (await claimToken(env, link.device_code)).token;
}
const ask = async ({ question = "Where is Thrall?", ...fields } = {}) => {
  const res = await onRequest({ env, request: new Request("https://example.test/api/companion/answer", {
    method: "POST", headers: { "X-LF-Client": "companion/0.1.0", Authorization: `Bearer ${await linked()}`,
      "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "PLAYER CONTEXT\nzone: Durotar\n\nSOURCES\nThrall holds court in Orgrimmar.\n\n" +
      `QUESTION\n${question}`, persona: "willo", ...fields }) }) });
  return JSON.parse((await res.text()).trim().split("\n").at(-1));
};
const geminiCalled = () => calls.some(u => u.includes("generativelanguage.googleapis.com"));

test("a typed answer comes from Together when it's set", async () => {
  const body = await ask({});
  assert.equal(body.answer, FROM_TOGETHER);
  assert.ok(!geminiCalled());
});

test("a spoken answer in two layers comes from Together", async () => {
  together = () => new Response(events([words(`${FROM_TOGETHER}\n`), words("~~~\n"), words("Grommash Hold is its keep."), end]),
    { headers: { "Content-Type": "text/event-stream" } });
  const body = await ask({ style: "spoken", layers: 2 });
  assert.match(body.say, /Thrall leads the Horde/i);
  assert.ok(!geminiCalled());
});

test("Together refusing (429) or failing: Gemini answers instead, and the kept answer says so", async () => {
  for (const status of [429, 500]) {
    together = () => new Response("busy", { status });
    calls = [];
    env.DB.sqlite.exec("DELETE FROM answer_log");
    const body = await ask({ keep: true });
    assert.equal(body.answer, FROM_GEMINI, `HTTP ${status}`);
    const kept = env.DB.sqlite.prepare("SELECT lookups FROM answer_log").all();
    assert.ok(kept.length === 1 && kept[0].lookups.includes("together-fallback"), `HTTP ${status}: ${JSON.stringify(kept)}`);
  }
});

test("no first words from Together in time: Gemini answers instead", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  // Together answers nothing until its request is given up.
  together = options => new Response(new ReadableStream({ start(c) { options.signal.addEventListener("abort", () => c.error(options.signal.reason)); } }),
    { headers: { "Content-Type": "text/event-stream" } });
  const answer = ask({});
  await called;
  t.mock.timers.tick(FIRST_WORD_MS);
  assert.equal((await answer).answer, FROM_GEMINI);
});

// An action's arguments in pieces, as Together streams them.
const piece = (name, args) => ({ choices: [{ delta: { tool_calls: [{ index: 0, function: { ...(name ? { name } : {}), arguments: args } }] } }] });
const toolsDone = { choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 300, completion_tokens: 20 } };

test("an answer inside an offered action comes from Together whole, or streamed as her words while it's written", async () => {
  const offer = { systemInstruction: { parts: [{ text: "rules" }] }, contents: [{ role: "user", parts: [{ text: "Change your voice?" }] }],
    tools: [{ functionDeclarations: [{ name: "set_voice", description: "Set her voice", parameters: { type: "object",
      properties: { answer: { type: "string" }, voice: { type: "string" } }, required: ["answer"] } }] }],
    toolConfig: { functionCallingConfig: { mode: "ANY" } }, generationConfig: { temperature: 0.4, maxOutputTokens: 512 } };
  // An escape split between two pieces ("\" then "n") waits for its second half.
  const fetcher = async () => new Response(events([piece("set_voice", "{\"answer\":\"I'll sound like Moon"),
    piece("", "well.\\"), piece("", "nWant me to \\u0073witch?\",\"voice\":\"moonwell\"}"), toolsDone]),
  { headers: { "Content-Type": "text/event-stream" } });
  const moonwell = { functionCall: { name: "set_voice", args: { answer: "I'll sound like Moonwell.\nWant me to switch?",
    voice: "moonwell" } } };
  const whole = await (await viaTogether(env, offer, "deepseek-ai/DeepSeek-V4.1-Flash", { fetcher })).json();
  assert.deepEqual(whole.candidates[0].content.parts, [moonwell]);
  const streamed = await (await viaTogether(env, offer, "deepseek-ai/DeepSeek-V4.1-Flash", { stream: true, fetcher })).text();
  const parts = streamed.split("\n").filter(l => l.startsWith("data:"))
    .flatMap(l => JSON.parse(l.slice(5)).candidates[0].content.parts);
  assert.deepEqual(parts.filter(p => p.text).map(p => p.text), ["I'll sound like Moon", "well.", "\nWant me to switch?"]);
  assert.deepEqual(parts.filter(p => p.functionCall), [moonwell]);
});

// LOR-844 step 0: offering tools no longer holds back her spoken words. The call still comes first and carries her
// answer (tool_choice "required": the tools lab lost a third of the offers to "auto"), and her words stream out of it.
const VOICES = "Can you show me your voices?";
test("a spoken question offered an action: her words go out first, and the offer comes after them", async () => {
  const sent = [];
  together = options => {
    sent.push(JSON.parse(options.body));
    return new Response(events([piece("open_settings", "{\"answer\":\"My voices are on their own card.\\n"),
      piece("", "~~~\\nSettings has them all.\""), piece("", ",\"section\":\"voice\"}"), toolsDone]),
    { headers: { "Content-Type": "text/event-stream" } });
  };
  const res = await onRequest({ env, request: new Request("https://example.test/api/companion/answer", {
    method: "POST", headers: { "X-LF-Client": "companion/0.1.0", Authorization: `Bearer ${await linked()}`,
      "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: `PLAYER CONTEXT\nzone: Durotar\n\nQUESTION\n${VOICES}`, persona: "willo",
      style: "spoken", layers: 2 }) }) });
  const lines = (await res.text()).trim().split("\n").map(l => JSON.parse(l));
  assert.equal(lines.length, 2, "her words on a line of their own, before the answer");
  assert.match(lines[0].say, /voices/i);
  assert.equal(lines[1].action?.id, "open_settings");
  assert.deepEqual(lines[1].action.args, { section: "voice" });
  assert.equal(lines[1].answer, "My voices are on their own card. Settings has them all.");
  assert.deepEqual([sent.length, sent[0].stream, sent[0].tool_choice], [1, true, "required"]);
  assert.ok(!geminiCalled());
});

test("Together failing an offered answer: Gemini answers it with the call that carries the answer, as before", async () => {
  together = () => new Response("busy", { status: 503 });
  const mocked = globalThis.fetch;
  let geminiBody;
  globalThis.fetch = async (url, options) => {
    if (!String(url).includes("generativelanguage")) return mocked(url, options);
    geminiBody = JSON.parse(options.body);
    return Response.json({ candidates: [{ content: { parts: [{ functionCall: { name: "open_settings",
      args: { answer: FROM_GEMINI, section: "voice" } } }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 20 } });
  };
  const reply = await ask({ question: VOICES, style: "spoken", layers: 2 });
  assert.equal(reply.answer, FROM_GEMINI);
  assert.equal(reply.action?.id, "open_settings");
  assert.equal(geminiBody.toolConfig.functionCallingConfig.mode, "ANY");
});

test("a rush of fallbacks opens Together's breaker: answers skip it, say so, and try it again after", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const healthy = together;
  together = () => new Response("busy", { status: 503 });
  for (let i = 0; i < BREAKER_RUN; i++) assert.equal((await ask({})).answer, FROM_GEMINI);
  // Open: even with Together well again, it isn't asked, and the kept answer says why.
  together = healthy;
  calls = [];
  env.DB.sqlite.exec("DELETE FROM answer_log");
  assert.equal((await ask({ keep: true })).answer, FROM_GEMINI);
  assert.ok(!calls.includes(TOGETHER_URL), "the open breaker skips Together");
  assert.match(env.DB.sqlite.prepare("SELECT lookups FROM answer_log").get().lookups, /together-breaker/);
  t.mock.timers.tick(BREAKER_OPEN_MS);
  assert.equal((await ask({})).answer, FROM_TOGETHER, "after it, Together answers again");
});

test("a spoken picture question goes to Together without the picture unless it points at something on screen", async () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(296, 7)]).toString("base64");
  let sent;
  const healthy = together;
  together = options => { sent = options.body; return healthy(options); };
  assert.equal((await ask({ style: "spoken", image: jpeg })).answer, FROM_TOGETHER);
  assert.ok(!sent.includes("image_url") && !sent.includes(jpeg), "the picture isn't sent");
  for (const question of ["Who is this?", "Mikä tämä on?"]) {
    calls = [];
    assert.equal((await ask({ style: "spoken", image: jpeg, question })).answer, FROM_GEMINI, question);
    assert.ok(!calls.includes(TOGETHER_URL), `${question}: Together isn't asked`);
  }
});

test("on a busy isolate, three slow starts in a row don't open the breaker, three failures do", () => {
  const now = Date.now();
  for (const [slow, opens] of [[true, false], [false, true]]) {
    resetBreaker();
    for (let i = 0; i < 60; i++) noteTogether(false, { now });
    for (let i = 0; i < BREAKER_RUN; i++) noteTogether(true, { slow, now });
    assert.equal(breakerOpen(now), opens, slow ? "slow starts" : "failures");
  }
});

test("a disputed answer comes from Together with its reasoning on, and its thinking is never said", async () => {
  const sent = [];
  together = options => {
    sent.push(JSON.parse(options.body));
    return new Response(events([{ choices: [{ delta: { reasoning: "The notes put him in Orgrimmar." } }] },
      words(FROM_TOGETHER), end]), { headers: { "Content-Type": "text/event-stream" } });
  };
  const conversation = JSON.stringify([{ player: "Where is Thrall?", willo: FROM_TOGETHER }]);
  const disputed = await ask({ prompt: "PLAYER CONTEXT\nzone: Durotar\n\nSOURCES\nThrall holds court in Orgrimmar.\n\n" +
    `RECENT CONVERSATION (oldest first)\n${conversation}\n\nQUESTION\nThat's wrong, Thrall is in Thunder Bluff.` });
  assert.equal(disputed.answer, FROM_TOGETHER);
  assert.ok(!geminiCalled());
  await ask({});
  assert.deepEqual(sent.map(b => b.reasoning.enabled), [true, false], "only the disputed one reasons");
  // Thinking that fills its room and stops with no words: Gemini answers instead.
  together = () => new Response(events([{ choices: [{ delta: { reasoning: "Hmm." } }] },
    { choices: [{ delta: {}, finish_reason: "length" }] }]), { headers: { "Content-Type": "text/event-stream" } });
  calls = [];
  const ranOut = await ask({ prompt: "PLAYER CONTEXT\nzone: Durotar\n\nSOURCES\nThrall holds court in Orgrimmar.\n\n" +
    `RECENT CONVERSATION (oldest first)\n${conversation}\n\nQUESTION\nThat's wrong, Thrall is in Thunder Bluff.` });
  assert.equal(ranOut.answer, FROM_GEMINI);
});

test("one stray fallback among many answers doesn't open the breaker", async () => {
  const healthy = together;
  for (let i = 0; i < 15; i++) {
    together = i === 7 ? () => new Response("busy", { status: 503 }) : healthy;
    await ask({});
  }
  calls = [];
  together = healthy;
  assert.equal((await ask({})).answer, FROM_TOGETHER);
  assert.ok(calls.includes(TOGETHER_URL), "Together is still asked");
});

test("without the setting, every answer stays on Gemini", async () => {
  const host = env.WILLO_ANSWER_HOST;
  delete env.WILLO_ANSWER_HOST;
  try {
    assert.equal((await ask({})).answer, FROM_GEMINI);
    assert.ok(!calls.includes(TOGETHER_URL));
  } finally {
    env.WILLO_ANSWER_HOST = host;
  }
});

// LOR-844 steps 1 and 6 on DeepSeek: her friends tools ride beside her app's only on a question that may ask for one,
// so everyday answers stay as fast (the Architect, 10/26); what she says of their Friends is still the site's.
test("her friends tools ride on DeepSeek only for a question that may ask, and what she says of Friends is the site's", async () => {
  const sent = [];
  let reply;
  together = options => {
    sent.push(JSON.parse(options.body));
    return new Response(events(reply ? [piece(reply.name, JSON.stringify(reply.args)), toolsDone]
      : [words(FROM_TOGETHER), end]), { headers: { "Content-Type": "text/event-stream" } });
  };
  reply = null;
  assert.equal((await ask({ question: "Where is Thrall?" })).answer, FROM_TOGETHER);
  const offered = body => (body.tools || []).map(t => t.function.name);
  assert.ok(!offered(sent[0]).includes("friends_look"), "an everyday question carries no friends tools (speed)");
  reply = { name: "friends_look", args: { answer: "Your code is 1234.", what: "code" } };
  const code = await ask({ question: "what's my friend code?" });
  assert.ok(offered(sent[1]).includes("friends_look"));
  assert.match(code.answer, /friend code is/i);
  assert.doesNotMatch(code.answer, /1234/);
  assert.ok(!geminiCalled());
});
