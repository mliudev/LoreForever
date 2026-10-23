// The first-run trial is "try everything" (Mike, 2026-10-19; 10/21 QA: "The free plan needs some better QA"): every
// feature a paid plan has is in the trial (its opens, its counted uses, or the plan as the trial has it, withTrial) or
// left out on purpose, with the reason here. A feature added to a plan fails this until it's one or the other.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PLANS, PLAN_VOICE, COMPANION_FEATURES } from "../lib/billing.js";
import { ALLOWED } from "../lib/willo-custom.js";
import { trialView, withTrial, TRIAL } from "../lib/best-first.js";
import { readsAloud } from "../lib/companion-voice.js";

const trial = { on: true, until: "2026-10-28T00:00:00.000Z",
                left: { lookups: TRIAL.lookups, sight: TRIAL.sight, cast: TRIAL.cast } };
const view = trialView(PLANS.free, trial);
const tried = withTrial({ ...PLANS.free, voice: PLAN_VOICE.free }, trial);

// Where the free plan's trial has each paid feature.
const IN_TRIAL = {
  voices: () => view.opens.includes("voices"),
  push_to_talk: () => view.opens.includes("talk"),
  sight: () => view.uses.sight.of > 0,
  research: () => view.uses.web.of > 0,
  reminders: () => view.opens.includes("goals"),
  // Characters in their own voices (npc_voices; Champion's and Legend's PLAN_VOICE characters): TRIAL.cast tries.
  npc_voices: () => view.uses.characters.of > 0,
  characters: () => view.uses.characters.of > 0,
  longMemory: () => view.opens.includes("memory"),
  choice: () => tried.voice.choice === true,
  azeroth: () => tried.voice.azeroth === true,
  whole: () => PLAN_VOICE.free.whole === true,          // every plan's, not a paid one's (10/21)
  // The narrator reading short answers (the PM, 10/21: "try everything" means everything).
  readings: () => readsAloud(tried) && view.opens.includes("readings"),
  presets: () => view.opens.includes("style"),
  words: () => view.opens.includes("style"),
  tales: () => view.opens.includes("tales"),
};
// Left out on purpose.
const EXCLUDED = {
  smarter: "Legend's smarter mind (3.6 Flash) costs about three times an answer on Flash-Lite; Mike, 10/19: Legend's only",
};

test("every paid feature is in the first-run trial, or left out with a reason", () => {
  const paid = new Set([
    ...Object.entries(COMPANION_FEATURES.paid).filter(([k, v]) => v && v !== COMPANION_FEATURES.free[k]).map(([k]) => k),
    ...Object.values(PLANS).flatMap(p => ["longMemory", "smarter"].filter(k => p[k])),
    ...Object.values(PLAN_VOICE).flatMap(v => ["choice", "azeroth", "characters", "whole"].filter(k => v[k])),
    ...Object.values(ALLOWED).flat(),
    "readings",
  ]);
  for (const feature of paid) {
    if (Object.hasOwn(EXCLUDED, feature)) continue;
    assert.ok(Object.hasOwn(IN_TRIAL, feature), `${feature}: put it in the trial, or in EXCLUDED with the reason`);
    assert.equal(IN_TRIAL[feature](), true, `${feature} isn't in the trial`);
  }
  assert.ok(TRIAL.cast >= 10, "characters in their own voices: a fair few tries");
});

test("the beta's free Hero month tries the rest: Legend's voices, characters' own voices, memory, style and tales", () => {
  const hero = { ...PLANS.hero, launch: true, voice: PLAN_VOICE.hero };
  const v = trialView(hero, trial), t = withTrial(hero, trial);
  assert.ok(v.uses.characters.of > 0 && t.voice.choice && t.voice.azeroth);
  for (const o of ["voices", "memory", "style", "tales"]) assert.ok(v.opens.includes(o), o);
});
