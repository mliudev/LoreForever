// Pins from Willo for iPhone and by a place's name (lib/willo-pins.js, LOR-672 part 4): the phone never knows where
// they stand, so "pin this spot" pins nothing and says how to pin from the phone (P1); "pin Fargodeep Mine as the
// kobold den" pins that place, one this age has, with its zone and no map numbers, and "Pinned" only once it's written
// (P2, case 29); the pin is read back from that character's page (P3); "pin where I last was" pins where their last save
// left them, from the journey Willo's app synced, said as such, and only that character's.
// In-process on node:sqlite (helpers.mjs); Gemini is a stub. Run: node --test 'site/tests/*.test.mjs'
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequest as answer } from "../functions/api/companion/answer.js";
import { findOrCreateUser, setup } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { pinIntent, pinPlacesOf, placeNamed, dayOn, lastPlace, spotWithout, pinLine, phoneNoSpotLine, NO_PLACE_LINE,
  NO_SAVED_PLACE_LINE, NO_SPOT_LINE } from "../lib/willo-pins.js";
import { d1 } from "./helpers.mjs";

const INDEX = {
  zones: [{ key: "elwynn", name: "Elwynn Forest" }, { key: "westfall", name: "Westfall" }, { key: "deadmines", name: "The Deadmines" }],
  pages: [
    { p: "/lore/zone/elwynn", n: "Elwynn Forest", k: "zone", z: "elwynn" },
    { p: "/lore/subzone/fargodeep-mine", n: "Fargodeep Mine", k: "subzone", z: "elwynn" },
    { p: "/lore/subzone/goldshire", n: "Goldshire", k: "subzone", z: "elwynn" },
    { p: "/lore/zone/deadmines", n: "The Deadmines", k: "dungeon", z: "deadmines" },
    { p: "/lore/quest/5545-a-bundle-of-trouble", n: "A Bundle of Trouble", k: "quest", z: "elwynn" },
  ],
};
const TOWNS = { "Sentinel Hill": ["Westfall"] };

// ---- The pure parts ----

test("pin by a place's name, where their last save left them, or where they stand", () => {
  assert.deepEqual([pinIntent("Pin Fargodeep Mine as the kobold den").named, pinIntent("Pin Fargodeep Mine as the kobold den").as],
    ["Fargodeep Mine", "the kobold den"]);
  assert.equal(pinIntent("can you pin Goldshire please?").named, "Goldshire");
  assert.equal(pinIntent("Pin where I last was").last, true);
  assert.equal(pinIntent("pin my last spot").last, true);
  for (const q of ["Pin this spot", "pin it", "pin here", "Pin the kobold den", "drop a pin"]) {
    const i = pinIntent(q);
    assert.ok(i.add && !i.named && !i.last, q);
  }
  for (const q of ["Rename the cave pin to Kobold den", "What pins do I have?", "Where was the kobold den I pinned?", "unpin the cave"]) {
    assert.equal(pinIntent(q).named, undefined, q);
  }
  assert.equal(pinIntent("pin where I last was as my camp").as, "my camp");
  assert.equal(pinIntent("Hey Willo, pin Goldshire as the inn").named, "Goldshire");
  assert.equal(pinIntent("Can you pin Westfall?").named, "Westfall");
  // A question about a pin isn't a pin (the blind check's probes, 10/18).
  for (const q of ["What's the pin on the map?", "What does the pin in my bag do?", "Who would pin the blame on Arthas?",
    "Is there a pin for the flight master?", "Where do I get the Silver Pin of Valor?", "Can I pin quests in Forever?",
    "Should I pin my action bars?", "Who is Pin the gnome?", "Why do they pin the blame solely on them?"]) {
    assert.equal(pinIntent(q).add, false, q);
  }
});

test("this age's places by name, each with its zone, never a map number", () => {
  const places = pinPlacesOf(INDEX, TOWNS);
  assert.equal(placeNamed("Fargodeep Mine", places), "Fargodeep Mine, Elwynn Forest");
  assert.equal(placeNamed("fargodeep mine in Elwynn", places), "Fargodeep Mine, Elwynn Forest", "the place in what they said");
  assert.equal(placeNamed("Elwynn Forest", places), "Elwynn Forest");
  assert.equal(placeNamed("the Deadmines", places), "The Deadmines");
  assert.equal(placeNamed("Sentinel Hill", places), "Sentinel Hill, Westfall");
  assert.equal(placeNamed("Shattrath", places), null, "not this age");
  assert.equal(placeNamed("the kobold den", places), null);
  assert.equal(placeNamed("A Bundle of Trouble", places), null, "a quest isn't a place");
});

test("the player's day on their own clock; where their last save left them", () => {
  const now = new Date("2026-10-19T03:30:00Z");
  assert.equal(dayOn(now, -420), "October 18", "8:30 PM in California");
  assert.equal(dayOn(now, 120), "October 19");
  assert.equal(dayOn(now, null), "October 19", "no clock: UTC");
  const journey = { tz: -420, moments: [
    { t: Date.parse("2026-10-17T20:00:00Z") / 1000, k: "zone", z: "Westfall", new: 1 },
    { t: Date.parse("2026-10-18T22:00:00Z") / 1000, k: "npc", z: "Elwynn Forest", s: "Goldshire", n: "Smith Argus" },
    { t: Date.parse("2026-10-18T23:00:00Z") / 1000, k: "lvl", lv: 9 },
  ] };
  assert.deepEqual(lastPlace(journey), { place: "Goldshire, Elwynn Forest", x: null, y: null, day: "October 18" });
  assert.equal(lastPlace({ moments: [] }), null);
  assert.equal(lastPlace(null), null);
});

test("a pin without the game's spot: the place named, or their last save's, or why not", () => {
  const places = pinPlacesOf(INDEX, TOWNS), now = new Date("2026-10-18T20:00:00Z");
  const named = spotWithout(pinIntent("pin Fargodeep Mine as the kobold den"), places, null, now, -420);
  assert.deepEqual(named, { spot: { place: "Fargodeep Mine, Elwynn Forest", x: null, y: null, day: "October 18", named: true,
    as: "the kobold den" } });
  assert.equal(pinLine("Kobold den", "", named.spot), "Kobold den · Fargodeep Mine, Elwynn Forest · October 18", "no numbers");
  assert.deepEqual(spotWithout(pinIntent("pin Shattrath as home"), places, null, now, 0), { say: NO_PLACE_LINE("Shattrath") });
  assert.deepEqual(spotWithout(pinIntent("pin where I last was"), places, null, now, 0), { say: NO_SAVED_PLACE_LINE });
  const journey = { tz: 0, moments: [{ t: Date.parse("2026-10-17T20:00:00Z") / 1000, k: "zone", z: "Westfall", new: 1 }] };
  assert.deepEqual(spotWithout(pinIntent("pin where I last was"), places, journey, now, 0),
    { spot: { place: "Westfall", x: null, y: null, day: "October 17", saved: true } });
  assert.equal(spotWithout(pinIntent("pin this spot"), places, journey, now, 0), null, "where they stand: the game's");
});

test("from the phone, pin this spot: why not, how, and their last save's place when there is one", () => {
  assert.equal(phoneNoSpotLine(null), "I can't see where you're standing from your phone, so I haven't pinned anything. " +
    "Name the place and I'll pin it: \"pin Fargodeep Mine as the kobold den\".");
  assert.match(phoneNoSpotLine({ tz: 0, moments: [{ t: 1760000000, k: "npc", z: "Elwynn Forest", s: "Goldshire", n: "Smith Argus" }] }),
    /Or say "pin where I last was" for Goldshire in Elwynn Forest, as of your last save\.$/);
});

// ---- Through her answers ----

const env = { DB: d1(), GEMINI_API_KEY: "test-key",
  ASSETS: { fetch: async () => Response.json(INDEX) } };
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
async function linked({ profile = null } = {}) {
  const sub = `phonepin${++n}`;
  const user = await findOrCreateUser(env, { email: `${sub}@example.com`, googleSub: sub, name: sub });
  const link = await startLink(env);
  await decideLink(env, link.user_code, user, true);
  if (profile) {
    const now = new Date().toISOString();
    env.DB.sqlite.prepare("INSERT INTO profiles (user_id, handle, data, journey, created, updated) VALUES (?, ?, ?, ?, ?, ?)")
      .run(user.id, sub, JSON.stringify(profile.data), JSON.stringify(profile.journey), now, now);
  }
  return { user, token: (await claimToken(env, link.device_code)).token };
}
const HURIN = "Húrin-ClassicBetaPvE";
const JOURNEY = { v: 1, tz: -420, moments: [
  { t: Date.parse("2026-10-18T22:00:00Z") / 1000, k: "npc", z: "Elwynn Forest", s: "Goldshire", n: "Smith Argus" }] };
const HURINS = { data: { name: "Húrin", realm: "ClassicBetaPvE", level: 9 }, journey: JOURNEY };
// The phone's question: no spot, the away note (mobile/src/lib/prompt.ts), its character and clock (LOR-672).
const ask = async (token, question, { client = "companion/ios-0.2.0", character = HURIN } = {}) => (await answer({ env,
  request: new Request("https://example.test/api/companion/answer", { method: "POST", headers: { "X-LF-Client": client,
    Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ prompt: "PLAYER CONTEXT\nname: Húrin\nrealm: ClassicBetaPvE\nThey are away from the game, asking " +
    `from their phone.\n\nSOURCES\n\nQUESTION\n${question}`, persona: "willo",
    notebook: { character, offset: -420 } }) }) })).json();
const usage = { usageMetadata: { promptTokenCount: 4000, candidatesTokenCount: 60 } };
const said = text => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }], ...usage });
const called = (name, args) => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ functionCall: { name, args } }] } }],
  ...usage });
const offered = body => (body.tools?.[0]?.functionDeclarations || []).map(d => d.name);
const page = (user, key) => env.DB.sqlite.prepare("SELECT body FROM notebook_pages WHERE user_id = ? AND page = ?").get(user.id, key);
const today = dayOn(new Date(), -420);

test("P1: pin this spot from the phone pins nothing, and says why and how", async () => {
  const { user, token } = await linked({ profile: HURINS });
  reply = body => offered(body).length ? called("notebook_add", { kind: "note", items: ["here"], heading: "Pins" })
    : said("Pinned! I've marked this spot for you.");
  const res = await ask(token, "Pin this spot, the elite in this cave hits hard");
  assert.equal(res.answer, "I can't see where you're standing from your phone, so I haven't pinned anything. Name the " +
    "place and I'll pin it: \"pin Fargodeep Mine as the kobold den\". Or say \"pin where I last was\" for Goldshire in " +
    "Elwynn Forest, as of your last save.");
  assert.equal(page(user, `char:${HURIN}`), undefined);
  assert.ok(!calls.some(c => offered(c).includes("notebook_pin")), "no pin tool without a place");
  // From the PC with no spot, the PC's own line.
  const pc = await ask(token, "Pin this spot", { client: "companion/0.22.0" });
  assert.equal(pc.answer, NO_SPOT_LINE);
});

test("P2: pin a place by name: that character's Pins, with its zone, no numbers; Pinned only once written", async () => {
  const { user, token } = await linked();
  // What the real model did, 4 runs of 4: the place as the name, theirs as the note. Their name wins, set here.
  reply = body => offered(body).includes("notebook_pin")
    ? called("notebook_pin", { answer: "Pinned at Jasperlode Mine!", name: "Fargodeep Mine", note: "the kobold den" }) : said("?");
  const res = await ask(token, "Pin Fargodeep Mine as the kobold den");
  assert.equal(res.answer, "Pinned: the kobold den, Fargodeep Mine in Elwynn Forest.");
  assert.equal(page(user, `char:${HURIN}`).body, `## Pins\n- the kobold den · Fargodeep Mine, Elwynn Forest · ${today}\n`);
  assert.doesNotMatch(page(user, `char:${HURIN}`).body, /\d{1,3}, \d{1,3}/);
  const tool = calls[0].tools[0].functionDeclarations.find(d => d.name === "notebook_pin");
  assert.match(tool.description, /Fargodeep Mine, Elwynn Forest, the place they named/);
  // Case 29: offered the tool and calling none, never "Pinned".
  reply = () => said("Pinned it for you!");
  const none = await ask(token, "Pin Goldshire as the inn");
  assert.equal(none.answer, "I haven't pinned it yet. Tell me what to call it, and I will.");
  assert.doesNotMatch(page(user, `char:${HURIN}`).body, /Goldshire/);
});

test("a place this age doesn't have is never pinned", async () => {
  const { user, token } = await linked();
  reply = body => offered(body).includes("notebook_pin") ? called("notebook_pin", { name: "Home" }) : said("Pinned Shattrath!");
  const res = await ask(token, "Pin Shattrath as home");
  assert.equal(res.answer, NO_PLACE_LINE("Shattrath"));
  assert.match(res.answer, /^I don't know a place called Shattrath in the world as it is now/);
  assert.equal(page(user, `char:${HURIN}`), undefined);
});

test("P3: where was the kobold den? from that character's page, on the phone", async () => {
  const { user, token } = await linked();
  reply = body => offered(body).includes("notebook_pin") ? called("notebook_pin", { name: "Kobold den" }) : said("?");
  await ask(token, "Pin Fargodeep Mine as the kobold den");
  calls = [];
  reply = () => said("The kobold den is in Fargodeep Mine.");
  await ask(token, "Where was the kobold den?");
  const sent = JSON.stringify(calls[0]);
  assert.match(sent, /the kobold den · Fargodeep Mine, Elwynn Forest/, "her notebook, with the pin, is read");
  // Another character's page doesn't have it.
  calls = [];
  await ask(token, "Where was the kobold den?", { character: "Brynn-ClassicBetaPvE" });
  assert.doesNotMatch(JSON.stringify(calls[0]), /kobold den · Fargodeep Mine/);
  assert.ok(user);
});

test("pin where I last was: their last save's place, said as such; never another character's", async () => {
  const { user, token } = await linked({ profile: HURINS });
  reply = body => offered(body).includes("notebook_pin") ? called("notebook_pin", { name: "Goldshire" }) : said("?");
  const res = await ask(token, "Pin where I last was");
  assert.equal(res.answer, "Pinned: Goldshire in Elwynn Forest, as of your last save.");
  assert.equal(page(user, `char:${HURIN}`).body, "## Pins\n- Goldshire · Goldshire, Elwynn Forest · October 18\n");
  // Brynn asks: the synced journey is Húrin's, so nothing is pinned.
  // Their name for it, given with it: the pin's name; the model's echo of it isn't a note.
  reply = body => offered(body).includes("notebook_pin") ? called("notebook_pin", { name: "Goldshire", note: "my camp" }) : said("?");
  const named = await ask(token, "Pin where I last was as my camp");
  assert.equal(named.answer, "Pinned: my camp, Goldshire in Elwynn Forest, as of your last save.");
  assert.match(page(user, `char:${HURIN}`).body, /\n- my camp · Goldshire, Elwynn Forest · October 18\n$/);
  const brynn = await ask(token, "Pin where I last was", { character: "Brynn-ClassicBetaPvE" });
  assert.equal(brynn.answer, NO_SAVED_PLACE_LINE);
  assert.equal(page(user, "char:Brynn-ClassicBetaPvE"), undefined);
});
