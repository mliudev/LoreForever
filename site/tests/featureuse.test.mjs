// Anonymous usage counts with the companion's check-in (LOR-435, lib/featureuse.js, functions/api/companion/checkin.js):
// only allowlisted counts are stored, never text; an oversized check-in is refused whole; older companions without
// counts still check in; /admin shares are of the installs that sent counts, players' builds only.
// In-process on node:sqlite; nothing here requests the live site. Run: node --test site/tests/
import { test } from "node:test";
import assert from "node:assert/strict";

import { onRequestPost as checkin } from "../functions/api/companion/checkin.js";
import { featureReport, MAX_BODY } from "../lib/featureuse.js";
import { d1 } from "./helpers.mjs";

const day = (ago = 0) => new Date(Date.now() - ago * 864e5).toISOString().slice(0, 10);
const post = (env, body) => checkin({ env,
  request: new Request("https://loreforeverwow.com/api/companion/checkin", { method: "POST",
    headers: { "Content-Type": "application/json", "X-LF-Client": "companion/0.16.0" },
    body: typeof body === "string" ? body : JSON.stringify(body) }) });
const checkIn = (install, days, versions = { companion: "0.16.0", addon: "0.16.0" }) =>
  ({ v: 1, install: install.repeat(64), ...versions, ...(days ? { usage: { v: 2, days } } : {}) });
const stored = env => env.DB.sqlite.prepare("SELECT install, day, counts FROM install_usage ORDER BY install, day").all()
  .map(r => ({ ...r, counts: JSON.parse(r.counts) }));

test("only allowlisted counts are kept: unknown keys and kinds, text and odd numbers are dropped", async () => {
  const env = { DB: d1() };
  const days = { [day()]: {
    ask: 2, panel: 3, min: 45, play: { zone: 3, "Edwin VanCleef": 1 }, tab: { journey: 1, secret: 2 },
    asked: { typed: 2 }, lang: { deDE: 7 }, on: { autoZone: 1, password: 1 }, chat: 4,
    q: "who is the lich king", name: "Aelric", zone: "Elwynn Forest", pos: { x: 0.41, y: 0.65 }, live: -1, pic: 1.5,
    journey: "3", chatText: { hello: 1 },
  }, "Aelric": { ask: 9 }, "2020-01-01": { ask: 1 } };
  assert.equal((await post(env, checkIn("a", days))).status, 204);
  const rows = stored(env);
  assert.deepEqual(rows, [{ install: "a".repeat(64), day: day(), counts: {
    ask: 2, panel: 3, min: 45, "play.zone": 3, "tab.journey": 1, "asked.typed": 2, "lang.deDE": 1, "on.autoZone": 1, chat: 4 } }]);
  assert.ok(!/lich|Aelric|Elwynn|VanCleef|hello/.test(JSON.stringify(rows)));
  // A resend of the same day keeps the larger count for each, never adds them up.
  days[day()] = { ask: 1, panel: 5 };
  assert.equal((await post(env, checkIn("a", days))).status, 204);
  assert.deepEqual([stored(env)[0].counts.ask, stored(env)[0].counts.panel], [2, 5]);
});

test("an oversized check-in is refused whole; one without counts (an older companion) still checks in", async () => {
  const env = { DB: d1() };
  const big = checkIn("b", { [day()]: { ask: 1 } });
  big.usage.pad = "x".repeat(MAX_BODY);
  assert.equal((await post(env, big)).status, 413);
  assert.equal(env.DB.sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'companion_days'").get(), undefined,
    "nothing stored, not even the check-in");
  assert.equal((await post(env, checkIn("c"))).status, 204);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM companion_days").get().n, 1);
});

test("/admin: each feature's share of active installs, by level and new or returning, internal builds left out", async () => {
  const env = { DB: d1() };
  await post(env, checkIn("a", { [day(1)]: { play: { zone: 2 }, lv: { "20": 1 } }, [day()]: { ask: 1, lv: { "30": 1 } } }));
  env.DB.sqlite.prepare("INSERT INTO companion_days VALUES (?, ?, '0.16.0', '0.16.0')").run(day(3), "a".repeat(64));
  await post(env, checkIn("b", { [day()]: { play: { dialogue: 1 }, chat: 2, lv: { "0": 1 } } }));
  await post(env, checkIn("d", { [day()]: { ask: 50, chat: 9 } }, { companion: "0.1.0", addon: "0.16.0-dev" }));
  const r = await featureReport(env);
  assert.deepEqual(r.active, { d14: 2, d30: 2 }, "the internal build isn't an active install");
  assert.deepEqual([r.use.narration.d30, r.use.questions.d30, r.use.sam.d30], [2, 1, 1]);
  assert.deepEqual(r.levels.map(l => [l.lv, l.installs, l.use.narration || 0]), [[0, 1, 1], [30, 1, 1]],
    "by the highest level range each install played at");
  assert.deepEqual([r.returning.returning.installs, r.returning.new.installs], [1, 1]);
  assert.deepEqual([r.returning.returning.use.questions, r.returning.new.use.sam], [1, 1]);
  const today = r.trend.find(d => d.day === day());
  assert.deepEqual([today.installs, today.use.narration, today.use.sam], [2, 1, 1], "the trend comes from the rollups");
});
