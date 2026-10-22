// LOR-721: an old typed client must still verify talent advice and a player's named correction.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequest as answer } from "../functions/api/companion/answer.js";
import { findOrCreateUser, setup } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { setupBilling, TASTE_ANSWERS, PLANS } from "../lib/billing.js";
import { feedbackKind } from "../lib/answer-feedback.js";
import { needsTalentResearch } from "../lib/research-cache.js";
import { d1 } from "./helpers.mjs";

const QUESTION = "what talents should I get to make my void pet more tanky";
const WRONG = "Take Fel Synergy and Demonic Embrace for pet stamina.";
const CORRECTION = "I'm not forsaken, I'm a troll. and I think you meant Demonic Energies. I'm also lvl 18";
const originalFetch = globalThis.fetch;
let env, calls, found;

beforeEach(async () => {
  env = { DB: d1(), GEMINI_API_KEY: "test-key" };
  await setup(env);
  calls = [];
  found = true;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ body, system: body.systemInstruction.parts[0].text, user: body.contents[0].parts.at(-1).text });
    return Response.json({ candidates: [{ content: { parts: [{ text: body.tools
      ? "The supplied talent record describes Demonic Energies." : "Here is the supported talent advice." }] },
      ...(body.tools && found ? { groundingMetadata: { webSearchQueries: ["WoW Forever warlock Demonic Energies"],
        groundingChunks: [{ web: { title: "Demonic Energies", uri: "https://talentsforever.com/warlock/talents/demonic-energies" } }] } } : {}) }],
    usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 30 } });
  };
});
afterEach(() => { globalThis.fetch = originalFetch; });

async function linked() {
  const user = await findOrCreateUser(env, { email: "talent@example.com", googleSub: "talent", name: "private-account" });
  const link = await startLink(env);
  await decideLink(env, link.user_code, user, true);
  return { user, token: (await claimToken(env, link.device_code)).token };
}
async function ask(token, question, previous = null) {
  const prompt = "PLAYER CONTEXT\nzone: Orgrimmar\nrace: Undead\nclass: Warlock\nlevel: 13\nfaction: Horde\nchar: private-character\n\n" +
    (previous ? "CONVERSATION\nRECENT CONVERSATION (oldest first)\n" +
      JSON.stringify([{ player: QUESTION, willo: previous }]) + "\n\n" : "") + `QUESTION\n${question}`;
  const response = await answer({ env, request: new Request("https://example.test/api/companion/answer", {
    method: "POST", headers: { "X-LF-Client": "companion/0.23.0", Authorization: `Bearer ${token}`,
      "Content-Type": "application/json" }, body: JSON.stringify({ prompt, persona: "willo" }) }) });
  assert.equal(response.status, 200);
  return response.json();
}

test("a typed talent question verifies even when the old client sends no research flag", async () => {
  const { token } = await linked();
  assert.equal((await ask(token, QUESTION)).looked_up, "quick");
  assert.equal(calls.filter(c => c.body.tools).length, 1);
  assert.match(calls[0].user, /what talents should I get to make my void pet more tanky/);
  assert.doesNotMatch(calls[0].user, /private-account|private-character|talent@example/);
});

test("a named talent correction verifies its current name and keeps the correction as the answer's question", async () => {
  const { token } = await linked();
  assert.equal(feedbackKind(CORRECTION, WRONG), "correction");
  assert.equal((await ask(token, CORRECTION, WRONG)).looked_up, "quick");
  assert.match(calls[0].user, /Demonic Energies/);
  assert.match(calls[0].user, /talent/i);
  assert.doesNotMatch(calls[0].user, /Fel Synergy|Demonic Embrace|private-character/);
  assert.ok(calls.at(-1).user.includes(`QUESTION\n${CORRECTION}\n\n(Before answering:`), "the correction is the question");
});

test("an unverified named talent correction gets the existing no-find guard", async () => {
  const { token } = await linked();
  found = false;
  assert.equal((await ask(token, CORRECTION, WRONG)).looked_up, "empty");
  assert.match(calls.at(-1).system, /NOTHING FOUND:/);
});

test("talent detection preserves the free plan's lookup boundary", async () => {
  env.SITE_FEATURES = "plans";
  await setupBilling(env);
  const { user, token } = await linked();
  await env.DB.prepare("INSERT INTO best_first (claim, user_id, used, started) VALUES (?, ?, ?, ?)")
    .bind("taste:talent", user.id, TASTE_ANSWERS, new Date(Date.now() - 30 * 86400e3).toISOString()).run();
  assert.equal((await ask(token, QUESTION)).looked_up, "off");
  assert.ok(calls.every(c => !c.body.tools));
  assert.match(calls.at(-1).system, /NOTHING FOUND:/);
});

test("talent research still obeys a paid plan's cost cap", async () => {
  env.SITE_FEATURES = "plans";
  await setupBilling(env);
  const { user, token } = await linked();
  const now = new Date();
  await env.DB.prepare("INSERT INTO entitlements (user_id, subscription_id, plan, status, current_period_end, updated) " +
    "VALUES (?, ?, 'hero', 'active', ?, ?)")
    .bind(user.id, `sub-${user.id}`, new Date(now.getTime() + 20 * 86400e3).toISOString(), now.toISOString()).run();
  await env.DB.prepare("INSERT INTO answer_user_spend (user_id, month, micro, calls) VALUES (?, ?, ?, 1)")
    .bind(user.id, now.toISOString().slice(0, 7), PLANS.hero.costCapMicro).run();
  assert.equal((await ask(token, QUESTION)).looked_up, "off");
  assert.ok(calls.every(c => !c.body.tools));
  assert.match(calls.at(-1).system, /NOTHING FOUND:/);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM answer_holds").get().n, 0);
});

test("writing talent goals or notebook entries does not start research", async () => {
  const { token } = await linked();
  for (const question of ["Add talent goals to my notebook", "Set a goal to improve my talents"])
    assert.equal((await ask(token, question)).looked_up, "no", question);
  assert.ok(calls.every(c => !c.body.tools?.some(tool => tool.googleSearch)), "notebook tools are not web searches");
});

test("ordinary questions and clarification wording do not trigger the new research route", async () => {
  assert.equal(feedbackKind("What did you mean?", WRONG), null);
  const clarification = "Could you explain what you meant by Demonic Energies?";
  assert.equal(feedbackKind(clarification, WRONG), null);
  assert.equal(needsTalentResearch(clarification, QUESTION, feedbackKind(clarification, WRONG)), false);
  for (const statement of ["You meant Demonic Energies.", "I believe you meant Demonic Energies.",
    "Maybe you meant Demonic Energies.", "Perhaps you meant Demonic Energies."]) {
    assert.equal(feedbackKind(statement, WRONG), "correction", statement);
    assert.equal(needsTalentResearch(statement, QUESTION, "correction"), true, statement);
  }
  assert.equal(feedbackKind("You meant Demonic Energies?", WRONG), null);
  assert.equal(needsTalentResearch(QUESTION), true);
  assert.equal(needsTalentResearch(CORRECTION, QUESTION, "correction"), true);
  assert.equal(needsTalentResearch(CORRECTION, "Who leads the Horde?", "correction"), false);
  assert.equal(needsTalentResearch("What did you mean?", QUESTION), false);
  assert.equal(needsTalentResearch("thanks", QUESTION), false);
  const { token } = await linked();
  assert.equal((await ask(token, "Tell me about Orgrimmar.")).looked_up, "no");
  assert.equal((await ask(token, "What did you mean?", WRONG)).looked_up, "no");
  assert.equal((await ask(token, clarification, WRONG)).looked_up, "no");
  assert.ok(calls.every(c => !c.body.tools));
});
