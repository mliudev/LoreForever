// CurseForge's and GitHub's own download counts (LOR-421), for /admin's Growth tab. Most players get Lore Forever
// through CurseForge, and the CurseForge app updates installed add-ons, so the downloads a release gets in its first day
// come close to the CurseForge installs in use that day: a trend, not a head count (a download can be a new install, an
// update, a second PC or a manual download). Public numbers only; nothing about any player.
//
// Two sources:
// - cfwidget (api.cfwidget.com/<project id>), the keyless public mirror of the project pages the home page's counter
//   already reads (functions/api/downloads.js), and GitHub's releases API. Not CurseForge's own API: there's no key,
//   and its terms don't allow keeping its numbers. GET /api/downloads takes a snapshot after answering (waitUntil) when
//   one is due: the add-on's project and GitHub at most hourly (so a release's first 24 hours can be read off), the
//   narration and language projects every 6 hours. Pages Functions have no schedule of their own.
// - CurseForge's author dashboard (authors.curseforge.com), the only place with unique downloads: a routine in Mike's
//   browser reads it there and posts the numbers to POST /api/admin/curseforge (functions/api/admin/curseforge.js,
//   importAuthorStats). No CurseForge credential ever reaches the site. Where author numbers exist for a day, they're
//   used instead of what's worked out from cfwidget.
//
//   store_counts (day, source, project, file, downloads, taken, first, first_taken)   per UTC day, the count at its
//                last snapshot and at its first; file '' is the project's total; source "curseforge" (project: its id)
//                or "github" (file: the tag)
//   store_files  (source, project, file, name, uploaded, downloads, day1, seen)   each file or release: its latest
//                count, and day1, its downloads in its first 24 hours, read between the snapshots either side of that
//                mark (null when there was no snapshot before it, as for releases from before this)
//   store_tries  (source, project, tried, ok)   the last try per project, so a failing one waits its turn too
//   cf_author_stats (period, day, project, file, metric, value, updated)   the author dashboard's numbers: period "day"
//                or "week" (day: the week's Monday) or "window" (q4, the 90 days up to `day`); project a CurseForge id
//                or "all"; file '' for the whole project or a release's display name ("Lore Forever 0.14.0"); metric
//                "downloads" (total), "unique" (distinct downloaders in that day or week; never added up across days)
//                or "userDays" (q4's unique, which is daily uniques added up)
//
// Days before the first snapshot are worked out from what's kept (an estimate): each file's downloads belong to the
// hours it was its project's newest, spread evenly over them. That fits the add-on (the app updates everyone to each
// day's release) better than the packs.

import { utcDay } from "./activity.js";

export const CF_CORE = 1715510;
// The narration and language projects in release/curseforge.json that have an id, plus the retired ones it no longer
// lists (CF_RETIRED) whose downloads still count (site/tests/stores.test.mjs fails when the lists differ).
// CF_RETIRED: the six answer packs, retired in 0.19.0 (LOR-561): no new files, but their downloads stay in the totals.
export const CF_RETIRED = [1731417, 1731418, 1731419, 1731420, 1745680, 1745682];
export const CF_PACKS = [1727331, 1727332, 1727333, 1727666, 1727667, 1727668, 1727669, 1731403, 1731408, 1731410,
  1731411, 1731412, 1731414, 1731415, 1731417, 1731418, 1731419, 1731420, 1733811, 1734020,
  1736067, 1740579, 1743314, 1743315, 1743518, 1743604, 1745680, 1745682, 1752597, 1752598, 1752599,
  1752600, 1753615, 1753616,
  1754443, 1754444, 1754446, 1754448];
export const GITHUB_REPO = "mliudev/LoreForever";
const HOUR = 3600e3, DAY = 864e5;
const EVERY = { core: HOUR, pack: 6 * HOUR };
const LOOK_EVERY = 10 * 60e3;                     // one Worker reads the due times at most this often

const SETUP = [
  `CREATE TABLE IF NOT EXISTS store_counts (day TEXT NOT NULL, source TEXT NOT NULL, project TEXT NOT NULL,
    file TEXT NOT NULL, downloads INTEGER NOT NULL, taken TEXT NOT NULL, first INTEGER, first_taken TEXT,
    PRIMARY KEY (day, source, project, file))`,
  `CREATE TABLE IF NOT EXISTS store_files (source TEXT NOT NULL, project TEXT NOT NULL, file TEXT NOT NULL, name TEXT,
    uploaded TEXT, downloads INTEGER NOT NULL, day1 INTEGER, seen TEXT NOT NULL, PRIMARY KEY (source, project, file))`,
  `CREATE TABLE IF NOT EXISTS store_tries (source TEXT NOT NULL, project TEXT NOT NULL, tried TEXT NOT NULL,
    ok INTEGER NOT NULL, PRIMARY KEY (source, project))`,
  `CREATE TABLE IF NOT EXISTS cf_author_stats (period TEXT NOT NULL, day TEXT NOT NULL, project TEXT NOT NULL,
    file TEXT NOT NULL, metric TEXT NOT NULL, value INTEGER NOT NULL, updated TEXT NOT NULL,
    PRIMARY KEY (period, day, project, file, metric))`,
];

const ready = new WeakMap();
// The tables, and store_counts' first and first_taken on a table from before they were kept (its rows' first count
// becomes the one they have now).
export async function setupStores(env) {
  if (ready.get(env.DB)) return;
  await env.DB.batch(SETUP.map(s => env.DB.prepare(s)));
  const { results } = await env.DB.prepare("PRAGMA table_info(store_counts)").all();
  const columns = new Set(results.map(r => r.name));
  for (const [column, type] of [["first", "INTEGER"], ["first_taken", "TEXT"]]) {
    if (!columns.has(column)) {
      try { await env.DB.prepare(`ALTER TABLE store_counts ADD COLUMN ${column} ${type}`).run(); }
      catch (e) { /* another Worker added it */ }
    }
  }
  await env.DB.prepare("UPDATE store_counts SET first = downloads, first_taken = taken WHERE first IS NULL").run();
  ready.set(env.DB, true);
}

const count = n => Number.isSafeInteger(n) && n >= 0 ? n : null;
const time = s => { const t = Date.parse(s || ""); return Number.isFinite(t) ? new Date(t).toISOString() : null; };

export async function cfwidget(id) {
  const r = await fetch(`https://api.cfwidget.com/${id}`, {
    headers: { "User-Agent": "loreforeverwow.com download stats" }, signal: AbortSignal.timeout(8000) });
  if (r.status !== 200) throw new Error(`cfwidget ${id}: ${r.status}`);   // 202: not in cfwidget's cache yet
  return r.json();
}

// A cfwidget answer as [{file, name, uploaded, downloads}], the project's total first (file ''); null when unusable.
export function readProject(id, j) {
  if (!j || j.id !== id || count(j.downloads?.total) == null) return null;
  const files = (Array.isArray(j.files) ? j.files : [])
    .filter(f => Number.isSafeInteger(f?.id) && count(f.downloads) != null)
    .map(f => ({ file: String(f.id), name: String(f.display || f.name || f.id).slice(0, 120),
                 uploaded: time(f.uploaded_at), downloads: f.downloads }));
  return [{ file: "", name: String(j.title || id).slice(0, 120), uploaded: time(j.created_at), downloads: j.downloads.total },
          ...files];
}

// Writes one project's counts: today's row for each file and the total, and each file's latest count, with its first
// 24 hours read off once a snapshot falls on each side of that mark.
async function save(env, source, project, rows, now) {
  const stamp = new Date(now).toISOString(), day = utcDay(now);
  const { results } = await env.DB.prepare("SELECT file, downloads, day1, seen FROM store_files WHERE source = ? AND project = ?")
    .bind(source, project).all();
  const before = Object.fromEntries(results.map(r => [r.file, r]));
  const writes = [];
  for (const r of rows) {
    const old = before[r.file];
    let day1 = old?.day1 ?? null;
    const mark = r.uploaded && r.file ? Date.parse(r.uploaded) + DAY : NaN;
    if (day1 == null && old && Date.parse(old.seen) <= mark && now >= mark) {
      const t0 = Date.parse(old.seen), share = now > t0 ? (mark - t0) / (now - t0) : 1;
      day1 = Math.round(old.downloads + (r.downloads - old.downloads) * share);
    }
    writes.push(
      env.DB.prepare("INSERT INTO store_counts (day, source, project, file, downloads, taken, first, first_taken) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(day, source, project, file) DO UPDATE SET " +
        "downloads = excluded.downloads, taken = excluded.taken")
        .bind(day, source, project, r.file, r.downloads, stamp, r.downloads, stamp),
      env.DB.prepare("INSERT INTO store_files (source, project, file, name, uploaded, downloads, day1, seen) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(source, project, file) DO UPDATE SET name = excluded.name, " +
        "uploaded = excluded.uploaded, downloads = excluded.downloads, day1 = excluded.day1, seen = excluded.seen")
        .bind(source, project, r.file, r.name, r.uploaded, r.downloads, day1, stamp));
  }
  await env.DB.batch(writes);
}

let lookAt = 0;   // per Worker: when to read the due times again
export function resetSnapshotClock() { lookAt = 0; }   // tests

// Takes the snapshots that are due. github: the counter's [{tag, published, downloads}] from this same request, or
// null when GitHub failed; getGithub: asks GitHub itself then, when its snapshot is due. get: the cfwidget reader
// (tests pass their own). Returns what it saved, or null when it didn't look. Throws only for a database error; a
// project that can't be read is tried again on its next turn.
export async function snapshotStores(env, { github = null, getGithub = null, now = Date.now(), get = cfwidget } = {}) {
  if (!env.DB || now < lookAt) return null;
  lookAt = now + LOOK_EVERY;
  await setupStores(env);
  const { results } = await env.DB.prepare("SELECT source, project, tried FROM store_tries").all();
  const tried = Object.fromEntries(results.map(r => [`${r.source}:${r.project}`, Date.parse(r.tried)]));
  const due = (source, project, every) => !(now - (tried[`${source}:${project}`] || 0) < every);
  const stamp = new Date(now).toISOString(), saved = [];
  const mark = (source, project, ok) => env.DB.prepare("INSERT INTO store_tries (source, project, tried, ok) VALUES (?, ?, ?, ?) " +
    "ON CONFLICT(source, project) DO UPDATE SET tried = excluded.tried, ok = excluded.ok").bind(source, project, stamp, ok ? 1 : 0).run();

  if (due("github", GITHUB_REPO, EVERY.core)) {
    if (!github && getGithub) github = await getGithub().catch(() => null);
    if (github) {
      const rows = github.filter(r => typeof r?.tag === "string" && count(r.downloads) != null)
        .map(r => ({ file: r.tag.slice(0, 60), name: r.tag.slice(0, 60), uploaded: time(r.published), downloads: r.downloads }));
      await save(env, "github", GITHUB_REPO, [{ file: "", name: GITHUB_REPO, uploaded: null,
        downloads: rows.reduce((n, r) => n + r.downloads, 0) }, ...rows], now);
      saved.push("github");
    }
    await mark("github", GITHUB_REPO, Boolean(github));
  }
  for (const id of [CF_CORE, ...CF_PACKS]) {
    if (!due("curseforge", String(id), id === CF_CORE ? EVERY.core : EVERY.pack)) continue;
    let rows = null;
    try { rows = readProject(id, await get(id)); } catch (e) { /* cfwidget down, or not caching it yet */ }
    if (rows) {
      await save(env, "curseforge", String(id), rows, now);
      saved.push(id);
    }
    await mark("curseforge", String(id), Boolean(rows));
  }
  return { saved };
}

// ---- The author dashboard's numbers (POST /api/admin/curseforge) ----

// The dashboard's queries (POST authors.curseforge.com/_api/statistics-new/queries/<n>, {"project_ids", "days_back"}),
// as {period, metric, by}: by "all" (one row per day: total, unique), "project" (a key per project id), "file" (a key per
// release display name; the routine asks these for the add-on only) or "window" (q4: one row per project).
const QUERIES = {
  1: { period: "day", by: "all" },
  2: { period: "day", by: "project", metric: "downloads" }, 3: { period: "day", by: "project", metric: "unique" },
  4: { period: "window", by: "window" },
  6: { period: "day", by: "file", metric: "downloads" }, 7: { period: "day", by: "file", metric: "unique" },
  10: { period: "week", by: "project", metric: "downloads" }, 11: { period: "week", by: "project", metric: "unique" },
  12: { period: "week", by: "all" },
};
export const AUTHOR_MAX_VALUES = 50000;

// Upserts the author dashboard's numbers by (period, day, project, file, metric): the routine resends the last 90 days
// each run, and the same numbers again change nothing. body: {"fetched_at": iso, "days_back": 90, "queries": {"1":
// <response>, ...}}, each response as the dashboard answered it ({"queryResult": {"data": [...]}}): days and weeks are
// epoch ms at 00:00 UTC (weeks from Monday); a row whose day is null is skipped. Returns {values, queries, first, last};
// throws a RangeError for a body that isn't one. Zero counts aren't kept (a missing one reads as 0).
export async function importAuthorStats(env, body, now = Date.now()) {
  const queries = body?.queries;
  if (!queries || typeof queries !== "object" || Array.isArray(queries)) throw new RangeError('Expected {"queries": {"1": ...}}.');
  const fetched = Date.parse(body.fetched_at || "") || now;
  const dayOf = v => { const t = Number(v); return Number.isFinite(t) && t > 1.6e12 && t < now + 2 * DAY ? utcDay(t) : null; };
  const num = v => { const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v; return Number.isSafeInteger(n) && n > 0 ? n : null; };
  const rows = [], used = [];
  const add = (period, day, project, file, metric, value) => {
    const n = num(value);
    if (day && n != null) rows.push([period, day, String(project), file, metric, n]);
  };
  for (const [id, spec] of Object.entries(QUERIES)) {
    const data = queries[id]?.queryResult?.data;
    if (!Array.isArray(data)) continue;
    used.push(Number(id));
    for (const r of data) {
      if (!r || typeof r !== "object") continue;
      if (spec.by === "window") {
        if (!/^\d{1,10}$/.test(String(r.projectId ?? ""))) continue;
        add("window", utcDay(fetched), r.projectId, "", "downloads", r.total);
        add("window", utcDay(fetched), r.projectId, "", "userDays", r.unique);   // daily uniques added up
        continue;
      }
      const day = dayOf(r.day);
      if (!day) continue;
      if (spec.by === "all") {
        add(spec.period, day, "all", "", "downloads", r.total);
        add(spec.period, day, "all", "", "unique", r.unique);
        continue;
      }
      for (const [k, v] of Object.entries(r)) {
        if (k === "day" || k === "total" || k === "unique") continue;
        if (spec.by === "project" && /^\d{1,10}$/.test(k)) add(spec.period, day, k, "", spec.metric, v);
        if (spec.by === "file" && k.length <= 120) add(spec.period, day, String(CF_CORE), k, spec.metric, v);
      }
    }
  }
  if (rows.length > AUTHOR_MAX_VALUES) throw new RangeError(`At most ${AUTHOR_MAX_VALUES} numbers at a time.`);
  await setupStores(env);
  // Many rows to one statement through json_each: D1 caps bound values per statement and statements per request.
  const stamp = new Date(now).toISOString();
  const upsert = "INSERT INTO cf_author_stats (period, day, project, file, metric, value, updated) " +
    "SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'), json_extract(value, '$[3]'), " +
    "json_extract(value, '$[4]'), json_extract(value, '$[5]'), ? FROM json_each(?) WHERE true " +
    "ON CONFLICT(period, day, project, file, metric) DO UPDATE SET value = excluded.value, updated = excluded.updated " +
    "WHERE cf_author_stats.value != excluded.value";
  const statements = [];
  for (let i = 0; i < rows.length; i += 400) statements.push(env.DB.prepare(upsert).bind(stamp, JSON.stringify(rows.slice(i, i + 400))));
  if (statements.length) await env.DB.batch(statements);
  const days = rows.filter(r => r[0] === "day").map(r => r[1]).sort();
  return { values: rows.length, queries: used, first: days[0] || null, last: days.at(-1) || null };
}

// What's stored, for the routine to check: {values, first, last, updated, projects}.
export async function authorSummary(env) {
  await setupStores(env);
  return env.DB.prepare("SELECT COUNT(*) AS \"values\", MIN(CASE WHEN period = 'day' THEN day END) AS first, " +
    "MAX(CASE WHEN period = 'day' THEN day END) AS last, MAX(updated) AS updated, " +
    "COUNT(DISTINCT CASE WHEN project != 'all' THEN project END) AS projects FROM cf_author_stats").first();
}

// ---- For /admin ----

// Each file's share of a time range: its downloads spread evenly over the hours it was its project's newest (files
// oldest first; the newest's time runs until `now`). Returns [{name, n}] for the files with any.
function spread(files, from, to, now) {
  const out = [];
  files.forEach((f, i) => {
    const start = Date.parse(f.uploaded), end = i + 1 < files.length ? Date.parse(files[i + 1].uploaded) : now;
    if (!(end > start)) return;
    const overlap = Math.min(to, end) - Math.max(from, start);
    if (overlap > 0) out.push({ name: f.name, n: f.downloads * overlap / (end - start) });
  });
  return out;
}

// /admin's numbers, the last `days` UTC days:
//   since, firstFull   the first snapshot's day, and the first day counted from one snapshot to the next
//   days     newest first: [{day, site, curseforge, packs, github, releases: [{name, n}], unique, packsUnique}], each
//            count {n, kind}: kind "author" (the author dashboard's), "measured" (from the day before's last snapshot to
//            the day's last), "partial" (today, since its first snapshot, `since` its time), "estimate" (worked out
//            from each file's downloads and the hours it was newest), or null with nothing to go on; site: add-on
//            downloads through this site's links (installer and zip; not packs); unique, packsUnique: distinct
//            downloaders that day (author dashboard only; the packs' is each pack's added up)
//   releases the add-on's CurseForge releases, newest first: [{name, uploaded, downloads, day1, unique1, current,
//            from}]: day1 and unique1 its first 24 hours' downloads and downloaders, current the hours until the next
//            release came out (null for the newest); from "author" or "cfwidget"
//   newest   the newest release {name, uploaded, downloads, day1, hours since it came out}
//   inUse    CurseForge installs that took the last release that was newest for 20 hours or more: {n, name, hours}
//   packs    [{project, name, downloads, recent: {n, since, days}}]: each narration or language project's total and its
//            growth over the last 7 days, or since the first snapshot until there are 7 days of them
//   github   {downloads, taken}: GitHub's add-on release downloads at the latest snapshot (this site's links included;
//            not Willo-Setup.exe)
//   author   null without author numbers, else {first, last, updated, today: {day, downloads, unique}, thisWeek: {week,
//            current, downloads, unique} (distinct downloaders this week so far, q11; last week's, current false, until
//            this week's numbers come in), weeks: [{week, downloads, unique,
//            packsDownloads, packsUnique}] newest first, cumulative: {downloads, since}, windowUserDays}
export async function storesReport(env, now = Date.now(), days = 14) {
  await setupStores(env);
  const all = async (sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results;
  const from = utcDay(now, -days), today = utcDay(now), core = String(CF_CORE), packIds = CF_PACKS.map(String);
  const [counts, files, site, firstDay, author, authorFiles, authorMeta, packRows] = await Promise.all([
    all("SELECT day, source, project, file, downloads, first, first_taken FROM store_counts WHERE day >= ? AND " +
        "(file = '' OR (source = 'curseforge' AND project = ?))", from, core),
    all("SELECT source, project, file, name, uploaded, downloads, day1, seen FROM store_files ORDER BY uploaded"),
    all("SELECT day, SUM(n) AS n FROM downloads WHERE day >= ? AND file IN ('installer', 'zip', 'complete') GROUP BY day", from)
      .catch(() => []),
    env.DB.prepare("SELECT MIN(day) AS day FROM store_counts").first("day"),
    all("SELECT period, day, project, metric, value FROM cf_author_stats WHERE file = '' AND period IN ('day', 'week')"),
    all("SELECT day, file, metric, value FROM cf_author_stats WHERE period = 'day' AND project = ? AND file != ''", core),
    env.DB.prepare("SELECT MIN(CASE WHEN period = 'day' THEN day END) AS first, MAX(CASE WHEN period = 'day' THEN day END) " +
      "AS last, MAX(updated) AS updated, SUM(CASE WHEN period = 'window' AND project = ? AND metric = 'userDays' THEN value END) " +
      "AS userDays FROM cf_author_stats").bind(core).first(),
    // The packs' snapshots, for their growth below.
    all("SELECT project, day, downloads, first FROM store_counts WHERE source = 'curseforge' AND file = '' AND project != ? " +
        "ORDER BY day", core),
  ]);
  const at = {};
  for (const r of counts) at[`${r.day}|${r.source}|${r.project}|${r.file}`] = r;
  const byProject = {};
  for (const f of files) if (f.file && f.uploaded) (byProject[`${f.source}|${f.project}`] ||= []).push(f);
  const releasesOf = (source, project) => (byProject[`${source}|${project}`] || [])
    .filter(f => source !== "github" || /^v\d/.test(f.file));

  // Author numbers: day[day][project][metric], week[week][project][metric], file[name][day][metric].
  const A = { day: {}, week: {} }, F = {};
  for (const r of author) ((A[r.period][r.day] ||= {})[r.project] ||= {})[r.metric] = r.value;
  for (const r of authorFiles) ((F[r.file] ||= {})[r.day] ||= {})[r.metric] = r.value;
  const hasAuthor = Boolean(authorMeta?.last);
  // A metric added up over projects; a day the dashboard covers counts a missing project as 0.
  const authorSum = (period, key, projects, metric) => {
    const got = A[period][key];
    if (!got) return null;
    return projects.reduce((a, p) => a + (got[p]?.[metric] || 0), 0);
  };

  // One series' count for a day: author numbers, then snapshots, then the estimate.
  const countFor = (day, source, projects, useAuthor) => {
    if (useAuthor && hasAuthor && day >= authorMeta.first && day <= authorMeta.last) {
      return { n: authorSum("day", day, projects, "downloads") || 0, kind: "author" };
    }
    const prev = utcDay(Date.parse(day + "T00:00:00Z"), -1);
    let measured = 0, have = 0, partial = 0, since = null;
    for (const p of projects) {
      const row = at[`${day}|${source}|${p}|`], was = at[`${prev}|${source}|${p}|`];
      if (row && was) { measured += row.downloads - was.downloads; have++; }
      else if (row && day === today) { partial += row.downloads - (row.first ?? row.downloads); since = row.first_taken; }
    }
    if (have) return { n: measured, kind: "measured" };
    if (day === today && since) return { n: partial, kind: "partial", since };
    const start = Date.parse(day + "T00:00:00Z"), end = Math.min(start + DAY, now);
    const parts = projects.flatMap(p => spread(releasesOf(source, p), start, end, now));
    return parts.length ? { n: Math.round(parts.reduce((a, x) => a + x.n, 0)), kind: "estimate" } : null;
  };
  const coreFiles = releasesOf("curseforge", core);
  const releaseSplit = (day, kind) => {
    if (kind === "author") {
      return Object.entries(F).map(([name, d]) => ({ name, n: d[day]?.downloads || 0 }))
        .filter(r => r.n > 0).sort((a, b) => b.n - a.n);
    }
    if (kind === "measured" || kind === "partial") {
      const prev = utcDay(Date.parse(day + "T00:00:00Z"), -1);
      return coreFiles.map(f => {
        const row = at[`${day}|curseforge|${core}|${f.file}`], was = at[`${prev}|curseforge|${core}|${f.file}`];
        const n = row ? kind === "partial" ? row.downloads - (row.first ?? row.downloads)
                      : row.downloads - (was ? was.downloads : 0) : 0;
        return { name: f.name, n };
      }).filter(r => r.n > 0).sort((a, b) => b.n - a.n);
    }
    const start = Date.parse(day + "T00:00:00Z");
    return spread(coreFiles, start, Math.min(start + DAY, now), now).map(r => ({ name: r.name, n: Math.round(r.n) }))
      .filter(r => r.n > 0).sort((a, b) => b.n - a.n);
  };

  const list = Array.from({ length: days }, (_, i) => utcDay(now, -i));
  const dayRows = list.map(day => {
    const curseforge = countFor(day, "curseforge", [core], true);
    return {
      day, site: site.find(r => r.day === day)?.n || 0, curseforge,
      packs: countFor(day, "curseforge", packIds, true),
      github: countFor(day, "github", [GITHUB_REPO], false),
      releases: curseforge ? releaseSplit(day, curseforge.kind) : [],
      unique: hasAuthor ? A.day[day]?.[core]?.unique ?? (day >= authorMeta.first && day <= authorMeta.last ? 0 : null) : null,
      packsUnique: hasAuthor && A.day[day] ? authorSum("day", day, packIds, "unique") : null,
    };
  });

  // Releases: the dashboard's per-release days when it has them (first 24 hours: the day it came out, plus the share
  // of the next day before the 24 hours were up), else cfwidget's.
  const first24 = (name, uploaded, metric) => {
    const d = F[name];
    if (!d || !uploaded) return null;
    const up = Date.parse(uploaded), day0 = utcDay(up), day1 = utcDay(up, 1);
    if (day1 > (authorMeta?.last || "")) return null;   // its second day isn't in yet
    const share = (up - Date.parse(day0 + "T00:00:00Z")) / DAY;
    return Math.round((d[day0]?.[metric] || 0) + (d[day1]?.[metric] || 0) * share);
  };
  const newestFirst = coreFiles.slice().reverse();
  const releases = newestFirst.map((f, i) => {
    const next = i ? Date.parse(newestFirst[i - 1].uploaded) : NaN, up = Date.parse(f.uploaded);
    const day1 = first24(f.name, f.uploaded, "downloads"), unique1 = first24(f.name, f.uploaded, "unique");
    return { name: f.name, uploaded: f.uploaded, downloads: f.downloads, day1: day1 ?? f.day1, unique1,
             from: day1 != null ? "author" : "cfwidget",
             current: Number.isFinite(next) && Number.isFinite(up) ? Math.round((next - up) / HOUR) : null };
  });
  const newest = releases[0] ? { name: releases[0].name, uploaded: releases[0].uploaded, downloads: releases[0].downloads,
    day1: releases[0].day1, hours: Math.round((now - Date.parse(releases[0].uploaded)) / HOUR) } : null;
  const full = releases.find(r => (r.current ?? (now - Date.parse(r.uploaded)) / HOUR) >= 20);
  const inUse = full ? { n: full.day1 ?? full.downloads, name: full.name,
                         hours: full.current ?? Math.round((now - Date.parse(full.uploaded)) / HOUR) } : null;

  // The packs' growth: over 7 days of snapshots, or since the first one.
  const weekAgo = utcDay(now, -7);
  const packs = files.filter(f => f.source === "curseforge" && packIds.includes(f.project) && !f.file).map(f => {
    const rows = packRows.filter(r => r.project === f.project);
    const old = rows.filter(r => r.day <= weekAgo).at(-1);
    const recent = old ? { n: f.downloads - old.downloads, since: old.day, days: 7 }
      : rows.length ? { n: f.downloads - (rows[0].first ?? rows[0].downloads), since: rows[0].day, days: null } : null;
    return { project: f.project, name: f.name, downloads: f.downloads, recent };
  }).sort((a, b) => b.downloads - a.downloads);

  const gh = files.find(f => f.source === "github" && !f.file);

  let authorOut = null;
  if (hasAuthor) {
    const weekKeys = Object.keys(A.week).sort().reverse();
    const thisWeek = utcDay(now, -((new Date(now).getUTCDay() + 6) % 7));
    const dayKeys = Object.keys(A.day).sort();
    // The dashboard's numbers run through yesterday, so on a Monday the new week has none yet: show last week's.
    const shownWeek = weekKeys.find(w => w <= thisWeek);
    authorOut = {
      first: authorMeta.first, last: authorMeta.last, updated: authorMeta.updated,
      today: { day: authorMeta.last, downloads: A.day[authorMeta.last]?.[core]?.downloads || 0,
               unique: A.day[authorMeta.last]?.[core]?.unique || 0 },
      thisWeek: shownWeek ? { week: shownWeek, current: shownWeek === thisWeek,
                              downloads: A.week[shownWeek][core]?.downloads || 0, unique: A.week[shownWeek][core]?.unique || 0 }
        : null,
      weeks: weekKeys.slice(0, 13).map(week => ({ week, downloads: A.week[week][core]?.downloads || 0,
        unique: A.week[week][core]?.unique || 0, packsDownloads: authorSum("week", week, packIds, "downloads"),
        packsUnique: authorSum("week", week, packIds, "unique") })),
      cumulative: { downloads: dayKeys.reduce((a, d) => a + (A.day[d]?.[core]?.downloads || 0), 0), since: dayKeys[0] },
      windowUserDays: authorMeta.userDays ?? null,
    };
  }

  return {
    since: firstDay || null, firstFull: firstDay ? utcDay(Date.parse(firstDay + "T00:00:00Z"), 1) : null,
    days: dayRows, releases: releases.slice(0, 12), newest, inUse, packs,
    github: gh ? { downloads: gh.downloads, taken: gh.seen } : null, author: authorOut,
  };
}
