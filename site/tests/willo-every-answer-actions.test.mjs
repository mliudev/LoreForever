// Her app's actions on every answer (LOR-844 step 3): on DeepSeek any question is offered what her app can do, so a
// request today's help words miss still gets its button, and only what the asking app says it runs
// (X-LF-Capabilities): an iPhone that lists nothing gets none, a PC that lists her grouped tools gets those.
// Together and Gemini are mocked through fetch; D1 is node:sqlite.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/companion/answer.js";
import { findOrCreateUser, setup } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { TOGETHER_URL, resetBreaker } from "../lib/together.js";
import { CUT_OFF_LINE } from "../lib/willo-tools.js";
import { d1 } from "./helpers.mjs";

const env = { DB: d1(), GEMINI_API_KEY: "test-key", TOGETHER_AI_API_KEY: "together-key",
  WILLO_ANSWER_HOST: "together:deepseek-ai/DeepSeek-V4.1-Flash" };
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
let together, asked;

beforeEach(async () => {
  resetBreaker();
  await setup(env);
  for (const table of ["devices", "device_links", "rate_limits", "answer_spend", "free_pool_days", "notebook_pages", "users"])
    env.DB.sqlite.exec(`DELETE FROM ${table}`);
  asked = [];
  together = () => calls("answer_only", { answer: "Hogger prowls the hills of Elwynn." });
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (String(url) === TOGETHER_URL) {
      asked.push({ to: "together", tools: (body.tools || []).map(t => t.function.name), choice: body.tool_choice });
      return together(body);
    }
    asked.push({ to: "gemini", tools: (body.tools?.[0]?.functionDeclarations || []).map(d => d.name), text: JSON.stringify(body.contents) });
    return Response.json({ candidates: [{ content: { parts: [{ text: "Hogger prowls the hills of Elwynn." }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 20 } });
  };
});
afterEach(() => { globalThis.fetch = originalFetch; });

async function linked() {
  const user = await findOrCreateUser(env, { email: "every@example.com", googleSub: "every", name: "every" });
  const link = await startLink(env);
  await decideLink(env, link.user_code, user, true);
  return (await claimToken(env, link.device_code)).token;
}
const ask = async (token, question, { client = "companion/0.30.0", caps = null, stock = null, state = "", more = {} } = {}) => {
  const res = await onRequest({ env, request: new Request("https://example.test/api/companion/answer", {
    method: "POST", headers: { "X-LF-Client": client, Authorization: `Bearer ${token}`, "Content-Type": "application/json",
      ...(caps === null ? {} : { "X-LF-Capabilities": caps }) },
    body: JSON.stringify({ prompt: `PLAYER CONTEXT\nzone: Westfall\nrace: Human\nclass: Warrior\nlevel: 14\n\n`
      + (state ? `WILLO STATE\n${state}\n\n` : "") + `SOURCES\n\nQUESTION\n${question}`,
      persona: "willo", ...(stock ? { stock } : {}), ...more }) }) });
  return (await res.text()).trim().split("\n").map(l => JSON.parse(l)).at(-1);
};

test("a request her help words miss still gets her Settings' button when she offers it", async () => {
  const token = await linked();
  together = () => calls("open_settings", { answer: "Pink it is, once you pick it in my colors.", section: "color" });
  const reply = await ask(token, "I'd like you to be pink");
  assert.equal(reply.action?.id, "open_settings");
  assert.equal(reply.action?.args?.section, "color");
  assert.match(reply.answer, /pink/i);
});

test("only what the asking app runs is offered: an iPhone that lists nothing gets no button", async () => {
  const token = await linked();
  together = () => calls("open_settings", { answer: "Your talk key is in my Settings.", section: "talk" });
  const reply = await ask(token, "Where do I change your talk key?", { client: "companion/ios-0.2.0" });
  assert.ok(!reply.action, JSON.stringify(reply.action));
  assert.ok(!asked[0].tools.includes("open_settings"), JSON.stringify(asked));
});

test("the game's own keybind never becomes her talk key, though she's offered it on every answer", async () => {
  const token = await linked();
  const caps = "actions/1 talk.on talk.off talk.key";
  // Her words came with the call ("F7 it is."), so she answers again with nothing called (the step 5 lab, 10/26: "Done,
  // F7 is your talk key now" stood with no key set).
  let tries = 0;
  together = () => ++tries === 1 ? calls("talk", { answer: "F7 it is.", op: "key", key: "f7" })
    : calls("answer_only", { answer: "Set that one in the game's own key bindings." });
  const potion = await ask(token, "set my healing potion to F7", { caps });
  assert.ok(!potion.action);
  assert.equal(tries, 2);
  assert.doesNotMatch(potion.answer, /F7 it is/);
  // Called again all the same, her words for it never say it's done.
  together = () => calls("talk", { answer: "F7 it is. Hold it and I'll listen.", op: "key", key: "f7" });
  const again = await ask(token, "set my healing potion to F7", { caps });
  assert.ok(!again.action);
  assert.doesNotMatch(again.answer, /F7 it is/);
  // Nor the game's chat for her chirps.
  together = () => calls("remarks", { answer: "Chirps off.", op: "chirps_off" });
  assert.ok(!(await ask(token, "stop the trade chat from chirping", { caps: `${caps} remarks.chirps_off` })).action);
  together = () => calls("talk", { answer: "F7 it is.", op: "key", key: "f7" });
  const asked = await ask(token, "move your talk key to F7", { caps });
  assert.deepEqual([asked.action?.id, asked.action?.args?.op, asked.action?.args?.key], ["talk", "key", "f7"]);
});

test("a plain ask of hers that Undo puts back is done at once, in her words; a question about it stays an offer", async () => {
  const token = await linked();
  const caps = "actions/1 remarks.level remarks.chirps_on remarks.chirps_off";
  together = () => calls("remarks", { answer: "Want me to turn my chirps off?", op: "chirps_off" });
  const done = await ask(token, "turn your chirps off", { caps });
  assert.deepEqual([done.action?.args?.op, done.action?.now], ["chirps_off", true]);
  assert.doesNotMatch(done.answer, /want me to/i);
  const asked = await ask(token, "do your chirps bother other players?", { caps });
  assert.ok(asked.action && !asked.action.now, JSON.stringify(asked.action));
  // A PC from before the list doesn't run it at once, so it's never told to.
  const old = await ask(token, "open your settings", { caps: "" });
  assert.ok(!old.action?.now, JSON.stringify(old.action));
});

test("a PC that lists her grouped tools gets them, and her call comes back as that operation", async () => {
  const token = await linked();
  together = () => calls("remarks", { answer: "I'll keep quiet while you play.", op: "level", level: "off" });
  const reply = await ask(token, "Stop chiming in while I play",
    { caps: "actions/1 open_settings remarks.level remarks.chirps_on remarks.chirps_off" });
  assert.deepEqual([reply.action?.id, reply.action?.args?.op, reply.action?.args?.level], ["remarks", "level", "off"]);
  // A PC from before the list (no actions/1) gets none of them.
  asked = [];
  const old = await ask(token, "Stop chiming in while I play", { caps: "game-screenshot-sharing game-screenshot-take" });
  assert.ok(!old.action && !asked[0].tools.includes("remarks"), JSON.stringify(asked));
});

test("on DeepSeek she reads their gear when her answer needs it; the Gemini fallback keeps today's words", async () => {
  const token = await linked();
  const stock = { t: Math.floor(Date.now() / 1000) - 600, level: 14, gear: { 16: [2489, "Two-Handed Sword"] },
    talents: [{ name: "Arms", points: 3, ranks: { "Deep Wounds": 3 } }] };
  const seen = [];
  together = body => {
    seen.push(JSON.stringify(body.messages));
    return seen.length === 1 ? calls("get_gear", {})
      : calls("answer_only", { answer: "Your Two-Handed Sword will carry you through the Deadmines." });
  };
  const reply = await ask(token, "am I ready for the Deadmines?", { stock });
  assert.equal(seen.length, 2);
  assert.doesNotMatch(seen[0], /Two-Handed Sword/i);
  assert.match(seen[1], /Two-Handed Sword/i);
  assert.match(reply.answer, /Two-Handed Sword/i);
  assert.ok(!reply.action, JSON.stringify(reply.action));
  // Asked plainly about their own (my sword), it's there at once: one ask, no read.
  seen.length = 0;
  together = body => { seen.push(JSON.stringify(body.messages)); return calls("answer_only", { answer: "Keep it." }); };
  await ask(token, "should I keep my sword?", { stock });
  assert.equal(seen.length, 1);
  assert.match(seen[0], /Two-Handed Sword/i);
  // Together down: Gemini is asked with the gear in PLAYER CONTEXT, as today.
  together = () => new Response("down", { status: 500 });
  asked = [];
  await ask(token, "am I ready for the Deadmines?", { stock });
  assert.match(asked.find(a => a.to === "gemini")?.text || "", /Two-Handed Sword/i);
});

test("the plans page is never her Settings: its own button where it runs, her words where it can't", async () => {
  const token = await linked();
  const caps = "actions/1 open_settings open_plans open_billing settings.open";
  // The Plans page when she's offered it, else her Settings, which she reached for 3 of 3 in the lab.
  together = body => (body.tools || []).some(t => t.function.name === "open_plans")
    ? calls("open_plans", { answer: "Here's the Plans page, from my window." })
    : calls("settings", { answer: "Opening my Settings: the plans card is in there.", op: "open", section: "account" });
  const off = await ask(token, "Take me to the plans page", { caps });
  assert.ok(!off.action, JSON.stringify(off.action));
  env.SITE_FEATURES = "plans";
  try {
    const on = await ask(token, "Take me to the plans page", { caps });
    assert.equal(on.action?.id, "open_plans", JSON.stringify(on.action));
  } finally { delete env.SITE_FEATURES; }
});

test("a spoken question cut off mid-sentence: her ask for the rest is never counted; an answer is", async () => {
  const token = await linked();
  const cut = { more: { style: "spoken", cut: true } };
  const remaining = reply => reply.allowance?.remaining;
  together = () => calls("ask_rest", { say: "Buy what, friend?" });
  const first = await ask(token, "where can I", cut);
  assert.match(first.answer, /buy what/i);
  const again = await ask(token, "where can I", cut);
  assert.equal(remaining(again), remaining(first));
  // A guess at who sells it is never her ask: today's line instead, uncounted too; first in her words, too.
  for (const say of ["Buy bronze tubes from Brog?", "Brog, perhaps?"]) {
    together = () => calls("ask_rest", { say });
    const guessed = await ask(token, "where can I buy", cut);
    assert.doesNotMatch(guessed.answer, /brog/i);
    assert.equal(remaining(guessed), remaining(first));
  }
  // Words that don't stop mid-sentence, whatever the app says: answered and counted, with no ask_rest offered.
  asked = [];
  together = () => calls("answer_only", { answer: "Hogger prowls the hills of Elwynn." });
  const whole = await ask(token, "where can I train?", cut);
  assert.equal(remaining(whole), remaining(first) - 1);
  assert.ok(!asked[0].tools.includes("ask_rest"), JSON.stringify(asked));
  // Together down: the Gemini fallback's rules are today's, its line, uncounted.
  together = () => new Response("down", { status: 500 });
  const down = await ask(token, "how do I get to the", cut);
  assert.equal(down.answer, CUT_OFF_LINE);
  assert.equal(remaining(down), remaining(whole));
});

test("a yes to her offer is taken only when their words answer it; a screenshot goes out on a short plain yes", async () => {
  const token = await linked();
  const voice = "your offer just now: Switch to Moonwell (set_voice)";
  let tries = 0;
  together = () => ++tries === 1 ? calls("offer_reply", { reply: "yes" })
    : calls("offer_reply", { reply: "about", answer: "Brave work against Hogger! Still want Moonwell's voice?" });
  const yes = await ask(token, "sure, why not", { state: voice });
  assert.equal(yes.offer, "yes", JSON.stringify(yes));
  assert.equal(tries, 1);
  // Their own news with a yes in it isn't a yes to the offer: she answers it and asks again.
  tries = 0;
  const news = await ask(token, "yes, I killed Hogger", { state: voice });
  assert.equal(news.offer, "about", JSON.stringify(news));
  assert.match(news.answer, /Hogger/i);
  // A yes refused, then a no on the next try: their news isn't a no to the offer either, so it stands.
  tries = 0;
  together = () => ++tries === 1 ? calls("offer_reply", { reply: "yes" }) : calls("offer_reply", { reply: "no" });
  const thenNo = await ask(token, "yes, I killed Hogger", { state: voice });
  assert.equal(thenNo.offer, "about", JSON.stringify(thenNo));
  // Taken as a yes on both tries: she still asks again, never says nothing.
  together = () => calls("offer_reply", { reply: "yes" });
  const twice = await ask(token, "yes, I killed Hogger", { state: voice });
  assert.equal(twice.offer, "about", JSON.stringify(twice));
  assert.match(twice.answer, /Moonwell/i);
  // A screenshot to a friend goes on a short plain yes; a longer one, or a question, is asked once more.
  const shot = "your offer just now: Send this screenshot to Bobby (capture_game_to_friend)";
  together = () => calls("offer_reply", { reply: "yes" });
  assert.equal((await ask(token, "yep send it", { state: shot })).offer, "yes");
  const unsure = await ask(token, "yes please, go ahead, send it now, thanks", { state: shot });
  assert.notEqual(unsure.offer, "yes", JSON.stringify(unsure));
});
