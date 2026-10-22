// The north-star tile's counts (lib/north-star.js): Willo's daily players, the ones who came back from the week
// before, and the ones whose questions are in the answer log. Fixed days and players; D1 is node:sqlite (helpers.mjs).
// Run: node --test 'site/tests/*.test.mjs'
import { test } from "node:test";
import assert from "node:assert/strict";

import { setup } from "../lib/accounts.js";
import { setupAnswerLog, playerKey } from "../lib/answer-log.js";
import { reportDatabase } from "../lib/report-read.js";
import { northStarDays, northStarReport, TARGET } from "../lib/north-star.js";
import { d1 } from "./helpers.mjs";

const NOW = Date.parse("2026-10-21T18:00:00Z");
const TODAY = "2026-10-21";

test("returning means asked today and on one of the 7 days before; studied means today's questions are kept", () => {
  const asked = [
    // a: every day this week; b: 8 days ago only (outside the window) and today; c: new today; d: 7 days ago and today
    ...["2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20", TODAY].map(day => ({ day, key: "a" })),
    { day: "2026-10-13", key: "b" }, { day: TODAY, key: "b" },
    { day: TODAY, key: "c" },
    { day: "2026-10-14", key: "d" }, { day: TODAY, key: "d" },
  ];
  // a kept today; d kept, but only on an earlier day; c kept today but isn't returning
  const logged = [{ day: TODAY, key: "a" }, { day: "2026-10-14", key: "d" }, { day: TODAY, key: "c" }];
  const days = northStarDays(asked, logged, TODAY, 30);
  assert.equal(days.length, 30);
  assert.equal(days[0].day, "2026-09-22");
  assert.deepEqual(days.at(-1), { day: TODAY, dau: 4, returning: 2, studied: 1 });
  assert.deepEqual(days.at(-2), { day: "2026-10-20", dau: 1, returning: 1, studied: 0 });
  assert.deepEqual(days.find(d => d.day === "2026-10-15"), { day: "2026-10-15", dau: 1, returning: 0, studied: 0 },
    "a's first day: nothing before it");
});

test("days the answer log no longer keeps are null, not 0", () => {
  const days = northStarDays([], [], TODAY, 30, 14);
  assert.equal(days.filter(d => d.studied === null).length, 16);
  assert.equal(days.find(d => d.studied !== null).day, "2026-10-08");
  assert.ok(days.every(d => d.dau === 0 && d.returning === 0));
});

test("the report matches accounts to the log by its salted key, leaves out excluded accounts and only reads", async () => {
  const env = { DB: d1() };
  await setup(env);
  await setupAnswerLog(env);
  const ask = (user, day) => env.DB.sqlite.prepare("INSERT INTO answer_days (day, user_id, n) VALUES (?, ?, 1)").run(day, user);
  const keep = async (user, created) => env.DB.sqlite.prepare("INSERT INTO answer_log (created, player, operation, question, " +
    "outcome) VALUES (?, ?, 'answer', 'q', 'answered')").run(created, await playerKey(env, user));
  for (const u of ["u1", "u2", "u3", "admin"]) { ask(u, "2026-10-18"); ask(u, TODAY); }
  ask("u4", TODAY);
  await keep("u1", "2026-10-21T09:00:00Z");
  await keep("u2", "2026-10-20T09:00:00Z");    // kept, but not today's questions
  await keep("u4", "2026-10-21T10:00:00Z");    // kept, but new this week
  await keep("admin", "2026-10-21T11:00:00Z");
  env.DB.sqlite.prepare("INSERT INTO excluded_accounts VALUES ('admin', 'admin', ?)").run(new Date(NOW).toISOString());

  const report = reportDatabase(env.DB);
  const out = await northStarReport({ DB: report.DB }, NOW);
  report.assertHealthy();
  assert.equal(out.target, TARGET);
  assert.deepEqual(out.today, { day: TODAY, dau: 4, returning: 3, studied: 1 });
  assert.deepEqual(out.yesterday, { day: "2026-10-20", dau: 0, returning: 0, studied: 0 });
  assert.equal(out.days.length, 30);
  const text = JSON.stringify(out);
  for (const secret of ["u1", "u2", "admin", await playerKey(env, "u1")]) assert.ok(!text.includes(secret), secret);
});

test("before anything is kept (no salt yet), nobody counts as studied", async () => {
  const env = { DB: d1() };
  await setup(env);
  await setupAnswerLog(env);
  for (const day of ["2026-10-20", TODAY]) env.DB.sqlite.prepare("INSERT INTO answer_days (day, user_id, n) VALUES (?, 'u1', 1)").run(day);
  const out = await northStarReport(env, NOW);
  assert.deepEqual(out.today, { day: TODAY, dau: 1, returning: 1, studied: 0 });
});
