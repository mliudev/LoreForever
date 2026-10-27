// Her own tools on every answer (LOR-844 step 2): on DeepSeek she's offered the notebook's, goals' and pin's tools
// whatever the words, so a request today's word rules miss still gets written, checked by the notebook's own code; the
// Gemini fallback gets only what those rules chose; her words wait while she calls one, and go out early otherwise.
// Together and Gemini are mocked through fetch; D1 is node:sqlite.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/companion/answer.js";
import { findOrCreateUser, setup } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { TOGETHER_URL, resetBreaker } from "../lib/together.js";
import { d1 } from "./helpers.mjs";

const env = { DB: d1(), GEMINI_API_KEY: "test-key", TOGETHER_AI_API_KEY: "together-key",
  WILLO_ANSWER_HOST: "together:deepseek-ai/DeepSeek-V4.1-Flash" };
const originalFetch = globalThis.fetch;
const HURIN = "Húrin-ClassicBetaPvE";
const enc = new TextEncoder();
const sse = list => new Response(new ReadableStream({ start(c) {
  for (const e of list) c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
  c.enqueue(enc.encode("data: [DONE]\n\n"));
  c.close();
} }), { headers: { "Content-Type": "text/event-stream" } });
// Together calling one function with its arguments (her answer inside), in two pieces as it streams them.
const calls = (name, args) => {
  const json = JSON.stringify(args), cut = Math.floor(json.length / 2);
  return sse([{ choices: [{ delta: { tool_calls: [{ index: 0, function: { name, arguments: json.slice(0, cut) } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: json.slice(cut) } }] } }] },
    { choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 300, completion_tokens: 20 } }]);
};
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
    asked.push({ to: "gemini", tools: (body.tools?.[0]?.functionDeclarations || []).map(d => d.name) });
    return Response.json({ candidates: [{ content: { parts: [{ text: "Hogger prowls the hills of Elwynn." }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 20 } });
  };
});
afterEach(() => { globalThis.fetch = originalFetch; });

async function linked() {
  const user = await findOrCreateUser(env, { email: "own@example.com", googleSub: "own", name: "own" });
  const link = await startLink(env);
  await decideLink(env, link.user_code, user, true);
  return { user, token: (await claimToken(env, link.device_code)).token };
}
// Every line of the reply (her spoken words first, on a line of their own, when they go out early).
const ask = async (token, question, { turns = [], ...fields } = {}) => {
  const talk = turns.length ? `RECENT CONVERSATION (oldest first)\n${JSON.stringify(turns)}\n\n` : "";
  const res = await onRequest({ env, request: new Request("https://example.test/api/companion/answer", {
    method: "POST", headers: { "X-LF-Client": "companion/0.30.0", Authorization: `Bearer ${token}`,
      "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: `PLAYER CONTEXT\nzone: Westfall\nrace: Human\nclass: Warrior\nlevel: 14\n\n${talk}SOURCES\n\nQUESTION\n${question}`,
      persona: "willo", notebook: { character: HURIN }, ...fields }) }) });
  return (await res.text()).trim().split("\n").map(l => JSON.parse(l));
};
const page = user => env.DB.sqlite.prepare("SELECT body FROM notebook_pages WHERE user_id = ? AND page = ?")
  .get(user.id, `char:${HURIN}`)?.body || "";
const seed = (user, body) => env.DB.sqlite.prepare("INSERT INTO notebook_pages (user_id, page, title, body, version, " +
  "prev_body, updated) VALUES (?, ?, 'Húrin', ?, 1, '', ?)").run(user.id, `char:${HURIN}`, body, new Date().toISOString());

test("a request the word rules miss is written when she calls her notebook tool, and the site says what it wrote", async () => {
  const { user, token } = await linked();
  together = () => calls("notebook", { answer: "Noted: you owe Bobby five gold.", op: "add", kind: "note",
    items: ["Owe Bobby five gold"] });
  const reply = (await ask(token, "Put down that I owe Bobby five gold")).at(-1);
  assert.match(page(user), /Owe Bobby five gold/);
  assert.equal(reply.notebook?.change, "add");
  assert.match(reply.answer, /Bobby/);
  // No rule of the words matched, so she may answer in plain words (tool_choice auto), with no stand-in call.
  assert.deepEqual([asked[0].tools.includes("notebook"), asked[0].tools.includes("answer_only"), asked[0].choice],
    [true, false, "auto"], JSON.stringify(asked));
});

test("a plain question with no word of writing is never written down, whatever she calls", async () => {
  const { user, token } = await linked();
  const note = { answer: "Route to Westfall: through Goldshire. Written down.", kind: "note",
    items: ["Route to Westfall: through Goldshire"] };
  together = body => body.tools.some(t => t.function.name === "notebook_add") ? calls("notebook_add", note)
    : calls("notebook", { ...note, op: "add" });
  const reply = (await ask(token, "I'm actually Alliance. Can I still go there and how do I get there?")).at(-1);
  assert.equal(page(user), "");
  assert.doesNotMatch(reply.answer, /written down/i);
  // A question that asks for one is still written.
  await ask(token, "Can you jot down that the route to Westfall goes through Goldshire?");
  assert.match(page(user), /Route to Westfall/);
});

test("words the rules know keep exactly the rules' tools and the required call", async () => {
  const { user, token } = await linked();
  together = () => calls("notebook_add", { answer: "Noted: Thor.", kind: "note", items: ["Flight master: Thor"] });
  await ask(token, "Note that the flight master is Thor");
  assert.match(page(user), /Thor/);
  assert.deepEqual([asked[0].choice, asked[0].tools.includes("answer_only"), asked[0].tools.includes("notebook")],
    ["required", true, false], JSON.stringify(asked));
});

test("a line that says it's written, with nothing called, never stands", async () => {
  const { user, token } = await linked();
  together = () => sse([{ choices: [{ delta: { content: "Noted: Bobby is owed five gold." } }] },
    { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 300, completion_tokens: 20 } }]);
  const reply = (await ask(token, "Put down that I owe Bobby five gold")).at(-1);
  assert.equal(page(user), "");
  assert.doesNotMatch(reply.answer, /Noted:/i);
  // Nor a tick said done, with nothing ticked.
  seed(user, "## To do\n- [ ] Kill Hogger\n");
  together = () => sse([{ choices: [{ delta: { content: "The gnoll's down. Kill Hogger: ticked off." } }] },
    { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 300, completion_tokens: 20 } }]);
  const ticked = (await ask(token, "The big gnoll is finished")).at(-1);
  assert.match(page(user), /- \[ \] Kill Hogger/);
  assert.doesNotMatch(ticked.answer, /ticked off\./i);
});

test("lines are named by their NOTEBOOK numbers, and a line that isn't there is never changed", async () => {
  const { user, token } = await linked();
  seed(user, "## To do\n- [ ] Kill Hogger\n- [ ] Linen cloth\n");
  // "I killed Hogger, so he's done": no word of the rules', so only her tool ticks it.
  together = body => {
    const n = Number(/(\d+)\. \[ \] Kill Hogger/.exec(body.messages[0].content)[1]);
    return calls("notebook", { answer: "Ticked off: Hogger.", op: "check", lines: [n] });
  };
  await ask(token, "I killed Hogger, so he is done");
  assert.match(page(user), /- \[x\] Kill Hogger/);
  assert.match(page(user), /- \[ \] Linen cloth/);
  // A number for a line that shares no word with what they said: nothing changes.
  together = () => calls("notebook", { answer: "Gone.", op: "remove", lines: [2] });
  await ask(token, "Take the wolf pelts off my list");
  assert.match(page(user), /Linen cloth/);
});

test("a rename of a note that isn't there is never written as a new one: she offers it, and a yes adds it", async () => {
  const { user, token } = await linked();
  const body = "## Notes\n- The mage trainer is in the Mage Quarter\n";
  seed(user, body);
  together = request => request.tools.some(t => t.function.name === "notebook_add")
    ? calls("notebook_add", { answer: "Jotted down: Thor the gryphon master.", kind: "note", items: ["Thor the gryphon master"] })
    : calls("notebook", { answer: "Jotted down: Thor the gryphon master.", op: "add", kind: "note", items: ["Thor the gryphon master"] });
  const question = "Rename my Thor note to Thor the gryphon master";
  const reply = (await ask(token, question)).at(-1);
  assert.equal(page(user), body);
  assert.match(reply.answer, /Thor the gryphon master.*\?/);
  await ask(token, "Yes please", { turns: [{ player: question, willo: reply.answer }] });
  assert.match(page(user), /Thor the gryphon master/);
});

test("\"tick that one off\" is the line her last words named, never another", async () => {
  const { user, token } = await linked();
  seed(user, "## To do\n- [ ] Kill Hogger\n- [ ] Linen cloth\n- [ ] Visit the paladin trainer\n");
  const turns = [{ player: "What's left on my list?", willo: "Kill Hogger, linen cloth and the paladin trainer. The linen's the quickest." }];
  const naming = line => body => {
    const n = Number(new RegExp(`(\\d+)\\. \\[ \\] ${line}`).exec(body.messages[0].content)[1]);
    // The word rules' own tool when they chose it ("tick … off"), else her grouped one.
    return body.tools.some(t => t.function.name === "notebook_check")
      ? calls("notebook_check", { answer: "Ticked off.", items: [n] })
      : calls("notebook", { answer: "Ticked off.", op: "check", lines: [n] });
  };
  together = naming("Kill Hogger");
  await ask(token, "Tick that one off", { turns });
  assert.match(page(user), /- \[ \] Kill Hogger/);
  together = naming("Linen cloth");
  await ask(token, "Tick that one off", { turns });
  assert.match(page(user), /- \[x\] Linen cloth/);
  assert.match(page(user), /- \[ \] Kill Hogger/);
});

test("a line she names that their words don't goes back to her once; named again, she asks if it's that one, and a yes ticks it", async () => {
  const { user, token } = await linked();
  seed(user, "## To do\n- [ ] Kill Hogger\n- [ ] Linen cloth\n");
  together = body => {
    const n = Number(/(\d+)\. \[ \] Kill Hogger/.exec(body.messages[0].content)[1]);
    return calls("notebook", { answer: "Ticked off: Hogger.", op: "check", lines: [n] });
  };
  const question = "The big gnoll is dead, so he is done";
  const reply = (await ask(token, question)).at(-1);
  assert.equal(asked.filter(a => a.to === "together").length, 2);
  assert.match(page(user), /- \[ \] Kill Hogger/);
  assert.match(reply.answer, /Kill Hogger.*\?/i);
  await ask(token, "Yes", { turns: [{ player: question, willo: reply.answer }] });
  assert.match(page(user), /- \[x\] Kill Hogger/);
  assert.match(page(user), /- \[ \] Linen cloth/);
});

test("Together down: Gemini gets only what the word rules chose, so a miss writes nothing", async () => {
  const { user, token } = await linked();
  together = () => new Response("busy", { status: 503 });
  const reply = (await ask(token, "Put down that I owe Bobby five gold")).at(-1);
  assert.equal(page(user), "");
  assert.ok(!reply.notebook);
  const gemini = asked.find(a => a.to === "gemini");
  assert.ok(gemini && !gemini.tools.includes("notebook"), JSON.stringify(asked));
});

test("out loud: her words wait while she calls her own tool, and go out first when she only answers", async () => {
  const { user, token } = await linked();
  together = () => calls("notebook", { answer: "Noted: you owe Bobby five gold.\n~~~\nIt's on your page.", op: "add",
    kind: "note", items: ["Owe Bobby five gold"] });
  const writing = await ask(token, "Put down that I owe Bobby five gold", { style: "spoken", layers: 2 });
  assert.equal(writing.length, 1, "no early words while she writes");
  assert.match(page(user), /Bobby/);
  together = () => sse([{ choices: [{ delta: { content: "Hogger prowls the hills of Elwynn.\n~~~\n" } }] },
    { choices: [{ delta: { content: "He leads the gnolls there." } }] },
    { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 300, completion_tokens: 20 } }]);
  const plain = await ask(token, "Who is Hogger?", { style: "spoken", layers: 2 });
  assert.equal(plain.length, 2, "her words first");
  assert.match(plain[0].say, /Hogger/);
});

test("a reminder her plan doesn't keep is never faked: the site says so, and nothing is set", async () => {
  const { user, token } = await linked();
  env.SITE_FEATURES = "plans";
  try {
    together = () => calls("notebook", { answer: "I'll remind you when you reach Darkshire!", op: "remind", when: "place",
      place: "Darkshire", text: "Sell the wolf pelts" });
    // The first-run trial (lib/best-first.js) over, so the free plan has no reminders.
    env.DB.sqlite.prepare("INSERT OR REPLACE INTO best_first (claim, user_id, used, started) VALUES (?, ?, 20, ?)")
      .run(`taste:test-${user.id}`, user.id, new Date(Date.now() - 15 * 86400e3).toISOString());
    const reply = (await ask(token, "Give me a nudge about the wolf pelts once I'm in Darkshire")).at(-1);
    assert.doesNotMatch(reply.answer, /I'll remind you/i);
    assert.match(reply.answer, /\bHero\b|can't call that out/i);
    // (Its table comes with the first reminder kept.)
    const kept = env.DB.sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'reminders'").get()
      ? env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM reminders WHERE user_id = ?").get(user.id).n : 0;
    assert.equal(kept, 0);
  } finally { delete env.SITE_FEATURES; }
});

test("asked to hear their reminders in words the rules miss, the site says them from the notebook", async () => {
  const { token } = await linked();
  together = () => calls("notebook", { answer: "You've got three reminders!", op: "show", show: "reminders" });
  const reply = (await ask(token, "Is anything coming up that you'll tell me about?")).at(-1);
  assert.match(reply.answer, /no reminders/i);
  assert.match(reply.answer, /Húrin/);
});

test("a long notebook still shows her the line they name, so it can be ticked off", async () => {
  const { user, token } = await linked();
  const filler = Array.from({ length: 200 }, (_, i) => `- [ ] Bring the quartermaster bundle number ${i + 1} of cloth`);
  seed(user, `## Errands\n${filler.join("\n")}\n- [ ] Kill Hogger in Elwynn\n`);
  // She ticks the line by its number in NOTEBOOK, when it's there.
  together = body => {
    const n = /(\d+)\. \[ \] Kill Hogger/.exec(JSON.stringify(body.messages))?.[1];
    if (!n) return calls("answer_only", { answer: "I don't see that one." });
    return (body.tools || []).some(t => t.function.name === "notebook")
      ? calls("notebook", { answer: "Ticked off.", op: "check", lines: [Number(n)] })
      : calls("notebook_check", { answer: "Ticked off.", items: [Number(n)] });
  };
  await ask(token, "tick off the Hogger one");
  assert.match(page(user), /\[x\] Kill Hogger/);
  // Asked out loud only to hear it (on Gemini alone, which reads the short list): "and N more" is of the whole page.
  const host = env.WILLO_ANSWER_HOST, sent = [], mocked = globalThis.fetch;
  delete env.WILLO_ANSWER_HOST;
  globalThis.fetch = async (url, options) => { sent.push(options.body); return mocked(url, options); };
  try { await ask(token, "what's on my list?", { style: "spoken" }); } finally { env.WILLO_ANSWER_HOST = host; }
  const body = JSON.parse(sent.at(-1));
  const text = [body.systemInstruction, ...body.contents].map(c => c.parts.map(p => p.text || "").join("\n")).join("\n");
  const open = Number(/\((\d+) open to-dos/.exec(text)?.[1]), more = Number(/\((\d+) more not shown/.exec(text)?.[1]);
  const shown = (text.match(/^\d+\. \[ \] /gm) || []).length;
  assert.ok(shown > 0);
  assert.equal(more + shown, open);
});
