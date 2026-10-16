// Willo knows Forever (LOR-446): every live answer gets the Forever facts its question and place match, a player
// saying an answer is wrong is neither argued with nor lost, and /admin can turn what they said into a fact.
// In-process on node:sqlite (helpers.mjs); Gemini is a stub. Run: node --test 'site/tests/*.test.mjs'
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequest as answer } from "../functions/api/companion/answer.js";
import { onRequestPost as flag } from "../functions/api/companion/feedback.js";
import { onRequestGet as adminGet, onRequestPost as adminPost } from "../functions/api/admin/willo.js";
import { findOrCreateUser, setup, deleteUser } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { promptParts, travelQuestion, travelKinds, inWorld, SEED_FACTS } from "../lib/forever-knowledge.js";
import { DATA_VERSION } from "../lib/knowledge-version.js";
import { feedbackKind } from "../lib/answer-feedback.js";
import { d1 } from "./helpers.mjs";

const env = { DB: d1(), GEMINI_API_KEY: "test-key", ADMIN_KEY: "admin-test" };
const originalFetch = globalThis.fetch;
let systems;

beforeEach(async () => {
  await setup(env);
  systems = [];
  globalThis.fetch = async (url, options) => {
    systems.push(JSON.parse(options.body).systemInstruction.parts[0].text);
    return Response.json({ candidates: [{ content: { parts: [{ text: "It sails to Menethil Harbor and Auberdine." }] } }],
      usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 40 } });
  };
});
afterEach(() => { globalThis.fetch = originalFetch; });

let n = 0;
async function linked() {
  const sub = `player${++n}`;
  const user = await findOrCreateUser(env, { email: `${sub}@example.com`, googleSub: sub, name: sub });
  const link = await startLink(env);
  await decideLink(env, link.user_code, user, true);
  return (await claimToken(env, link.device_code)).token;
}
const companion = (path, token, body) => new Request(`https://example.test/api/companion/${path}`, { method: "POST",
  headers: { "X-LF-Client": "companion/0.16.0", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(body) });
const ask = async (token, prompt, extra = {}) => {
  const res = await answer({ request: companion("answer", token, { prompt, persona: "willo", ...extra }), env });
  return res.json();
};
const admin = (method, body) => new Request("https://example.test/api/admin/willo", { method,
  headers: { Authorization: "Bearer admin-test", ...(body ? { "Content-Type": "application/json" } : {}) },
  body: body ? JSON.stringify(body) : undefined });
const conversation = (q, a) => `RECENT CONVERSATION (oldest first)\n${JSON.stringify([{ player: q, willo: a }])}`;

test("a question about the Southshore boat is answered with Forever's route, not the original game's", async () => {
  const token = await linked();
  const body = await ask(token, "PLAYER CONTEXT\nzone: Hillsbrad Foothills\nsub: Southshore\n\nSOURCES\n\nQUESTION\n" +
    "Where does the boat from Southshore go?", { style: "spoken" });
  assert.equal(body.ok, true);
  assert.match(systems[0], /FOREVER FACTS[^]*Southshore[^]*Menethil Harbor[^]*Auberdine/);
  assert.deepEqual(body.forever_facts.slice(0, 2), ["Every boat and zeppelin in WoW Forever", "The ship from Southshore"]);
  assert.equal(body.feedback, undefined);
});

test("an older add-on's lore gives way to newer Forever facts; the current one and an old companion's don't (LOR-471)", async () => {
  const token = await linked();
  const prompt = "PLAYER CONTEXT\nzone: Hillsbrad Foothills\n\nSOURCES\n\nQUESTION\nWhere does the boat from Southshore go?";
  const [y, mo, d, h, mi] = DATA_VERSION.match(/\d+/g).map(Number);
  const earlier = new Date(Date.UTC(y, mo - 1, d, h, mi) - 60_000).toISOString().slice(0, 16).replace("T", " ") + " UTC";
  for (const data_version of [earlier, DATA_VERSION.replace(" UTC", ":30 UTC"), DATA_VERSION, undefined, "nonsense"]) {
    systems = [];
    await ask(token, prompt, { data_version });
    assert.equal(/where the SOURCES \(an older copy of the lore\) differ/.test(systems[0]), data_version === earlier,
      String(data_version));
  }
});

test("asking how to get somewhere brings Forever's boat and zeppelin network, even with no boat named", async () => {
  const token = await linked();
  const body = await ask(token, "PLAYER CONTEXT\nzone: Ironforge\nsub: Military Ward\n\nSOURCES\n\nQUESTION\n" +
    "How do I get to Fray Island from here?", { style: "spoken", research: "auto" });
  assert.equal(body.forever_facts[0], "Every boat and zeppelin in WoW Forever");
  assert.match(systems[0], /FOREVER FACTS[^]*Stormwind Harbor to Auberdine/);
  assert.equal(body.looked_up, "no");   // the network covers it: no quick look online
});

test("a flight path question gets Forever's flight network and the flight point it's about, from the client", async () => {
  const token = await linked();
  const body = await ask(token, "PLAYER CONTEXT\nzone: Winterspring\nsub: Everlook\nfaction: Horde\n\nSOURCES\n\nQUESTION\n" +
    "Where can I fly from here?", { style: "spoken", research: "auto" });
  assert.equal(body.forever_facts[0], "Flight paths in WoW Forever");
  assert.ok(body.forever_facts.includes("Flights from Everlook (Horde)"));
  assert.ok(!body.forever_facts.includes("Every boat and zeppelin in WoW Forever"));
  assert.match(systems[0], /FOREVER FACTS[^]*Tainted Foothills/);
  assert.equal(body.looked_up, "no");
});

test("a question about something else in a flight-point town gets no flight facts", async () => {
  const token = await linked();
  const body = await ask(token, "PLAYER CONTEXT\nzone: The Barrens\nsub: The Crossroads\nfaction: Horde\n\nSOURCES\n\n" +
    "QUESTION\nWhere is the cooking trainer in the Crossroads?", { style: "spoken" });
  assert.ok(!body.forever_facts.some(t => /^Flights from|^Flight paths/.test(t)), body.forever_facts.join(", "));
});

test("every fact reaches an answer worded about the world, not the game", () => {
  // With answers kept in the world (#735), facts worded about the game were left out instead of reworded.
  for (const f of SEED_FACTS.filter(f => f.id !== "forever-era"))
    assert.doesNotMatch(`${inWorld(f.title, f.id)}: ${inWorld(f.text, f.id)}`,
      /WoW Forever|World of Warcraft|original game|\bClassic\b|Blizzard|Burning Crusade|[Gg]uides say/, f.id);
});

test("travel questions are the way somewhere, not a level, a reputation or a druid's travel form", () => {
  assert.deepEqual(travelKinds("Is there a flight path in the Riverglades?"), { boats: false, flights: true });
  assert.deepEqual(travelKinds("Where does the boat from Southshore go?"), { boats: true, flights: false });
  assert.deepEqual(travelKinds("How do I get to Mount Hyjal?"), { boats: true, flights: true });
  assert.ok(!travelQuestion("Wow, what's this? I'm flying. What do you see?"));
  for (const q of ["Where does this big Zeppelin go?", "How do I get to the Frey Allen from here?", "Is this the right harbor?",
    "What's the fastest way from Stormwind to Ironforge?", "How do I get to Kalimdor from here?",
    "How do I get from Darnassus to Darkshore?", "How do I leave Zephras Isle?"]) assert.ok(travelQuestion(q), q);
  // These still get their quick look online.
  for (const q of ["How do I get to level 30?", "how do I get to exalted with Stormwind", "where do I go to learn mining",
    "When do druids learn travel form?", "What is the best way to farm cloth?", "Where do I get 99-Year-Old Port?",
    "How do I get Berserker Stance?"]) assert.ok(!travelQuestion(q), q);
  assert.ok(!travelQuestion("Go back to your post.", { character: true }));
});

test("a player correcting Willo is taken seriously and comes back to us with what was asked and answered", async () => {
  const token = await linked();
  const prompt = "PLAYER CONTEXT\nzone: Wetlands\nsub: Menethil Harbor\n\n" +
    conversation("Did you see the sharp spires?", "Those are the towers of Ironforge.") + "\n\nQUESTION\nI'm pretty sure that's Dalaran.";
  const body = await ask(token, prompt, { style: "spoken" });
  assert.equal(body.feedback, "correction");
  assert.match(systems[0], /disputes your last answer/);
  assert.match(systems[0], /FOREVER FACTS[^]*Dalaran/);
  const list = await (await adminGet({ request: admin("GET"), env })).json();
  const row = list.feedback.rows.find(r => r.said === "I'm pretty sure that's Dalaran.");
  assert.equal(row.kind, "correction");
  assert.equal(row.question, "Did you see the sharp spires?");
  assert.equal(row.answer, "Those are the towers of Ironforge.");
  assert.equal(row.zone, "Wetlands");
  assert.equal(row.spoken, 1);
});

test("feedbackKind tells corrections and frustration after an answer from ordinary questions", () => {
  const answered = "Those are the towers of Ironforge.";
  for (const said of ["I'm pretty sure that's Dalaran.", "No, this boat goes to Southshore.", "You're wrong about that.",
    "Make a note that your information is outdated.", "Actually it's rebuilt now.",
    "But I can choose Undead Paladin in WoW Forever."]) assert.equal(feedbackKind(said, answered), "correction", said);
  for (const said of ["That's useless.", "You're not listening to me", "What are you talking about?"])
    assert.equal(feedbackKind(said, answered), "frustration", said);
  // Ordinary questions, including the review's misfires (10/12).
  for (const said of ["Where does this boat go?", "Tell me about Dalaran.", "Is this the right harbor?", "No idea where to go next",
    "Is this item useless?", "Is the Hall of Thanes worthless for a mage?", "Is this garbage worth selling?",
    "But I can't find the vendor, where is he?", "Actually, where's the flight master?", "I'm sure you know, where is Southshore?",
    "but it is getting late, where do I sleep", "Tell me what's new in WoW Forever."])
    assert.equal(feedbackKind(said, answered), null, said);
  assert.equal(feedbackKind("You're wrong about that.", ""), null, "nothing answered yet");
});

test("feedbackKind leaves a plain no or a polite decline alone (nightly review, 10/15)", () => {
  const offered = "Refuge Pointe has an inn and a flight master. Have you found the flight master yet?";
  const answered = "Hammerfall has a mailbox by the inn.";
  for (const previous of [offered, answered]) {
    for (const said of ["nope, not yet, thank you.", "No, I want to know whether Arathi Highlands has a mailbox.",
      "no. does Arathi have a mailbox", "No thanks, that's all.", "No, that's fine, thank you!"])
      assert.equal(feedbackKind(said, previous), null, `${said} / ${previous}`);
    for (const said of ["No, the mailbox is actually in Refuge Pointe.", "That's wrong.", "Not true, Hammerfall has no mailbox."])
      assert.equal(feedbackKind(said, previous), "correction", `${said} / ${previous}`);
  }
  // A bare "no" after a statement still disputes it: "No, it's by the bank."
  assert.equal(feedbackKind("No, it's by the bank.", answered), "correction");
});

test("deleting an account deletes what it said about Willo's answers", async () => {
  const token = await linked();
  await flag({ request: companion("feedback", token, { question: "Q", answer: "A wrong answer", note: "mine" }), env });
  const user = env.DB.sqlite.prepare("SELECT u.* FROM devices d JOIN users u ON u.id = d.user_id ORDER BY d.created DESC LIMIT 1").get();
  const count = () => env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM answer_feedback WHERE said = 'mine'").get().n;
  assert.equal(count(), 1);
  await deleteUser(env, { ...user });
  assert.equal(count(), 0);
});

test("a flagged answer reaches /admin, and making it a fact puts it in later answers until it's taken out", async () => {
  const token = await linked();
  const res = await flag({ request: companion("feedback", token, { question: "Where is the Riverglades flight master?",
    answer: "There is none.", note: "There's one at Fairbreeze", zone: "Riverglades" }), env });
  assert.equal(res.status, 200);
  const list = await (await adminGet({ request: admin("GET"), env })).json();
  const row = list.feedback.rows.find(r => r.kind === "flag");
  assert.equal(row.said, "There's one at Fairbreeze");
  const added = await (await adminPost({ request: admin("POST", { action: "fact-add", title: "Riverglades flight master",
    text: "The Riverglades flight master stands at Fairbreeze.", zone: "Riverglades", feedback_id: row.id }), env })).json();
  assert.equal(added.ok, true);
  await ask(token, "PLAYER CONTEXT\nzone: Riverglades\n\nQUESTION\nWhere's the flight master?");
  assert.match(systems.at(-1), /Riverglades flight master: The Riverglades flight master stands at Fairbreeze/);
  const after = await (await adminGet({ request: admin("GET"), env })).json();
  assert.equal(after.feedback.rows.find(r => r.id === row.id).status, "fact");
  assert.equal(after.facts.find(f => f.id === added.id).origin, "mike");
  // The nightly review: a researched fact for several signals, and a note on one it checked.
  const researched = await (await adminPost({ request: admin("POST", { action: "fact-add", origin: "research",
    title: "T", text: "A checked fact.", source_url: "https://warcraft.wiki.gg/wiki/X", feedback_ids: [row.id] }), env })).json();
  assert.equal((await (await adminGet({ request: admin("GET"), env })).json()).facts.find(f => f.id === researched.id).origin, "research");
  await adminPost({ request: admin("POST", { action: "feedback-status", id: row.id, status: "checked", note: "Classic only" }), env });
  const noted = (await (await adminGet({ request: admin("GET"), env })).json()).feedback.rows.find(r => r.id === row.id);
  assert.equal(noted.note, "Classic only");
  assert.match(noted.player, /^[0-9a-f]{10}$/);
  await adminPost({ request: admin("POST", { action: "fact-remove", id: researched.id }), env });
  await adminPost({ request: admin("POST", { action: "fact-remove", id: added.id }), env });
  await ask(token, "PLAYER CONTEXT\nzone: Riverglades\n\nQUESTION\nWhere's the flight master?");
  assert.doesNotMatch(systems.at(-1), /Fairbreeze/);
});

test("promptParts reads the question, place and last answer the companion sent, in either prompt shape", () => {
  const p = promptParts("PLAYER CONTEXT\nzone: Wetlands\nsub: Baradin Bay\nquest in their log: Apprentice's Duties (ID 471)\n\n" +
    conversation("Q1", "A1") + "\n\nQUESTION\nWhat city is that?\n\nRESEARCH FOCUS: something");
  assert.deepEqual(p, { question: "What city is that?", zone: "Wetlands", sub: "Baradin Bay", faction: "", race: "",
    class: "", level: "", previous: "A1", previousQuestion: "Q1", target: "",
    quests: [{ title: "Apprentice's Duties", id: "471" }] });
  const c = promptParts("CHARACTER\n...\n\nTHE ADVENTURER\nrace: Human\nWhere you both are: Southshore, Hillsbrad Foothills\n\n" +
    "THE ADVENTURER SAYS\nWhere does the boat go?");
  assert.equal(c.question, "Where does the boat go?");
  assert.equal(c.zone, "Hillsbrad Foothills");
  assert.equal(c.sub, "Southshore");
});
