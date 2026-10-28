// Her smarter mind (lib/companion-answers.js MULL_RULE): on Legend, a hard question gets her short line at once, then
// the answer thought through on Together, carrying on from it, in the same bubble; a picture's question too, asked
// first on Gemini. The rule never reaches Gemini as Together's fallback, and WILLO_SMART_ROUTE "off" turns it all off.
// Together and Gemini are mocked through fetch; D1 is node:sqlite.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/companion/answer.js";
import { findOrCreateUser, setup } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { setupBilling } from "../lib/billing.js";
import { TOGETHER_URL, resetBreaker } from "../lib/together.js";
import { setupAnswerLog } from "../lib/answer-log.js";
import { d1 } from "./helpers.mjs";
import { DISPUTE_LINES } from "../lib/companion-answers.js";

const env = { DB: d1(), GEMINI_API_KEY: "test-key", TOGETHER_AI_API_KEY: "together-key", SITE_FEATURES: "plans",
  WILLO_ANSWER_HOST: "together:deepseek-ai/DeepSeek-V4.1-Flash" };
const originalFetch = globalThis.fetch;
const LINE = "Two fine daggers! Let me weigh them for you.";
// A worked-out number nothing supplied holds stays; a name nothing supplied holds goes (lib/willo-guards.js groundedWritten).
const THOUGHT = "Take the Cruel Barb over the Stiletto: it is the faster dagger, about 3.4 more damage a second, and for a Rogue that decides it. Pair it with Sinister Strike.";
const PLAIN = "The Cruel Barb drops from Edwin VanCleef in the Deadmines.";
const enc = new TextEncoder();
const sse = list => new Response(new ReadableStream({ start(c) {
  for (const e of list) c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
  c.close();
} }), { headers: { "Content-Type": "text/event-stream" } });
const togetherSays = text => sse([{ model: "deepseek-ai/DeepSeek-V4.1-Flash", choices: [{ delta: { content: text } }] },
  { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 300, completion_tokens: 20 } }, "[DONE]"]);
const geminiSays = (text, stream) => {
  const result = { candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 20 } };
  return stream ? sse([result]) : Response.json(result);
};
// What each model was asked: {to, system, thinks, picture}.
let asked, together;
const ruled = system => /HARD QUESTIONS/.test(system);

beforeEach(async () => {
  resetBreaker();
  await setup(env);
  await setupBilling(env);
  await setupAnswerLog(env);
  for (const table of ["devices", "device_links", "rate_limits", "answer_spend", "free_pool_days", "entitlements", "answer_log", "users"])
    env.DB.sqlite.exec(`DELETE FROM ${table}`);
  delete env.WILLO_SMART_ROUTE;
  asked = [];
  // Her reply with the rule is the mark and her line; thinking it through, the answer; else a plain answer.
  together = body => body.reasoning?.enabled ? togetherSays(THOUGHT)
    : togetherSays(ruled(body.messages[0].content) ? `[[MULL]] ${LINE}` : PLAIN);
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (String(url) === TOGETHER_URL) {
      const user = body.messages[1].content;
      asked.push({ to: "together", system: body.messages[0].content, thinks: Boolean(body.reasoning?.enabled),
        picture: Array.isArray(user) && user.some(p => p.type === "image_url") });
      return together(body);
    }
    const system = body.systemInstruction.parts[0].text;
    asked.push({ to: "gemini", system, picture: body.contents[0].parts.some(p => p.inlineData) });
    return geminiSays(ruled(system) ? `[[MULL]] ${LINE}` : PLAIN, String(url).includes(":streamGenerateContent"));
  };
});
afterEach(() => { globalThis.fetch = originalFetch; });

async function legend() {
  const user = await findOrCreateUser(env, { email: "legend@example.com", googleSub: "legend", name: "legend" });
  await env.DB.prepare("INSERT OR REPLACE INTO entitlements (user_id, subscription_id, plan, status, current_period_end, updated) " +
    "VALUES (?, ?, 'legend', 'active', ?, ?)").bind(user.id, `sub-${user.id}`, new Date(Date.now() + 20 * 86400e3).toISOString(),
    new Date().toISOString()).run();
  const link = await startLink(env);
  await decideLink(env, link.user_code, user, true);
  return (await claimToken(env, link.device_code)).token;
}
// Every line the reply sends (a two-layer answer's spoken words come first, on their own line), parsed.
const ask = async fields => {
  const res = await onRequest({ env, request: new Request("https://example.test/api/companion/answer", {
    method: "POST", headers: { "X-LF-Client": "companion/0.1.0", Authorization: `Bearer ${await legend()}`,
      "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "PLAYER CONTEXT\nzone: Westfall\nclass: Rogue\nlevel: 20\n\nQUESTION\n" +
      "Should I use the Cruel Barb or the Stiletto?", persona: "willo", keep: true, ...fields }) }) });
  return (await res.text()).trim().split("\n").map(line => JSON.parse(line));
};
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(296, 7)]).toString("base64");

test("Legend's hard question: her line is said at once, then the answer thought through carries on from it", async () => {
  for (const [what, fields] of [["spoken", { style: "spoken", layers: 2 }], ["with a picture", { style: "spoken", layers: 2, image: jpeg }]]) {
    asked = [];
    env.DB.sqlite.exec("DELETE FROM answer_log");
    const lines = await ask(fields);
    const reply = lines.at(-1);
    // Her line on a line of its own, before the answer.
    assert.deepEqual(lines.length === 2 && lines[0], { say: LINE }, `${what}: her line goes out first`);
    assert.equal(reply.say, LINE, what);
    assert.ok(reply.answer.startsWith(LINE) && reply.answer.includes("faster dagger"), `${what}: ${reply.answer}`);
    assert.ok(!reply.answer.includes("[[MULL]]"), what);
    assert.ok(reply.answer.includes("3.4 more damage") && !reply.answer.includes("Sinister Strike"), `${what}: ${reply.answer}`);
    // Asked first with the rule, then thought through on Together. With a picture she didn't call look for (LOR-856
    // E4), she answered without it, so it's thought through without it too.
    assert.ok(ruled(asked[0].system), what);
    const thought = asked.at(-1);
    assert.deepEqual([thought.to, thought.thinks, thought.picture, ruled(thought.system)],
      ["together", true, false, false], what);
    assert.ok(thought.system.includes(LINE), `${what}: the answer knows the line it carries on from`);
    assert.match(env.DB.sqlite.prepare("SELECT lookups FROM answer_log").get().lookups, /mulled/, what);
  }
});

test("a question about talents or a spec is answered as usual, never thought through", async () => {
  for (const question of ["Frost or fire for leveling a mage? Where do my first ten points go?",
    "What talent build should my warrior tank with?", "Arms or fury: which spec should I play?"]) {
    asked = [];
    const reply = (await ask({ prompt: "PLAYER CONTEXT\nzone: Westfall\nclass: Mage\nlevel: 20\n\nQUESTION\n" + question })).at(-1);
    assert.equal(reply.answer, PLAIN, question);
    assert.ok(asked.every(a => !ruled(a.system) && !a.thinks), question);
  }
});

// LOR-844 step 0: offering her tools mustn't take the hard-question route away (tools go on every answer).
test("offered an action, a hard question still gets her line first and is thought through with the action at hand", async () => {
  const tooled = [];
  const plain = together;
  together = body => { tooled.push((body.tools || []).map(t => t.function.name)); return plain(body); };
  const lines = await ask({ style: "spoken", layers: 2, prompt: "PLAYER CONTEXT\nzone: Westfall\nclass: Rogue\nlevel: 20\n\n" +
    "QUESTION\nCan you show me your voices? And should I use the Cruel Barb or the Stiletto?" });
  assert.deepEqual(lines[0], { say: LINE }, "her line goes out first");
  assert.ok(ruled(asked[0].system) && asked.at(-1).thinks, JSON.stringify(asked));
  assert.ok(tooled.length === 2 && tooled.every(names => names.includes("open_settings")), JSON.stringify(tooled));
});

test("the rule never reaches Gemini as Together's fallback, and WILLO_SMART_ROUTE off turns it off", async () => {
  together = () => new Response("busy", { status: 503 });
  const down = (await ask({})).at(-1);
  assert.equal(down.answer, PLAIN);
  assert.ok(asked.some(a => a.to === "gemini") && asked.filter(a => a.to === "gemini").every(a => !ruled(a.system)), JSON.stringify(asked));
  resetBreaker();
  together = body => togetherSays(ruled(body.messages[0].content) ? `[[MULL]] ${LINE}` : PLAIN);
  env.WILLO_SMART_ROUTE = "off";
  asked = [];
  assert.equal((await ask({ style: "spoken", layers: 2, image: jpeg })).at(-1).answer, PLAIN);
  assert.equal((await ask({})).at(-1).answer, PLAIN);
  assert.ok(asked.every(a => !ruled(a.system) && !a.thinks), JSON.stringify(asked));
});

test("pushback the word rules miss is marked and answered as a correction, thought through; surprise is not", async () => {
  const CORRECTED = "My notes say Hogger is level eleven, but your quest log has the final word: what does it show?";
  const says = text => ({ prompt: "PLAYER CONTEXT\nzone: Elwynn Forest\nclass: Warrior\nlevel: 9\n\n" +
    `RECENT CONVERSATION (oldest first)\n${JSON.stringify([{ player: "what level is Hogger?", willo: "Hogger is level eleven." }])}\n\n` +
    `QUESTION\n${text}`, style: "spoken", layers: 2 });
  together = body => {
    const system = body.messages[0].content, question = JSON.stringify(body.messages[1].content);
    if (body.reasoning?.enabled) return togetherSays(/disputes your last answer/.test(system) ? CORRECTED : THOUGHT);
    return togetherSays(/PUSHBACK/.test(system) && /quest log/.test(question) ? "[[DISPUTE]]" : PLAIN);
  };
  const reply = (await ask(says("hmm, my quest log says otherwise"))).at(-1);
  assert.equal(reply.answer, CORRECTED);
  assert.ok(/PUSHBACK/.test(asked[0].system) && asked.at(-1).thinks, JSON.stringify(asked.map(a => a.thinks)));
  assert.match(env.DB.sqlite.prepare("SELECT lookups FROM answer_log").get().lookups, /dispute-mark/);
  // Surprise is answered as usual, once; with no answer of hers before it, the rule isn't there at all.
  asked = [];
  env.DB.sqlite.exec("DELETE FROM answer_log");
  assert.equal((await ask(says("wait, really?"))).at(-1).answer, PLAIN);
  assert.equal(asked.length, 1);
  asked = [];
  await ask({ style: "spoken", layers: 2 });
  assert.ok(!asked.some(a => /PUSHBACK/.test(a.system)));
});

test("a marked pushback that's slow to think over gets one of her lines first, and the answer carries on from it", async () => {
  const CORRECTED = "My notes say Hogger is level eleven, but your quest log has the final word: what does it show?";
  const says = { prompt: "PLAYER CONTEXT\nzone: Elwynn Forest\nclass: Warrior\nlevel: 9\n\n" +
    `RECENT CONVERSATION (oldest first)\n${JSON.stringify([{ player: "what level is Hogger?", willo: "Hogger is level eleven." }])}\n\n` +
    "QUESTION\nhmm, my quest log says otherwise", style: "spoken", layers: 2 };
  // The correction comes after the line's moment (here 0 ms, so it's due at once; a 0 ms timer goes before a 5 ms one).
  together = async body => body.reasoning?.enabled
    ? (await new Promise(r => setTimeout(r, 5)), togetherSays(`${CORRECTED}\n~~~\n${CORRECTED}`))
    : togetherSays("[[DISPUTE]]");
  env.WILLO_DISPUTE_HOLD_MS = "0";
  try {
    const lines = await ask(says);
    const line = lines[0].say;
    assert.ok(DISPUTE_LINES.includes(line), JSON.stringify(lines));
    assert.ok(lines.at(-1).answer.startsWith(line) && lines.at(-1).answer.includes("final word"), lines.at(-1).answer);
    // Pushed back again: never the line she just said (chance pinned so the pick would be the same one).
    const random = Math.random;
    Math.random = () => DISPUTE_LINES.indexOf(line) / DISPUTE_LINES.length;
    try {
      const again = await ask({ ...says, prompt: says.prompt.replace('"Hogger is level eleven."',
        JSON.stringify(lines.at(-1).answer)) });
      assert.ok(DISPUTE_LINES.includes(again[0].say) && again[0].say !== line, JSON.stringify(again[0]));
    } finally { Math.random = random; }
  } finally { delete env.WILLO_DISPUTE_HOLD_MS; }
  // Quick enough: no line of hers before it.
  const quick = await ask(says);
  assert.ok(!DISPUTE_LINES.some(l => quick.at(-1).answer.startsWith(l)), quick.at(-1).answer);
});
