// What Willo keeps (LOR-666, lib/willo-keeps.js, functions/api/keeps/[action].js): the page shows a player only their
// own kept things, every erase really deletes the rows (and never another player's), Erase everything takes it all
// and tells Willo's app to clear her chats, and the app says when it has. D1 is node:sqlite (helpers.mjs).
// Run: node --test 'site/tests/*.test.mjs'

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { onRequest as keepsApi } from "../functions/api/keeps/[action].js";
import { findOrCreateUser, setup, startSession, deleteUser } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { logAnswer, setupAnswerLog } from "../lib/answer-log.js";
import { logFeedback, setupFeedback } from "../lib/answer-feedback.js";
import { setSharing, savePresence } from "../lib/friends.js";
import { setupWilloCustom } from "../lib/willo-custom.js";
import { KEEPERS, setupKeeps, CHATS } from "../lib/willo-keeps.js";
import { safeNext } from "../lib/weblogin.js";
import { helpTopics, helpBlock } from "../lib/willo-help.js";
import { actionsFor, actionOf, offerLine, keepsOffer } from "../lib/willo-tools.js";
import { d1 } from "./helpers.mjs";

const ORIGIN = "https://preview.example";
const env = { DB: d1() };
const rows = (table, where = "1", ...args) => env.DB.sqlite.prepare(`SELECT * FROM ${table} WHERE ${where}`).all(...args);

beforeEach(async () => {
  await setup(env);
  await setupAnswerLog(env);
  await setupFeedback(env);
  await setupKeeps(env);
  await setupWilloCustom(env);
  for (const t of ["users", "sessions", "devices", "device_links", "profiles", "rate_limits", "answer_log",
                   "answer_feedback", "keeps_changes", "keeps_cleared", "keeps_settings", "friend_people", "friend_edges",
                   "custom_prompts"]) env.DB.sqlite.exec(`DELETE FROM ${t}`);
});

// A signed-in player on our page, and the same account's Willo app.
async function player(handle) {
  const user = await findOrCreateUser(env, { email: `${handle}@example.com`, googleSub: handle, name: handle });
  const cookie = (await startSession(env, new Request(ORIGIN), user.id)).split(";")[0];
  const link = await startLink(env);
  await decideLink(env, link.user_code, user, true);
  const { token } = await claimToken(env, link.device_code);
  const send = async (action, body, headers) => {
    const method = body === undefined ? "GET" : "POST";
    const request = new Request(`${ORIGIN}/api/keeps/${action}`, { method, headers: new Headers({
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}), ...headers }),
      body: method === "POST" ? JSON.stringify(body) : undefined });
    const res = await keepsApi({ request, env, params: { action: action.split("?")[0] } });
    return { status: res.status, body: await res.json() };
  };
  const page = (action, body) => send(action, body, { Cookie: cookie, ...(body === undefined ? {} : { Origin: ORIGIN }) });
  const app = (action, body) => send(action, body, { "X-LF-Client": "companion/0.21.0", Authorization: `Bearer ${token}` });
  return { user, page, app };
}

const section = (view, id) => view.sections.find(s => s.id === id);

async function keepSome(user, zone = "Westfall") {
  await logAnswer(env, user.id, { question: "Where is Sentinel Hill, Hurin?", answer: "East of the farms, Hurin.",
    zone, sub: "Sentinel Hill", spoken: true, outcome: "answered" }, { names: ["Hurin"] });
  await logAnswer(env, user.id, { question: "Who is Gryan?", answer: "The People's Militia's founder.", zone,
    outcome: "answered" });
  await logFeedback(env, user.id, { kind: "correction", said: "That's wrong, it's in Westfall.", question: "Where?",
    answer: "Duskwood.", zone });
}

test("the page shows only the player's own kept answers and flags, in plain words", async () => {
  const hurin = await player("hurin"), lena = await player("lena");
  await keepSome(hurin.user);
  await keepSome(lena.user, "Elwynn Forest");
  const { status, body } = await hurin.page("all");
  assert.equal(status, 200);
  const answers = section(body, "answers");
  assert.deepEqual(answers.items.map(i => i.text), ["Who is Gryan?", "Where is Sentinel Hill, [your name]?"]);
  assert.equal(answers.items[1].reply, "East of the farms, [your name].");
  assert.equal(answers.items[1].detail, "Asked out loud in Sentinel Hill, Westfall");
  assert.equal(answers.edit, false, "a kept answer is a record: erase only");
  assert.match(answers.kept, /14 days/);
  const wrong = section(body, "wrong");
  assert.deepEqual(wrong.items.map(i => i.text), ["That's wrong, it's in Westfall."]);
  assert.doesNotMatch(JSON.stringify(body), /Elwynn/, "never another player's");
  assert.doesNotMatch(JSON.stringify(body), /answer_log|user_hash|player_key/, "no table names");
  assert.equal(body.journey, null);
  assert.equal(body.apps.length, 1);
});

test("Erase removes the row itself, and only the player's own", async () => {
  const hurin = await player("hurin"), lena = await player("lena");
  await keepSome(hurin.user);
  await keepSome(lena.user);
  const before = rows("answer_log").length;
  const mine = section((await hurin.page("all")).body, "answers").items[0];
  const theirs = section((await lena.page("all")).body, "answers").items[0];
  assert.deepEqual((await hurin.page("erase", { section: "answers", id: theirs.id })).body, { ok: true, gone: false });
  assert.equal(rows("answer_log").length, before, "another player's answer can't be erased");
  assert.deepEqual((await hurin.page("erase", { section: "answers", id: mine.id })).body, { ok: true, gone: true });
  assert.equal(rows("answer_log", "id = ?", Number(mine.id)).length, 0, "gone from the database");
  assert.equal(rows("answer_log").length, before - 1);
  const flag = section((await hurin.page("all")).body, "wrong").items[0];
  assert.equal((await hurin.page("erase", { section: "wrong", id: flag.id })).body.gone, true);
  assert.equal(rows("answer_feedback", "id = ?", Number(flag.id)).length, 0);
  assert.equal(rows("answer_feedback").length, 1, "Lena's stays");
  assert.equal((await hurin.page("edit", { section: "answers", id: mine.id, text: "x" })).status, 400,
    "answers can't be changed");
});

test("Erase all of these, and Erase everything, take every row and tell the app to clear her chats", async () => {
  const hurin = await player("hurin"), lena = await player("lena");
  await keepSome(hurin.user);
  await keepSome(lena.user);
  assert.equal((await hurin.page("erase-section", { section: "answers" })).status, 200);
  assert.equal(section((await hurin.page("all")).body, "answers").items.length, 0);
  assert.equal(section((await hurin.page("all")).body, "wrong").items.length, 1, "only that kind");
  await keepSome(hurin.user);
  assert.equal((await hurin.page("erase-all", {})).status, 400, "needs the confirm");
  assert.equal((await hurin.page("erase-all", { confirm: "erase" })).status, 200);
  const view = (await hurin.page("all")).body;
  for (const s of view.sections) assert.equal(s.items.length, 0, s.id);
  assert.equal(rows("answer_log").length, 2, "Lena's answers stay");
  assert.equal(rows("answer_feedback").length, 1, "Lena's flag stays");
  assert.ok(view.chats_erased, "her chats are to be cleared");
  assert.equal(view.apps[0].caught_up, false, "until the app says it has");
  assert.deepEqual(Object.keys((await lena.app("changes")).body.changes), [], "nothing for Lena's app");
  // Keep my chats: nothing for the app to clear.
  const aelric = await player("aelric");
  await keepSome(aelric.user);
  await aelric.page("erase-all", { confirm: "erase", keep_chats: true });
  assert.equal((await aelric.page("all")).body.chats_erased, null);
});

test("Willo's app reads the stamps with its own token, and says when it cleared her copy", async () => {
  const hurin = await player("hurin");
  assert.equal((await hurin.page("changes")).status, 403, "the page can't pose as the app");
  assert.deepEqual((await hurin.app("changes")).body, { ok: true, changes: {}, settings: {}, learned: [] });
  await hurin.page("erase-all", { confirm: "erase" });
  const { changes } = (await hurin.app("changes")).body;
  const local = KEEPERS.filter(k => k.local).map(k => k.id);
  assert.deepEqual(Object.keys(changes).sort(), [CHATS, ...local].sort(), "her chats, and each copy her app keeps");
  // A stamp later than the page's, or of something the page never changed, doesn't count.
  const later = new Date(Date.parse(changes[CHATS]) + 60e3).toISOString();
  assert.deepEqual((await hurin.app("cleared", { cleared: { [CHATS]: later, nothing: changes[CHATS] } })).body,
    { ok: true, cleared: [] });
  assert.equal((await hurin.page("all")).body.apps[0].caught_up, false);
  assert.deepEqual((await hurin.app("cleared", { cleared: { [CHATS]: changes[CHATS] } })).body, { ok: true, cleared: [CHATS] });
  assert.equal((await hurin.page("all")).body.apps[0].caught_up, local.length === 0, "not until every copy is cleared");
  assert.deepEqual((await hurin.app("cleared", { cleared: changes })).body.cleared.sort(), Object.keys(changes).sort());
  const view = (await hurin.page("all")).body;
  assert.equal(view.apps[0].caught_up, true);
  assert.equal(view.apps[0].chats_cleared, changes[CHATS]);
  assert.equal((await hurin.page("cleared", { cleared: changes })).status, 403, "only the app says it cleared");
});

test("only our page or the player's own app: signed out, another site and a made-up token are turned away", async () => {
  const hurin = await player("hurin");
  await keepSome(hurin.user);
  const get = headers => keepsApi({ request: new Request(`${ORIGIN}/api/keeps/all`, { headers }), env, params: { action: "all" } });
  assert.equal((await get({})).status, 401);
  assert.equal((await get({ "X-LF-Client": "companion/0.21.0", Authorization: `Bearer ${"f".repeat(64)}` })).status, 401);
  const foreign = new Request(`${ORIGIN}/api/keeps/erase-all`, { method: "POST", headers: { Origin: "https://evil.example",
    "Content-Type": "application/json" }, body: JSON.stringify({ confirm: "erase" }) });
  assert.equal((await keepsApi({ request: foreign, env, params: { action: "erase-all" } })).status, 401);
  assert.equal(rows("answer_log").length, 2, "nothing erased");
  assert.equal((await hurin.page("erase", { section: "nope", id: "1" })).status, 400);
  assert.equal((await hurin.page("nope", {})).status, 404);
});

test("the journey's copy is shown, and Erase everything leaves it", async () => {
  const hurin = await player("hurin");
  const now = new Date().toISOString();
  env.DB.sqlite.prepare("INSERT INTO profiles (user_id, handle, public, data, journey, created, updated) VALUES (?, ?, 0, ?, ?, ?, ?)")
    .run(hurin.user.id, "hurin", JSON.stringify({ v: 1, name: "Húrin", realm: "Forever", level: 24, race: "Human",
      className: "Paladin" }), JSON.stringify({ v: 1, tz: 0, moments: [{ t: 1 }, { t: 2 }] }), now, now);
  const view = (await hurin.page("all")).body;
  assert.equal(view.journey.name, "Húrin");
  assert.equal(view.journey.moments, 2);
  assert.equal(view.journey.handle, "hurin");
  assert.deepEqual(view.characters, [{ key: "Húrin-Forever", name: "Húrin", realm: "Forever" }]);
  await hurin.page("erase-all", { confirm: "erase" });
  assert.equal(rows("profiles").length, 1, "the profile stays: it has its own delete");
});

test("Delete my account takes the stamps too", async () => {
  const hurin = await player("hurin");
  await hurin.page("erase-all", { confirm: "erase" });
  await hurin.app("cleared", { cleared: (await hurin.app("changes")).body.changes });
  await deleteUser(env, hurin.user);
  assert.equal(rows("keeps_changes").length, 0);
  assert.equal(rows("keeps_cleared").length, 0);
});

test("every keeper is complete: an id, plain words, a list and both erases", () => {
  const ids = KEEPERS.map(k => k.id);
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
  for (const k of KEEPERS) {
    assert.match(k.id, /^[a-z][a-z-]{1,30}$/, k.id);
    assert.notEqual(k.id, CHATS);
    assert.ok(k.title && k.about && k.empty, `${k.id} has a title, a line and words for when it's empty`);
    for (const fn of ["list", "erase", "eraseAll"]) assert.equal(typeof k[fn], "function", `${k.id}.${fn}`);
    assert.doesNotMatch(`${k.title} ${k.about} ${k.kept || ""} ${k.empty}`, /\b(?:database|server|API|D1|table|row|hash|token|cookie)s?\b/i,
      `${k.id}'s words stay plain`);
  }
});

test("Willo's window opens the page signed in: it's on the one-time link's list, and nothing near it is", () => {
  assert.equal(safeNext("/willo/keeps"), "/willo/keeps");
  assert.equal(safeNext("/willo/keeps?from=willo-settings"), "/willo/keeps?from=willo-settings");
  for (const next of ["/willo/keepsx", "/willo/keeps/../admin", "/willo/style", "/willo", "/willo/keeps//evil.example"]) {
    assert.equal(safeNext(next), null, next);
  }
});

test("a question about what she keeps is the privacy topic, never a new chat or quitting her (LOR-666 blind check)", () => {
  const cases = {
    "What do you know about me?": ["privacy"],
    "What do you remember about me?": ["privacy"],
    "Forget everything you know about me.": ["privacy"],
    "Can you delete the questions I asked you?": ["privacy"],
    "Do you store what I ask you?": ["privacy"],
    "Are my questions sent anywhere?": ["privacy"],
    "Do you save our conversations?": ["privacy"],
  };
  for (const [q, want] of Object.entries(cases)) assert.deepEqual(helpTopics(q), want, q);
  assert.ok(helpTopics("Do you keep my chats?").includes("privacy"));
  assert.deepEqual(helpTopics("Can you start a new chat?"), ["chat"], "a new chat is still a new chat");
  assert.deepEqual(helpTopics("How do I uninstall you?"), ["quit"], "and quitting is still quitting");
  for (const q of ["Forget everything you know about me.", "Do you keep my chats?", "What do you know about me?"]) {
    const offered = actionsFor(helpTopics(q), { client: "companion/0.22.0", asked: q });
    assert.deepEqual(keepsOffer(offered), { id: "open_keeps", args: {}, label: "Open What Willo keeps" }, q);
    assert.ok(!offered.some(a => a.name === "new_chat"), `${q}: no new chat`);
  }
  const text = helpBlock("Do you keep my chats?");
  assert.match(text, /14 days/);
  assert.match(text, /Help improve Willo's answers/);
  assert.match(text, /never say nothing leaves their computer/i);
  assert.doesNotMatch(text, /never uploaded/, "nothing she could turn into \"not uploaded\"");
  assert.match(text, /picture for a spoken question stays on their computer/);
  assert.doesNotMatch(text, /Pictures of the game aren't kept/);
  assert.match(helpBlock("Do you keep my chats?", { keeping: true }), /on for them right now, so this question is kept too/);
  assert.match(helpBlock("Do you keep my chats?", { keeping: false }), /off for them right now, so nothing they ask is kept/);
});

test("asked what she knows about you, Willo sends you to the page, and no longer says nothing is kept", () => {
  for (const q of ["What do you know about me?", "what does willo keep about me", "How do I erase everything?",
                   "Can you forget my notes?", "where is What Willo keeps"]) {
    assert.ok(helpTopics(q).includes("privacy"), q);
  }
  assert.ok(!helpTopics("Do you remember Arthas?").includes("privacy"), "a lore question isn't about what she keeps");
  const block = helpBlock("What do you know about me?");
  assert.match(block, /What Willo keeps/);
  assert.match(block, /Settings › App & answers › What Willo keeps/);
  assert.match(block, /14 days/);
  assert.doesNotMatch(block, /doesn't keep questions, answers/);
});

test("the page's switch stops keeping questions at once, Willo's app follows it, and a later change in the app wins", async () => {
  const hurin = await player("hurin");
  assert.equal((await hurin.page("all")).body.keep_answers, null, "not known yet: on by default");
  await hurin.app("changes?keep_answers=1", undefined);
  assert.equal((await hurin.page("all")).body.keep_answers, true, "as the app says");
  assert.deepEqual((await hurin.page("keep-answers", { on: false })).body, { ok: true, on: false });
  await keepSome(hurin.user);
  assert.equal(rows("answer_log").length, 0, "off on the page: nothing kept, though the app still sends keep");
  assert.equal(section((await hurin.page("all")).body, "answers").items.length, 0);
  const told = (await hurin.app("changes?keep_answers=1")).body.settings.keep_answers;
  assert.equal(told.on, false, "the app is told to turn its switch off");
  assert.equal((await hurin.page("all")).body.keep_answers, false, "the page's choice stands until the app takes it");
  // The app took it, and later the player turned it back on in the app: that's the account's choice now.
  const back = (await hurin.app(`changes?keep_answers=1&applied=${encodeURIComponent(told.at)}`)).body.settings;
  assert.equal(back.keep_answers.on, true);
  assert.equal((await hurin.page("all")).body.keep_answers, true);
  await keepSome(hurin.user);
  assert.equal(rows("answer_log").length, 2, "kept again");
  assert.equal((await hurin.page("keep-answers", { on: "no" })).status, 400);
});

test("what friends see, how she talks to you, and empty sections that say how they fill", async () => {
  const hurin = await player("hurin");
  let view = (await hurin.page("all")).body;
  assert.deepEqual(view.friends, { share: false, shared: null, at: null, friends: 0 });
  assert.deepEqual(view.style, { preset: null, words: "", tales: [] });
  for (const s of view.sections) assert.ok(s.empty.length > 40, `${s.id} says how it fills when empty`);
  await setSharing(env, hurin.user.id, true);
  await savePresence(env, hurin.user.id, { character: "Húrin", level: 24, zone: "Westfall", sub: "Sentinel Hill",
    quest: "The Defias Brotherhood", guild: null, week: null });
  const now = new Date().toISOString();
  env.DB.sqlite.prepare("INSERT INTO custom_prompts (user_id, kind, target, text, preset, created, updated) VALUES " +
    "(?, 'style', '', 'Call me Captain.', 'scholar', ?, ?), (?, 'tale', 'npc:gryan_stoutmantle', 'A gruff old man.', NULL, ?, ?)")
    .run(hurin.user.id, now, now, hurin.user.id, now, now);
  view = (await hurin.page("all")).body;
  assert.equal(view.friends.share, true);
  assert.equal(view.friends.shared.zone, "Westfall");
  assert.deepEqual(view.style, { preset: "Scholar", words: "Call me Captain.", tales: ["Gryan Stoutmantle"] });
});

test("Download everything is one readable file of all of it, and only yours", async () => {
  const hurin = await player("hurin"), lena = await player("lena");
  await keepSome(hurin.user);
  await keepSome(lena.user, "Elwynn Forest");
  const request = new Request(`${ORIGIN}/api/keeps/export`, { headers: { Cookie: (await startSession(env,
    new Request(ORIGIN), hurin.user.id)).split(";")[0] } });
  const res = await keepsApi({ request, env, params: { action: "export" } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("Content-Disposition"), /attachment; filename="what-willo-keeps-\d{4}-\d{2}-\d{2}\.md"/);
  const text = await res.text();
  assert.match(text, /^# What Willo keeps/);
  assert.match(text, /## Your questions[\s\S]*Where is Sentinel Hill, \[your name\]\?[\s\S]*She said: East of the farms/);
  assert.match(text, /## Answers you said were wrong[\s\S]*That's wrong, it's in Westfall\./);
  assert.match(text, /## Your journey[\s\S]*## What your friends see[\s\S]*## How she talks to you[\s\S]*## Your chats/);
  assert.doesNotMatch(text, /Elwynn/);
});

test("her answer can offer to open the page, in her window, from the app that has it", () => {
  const asked = "What do you know about me?";
  const topics = helpTopics(asked);
  const offer = client => actionsFor(topics, { client, asked }).map(a => a.name);
  assert.ok(offer("companion/0.21.1").includes("open_keeps"));
  assert.ok(!offer("companion/0.21.0").includes("open_keeps"), "an app without the button gets no offer");
  assert.ok(!actionsFor(topics, { client: "companion/0.21.1", spoken: true, asked }).some(a => a.name === "open_keeps"),
    "never out loud");
  const notes = "Can you keep a list of my quests?";
  assert.ok(!actionsFor(helpTopics(notes), { client: "companion/0.22.0", asked: notes }).some(a => a.name === "open_keeps"),
    "a notebook request isn't a question about what she keeps");
  const action = actionOf({ name: "open_keeps", args: {} }, actionsFor(topics, { client: "companion/0.21.1", asked }));
  assert.deepEqual(action, { id: "open_keeps", args: {}, label: "Open What Willo keeps" });
  assert.match(offerLine(action), /one page/);
});
