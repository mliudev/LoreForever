// The companion's daily check-in (LOR-422, lib/checkins.js, functions/api/companion/checkin.js): it keeps a hashed
// install id and two version numbers per day, nothing else, and /admin counts installs in use and returning, without
// internal builds. In-process on node:sqlite; nothing here requests the live site. Run: node --test site/tests/
import { test } from "node:test";
import assert from "node:assert/strict";

import { onRequestPost as checkin } from "../functions/api/companion/checkin.js";
import { checkinReport } from "../lib/checkins.js";
import { d1, stopClock } from "./helpers.mjs";

const INSTALL = "a".repeat(64), OTHER = "b".repeat(64);
const post = (env, body, headers = { "X-LF-Client": "companion/0.15.0" }) => checkin({ env,
  request: new Request("https://loreforeverwow.com/api/companion/checkin", { method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body) }) });

test("a check-in keeps only the hashed install id and versions, once per install and day", async t => {
  stopClock(t);
  const env = { DB: d1() };
  const sent = { v: 1, install: INSTALL, companion: "0.15.0", addon: "0.15.0", name: "Aelric", account: "x@y.z" };
  assert.equal((await post(env, sent)).status, 204);
  assert.equal((await post(env, sent)).status, 204);
  assert.equal((await post(env, { v: 1, install: OTHER, companion: "<b>", addon: "0.14.0" })).status, 204);
  for (const [body, headers] of [[sent, {}], [{ ...sent, install: "Aelric" }, undefined], ["not json", undefined]]) {
    assert.equal((await post(env, body, headers)).status, 400);
  }
  const rows = env.DB.sqlite.prepare("SELECT * FROM companion_days ORDER BY install").all().map(r => ({ ...r }));
  const day = new Date().toISOString().slice(0, 10);
  assert.deepEqual(rows, [{ day, install: INSTALL, companion: "0.15.0", addon: "0.15.0" },
                          { day, install: OTHER, companion: null, addon: "0.14.0" }]);
  assert.ok(!JSON.stringify(rows).includes("203.0.113.7"));
});

test("/admin counts players' installs: internal builds (no version, unstamped 0.1.0, -dev, -preview or -qa) stay out", async t => {
  stopClock(t);
  const env = { DB: d1() };
  const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  await post(env, { v: 1, install: INSTALL, companion: "0.15.0", addon: "0.15.0" });
  env.DB.sqlite.prepare("INSERT INTO companion_days VALUES (?, ?, '0.15.0', '0.14.0')").run(daysAgo(3), INSTALL);
  for (const [install, companion, addon] of [["c", "0.1.0", "0.14.0"], ["d", "0.15.0", "0.14.0-preview.1"],
                                             ["e", "0.16.0-dev", "0.15.0"], ["f", null, "0.15.0"],
                                             ["9", "0.18.0-qa10", "0.18.0"]]) {
    await post(env, { v: 1, install: install.repeat(64), companion, addon });
  }
  const report = await checkinReport(env);
  assert.deepEqual([report.today, report.week, report.installs, report.returning], [1, 1, 1, 1]);
  assert.deepEqual(report.versions, [{ companion: "0.15.0", addon: "0.15.0", n: 1 }], "by each install's latest check-in");
  assert.equal(report.internal.installs, 5);
});
