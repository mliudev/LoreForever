// Pinned spots through her answers (functions/api/companion/answer.js with lib/willo-pins.js, LOR-664), the quality
// bar's cases 15-17 and 28-30: "pin this spot" writes a line under Pins on this character's page with the game's place
// and day (only when Willo's app says where they stand: "spot now:"), and her "Pinned" line comes from what was written;
// with no spot nothing is written and she says why and how; renamed through notebook_update the place and day stay; a pin
// she doesn't have changes nothing; one changed on the Notebook tab is what she reads next.
// In-process on node:sqlite (helpers.mjs); Gemini is a stub. Run: node --test 'site/tests/*.test.mjs'
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequest as answer } from "../functions/api/companion/answer.js";
import { onRequest as notebookApi } from "../functions/api/notebook/[action].js";
import { findOrCreateUser, setup } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { NO_SPOT_LINE, NO_PIN_LINE } from "../lib/willo-pins.js";
import { ACTIONS_MAX_BYTES } from "../lib/companion-answers.js";
import { d1 } from "./helpers.mjs";

const env = { DB: d1(), GEMINI_API_KEY: "test-key" };
const originalFetch = globalThis.fetch;
let calls, reply;

beforeEach(async () => {
  await setup(env);
  env.DB.sqlite.exec("DELETE FROM notebook_pages");
  calls = [];
  reply = () => said("Hello, friend.");
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    return Response.json(reply(body));
  };
});
afterEach(() => { globalThis.fetch = originalFetch; });

let n = 0;
async function linked() {
  const sub = `pinner${++n}`;
  const user = await findOrCreateUser(env, { email: `${sub}@example.com`, googleSub: sub, name: sub });
  const link = await startLink(env);
  await decideLink(env, link.user_code, user, true);
  return { user, token: (await claimToken(env, link.device_code)).token };
}
const HURIN = "Húrin-ClassicBetaPvE";
const SPOT = "spot now: Fargodeep Mine, Elwynn Forest (map 41, 65), October 18\n";
const ask = async (token, question, { spot = SPOT } = {}) => (await answer({ env, request: new Request(
  "https://example.test/api/companion/answer", { method: "POST", headers: { "X-LF-Client": "companion/0.22.0",
    Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ prompt: `PLAYER CONTEXT\nzone: Elwynn Forest\nsub: Fargodeep Mine\n${spot}race: Human\n` +
    `class: Warrior\nlevel: 9\n\nSOURCES\n\nQUESTION\n${question}`, persona: "willo", notebook: { character: HURIN } }) }) })).json();
const usage = { usageMetadata: { promptTokenCount: 4000, candidatesTokenCount: 60 } };
const said = text => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }], ...usage });
const called = (name, args) => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ functionCall: { name, args } }] } }],
  ...usage });
const offered = body => (body.tools?.[0]?.functionDeclarations || []).map(d => d.name);
const page = (user, key) => env.DB.sqlite.prepare("SELECT body, version FROM notebook_pages WHERE user_id = ? AND page = ?")
  .get(user.id, key);
const LINE = "- the elite cave: the elite inside hits hard · Fargodeep Mine, Elwynn Forest (south, 41, 65) · October 18";

test("pin this spot: the game's place and day under Pins, and Pinned only once it's written", async () => {
  const { user, token } = await linked();
  reply = body => offered(body).includes("notebook_pin")
    ? called("notebook_pin", { answer: "I've pinned it at Jasperlode Mine!", name: "the elite cave",
      note: "the elite inside hits hard" }) : said("?");
  const res = await ask(token, "Pin this spot: the elite cave. The elite inside hits hard.");
  assert.equal(res.ok, true);
  // The model's "Jasperlode Mine" is never written or said: the place is the game's.
  assert.equal(res.answer, "Pinned: the elite cave, Fargodeep Mine in Elwynn Forest. The elite inside hits hard.");
  assert.equal(page(user, `char:${HURIN}`).body, `## Pins\n${LINE}\n`);
  assert.equal(res.notebook.change, "add");
  assert.equal(res.notebook.page, `char:${HURIN}`);
  // The pin tool and the notebook's own fit the offer's budget.
  const tools = calls[0].tools[0].functionDeclarations;
  assert.ok(new TextEncoder().encode(JSON.stringify(tools)).length <= ACTIONS_MAX_BYTES + 1024);
  assert.match(calls[0].systemInstruction.parts[0].text, /PINS: their pinned spots/);
});

test("pin with no spot from the game: nothing written, and she says why and how", async () => {
  const { user, token } = await linked();
  // Offered nothing to write with, she may still claim it: the site's line says what's true.
  reply = body => offered(body).length ? called("notebook_add", { answer: "Pinned!", kind: "note",
    items: ["the elite cave"], heading: "Pins" }) : said("Pinned! I've marked the elite cave for you.");
  const res = await ask(token, "Pin this spot: the elite cave", { spot: "" });
  assert.equal(res.answer, NO_SPOT_LINE);
  assert.equal(page(user, `char:${HURIN}`), undefined);
  assert.equal(offered(calls[0]).length, 0);
});

test("asked to pin, she answers without pinning: never a claim that she did", async () => {
  const { user, token } = await linked();
  reply = () => said("Pinned! I've saved this spot for you.");
  const res = await ask(token, "pin this spot");
  assert.doesNotMatch(res.answer, /pinned!|saved this spot/i);
  assert.equal(page(user, `char:${HURIN}`), undefined);
});

test("list, find, rename and remove: the notebook's lines, the place and day kept", async () => {
  const { user, token } = await linked();
  env.DB.sqlite.prepare("INSERT INTO notebook_pages (user_id, page, title, body, version, prev_body, updated) " +
    "VALUES (?, ?, ?, ?, 1, '', ?)").run(user.id, `char:${HURIN}`, "Húrin",
    `## Pins\n${LINE}\n- Hogger's hill · Elwynn Forest · October 2\n`, new Date().toISOString());
  // Listing and finding read the whole notebook, numbered, with the pins' rules.
  reply = () => said("You have two pins: the elite cave in Fargodeep Mine, and Hogger's hill in Elwynn Forest.");
  await ask(token, "What pins do I have?", { spot: "" });
  const system = calls.at(-1).systemInstruction.parts[0].text;
  assert.match(system, /the elite cave: the elite inside hits hard · Fargodeep Mine, Elwynn Forest \(south, 41, 65\)/);
  assert.match(system, /PINS: their pinned spots/);
  assert.equal(offered(calls.at(-1)).length, 0);
  // Renamed: the model's words name it; the place it made up doesn't stick.
  reply = body => {
    const n = /(\d+)\. the elite cave/.exec(body.systemInstruction.parts[0].text)[1];
    return called("notebook_update", { answer: "Renamed it!", item: Number(n), text: "Kobold den · Jasperlode Mine · October 1" });
  };
  const renamed = await ask(token, "Rename the elite cave pin to Kobold den", { spot: "" });
  assert.equal(renamed.answer, "Renamed it Kobold den: Fargodeep Mine in Elwynn Forest.");
  assert.match(page(user, `char:${HURIN}`).body,
    /^- Kobold den: the elite inside hits hard · Fargodeep Mine, Elwynn Forest \(south, 41, 65\) · October 18$/m);
  // Removed through the notebook's own tool.
  reply = body => {
    const n = /(\d+)\. Kobold den/.exec(body.systemInstruction.parts[0].text)[1];
    return called("notebook_remove", { answer: "Gone.", items: [Number(n)] });
  };
  const removed = await ask(token, "Remove the Kobold den pin", { spot: "" });
  assert.equal(removed.answer, "Unpinned: Kobold den, Fargodeep Mine in Elwynn Forest.");
  assert.doesNotMatch(page(user, `char:${HURIN}`).body, /Kobold den/);
  assert.match(page(user, `char:${HURIN}`).body, /Hogger's hill/);
});

test("removing a pin she doesn't have changes nothing", async () => {
  const { user, token } = await linked();
  env.DB.sqlite.prepare("INSERT INTO notebook_pages (user_id, page, title, body, version, prev_body, updated) " +
    "VALUES (?, ?, ?, ?, 1, '', ?)").run(user.id, `char:${HURIN}`, "Húrin", `## Pins\n${LINE}\n`, new Date().toISOString());
  reply = () => called("notebook_remove", { answer: "Gone.", items: [99] });
  const res = await ask(token, "Remove the Hogger pin", { spot: "" });
  assert.equal(res.answer, NO_PIN_LINE);
  assert.equal(page(user, `char:${HURIN}`).version, 1);
});

test("a pin changed in the Notebook tab is what she reads next", async () => {
  const { user, token } = await linked();
  const save = body => notebookApi({ env, params: { action: "save" }, request: new Request("https://example.test/api/notebook/save",
    { method: "POST", headers: { "X-LF-Client": "companion/0.22.0", Authorization: `Bearer ${token}`,
      "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const res = await save({ page: `char:${HURIN}`, version: 0,
    body: "## Pins\n- Mor'Ladim's crypt · Raven Hill Cemetery, Duskwood · October 12\n" });
  assert.equal(res.status, 200);
  reply = () => said("Mor'Ladim's crypt, at Raven Hill Cemetery in Duskwood.");
  await ask(token, "Where was the crypt I pinned?", { spot: "" });
  assert.match(calls.at(-1).systemInstruction.parts[0].text, /Mor'Ladim's crypt · Raven Hill Cemetery, Duskwood · October 12/);
});

test("what pins do I have: from this character's page, never another's pinned earlier in the same chat", async () => {
  const { user, token } = await linked();
  env.DB.sqlite.prepare("INSERT INTO notebook_pages (user_id, page, title, body, version, prev_body, updated) " +
    "VALUES (?, ?, ?, ?, 1, '', ?)").run(user.id, `char:${HURIN}`, "Húrin", `## Pins\n${LINE}\n`, new Date().toISOString());
  reply = () => said("You have one pin: the elite cave, at Fargodeep Mine.");
  const brynn = await (await answer({ env, request: new Request("https://example.test/api/companion/answer", { method: "POST",
    headers: { "X-LF-Client": "companion/0.22.0", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "PLAYER CONTEXT\nzone: Ironforge\n\nSOURCES\n\nRECENT CONVERSATION (oldest first)\n" +
      JSON.stringify([{ player: "Pin this spot: the elite cave.", willo: "Pinned: the elite cave, Fargodeep Mine in Elwynn Forest." }]) +
      "\n\nQUESTION\nWhat pins do I have?", persona: "willo", notebook: { character: "Brynn-ClassicBetaPvE" } }) }) })).json();
  assert.equal(brynn.answer, `Brynn has no pins yet. Say "pin this spot" where you stand, and I'll keep it.`);
  const hurin = await ask(token, "What pins do I have?", { spot: "" });
  assert.equal(hurin.answer, "One pin for Húrin: the elite cave in Fargodeep Mine, Elwynn Forest (south), October 18: the elite inside hits hard.");
});

test("clear all my pins: she asks once, and a yes takes this character's pins off, the rest of the page kept", async () => {
  const { user, token } = await linked();
  const body = `## To do\n- [ ] Linen cloth\n\n## Pins\n${LINE}\n- Hogger's hill · Forest's Edge, Elwynn Forest · October 2\n`;
  env.DB.sqlite.prepare("INSERT INTO notebook_pages (user_id, page, title, body, version, prev_body, updated) " +
    "VALUES (?, ?, ?, ?, 1, '', ?)").run(user.id, `char:${HURIN}`, "Húrin", body, new Date().toISOString());
  reply = () => said("I couldn't find that pin.");
  const asked = await ask(token, "Clear all my pins.", { spot: "" });
  assert.equal(asked.answer, "Both of Húrin's pins? Say yes and I'll take them off.");
  assert.equal(page(user, `char:${HURIN}`).version, 1);
  // The yes, with her question as the answer before it; the site's line alone, never the model's "Consider them gone"
  // after it (the vision session, 10/18).
  reply = () => said("Done! All cleared. Consider them gone, Húrin; your map is clean and ready for your next adventure.");
  const yes = await (await answer({ env, request: new Request("https://example.test/api/companion/answer", { method: "POST",
    headers: { "X-LF-Client": "companion/0.22.0", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "PLAYER CONTEXT\nzone: Stormwind City\n\nSOURCES\n\nRECENT CONVERSATION (oldest first)\n" +
      JSON.stringify([{ player: "Clear all my pins.", willo: asked.answer }]) + "\n\nQUESTION\nyes", persona: "willo",
      notebook: { character: HURIN } }) }) })).json();
  assert.equal(yes.answer, "Cleared Húrin's pins: the elite cave, Hogger's hill. Undo in the Notebook tab brings them back.");
  assert.equal(page(user, `char:${HURIN}`).body, "## To do\n- [ ] Linen cloth\n");   // and the Pins heading (LOR-686)
  assert.equal(yes.notebook.change, "remove");
  // Out loud too, where the notebook's view numbers only a few lines: every pin goes.
  env.DB.sqlite.prepare("UPDATE notebook_pages SET body = ? WHERE user_id = ? AND page = ?")
    .run(`## To do\n- [ ] Linen\n- [ ] Copper\n- [ ] Thread\n\n## Pins\n${LINE}\n- Hogger's hill · Forest's Edge, Elwynn Forest · October 2\n`, user.id, `char:${HURIN}`);
  const aloud = await (await answer({ env, request: new Request("https://example.test/api/companion/answer", { method: "POST",
    headers: { "X-LF-Client": "companion/0.22.0", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "PLAYER CONTEXT\nzone: Stormwind City\n\nSOURCES\n\nRECENT CONVERSATION (oldest first)\n" +
      JSON.stringify([{ player: "Clear all my pins.", willo: asked.answer }]) + "\n\nQUESTION\nyeah go ahead", persona: "willo",
      style: "spoken", notebook: { character: HURIN } }) }) })).json();
  assert.equal(aloud.answer, "Cleared Húrin's pins: the elite cave, Hogger's hill. Undo in the Notebook tab brings them back.");
  assert.doesNotMatch(page(user, `char:${HURIN}`).body, /elite cave|Hogger/);
  // A yes to anything else clears nothing.
  const other = await ask(token, "yes", { spot: "" });
  assert.notEqual(other.answer, yes.answer);
});

test("remember this spot, with the game's spot, is a pin, never a plain note", async () => {
  for (const q of ["Remember this spot.", "Remember this spot, the kobolds are nasty here.", "mark this place", "save this spot"]) {
    const { user, token } = await linked();
    calls = [];
    reply = body => offered(body).includes("notebook_add")
      ? called("notebook_add", { answer: "Tucked into your notes.", kind: "note", items: ["Fargodeep Mine, Elwynn Forest"] })
      : called("notebook_pin", { answer: "Pinned!", name: "Fargodeep Mine" });
    const res = await ask(token, q);
    assert.deepEqual(offered(calls[0]).filter(n => n !== "answer_only"), ["notebook_pin"], q);
    assert.match(res.answer, /^Pinned: Fargodeep Mine in Elwynn Forest\./, q);
    assert.match(page(user, `char:${HURIN}`).body, /^## Pins\n- Fargodeep Mine/, q);
  }
});
