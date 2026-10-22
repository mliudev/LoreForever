// The voices and plans picks (Mike, 2026-10-21): the plan cards (/plans), /account, /willo, the Stripe blurbs and the
// Terms say the same thing about each plan: its answers, Hero's lead (her finest voice, and the narrator reads the
// add-on's short answers), Legend's (her richer voice, the Voices of Azeroth, her whole answer spoken, new features
// first). The narrator's readings and Legend's whole answer wait for the release whose companion does them
// (lib/features.js readings, whole), so a card never promises what the app can't do yet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PLANS, PAID, PLAN_VOICE, planFeatures, planCompare, blurbs, cardFlags, plansLine, voicePicks } from "../lib/billing.js";

const page = name => readFileSync(new URL(`../public/${name}`, import.meta.url), "utf8").replace(/\s+/g, " ");
const ON = { azeroth: true, readings: true, whole: true };

test("the Terms list each plan's price, answers and day's most as the plans have them (Legend 6,000, not 4,000)", () => {
  const terms = page("terms.html");
  assert.doesNotMatch(terms, /4,000 answers/);
  for (const id of PAID) {
    const p = PLANS[id];
    const line = new RegExp(`<strong>${p.name}</strong>: \\$${(p.monthly / 100).toFixed(2)} a month\\. ` +
      `${p.answersPerMonth.toLocaleString("en-US")} answers a month, up to ${p.answersPerDay} a day\\.`);
    assert.match(terms, line, p.name);
  }
  assert.match(terms, new RegExp(`answers for free too: ${PLANS.free.answersPerDay} answers a day`));
  // What each card leads with, in the Terms' words too.
  assert.match(terms, /Hero<\/strong>:[^<]*finest voice[^<]*your narrator reads the add-on's short answers/);
  assert.match(terms, /Legend<\/strong>:[^<]*richer voice[^<]*Voices of Azeroth[^<]*whole answer spoken[^<]*new features first/);
  assert.match(terms, /community narrator's voice is never copied/);
});

test("Hero's card leads with her finest voice and the narrator; Legend's adds Azeroth, the whole answer, new features first", () => {
  const on = planFeatures(ON);
  assert.equal(on.hero[0], "Willo's finest voice on every answer, and your narrator reads the add-on's short answers");
  assert.match(on.legend[0], /richer voice/);
  assert.match(on.legend[0], /whole answer/);
  assert.ok(on.legend.some(l => /22 voices of Azeroth/.test(l)));
  assert.ok(on.legend.includes("New features first"));
  assert.ok(on.legend.some(l => l === `${PLANS.legend.answersPerMonth.toLocaleString("en-US")} Willo answers a month`));
  // The Voices of Azeroth are Legend's alone: Champion picks among her own ten.
  assert.ok(!on.champion.some(l => /Azeroth/.test(l)));
  assert.ok(on.champion.includes("Pick Willo's voice from her own 10, women's and men's"));
  assert.equal(PLAN_VOICE.legend.azeroth, true);
  assert.ok(!PLAN_VOICE.champion.azeroth && !PLAN_VOICE.hero.azeroth);
  // Until the release turns them on, no card promises the readings or the whole answer.
  const off = planFeatures({ azeroth: true });
  assert.ok(!JSON.stringify(off).includes("narrator"));
  assert.ok(!JSON.stringify(off).includes("whole answer"));
  assert.equal(off.hero[0], "Willo's finest voice on every answer you ask out loud");
  // Prices don't change.
  assert.deepEqual(PAID.map(id => PLANS[id].monthly), [499, 999, 1999]);
});

test("the compare table, the Stripe blurbs, /willo's line and the thank-you count say the same", () => {
  const rows = Object.fromEntries(planCompare({}, ON).map(r => [r.label, r.values]));
  assert.deepEqual(rows["Your narrator reads the add-on's short answers"], { free: "—", hero: "✓", champion: "✓", legend: "✓" });
  assert.deepEqual(rows["22 Voices of Azeroth for Willo"], { free: "—", hero: "—", champion: "—", legend: "✓" });
  assert.deepEqual(rows["Her whole answer spoken"], { free: "—", hero: "—", champion: "—", legend: "✓" });
  assert.deepEqual(rows["New features first"], { free: "—", hero: "—", champion: "—", legend: "✓" });
  assert.equal(rows["Willo's voice: when you ask out loud"].champion, "Finest, pick from ten");
  assert.equal(planCompare({}, { azeroth: true }).some(r => /narrator|whole/.test(r.label)), false);
  const b = blurbs(ON);
  assert.match(b.hero, /^Willo's finest voice on every answer, and your narrator reads the add-on's short answers: 1,500/);
  assert.match(b.legend, /whole answer.*6,000 Willo answers a month, the 22 Voices of Azeroth, new features first/);
  assert.doesNotMatch(b.champion, /Azeroth/);
  for (const text of Object.values(b)) assert.ok(text.length <= 350, "Stripe shows it under the plan's name");
  assert.equal(plansLine({ SITE_FEATURES: "readings" }),
    "From Hero, Willo's finest voice on every answer, and your narrator reads the add-on's short answers.");
  assert.equal(plansLine({}), "From Hero, Willo's finest voice on every answer you ask out loud.");
  assert.match(page("willo.html"), /<!-- willo-plans -->From Hero, Willo's finest voice on every answer you ask out loud\.<!-- \/willo-plans -->/);
  assert.deepEqual(cardFlags({ SITE_FEATURES: "readings,whole" }), { azeroth: true, readings: true, whole: true });
  assert.equal(voicePicks({}, "champion"), 10);
  assert.equal(voicePicks({}, "legend"), 32);
});
