// Willo's goals (lib/willo-goals.js, LOR-665): a goal is kept under Goals in the notebook only when the player says
// they want one; how it stands is worked out by the site from what the add-on saved (gold, level, skills, reputation,
// riding, their evenings) and Forever's prices, never by the model; a wrong gold amount is swapped for the plan's own
// line; a goal reached is ticked and cheered once; her check-ins can be turned off in a sentence; Hero and up while
// plans are sold. The cases follow the expected conversations on LOR-665.
// In-process on node:sqlite (helpers.mjs); Gemini is a stub. Run: node --test 'site/tests/*.test.mjs'
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequest as answer } from "../functions/api/companion/answer.js";
import { onRequest as notebookApi } from "../functions/api/notebook/[action].js";
import { findOrCreateUser, setup } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { notebookView, notebookTools } from "../lib/willo-notebook.js";
import { ACTIONS_MAX_BYTES } from "../lib/companion-answers.js";
import { helpTopics } from "../lib/willo-help.js";
import { SEED_FACTS } from "../lib/forever-knowledge.js";
import { RIDING } from "../lib/forever-game-facts.js";
import { stockOf, goalOf, goalLine, askedGoal, goalIntent, writesGoals, goalsOf, progressOf, goalsBlock, goalTools,
  goalChecks, paceOf, wrongGold, numbersIn, GOALS_MAX_BYTES, GOALS_ON_HERO, GOAL_RULES, QUIET_LINES } from "../lib/willo-goals.js";
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
async function linked(e = env) {
  const sub = `goaler${++n}`;
  const user = await findOrCreateUser(e, { email: `${sub}@example.com`, googleSub: sub, name: sub });
  const link = await startLink(e);
  await decideLink(e, link.user_code, user, true);
  return { user, token: (await claimToken(e, link.device_code)).token };
}
const HURIN = "Húrin-ClassicBetaPvE", PAGE = `char:${HURIN}`;
const NOW = Math.floor(Date.now() / 1000);
// Húrin from the expected conversations: a human paladin, level 36 and 60% of the way to 37, 72 gold 14 silver,
// Tailoring 120 of 150, Friendly with Stormwind and Ironforge (2,100 of 6,000), and about 9 gold and 0.8 of a level
// an evening over his last five.
const EVENINGS = [1, 2, 3, 4, 5].map(i => ({ d: `2026-10-1${i}`, m0: 270000 + i * 90000, m: 360000 + i * 90000,
  l0: 32.6 + i * 0.8, l: 33.4 + i * 0.8, on: 7200 }));
const hurin = (over = {}) => ({ t: NOW - 600, level: 36, xp: 60, xpMax: 100, money: 721400, riding: 0, race: "Human",
  skills: { Tailoring: [120, 150], Riding: [0, 0] }, rep: { Stormwind: [5, 5100, 3000, 9000], Ironforge: [5, 5100, 3000, 9000] },
  days: EVENINGS, ...over });
const ask = async (token, question, { stock = hurin(), style, e = env, character = HURIN } = {}) => (await answer({ env: e,
  request: new Request("https://example.test/api/companion/answer", { method: "POST", headers: {
    "X-LF-Client": "companion/0.22.0", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ prompt: `PLAYER CONTEXT\nzone: Elwynn Forest\nrace: Human\nclass: Paladin\nlevel: 36\n\n` +
    `SOURCES\n\nQUESTION\n${question}`, persona: "willo", notebook: { character }, ...(stock ? { stock } : {}),
    ...(style ? { style } : {}) }) }) })).json();
const usage = { usageMetadata: { promptTokenCount: 4000, candidatesTokenCount: 60 } };
const said = text => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }], ...usage });
const called = (name, args) => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ functionCall: { name, args } }] } }],
  ...usage });
const offered = body => (body?.tools?.[0]?.functionDeclarations || []).map(d => d.name);
const system = body => body.systemInstruction.parts[0].text;
const page = (user, key = PAGE) => env.DB.sqlite.prepare("SELECT body, version FROM notebook_pages WHERE user_id = ? AND page = ?")
  .get(user.id, key);
const write = (user, body, key = PAGE) => env.DB.sqlite.prepare("INSERT INTO notebook_pages (user_id, page, title, body, " +
  "version, updated) VALUES (?, ?, 'Húrin', ?, 1, '')").run(user.id, key, body);
const api = async (token, action, body, e = env) => {
  const res = await notebookApi({ env: e, params: { action }, request: new Request(`https://example.test/api/notebook/${action}`,
    { method: "POST", headers: { "X-LF-Client": "companion/0.22.0", Authorization: `Bearer ${token}`,
      "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  return { status: res.status, body: await res.json() };
};
const MOUNT_GOAL = "## Goals\n- [ ] Riding at level 40: 100 gold\n";

// ---- A goal, as a line ----

test("a goal's line reads back as the goal it says, and goalLine writes what goalOf reads", () => {
  const cases = {
    "Riding at level 40: 100 gold": { kind: "riding", skill: 75, gold: 100, at: null },
    "Riding at level 40: 95 gold": { kind: "riding", skill: 75, gold: 95, at: null },
    "Riding at level 45: 100 gold": { kind: "riding", skill: 75, gold: 100, at: 45 },
    "Journeyman riding at level 60: 1,000 gold": { kind: "riding", skill: 150, gold: 1000, at: null },
    "Mount at 40": { kind: "riding", skill: 75, gold: null, at: null },
    "Level 40": { kind: "level", level: 40 },
    "Save 200 gold": { kind: "gold", gold: 200 },
    "Tailoring 225": { kind: "skill", skill: "Tailoring", rank: 225 },
    "first aid 300": { kind: "skill", skill: "First Aid", rank: 300 },
    "Exalted with Ironforge": { kind: "rep", standing: 8, faction: "Ironforge" },
    "Honored with the Timbermaw Hold": { kind: "rep", standing: 6, faction: "Timbermaw Hold" },
    "Kirin Tor tabard": { kind: "other", text: "Kirin Tor tabard" },
  };
  for (const [line, goal] of Object.entries(cases)) {
    assert.deepEqual(goalOf(line), goal, line);
    assert.deepEqual(goalOf(goalLine(goal)), { ...goal, ...(goal.kind === "riding" ? { gold: goal.gold ?? RIDING[goal.skill].gold } : {}) }, line);
  }
  assert.equal(goalLine({ kind: "riding", skill: 75, gold: null }), "Riding at level 40: 100 gold");
  assert.equal(goalLine({ kind: "riding", skill: 75, gold: null, at: 45 }), "Riding at level 45: 100 gold");
});

test("the goal a question names, with a riding price only when the player says one", () => {
  assert.deepEqual(askedGoal("I want my mount at 40"), { kind: "riding", skill: 75, gold: null, at: null });
  assert.deepEqual(askedGoal("I want my epic mount"), { kind: "riding", skill: 150, gold: null, at: null });
  assert.deepEqual(askedGoal("Change my mount goal: I'll get it at level 45 instead."), { kind: "riding", skill: 75,
    gold: null, at: 45 });
  // Never earlier than Forever's.
  assert.deepEqual(askedGoal("I want my mount at 30"), { kind: "riding", skill: 75, gold: null, at: null });
  assert.deepEqual(askedGoal("the trainer actually asked me 95"), null);   // not about riding by its words: a change
  assert.deepEqual(askedGoal("the riding trainer actually asked me 95"), { kind: "riding", skill: 75, gold: 95, at: null });
  assert.deepEqual(askedGoal("I want my Tailoring at 225"), { kind: "skill", skill: "Tailoring", rank: 225 });
  assert.deepEqual(askedGoal("my goal is Exalted with Ironforge"), { kind: "rep", standing: 8, faction: "Ironforge" });
  assert.deepEqual(askedGoal("help me hit level 40 by the weekend"), { kind: "level", level: 40 });
  assert.deepEqual(askedGoal("I'm saving up 200 gold"), { kind: "gold", gold: 200 });
});

// ---- When she keeps one ----

const SETS = ["I want my mount at 40", "I want my Tailoring at 225", "my goal is Exalted with Ironforge",
  "help me hit level 40 by the weekend", "I'm saving up 200 gold", "set a goal: Tailoring 150", "I want my epic mount",
  "my goal is the Kirin Tor tabard", "new goal: honored with Darnassus", "I'd like to get my riding at 40",
  "Get Mining to 150", "willo, take my tailoring up to 225", "get me to level 40"];
const NOT_SETS = ["how do I get my mining to 150?", "how much is the mount?", "where's the riding trainer?", "I want to know about mounts", "who is Hogger?",
  "I need 10 linen cloth", "riding's 80 gold, right?", "what are my goals?", "how close am I to my mount?",
  "remember I need 10 linen cloth", "what should I do tonight?", "I want a flying mount someday? lol", "buy my mount for me when I hit 40"];

test("only telling her a goal (or changing, dropping, or quieting them) gets the goals' tools", () => {
  for (const q of SETS) assert.equal(goalIntent(q).set, true, q);
  for (const q of NOT_SETS.filter(q => !/flying|buy my mount/.test(q))) assert.equal(writesGoals(goalIntent(q, { have: true })), false, q);
  // Change and drop need a goal to change: "instead" without one is any other question.
  assert.equal(goalIntent("make the Tailoring goal 300 instead", { have: true }).change, true);
  assert.equal(goalIntent("what should I do instead?").change, false);
  assert.equal(goalIntent("the trainer actually asked me 95", { have: true }).change, true);
  assert.equal(goalIntent("drop the Ironforge goal", { have: true }).drop, true);
  assert.equal(goalIntent("forget the mount goal", { have: true }).drop, true);
  assert.equal(goalIntent("stop telling me about my goals", { have: true }).quiet, true);
  assert.equal(goalIntent("you can tell me about my goals again", { have: true }).quiet, false);
  for (const q of ["what are my goals?", "how close am I to my mount?", "am I on track?"]) assert.equal(goalIntent(q).read, true, q);
});

// ---- How a goal stands: Forever's numbers and theirs, worked out here ----

test("the mount at 40: level, Forever's price with the Honored discount, the trainer, and their pace", () => {
  const stock = stockOf(hurin());
  const p = progressOf({ kind: "riding", skill: 75, gold: null }, stock);
  const text = p.facts.join("\n");
  assert.equal(p.reached, false);
  assert.match(text, /Level: 36 of 40, 4 levels to go\./);
  assert.match(text, /asks 100 gold \(90 once they're Honored with Stormwind, 10 less, which would leave them 18 short; they're Friendly\)\. They have 72 gold: 28 short\./);
  assert.match(text, /Randal Hunter at Eastvale Logging Camp in Elwynn Forest/);
  assert.match(text, /Learning riding gives their first mount, so there's no mount to buy; only if they want another, their people's vendor sells more for 20 gold each/);
  assert.match(text, /about 9 gold and 0\.8 levels an evening\): the gold in about 3 evenings, level 40 in about 4 evenings/);
  assert.equal(p.summary, "Riding is 100 gold at level 40 from Randal Hunter, and it gives you your first mount: 4 levels " +
    "and 28 gold to go, about 4 evenings at your pace.");
  for (const k of [100, 90, 72, 28, 36, 40, 4, 3, 20]) assert.ok(p.numbers.has(k), k);
  // Honored with Stormwind: the 90 gold is the price.
  const honored = progressOf({ kind: "riding", skill: 75, gold: null }, stockOf(hurin({ rep: { Stormwind: [6, 9500, 9000, 21000] } })));
  assert.match(honored.facts.join(" "), /asks 90 gold \(with 10% off: they're Honored with Stormwind\)\. They have 72 gold: 18 short\./);
  // A price they saw themselves is the one counted, without the discount.
  const told = progressOf({ kind: "riding", skill: 75, gold: 95 }, stockOf(hurin()));
  assert.match(told.facts.join(" "), /asks 95 gold \(the price they told you they saw\)\. They have 72 gold: 23 short\./);
});

test("what she doesn't know she's told to say so: no save, no pace, the skyborne's trainer, a swift mount, a stale save", () => {
  const none = progressOf({ kind: "riding", skill: 75, gold: null }, null).facts.join(" ");
  assert.match(none, /can't see their level yet/);
  assert.match(none, /can't see their purse yet: say so, and that you will after their next \/reload or log out/);
  const fresh = progressOf({ kind: "gold", gold: 200 }, stockOf(hurin({ days: EVENINGS.slice(-1) }))).facts.join(" ");
  assert.match(fresh, /not enough evenings saved yet; say you'll know it after a couple more evenings/);
  const sky = progressOf({ kind: "riding", skill: 75, gold: null }, stockOf(hurin({ race: "Skyborne" }))).facts.join(" ");
  assert.match(sky, /Where their people learn to ride: you don't know yet, so say so/);
  const epic = progressOf({ kind: "riding", skill: 150, gold: null }, stockOf(hurin())).facts.join(" ");
  assert.match(epic, /asks 1,000 gold \(900 once/);
  assert.match(epic, /whether one comes with this training you don't know yet/);
  assert.match(epic, /the gold in about 103 evenings/);
  const stale = goalsBlock(goalsOf(view(MOUNT_GOAL)), stockOf(hurin({ t: NOW - 3 * 86400 })),
    { intent: goalIntent("how close am I to my mount?"), question: "how close am I to my mount?" });
  assert.match(stale.block, /3 days ago: say "as of your last save"/);
  const other = progressOf({ kind: "other", text: "Kirin Tor tabard" }, stockOf(hurin())).facts.join(" ");
  assert.match(other, /say plainly when you don't know a price or a step, and offer to look it up/);
});

test("a profession goal names the next rank and where it's taught; a reputation goal counts every standing", () => {
  const stock = stockOf(hurin());
  const tailoring = progressOf({ kind: "skill", skill: "Tailoring", rank: 225 }, stock).facts.join(" ");
  assert.match(tailoring, /Tailoring: their skill is 120 \(their rank stops at 150\); 105 points to go\./);
  assert.match(tailoring, /Expert \(up to 225\): taught from skill 125 at level 20; not yet: they need 5 more skill points \(they're at 120\) first\./);
  assert.doesNotMatch(tailoring, /Artisan/);
  assert.match(tailoring, /They already have Journeyman: don't bring it up as a step\./);
  // To 300: every rank on the way, and who teaches Artisan on their side.
  const to300 = progressOf({ kind: "skill", skill: "Tailoring", rank: 300 }, stock).facts.join(" ");
  assert.match(to300, /Expert \(up to 225\): taught from skill 125 at level 20; not yet: they need 5 more skill points \(they're at 120\) first\. Artisan \(up to 300\): taught from skill 200 at level 35; not yet: they need 80 more skill points \(they're at 120\) first\. Their side's Artisan tailoring trainer is Georgio Bolero in Stormwind's Mage Quarter\./);
  const young = progressOf({ kind: "skill", skill: "Tailoring", rank: 300 }, stockOf(hurin({ level: 30 }))).facts.join(" ");
  assert.match(young, /Artisan \(up to 300\): taught from skill 200 at level 35; not yet: they need 80 more skill points \(they're at 120\) and level 35 \(they're 30\) first\./);
  const horde = progressOf({ kind: "skill", skill: "Tailoring", rank: 300 }, stockOf(hurin({ race: "Scourge" }))).facts.join(" ");
  assert.match(horde, /Josef Gregorian in the Undercity's Magic Quarter/);
  // Qualified already: said plainly.
  const mining = progressOf({ kind: "skill", skill: "Mining", rank: 150 }, stockOf(hurin({ skills: { Mining: [60, 75] } }))).facts.join(" ");
  assert.match(mining, /Journeyman \(up to 150\): taught from skill 50 at level 10; they already qualify, so a mining trainer can teach it now\./);
  const cooking = progressOf({ kind: "skill", skill: "Cooking", rank: 225 }, stockOf(hurin({ skills: { Cooking: [150, 150] } })));
  assert.match(cooking.facts.join(" "), /Expert Cooking \(up to 225\) comes from a book, not a trainer/);
  const rep = progressOf({ kind: "rep", standing: 8, faction: "ironforge" }, stock);
  assert.match(rep.facts.join(" "), /Ironforge: Friendly, 2,100 of 6,000; 3,900 to Honored, then 12,000 to Revered, 21,000 to Exalted: 36,900 in all\./);
  assert.match(rep.facts.join(" "), /never how much each gives/);
  const unknown = progressOf({ kind: "rep", standing: 6, faction: "Kirin Tor" }, stock).facts.join(" ");
  assert.match(unknown, /not among the reputations in their last save/);
});

test("pace comes from evenings of 15 minutes or more, and the add-on's save is checked", () => {
  const pace = paceOf(stockOf(hurin()));
  assert.deepEqual([pace.evenings, pace.gold, Math.round(pace.levels * 10) / 10], [5, 9, 0.8]);
  assert.equal(paceOf(stockOf(hurin({ days: EVENINGS.map(d => ({ ...d, on: 300 })) }))), null);
  assert.equal(stockOf("nope"), null);
  assert.equal(stockOf({ level: "36" }), null);
  const odd = stockOf({ level: 36, money: -5, rep: { X: ["5"] }, skills: { Y: [999999] } });
  assert.equal(odd.money, null);
  assert.deepEqual(odd.rep, {});
  assert.deepEqual(odd.skills, {});
});

const view = (body, current = PAGE, intent = { read: true, write: false }) =>
  notebookView([{ page: current, title: "Húrin", body, version: 1 }], { current, intent });

test("THEIR GOALS: only the goals a question names, all of them for 'what are my goals?', within its bound", () => {
  const body = "## To do\n- [ ] Hogger\n\n## Goals\n- [ ] Riding at level 40: 100 gold\n- [ ] Tailoring 225\n" +
    "- [ ] Exalted with Ironforge\n- [ ] Level 40\n- [ ] Save 200 gold\n";
  const stock = stockOf(hurin());
  const goals = goalsOf(view(body));
  assert.deepEqual(goals.map(g => [g.num, g.text]), [[2, "Riding at level 40: 100 gold"], [3, "Tailoring 225"],
    [4, "Exalted with Ironforge"], [5, "Level 40"], [6, "Save 200 gold"]]);
  const mount = goalsBlock(goals, stock, { intent: goalIntent("how close am I to my mount?"), question: "how close am I to my mount?" });
  assert.match(mount.block, /^THEIR GOALS/);
  assert.match(mount.block, /2\. \[ \] Riding at level 40/);
  assert.doesNotMatch(mount.block, /Tailoring/);
  const all = goalsBlock(goals, stock, { intent: goalIntent("what are my goals?"), question: "what are my goals?" });
  for (const g of goals) assert.ok(all.block.includes(g.text), g.text);
  // A question that doesn't bear on them reads nothing.
  assert.equal(goalsBlock(goals, stock, { intent: goalIntent("who is Hogger?"), question: "who is Hogger?" }).block, "");
  // Forty goals still fit: whole goals, as many as fit.
  const many = goalsOf(view("## Goals\n" + Array.from({ length: 40 }, (_, i) => `- [ ] Level ${20 + (i % 40)}`).join("\n")));
  const big = goalsBlock(many, stock, { intent: goalIntent("what are my goals?"), question: "what are my goals?" });
  assert.ok(new TextEncoder().encode(big.block).length <= GOALS_MAX_BYTES);
  assert.ok(big.block.includes("Level 37"));
});

test("the goals' tools fit beside the notebook's, and the wrong-number guard catches a remembered price", () => {
  const v = view("## To do\n- [ ] a\n\n" + MOUNT_GOAL, PAGE, { read: true, write: true });
  const tools = [...notebookTools(v), ...goalTools({ set: true, change: true, drop: true, quiet: true },
    { goals: goalsOf(v), noteTools: notebookTools(v) }).filter(t => t.name !== "notebook_remove")];
  assert.ok(JSON.stringify(tools).length <= ACTIONS_MAX_BYTES, JSON.stringify(tools).length);
  const allowed = numbersIn("asks 100 gold (90 once Honored). They have 72 gold: 28 short.", "how close am I?");
  assert.equal(wrongGold("You're 28 gold short of the 100 gold.", allowed), false);
  assert.equal(wrongGold("Riding costs 80 gold.", allowed), true);
  assert.equal(wrongGold("That's 1,000g for the fast one.", numbersIn("1,000 gold")), false);
});

// ---- Through the answer path ----

test("1. setting the mount goal: she's given the plan's numbers, keeps the goal under Goals, and nothing is looked up", async () => {
  const { user, token } = await linked();
  reply = () => called("goal_set", { answer: "Four levels to go, then 100 gold to Randal Hunter at Eastvale. You have " +
    "72, so 28 short: about four evenings.", what: "riding" });
  const out = await ask(token, "I want my mount at 40");
  assert.equal(out.ok, true);
  assert.match(out.answer, /28 short/);
  assert.equal(out.notebook.change, "add");
  assert.equal(out.notebook.body, "## Goals\n- [ ] Riding at level 40: 100 gold\n");
  assert.deepEqual(out.notebook.changed, ["Riding at level 40: 100 gold"]);
  assert.equal(page(user).body, "## Goals\n- [ ] Riding at level 40: 100 gold\n");
  assert.ok(out.lookups.includes("goals"));
  const [body] = calls;
  assert.deepEqual(offered(body), ["goal_set", "answer_only"]);
  assert.ok(system(body).includes(GOAL_RULES));
  assert.match(system(body), /THE GOAL THEY'RE ASKING FOR \(not kept yet: keep it with goal_set if they want it kept\): Riding at level 40: 100 gold/);
  assert.match(system(body), /They have 72 gold: 28 short\./);
  assert.equal(body.tools.some(t => t.googleSearch), false);
});

test("the goal their words name is kept, whatever the call's arguments say, and never a claim for nothing", async () => {
  const { user, token } = await linked();
  write(user, MOUNT_GOAL);
  // Flash-Lite, live 10/18: their skill now instead of the goal, and no gold at all.
  reply = () => called("goal_set", { answer: "I've added Tailoring 225 to your goals! You're at 120.", what: "profession",
    profession: "Tailoring", skill: 120 });
  let out = await ask(token, "I want my Tailoring at 225");
  assert.equal(page(user).body, MOUNT_GOAL + "- [ ] Tailoring 225\n");
  assert.equal(out.answer, "Goal kept: Tailoring 225. You're at 120.");
  reply = () => called("goal_set", { answer: "I have added it to your notebook! You have 72 gold.", what: "gold" });
  out = await ask(token, "I'm saving up 200 gold");
  assert.match(page(user).body, /- \[ \] Save 200 gold\n/);
  // Words that name no goal it can count, and a call that makes no sense: nothing kept, and no "I've added it".
  reply = () => called("goal_set", { answer: "I've added that to your goals! Good luck.", what: "gold" });
  const before = page(user).version;
  out = await ask(token, "help me get there");
  assert.equal(page(user).version, before);
  assert.equal(out.answer, "Good luck.");
  // A goal said in so many words with nothing to count is kept in their words.
  reply = () => called("goal_set", { answer: "I've added it.", what: "other" });
  out = await ask(token, "my goal is the Kirin Tor tabard");
  assert.match(page(user).body, /- \[ \] Kirin Tor tabard\n/);
  assert.equal(out.answer, "Goal kept: Kirin Tor tabard.");
});

test("2, 7. checking progress or listing goals reads them and writes nothing", async () => {
  const { user, token } = await linked();
  write(user, MOUNT_GOAL);
  reply = () => said("Four levels and 28 gold to go. At your pace, about four evenings.");
  const out = await ask(token, "how close am I to my mount?");
  assert.equal(out.notebook, undefined);
  assert.equal(calls[0].tools, undefined);
  assert.match(system(calls[0]), /Riding at level 40: 100 gold\n {3}- Level: 36 of 40, 4 levels to go\./);
  assert.equal(page(user).version, 1);
});

test("4. out loud, from a save days old: her numbers are as of that save, never as now (LOR-673)", async () => {
  // The vision session's goalcheck (10/18): out loud, 5 of 6 answers gave a 3-day-old save's gold and levels as now,
  // though told to say "as of your last save"; written and typed ones did.
  const { user, token } = await linked();
  write(user, MOUNT_GOAL);
  const old = hurin({ t: NOW - 3 * 86400 });
  reply = () => said("You're four levels and twenty-eight gold away from your mount.");
  let out = await ask(token, "how's my mount goal?", { stock: old, style: "spoken" });
  assert.equal(out.answer, "As of your last save, you're four levels and twenty-eight gold away from your mount.");
  reply = () => said("As of your last save, four levels to go.");
  out = await ask(token, "how's my mount goal?", { stock: old, style: "spoken" });
  assert.equal(out.answer, "As of your last save, four levels to go.", "said once");
  // A fresh save, or typed: as she said it.
  reply = () => said("You're four levels and twenty-eight gold away from your mount.");
  out = await ask(token, "how's my mount goal?", { stock: hurin(), style: "spoken" });
  assert.equal(out.answer, "You're four levels and twenty-eight gold away from your mount.");
  out = await ask(token, "how's my mount goal?", { stock: old });
  assert.equal(out.answer, "You're four levels and twenty-eight gold away from your mount.", "typed: THEIR GOALS' own rule");
});

test("8, 12. a change replaces the goal (a price they saw, a new skill), never adding a second line; a remembered price is refused", async () => {
  const { user, token } = await linked();
  write(user, MOUNT_GOAL + "- [ ] Tailoring 225\n");
  reply = () => called("goal_set", { answer: "Then 95 it is. I'll count toward that.", what: "riding", gold: 95 });
  let out = await ask(token, "the trainer actually asked me 95");
  assert.equal(out.notebook.change, "update");
  assert.equal(page(user).body, "## Goals\n- [ ] Riding at level 40: 95 gold\n- [ ] Tailoring 225\n");
  reply = () => called("goal_set", { answer: "Changed: Tailoring 300 now.", what: "profession", profession: "Tailoring", skill: 300 });
  out = await ask(token, "make the Tailoring goal 300 instead");
  assert.equal(page(user).body, "## Goals\n- [ ] Riding at level 40: 95 gold\n- [ ] Tailoring 300\n");
  // A price the player never said isn't kept: the goal keeps Forever's.
  const { user: other, token: t2 } = await linked();
  reply = () => called("goal_set", { answer: "Kept.", what: "riding", gold: 80 });
  await ask(t2, "I want my mount at 40");
  assert.equal(page(other).body, "## Goals\n- [ ] Riding at level 40: 100 gold\n");
});

test("a new goal never takes another goal's line, whatever replaces the call names", async () => {
  const { user, token } = await linked();
  write(user, MOUNT_GOAL + "- [ ] Level 40\n");
  // Live, 10/18: replaces 1 (the riding goal) for a Tailoring goal, then the Level 40 line for a riding price.
  reply = () => called("goal_set", { answer: "Kept.", what: "profession", profession: "Tailoring", skill: 225, replaces: 1 });
  await ask(token, "I want my Tailoring at 225");
  assert.equal(page(user).body, MOUNT_GOAL + "- [ ] Level 40\n- [ ] Tailoring 225\n");
  reply = body => called("goal_set", { answer: "Then 95 it is.", what: "riding", gold: 95,
    replaces: Number(/(\d+)\. \[ \] Level 40/.exec(system(body))[1]) });
  await ask(token, "the riding trainer actually asked me 95");
  assert.equal(page(user).body, "## Goals\n- [ ] Riding at level 40: 95 gold\n- [ ] Level 40\n- [ ] Tailoring 225\n");
  // A change that names a goal of the same kind: that one ("the cheaper one instead": back from journeyman riding).
  const { user: u2, token: t2 } = await linked();
  write(u2, "## Goals\n- [ ] Journeyman riding at level 60: 1,000 gold\n- [ ] Level 40\n");
  reply = body => called("goal_set", { answer: "Changed.", what: "riding",
    replaces: Number(/(\d+)\. \[ \] Journeyman/.exec(system(body))[1]) });
  await ask(t2, "I'll get the cheaper one instead");
  assert.equal(page(u2).body, "## Goals\n- [ ] Riding at level 40: 100 gold\n- [ ] Level 40\n");
});

test("9. dropping a goal takes its line out with the notebook's own tool; the heading stays", async () => {
  const { user, token } = await linked();
  write(user, MOUNT_GOAL + "- [ ] Exalted with Ironforge\n");
  reply = body => {
    const n = /(\d+)\. \[ \] Exalted with Ironforge/.exec(system(body))?.[1];
    return called("notebook_remove", { answer: "Dropped. Ironforge can wait.", items: [Number(n)] });
  };
  const out = await ask(token, "drop the Ironforge goal");
  assert.deepEqual(offered(calls[0]), ["notebook_remove", "answer_only"]);
  assert.equal(out.answer, "Goal dropped: Exalted with Ironforge. Ironforge can wait.");
  assert.equal(page(user).body, MOUNT_GOAL);
});

test("12. the wrong-number guard: a gold amount she wasn't given becomes the plan's own line", async () => {
  const { user, token } = await linked();
  write(user, MOUNT_GOAL);
  reply = () => said("Riding costs 80 gold, and you have 72, so just 8 more!");
  const out = await ask(token, "how close am I to my mount?");
  assert.equal(out.answer, "Riding is 100 gold at level 40 from Randal Hunter, and it gives you your first mount: 4 levels " +
    "and 28 gold to go, about 4 evenings at your pace.");
});

test("11. a goal the save shows reached: her answer opens with a cheer and the line is ticked", async () => {
  const { user, token } = await linked();
  write(user, MOUNT_GOAL);
  reply = () => said("Hogger's a gnoll in Elwynn.");
  const out = await ask(token, "who is Hogger?", { stock: hurin({ level: 40, riding: 75, money: 50000 }) });
  assert.match(system(calls[0]), /Just reached, by their last save \(already cheered before your answer; don't repeat it\): Riding at level 40: 100 gold\./);
  assert.equal(out.answer, "Level 40 and riding at last! Your first mount is yours. Hogger's a gnoll in Elwynn.");
  assert.equal(out.notebook.change, "check");
  assert.equal(page(user).body, "## Goals\n- [x] Riding at level 40: 100 gold\n");
  // Ticked, it's done: the next answer doesn't cheer again.
  calls = [];
  await ask(token, "who is Hogger?", { stock: hurin({ level: 40, riding: 75 }) });
  assert.doesNotMatch(system(calls[0]), /Just reached/);
});

test("check-ins off in a sentence: the reply tells her app, and nothing is written", async () => {
  const { user, token } = await linked();
  write(user, MOUNT_GOAL);
  reply = () => called("goal_checkins", { answer: "", on: false });
  const out = await ask(token, "stop telling me about my goals");
  assert.deepEqual(out.goals, { checkins: false });
  assert.equal(out.answer, QUIET_LINES[true]);
  assert.equal(page(user).version, 1);
});

test("14, 15. not asked, nothing is offered or written; she never offers to act in the game", async () => {
  const { user, token } = await linked();
  write(user, MOUNT_GOAL);
  for (const q of NOT_SETS) {
    calls = [];
    reply = () => said("An answer.");
    await ask(token, q);
    assert.ok(!offered(calls[0]).some(name => name === "goal_set"), q);
  }
  assert.equal(page(user).version, 1);
  assert.match(GOAL_RULES, /You advise only: you never buy, sell, train or do anything in the game for them\./);
  assert.match(GOAL_RULES, /no flying mounts/);
});

test("11, 18. goals stay on their character's page; 'what are my goals?' is the site's own list, never the chat's", async () => {
  const { user, token } = await linked();
  write(user, MOUNT_GOAL + "- [ ] Tailoring 225\n");
  write(user, "## Goals\n- [ ] Save 1,000 gold\n", "account");
  // Brynn, after Húrin set his goal in the same chat: only the account's goal, and no model call to mix them up.
  let out = await ask(token, "What are my goals?", { character: "Brynn-ClassicBetaPvE", stock: hurin({ level: 20, money: 120000 }) });
  assert.equal(out.answer, "For all your characters: saving 1,000 gold: 988 to go.");
  assert.equal(calls.length, 0);
  out = await ask(token, "what are my goals?");
  assert.equal(out.answer, "Húrin's goals: riding at level 40 for 100 gold: 4 levels and 28 gold to go; Tailoring 225: " +
    "at 120, 105 to go. For all your characters: saving 1,000 gold: 928 to go.");
  env.DB.sqlite.prepare("DELETE FROM notebook_pages WHERE page = 'account'").run();
  out = await ask(token, "what are my goals?", { character: "Brynn-ClassicBetaPvE" });
  assert.equal(out.answer, "Brynn has no goals yet.");
  // Her other answers about goals read only this character's page too.
  await ask(token, "how close am I to my mount?", { character: "Brynn-ClassicBetaPvE" });
  assert.doesNotMatch(system(calls.at(-1)), /Riding at level 40/);
});

test("6. a change of level is a real change: the riding goal for 45, her line from what was written", async () => {
  const { user, token } = await linked();
  write(user, MOUNT_GOAL);
  reply = () => said("That's already one of your goals. Goal updated: riding at level 45 for 100 gold. Nine levels to go.");
  const out = await ask(token, "Change my mount goal: I'll get it at level 45 instead.");
  assert.equal(page(user).body, "## Goals\n- [ ] Riding at level 45: 100 gold\n");
  assert.equal(out.answer, "Goal changed: riding at level 45 for 100 gold. Nine levels to go.");
  // Her own second confirmation after the site's line goes too.
  reply = () => said("Updated: your goal is now riding at level 45. Noted: your goal is updated. Nine levels to go.");
  const twice = await ask(token, "Change my mount goal: I'll get it at level 45 instead.");
  assert.equal(twice.answer, "That's already one of your goals: riding at level 45 for 100 gold. Nine levels to go.");
  assert.match(system(calls[0]), /Level: 36 of 45, 9 levels to go \(riding opens at 40; they chose to ride at 45\)/);
  // Nothing written, nothing claimed: "Goal updated" never stands on its own.
  reply = () => said("Goal updated: riding at level 50. You're doing great.");
  const again = await ask(token, "how close am I to my mount?");
  assert.equal(again.answer, "You're doing great.");
});

test("7. dropping by what it's about: 'forget the mount goal' takes the riding line; two that fit get her question", async () => {
  const { user, token } = await linked();
  write(user, MOUNT_GOAL + "- [ ] Save 200 gold\n");
  reply = () => said("Okay.");
  let out = await ask(token, "Forget the mount goal.");
  assert.equal(page(user).body, "## Goals\n- [ ] Save 200 gold\n");
  assert.equal(out.answer, "Goal dropped: riding at level 40 for 100 gold.");
  write(user, "## Goals\n- [ ] Save 1,000 gold\n", "account");
  out = await ask(token, "forget the gold goal");
  assert.equal(out.answer, "Which one: saving 200 gold or saving 1,000 gold?");
});

test("17. the free plan while plans are sold: no goal kept, and (typed only) one plain line that goals come with Hero", async () => {
  const plans = { ...env, SITE_FEATURES: "plans", LAUNCH_WEEK_START: "2020-01-01T00:00:00Z", BETA_END: "2020-02-01T00:00:00Z" };
  const { user, token } = await linked(plans);
  reply = () => said("Riding is level 40 and 100 gold.");
  await ask(token, "I want my mount at 40", { e: plans });
  assert.equal(calls[0].tools, undefined);
  assert.ok(system(calls[0]).includes(GOALS_ON_HERO));
  assert.equal(page(user), undefined);
  calls = [];
  await ask(token, "I want my mount at 40", { e: plans, style: "spoken" });
  assert.ok(!system(calls[0]).includes(GOALS_ON_HERO));
  // Her app's check after a save gets nothing on the free plan.
  write(user, MOUNT_GOAL);
  assert.deepEqual((await api(token, "goals", { character: HURIN, stock: hurin({ level: 40, riding: 75 }) }, plans)).body,
    { ok: true, checks: [], pages: [] });
});

// ---- After a save: POST /api/notebook/goals ----

test("10. after a save: a goal reached is ticked with her cheer; the others get a check-in and its mark", async () => {
  const { user, token } = await linked();
  write(user, "## Goals\n- [ ] Riding at level 40: 100 gold\n- [ ] Tailoring 225\n- [ ] Kirin Tor tabard\n");
  const res = await api(token, "goals", { character: HURIN, stock: hurin({ level: 40, riding: 75 }) });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.checks, [
    { goal: "Riding at level 40: 100 gold", page: PAGE, reached: true, mark: "40|2",
      line: "Level 40 and riding at last! Your first mount is yours." },
    { goal: "Tailoring 225", page: PAGE, reached: false, mark: "4|150", line: "Tailoring 120: 105 to go." },
  ]);
  assert.equal(res.body.pages[0].body, "## Goals\n- [x] Riding at level 40: 100 gold\n- [ ] Tailoring 225\n- [ ] Kirin Tor tabard\n");
  assert.equal(page(user).body, res.body.pages[0].body);
  // Riding and level 40 reached together: both ticked, one cheer.
  const { user: u2, token: t2 } = await linked();
  write(u2, MOUNT_GOAL + "- [ ] Level 40\n");
  const both = await api(t2, "goals", { character: HURIN, stock: hurin({ level: 40, riding: 75 }) });
  assert.deepEqual(both.body.checks.map(c => [c.goal, c.reached, c.line]), [
    ["Riding at level 40: 100 gold", true, "Level 40 and riding at last! Your first mount is yours."], ["Level 40", true, ""]]);
  // Ticked once: the next save has no cheer for it.
  const again = await api(token, "goals", { character: HURIN, stock: hurin({ level: 40, riding: 75 }) });
  assert.deepEqual(again.body.checks.map(c => c.goal), ["Tailoring 225"]);
  assert.equal((await api(token, "goals", { character: HURIN, stock: "nope" })).status, 400);
});

test("5. old enough with the gold but not trained: she says they're ready, and where, for their people", () => {
  const goals = goalsOf(view(MOUNT_GOAL));
  const ready = goalChecks(goals, stockOf(hurin({ level: 40, money: 1100000 })));
  assert.deepEqual(ready.map(c => [c.reached, c.mark, c.line]), [[false, "40|4",
    "You're ready to ride: Randal Hunter at Eastvale Logging Camp in Elwynn Forest teaches it for 100 gold."]]);
  // An undead (paladin or not: riding is your people's): Brill's trainer.
  const undead = goalChecks(goals, stockOf(hurin({ level: 40, money: 1100000, race: "Scourge" })));
  assert.match(undead[0].line, /Velma Warnam in Brill, Tirisfal Glades teaches it for 100 gold/);
});

test("21. no goal pressure: a question that doesn't bear on their goals reads none, and nothing ever suggests one", async () => {
  const { user, token } = await linked();
  write(user, MOUNT_GOAL);
  for (const q of ["I'm just exploring tonight", "what should I do in Westfall?", "tell me about the Defias"]) {
    calls = [];
    await ask(token, q);
    assert.doesNotMatch(system(calls[0]), /THEIR GOALS|goal_set|GOALS:/, q);
  }
  // With no goals at all, nothing about goals reaches her, whatever the question.
  const { token: t2 } = await linked();
  for (const q of ["how much is the mount?", "I'm just exploring tonight"]) {
    calls = [];
    await ask(t2, q);
    assert.doesNotMatch(system(calls[0]), /THEIR GOALS|goal_set|GOALS:/, q);
  }
});

test("goalChecks: marks move only on what matters (a level, a quarter of the gold, 25 skill points, a standing)", () => {
  const goals = goalsOf(view("## Goals\n- [ ] Riding at level 40: 100 gold\n- [ ] Exalted with Ironforge\n"));
  const before = goalChecks(goals, stockOf(hurin()));
  const silver = goalChecks(goals, stockOf(hurin({ money: 721400 + 500 })));
  assert.deepEqual(before.map(c => c.mark), silver.map(c => c.mark));
  const level = goalChecks(goals, stockOf(hurin({ level: 37 })));
  assert.notEqual(level[0].mark, before[0].mark);
  assert.equal(level[0].line, "Level 37: 3 levels and 28 gold to go for your riding.");
  const honored = goalChecks(goals, stockOf(hurin({ rep: { Ironforge: [6, 9100, 9000, 21000] } })));
  assert.equal(honored[1].line, "Honored with Ironforge now: 32,900 to Exalted.");
});

// ---- Her help and Forever's facts ----

test("her help knows goals, only for a question about what she does with them", () => {
  assert.deepEqual(helpTopics("can you track my goals?"), ["goals"]);
  assert.deepEqual(helpTopics("how do goals work?"), ["goals"]);
  for (const q of ["set a goal: Tailoring 150", "can you tell me my goals?", "I want my mount at 40"]) assert.deepEqual(helpTopics(q), [], q);
});

test("Forever's riding price is a checked fact, with the same numbers her goals count", () => {
  const fact = SEED_FACTS.find(f => f.id === "riding-costs");
  assert.match(fact.text, /level 40 from your people's riding trainer for 100 gold \(60% faster\), and it gives you your first mount/);
  assert.match(fact.text, /Journeyman riding \(100% faster\) is level 60 and 1,000 gold/);
  assert.match(SEED_FACTS.find(f => f.id === "profession-ranks").text, /Journeyman takes your skill to 150, taught from skill 50 at level 10; Expert takes your skill to 225, taught from skill 125 at level 20; Artisan takes your skill to 300, taught from skill 200 at level 35/);
  assert.match(SEED_FACTS.find(f => f.id === "artisan-trainers").text, /Tailoring: Georgio Bolero in Stormwind's Mage Quarter \(Alliance\), Josef Gregorian in the Undercity's Magic Quarter \(Horde\)/);
  assert.match(SEED_FACTS.find(f => f.id === "riding-mounts").text, /gives you your first mount, so you don't buy one\. Only if you want more, your people's mount vendor sells them for 20 gold each at level 40, and swift ones for 200 gold at level 60/);
});
