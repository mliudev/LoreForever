// The voices and plans picks (Mike, 2026-10-21): the plan cards (/plans), /account, /willo, the Stripe blurbs and the
// Terms say the same thing about each plan: its answers, Hero's lead (her finest voice, and the narrator reads the
// add-on's short answers), Legend's (her richer voice, the Voices of Azeroth, new features first). The narrator's
// readings wait for the release whose companion does them (lib/features.js readings), so a card never promises what
// the app can't do yet. Her whole answer spoken is every plan's since 10/21, so no card claims it as a plan's own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PLANS, PAID, PLAN_VOICE, planFeatures, planCompare, blurbs, cardFlags, plansLine, voicePicks } from "../lib/billing.js";

const page = name => readFileSync(new URL(`../public/${name}`, import.meta.url), "utf8").replace(/\s+/g, " ");
const ON = { azeroth: true, readings: true };

test("the Terms say what each plan leads with, as its card does", () => {
  const terms = page("terms.html");
  // Each plan's price and answers: terms-plans.test.mjs.
  assert.match(terms, /Hero<\/strong>:[^<]*finest voice[^<]*your narrator reads the add-on's short answers/);
  assert.match(terms, /Legend<\/strong>:[^<]*richer voice[^<]*Voices of Azeroth[^<]*new features first/);
  assert.doesNotMatch(terms, /Legend<\/strong>:[^<]*whole answer/, "every plan hears her whole answer (10/21)");
  assert.match(terms, /community narrator's voice is never copied/);
});

test("Hero's card leads with her finest voice and the narrator; Legend's adds Azeroth, the whole answer, new features first", () => {
  const on = planFeatures(ON);
  assert.equal(on.hero[0], "Willo's finest voice on every answer, and your narrator reads the add-on's short answers");
  assert.match(on.legend[0], /richer voice/);
  assert.ok(on.legend.some(l => /22 voices of Azeroth/.test(l)));
  assert.ok(on.legend.includes("New features first"));
  for (const id of PAID) assert.ok(on[id].some(l => /^unlimited willo answers$/i.test(l)), `${id}: unlimited answers`);
  // The Voices of Azeroth are Legend's alone: Champion picks among her own ten.
  assert.ok(!on.champion.some(l => /Azeroth/.test(l)));
  assert.ok(on.champion.includes("Pick Willo's voice from her own 10, women's and men's"));
  assert.equal(PLAN_VOICE.legend.azeroth, true);
  assert.ok(!PLAN_VOICE.champion.azeroth && !PLAN_VOICE.hero.azeroth);
  // Until the release turns them on, no card promises the readings or the whole answer.
  const off = planFeatures({ azeroth: true });
  assert.ok(!JSON.stringify(off).includes("narrator"));
  assert.equal(off.hero[0], "Willo's finest voice on every answer you ask out loud");
  // Prices don't change.
  assert.deepEqual(PAID.map(id => PLANS[id].monthly), [499, 999, 1999]);
});

test("the compare table, the Stripe blurbs, /willo's line and the thank-you count say the same", () => {
  const rows = Object.fromEntries(planCompare({}, ON).map(r => [r.label, r.values]));
  assert.deepEqual(rows["Your narrator reads the add-on's short answers"], { free: "—", hero: "✓", champion: "✓", legend: "✓" });
  assert.deepEqual(rows["22 Voices of Azeroth for Willo"], { free: "—", hero: "—", champion: "—", legend: "✓" });
  assert.equal(rows["Her whole answer spoken"], undefined, "every plan's (10/21): no row sets plans apart by it");
  assert.deepEqual(rows["New features first"], { free: "—", hero: "—", champion: "—", legend: "✓" });
  assert.equal(rows["Willo's voice: when you ask out loud"].champion, "Finest, pick from ten");
  assert.equal(planCompare({}, { azeroth: true }).some(r => /narrator/.test(r.label)), false);
  const b = blurbs(ON);
  assert.match(b.hero, /^Willo's finest voice on every answer, and your narrator reads the add-on's short answers: unlimited/i);
  // Legend's smarter mind is back on its card, blurb and row once it's real (Mike, 10/24: "go with deepseek thinking").
  assert.match(b.legend, /^Willo's richer voice, and a smarter mind for hard questions[^:]*: unlimited Willo answers, the 22 Voices of Azeroth, new features first/i);
  assert.deepEqual(rows["Willo's smarter mind for hard questions"], { free: "—", hero: "—", champion: "—", legend: "✓" });
  assert.doesNotMatch(b.champion, /Azeroth/);
  for (const text of Object.values(b)) assert.ok(text.length <= 350, "Stripe shows it under the plan's name");
  assert.equal(plansLine({ SITE_FEATURES: "readings" }),
    "From Hero, Willo's finest voice on every answer, and your narrator reads the add-on's short answers.");
  // Readings on since the 0.25.0 release (lib/features.js); off, the line says only her voice.
  assert.equal(plansLine({}), plansLine({ SITE_FEATURES: "readings" }));
  assert.equal(plansLine({ SITE_FEATURES: "-readings" }), "From Hero, Willo's finest voice on every answer you ask out loud.");
  assert.match(page("willo.html"), /<!-- willo-plans -->From Hero, Willo's finest voice on every answer you ask out loud\.<!-- \/willo-plans -->/);
  assert.deepEqual(cardFlags({ SITE_FEATURES: "readings" }), { azeroth: true, readings: true });
  assert.equal(voicePicks({}, "champion"), 10);
  assert.equal(voicePicks({}, "legend"), 32);
});
