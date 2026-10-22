// Willo's goals off the PC (LOR-665 follow-up, 10/21): the PC's app sends the character's last save with its profile
// update (POST /api/profile/sync `stock`), the site keeps only the newest per character (lib/willo-stock.js), an answer
// that comes without a save of its own (the iPhone) reads it in the notebook's batch and says its numbers as of that
// save, and What Willo keeps shows it and erases it.
// In-process on node:sqlite (helpers.mjs); Gemini is a stub. Run: node --test site/tests/willo-stock.test.mjs
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequest as answer } from "../functions/api/companion/answer.js";
import { onRequest as profileApi } from "../functions/api/profile/[action].js";
import { onRequest as keepsApi } from "../functions/api/keeps/[action].js";
import { findOrCreateUser, setup, startSession, deleteUser } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { readStock, saveStock, savedStock, STOCK_MAX } from "../lib/willo-stock.js";
import { goalsBlock, goalsList, goalsOf, goalIntent, stockOf } from "../lib/willo-goals.js";
import { notebookView } from "../lib/willo-notebook.js";
import { d1 } from "./helpers.mjs";
import { RECORD } from "./fixtures/journey/record.mjs";

const ORIGIN = "https://example.test";
const env = { DB: d1(), GEMINI_API_KEY: "test-key" };
const originalFetch = globalThis.fetch;
let calls, reply;

beforeEach(async () => {
  await setup(env);
  for (const table of ["notebook_pages", "willo_stock", "rate_limits"]) env.DB.sqlite.exec(`DELETE FROM ${table}`);
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
  const sub = `stocker${++n}`;
  const user = await findOrCreateUser(env, { email: `${sub}@example.com`, googleSub: sub, name: sub });
  const link = await startLink(env);
  await decideLink(env, link.user_code, user, true);
  return { user, token: (await claimToken(env, link.device_code)).token };
}
const AELRIC = "Aelric-Forever", PAGE = `char:${AELRIC}`;
const NOW = Math.floor(Date.now() / 1000);
const save = (over = {}) => ({ character: AELRIC, t: NOW - 600, level: 36, xp: 60, xpMax: 100, money: 721400, riding: 0,
  race: "Human", skills: { Tailoring: [120, 150] }, rep: { Stormwind: [5, 5100, 3000, 9000] }, days: [], ...over });
const stored = user => env.DB.sqlite.prepare("SELECT * FROM willo_stock WHERE user_id = ?").all(user.id);

// A sync from the PC's app: the profile's record and the save.
async function sync(token, stock, extra = {}) {
  env.DB.sqlite.exec("DELETE FROM rate_limits");
  const res = await profileApi({ env, params: { action: "sync" }, request: new Request(`${ORIGIN}/api/profile/sync`, {
    method: "POST", headers: { "X-LF-Client": "companion/0.22.0", Authorization: `Bearer ${token}`,
      "Content-Type": "application/json" }, body: JSON.stringify({ record: RECORD, ...(stock === undefined ? {} : { stock }), ...extra }) }) });
  return { status: res.status, body: await res.json() };
}

const usage = { usageMetadata: { promptTokenCount: 4000, candidatesTokenCount: 60 } };
const said = text => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }], ...usage });
const system = body => body.systemInstruction.parts[0].text;
const GOAL = "## Goals\n- [ ] Riding at level 40: 100 gold\n";
const write = (user, body = GOAL, key = PAGE) => env.DB.sqlite.prepare("INSERT INTO notebook_pages (user_id, page, title, body, " +
  "version, updated) VALUES (?, ?, 'Aelric', ?, 1, '')").run(user.id, key, body);

// An answer asked as the phone asks it: the character's page, no save of its own unless one is given.
const ask = async (token, question, { stock, style, e = env, character = AELRIC } = {}) => (await answer({ env: e,
  request: new Request(`${ORIGIN}/api/companion/answer`, { method: "POST", headers: {
    "X-LF-Client": "companion/ios-1.0", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ prompt: `PLAYER CONTEXT\nzone: Elwynn Forest\nrace: Human\nclass: Paladin\nlevel: 30\n\n` +
    `SOURCES\n\nQUESTION\n${question}`, persona: "willo", notebook: { character }, ...(stock ? { stock } : {}),
    ...(style ? { style } : {}) }) }) })).json();

test("a sync keeps the character's newest save, and an older or odd one never replaces it", async () => {
  const { user, token } = await linked();
  assert.equal((await sync(token, save({ t: NOW - 3000, money: 100000 }))).status, 200);
  assert.equal(stored(user).length, 1);
  assert.equal(JSON.parse(stored(user)[0].stock).money, 100000);
  // Newer replaces; an older one arriving late (a retry, another PC) leaves it.
  await sync(token, save({ t: NOW - 600, money: 721400 }));
  await sync(token, save({ t: NOW - 2000, money: 5 }));
  const [row] = stored(user);
  assert.equal(row.character, AELRIC);
  assert.equal(row.t, NOW - 600);
  assert.equal(JSON.parse(row.stock).money, 721400);
  assert.equal(JSON.parse(row.stock).character, undefined, "the key is the row's, not part of the save");
  // Junk: each syncs (200, the profile stands) and keeps nothing new.
  const junk = [[save({ character: "Brynn-Forever" })], [{ ...save(), character: "x" }], ["stock"], [[1, 2]], [null],
    [save({ t: undefined })], [save({ t: NOW + 30 * 86400 })], [save({ t: "now" })], [{ character: AELRIC, level: 99 }],
    [{ ...save(), skills: Object.fromEntries(Array.from({ length: 4000 }, (_, i) => [`Skill ${i}`, [1, 2]])),
      pad: "x".repeat(40000) }]];
  for (const [bad] of junk) {
    const out = await sync(token, bad);
    assert.equal(out.status, 200, JSON.stringify(bad)?.slice(0, 60));
    assert.deepEqual(stored(user).map(r => [r.t, r.stock]), [[row.t, row.stock]]);
  }
  // Out-of-range numbers are dropped by the same reader the answers use: gold can't be negative or a string.
  const odd = readStock(save({ money: -5, level: 500, skills: { Mining: ["x"] } }), null);
  assert.equal(JSON.parse(odd.json).money, null);
  assert.equal(JSON.parse(odd.json).level, null);
});

test("a sync with no save, or for no character, still syncs; at most STOCK_MAX characters an account", async () => {
  const { user, token } = await linked();
  assert.equal((await sync(token)).status, 200);
  assert.equal(stored(user).length, 0);
  for (let i = 0; i < STOCK_MAX + 3; i++) await saveStock(env, user.id, readStock(save({ character: `Alt${i}-Forever` })));
  assert.equal(stored(user).length, STOCK_MAX);
  // One that's already kept still updates at the cap.
  const first = stored(user)[0].character;
  assert.equal(await saveStock(env, user.id, readStock(save({ character: first, t: NOW - 10 }))), true);
});

test("asked from the phone with no save of its own: the kept save's numbers, said as of that save", async () => {
  const { user, token } = await linked();
  write(user);
  await sync(token, save());
  reply = () => said("You're four levels and twenty-eight gold away from your mount.");
  const out = await ask(token, "how's my mount goal?");
  assert.equal(out.answer, "As of your last save, you're four levels and twenty-eight gold away from your mount.");
  // The model was given the numbers (72 gold, level 36), told they're from the last save, and never "/reload".
  const text = system(calls.at(-1));
  assert.match(text, /THEIR GOALS/);
  assert.match(text, /They have 72 gold \(as of their last save\)/);
  assert.match(text, /say "as of your last save"/);
  assert.doesNotMatch(text.slice(text.indexOf("THEIR GOALS")), /\/reload|SavedVariables|\bsync\b/);
  // A fresh save (10 minutes old) from the kept row is still not live: said as of the save, typed too.
  assert.match(text, /Level: 36 \(as of their last save\) of 40/);
});

test("a save sent with the question always wins over the kept one", async () => {
  const { user, token } = await linked();
  write(user);
  await sync(token, save({ money: 100000 }));          // 10 gold kept
  reply = () => said("Twenty-eight gold to go.");
  const out = await ask(token, "how's my mount goal?", { stock: { t: NOW - 60, level: 36, xp: 60, xpMax: 100, money: 721400, riding: 0 } });
  assert.equal(out.answer, "Twenty-eight gold to go.", "the question's own save is live, as before");
  assert.match(system(calls.at(-1)), /They have 72 gold: 28 short/);
  assert.doesNotMatch(system(calls.at(-1)), /They have 10 gold/);
});

test("nothing kept and nothing sent: she can't see it yet, in the game's words and never /reload", async () => {
  const { user, token } = await linked();
  write(user);
  await ask(token, "how's my mount goal?");
  const text = system(calls.at(-1));
  assert.match(text, /can't see their purse yet/);
  assert.doesNotMatch(text.slice(text.indexOf("THEIR GOALS")), /\/reload|SavedVariables|\bsync\b/);
});

test("another character's or another account's save is never read", async () => {
  const a = await linked(), b = await linked();
  write(a.user); write(b.user);
  await sync(a.token, save());
  await ask(b.token, "how's my mount goal?");
  assert.match(system(calls.at(-1)), /can't see their purse yet/, "another account's");
  await ask(a.token, "how's my mount goal?", { character: "Brynn-Forever" });
  assert.doesNotMatch(system(calls.at(-1)), /They have 72 gold/, "another character's");
});

test("the kept save rides in the notebook's batch: the answer makes no extra trip to D1", async () => {
  const { user, token } = await linked();
  write(user);
  await sync(token, save());
  // Count the trips to D1 an answer makes (a batch is one), with the save kept, sent, and neither.
  const trips = async stock => {
    let count = 0, saw = false, inBatch = false;
    const wrap = target => new Proxy(target, { get(t, k) {
      const v = t[k];
      if (k === "batch") return async list => { count++; saw ||= list.some(s => /willo_stock/.test(s.sql)); inBatch = true; try { return await v.call(t, list); } finally { inBatch = false; } };
      if (k === "prepare") return sql => { const s = v.call(t, sql); return new Proxy(s, { get(st, sk) {
        if (sk === "sql") return sql;
        if (sk === "bind") return (...a) => { const b = st.bind(...a); return new Proxy(b, { get(bt, bk) {
          if (bk === "sql") return sql;
          const bv = bt[bk];
          return ["first", "all", "run"].includes(bk) ? (...x) => { if (!inBatch) count++; saw ||= /willo_stock/.test(sql); return bv.apply(bt, x); } : bv; } }); };
        const sv = st[sk];
        return ["first", "all", "run"].includes(sk) ? (...x) => { if (!inBatch) count++; saw ||= /willo_stock/.test(sql); return sv.apply(st, x); } : sv; } }); };
      return typeof v === "function" ? v.bind(t) : v;
    } });
    const e = { ...env, DB: wrap(env.DB) };
    await ask(token, "how's my mount goal?", { stock, e });
    return { count, saw };
  };
  await trips(undefined);                   // the first answer of the day writes its own counters
  const kept = await trips(undefined);
  const sent = await trips(save());
  assert.equal(kept.saw, true, "the save is read");
  assert.equal(sent.saw, false, "not read when the question carries one");
  assert.equal(kept.count, sent.count, "reading it costs no round trip of its own");
});

test("stored numbers are always as of the last save, never live: the block, the list and the plan's own line", () => {
  const stock = { ...stockOf(save({ t: NOW - 60 })), fromSave: true };
  const goals = goalsOf(notebookView([{ page: PAGE, title: "Aelric", body: GOAL, version: 1 }], { current: PAGE, intent: { read: true, write: false } }));
  const q = "how's my mount goal?";
  const block = goalsBlock(goals, stock, { intent: goalIntent(q), question: q });
  assert.equal(block.stale, true);
  assert.match(block.block, /They have 72 gold \(as of their last save\)/);
  const live = goalsBlock(goals, { ...stock, fromSave: undefined }, { intent: goalIntent(q), question: q });
  assert.equal(live.stale, false);
  assert.match(live.block, /They have 72 gold: 28 short/);
  assert.match(goalsList(goals, stock, { current: PAGE }), /That's as of your last save\.$/);
  assert.equal(savedStock("not json"), null);
  assert.equal(savedStock(JSON.stringify(stockOf(save()))).fromSave, true);
});

test("What Willo keeps shows the kept save, and erasing it (one, a section, everything, the account) deletes the rows", async () => {
  const { user, token } = await linked();
  const cookie = (await startSession(env, new Request(ORIGIN), user.id)).split(";")[0];
  const keeps = async (action, body) => {
    const res = await keepsApi({ env, params: { action }, request: new Request(`${ORIGIN}/api/keeps/${action}`, body === undefined
      ? { headers: { Cookie: cookie } } : { method: "POST", headers: { Cookie: cookie, Origin: ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify(body) }) });
    return { status: res.status, body: await res.json() };
  };
  await sync(token, save());
  await saveStock(env, user.id, readStock(save({ character: "Brynn-Forever", money: 50000 })));
  const view = (await keeps("all")).body;
  const section = view.sections.find(s => s.id === "saves");
  assert.equal(section.items.length, 2);
  assert.match(section.items.find(i => i.character === AELRIC).text, /Level 36, 72 gold, 1 skills, 1 reputations/);
  assert.doesNotMatch(JSON.stringify(section), /reload|SavedVariables/i);
  assert.deepEqual((await keeps("erase", { section: "saves", id: "Brynn-Forever" })).body, { ok: true, gone: true });
  assert.equal(stored(user).length, 1);
  await keeps("erase-section", { section: "saves", character: AELRIC });
  assert.equal(stored(user).length, 0);
  await sync(token, save());
  assert.equal(stored(user).length, 1);
  assert.equal((await keeps("erase-all", { confirm: "erase" })).status, 200);
  assert.equal(stored(user).length, 0, "Erase everything takes the kept save too");
  await sync(token, save());
  await deleteUser(env, user);
  assert.equal(stored(user).length, 0, "deleting the account too");
});
