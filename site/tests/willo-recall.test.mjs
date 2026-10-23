// Asking the journey from Willo for iPhone (lib/willo-recall.js, LOR-672 part 4): a question about their own past asked
// without a journey of the app's own is searched over the journey Willo on the PC synced, with recall.py's rules: the
// day and the place from the journey only (P4), "nothing in their journey" said plainly, a count only what it holds,
// never another character's road as theirs, and with nothing synced, where their journey lives (P5).
// Run: node --test 'site/tests/*.test.mjs'
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { asks, search, recall, withRecall, hasJourney, dayOf, when } from "../lib/willo-recall.js";
import { readJourney } from "../lib/journey.js";
import { onRequest as answer } from "../functions/api/companion/answer.js";
import { findOrCreateUser, setup } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { d1 } from "./helpers.mjs";

const at = iso => Date.parse(iso) / 1000;
const JOURNEY = { v: 1, tz: -420, moments: [
  { t: at("2026-10-10T18:00:00Z"), k: "zone", z: "Elwynn Forest", new: 1 },
  { t: at("2026-10-11T02:30:00Z"), k: "kill", z: "Elwynn Forest", s: "Jasperlode Mine", n: "Mother Fang", cls: "rare" },
  { t: at("2026-10-12T19:00:00Z"), k: "zone", z: "Westfall", new: 1, how: "flight" },
  { t: at("2026-10-12T20:00:00Z"), k: "death", z: "Westfall", s: "Moonbrook", by: "Defias Pillager" },
  { t: at("2026-10-13T20:00:00Z"), k: "death", z: "Westfall", s: "Moonbrook", by: "Defias Pillager" },
  { t: at("2026-10-14T20:00:00Z"), k: "qa", z: "Westfall", s: "Sentinel Hill", n: "The Defias Brotherhood", id: 155 },
  { t: at("2026-10-15T21:00:00Z"), k: "qt", z: "Westfall", s: "Sentinel Hill", n: "The Defias Brotherhood", id: 155 },
  { t: at("2026-10-16T21:00:00Z"), k: "lvl", lv: 20 },
] };
const NOW = new Date("2026-10-18T20:00:00Z");
const saved = { journey: JOURNEY, name: "Húrin", theirs: true };

test("a question about their own past, and only that", () => {
  for (const q of ["Where did I see that rare wolf?", "When did I first reach Westfall?", "How many times did I die in Westfall?",
    "Have I finished the Defias Brotherhood?", "What killed me the most?", "Have I ever been to Duskwood?"]) assert.ok(asks(q), q);
  for (const q of ["How many rares have I killed?", "How often I've died in Duskwood", "how many quests I finished"]) assert.ok(asks(q), q);
  for (const q of ["Who is Hogger?", "Where is Fargodeep Mine?", "How do I get to Duskwood?", "What's a rare?",
    "How many rotations of Sunder Armor can I go through before the boss enrages?", "How many bags do I need?",
    "How often should I repair?"]) assert.ok(!asks(q), q);
});

test("the moments that match, as recall.py finds them", () => {
  const names = r => r.best.map(e => e.n || e.z);
  assert.deepEqual(names(search(JOURNEY, "Where did I see that rare wolf?", "", NOW, -420)), ["Mother Fang"], "a narrow kind alone");
  assert.deepEqual(search(JOURNEY, "How many times did I die in Westfall?", "", NOW, -420).best.map(e => e.k), ["death", "death"]);
  assert.deepEqual(names(search(JOURNEY, "When did I first reach Westfall?", "", NOW, -420)), ["Westfall"]);
  assert.deepEqual(search(JOURNEY, "Have I finished the Defias Brotherhood?", "", NOW, -420).best.map(e => e.k), ["qt"]);
  assert.deepEqual(search(JOURNEY, "Have I ever been to Duskwood?", "", NOW, -420).best, [], "a place it never was");
});

test("a level only when the journey makes it certain", async () => {
  const { levelAt } = await import("../lib/willo-recall.js");
  const j = { moments: [{ t: 10, k: "lvl", lv: 20 }, { t: 20, k: "lvl", lv: 21 }, { t: 40, k: "lvl", lv: 25 }] };
  assert.equal(levelAt(j, 15), 20, "between 20 and 21");
  assert.equal(levelAt(j, 30), null, "21 then 25: a session missed, so not certain");
  assert.equal(levelAt(j, 50), null, "after the last, with no word of their level now");
  assert.equal(levelAt(j, 50, 25), 25, "after the last, and the profile says they're still 25");
  assert.equal(levelAt(j, 50, 27), null, "the profile has moved on: level-ups were missed");
  assert.equal(levelAt(j, 5), null, "before the first level-up");
});

test("days on the player's clock", () => {
  assert.equal(dayOf(at("2026-10-11T02:30:00Z"), -420, NOW), "October 10", "7:30 PM in California");
  assert.equal(dayOf(at("2025-10-11T02:30:00Z"), -420, NOW), "October 10, 2025");
  const [from, to] = when("what did I do yesterday?", NOW, -420);
  assert.equal(new Date(from * 1000).toISOString(), "2026-10-17T07:00:00.000Z");
  assert.ok(to > from);
});

test("FROM THEIR JOURNEY: the day and the place from the journey, never a map number", () => {
  const found = recall("Where did I see that rare wolf?", saved, { now: NOW, tz: -420 });
  assert.match(found.section, /^FROM THEIR JOURNEY \(Húrin's: what the game kept/);
  assert.match(found.section, /\n- October 10, at Jasperlode Mine, Elwynn Forest: fought and beat Mother Fang, a rare, for the first time$/m);
  assert.match(found.section, /Their journey begins October 10\. It holds what happened up to October 16/);
  assert.doesNotMatch(found.section, /map|\d{1,3}, \d{1,3}\)/);
  assert.equal(found.reminder, "");
  const deaths = recall("How many times did I die in Westfall?", saved, { now: NOW, tz: -420 });
  assert.match(deaths.section, /Matching moments in all: 2; that's only what their journey holds: say it as that \("2 that our road kept"\)/);
  const when = recall("When did I die in Westfall?", saved, { now: NOW, tz: -420 });
  assert.match(when.section, /Matching moments in all: 2; that's only what their journey holds: tell a count only when they ask how many\./);
  assert.match(deaths.section, /Slain by: Defias Pillager 2 times\./);
});

test("nothing matching, nothing synced, another character's: said plainly, never a guess", () => {
  const none = recall("Have I ever been to Duskwood?", saved, { now: NOW, tz: -420 });
  assert.match(none.section, /Nothing in their journey matches this question\.$/);
  assert.match(none.reminder, /I can't see <it> on the road that reaches me here, and our road began on October 10\./);
  assert.match(none.reminder, /Never that it didn't happen\./);
  assert.match(none.reminder, /never a place from SOURCES as where they saw it/);
  assert.match(none.section, /From the phone you see only the main moments of their journey/);
  const empty = recall("Where did I see that rare wolf?", { journey: null, name: "", theirs: true }, { now: NOW });
  // In her voice, never the plumbing (the immersion rule; the blind check, 10/21).
  assert.match(empty.reminder, /I haven't heard of your travels yet; tell me where you've been\./);
  assert.doesNotMatch(empty.section + empty.reminder.replace(/Never a word about [^.]*\./, ""),
    /\b(?:phone|PC|computer|sync|profile|settings?|Lore Forever|Keep my profile)\b/i);
  const other = recall("Where did I see that rare wolf?", { ...saved, theirs: false }, { now: NOW });
  assert.match(other.reminder, /you can only see Húrin's road from the phone/);
  assert.doesNotMatch(other.section, /Mother Fang/);
  // Any of their characters: the synced road is one of theirs, told as that character's, never a flat no for all.
  const mine = recall("Have I been to Duskwood on any of my characters?", saved, { now: NOW, tz: -420 });
  assert.match(mine.reminder, /Only Húrin's road reaches the phone: answer from Húrin's alone and say so/);
  const alt = recall("Have I been to Westfall on any of my characters?", { ...saved, theirs: false }, { now: NOW, tz: -420 });
  assert.match(alt.section, /^FROM THEIR JOURNEY \(Húrin's, another of their characters, not the one asking: /);
  assert.match(alt.section, /first arrived at Westfall, by flight/);
  assert.match(alt.reminder, /These lines are Húrin's, another of their characters, not the one asking: say it was Húrin\./);
  assert.equal(recall("Who is Hogger?", saved, { now: NOW }), null);
  assert.equal(recall("Where was the kobold den I pinned?", saved, { now: NOW }), null, "a pin is the notebook's");
  // What's still ahead (the accuracy lab, 10/22): their own journey helps; without it, or with another character's,
  // there's no journey line at all. A past question beside it still gets one.
  const ahead = "What have I got left to do in Westfall?";
  assert.ok(asks(ahead), "the journey is read for it");
  assert.ok(recall(ahead, saved, { now: NOW, tz: -420 }));
  for (const s of [{ journey: null, name: "", theirs: true }, { ...saved, theirs: false }])
    assert.equal(recall(ahead, s, { now: NOW }), null);
  assert.equal(recall("Which quests have I yet to finish in Westfall?", { journey: null, name: "", theirs: true }, { now: NOW }), null);
  assert.ok(recall("What have I got left to do in Westfall, and where did I die?", { journey: null, name: "", theirs: true },
    { now: NOW })?.reminder);
});

test("where it goes in the prompt; never over a journey the app sent", () => {
  const prompt = "PLAYER CONTEXT\nname: Húrin\n\nSOURCES\n=== Elwynn ===\n\nQUESTION\nWhere did I see that rare wolf?";
  const out = withRecall(prompt, { section: "FROM THEIR JOURNEY (x)\n- a", reminder: "(r)" });
  assert.equal(out, "PLAYER CONTEXT\nname: Húrin\n\nFROM THEIR JOURNEY (x)\n- a\n\nSOURCES\n=== Elwynn ===\n\nQUESTION\nWhere did I see that rare wolf?\n(r)");
  const pc = "PLAYER CONTEXT\nzone: Westfall\n\nTHEIR JOURNEY\n- x\n\nSOURCES\n\nQUESTION\nq";
  assert.ok(hasJourney(pc));
  assert.equal(withRecall(pc, { section: "FROM THEIR JOURNEY (x)", reminder: "" }), pc);
});

// ---- Through her answers ----

const env = { DB: d1(), GEMINI_API_KEY: "test-key" };
const originalFetch = globalThis.fetch;
let calls;
beforeEach(async () => {
  await setup(env);
  calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(JSON.parse(options.body));
    return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "Near Jasperlode Mine, friend." }] } }],
      usageMetadata: { promptTokenCount: 4000, candidatesTokenCount: 30 } });
  };
});
afterEach(() => { globalThis.fetch = originalFetch; });

let n = 0;
async function linked({ journey = null } = {}) {
  const sub = `recaller${++n}`;
  const user = await findOrCreateUser(env, { email: `${sub}@example.com`, googleSub: sub, name: sub });
  const link = await startLink(env);
  await decideLink(env, link.user_code, user, true);
  if (journey) {
    const stamp = new Date().toISOString();
    env.DB.sqlite.prepare("INSERT INTO profiles (user_id, handle, data, journey, created, updated) VALUES (?, ?, ?, ?, ?, ?)")
      .run(user.id, sub, JSON.stringify({ name: "Húrin", realm: "ClassicBetaPvE" }), JSON.stringify(journey), stamp, stamp);
  }
  return (await claimToken(env, link.device_code)).token;
}
const ask = async (token, question, { client = "companion/ios-0.2.0", character = "Húrin-ClassicBetaPvE", context = "" } = {}) =>
  (await answer({ env, request: new Request("https://example.test/api/companion/answer", { method: "POST",
    headers: { "X-LF-Client": client, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: `PLAYER CONTEXT\nname: Húrin\nThey are away from the game, asking from their phone.\n\n` +
      `${context}SOURCES\n\nQUESTION\n${question}`, persona: "willo", notebook: { character, offset: -420 } }) }) })).json();
const sent = () => JSON.stringify(calls[calls.length - 1]);

test("P4 on the phone: the day and place from the synced journey reach her answer", async () => {
  const token = await linked({ journey: JOURNEY });
  const res = await ask(token, "Where did I see that rare wolf?");
  assert.equal(res.ok, true);
  assert.match(sent(), /FROM THEIR JOURNEY \(Húrin's: /);
  assert.match(sent(), /October 10, at Jasperlode Mine, Elwynn Forest: fought and beat Mother Fang, a rare, for the first time/);
  assert.ok(sent().indexOf("FROM THEIR JOURNEY (Húrin") < sent().indexOf("\\n\\nSOURCES\\n"), "before SOURCES, as the PC puts it");
});

test("P5: nothing synced, she's told where their journey lives; another character, never Húrin's road", async () => {
  const none = await linked();
  await ask(none, "When did I first reach Westfall?");
  assert.match(sent(), /QUESTION\\nWhen did I first reach Westfall\?\\n\(Their journey hasn't reached you yet\. Answer in one short line/);
  const token = await linked({ journey: JOURNEY });
  await ask(token, "When did I first reach Westfall?", { character: "Brynn-ClassicBetaPvE" });
  assert.match(sent(), /you can only see Húrin's road from the phone/);
  assert.doesNotMatch(sent(), /first arrived at Westfall/);
});

test("Willo on the PC's own journey stands; other questions get nothing of it", async () => {
  const token = await linked({ journey: JOURNEY });
  await ask(token, "Where did I see that rare wolf?", { client: "companion/0.22.0",
    context: "FROM THEIR JOURNEY (Húrin's: from the PC.)\n- October 10: the PC's line\n\n" });
  assert.match(sent(), /the PC's line/);
  assert.equal(sent().match(/FROM THEIR JOURNEY/g).length, 1);
  await ask(token, "Who is Hogger?");
  assert.doesNotMatch(sent(), /FROM THEIR JOURNEY|Mother Fang/);
});

test("a rare only seen and a bought mount, synced and told as Willo on the PC tells them (LOR-672, #1235)", () => {
  const T = at("2026-10-11T03:00:00Z");
  const synced = readJourney({ v: 1, tz: -420, moments: [
    { t: T, k: "seen", n: "Lupos", cls: "rare", z: "Duskwood", s: "Raven Hill Cemetery" },
    { t: T + 60, k: "seen", n: "Defias Pillager", cls: "elite", z: "Westfall" },
    { t: T + 120, k: "seen", n: "Nobody" , z: "Westfall" },
    { t: T + 3600, k: "mount", n: "Black Ram", how: "bought", z: "Dun Morogh", s: "Amberstill Ranch" },
    { t: T + 7200, k: "mount", n: "Summon Warhorse", how: "flight", z: "Ironforge" },
    { t: T + 9000, k: "zone", z: "Stranglethorn Vale", s: "Rebel Camp", new: 1, lv: 31 },
  ] }, null, NOW);
  // A first arrival keeps its level, and is told with it.
  const arrival = synced.moments.pop();
  assert.equal(arrival.lv, 31);
  assert.match(recall("When did I first reach Stranglethorn?", { journey: { ...synced, moments: [...synced.moments, arrival] },
    name: "Húrin", theirs: true }, { now: NOW, tz: -420 }).section, /, level 31: first arrived at Rebel Camp, Stranglethorn Vale$/m);
  assert.deepEqual(synced.moments.map(m => [m.k, m.n, m.cls || m.how || ""]),
    [["seen", "Lupos", "rare"], ["mount", "Black Ram", "bought"], ["mount", "Summon Warhorse", ""]],
    "seen only with a rare's rank; bought the only how a mount keeps");
  const j = { ...synced, moments: [...synced.moments] };
  assert.ok(asks("Did I ever kill that rare wolf?") && asks("Did I see Lupos?") && asks("When did I buy my ram?"));
  const wolf = recall("Did I ever kill that rare wolf?", { journey: j, name: "Húrin", theirs: true }, { now: NOW, tz: -420 });
  assert.match(wolf.section, /- October 10, at Raven Hill Cemetery, Duskwood: first saw Lupos, a rare \(only seen: no fight with it is in their journey\)$/m);
  const ram = recall("When did I buy my ram?", { journey: j, name: "Húrin", theirs: true }, { now: NOW, tz: -420 });
  assert.match(ram.section, /at Amberstill Ranch, Dun Morogh: bought a mount, Black Ram$/m);
  const first = recall("When did I get my first mount?", { journey: j, name: "Húrin", theirs: true }, { now: NOW, tz: -420 });
  assert.match(first.section, /bought a mount, Black Ram/);
  assert.match(first.section, /got a mount, Summon Warhorse/);
  // Seen, then slain: both, and never "only seen".
  j.moments.push({ t: T + 9000, k: "kill", n: "Lupos", cls: "rare", z: "Duskwood", s: "Raven Hill Cemetery" });
  const both = recall("Where did I see that rare wolf?", { journey: j, name: "Húrin", theirs: true }, { now: NOW, tz: -420 });
  assert.match(both.section, /first saw Lupos, a rare$/m);
  assert.match(both.section, /fought and beat Lupos, a rare, for the first time$/m);
  assert.doesNotMatch(both.section, /only seen/);
});
