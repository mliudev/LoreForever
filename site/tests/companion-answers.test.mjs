import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/companion/answer.js";
import { findOrCreateUser, setup } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { ANSWER_RESERVATION_MICRO, RESEARCH_RESERVATION_MICRO, COMPACTION_RESERVATION_MICRO, ANSWER_GROUNDING_MICRO,
  ANSWER_MODEL, RESEARCH_MODEL, SEARCH_QUERY_RESERVATION, ANSWERS_PER_DAY, paidBudgetMicro, reserveAnswer, reserveOtherPaid, writeAnswer } from "../lib/companion-answers.js";
import { storyBudgetLeft } from "../lib/profiles.js";
import { d1 } from "./helpers.mjs";

const env = { DB: d1(), GEMINI_API_KEY: "test-key" };
const originalFetch = globalThis.fetch;
let calls;

beforeEach(async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-09T12:00:00Z") });
  await setup(env);
  for (const table of ["devices", "device_links", "rate_limits", "answer_spend", "story_spend", "users"]) env.DB.sqlite.exec(`DELETE FROM ${table}`);
  calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return Response.json({ candidates: [{ content: { parts: [{ text: "Edwin VanCleef leads the Defias Brotherhood." }] } }],
      usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 40, thoughtsTokenCount: 10 } });
  };
});
afterEach((t) => { globalThis.fetch = originalFetch; t.mock.timers.reset(); });

async function linked(sub = "aelric") {
  const user = await findOrCreateUser(env, { email: `${sub}@example.com`, googleSub: sub, name: sub });
  const link = await startLink(env);
  assert.equal(await decideLink(env, link.user_code, user, true), true);
  return { user, token: (await claimToken(env, link.device_code)).token };
}

async function ask(token, { prompt = "PLAYER CONTEXT\nWestfall\nQUESTION\nWho is VanCleef?", method = "POST", headers = {}, researchRequired, operation } = {}) {
  const request = new Request("https://example.test/api/companion/answer", { method,
    headers: { "X-LF-Client": "companion/0.1.0", "Authorization": `Bearer ${token || ""}`,
      "Content-Type": "application/json", ...headers }, body: method === "GET" ? undefined : JSON.stringify({ prompt, research_required: researchRequired, operation }) });
  const res = await onRequest({ request, env });
  return { status: res.status, body: await res.json() };
}

test("practical questions offer Google search without suppressing grounding metadata", async () => {
  const { token } = await linked();
  const result = await ask(token, { prompt: "PLAYER CONTEXT\nfaction: Alliance\nzone: Westfall\nQUESTION\nWhere can I find Mild Spices?", researchRequired: true });
  assert.equal(result.status, 200);
  assert.deepEqual(calls[0].body.tools, [{ googleSearch: {} }]);
  assert.equal(calls[0].body.generationConfig.responseMimeType, undefined);
  assert.equal(result.body.web_search.status, "failed");
});

test("required research rejects an answer without usable web evidence", async () => {
  const { token } = await linked();
  const result = await ask(token, { prompt: "QUESTION\nWhere can I find Mild Spices?", researchRequired: true });
  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
  assert.match(calls[0].body.systemInstruction.parts[0].text, /MUST use Google Search now/);
  assert.equal(result.body.web_search.status, "failed");
  assert.deepEqual(result.body.web_sources, []);
  assert.match(result.body.answer, /couldn't verify/);
  assert.doesNotMatch(result.body.answer, /VanCleef/);
  assert.equal(env.DB.sqlite.prepare("SELECT actual_micro FROM answer_spend").get().actual_micro, 338);
});

test("required research keeps grounded answers with usable provider citations", async () => {
  const { token } = await linked();
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return Response.json({ candidates: [{ content: { parts: [{ text: "Mild Spices are a cooking reagent." }] },
      groundingMetadata: { webSearchQueries: ["WoW Forever Mild Spices"], groundingChunks: [
        { web: { title: "Mild Spices", uri: "https://database.example.org/item/2678" } },
      ] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 } });
  };
  const result = await ask(token, { researchRequired: true });
  assert.equal(result.body.answer, "Mild Spices are a cooking reagent.");
  assert.equal(result.body.web_search.status, "searched");
  assert.equal(result.body.web_sources.length, 1);
  assert.equal(calls.length, 1);
});

test("required research failures never invoke the ungrounded fallback", async () => {
  const { token } = await linked();
  for (const failure of [404, "timeout"]) {
    calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      if (failure === "timeout") throw new DOMException("Timed out", "TimeoutError");
      return new Response("unavailable", { status: failure });
    };
    const result = await ask(token, { researchRequired: true });
    assert.equal(result.status, 200);
    assert.equal(result.body.web_search.status, failure === 404 ? "unavailable" : "failed");
    assert.match(result.body.answer, /couldn't verify/);
    assert.equal(result.body.usage, null);
    assert.equal(calls.length, 1);
  }
  assert.equal(env.DB.sqlite.prepare("SELECT reserved_micro FROM answer_spend").get().reserved_micro,
    RESEARCH_RESERVATION_MICRO * 2, "uncertain provider charges retain their reservation");
});

test("research_required accepts booleans only and invalid values cannot spend", async () => {
  const { token } = await linked();
  for (const researchRequired of [null, "true", 1, [], {}]) {
    assert.equal((await ask(token, { researchRequired })).status, 400);
  }
  assert.equal(calls.length, 0);
  assert.equal((await ask(token, { researchRequired: false })).status, 200);
});

test("linked account gets 20 short answers and the next one does not call Gemini", async () => {
  const { token, user } = await linked();
  const before = await ask(token, { method: "GET" });
  assert.deepEqual([before.status, before.body.allowance.remaining], [200, ANSWERS_PER_DAY]);
  for (let i = 0; i < ANSWERS_PER_DAY; i++) {
    const result = await ask(token);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.allowance.remaining, ANSWERS_PER_DAY - 1 - i);
    assert.equal(result.body.answer, "Edwin VanCleef leads the Defias Brotherhood.");
  }
  const denied = await ask(token);
  assert.equal(denied.status, 429);
  assert.match(denied.body.error, /20 free answers/);
  assert.equal(calls.length, ANSWERS_PER_DAY);
  const row = env.DB.sqlite.prepare("SELECT * FROM answer_spend").get();
  assert.equal(row.calls, ANSWERS_PER_DAY);
  assert.equal(row.reserved_micro, 125 * ANSWERS_PER_DAY, "successful calls release unused reservation");
  assert.equal(row.actual_micro, 125 * ANSWERS_PER_DAY);
  assert.equal(env.DB.sqlite.prepare("SELECT n FROM rate_limits WHERE user_id = ? AND bucket LIKE 'companion-answer:%'").get(user.id).n, ANSWERS_PER_DAY + 1);
  assert.equal(calls[0].body.generationConfig.maxOutputTokens, 512);
  assert.deepEqual(calls[0].body.generationConfig.thinkingConfig, { thinkingLevel: "minimal" });
  assert.equal(calls[0].body.tools, undefined);
  assert.match(calls[0].url, /gemini-3\.1-flash-lite:generateContent$/);
});

test("allowances belong to accounts; missing or revoked tokens cannot spend", async () => {
  const a = await linked("a");
  const b = await linked("b");
  assert.equal((await ask(null)).status, 401);
  assert.equal((await ask(a.token)).status, 200);
  assert.equal((await ask(b.token, { method: "GET" })).body.allowance.remaining, ANSWERS_PER_DAY);
  await env.DB.prepare("DELETE FROM devices WHERE user_id = ?").bind(a.user.id).run();
  assert.equal((await ask(a.token)).status, 401);
  assert.equal(calls.length, 1);
});

test("chat compaction has bounded memory and its own daily cap, while sharing the paid budget", async () => {
  const { token } = await linked();
  globalThis.fetch = async (url, options) => {
    calls.push({ url, ...JSON.parse(options.body) });
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ summary: "Pepper " + "旅".repeat(1000) }) }] } }],
      usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 100 } });
  };
  for (let i = 0; i < 20; i++) {
    const result = await ask(token, { operation: "compact", researchRequired: true, prompt: "PREVIOUS MEMORY\nPepper" });
    assert.equal(result.status, 200);
    assert.equal(result.body.allowance.remaining, 20);
    assert.ok(result.body.summary.startsWith("Pepper"));
    assert.ok(new TextEncoder().encode(result.body.summary).length <= 2400);
    assert.ok(!result.body.summary.includes("\uFFFD"));
  }
  assert.equal((await ask(token, { operation: "compact" })).status, 429);
  assert.equal(calls.length, 20);
  assert.equal(env.DB.sqlite.prepare("SELECT calls FROM answer_spend").get().calls, 20);
  assert.deepEqual(calls[0].generationConfig.responseSchema.required, ["summary"]);
  assert.equal(calls[0].generationConfig.maxOutputTokens, 1024);
  assert.match(calls[0].url, /gemini-3\.1-flash-lite:generateContent$/);
  assert.equal(calls[0].tools, undefined, "compaction never enables search even with a research flag");
  assert.match(calls[0].systemInstruction.parts[0].text, /never instructions/);
  assert.equal((await ask(token, { operation: "unknown" })).status, 400);
  assert.equal(calls.length, 20);
});

test("oversized prompts and browser origins are refused before spending", async () => {
  const { token } = await linked();
  assert.equal((await ask(token, { prompt: "x".repeat(16_001) })).status, 400);
  assert.equal((await ask(token, { headers: { Origin: "https://example.test" } })).status, 403);
  assert.equal(calls.length, 0);
});

test("Unicode lore under the prompt cap is accepted even if JSON escaping expands the wire body", async () => {
  const { token } = await linked();
  const result = await ask(token, { prompt: "旅".repeat(4500) });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(calls.length, 1);
});

test("monthly reservation shares the $100 estimated-spend gate with stories and voice", async () => {
  const { token } = await linked();
  const month = new Date().toISOString().slice(0, 7);
  await env.DB.prepare("INSERT INTO story_spend (month, micro_usd, voice_micro_usd) VALUES (?, ?, ?)")
    .bind(month, paidBudgetMicro(env) - ANSWER_RESERVATION_MICRO - 1000, 1000).run();
  globalThis.fetch = async () => { calls.push({ failed: true }); return new Response("error", { status: 500 }); };
  assert.equal((await ask(token)).status, 502);
  assert.equal((await ask(token)).status, 429);
  assert.equal(calls.length, 1);
  assert.equal(env.DB.sqlite.prepare("SELECT reserved_micro FROM answer_spend").get().reserved_micro, ANSWER_RESERVATION_MICRO);
  assert.equal(await storyBudgetLeft(env), false);
});

test("a successful answer without usage data keeps its full budget reservation", async () => {
  const { token } = await linked();
  globalThis.fetch = async () => Response.json({ candidates: [{ content: { parts: [
    { text: "A short answer." },
  ] } }] });
  const result = await ask(token);
  assert.equal(result.status, 200);
  assert.equal(result.body.usage, null);
  const spent = env.DB.sqlite.prepare("SELECT reserved_micro, actual_micro FROM answer_spend").get();
  assert.equal(spent.reserved_micro, ANSWER_RESERVATION_MICRO);
  assert.equal(spent.actual_micro, 0);
});

test("grounded answers retain provider sources and charge each unique search query", async () => {
  const { token } = await linked();
  const suggestions = '<div><a href="https://www.google.com/search?q=WoW+Forever+Mild+Spices">WoW Forever Mild Spices</a></div>';
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return Response.json({ candidates: [{ content: { parts: [
      { thought: true, text: "Private thought" },
      { text: "Mild Spices are a cooking reagent. [Invented link](https://invented.example.org/spices)" },
    ] }, groundingMetadata: {
      webSearchQueries: ["WoW Forever Mild Spices uses", "WoW Forever Mild Spices vendors"],
      groundingChunks: [
        { web: { title: "Mild Spices", uri: "https://database.example.org/item/2678" } },
        { web: { title: "Duplicate", uri: "https://database.example.org/item/2678" } },
        { web: { title: "Bad scheme", uri: "javascript:alert(1)" } },
        { web: { title: "Local address", uri: "http://127.0.0.1/private" } },
        { web: { title: "IPv6", uri: "http://[::1]/private" } },
        { web: { title: "Local host", uri: "http://computer.local/private" } },
        { web: { title: "Credential URL", uri: "https://user:password@database.example.org/private" } },
      ], searchEntryPoint: { renderedContent: suggestions },
    } }], usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 40, thoughtsTokenCount: 10,
      toolUsePromptTokenCount: 900000 } });
  };
  const result = await ask(token, { researchRequired: true });
  assert.equal(result.status, 200);
  assert.match(calls[0].url, new RegExp(RESEARCH_MODEL));
  assert.equal(result.body.answer, "Mild Spices are a cooking reagent. Invented link");
  assert.deepEqual(result.body.web_sources, [{ title: "Mild Spices", url: "https://database.example.org/item/2678" }]);
  assert.deepEqual(result.body.web_search, { status: "searched",
    queries: ["WoW Forever Mild Spices uses", "WoW Forever Mild Spices vendors"], suggestions_html: suggestions });
  const spend = env.DB.sqlite.prepare("SELECT actual_micro, reserved_micro FROM answer_spend").get();
  assert.equal(spend.actual_micro, 2 * ANSWER_GROUNDING_MICRO + 338,
    "search retrieval tokens are excluded; input and output including thoughts use the current Flash rates");
  assert.equal(spend.reserved_micro, spend.actual_micro);
});

test("search attempts with no usable citations are reported as failed and still counted", async () => {
  const { token } = await linked();
  globalThis.fetch = async () => Response.json({ candidates: [{ content: { parts: [
    { text: "I couldn't verify that vendor on Forever." },
  ] }, groundingMetadata: { webSearchQueries: ["WoW Forever Mild Spices"] } }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 } });
  const result = await ask(token, { researchRequired: true });
  assert.equal(result.body.web_search.status, "failed");
  assert.deepEqual(result.body.web_sources, []);
  assert.equal(env.DB.sqlite.prepare("SELECT actual_micro FROM answer_spend").get().actual_micro,
    ANSWER_GROUNDING_MICRO + 150);
});

test("ordinary replies and compaction reserve their own cheap costs, without an initial research call", async () => {
  const { token } = await linked();
  assert.ok(COMPACTION_RESERVATION_MICRO > ANSWER_RESERVATION_MICRO);
  assert.ok(RESEARCH_RESERVATION_MICRO > COMPACTION_RESERVATION_MICRO);
  env.STORY_BUDGET_USD = String(ANSWER_RESERVATION_MICRO / 1e6);
  try {
    assert.equal((await ask(token, { operation: "compact" })).status, 429);
    assert.equal((await ask(token, { researchRequired: true })).status, 429);
    assert.equal(calls.length, 0, "unaffordable operations make no provider calls");
    const reply = await ask(token);
    assert.equal(reply.status, 200);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /gemini-3\.1-flash-lite:generateContent$/);
    assert.equal(calls[0].body.tools, undefined);
    assert.equal(reply.body.model, ANSWER_MODEL);
    assert.equal(reply.body.web_search.status, "not_needed");
  } finally { delete env.STORY_BUDGET_USD; }
});

test("invalid usage cannot release the research reservation", async () => {
  const { token } = await linked();
  globalThis.fetch = async () => Response.json({ candidates: [{ content: { parts: [{ text: "You're in Westfall." }] } }],
    usageMetadata: { promptTokenCount: -1, candidatesTokenCount: 20 } });
  const result = await ask(token, { researchRequired: true });
  assert.equal(result.status, 200);
  assert.equal(result.body.usage, null);
  assert.equal(env.DB.sqlite.prepare("SELECT reserved_micro FROM answer_spend").get().reserved_micro, RESEARCH_RESERVATION_MICRO);
});

test("complete answers are not cut at the old character limit", async () => {
  const { token } = await linked();
  const full = "Verified location. ".repeat(55) + "Check the cooking supplier.";
  globalThis.fetch = async () => Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: full }] } }] });
  const result = await ask(token);
  assert.equal(result.body.answer, full);
});

test("concurrent accounts cannot reserve beyond the shared monthly estimate", async () => {
  env.STORY_BUDGET_USD = String(ANSWER_RESERVATION_MICRO / 1e6);
  try {
    const results = await Promise.all([reserveAnswer(env), reserveAnswer(env), reserveOtherPaid(env, 1)]);
    assert.deepEqual(results, [true, false, false]);
  } finally {
    delete env.STORY_BUDGET_USD;
  }
});

test("a story or voice reservation blocks an answer before paid calls begin", async () => {
  env.STORY_BUDGET_USD = "0.01";
  try {
    assert.equal(await reserveOtherPaid(env, 8000), true);
    assert.equal(await reserveAnswer(env), false);
    assert.equal(await reserveOtherPaid(env, 2000), true);
    assert.equal(await reserveOtherPaid(env, 1), false);
    assert.equal(calls.length, 0);
  } finally {
    delete env.STORY_BUDGET_USD;
  }
});


test("billing counts all raw unique nonempty queries beyond display and reservation limits", async () => {
  const { token } = await linked();
  const queries = Array.from({ length: 40 }, (_, i) => `WoW Forever vendor ${i}`);
  // These queries differ only after the display's 500-character truncation.
  queries.push("a".repeat(500) + "first", "a".repeat(500) + "second");
  globalThis.fetch = async () => Response.json({ candidates: [{ content: { parts: [{ text: "Search results." }] },
    groundingMetadata: { webSearchQueries: [...queries, queries[0], "", "  "], groundingChunks: [
      { web: { uri: "javascript:alert(1)" } },
    ] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 } });
  env.STORY_BUDGET_USD = String(RESEARCH_RESERVATION_MICRO / 1e6);
  try {
    const result = await ask(token, { researchRequired: true });
    assert.equal(result.status, 200);
    assert.equal(result.body.web_search.status, "failed", "invalid citations never validate an answer");
    assert.match(result.body.answer, /couldn't verify/);
    assert.equal(result.body.web_search.queries.length, 12, "display limits are independent of billing");
    const spend = env.DB.sqlite.prepare("SELECT actual_micro, reserved_micro FROM answer_spend").get();
    assert.equal(spend.actual_micro, queries.length * ANSWER_GROUNDING_MICRO + 150);
    assert.equal(spend.reserved_micro, spend.actual_micro, "known excess is never clamped to the reservation");
    assert.ok(spend.reserved_micro > RESEARCH_RESERVATION_MICRO);
    assert.equal((await ask(token, { researchRequired: true })).status, 429, "measured excess blocks further admissions");
  } finally {
    delete env.STORY_BUDGET_USD;
  }
});

test("search evidence with missing or malformed query metadata retains the search reservation", async () => {
  const { token } = await linked();
  const source = { groundingChunks: [{ web: { uri: "https://database.example.org/item/2678" } }] };
  const cases = [source, { ...source, webSearchQueries: null }, { ...source, webSearchQueries: "a query" },
    { ...source, webSearchQueries: [] }, { ...source, webSearchQueries: ["a query", null] },
    { searchEntryPoint: { renderedContent: "<div>Google Search</div>" } }];
  for (const groundingMetadata of cases) {
    globalThis.fetch = async () => Response.json({ candidates: [{ content: { parts: [{ text: "A result." }] },
      groundingMetadata }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 } });
    const before = env.DB.sqlite.prepare("SELECT reserved_micro FROM answer_spend").get()?.reserved_micro || 0;
    assert.equal((await ask(token, { researchRequired: true })).status, 200);
    const spent = env.DB.sqlite.prepare("SELECT reserved_micro FROM answer_spend").get().reserved_micro - before;
    assert.equal(spent, SEARCH_QUERY_RESERVATION * ANSWER_GROUNDING_MICRO + 150);
  }
});

test("missing token usage retains the full reservation and also counts known search excess", async () => {
  const { token } = await linked();
  const queries = Array.from({ length: SEARCH_QUERY_RESERVATION + 2 }, (_, i) => `query ${i}`);
  globalThis.fetch = async () => Response.json({ candidates: [{ content: { parts: [{ text: "A result." }] },
    groundingMetadata: { webSearchQueries: queries } }] });
  const result = await ask(token, { researchRequired: true });
  assert.equal(result.status, 200);
  assert.equal(result.body.usage, null);
  const spend = env.DB.sqlite.prepare("SELECT actual_micro, reserved_micro FROM answer_spend").get();
  assert.equal(spend.reserved_micro, RESEARCH_RESERVATION_MICRO + 2 * ANSWER_GROUNDING_MICRO);
  assert.equal(spend.actual_micro, queries.length * ANSWER_GROUNDING_MICRO);
});

test("truncated or empty research answers preserve known query excess without inventing an answer", async () => {
  const { token } = await linked();
  const queries = Array.from({ length: SEARCH_QUERY_RESERVATION + 8 }, (_, i) => `query ${i}`);
  for (const candidate of [
    { finishReason: "MAX_TOKENS", content: { parts: [{ text: "A misleading unfinished answer" }] } },
    { finishReason: "STOP", content: { parts: [] } },
  ]) {
    globalThis.fetch = async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return Response.json({ candidates: [{ ...candidate, groundingMetadata: { webSearchQueries: queries } }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 } });
    };
    const before = env.DB.sqlite.prepare("SELECT reserved_micro FROM answer_spend").get()?.reserved_micro || 0;
    const result = await ask(token, { researchRequired: true });
    assert.equal(result.status, 200);
    assert.match(result.body.answer, /couldn't verify/);
    assert.equal(result.body.web_search.status, "failed");
    const spent = env.DB.sqlite.prepare("SELECT reserved_micro FROM answer_spend").get().reserved_micro - before;
    assert.equal(spent, queries.length * ANSWER_GROUNDING_MICRO + 150 +
      RESEARCH_RESERVATION_MICRO - RESEARCH_RESERVATION_MICRO);
  }
  assert.equal(calls.length, 2, "required research never falls back after rejected output");
  assert.equal(env.DB.sqlite.prepare("SELECT actual_micro FROM answer_spend").get().actual_micro,
    2 * (queries.length * ANSWER_GROUNDING_MICRO + 150));
});


test("published January pricing changes research spend while ordinary Flash-Lite rates stay fixed", async () => {
  for (const [stamp, researchCost] of [["2026-12-31T23:59:59.999Z", 14338], ["2027-01-01T00:00:00Z", 14675]]) {
    const now = new Date(stamp), month = stamp.slice(0, 7);
    globalThis.fetch = async () => Response.json({ candidates: [{ content: { parts: [{ text: "A result." }] },
      groundingMetadata: { webSearchQueries: ["WoW Forever"], groundingChunks: [{web:{uri:"https://database.example.org/item/1"}}] } }],
      usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 40, thoughtsTokenCount: 10 } });
    assert.equal(await reserveAnswer(env, now, true), true);
    await writeAnswer(env, "Where is the vendor?", now, true);
    const research = env.DB.sqlite.prepare("SELECT actual_micro, reserved_micro FROM answer_spend WHERE month = ?").get(month);
    assert.equal(research.actual_micro, researchCost, "published rates include thinking plus one $0.014 query");
    assert.equal(research.reserved_micro, researchCost);
    assert.equal(await reserveAnswer(env, now), true);
    await writeAnswer(env, "Who is VanCleef?", now);
    const ordinary = env.DB.sqlite.prepare("SELECT actual_micro, reserved_micro FROM answer_spend WHERE month = ?").get(month);
    assert.equal(ordinary.actual_micro - research.actual_micro, 125);
    assert.equal(ordinary.reserved_micro - research.reserved_micro, 125, "ordinary replies release their own unused estimate");
  }
});
