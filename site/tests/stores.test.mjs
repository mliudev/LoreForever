// CurseForge's and GitHub's download counts kept per release and day (LOR-421, lib/stores.js), with cfwidget and
// GitHub stood in for: nothing here touches the network. Run: node --test site/tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { snapshotStores, storesReport, resetSnapshotClock, CF_CORE, CF_PACKS } from "../lib/stores.js";
import { onRequestPost as curseforgeApi } from "../functions/api/admin/curseforge.js";
import { d1, ROOT } from "./helpers.mjs";

const H = 3600e3;
const UPLOAD = Date.UTC(2026, 9, 10, 0, 45);   // a release out at 00:45 UTC

test("snapshots: the add-on hourly, packs daily, a release's first 24 hours read between snapshots", async () => {
  resetSnapshotClock();
  const env = { DB: d1() };
  const calls = [];
  let core = { total: 28000, file: 3000 };
  const get = async id => {
    calls.push(id);
    if (id === CF_PACKS[0]) throw new Error("cfwidget: 202");   // not in cfwidget's cache yet
    if (id !== CF_CORE) return { id, title: `Pack ${id}`, downloads: { total: 50 }, files: [] };
    return { id, title: "Lore Forever", downloads: { total: core.total }, files: [
      { id: 9124319, display: "Lore Forever 0.14.0", uploaded_at: new Date(UPLOAD).toISOString(), downloads: core.file },
      { id: 9114605, display: "Lore Forever 0.13.1", uploaded_at: new Date(UPLOAD - 21 * H).toISOString(), downloads: 3369 }] };
  };
  const github = [{ tag: "v0.14.0", published: new Date(UPLOAD).toISOString(), downloads: 40 }];

  await snapshotStores(env, { github, now: UPLOAD + 23 * H, get });           // 23:45, the release's first day
  assert.equal(calls.length, 1 + CF_PACKS.length, "every project once");
  calls.length = 0;
  await snapshotStores(env, { github, now: UPLOAD + 23.5 * H, get });
  assert.equal(calls.length, 0, "nothing due within the hour");
  core = { total: 28500, file: 3400 };
  await snapshotStores(env, { github, now: UPLOAD + 25 * H, get });           // 01:45 the next day
  assert.deepEqual(calls, [CF_CORE], "the packs wait a day, the one that failed too");

  const file = env.DB.sqlite.prepare("SELECT downloads, day1 FROM store_files WHERE file = '9124319'").get();
  assert.deepEqual({ ...file }, { downloads: 3400, day1: 3200 }, "halfway between 3,000 at 23 h and 3,400 at 25 h");
  const older = env.DB.sqlite.prepare("SELECT day1 FROM store_files WHERE file = '9114605'").get();
  assert.equal(older.day1, null, "first seen after its 24 hours: not known");
  assert.equal(env.DB.sqlite.prepare("SELECT ok FROM store_tries WHERE project = ?").get(String(CF_PACKS[0])).ok, 0);

  const report = await storesReport(env, UPLOAD + 25 * H);
  const day = report.days.find(d => d.day === "2026-10-11");
  assert.deepEqual(day.curseforge, { n: 500, kind: "measured" });
  assert.deepEqual(day.releases, [{ name: "Lore Forever 0.14.0", n: 400 }]);
  // No snapshot the day before: each release's downloads spread over the hours it was newest. 0.13.1 was newest
  // 21 hours, 45 minutes of them that day; 0.14.0 25 hours so far, 23¼ of them that day.
  assert.deepEqual(report.days.find(d => d.day === "2026-10-10").curseforge,
    { n: Math.round(3369 * 0.75 / 21 + 3400 * 23.25 / 25), kind: "estimate" });
  assert.deepEqual(report.releases.map(r => [r.name, r.day1, r.current]),
    [["Lore Forever 0.14.0", 3200, null], ["Lore Forever 0.13.1", null, 21]]);
  assert.deepEqual(report.inUse, { n: 3200, name: "Lore Forever 0.14.0", hours: 25 }, "newest 20 hours or more: its first day");
  assert.equal((await storesReport(env, UPLOAD + 7 * H)).inUse.name, "Lore Forever 0.13.1", "only 7 hours out: the one before");
});

test("author dashboard numbers: admin key only, resending changes nothing, unique per week is CurseForge's own", async () => {
  const env = { DB: d1(), ADMIN_KEY: "k" };
  const ms = day => Date.parse(day + "T00:00:00Z");
  const now = Date.parse("2026-10-11T12:00:00Z");
  const q = data => ({ id: 1, queryResult: { data, legend: [] } });
  const body = { fetched_at: "2026-10-11T12:00:00Z", days_back: 90, queries: {
    2: q([{ day: null, total: 0 }, { day: ms("2026-10-10"), [CF_CORE]: 3300, [CF_PACKS[0]]: 40, total: 3340 },
          { day: ms("2026-10-11"), [CF_CORE]: 1500, total: 1500 }]),
    3: q([{ day: ms("2026-10-10"), [CF_CORE]: 2900, [CF_PACKS[0]]: 30, unique: 2930 },
          { day: ms("2026-10-11"), [CF_CORE]: 1400, unique: 1400 }]),
    6: q([{ day: ms("2026-10-10"), "Lore Forever 0.14.0": 3000, "Lore Forever 0.13.1": 300, total: 3300 },
          { day: ms("2026-10-11"), "Lore Forever 0.14.0": 480, "Lore Forever 0.15.0": 1020, total: 1500 }]),
    11: q([{ day: ms("2026-10-05"), [CF_CORE]: 9139, total: 9139 }]),   // distinct that week, not the daily sum
  } };
  const send = (headers, payload = body) => curseforgeApi({ env, request: new Request("https://loreforeverwow.com/api/admin/curseforge",
    { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(payload) }) });
  assert.equal((await send({})).status, 401);
  assert.equal((await send({ Authorization: "Bearer k", Origin: "https://authors.curseforge.com" })).status, 403);
  const first = await (await send({ Authorization: "Bearer k", Origin: "https://loreforeverwow.com" })).json();
  assert.deepEqual([first.ok, first.first, first.last], [true, "2026-10-10", "2026-10-11"]);
  const rows = () => env.DB.sqlite.prepare("SELECT period, day, project, file, metric, value FROM cf_author_stats ORDER BY 1, 2, 3, 4, 5")
    .all().map(r => ({ ...r }));
  const stored = rows();
  await send({ Authorization: "Bearer k" });
  assert.deepEqual(rows(), stored, "the same numbers again change nothing");

  // A cfwidget file list, for the release out at 00:45 on Oct 10: its first 24 hours are that day plus 45 minutes'
  // worth of the next.
  env.DB.sqlite.prepare("INSERT INTO store_files VALUES ('curseforge', ?, '9124319', 'Lore Forever 0.14.0', ?, 3480, NULL, ?)")
    .run(String(CF_CORE), "2026-10-10T00:45:00.000Z", "2026-10-11T12:00:00.000Z");
  const report = await storesReport(env, now);
  const oct10 = report.days.find(d => d.day === "2026-10-10");
  assert.deepEqual([oct10.curseforge, oct10.unique, oct10.packs?.n], [{ n: 3300, kind: "author" }, 2900, 40]);
  assert.deepEqual(report.author.thisWeek, { week: "2026-10-05", downloads: 0, unique: 9139 });
  assert.deepEqual(report.releases.map(r => [r.name, r.day1, r.from]), [["Lore Forever 0.14.0", Math.round(3000 + 480 * 0.75 / 24), "author"]]);
});

test("the site keeps the same CurseForge projects as release/curseforge.json", () => {
  const { projects } = JSON.parse(readFileSync(resolve(ROOT, "release/curseforge.json"), "utf8"));
  const ids = projects.map(p => p.id).filter(id => id != null && id !== CF_CORE).sort();
  assert.deepEqual([...CF_PACKS].sort(), ids, "add the new project's id to CF_PACKS in site/lib/stores.js");
});
