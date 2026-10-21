// What each plan's players use (lib/plan-usage.js): limits hit and voices that said replies, counted per account and
// day under the plan's label, summed by plan for /admin, and gone with "Delete my account". D1 is node:sqlite.

import { test } from "node:test";
import assert from "node:assert/strict";
import { planLabel, recordLimit, recordVoice, planUsageReport, planUsageView, setupPlanUsage } from "../lib/plan-usage.js";
import { setupAnswerLog } from "../lib/answer-log.js";
import { setupBilling } from "../lib/billing.js";
import { findOrCreateUser, setup, deleteUser } from "../lib/accounts.js";
import { d1 } from "./helpers.mjs";

const env = { DB: d1() };
const now = new Date("2026-10-20T12:00:00Z");

test("plan labels tell trials, the beta month, rewards and the brake apart", () => {
  assert.equal(planLabel({ id: "free" }), "free");
  assert.equal(planLabel({ id: "free", brake: true }), "free-brake");
  assert.equal(planLabel({ id: "hero", launch: true }), "beta-hero");
  assert.equal(planLabel({ id: "champion", launch: true, reward: true }), "reward-champion");
  assert.equal(planLabel({ id: "hero", status: "trialing" }), "hero-trialing");
  assert.equal(planLabel({ id: "legend", status: "active" }), "legend");
  assert.equal(planLabel(null), null);
});

test("limits and voices add up by plan, and leave with the account", async () => {
  await setup(env);
  await setupPlanUsage(env);
  const user = await findOrCreateUser(env, { email: "a@example.com", googleSub: "a", name: "A" });
  const free = { id: "free" }, hero = { id: "hero", status: "active" };
  assert.equal(await recordLimit(env, user.id, free, "day", now), true);
  assert.equal(await recordLimit(env, user.id, free, "day", now), true);
  assert.equal(await recordLimit(env, user.id, free, "nonsense", now), false);
  // A reply's first piece counts the reply; its later pieces only add pieces and letters.
  await recordVoice(env, user.id, hero, { kind: "willo", said: "finest:moonwell", pick: "moonwell", first: true, chars: 90 }, now);
  await recordVoice(env, user.id, hero, { kind: "willo", said: "finest:moonwell", pick: "moonwell", first: false, chars: 60 }, now);
  await recordVoice(env, user.id, hero, { kind: "character", said: "pc:room", first: true, chars: 40 }, now);
  const report = await planUsageReport(env, { now });
  assert.deepEqual(report.limits, [{ plan: "free", kind: "day", players: 1, n: 2 }]);
  assert.deepEqual(report.voices, [
    { plan: "hero", kind: "character", said: "pc:room", players: 1, replies: 1, chars: 40 },
    { plan: "hero", kind: "willo", said: "finest:moonwell", players: 1, replies: 1, chars: 150 },
  ]);
  assert.deepEqual(report.picks, [{ plan: "hero", pick: "moonwell", players: 1, replies: 1 }]);
  // /api/admin passes Date.now(), a number: the same report.
  assert.deepEqual(await planUsageReport(env, { now: now.getTime() }), report);
  await deleteUser(env, user);
  const after = await planUsageReport(env, { now });
  assert.deepEqual([after.limits, after.voices], [[], []]);
});

test("the admin view counts kept answers and checkout sources by plan", async () => {
  await setup(env);
  await setupAnswerLog(env);
  await setupBilling(env);
  env.DB.sqlite.exec("DELETE FROM answer_log; DELETE FROM plan_log");
  const add = (plan, spoken, extra = {}) => env.DB.sqlite.prepare("INSERT INTO answer_log (created, player, operation, " +
    "spoken, question, outcome, plan, looked_up, lookups, model) VALUES (?, ?, ?, ?, 'q', ?, ?, ?, ?, ?)").run(
    extra.created || now.toISOString(), extra.player || "p1", extra.operation || "answer", spoken,
    extra.outcome || "answered", plan, extra.looked_up || "no", extra.lookups || null, extra.model || null);
  add("hero", 1, { lookups: "forever_facts,sight", looked_up: "quick" });
  add("hero", 0, { player: "p2", operation: "character" });
  add("hero", 1, { outcome: "failed" });   // a failed answer isn't one
  add("free", 1, { model: "gemini-3.6-flash" });
  // Legend, the smarter model's plan, past the text cap: her answers step down to Flash-Lite. A character's reply is
  // always on Flash-Lite, and before the step-down began (10/19) so was every answer of hers: neither is a step-down.
  // Nor is a Champion's or the beta Hero's answer on Flash-Lite: their plans are on it anyway.
  const flash = "gemini-3.6-flash", lite = "gemini-3.1-flash-lite";
  add("legend", 1, { player: "p3", model: flash });
  add("legend", 1, { player: "p3", model: lite });
  add("legend-trialing", 0, { player: "p4", model: lite });
  add("legend", 1, { player: "p4", model: lite, operation: "character" });
  add("legend", 1, { player: "p5", model: lite, created: "2026-10-19T20:00:00.000Z" });
  add("champion", 1, { player: "p6", model: lite });
  add("beta-hero", 1, { player: "p7", model: lite });
  const log = (id, plan, source, comp = "") => env.DB.sqlite.prepare("INSERT INTO plan_log (subscription_id, plan, " +
    "status, comp, source, updated) VALUES (?, ?, 'active', ?, ?, ?)").run(id, plan, comp, source, now.toISOString());
  log("sub_1", "hero", "welcome");
  log("sub_2", "legend", "willo-empty");
  log("sub_3", "legend", null, "comp_mike");   // comped: left out
  const view = await planUsageView(env, { days: 14, now: now.getTime() });
  assert.deepEqual(view.answers.find(a => a.plan === "hero"),
    { plan: "hero", players: 2, answers: 2, spoken: 1, typed: 1, quick: 1, required: 0, sight: 1, characters: 1 });
  assert.equal(view.answers.find(a => a.plan === "free").answers, 1);
  assert.deepEqual(view.models.sort((a, b) => a.plan.localeCompare(b.plan)), [
    { plan: "legend", players: 1, answers: 2, flash: 1, stepped: 1, steppedPlayers: 1, share: 0.5 },
    { plan: "legend-trialing", players: 1, answers: 1, flash: 0, stepped: 1, steppedPlayers: 1, share: 1 },
  ]);
  assert.deepEqual(view.sources.sort((a, b) => a.plan.localeCompare(b.plan)),
    [{ source: "welcome", plan: "hero", n: 1 }, { source: "willo-empty", plan: "legend", n: 1 }]);
  assert.equal(view.collectingSince, "2026-10-19");
});
