// Willo's notebook (lib/willo-notebook.js, /api/notebook/*, and her answers' notebook tools in
// functions/api/companion/answer.js): she writes in it only when the player asks (asked, so written; not asked, so
// untouched), tidily, on the right page; she reads it when asked and when a line bears on the question; the Notebook
// tab's hand edits never overwrite a newer page; Undo; the markdown export; and "Delete my account" takes every page.
// In-process on node:sqlite (helpers.mjs); Gemini is a stub. Run: node --test 'site/tests/*.test.mjs'
import { test, beforeEach, afterEach } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { onRequest as answer } from "../functions/api/companion/answer.js";
import { onRequest as notebookApi } from "../functions/api/notebook/[action].js";
import { findOrCreateUser, setup, deleteUser } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { notebookIntent, notebookView, notebookTools, notebookCall, applyOp, tidy, cleanItem, pageOf, plannedChange, confirmed,
  UNSAVED_LINE, placeKey, REMIND_RULES, REMIND_PLAN_RULE, namedLines, namedLine, reminderLines, reminderLine, withRest, noMoment, unclaimed, saidYes,
  NOTEBOOK_MAX_BYTES, NOT_FOUND_LINE, NOTEBOOK_RULES, ACCOUNT_PAGE } from "../lib/willo-notebook.js";
import { ACTIONS_MAX_BYTES } from "../lib/companion-answers.js";
import { helpTopics, helpBlock } from "../lib/willo-help.js";
import { d1 } from "./helpers.mjs";

// Her line for a change: one of her lines for it (namedLines, reminderLines: each names exactly what was written), then
// whatever else she said that claims nothing.
const hers = (answer, lines, rest = "") => assert.ok(lines.some(l => answer === (rest ? `${l} ${rest}` : l)),
  `${answer}\n  is none of: ${lines.join(" | ")}`);
const todo = { op: "add", kind: "todo" };

// The site's own files (the lore library's place names, for reminders), as Pages serves them.
const env = { DB: d1(), GEMINI_API_KEY: "test-key", ASSETS: { fetch: async request =>
  new Response(readFileSync(new URL(`../public${new URL(request.url).pathname}`, import.meta.url))) } };
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
  const sub = `noter${++n}`;
  const user = await findOrCreateUser(env, { email: `${sub}@example.com`, googleSub: sub, name: sub });
  const link = await startLink(env);
  await decideLink(env, link.user_code, user, true);
  return { user, token: (await claimToken(env, link.device_code)).token };
}
const HURIN = "Húrin-ClassicBetaPvE";
const ask = async (token, question, extra = {}) => (await answer({ env, request: new Request(
  "https://example.test/api/companion/answer", { method: "POST", headers: { "X-LF-Client": "companion/0.22.0",
    Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ prompt: `PLAYER CONTEXT\nzone: Elwynn Forest\nrace: Human\nclass: Warrior\nlevel: 9\n\n` +
    `SOURCES\n\nQUESTION\n${question}`, persona: "willo", notebook: { character: HURIN }, ...extra }) }) })).json();
const usage = { usageMetadata: { promptTokenCount: 4000, candidatesTokenCount: 60 } };
const said = text => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }], ...usage });
const called = (name, args) => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ functionCall: { name, args } }] } }],
  ...usage });
const offered = body => (body.tools?.[0]?.functionDeclarations || []).map(d => d.name);
const page = (user, key) => env.DB.sqlite.prepare("SELECT body, version, prev_body FROM notebook_pages WHERE user_id = ? AND page = ?")
  .get(user.id, key);
const api = async (token, action, body) => {
  const method = body === undefined ? "GET" : "POST";
  const res = await notebookApi({ env, params: { action }, request: new Request(`https://example.test/api/notebook/${action}`,
    { method, headers: { "X-LF-Client": "companion/0.22.0", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(body) }) });
  return { status: res.status, body: res.headers.get("Content-Type")?.startsWith("text/markdown") ? await res.text() : await res.json() };
};

// ---- Asked, so written; not asked, so untouched ----

const ASKED = [
  "remember I need 10 linen cloth for my bags", "add Hogger to my list", "tick off the Defias quest",
  "note that the flight master in Sentinel Hill is Thor", "Can you remember that my bank alt is Bob?",
  "remind me to buy linen in Goldshire", "cross Hogger off", "mark the Defias quest as done",
  "take Hogger off my list", "make a note: Thor is the flight master", "put 5 copper bars on the shopping list",
  "I want you to remember my hearthstone is in Goldshire", "jot down that Thor flies to Stormwind",
  "change the linen line on my list to 12", "don't let me forget the Defias quest",
  "note for all my characters that my bank alt is Bobby", "Willo, note: Thor is the flight master",
];
const NOT_ASKED = [
  "Who is Hogger?", "Do you remember Arthas?", "remind me who Hogger is", "where can I buy linen cloth?",
  "I need 10 linen cloth", "what should I put in my bags?", "what to do in Westfall", "I remember when Stormwind burned",
  "what's on my to-do?", "what did I ask you to remember?", "Tell me about the Defias Brotherhood", "Hi Willo!",
  "how do I note things in the game?", "Note how the Defias came to be",
];

test("only a question that asks her to write in the notebook gets its tools", () => {
  for (const q of ASKED) assert.equal(notebookIntent(q).write, true, q);
  for (const q of NOT_ASKED) assert.equal(notebookIntent(q).write, false, q);
  // Asking what's in it reads it, all of it, without writing.
  for (const q of ["what's on my to-do?", "what's left on my list?", "what did I ask you to remember?", "read me my notes"])
    assert.deepEqual(notebookIntent(q), { write: false, read: true, remind: false }, q);
  assert.equal(notebookIntent("put that at the top").move, true);
  // A yes to her offer to put it on their list writes it; a yes to anything else doesn't.
  assert.equal(notebookIntent("yes please", "I can't call that out yet. Want me to put it on your list instead?").write, true);
  assert.equal(notebookIntent("yes", "Hogger lurks at Forest's Edge. Want the way there?").write, false);
});

test("asked, she writes: the line goes on this character's page, under To do, and the reply carries the page", async () => {
  const { user, token } = await linked();
  reply = () => called("notebook_add", { answer: "Noted: ten linen cloth for your bags.", kind: "todo",
    items: ["10 Linen Cloth for bags"] });
  const out = await ask(token, "remember I need 10 linen cloth for my bags");
  assert.equal(out.ok, true);
  // Her line is the site's, from what it wrote (the quality owner's rule, 10/18), never the model's claim.
  hers(out.answer, namedLines(todo, ["10 Linen Cloth for bags"], `char:${HURIN}`));
  assert.equal(out.notebook.change, "add");
  assert.equal(out.notebook.page, `char:${HURIN}`);
  assert.equal(out.notebook.title, "Húrin");
  assert.equal(out.notebook.body, "## To do\n- [ ] 10 Linen Cloth for bags\n");
  assert.deepEqual(out.notebook.changed, ["10 Linen Cloth for bags"]);
  assert.ok(out.lookups.includes("notebook"));
  assert.equal(page(user, `char:${HURIN}`).body, "## To do\n- [ ] 10 Linen Cloth for bags\n");
  // Offered as the answer's required call (lib/companion-answers.js geminiActions), with the notebook's rule instead
  // of the app's actions' one, and nothing to look up or look at for a note.
  const [body] = calls;
  assert.deepEqual(offered(body), ["notebook_add", "answer_only"]);
  assert.match(body.systemInstruction.parts[0].text, /THE NOTEBOOK: you keep/);
  assert.doesNotMatch(body.systemInstruction.parts[0].text, /WILLO ACTIONS/);
  assert.equal(body.tools.some(t => t.googleSearch), false);
});

test("not asked, she can't write: no tools are offered, and a stray call changes nothing", async () => {
  const { user, token } = await linked();
  env.DB.sqlite.prepare("INSERT INTO notebook_pages (user_id, page, title, body, version, updated) VALUES (?, ?, 'Húrin', ?, 1, '')")
    .run(user.id, `char:${HURIN}`, "## To do\n- [ ] Hogger\n");
  for (const q of NOT_ASKED) {
    calls = [];
    // A model can only call what it's offered, and nothing is.
    reply = body => body.tools ? called("notebook_add", { answer: "Hogger is a gnoll chieftain.", kind: "todo",
      items: ["Kill Hogger"] }) : said("Hogger is a gnoll chieftain.");
    const out = await ask(token, q);
    assert.equal(out.ok, true, q);
    assert.equal(out.notebook, undefined, q);
    assert.equal(offered(calls[0]).some(name => name.startsWith("notebook_")), false, q);
    assert.doesNotMatch(calls[0].systemInstruction.parts[0].text, /THE NOTEBOOK/, q);
  }
  assert.equal(page(user, `char:${HURIN}`).body, "## To do\n- [ ] Hogger\n");
  assert.equal(page(user, `char:${HURIN}`).version, 1);
  // And a call to a tool that wasn't offered is no change.
  const view = notebookView([], { intent: { write: false, read: true } });
  assert.equal(notebookCall({ name: "notebook_add", args: { kind: "todo", items: ["Kill Hogger"] } }, [], view), null);
});

test("she reads it: all of it when asked, a line that shares a word with the question otherwise, else nothing", async () => {
  const { user, token } = await linked();
  env.DB.sqlite.prepare("INSERT INTO notebook_pages (user_id, page, title, body, version, updated) VALUES (?, ?, 'Húrin', ?, 1, '')")
    .run(user.id, `char:${HURIN}`, "## To do\n- [ ] 10 Linen Cloth for bags\n- [x] Hogger\n\n## Notes\n- Flight master in Sentinel Hill: Thor\n");
  env.DB.sqlite.prepare("INSERT INTO notebook_pages (user_id, page, title, body, version, updated) VALUES (?, ?, 'All characters', ?, 1, '')")
    .run(user.id, ACCOUNT_PAGE, "- Bank alt: Bobby\n");
  const system = () => calls[calls.length - 1].systemInstruction.parts[0].text;
  await ask(token, "what's on my to-do?");
  assert.match(system(), /NOTEBOOK \(the player's own notebook/);
  // With its exact counts, so "what's left?" is never miscounted (the blind check, cases 4 and 17).
  assert.match(system(), /\[Their list for Húrin\] \(1 open to-do, 1 ticked off, 1 note\)\n## To do\n1\. \[ \] 10 Linen Cloth for bags\n2\. \[x\] Hogger/);
  assert.match(system(), /\[Their list for all their characters\] \(1 note\)\n4\. Bank alt: Bobby/);
  assert.deepEqual(offered(calls[0]), []);           // read, never written
  await ask(token, "where can I buy linen cloth?");
  assert.match(system(), /FROM THEIR NOTEBOOK[^\n]*\n- \[ \] 10 Linen Cloth for bags$/m);
  assert.doesNotMatch(system(), /Hogger|Bobby|Thor/);
  await ask(token, "Tell me about the Defias Brotherhood");
  assert.doesNotMatch(system(), /NOTEBOOK/);
  // A character answering in person never reads it.
  await ask(token, "Where's the linen?", { operation: "character" });
  assert.doesNotMatch(system(), /NOTEBOOK/);
});

test("tick off, change and take off name lines by their number; one she can't find leaves the page as it was", async () => {
  const { user, token } = await linked();
  const key = `char:${HURIN}`;
  env.DB.sqlite.prepare("INSERT INTO notebook_pages (user_id, page, title, body, version, updated) VALUES (?, ?, 'Húrin', ?, 1, '')")
    .run(user.id, key, "## To do\n- [ ] 10 Linen Cloth for bags\n- [ ] Hogger\n- [ ] The Defias Brotherhood\n");
  reply = () => called("notebook_check", { answer: "Ticked off. Hogger won't trouble Elwynn again.", items: [2] });
  let out = await ask(token, "tick off Hogger");
  assert.deepEqual(offered(calls[0]), ["notebook_add", "notebook_check", "notebook_update", "notebook_remove", "answer_only"]);
  assert.equal(out.notebook.body, "## To do\n- [ ] 10 Linen Cloth for bags\n- [x] Hogger\n- [ ] The Defias Brotherhood\n");
  assert.equal(page(user, key).version, 2);
  reply = () => called("notebook_update", { answer: "Changed to twelve.", item: 1, text: "12 Linen Cloth for bags" });
  out = await ask(token, "change the linen line on my list to 12");
  assert.equal(page(user, key).body, "## To do\n- [ ] 12 Linen Cloth for bags\n- [x] Hogger\n- [ ] The Defias Brotherhood\n");
  reply = () => called("notebook_remove", { answer: "Taken off.", items: [3] });
  out = await ask(token, "take the Defias quest off my list");
  assert.equal(page(user, key).body, "## To do\n- [ ] 12 Linen Cloth for bags\n- [x] Hogger\n");
  reply = () => called("notebook_check", { answer: "Ticked off!", items: [9] });
  out = await ask(token, "tick off the Stockades");
  assert.equal(out.answer, NOT_FOUND_LINE);
  assert.equal(out.notebook, undefined);
  assert.equal(page(user, key).version, 4);
});

test("the account's page when they say so, or when no character is known (the iPhone, an older companion)", async () => {
  const { user, token } = await linked();
  reply = () => called("notebook_add", { answer: "Noted for all your characters.", kind: "note", items: ["Bank alt: Bobby"],
    page: "account" });
  let out = await ask(token, "note for all my characters that my bank alt is Bobby");
  assert.equal(out.notebook.page, ACCOUNT_PAGE);
  assert.equal(page(user, ACCOUNT_PAGE).body, "## Notes\n- Bank alt: Bobby\n");
  // With no character, the page choice isn't offered and it's the account's.
  reply = body => {
    assert.equal(body.tools[0].functionDeclarations[0].parameters.properties.page, undefined);
    return called("notebook_add", { answer: "Noted.", kind: "todo", items: ["Hearthstone to Goldshire"] });
  };
  out = await ask(token, "remember to set my hearthstone to Goldshire", { notebook: undefined });
  assert.equal(out.notebook.page, ACCOUNT_PAGE);
  assert.equal(page(user, ACCOUNT_PAGE).body, "## Notes\n- Bank alt: Bobby\n\n## To do\n- [ ] Hearthstone to Goldshire\n");
});

test("the answer log keeps which tool ran, never the notebook", async () => {
  const { user, token } = await linked();
  env.DB.sqlite.prepare("INSERT INTO notebook_pages (user_id, page, title, body, version, updated) VALUES (?, ?, 'Húrin', ?, 1, '')")
    .run(user.id, `char:${HURIN}`, "## Notes\n- My secret stash is under the Lion's Pride Inn\n");
  reply = () => called("notebook_add", { answer: "Noted.", kind: "todo", items: ["Hogger"] });
  await ask(token, "add Hogger to my list", { keep: true });
  const row = env.DB.sqlite.prepare("SELECT * FROM answer_log ORDER BY id DESC LIMIT 1").get();
  assert.equal(row.action, "notebook_add");
  assert.doesNotMatch(JSON.stringify(row), /stash|Lion's Pride/);
});

test("a change worked out on an older page is written again on the newer one, by its words", async () => {
  const { user } = await linked();
  const key = `char:${HURIN}`;
  env.DB.sqlite.prepare("INSERT INTO notebook_pages (user_id, page, title, body, version, updated) VALUES (?, ?, 'Húrin', ?, 1, '')")
    .run(user.id, key, "## To do\n- [ ] Hogger\n");
  const view = notebookView([{ page: key, title: "Húrin", body: "## To do\n- [ ] Hogger\n", version: 1 }],
    { current: key, intent: { write: true, read: true } });
  view.question = "tick off Hogger";
  const change = notebookCall({ name: "notebook_check", args: { items: [1] } }, notebookTools(view), view);
  const planned = plannedChange(view, user.id, change);
  // Meanwhile a hand edit from another device.
  env.DB.sqlite.prepare("UPDATE notebook_pages SET body = ?, version = 2 WHERE user_id = ? AND page = ?")
    .run("## To do\n- [ ] Linen\n- [ ] Hogger\n", user.id, key);
  const saved = await planned.write(env);
  assert.equal(saved.version, 3);
  assert.equal(page(user, key).body, "## To do\n- [ ] Linen\n- [x] Hogger\n");
});

// ---- The Notebook tab's API ----

test("the tab reads every page, saves a hand edit as written, refuses a stale one, and undoes the last change", async () => {
  const { token } = await linked();
  const key = `char:${HURIN}`;
  let res = await api(token, "save", { page: HURIN, body: "# Plans\r\n\r\n- [ ] Westfall   \n", version: 0 });
  assert.equal(res.status, 200);
  assert.deepEqual({ ...res.body.page, updated: undefined }, { page: key, title: "Húrin", body: "# Plans\n\n- [ ] Westfall   \n",
    version: 1, updated: undefined, undo: true });
  // Saved over a version they didn't see: refused, with the newer page.
  res = await api(token, "save", { page: key, body: "older", version: 0 });
  assert.equal(res.status, 409);
  assert.equal(res.body.page.version, 1);
  res = await api(token, "save", { page: key, body: "# Plans\n\n- [x] Westfall\n", version: 1 });
  assert.equal(res.body.page.version, 2);
  res = await api(token, "undo", { page: key, version: 2 });
  assert.equal(res.body.page.body, "# Plans\n\n- [ ] Westfall   \n");
  assert.equal(res.body.page.version, 3);
  assert.equal((await api(token, "undo", { page: key, version: 2 })).status, 409);
  await api(token, "save", { page: "account", body: "- Bank alt: Bobby\n", version: 0 });
  res = await api(token, "pages");
  assert.deepEqual(res.body.pages.map(p => p.page), ["account", key]);
  // Their copy, as one markdown file.
  res = await api(token, "export");
  assert.match(res.body, /^# Willo's notebook\n/);
  assert.match(res.body, /# All characters\n\n- Bank alt: Bobby\n/);
  assert.match(res.body, /# Húrin \(ClassicBetaPvE\)\n\n# Plans\n\n- \[ \] Westfall/);
  // Too long, an unknown page, and a page gone.
  assert.equal((await api(token, "save", { page: key, body: "x".repeat(17000), version: 3 })).status, 413);
  assert.equal((await api(token, "save", { page: "char:no", body: "x", version: 0 })).status, 400);
  res = await api(token, "delete", { page: key });
  assert.deepEqual(res.body.pages.map(p => p.page), ["account"]);
});

test("only the account's own pages, only signed in, and Delete my account takes them all", async () => {
  const a = await linked(), b = await linked();
  await api(a.token, "save", { page: "account", body: "mine\n", version: 0 });
  assert.deepEqual((await api(b.token, "pages")).body.pages, []);
  assert.equal((await api("not-a-token", "pages")).status, 401);
  await deleteUser(env, a.user);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM notebook_pages WHERE user_id = ?").get(a.user.id).n, 0);
});

// ---- The markdown ----

test("Willo's writing is tidy: one heading per list, no doubles, a blank line between lists", () => {
  let body = "";
  body = applyOp(body, { op: "add", kind: "todo", items: ["10 Linen Cloth for bags"] }).body;
  body = applyOp(body, { op: "add", kind: "note", items: ["Flight master in Sentinel Hill: Thor"] }).body;
  const again = applyOp(body, { op: "add", kind: "todo", items: ["Hogger", "10 linen cloth for bags"] });
  assert.deepEqual(again.changed, ["Hogger"]);
  assert.equal(again.body, "## To do\n- [ ] 10 Linen Cloth for bags\n- [ ] Hogger\n\n## Notes\n- Flight master in Sentinel Hill: Thor\n");
  // A list of the player's own ("TODO list" is To do), and a heading she's asked for.
  body = applyOp("My plans\n\n# TODO list\n* [ ] Westfall\n\n# Other\nstuff\n", { op: "add", kind: "todo", items: ["Duskwood"] }).body;
  assert.equal(body, "My plans\n\n# TODO list\n* [ ] Westfall\n- [ ] Duskwood\n\n# Other\nstuff\n");
  body = applyOp(body, { op: "add", kind: "note", items: ["Flame cloth"], heading: "Tailoring" }).body;
  assert.match(body, /\n\n## Tailoring\n- Flame cloth\n$/);
  assert.equal(tidy("\n\n# A\n\n\n- x   \n\n\n\n# B\n"), "# A\n- x\n\n# B\n");
  assert.equal(cleanItem("- [ ] Buy  linen\nnow"), "Buy linen now");
  assert.equal(cleanItem("## Heading"), "Heading");
  assert.equal(pageOf("Húrin-ClassicBetaPvE"), "char:Húrin-ClassicBetaPvE");
  assert.equal(pageOf("char:../../x"), null);
  assert.equal(pageOf("Húrin"), null);
});

test("a long notebook fits its room in the prompt, open lines first; the tools fit the actions' room", () => {
  const body = "## To do\n" + Array.from({ length: 200 }, (_, i) => `- [${i % 2 ? "x" : " "}] Line number ${i} of a long list`).join("\n");
  const view = notebookView([{ page: ACCOUNT_PAGE, body, version: 1 }], { intent: { write: true, read: true } });
  assert.ok(new TextEncoder().encode(view.block).length <= NOTEBOOK_MAX_BYTES);
  assert.match(view.block, /\(more in the notebook\)$/);
  assert.doesNotMatch(view.block, /\[x\]/);
  for (const [, ref] of view.refs) assert.ok(view.block.includes(ref.text));
  // Past ACTIONS_MAX_BYTES the answer would be offered none (lib/companion-answers.js writeAnswer).
  assert.ok(JSON.stringify(notebookTools({ ...view, current: "char:A-B" }, { move: true })).length <= ACTIONS_MAX_BYTES);
  assert.match(NOTEBOOK_RULES, /one short line/);
});

test("she knows her notebook: asked about it, her help says what she writes and when, and where the tab is", () => {
  for (const q of ["Willo, do you have a notebook?", "can you keep a to-do list for me?", "can you take notes for me?"])
    assert.ok(helpTopics(q).includes("notebook"), q);
  for (const q of ["add Hogger to my list", "Who is Hogger?", "make a list of dungeons in Westfall"])
    assert.equal(helpTopics(q).includes("notebook"), false, q);
  assert.match(helpBlock("do you have a notebook?", { client: "companion/0.22.0" }), /never write in it unasked[^]*Notebook tab/);
});

test("a new heading only where the player named one: otherwise To do or Notes", () => {
  const view = (question, body = "") => notebookView([{ page: ACCOUNT_PAGE, body, version: 1 }],
    { intent: { write: true, read: true }, question });
  const add = (question, heading, body) => {
    const v = view(question, body);
    return notebookCall({ name: "notebook_add", args: { kind: "note", items: ["x"], heading } }, notebookTools(v), v).op.heading;
  };
  // Flash-Lite's pick, 10/18 live: "Sentinel Hill" for a note that only mentions the place.
  assert.equal(add("note that the flight master in Sentinel Hill is Thor", "Sentinel Hill"), null);
  assert.equal(add("add flame cloth under Tailoring", "Tailoring"), "Tailoring");
  assert.equal(add("put copper bars on my mining list", "Mining"), "Mining");
  assert.equal(add("add flame cloth to tailoring", "Tailoring", "## Tailoring\n- Linen\n"), "Tailoring");
  assert.equal(add("add flame cloth to my list", "Tailoring", "## Tailoring\n- Linen\n"), null);
});

test("her lines are her own: varied, the same change the same line, each naming exactly what was written and no more", () => {
  // Varied: eight different things added get more than one way of saying it; the same thing, the same line each time.
  const items = ["Hogger", "10 Linen Cloth", "Copper bars", "Train at 20", "Sell the cloth", "Mageroyal", "Fishing pole", "Bank alt"];
  assert.ok(new Set(items.map(i => namedLine(todo, [i], "char:A-B"))).size >= 3);
  assert.equal(namedLine(todo, ["Hogger"], "char:A-B"), namedLine(todo, ["Hogger"], "char:A-B"));
  // Each names what was written, as written (a trailing period not doubled), and claims nothing it didn't do: an add
  // never says "top", "reminder" or "all your characters" unless it was so.
  const cases = [[todo, "char:A-B"], [{ op: "add", kind: "note" }, "char:A-B"], [{ ...todo, top: true }, "char:A-B"],
    [todo, ACCOUNT_PAGE], [{ op: "check" }, "char:A-B"], [{ op: "check", done: false }, "char:A-B"], [{ op: "remove" }, "char:A-B"],
    [{ op: "move", to: "top" }, "char:A-B"], [{ op: "move", to: "bottom" }, "char:A-B"]];
  for (const [op, page] of cases) for (const line of namedLines(op, ["Kill Hogger."], page)) {
    assert.match(line, /Kill Hogger\b/i, line);
    assert.doesNotMatch(line, /\.\./, line);
    assert.doesNotMatch(line, /remind/i, line);
    if (op.op === "add") assert.equal(/\btop\b|\bfirst\b/i.test(line), Boolean(op.top), line);
    if (op.op === "add") assert.equal(/all your characters|every character/.test(line), page === ACCOUNT_PAGE, line);
    if (op.op === "move") assert.doesNotMatch(line, op.to === "top" ? /bottom|last/ : /top|first/, line);
    if (op.op === "check") assert.equal(/untick/i.test(line), op.done === false, line);
  }
  for (const line of namedLines({ op: "update", text: "Kill Hogger and Gnoll Paws" }, ["Kill Hogger"], "char:A-B"))
    assert.match(line, /Kill Hogger and Gnoll Paws\.$/, line);
  // Her reminder lines: what and when, every way she says it, in-world (no "trigger", "notification", "location").
  const sets = [[{ kind: "place", place: "Booty Bay", text: "fish" }, /Booty Bay\b.*: fish\.$/],
    [{ kind: "level", level: 20, text: "train" }, /level 20\b.*: train\.$/],
    [{ kind: "time", at: "2026-10-19T04:00:00Z", text: "raid" }, /9:00 PM\b.*: raid\.$/]];
  for (const [reminder, when] of sets) for (const line of reminderLines({ op: "remind", reminder }, PDT, new Date("2026-10-18T20:00:00Z"))) {
    assert.match(line, when, line);
    assert.doesNotMatch(line, /trigger|notification|location|set a reminder/i, line);
  }
  assert.ok(reminderLines({ op: "unremind", reminders: [{ text: "train" }] }).every(l => /: train\.$/.test(l)));
  // One for all their characters says so, every way; one for this character never does.
  for (const reminder of sets.map(([r]) => r)) {
    for (const line of reminderLines({ op: "remind", reminder: { ...reminder, page: ACCOUNT_PAGE } }, PDT))
      assert.match(line, /any of your characters|whichever character|whichever of your characters/i, line);
    for (const line of reminderLines({ op: "remind", reminder: { ...reminder, page: "char:A-B" } }, PDT))
      assert.doesNotMatch(line, /characters?\b/i, line);
  }
  // Her own promise after the site's line goes (live, 10/18: "…: log off. I'll be sure to tell you to log off in an hour.").
  assert.equal(withRest("I'll tell you at 1:00 PM: log off.", "I'll be sure to tell you to log off in an hour."),
    "I'll tell you at 1:00 PM: log off.");
  assert.equal(withRest("At level 20 I'll remind you: train.", "I'm going to call it out the moment you ding."),
    "At level 20 I'll remind you: train.");
  // A reminder asked for with no moment, kept as a to-do: why, in one line, then what.
  assert.deepEqual(namedLines({ ...todo, why: "no-moment" }, ["buy linen"], "char:A-B"),
    ["You didn't say when or where, so it's on your list: buy linen."]);
});

test("her line is the site's, from what it wrote; her own sentences stay only when they claim nothing", () => {
  const add = { op: "add", kind: "todo", items: ["10 Linen Cloth for bags"] };
  // Flash-Lite's lines, 10/18 live and in the blind check.
  const linen = namedLines(add, ["10 Linen Cloth for bags"], "char:A-B");
  hers(confirmed("I've added that to your notebook for you.", add, ["10 Linen Cloth for bags"], "char:A-B"), linen);
  hers(confirmed("Noted: ten linen cloth for your bags.", add, ["10 Linen Cloth for bags"], "char:A-B"), linen);
  hers(confirmed("I've added that to your account page.", add, ["Bank alt: Bobby"], ACCOUNT_PAGE),
    namedLines(add, ["Bank alt: Bobby"], ACCOUNT_PAGE));
  assert.match(confirmed("I've added that to your account page.", add, ["Bank alt: Bobby"], ACCOUNT_PAGE),
    /all your characters|every character/);
  hers(confirmed("Ticked off. Hogger won't trouble Elwynn again.", { op: "check" }, ["Hogger"], "char:A-B"),
    namedLines({ op: "check" }, ["Hogger"], "char:A-B"), "Hogger won't trouble Elwynn again.");
  hers(confirmed("Taken off.", { op: "remove" }, ["Hogger"], "char:A-B"), namedLines({ op: "remove" }, ["Hogger"], "char:A-B"));
  // A claim that isn't what was written goes ("I have placed it at the top"), and so does a question tacked on.
  hers(confirmed("I have placed it at the top. Is there anything else you need?", { op: "move", to: "top" },
    ["Hogger"], "char:A-B"), namedLines({ op: "move", to: "top" }, ["Hogger"], "char:A-B"));
  hers(confirmed("Got it! I've added that to your list. The farms south of Sentinel Hill are your best bet.", add,
    ["10 Linen Cloth for bags"], "char:A-B"), linen, "The farms south of Sentinel Hill are your best bet.");
  // Nothing new written: what's already there, never "added".
  assert.equal(confirmed("I've added that to your list for you.", add, [], "char:A-B"),
    "That's already on your list: 10 Linen Cloth for bags.");
});

test("what she writes keeps to their words: no map coordinates they didn't give", () => {
  const view = question => notebookView([], { intent: { write: true, read: true }, question });
  const add = (question, item) => {
    const v = view(question);
    return notebookCall({ name: "notebook_add", args: { kind: "note", items: [item] } }, notebookTools(v), v).op.items[0];
  };
  assert.equal(add("note that the flight master in Sentinel Hill is Thor", "Flight master: Thor (56, 53)"), "Flight master: Thor");
  assert.equal(add("note the chest at 45, 32 in Westfall", "Chest in Westfall at 45, 32"), "Chest in Westfall at 45, 32");
  assert.equal(add("remember I need 10 linen cloth", "10 Linen Cloth"), "10 Linen Cloth");
});

// ---- The blind check's failures (the vision session, 10/18: 20 cases x 3 runs, a blind judge) ----

const seed = (user, body, key = `char:${HURIN}`) => env.DB.sqlite.prepare("INSERT INTO notebook_pages (user_id, page, title, " +
  "body, version, updated) VALUES (?, ?, 'Húrin', ?, 1, '')").run(user.id, key, body);

test("blind check, case 2: a save that fails says so, never \"Noted\"", async () => {
  const { user, token } = await linked();
  reply = () => called("notebook_add", { answer: "Noted: Hogger is on your list.", kind: "todo", items: ["Hogger"] });
  const real = env.DB;
  env.DB = new Proxy(real, { get: (db, key) => key === "prepare" ? sql => {
    if (/^(?:INSERT INTO|UPDATE) notebook_pages/.test(sql)) throw new Error("D1 is down");
    return db.prepare(sql);
  } : typeof db[key] === "function" ? db[key].bind(db) : db[key] });
  try {
    const out = await ask(token, "add Hogger to my list");
    assert.equal(out.answer, UNSAVED_LINE);
    assert.equal(out.notebook, undefined);
  } finally { env.DB = real; }
  assert.equal(page(user, `char:${HURIN}`), undefined);
});

test("blind check, case 3: \"put that at the top\" moves it, and says only what moved", async () => {
  const { user, token } = await linked();
  seed(user, "## To do\n- [ ] Copper bars\n- [ ] Silver ore\n- [ ] Visit the paladin trainer\n");
  reply = body => {
    assert.ok(offered(body).includes("notebook_move"));
    return called("notebook_move", { answer: "I have placed that task at the top of your list.", item: 3, to: "top" });
  };
  const out = await ask(token, "put the paladin trainer at the top");
  hers(out.answer, namedLines({ op: "move", to: "top" }, ["Visit the paladin trainer"]));
  assert.equal(page(user, `char:${HURIN}`).body, "## To do\n- [ ] Visit the paladin trainer\n- [ ] Copper bars\n- [ ] Silver ore\n");
  // Not asked to move, no move to offer.
  reply = body => { assert.equal(offered(body).includes("notebook_move"), false); return said("Ok."); };
  await ask(token, "tick off the copper bars");
});

test("blind check, cases 6 and 7: a name two lines share asks which; a line they didn't name is never changed", async () => {
  const { user, token } = await linked();
  const body = "## To do\n- [ ] Copper bars\n- [ ] Copper ore\n- [ ] Silver ore\n";
  seed(user, body);
  for (const items of [[1, 2], [1]]) {
    reply = () => called("notebook_check", { answer: "I've ticked off the copper items.", items });
    const out = await ask(token, "tick off copper");
    assert.equal(out.answer, "Which one: Copper bars, or Copper ore?");
    assert.equal(out.notebook, undefined);
  }
  // Both, when they say both.
  reply = () => called("notebook_check", { answer: "Done.", items: [1, 2] });
  hers((await ask(token, "tick off both copper lines")).answer, namedLines({ op: "check" }, ["Copper bars", "Copper ore"]));
  seed(user, "## To do\n- [ ] Copper bars\n- [ ] Silver ore\n", ACCOUNT_PAGE);
  // Asked to cross off linen with no linen there, the model ticked the copper bars.
  reply = () => called("notebook_check", { answer: "I've crossed that off for you.", items: [4] });
  assert.equal((await ask(token, "cross off the linen")).answer, NOT_FOUND_LINE);
  assert.equal(page(user, ACCOUNT_PAGE).body, "## To do\n- [ ] Copper bars\n- [ ] Silver ore\n");
  // "Tick that off" names the line the talk before did; and a number names a line too.
  reply = () => called("notebook_check", { answer: "Done.", items: [3] });
  const prompt = "PLAYER CONTEXT\nzone: Westfall\nlevel: 14\n\nSOURCES\n\nRECENT CONVERSATION (oldest first)\n" +
    JSON.stringify([{ player: "where's silver ore?", willo: "Silver ore veins dot the hills north of Moonbrook." }]) +
    "\n\nQUESTION\ntick that off, I've got it";
  const res = await answer({ env, request: new Request("https://example.test/api/companion/answer", { method: "POST",
    headers: { "X-LF-Client": "companion/0.22.0", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, persona: "willo", notebook: { character: HURIN } }) }) });
  hers((await res.json()).answer, namedLines({ op: "check" }, ["Silver ore"]));
});

test("blind check, case 12: a duplicate says it's already there; case 1: things to get are to-dos", async () => {
  const { user, token } = await linked();
  seed(user, "## To do\n- [ ] Hogger\n");
  reply = () => called("notebook_add", { answer: "I've added that to your list for you.", kind: "todo", items: ["hogger"] });
  let out = await ask(token, "add Hogger to my list");
  assert.equal(out.answer, "That's already on your list: hogger.");
  assert.equal(out.notebook, undefined);
  assert.equal(page(user, `char:${HURIN}`).version, 1);
  reply = () => called("notebook_add", { answer: "I've added those materials to your notebook.", kind: "note",
    items: ["Copper bars", "Silver ore", "Linen cloth", "Mageroyal"] });
  out = await ask(token, "add these to my list: copper bars, silver ore, linen cloth and mageroyal");
  hers(out.answer, namedLines(todo, ["Copper bars", "Silver ore", "Linen cloth", "Mageroyal"]));
  assert.match(page(user, `char:${HURIN}`).body, /- \[ \] Copper bars\n- \[ \] Silver ore\n- \[ \] Linen cloth\n- \[ \] Mageroyal\n$/);
});

test("blind check, case 17: out loud, a long list is said short", async () => {
  const { user, token } = await linked();
  const twelve = ["Copper bars", "Silver ore", "Linen cloth", "Mageroyal", "Fishing pole", "Bandages", "The Defias Brotherhood",
    "Hogger", "Train at 20", "Sell the cloth", "Visit Ironforge", "Find the Defias hideout"];
  seed(user, "## To do\n" + twelve.map(t => `- [ ] ${t}`).join("\n") + "\n");
  reply = () => said("Twelve things.");
  await ask(token, "what's on my list?", { style: "spoken" });
  // Shown three and a count, she can only say three.
  const spoken = calls[0].systemInstruction.parts[0].text;
  assert.match(spoken, /\(12 open to-dos\)\n1\. \[ \] Copper bars\n2\. \[ \] Silver ore\n3\. \[ \] Linen cloth\n\(9 more not shown: say "and 9 more"\)/);
  assert.doesNotMatch(spoken, /Mageroyal/);
  // The lines the question names come first.
  calls = [];
  await ask(token, "do I still have the fishing pole on my list?", { style: "spoken" });
  const named = calls[0].systemInstruction.parts[0].text;
  assert.match(named, /\d\. \[ \] Fishing pole\n/);
  assert.doesNotMatch(named, /Mageroyal/);
  // Typed, all of them.
  calls = [];
  await ask(token, "what's on my list?");
  assert.match(calls[0].systemInstruction.parts[0].text, /12\. \[ \] Find the Defias hideout/);
});

test("blind check recheck: \"add that to the top of the list\" in the player's words, and no claim when nothing was written", async () => {
  const { user, token } = await linked();
  const shop = "## To do\n- [ ] Turn in the Westfall letter\n- [ ] Auction house: purple shirt\n- [ ] Paladin trainer\n";
  seed(user, shop);
  // LOR-624's own words: offered the tools, with a place at the top for a new line.
  reply = body => {
    assert.ok(offered(body).includes("notebook_add"));
    assert.ok(body.tools[0].functionDeclarations.find(d => d.name === "notebook_add").parameters.properties.top);
    return called("notebook_add", { answer: "I have added that to the top of your to-do list.", kind: "todo",
      items: ["Get my spells"], top: true });
  };
  let out = await ask(token, "Get my spells first, add that to the top of the list.", { style: "spoken" });
  hers(out.answer, namedLines({ ...todo, top: true }, ["Get my spells"]));
  assert.equal(page(user, `char:${HURIN}`).body, "## To do\n- [ ] Get my spells\n" + shop.slice("## To do\n".length));
  for (const q of ["Get my spells first, add that to the top of the list.", "Do the trainer first on my list."])
    assert.equal(notebookIntent(q).write, true, q);
  for (const q of ["what is first on the list?", "what's at the top of my list?"]) assert.equal(notebookIntent(q).write, false, q);
  // "Do the trainer first" is an order, never a tick.
  reply = body => {
    assert.equal(offered(body).includes("notebook_check"), false);
    return called("notebook_move", { answer: "Done.", item: 4, to: "top" });
  };
  out = await ask(token, "Do the trainer first on my list.");
  hers(out.answer, namedLines({ op: "move", to: "top" }, ["Paladin trainer"]));
  // The model gives the whole list again, in its new order: that order, never a duplicate.
  reply = () => called("notebook_add", { answer: "Updated!", kind: "todo",
    items: ["Turn in the Westfall letter", "Paladin trainer", "Auction house: purple shirt"] });
  out = await ask(token, "Do the letter first on my list.");
  hers(out.answer, namedLines({ op: "move", to: "top" }, ["Turn in the Westfall letter"]));
  assert.match(page(user, `char:${HURIN}`).body, /## To do\n- \[ \] Turn in the Westfall letter\n- \[ \] Paladin trainer\n- \[ \] Auction house: purple shirt\n/);
  // The model skips the tools and claims a change anyway (the vision session's nbclaim.mjs): never through.
  reply = () => called("answer_only", { answer: "I have moved that to the top of your list." });
  out = await ask(token, "Get my spells first, put that at the top of my list.");
  assert.equal(out.answer, "I haven't changed your notebook yet. Tell me what to add, tick off or move.");
  assert.equal(out.notebook, undefined);
  reply = () => said("The paladin trainer is in the Cathedral. Your notebook now shows that first.");
  assert.equal((await ask(token, "what's on my list?")).answer, "The paladin trainer is in the Cathedral.");
  // A plain answer that claims nothing keeps every word; a negated one too.
  reply = () => said("You still have three things to do. I haven't added anything new.");
  assert.equal((await ask(token, "what's left on my list?")).answer, "You still have three things to do. I haven't added anything new.");
});

test("blind check recheck, case 1: \"make a note: I need …\" makes to-dos, in their own words", async () => {
  const { user, token } = await linked();
  reply = () => called("notebook_add", { answer: "Noted.", kind: "note",
    items: ["Rough stone", "Copper bar", "Bronze bars", "Silver ore"] });
  const out = await ask(token, "Make a note: I need rough stones, copper bars, bronze bars and silver ore.");
  assert.equal(page(user, `char:${HURIN}`).body,
    "## To do\n- [ ] Rough stones\n- [ ] Copper bars\n- [ ] Bronze bars\n- [ ] Silver ore\n");
  hers(out.answer, namedLines(todo, ["Rough stones", "Copper bars", "Bronze bars", "Silver ore"]));
  // "Note that …" keeps a fact.
  reply = () => called("notebook_add", { answer: "Noted.", kind: "note", items: ["Thor flies to Stormwind"] });
  await ask(token, "note that Thor flies to Stormwind");
  assert.match(page(user, `char:${HURIN}`).body, /## Notes\n- Thor flies to Stormwind\n$/);
});

// ---- Reminders (LOR-663): the cases of its bar, through the answer path with a stub model ----

const hero = async user => env.DB.prepare("INSERT INTO entitlements (user_id, subscription_id, plan, status, " +
  "current_period_end, updated) VALUES (?, ?, 'hero', 'active', ?, ?)").bind(user.id, `sub-${user.id}`,
  new Date(Date.now() + 20 * 86400e3).toISOString(), new Date().toISOString()).run();
const reminders = user => env.DB.sqlite.prepare("SELECT * FROM notebook_reminders WHERE user_id = ? ORDER BY created").all(user.id);
// The player's clock: Pacific daylight time, 7 hours behind UTC.
const PDT = -420;

test("reminders: only a question that asks for one gets the reminder tool", () => {
  for (const q of ["remind me to sell the cloth when I'm next in Ironforge", "remind me to train when I hit 20",
    "in an hour, remind me to log off", "set a reminder for 9pm to check the auction house", "tell me when I reach Booty Bay",
    "cancel the Ironforge reminder", "move the Ironforge reminder to Stormwind"])
    assert.equal(notebookIntent(q).remind, true, q);
  // Asking what they have reads them, never writes.
  assert.deepEqual(notebookIntent("what reminders do I have?"), { write: false, read: true, remind: false });
  for (const q of ["remind me who Hogger is", "what time is it?", "when do I get my mount?", "remind me what the Defias are"])
    assert.equal(notebookIntent(q).remind, false, q);
  assert.equal(placeKey("Stormwind City"), placeKey("stormwind"));
  assert.equal(placeKey("The Barrens"), placeKey("barrens"));
});

test("reminders: set by place, kept on this character's page, said once in her line", async () => {
  const { user, token } = await linked();
  await hero(user);
  env.SITE_FEATURES = "plans";
  try {
    reply = body => {
      assert.ok(offered(body).includes("notebook_remind"));
      assert.match(body.systemInstruction.parts[0].text, /REMINDERS: notebook_remind/);
      return called("notebook_remind", { answer: "I'll tell you when you reach Ironforge: sell the cloth.",
        text: "sell the cloth", when: "place", place: "ironforge" });
    };
    const out = await ask(token, "remind me to sell the cloth when I'm next in Ironforge", { notebook: { character: HURIN, offset: PDT } });
    hers(out.answer, reminderLines({ op: "remind", reminder: { kind: "place", place: "Ironforge", text: "sell the cloth" } }));
    assert.equal(out.notebook.change, "remind");
    assert.equal(out.notebook.page, `char:${HURIN}`);
    assert.deepEqual({ ...out.notebook.reminders[0], id: "x", created: "x" },
      { id: "x", page: `char:${HURIN}`, text: "sell the cloth", kind: "place", place: "Ironforge", created: "x" });
    const [row] = reminders(user);
    assert.equal(row.place, "Ironforge");
    assert.equal(row.fired, null);
    // A district fires there, and the town's own name too: both are places of this age.
    reply = () => called("notebook_remind", { answer: "Noted.", text: "buy a bag", when: "place", place: "Trade District" });
    assert.match((await ask(token, "remind me to buy a bag in the Trade District", { notebook: { character: HURIN } })).answer,
      /buy a bag/);
    assert.equal(reminders(user)[1].place, "Trade District");
  } finally { delete env.SITE_FEATURES; }
});

test("reminders: a place she can't know you've reached, or of another age, is never set", async () => {
  const { user, token } = await linked();
  // Shattrath, as the model gave it or not at all (its name is in their words): never set, never a hint of where it is.
  for (const place of ["Shattrath", ""]) {
    reply = () => called("notebook_remind", { answer: "Done!", text: "visit the bank", when: "place", place });
    assert.equal((await ask(token, "remind me to visit the bank when I'm in Shattrath")).answer,
      "I don't know a place called Shattrath. Name a town or zone you'll reach, and I'll be there with it.");
  }
  // The model's own answer about it (the Dark Portal, Outland) never gets through.
  reply = () => called("answer_only", { answer: "The Dark Portal is dormant, so no one can reach Shattrath." });
  assert.equal((await ask(token, "remind me to visit Shattrath when I get there")).answer,
    "I don't know a place called Shattrath. Name a town or zone you'll reach, and I'll be there with it.");
  // No moment in their words: a to-do, never a guessed place ("remind me to buy linen" was once set for Ironforge).
  reply = () => called("notebook_remind", { answer: "When you reach Ironforge I'll remind you.", text: "buy linen",
    when: "place", place: "Ironforge" });
  const out = await ask(token, "remind me to buy linen");
  // And says why, in a line (the PM, 10/18).
  assert.equal(out.answer, "You didn't say when or where, so it's on your list: buy linen.");
  assert.equal(out.notebook.change, "add");
  for (const [args, q, text] of [[{ when: "level", level: 20 }, "remind me to train", "train"],
    [{ when: "time", in_minutes: 60 }, "remind me to log off", "log off"]]) {
    reply = () => called("notebook_remind", { answer: "Ok.", text, ...args });
    assert.equal((await ask(token, q)).notebook.change, "add", q);
  }
  // "The bank": the model asks which town (answer_only), and nothing's set.
  reply = () => called("answer_only", { answer: "Which town's bank?" });
  assert.equal((await ask(token, "remind me when I'm at the bank")).answer, "Which town's bank?");
  assert.equal(reminders(user).length, 0);
});

test("reminders: by level, and a level already reached says it now", async () => {
  const { user, token } = await linked();
  reply = () => called("notebook_remind", { answer: "At 20, then.", text: "train", when: "level", level: 20 });
  let out = await ask(token, "remind me to train when I hit 20");
  hers(out.answer, reminderLines({ op: "remind", reminder: { kind: "level", level: 20, text: "train" } }));
  assert.equal(reminders(user)[0].level, 20);
  reply = () => called("notebook_remind", { answer: "Sure.", text: "train", when: "level", level: 10 });
  out = await ask(token, "remind me to train at 10");                 // she's 9 in ask()'s PLAYER CONTEXT
  assert.equal(reminders(user).length, 2);
  const old = ask;
  // At level 22, a reminder for 20 is said now and never kept.
  reply = () => called("notebook_remind", { answer: "Sure.", text: "train", when: "level", level: 20 });
  const res = await answer({ env, request: new Request("https://example.test/api/companion/answer", { method: "POST",
    headers: { "X-LF-Client": "companion/0.22.0", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "PLAYER CONTEXT\nzone: Ironforge\nlevel: 22\n\nSOURCES\n\nQUESTION\nremind me to train when I hit 20",
      persona: "willo", notebook: { character: HURIN } }) }) });
  assert.equal((await res.json()).answer, "You're level 22 already, so here it is now: train.");
  assert.equal(reminders(user).length, 2);
  void old;
});

test("reminders: by time, from now or at a time of day on their clock; \"at 9\" alone asks morning or night", async () => {
  const { user, token } = await linked();
  reply = () => called("notebook_remind", { answer: "Will do!", text: "log off", when: "time", in_minutes: 60 });
  const before = Date.now();
  let out = await ask(token, "in an hour, remind me to log off", { notebook: { character: HURIN, offset: PDT } });
  const at = Date.parse(reminders(user)[0].at);
  assert.ok(at >= before + 3600e3 - 1000 && at <= Date.now() + 3600e3 + 1000);
  assert.match(out.answer, /^(At \d{1,2}:\d\d [AP]M I'll remind you|I'll tell you at \d{1,2}:\d\d [AP]M): log off\.$/);
  // "at 9" with nothing to say which: she asks, and nothing's set.
  reply = () => called("notebook_remind", { answer: "Sure.", text: "check the auction house", when: "time", clock: "21:00" });
  out = await ask(token, "remind me at 9 to check the auction house", { notebook: { character: HURIN, offset: PDT } });
  assert.equal(out.answer, "9 in the morning, or 9 at night?");
  assert.equal(reminders(user).length, 1);
  // "at 9pm": the next 9 PM on their clock (UTC 04:00), said as they read it.
  out = await ask(token, "remind me at 9pm to check the auction house", { notebook: { character: HURIN, offset: PDT } });
  const nine = new Date(reminders(user)[1].at);
  assert.equal(nine.getUTCHours(), 4);
  assert.ok(nine.getTime() > Date.now() && nine.getTime() <= Date.now() + 86400e3);
  assert.match(out.answer, /^(At 9:00 PM( tomorrow)? I'll remind you|I'll tell you at 9:00 PM( tomorrow)?): check the auction house\.$/);
  // Without their clock (an older companion, the iPhone), a time of day isn't guessed.
  out = await ask(token, "remind me at 9pm to check the auction house", { notebook: { character: HURIN } });
  assert.equal(out.answer, "Tell me in how long, and I'll keep the time for you.");
});

test("reminders: listed with their moments, changed, and cancelled by number", async () => {
  const { user, token } = await linked();
  reply = () => called("notebook_remind", { answer: "Ok", text: "sell the cloth", when: "place", place: "Ironforge" });
  await ask(token, "remind me to sell the cloth when I reach Ironforge");
  reply = () => called("notebook_remind", { answer: "Ok", text: "train", when: "level", level: 20 });
  await ask(token, "remind me to train when I hit 20");
  const system = () => calls[calls.length - 1].systemInstruction.parts[0].text;
  reply = () => said("Sell the cloth in Ironforge, and train at 20.");
  await ask(token, "what reminders do I have?");
  assert.match(system(), /Reminders \(each said once, at its moment\):\n1\. sell the cloth \(when you reach Ironforge\)\n2\. train \(at level 20\)/);
  // Change: the same reminder, a new place; the old one never comes. Without the place in the model's call (live,
  // once), the one their words name.
  reply = () => called("notebook_remind", { answer: "Moved.", text: "sell the cloth", when: "place", replaces: 1 });
  let out = await ask(token, "move the Ironforge reminder to Darnassus");
  assert.equal(reminders(user)[0].place, "Darnassus");
  reply = () => called("notebook_remind", { answer: "Moved.", text: "sell the cloth", when: "place", place: "Stormwind",
    replaces: 1 });
  out = await ask(token, "move the Darnassus reminder to Stormwind");
  assert.equal(reminders(user).length, 2);
  assert.equal(reminders(user)[0].place, "Stormwind City");
  hers(out.answer, reminderLines({ op: "remind", reminder: { kind: "place", place: "Stormwind City", text: "sell the cloth" } }));
  // Cancel by number; one that isn't there changes nothing.
  reply = () => called("notebook_remove", { answer: "Gone.", items: [2] });
  out = await ask(token, "cancel the level 20 reminder");
  hers(out.answer, reminderLines({ op: "unremind", reminders: [{ text: "train" }] }));
  assert.equal(out.notebook.change, "unremind");
  assert.deepEqual(reminders(user).map(r => r.text), ["sell the cloth"]);
  reply = () => called("notebook_remove", { answer: "Gone.", items: [9] });
  assert.equal((await ask(token, "cancel the Darnassus reminder")).answer, NOT_FOUND_LINE);
  assert.equal(reminders(user).length, 1);
});

test("reminders: on the free plan, no reminder tool; plain words about Hero typed, never a plan out loud", async () => {
  const { user, token } = await linked();
  env.SITE_FEATURES = "plans";
  try {
    reply = body => {
      assert.equal(offered(body).includes("notebook_remind"), false);
      assert.ok(body.systemInstruction.parts[0].text.includes(REMIND_PLAN_RULE));
      return called("answer_only", { answer: "Reminders that find you at the right moment come with Hero. Want it on your list instead?" });
    };
    await ask(token, "remind me to sell the cloth when I reach Ironforge");
    reply = body => {
      assert.doesNotMatch(body.systemInstruction.parts[0].text, /come with Hero/);
      return called("answer_only", { answer: "I can't call that out yet. Want it on your list instead?" });
    };
    await ask(token, "remind me to sell the cloth when I reach Ironforge", { style: "spoken" });
    assert.equal(reminders(user).length, 0);
    // "yes" to her offer writes the to-do.
    reply = body => {
      assert.ok(offered(body).includes("notebook_add"));
      return called("notebook_add", { answer: "On your list.", kind: "todo", items: ["Sell the cloth in Ironforge"] });
    };
    const prompt = "PLAYER CONTEXT\nzone: Westfall\nlevel: 14\n\nSOURCES\n\nRECENT CONVERSATION (oldest first)\n" +
      JSON.stringify([{ player: "remind me to sell the cloth in Ironforge", willo: "I can't call that out yet. Want it on your list instead?" }]) +
      "\n\nQUESTION\nyes please";
    const res = await answer({ env, request: new Request("https://example.test/api/companion/answer", { method: "POST",
      headers: { "X-LF-Client": "companion/0.22.0", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, persona: "willo", notebook: { character: HURIN } }) }) });
    assert.equal((await res.json()).notebook.change, "add");
  } finally { delete env.SITE_FEATURES; }
});

test("reminders: the app's API lists them, says each once from whichever device is first, cancels, and erase takes all", async () => {
  const { user, token } = await linked();
  reply = () => called("notebook_remind", { answer: "Ok", text: "sell the cloth", when: "place", place: "Ironforge" });
  await ask(token, "remind me to sell the cloth when I reach Ironforge");
  let res = await api(token, "reminders");
  assert.equal(res.body.reminders.length, 1);
  const { id } = res.body.reminders[0];
  assert.deepEqual((await api(token, "fire", { id })).body, { ok: true, fired: true });
  assert.deepEqual((await api(token, "fire", { id })).body, { ok: true, fired: false });     // the Mac, a moment later
  assert.ok((await api(token, "reminders")).body.reminders[0].fired);
  // Said ones no longer reach her answers.
  reply = () => said("None waiting.");
  await ask(token, "what reminders do I have?");
  assert.doesNotMatch(/NOTEBOOK[^]*$/.exec(calls[calls.length - 1].systemInstruction.parts[0].text)?.[0] || "", /sell the cloth/);
  // Cancel, erase, and Delete my account.
  reply = () => called("notebook_remind", { answer: "Ok", text: "train", when: "level", level: 20 });
  await ask(token, "remind me to train when I hit 20");
  const train = (await api(token, "reminders")).body.reminders.find(r => r.text === "train");
  assert.deepEqual((await api(token, "cancel", { id: train.id })).body.reminders.map(r => r.text), ["sell the cloth"]);
  await api(token, "save", { page: "account", body: "- Bank alt: Bobby\n", version: 0 });
  assert.equal((await api(token, "erase", {})).status, 400);
  assert.equal((await api(token, "erase", { confirm: "erase" })).status, 200);
  assert.equal(reminders(user).length, 0);
  assert.deepEqual((await api(token, "pages")).body.pages, []);
  reply = () => called("notebook_remind", { answer: "Ok", text: "train", when: "level", level: 20 });
  await ask(token, "remind me to train when I hit 20");
  await deleteUser(env, user);
  assert.equal(reminders(user).length, 0);
});

// ---- LOR-663's blind check (the vision session, 10/18): the reminders' fails ----

test("reminders blind check, case 6: \"in an hour, tell me to log off\" sets one, and a promise with none set never goes out", async () => {
  const { user, token } = await linked();
  assert.equal(notebookIntent("In an hour, tell me to log off.").remind, true);
  reply = body => {
    assert.ok(offered(body).includes("notebook_remind"));
    return called("answer_only", { answer: "I will certainly remind you to log off in an hour." });
  };
  let out = await ask(token, "In an hour, tell me to log off.", { notebook: { character: HURIN, offset: PDT } });
  assert.equal(out.answer, "I haven't set a reminder yet. Tell me where or when, and what to say.");
  assert.equal(reminders(user).length, 0);
  // In their words and with one period: "train", never "Train your new paladin skills..".
  reply = () => called("notebook_remind", { answer: "Sure.", text: "Train your new paladin skills.", when: "level", level: 20 });
  out = await ask(token, "When I hit 20, tell me to train.");
  hers(out.answer, reminderLines({ op: "remind", reminder: { kind: "level", level: 20, text: "train" } }));
  assert.equal(reminders(user)[0].text, "train");
});

test("reminders blind check, case 11: a character's reminder is never another's, unless they said all characters", async () => {
  const { user, token } = await linked();
  reply = () => called("notebook_remind", { answer: "Ok", text: "sell the cloth", when: "place", place: "Ironforge", page: "account" });
  await ask(token, "When I'm next in Ironforge, remind me to sell the cloth.");
  assert.equal(reminders(user)[0].page, `char:${HURIN}`);
  reply = () => said("You have no reminders waiting.");
  await ask(token, "What reminders do I have?", { notebook: { character: "Brynn-ClassicBetaPvE" } });
  assert.doesNotMatch(calls[calls.length - 1].systemInstruction.parts[0].text, /sell the cloth/);
  reply = () => called("notebook_remind", { answer: "Ok", text: "grab the fishing pole", when: "place", place: "Booty Bay",
    page: "account" });
  await ask(token, "remind me when I reach Booty Bay to grab the fishing pole, for all my characters");
  assert.equal(reminders(user)[1].page, ACCOUNT_PAGE);
});

test("reminders blind check, case 20: the free plan hears it plainly, with what went on their list", async () => {
  const { user, token } = await linked();
  env.SITE_FEATURES = "plans";
  try {
    reply = () => called("notebook_add", { answer: "Noted: Sell cloth in Ironforge.", kind: "todo", items: ["Sell the cloth in Ironforge"] });
    let out = await ask(token, "When I'm next in Ironforge, remind me to sell the cloth.");
    assert.equal(out.answer, "Reminders at a place or time come with Hero. I've put it on your list instead: Sell the cloth in Ironforge.");
    reply = () => called("notebook_add", { answer: "Done.", kind: "todo", items: ["Repair gear"] });
    out = await ask(token, "When I'm next in Ironforge, remind me to repair my gear.", { style: "spoken" });
    assert.equal(out.answer, "I can't call that out when you get there, but it's on your list: Repair gear.");
    assert.doesNotMatch(out.answer, /Hero|plan/);
    reply = () => called("answer_only", { answer: "I'll remind you when you get there!" });
    out = await ask(token, "When I'm next in Darnassus, remind me to see the banker.");
    assert.equal(out.answer, "Reminders at a place or time come with Hero. Want it on your list instead?");
    assert.equal(reminders(user).length, 0);
  } finally { delete env.SITE_FEATURES; }
});

test("reminders blind check, case 11 (same chat): \"what reminders do I have?\" is built from what's waiting, never the talk before", async () => {
  const { user, token } = await linked();
  reply = () => called("notebook_remind", { answer: "Ok", text: "sell the cloth", when: "place", place: "Ironforge" });
  await ask(token, "When I'm next in Ironforge, remind me to sell the cloth.");
  reply = () => called("notebook_remind", { answer: "Ok", text: "grab the fishing pole", when: "place", place: "Booty Bay",
    page: "account" });
  await ask(token, "remind me when I reach Booty Bay to grab the fishing pole, for all my characters");
  // On Brynn, in the same chat: the model answers from the talk before; the site's words go out instead.
  reply = () => said("You have one reminder noted: sell your cloth when you next reach Ironforge.");
  let out = await ask(token, "What reminders do I have?", { notebook: { character: "Brynn-ClassicBetaPvE" } });
  assert.equal(out.answer, "One reminder is waiting for Brynn: grab the fishing pole, when you reach Booty Bay (for all your characters).");
  out = await ask(token, "What reminders do I have?");
  assert.equal(out.answer, "Two reminders are waiting for Húrin: sell the cloth, when you reach Ironforge; grab the fishing pole, " +
    "when you reach Booty Bay (for all your characters).");
  out = await ask(token, "Do I have any reminders?", { notebook: { character: "Elyn-ClassicBetaPvE" } });
  assert.equal(out.answer, "One reminder is waiting for Elyn: grab the fishing pole, when you reach Booty Bay (for all your characters).");
  assert.equal(reminders(user).length, 2);
});

test("their words for a single line asked for, the model's extra words only when they said them too", async () => {
  const { user, token } = await linked();
  reply = () => called("notebook_add", { answer: "Ok", kind: "todo", items: ["Visit the bank in Stormwind City"] });
  await ask(token, "Remember to visit the bank sometime.");
  assert.match(page(user, `char:${HURIN}`).body, /- \[ \] Visit the bank\n/);
});

test("voice check, fail 1: \"remind me to feed my pet\" goes on their list from the site, whatever the model said, on any plan", async () => {
  const { user, token } = await linked();
  // The model judged it ("as a Paladin, you don't have a pet to feed!") and wrote nothing.
  reply = () => called("answer_only", { answer: "I would love to help, but as a Paladin, you don't have a pet to feed!" });
  let out = await ask(token, "Remind me to feed my pet.");

  assert.equal(out.answer, "You didn't say when or where, so it's on your list: feed my pet.");
  assert.equal(out.notebook.change, "add");
  assert.match(page(user, `char:${HURIN}`).body, /- \[ \] feed my pet\n/);
  assert.equal(reminders(user).length, 0);
  // Again: already there, never a second line.
  out = await ask(token, "remind me to feed my pet");
  assert.equal(out.answer, "That's already on your list: feed my pet.");
  // On the free plan too: it's a to-do they asked for, never a word about Hero.
  env.SITE_FEATURES = "plans";
  try {
    reply = () => called("answer_only", { answer: "Reminders come with Hero." });
    out = await ask(token, "can you remind me to buy vials from the trade supplier?");
    assert.equal(out.answer, "You didn't say when or where, so it's on your list: buy vials from the trade supplier.");
  } finally { delete env.SITE_FEATURES; }
  // Only the plain ask: a moment, all their characters, or "that" stays the model's.
  const view = q => ({ question: q, current: `char:${HURIN}` });
  for (const q of ["remind me to train when I hit 20", "In an hour, tell me to log off.", "remind me to log off in an hour",
    "remind me to grab the pole for all my characters", "remind me to look at the map", "remind me to do that",
    "remind me to sell the cloth next time I'm in Ironforge", "remind me who Hogger is", "remind me to train at 20"])
    assert.equal(noMoment(view(q), notebookIntent(q)), null, q);
  assert.deepEqual(noMoment(view("Willo, please remind me to repair my gear!"), notebookIntent("remind me")).op.items, ["repair my gear"]);
});

test("voice check, fail 2: an empty list asked about gets the site's words, never \"lines recorded\"", async () => {
  const { user, token } = await linked();
  reply = () => said("There are no to-dos or lines recorded for you or Brynn.");
  const brynn = { notebook: { character: "Brynn-ClassicBetaPvE" } };
  assert.equal((await ask(token, "What's on my list?", brynn)).answer,
    "Nothing's on Brynn's list yet. Tell me what to add, and I'll write it down.");
  assert.equal((await ask(token, "what's in my notebook?", brynn)).answer,
    "Nothing's in Brynn's notes yet. Tell me what to keep, and I'll write it down.");
  // Something on it (here, for all their characters): the model reads it out.
  seed(user, "## To do\n- [ ] Copper bars\n", ACCOUNT_PAGE);
  reply = () => said("Copper bars, for all your characters.");
  assert.equal((await ask(token, "What's on my list?", brynn)).answer, "Copper bars, for all your characters.");
  // A question that doesn't name the list is the model's.
  env.DB.sqlite.prepare("DELETE FROM notebook_pages WHERE user_id = ?").run(user.id);
  reply = () => said("Head to the Jangolode Mine.");
  assert.equal((await ask(token, "what do I need to do in Westfall?", brynn)).answer, "Head to the Jangolode Mine.");
});

test("voice check, nits: a line with its own colon reads first, and an add's line stands alone unless they asked more", () => {
  for (const [op, page] of [[{ op: "add", kind: "note" }, "char:A-B"], [{ op: "add", kind: "note" }, ACCOUNT_PAGE],
    [{ op: "add", kind: "todo" }, "char:A-B"]])
    for (const line of namedLines(op, ["Bank alt: Bobby"], page)) {
      assert.ok(line.startsWith("Bank alt: Bobby. "), line);
      assert.equal(line.split(":").length, 2, line);
    }
  const add = { op: "add", kind: "todo" };
  assert.equal(confirmed("Written down. The bank in Stormwind sits by the canals.", add, ["Visit the bank"], "char:A-B",
    "remember to visit the bank"), namedLine(add, ["Visit the bank"], "char:A-B"));
  hers(confirmed("Noted. Linen drops from the Defias in Westfall.", add, ["10 Linen Cloth"], "char:A-B",
    "remember I need 10 linen cloth, where do I get it?"), namedLines(add, ["10 Linen Cloth"], "char:A-B"),
    "Linen drops from the Defias in Westfall.");
});

test("\"yes\" to her offer to note something only adds: an older offer further up the talk is never what it does", async () => {
  const { user, token } = await linked();
  seed(user, "## To do\n- [ ] Linen cloth for bags\n\n## Pins\n- the elite cave · Fargodeep Mine\n- the hill · Sentinel Hill\n");
  // The voice check (10/18): the model took the pins off for "Clear all my pins? Say yes", two turns back.
  assert.equal(notebookIntent("Yes.", "Goldshire is in Elwynn Forest, south of Stormwind. Want me to note it?").adding, true);
  for (const [q, offer] of [["yes", "Want me to take Hogger off your list?"], ["yes", "Want me to move it to the top of your list?"],
    ["yes, and tick off Hogger", "Want me to note it?"], ["yes", "Want the way there?"]])
    assert.equal(notebookIntent(q, offer).adding, undefined, offer);
  reply = body => {
    assert.deepEqual(offered(body).filter(n => n.startsWith("notebook_")), ["notebook_add"]);
    return called("notebook_add", { answer: "Done.", kind: "note", items: ["Goldshire: Elwynn Forest, south of Stormwind"] });
  };
  const prompt = "PLAYER CONTEXT\nzone: Stormwind City\nlevel: 12\n\nSOURCES\n\nRECENT CONVERSATION (oldest first)\n" +
    JSON.stringify([{ player: "Clear all my pins.", willo: "All two of Húrin's pins? Say yes and I'll take them off." },
      { player: "Where is Goldshire?", willo: "Goldshire is in Elwynn Forest, south of Stormwind. Want me to note it?" }]) +
    "\n\nQUESTION\nYes.";
  const res = await answer({ env, request: new Request("https://example.test/api/companion/answer", { method: "POST",
    headers: { "X-LF-Client": "companion/0.22.0", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, persona: "willo", notebook: { character: HURIN } }) }) });
  hers((await res.json()).answer, namedLines({ op: "add", kind: "note" }, ["Goldshire: Elwynn Forest, south of Stormwind"], `char:${HURIN}`));
  assert.match(page(user, `char:${HURIN}`).body, /the elite cave[^]*the hill/);
});

test("the claim guard: \"consider it done\", \"your map is clear\", \"all set\" with nothing written go, on a yes to any offer of hers", async () => {
  // The vision session (10/18): "Yes." to "Say yes and I'll take them off", no pin taken off, and she said it was done.
  for (const said of ["Consider it done, Húrin; your map is clear of those pins now.", "Consider them cleared, Húrin; your map is clean.",
    "That's taken care of.", "You're all set!", "Your list is now empty.", "I've cleared them for you.", "They're cleared."])
    assert.equal(unclaimed(said, { plain: true, changing: true }), "I haven't done that yet. Tell me again what you'd like, and I'll see to it.", said);
  // Negated, or nothing of the kind: kept.
  for (const said of ["I have not cleared them yet.", "They haven't been cleared.", "The road to Westfall is clear of bandits now.",
    "Hogger was taken down by the guards.", "Head east along the road to Goldshire."])
    assert.equal(unclaimed(said, { plain: true, changing: true }), said, said);
  // On a read, "your list is clear" is true (the vision session's recheck, 10/18): only a change makes it a claim.
  for (const said of ["Your list is all clear: you've ticked off the copper bars and the silver ore.",
    "Check the map near Goldshire; the road there is clear."])
    assert.equal(unclaimed(said), said, said);
  assert.equal(saidYes("Yes.", "All two of Húrin's pins? Say yes and I'll take them off."), true);
  assert.equal(saidYes("yes", "Goldshire is south of Stormwind. Want me to note it?"), true);
  assert.equal(saidYes("Yes.", "Hogger lurks at Forest's Edge."), false);
  // An offer to tell them something is never one to do something.
  for (const offer of ["Want me to tell you where to train?", "Want me to show you the way?", "Shall I tell you more about Hogger?"])
    assert.equal(saidYes("Yes.", offer), false, offer);
  assert.equal(saidYes("Who is Hogger?", "Want me to note it?"), false);
  // Through the answer: a yes to her offer, and she claims it done with nothing written.
  const { token } = await linked();
  const prompt = earlier => "PLAYER CONTEXT\nzone: Stormwind City\nlevel: 12\n\nSOURCES\n\nRECENT CONVERSATION (oldest first)\n" +
    JSON.stringify(earlier) + "\n\nQUESTION\nYes.";
  const send = async earlier => (await (await answer({ env, request: new Request("https://example.test/api/companion/answer", {
    method: "POST", headers: { "X-LF-Client": "companion/0.22.0", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: prompt(earlier), persona: "willo", notebook: { character: HURIN } }) }) })).json()).answer;
  reply = () => said("Consider it done; you're all set.");
  assert.equal(await send([{ player: "I train at 20.", willo: "Want me to set a reminder for level 20?" }]),
    "I haven't done that yet. Tell me again what you'd like, and I'll see to it.");
  // Clearing the pins is the pins' own to answer (lib/willo-pins.js clearReply), after the guard: never "Consider it done".
  reply = () => said("Consider it done, Húrin; your map is clear of those pins now.");
  assert.equal(await send([{ player: "Clear all my pins.", willo: "All two of Húrin's pins? Say yes and I'll take them off." }]),
    "Húrin has no pins to clear.");
  // A yes to an offer to tell them something: her answer stands, all of it.
  reply = () => said("Head east from the Valley of Heroes, then south through the gates. Once you've paid him, you're all set to ride.");
  assert.equal(await send([{ player: "Where is Goldshire?", willo: "In Elwynn Forest. Want me to show you the way?" }]),
    "Head east from the Valley of Heroes, then south through the gates. Once you've paid him, you're all set to ride.");
  // Asked what's left, with all of it ticked: her true read-back stands.
  const { user: reader, token: readerToken } = await linked();
  seed(reader, "## To do\n- [x] Copper bars\n- [x] Silver ore\n");
  reply = () => said("Your list is all clear: you've ticked off the copper bars and the silver ore.");
  assert.equal((await ask(readerToken, "Is there anything left on my to-do?")).answer,
    "Your list is all clear: you've ticked off the copper bars and the silver ore.");
});
