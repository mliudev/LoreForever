import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/companion/answer.js";
import { findOrCreateUser, setup } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { ANSWER_RESERVATION_MICRO, ANSWERS_PER_DAY, paidBudgetMicro, reserveAnswer, reserveOtherPaid } from "../lib/companion-answers.js";
import { storyBudgetLeft } from "../lib/profiles.js";
import { d1 } from "./helpers.mjs";

const env = { DB: d1(), GEMINI_API_KEY: "test-key" };
const originalFetch = globalThis.fetch;
let calls;

beforeEach(async () => {
  await setup(env);
  for (const table of ["devices", "device_links", "rate_limits", "answer_spend", "story_spend", "users"]) env.DB.sqlite.exec(`DELETE FROM ${table}`);
  calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ answer: "Edwin VanCleef leads the Defias Brotherhood.", sources: ["Edwin VanCleef"] }) }] } }],
      usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 40, thoughtsTokenCount: 10 } });
  };
});
afterEach(() => { globalThis.fetch = originalFetch; });

async function linked(sub = "aelric") {
  const user = await findOrCreateUser(env, { email: `${sub}@example.com`, googleSub: sub, name: sub });
  const link = await startLink(env);
  assert.equal(await decideLink(env, link.user_code, user, true), true);
  return { user, token: (await claimToken(env, link.device_code)).token };
}

async function ask(token, { prompt = "PLAYER CONTEXT\nWestfall\nQUESTION\nWho is VanCleef?", method = "POST", headers = {} } = {}) {
  const request = new Request("https://example.test/api/companion/answer", { method,
    headers: { "X-LF-Client": "companion/0.1.0", "Authorization": `Bearer ${token || ""}`,
      "Content-Type": "application/json", ...headers }, body: method === "GET" ? undefined : JSON.stringify({ prompt }) });
  const res = await onRequest({ request, env });
  return { status: res.status, body: await res.json() };
}

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
  assert.equal(calls[0].body.generationConfig.thinkingConfig.thinkingLevel, "minimal");
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

test("monthly reservation shares the $100 ceiling with stories and voice", async () => {
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
    { text: JSON.stringify({ answer: "A short answer.", sources: [] }) },
  ] } }] });
  const result = await ask(token);
  assert.equal(result.status, 200);
  assert.equal(result.body.usage, null);
  const spent = env.DB.sqlite.prepare("SELECT reserved_micro, actual_micro FROM answer_spend").get();
  assert.equal(spent.reserved_micro, ANSWER_RESERVATION_MICRO);
  assert.equal(spent.actual_micro, 0);
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
