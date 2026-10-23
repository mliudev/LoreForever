import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/companion/answer.js";
import { findOrCreateUser, setup } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { ANSWER_RESERVATION_MICRO, RESEARCH_RESERVATION_MICRO, COMPACTION_RESERVATION_MICRO, ANSWER_GROUNDING_MICRO,
  ANSWER_MODEL, SIGHT_MODEL, RESEARCH_MODEL, CLARIFY_NOTE, SEARCH_QUERY_RESERVATION, ANSWERS_PER_DAY, VERIFICATION_FAILED, paidBudgetMicro, reserveAnswer, reserveOtherPaid, writeAnswer } from "../lib/companion-answers.js";
import { storyBudgetLeft } from "../lib/profiles.js";
import { d1 } from "./helpers.mjs";

const env = { DB: d1(), GEMINI_API_KEY: "test-key" };
const originalFetch = globalThis.fetch;
let calls;

beforeEach(async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-09T12:00:00Z") });
  await setup(env);
  for (const table of ["devices", "device_links", "rate_limits", "answer_spend", "story_spend", "users", "excluded_accounts", "free_pool_days"]) env.DB.sqlite.exec(`DELETE FROM ${table}`);
  // Research findings are shared between players (lib/research-cache.js): each test searches afresh.
  try { env.DB.sqlite.exec("DELETE FROM research_cache"); } catch { /* made on first use */ }
  calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return Response.json({ candidates: [{ content: { parts: [{ text: "Edwin VanCleef leads the Defias Brotherhood." }] } }],
      usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 40, thoughtsTokenCount: 10 } });
  };
});
afterEach((t) => { globalThis.fetch = originalFetch; t.mock.timers.reset(); });

test("unclear requests use the general answer call without rewriting their words (LOR-719)", async () => {
  const { token } = await linked();
  const questions = [
    "Hey Willow, when do you get a want? When can you get a want? As like uh what's it called, uh Warlock.",
    "Where do I hand the thing in?",
    "Should I use it now?",
  ];
  const clarification = "Which item do you mean?";
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return Response.json({ candidates: [{ content: { parts: [{ text: clarification }] } }],
      usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 40 } });
  };
  for (const question of questions) {
    for (const style of [undefined, "spoken"]) {
      calls = [];
      const result = await ask(token, { prompt: `PLAYER CONTEXT\nlevel: 2\n\nQUESTION\n${question}`,
        persona: "willo", style });
      assert.equal(result.status, 200);
      assert.equal(result.body.answer, clarification);
      assert.equal(calls.length, 1, "clarification comes from the same answer call");
      const sent = calls[0].body.contents[0].parts.at(-1).text;
      assert.ok(sent.endsWith(`QUESTION\n${question}\n\n${CLARIFY_NOTE}`), "the words as received, then the note");
      const instruction = calls[0].body.systemInstruction.parts[0].text;
      assert.match(instruction, /UNDERSTAND BEFORE ANSWERING:/);
    }
  }
  const spend = env.DB.sqlite.prepare("SELECT reserved_micro, actual_micro FROM answer_spend").get();
  assert.ok(spend.actual_micro > 0, "the model's actual usage is counted");
  assert.equal(spend.reserved_micro, spend.actual_micro, "no unused model reservation remains held");
});

async function linked(sub = "aelric") {
  const user = await findOrCreateUser(env, { email: `${sub}@example.com`, googleSub: sub, name: sub });
  const link = await startLink(env);
  assert.equal(await decideLink(env, link.user_code, user, true), true);
  return { user, token: (await claimToken(env, link.device_code)).token };
}

// A question no fact covers (era-vanessa names VanCleef since LOR-639; a real NPC has NPC facts), so research isn't
// answered from facts.
async function ask(token, { prompt = "PLAYER CONTEXT\nWestfall\nQUESTION\nWho is Zarnok Brightwhistle?", method = "POST", headers = {}, researchRequired, operation, persona, style, image } = {}) {
  const request = new Request("https://example.test/api/companion/answer", { method,
    headers: { "X-LF-Client": "companion/0.1.0", "Authorization": `Bearer ${token || ""}`,
      "Content-Type": "application/json", ...headers }, body: method === "GET" ? undefined : JSON.stringify({ prompt, research_required: researchRequired, operation, persona, style, image }) });
  const res = await onRequest({ request, env });
  return { status: res.status, body: await res.json() };
}

test("practical questions offer Google search without suppressing grounding metadata", async () => {
  const { token } = await linked();
  const result = await ask(token, { prompt: "PLAYER CONTEXT\nfaction: Alliance\nzone: Westfall\nQUESTION\nWhere can I find Simple Flour?", researchRequired: true });
  assert.equal(result.status, 200);
  assert.deepEqual(calls[0].body.tools, [{ googleSearch: {} }]);
  assert.equal(calls[0].body.generationConfig.responseMimeType, undefined);
  assert.equal(result.body.web_search.status, "failed");
});

test("required research rejects an answer without usable web evidence", async () => {
  const { token } = await linked();
  const result = await ask(token, { prompt: "QUESTION\nWhere can I find Simple Flour?", researchRequired: true });
  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
  assert.match(calls[0].body.systemInstruction.parts[0].text, /MUST use Google Search now/);
  assert.equal(result.body.web_search.status, "failed");
  assert.deepEqual(result.body.web_sources, []);
  assert.equal(result.body.answer, VERIFICATION_FAILED);
  assert.doesNotMatch(result.body.answer, /VanCleef/);
  assert.equal(env.DB.sqlite.prepare("SELECT actual_micro FROM answer_spend").get().actual_micro, 338);
});

test("required research lets a lone short question back through, but not a claim without a search (LOR-719)", async () => {
  const { token } = await linked();
  for (const [text, through] of [["Did you mean a wand?", true],
    ["Wands come from enchanters. Did you mean a wand?", false], ["Edwin VanCleef sells wands?\nAsk him.", false]]) {
    calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return Response.json({ candidates: [{ content: { parts: [{ text }] } }],
        usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 10 } });
    };
    const result = await ask(token, { prompt: "QUESTION\nhow do I get a want", researchRequired: true });
    assert.equal(result.body.answer, through ? text : VERIFICATION_FAILED, text);
    assert.equal(result.body.web_search.status, through ? "not_needed" : "failed");
  }
});

test("required research for a question item facts answer is answered from them, without a search", async () => {
  const { token } = await linked();
  const result = await ask(token, { prompt: "PLAYER CONTEXT\nfaction: Alliance\nzone: Ironforge\nQUESTION\nWhat are the stats on the Arcanite Reaper?",
    researchRequired: true });
  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, new RegExp(`${ANSWER_MODEL}:generateContent$`));
  assert.equal(calls[0].body.tools, undefined);
  assert.match(calls[0].body.systemInstruction.parts[0].text, /ITEM FACTS[^]*Arcanite Reaper: rare two-hand axe/);
  assert.notEqual(result.body.answer, VERIFICATION_FAILED);
  assert.equal(result.body.looked_up, "facts");
  // Companions keep a researched answer only with sources: the records the facts come from.
  assert.equal(result.body.web_search.status, "searched");
  assert.ok(result.body.web_sources.length > 0 && result.body.web_sources.every(s => s.url.startsWith("https://")));
  // Asked to look it up themselves, or about what the facts don't hold, it's researched.
  calls = [];
  await ask(token, { prompt: "QUESTION\nCan you search online for the Arcanite Reaper's stats?", researchRequired: true });
  assert.deepEqual(calls[0].body.tools, [{ googleSearch: {} }]);
});

test("required research for a spell question is answered from SPELL FACTS, Forever's numbers, without a search", async () => {
  const { token } = await linked();
  const result = await ask(token, { prompt: "PLAYER CONTEXT\nclass: Paladin\nlevel: 8\nQUESTION\nHow long does Seal of Righteousness last?",
    researchRequired: true });
  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.tools, undefined);
  assert.match(calls[0].body.systemInstruction.parts[0].text, /SPELL FACTS[^]*Seal of Righteousness \(Paladin spell, rank 1 of 8[^]*lasts 30 sec/);
  assert.equal(result.body.looked_up, "facts");
  assert.ok(result.body.web_sources.length > 0 && result.body.web_sources.every(s => s.url.startsWith("https://")));
});

test("required research a Forever fact covers is answered from it, with the client's tables as sources", async () => {
  const { token } = await linked();
  const result = await ask(token, { prompt: "PLAYER CONTEXT\nfaction: Alliance\nzone: Hillsbrad Foothills\nQUESTION\nWhere does the boat from Southshore go?",
    researchRequired: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.tools, undefined);
  assert.match(calls[0].body.systemInstruction.parts[0].text, /FOREVER FACTS[^]*Southshore/);
  assert.equal(result.body.looked_up, "facts");
  assert.equal(result.body.web_search.status, "searched");
  assert.ok(result.body.web_sources.some(s => s.url === "https://wago.tools/db2/TaxiPathNode"));
  // A fact with no source to show (one a player checked) leaves it to research.
  const { factSources } = await import("../lib/forever-knowledge.js");
  assert.deepEqual(factSources([{ id: "players-1", title: "Seen", source_url: "" }]), []);
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
    assert.equal(result.body.answer, VERIFICATION_FAILED);
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
  assert.ok(denied.body.error, "it says why");
  assert.equal(calls.length, ANSWERS_PER_DAY);
  const row = env.DB.sqlite.prepare("SELECT * FROM answer_spend").get();
  assert.equal(row.calls, ANSWERS_PER_DAY);
  assert.equal(row.reserved_micro, 125 * ANSWERS_PER_DAY, "successful calls release unused reservation");
  assert.equal(row.actual_micro, 125 * ANSWERS_PER_DAY);
  assert.equal(env.DB.sqlite.prepare("SELECT n FROM rate_limits WHERE user_id = ? AND bucket LIKE 'companion-answer:%'").get(user.id).n, ANSWERS_PER_DAY + 1);
  assert.equal(calls[0].body.tools, undefined);
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

const SAM_INTRO = "You are Sam the Squire, Lore Forever's herald, personal agent and squire.";
const WILLO_INTRO = "You are Willo, Lore Forever's companion: a small, warm, curious blue wisp of light who rides along beside the player, kind and loyal. You are always this wisp: you go wherever the player goes, with no post, duty, rank or home of your own to keep, and in play-acting you answer warmly and briefly as yourself.";
const system = n => calls[n].body.systemInstruction.parts[0].text;

test("persona willo swaps only the companion's introduction; anything else keeps Sam", async () => {
  const { token } = await linked();
  for (const persona of [undefined, "willo", "Willo", "constructor", 7]) assert.equal((await ask(token, { persona })).status, 200);
  assert.ok(system(0).startsWith(SAM_INTRO));
  assert.equal(system(1), system(0).replace(SAM_INTRO, WILLO_INTRO));
  for (const n of [2, 3, 4]) assert.equal(system(n), system(0), "unknown personas are ignored, not refused");
  await ask(token, { persona: "willo", operation: "character" });
  // The people of the world know nothing of who travels with the adventurer (Mike, 10/19): never Willo, never "ask her".
  assert.doesNotMatch(system(5), /\bWillo\b|suggest they ask|drifted aside/);
  assert.match(system(5), /never mention a companion, a wisp or a light at their shoulder, and never tell them to ask one\./);
  // In step with answer.py CHARACTER_SYSTEM: no one hands out a quest the player hasn't taken up (Mike, 10/14).
  assert.match(system(5), /current only if THE ADVENTURER carries it now.*Never give, offer or assign a task\./);
  assert.doesNotMatch(system(5), /\bSam\b/);
});

test("a character's reply never sends the adventurer to their wisp (Mike, 10/19)", async () => {
  const { token } = await linked();
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return Response.json({ candidates: [{ content: { parts: [{ text: "I do not know anyone by that name, traveler. " +
      "Perhaps your little wisp of light knows more than I do. Lok'tar, keep your eyes on the road." }] } }] });
  };
  const result = await ask(token, { persona: "willo", operation: "character" });
  assert.equal(result.body.answer, "I do not know anyone by that name, traveler. Lok'tar, keep your eyes on the road.");
});

test("spoken style shortens ordinary and character replies only", async () => {
  const { token } = await linked();
  const tokens = n => calls[n].body.generationConfig.maxOutputTokens;
  const spoken = await ask(token, { persona: "willo", style: "spoken" });
  // Willo's own answers are as long as the question needs (LOR-587); a character keeps two or three sentences.
  assert.match(system(0), /out loud/);
  assert.ok(system(0).indexOf("UNDERSTAND BEFORE ANSWERING") < system(0).search(/out loud/), "the rule, before the spoken rules");
  assert.ok(Number.isInteger(spoken.body.timing.model_ms) && Number.isInteger(spoken.body.timing.total_ms));
  await ask(token, { style: "spoken", operation: "character" });
  assert.match(system(1), /out loud[\s\S]*two or three short sentences/);
  await ask(token, { style: "spoken", researchRequired: true });
  await ask(token, { style: "loud" });
  for (const n of [2, 3]) assert.doesNotMatch(system(n), /this answer out loud/);
  assert.ok(tokens(0) < tokens(3) && tokens(1) < tokens(3), "spoken replies are kept shorter than written ones");
  // The character in front of them speaks in their people's dialect; the companion's own answers never do.
  assert.deepEqual([0, 1, 2, 3].map(n => /Your people's voice: .*\n- Dwarf: /s.test(system(n))), [false, true, false, false]);
});

// A stand-in JPEG: the site checks only its FF D8 FF start. 149,997 bytes is 199,996 base64 characters, just under the cap.
const jpeg = size => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size - 4, 7)]).toString("base64");
const PICTURE = /A picture of the player's game window/;
const parts = n => calls[n].body.contents[0].parts;

test("a spoken answer sends the player's picture to Gemini, and the allowance says the site takes one", async () => {
  const { token } = await linked();
  assert.equal((await ask(token, { method: "GET" })).body.allowance.pictures, true);
  const image = jpeg(149_997), prompt = "QUESTION\nWhat is this creature?";
  const result = await ask(token, { prompt, persona: "willo", style: "spoken", image });
  assert.equal(result.status, 200, "a body with a picture may pass the 64 KB text limit");
  assert.equal(result.body.allowance.pictures, true);
  assert.deepEqual(parts(0), [{ inlineData: { mimeType: "image/jpeg", data: image } }, { text: `${prompt}\n\n${CLARIFY_NOTE}` }]);
  assert.equal(calls[0].body.generationConfig.mediaResolution, "MEDIA_RESOLUTION_MEDIUM");
  assert.match(system(0), /Willo's words, .*anything after it\.\n\nA picture of the player's game window, .* never name a buff or spell from its icon alone\.$/);
  // On the sight model, at its prices, and what it held is what it settled.
  assert.match(calls[0].url, new RegExp(`/${SIGHT_MODEL}:generateContent$`));
  assert.equal(result.body.model, SIGHT_MODEL);
  const spend = env.DB.sqlite.prepare("SELECT reserved_micro, actual_micro FROM answer_spend").get();
  assert.deepEqual([spend.actual_micro, spend.reserved_micro], [125, 125], "200 tokens in at $0.25/M, 50 out at $1.50/M");
});

test("pictures outside spoken answers, or malformed ones, are ignored and the question is still answered", async () => {
  const { token } = await linked();
  const image = jpeg(3000);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");
  const cases = [{ image }, { style: "spoken", researchRequired: true, image }, { style: "spoken", operation: "character", image },
    ...[png, `data:image/jpeg;base64,${image}`, "/9j/" + "*".repeat(8), jpeg(150_003), 7].map(bad => ({ style: "spoken", image: bad }))];
  for (const fields of cases) assert.equal((await ask(token, fields)).status, 200, JSON.stringify(fields).slice(0, 80));
  for (let n = 0; n < cases.length; n++) {
    assert.equal(parts(n).length, 1);
    assert.equal(calls[n].body.generationConfig.mediaResolution, undefined);
    assert.doesNotMatch(system(n), PICTURE);
  }
  // A picture Gemini refuses is dropped: the question is asked again as text.
  calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    if (parts(calls.length - 1).length > 1) return new Response("Unable to process input image.", { status: 400 });
    return Response.json({ candidates: [{ content: { parts: [{ text: "A kobold." }] } }] });
  };
  const result = await ask(token, { style: "spoken", image });
  assert.deepEqual([result.status, result.body.answer, calls.length], [200, "A kobold.", 2]);
  assert.doesNotMatch(system(1), PICTURE);
  // Asked again as text, it's an ordinary answer on the ordinary model.
  assert.deepEqual([calls[0].url, calls[1].url].map(u => u.split("/models/")[1]),
    [`${SIGHT_MODEL}:generateContent`, `${ANSWER_MODEL}:generateContent`]);
  assert.equal(result.body.model, ANSWER_MODEL);
});

test("Mike's own and test accounts skip the daily cap but not the monthly budget", async () => {
  const { token, user } = await linked();
  const manual = await linked("manual");
  await env.DB.prepare("INSERT INTO excluded_accounts (user_id, reason, created) VALUES (?, 'admin', ''), (?, 'manual', '')")
    .bind(user.id, manual.user.id).run();
  for (let i = 0; i <= ANSWERS_PER_DAY; i++) {
    const result = await ask(token, { operation: i % 2 ? "character" : "answer" });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.deepEqual([result.body.allowance.unlimited, result.body.allowance.remaining], [true, ANSWERS_PER_DAY]);
  }
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM rate_limits WHERE user_id = ?").get(user.id).n, 0);
  const counted = await ask(manual.token);
  assert.deepEqual([counted.body.allowance.unlimited, counted.body.allowance.remaining], [undefined, ANSWERS_PER_DAY - 1]);
  const month = new Date().toISOString().slice(0, 7);
  await env.DB.prepare("INSERT INTO story_spend (month, micro_usd) VALUES (?, ?)").bind(month, paidBudgetMicro(env)).run();
  const before = calls.length;
  const full = await ask(token);
  assert.equal(full.status, 429);
  assert.match(full.body.error, /light.s spent for now/);
  assert.equal(calls.length, before);
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

test("monthly reservation shares the $100 estimated-spend gate with stories and voice", async (t) => {
  // The month's pool alone: a day's slice (lib/free-pool.js) bigger than it.
  env.FREE_DAILY_SLICE_USD = "1000";
  t.after(() => { delete env.FREE_DAILY_SLICE_USD; });
  const { token } = await linked();
  const month = new Date().toISOString().slice(0, 7);
  await env.DB.prepare("INSERT INTO story_spend (month, micro_usd, voice_micro_usd) VALUES (?, ?, ?)")
    .bind(month, paidBudgetMicro(env) - ANSWER_RESERVATION_MICRO - 1000, 1000).run();
  globalThis.fetch = async () => { calls.push({ failed: true }); return new Response("error", { status: 500 }); };
  const failed = await ask(token);
  assert.equal(failed.status, 502);
  assert.equal(failed.body.reason, "Gemini HTTP 500");     // for the companion's log (LOR-580)
  assert.equal((await ask(token)).status, 429);
  assert.equal(calls.length, 1);
  assert.equal(env.DB.sqlite.prepare("SELECT reserved_micro FROM answer_spend").get().reserved_micro, ANSWER_RESERVATION_MICRO);
  assert.equal(await storyBudgetLeft(env), false);
});

test("a failed answer gives back the day it was counted on, so the companion's second ask costs one answer", async () => {
  // LOR-673: a 502 kept the day's count, and the companion asks once more by itself (LOR-580): two answers for one.
  const { token, user } = await linked();
  const today = () => env.DB.sqlite.prepare("SELECT n FROM rate_limits WHERE user_id = ? AND bucket LIKE 'companion-answer:%'")
    .get(user.id)?.n ?? 0;
  const answering = globalThis.fetch;
  globalThis.fetch = async () => { calls.push({ failed: true }); return new Response("error", { status: 503 }); };
  const failed = await ask(token);
  assert.equal(failed.status, 502);
  assert.equal(today(), 0, "the failed answer kept the day's count");
  globalThis.fetch = answering;
  const again = await ask(token);
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(today(), 1);
  assert.equal(again.body.allowance.remaining, ANSWERS_PER_DAY - 1);
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
    assert.match(calls[0].url, new RegExp(`${ANSWER_MODEL}:generateContent$`));
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
    assert.equal(result.body.answer, VERIFICATION_FAILED);
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
    try { env.DB.sqlite.exec("DELETE FROM research_cache"); } catch { /* none yet */ }  // each case searches
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
  const queries = Array.from({ length: SEARCH_QUERY_RESERVATION + 12 }, (_, i) => `query ${i}`);
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
    assert.equal(result.body.answer, VERIFICATION_FAILED);
    assert.equal(result.body.web_search.status, "failed");
    const spent = env.DB.sqlite.prepare("SELECT reserved_micro FROM answer_spend").get().reserved_micro - before;
    assert.equal(spent, queries.length * ANSWER_GROUNDING_MICRO + 150 +
      RESEARCH_RESERVATION_MICRO - RESEARCH_RESERVATION_MICRO);
  }
  assert.equal(calls.length, 2, "required research never falls back after rejected output");
  assert.equal(env.DB.sqlite.prepare("SELECT actual_micro FROM answer_spend").get().actual_micro,
    2 * (queries.length * ANSWER_GROUNDING_MICRO + 150));
});


test("published January pricing changes Flash spend (research, a smarter plan's answers) while Flash-Lite rates stay fixed", async () => {
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
    // A smarter plan's answer (Legend's, on 3.6 Flash) is at research's token rates without the query, and so is its
    // answer to a picture; nothing of their holds is left over.
    assert.equal(await reserveAnswer(env, now, false, "answer", false, { smarter: true }), true);
    await writeAnswer(env, "Who is VanCleef?", now, false, "answer", { smarter: true });
    const smart = env.DB.sqlite.prepare("SELECT actual_micro, reserved_micro FROM answer_spend WHERE month = ?").get(month);
    assert.deepEqual([smart.actual_micro - ordinary.actual_micro, smart.reserved_micro - ordinary.reserved_micro],
      [researchCost - 14000, researchCost - 14000]);
    assert.equal(await reserveAnswer(env, now, false, "answer", false, { picture: true, smarter: true }), true);
    await writeAnswer(env, "What is this?", now, false, "answer", { style: "spoken", image: jpeg(3000), smarter: true });
    const seen = env.DB.sqlite.prepare("SELECT actual_micro, reserved_micro FROM answer_spend WHERE month = ?").get(month);
    assert.deepEqual([seen.actual_micro - smart.actual_micro, seen.reserved_micro - smart.reserved_micro],
      [researchCost - 14000, researchCost - 14000]);
    assert.equal(await reserveAnswer(env, now, false, "character"), true);
    await writeAnswer(env, "Who are you?", now, false, "character", { smarter: true });
    const character = env.DB.sqlite.prepare("SELECT actual_micro FROM answer_spend WHERE month = ?").get(month);
    assert.equal(character.actual_micro - seen.actual_micro, 125, "a character's reply stays at Flash-Lite's rates");
  }
});

test("knowledge over its bound keeps the blocks that fit, in order, never none", async () => {
  const { knowledgeWithin } = await import("../lib/companion-answers.js");
  const quest = "QUEST AND NPC FACTS:\n- one", place = "TOWN AND ROAD FACTS:\n- two", big = `FOREVER FACTS:\n- ${"x".repeat(80)}`;
  assert.equal(knowledgeWithin(`${quest}\n\n${place}`, 1000), `${quest}\n\n${place}`);
  assert.equal(knowledgeWithin(`${quest}\n\n${big}\n\n${place}`, 60), `${quest}\n\n${place}`);
  assert.equal(knowledgeWithin(`FACTS:\n- a\n- ${"y".repeat(50)}`, 20), "FACTS:\n- a");
});
