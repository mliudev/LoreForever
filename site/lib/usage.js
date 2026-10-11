// What players actually use (LOR-413): the add-on counts, per day, how often each feature was used (Log.lua's
// LoreForeverDB.usage), and the companion sends the counts with the profile sync (companion/lore_companion/profile.py
// usage_payload), only while "Keep my profile up to date" is on. Only numbers: never a question, a name or what was
// played. They're kept per account and day for USAGE_KEEP_DAYS, and /admin shows them only added up
// (functions/api/admin.js -> usageReport). "Delete my account" removes them (lib/accounts.js USER_DATA).
//
//   usage_days (user_id, day, counts)   day: the player's own date ("YYYY-MM-DD"); counts: JSON of metric -> n, e.g.
//     {"play.zone": 3, "done.zone": 2, "ask": 1, "panel": 4, "sync": 1}
// play.<kind> narrations started from their beginning, done.<kind> heard to the end; ask (questions typed), faq
// (suggested questions picked), live (questions sent to live answers), panel (Lore panel opens), journey (Journey
// opens), pic (pictures taken), chat (messages sent to Sam in the companion) and newchat (new Sam chats), which the
// companion counts itself, and sync (the companion synced that UTC day, so players on an add-on without counts still
// count as syncing players).
//
// A day's counts only grow, and the same day can arrive again (every sync sends the newest 30): each metric keeps the
// larger of what's stored and what came, and a row is written only when that changes, so a sync costs a write per
// changed day, not one per count.

export const USAGE_KEEP_DAYS = 90;
const MAX_DAYS = 31;            // the add-on keeps 30
const MAX_COUNT = 100000;       // a day's count above this isn't a real one
const PAST_DAYS = 45;           // older days are ignored: their players' rows are about to be dropped anyway
export const USAGE_COUNTS = ["ask", "faq", "live", "panel", "journey", "pic", "chat", "newchat"];
export const USAGE_KINDS = ["zone", "place", "person", "quest", "dialogue", "answer", "topic", "other"];
const DAY = /^\d{4}-\d\d-\d\d$/;

export const USAGE_SETUP = [
  `CREATE TABLE IF NOT EXISTS usage_days (
    user_id TEXT NOT NULL, day TEXT NOT NULL, counts TEXT NOT NULL, PRIMARY KEY (user_id, day))`,
  "CREATE INDEX IF NOT EXISTS usage_days_day ON usage_days (day)",
];

const utcDay = (now, offsetDays = 0) => new Date(now + offsetDays * 864e5).toISOString().slice(0, 10);
const isCount = n => Number.isInteger(n) && n > 0 && n <= MAX_COUNT;

// The companion's {v: 1, days: {day: {count: n, play|done: {kind: n}}}} as {day: {metric: n}}, keeping only known
// counts on plausible days; null when nothing usable came.
export function readUsage(input, now = Date.now()) {
  if (!input || typeof input !== "object" || input.v !== 1 || !input.days || typeof input.days !== "object") return null;
  const first = utcDay(now, -PAST_DAYS), last = utcDay(now, 1);   // the player's date can be a day ahead of UTC
  const out = {};
  for (const day of Object.keys(input.days).filter(d => DAY.test(d) && d >= first && d <= last).sort().slice(-MAX_DAYS)) {
    const d = input.days[day];
    if (!d || typeof d !== "object") continue;
    const counts = {};
    for (const k of USAGE_COUNTS) if (isCount(d[k])) counts[k] = d[k];
    for (const by of ["play", "done"]) {
      const kinds = d[by];
      if (!kinds || typeof kinds !== "object") continue;
      for (const kind of USAGE_KINDS) if (isCount(kinds[kind])) counts[`${by}.${kind}`] = kinds[kind];
    }
    if (Object.keys(counts).length) out[day] = counts;
  }
  return Object.keys(out).length ? out : null;
}

// Keep a sync's counts (from readUsage, or null) for this account, and mark today (UTC) as a day it synced. Rows older
// than USAGE_KEEP_DAYS go. Returns how many days it wrote.
export async function saveUsage(env, userId, usage, now = Date.now()) {
  const incoming = { ...(usage || {}) };
  const today = utcDay(now);
  incoming[today] = { ...(incoming[today] || {}), sync: 1 };
  const days = Object.keys(incoming);
  const { results } = await env.DB.prepare(
    `SELECT day, counts FROM usage_days WHERE user_id = ? AND day IN (${days.map(() => "?").join(", ")})`)
    .bind(userId, ...days).all();
  const stored = Object.fromEntries(results.map(r => [r.day, r.counts]));
  const writes = [];
  for (const day of days) {
    let old = {};
    try { old = stored[day] ? JSON.parse(stored[day]) : {}; } catch (e) { /* a broken row is replaced */ }
    const merged = { ...old };
    for (const [k, n] of Object.entries(incoming[day])) merged[k] = Math.max(Number(old[k]) || 0, n);
    const json = JSON.stringify(merged);
    if (json === stored[day]) continue;
    writes.push(env.DB.prepare(
      "INSERT INTO usage_days (user_id, day, counts) VALUES (?, ?, ?) " +
      "ON CONFLICT(user_id, day) DO UPDATE SET counts = excluded.counts").bind(userId, day, json));
  }
  // Old rows go on each player's first sync of the day, not on every sync.
  const firstToday = !stored[today] || !String(stored[today]).includes('"sync"');
  const changed = writes.length;
  if (firstToday) writes.push(env.DB.prepare("DELETE FROM usage_days WHERE day < ?").bind(utcDay(now, -USAGE_KEEP_DAYS)));
  if (writes.length) await env.DB.batch(writes);
  return changed;
}

// The share loop on the site (LOR-151), counted per UTC day as plain numbers, with nothing about who: no account, no
// IP, no cookie.
//   site_counts (day, metric, n)
// profile.view: someone other than its owner opened a public profile (functions/u/[handle].js); profile.outside: of
// those, opened from a link outside the site (another site's or an app's, or pasted: a shared link); profile.share:
// Share pressed or a profile link copied (POST /api/count/share, from public/js/profile.js and /account).
export const SITE_COUNTS = ["profile.view", "profile.outside", "profile.share"];
const SITE_SETUP = `CREATE TABLE IF NOT EXISTS site_counts (
  day TEXT NOT NULL, metric TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, metric))`;
// Link previews and crawlers fetch pages too; they aren't people (functions/download/[file].js skips them as well).
export const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|discord|slack|telegram|whatsapp/i;

export async function countSite(env, metrics, now = Date.now()) {
  const day = utcDay(now);
  await env.DB.batch([env.DB.prepare(SITE_SETUP), ...metrics.filter(m => SITE_COUNTS.includes(m)).map(m => env.DB.prepare(
    "INSERT INTO site_counts (day, metric, n) VALUES (?, ?, 1) ON CONFLICT(day, metric) DO UPDATE SET n = n + 1")
    .bind(day, m))]);
}

// For /admin: [{day, metric, n}] over the last `days` days.
export async function siteReport(env, days = 14, now = Date.now()) {
  const { results } = await env.DB.prepare("SELECT day, metric, n FROM site_counts WHERE day >= ? ORDER BY day")
    .bind(utcDay(now, -(days - 1))).all();
  return results;
}

// For /admin: the last `days` days (UTC dates, today included), added up over every syncing player.
//   days:    [{day, players, counted}]   players: synced or used anything that day; counted: sent counts that day
//   metrics: [{day, metric, n, players}] n: the total; players: how many used it that day
//   window:  {players, counted, metrics: {metric: {n, players}}}   the same over the whole window (distinct players)
//   week:    players in the last 7 days
export async function usageReport(env, days = 14, now = Date.now()) {
  const since = utcDay(now, -(days - 1)), week = utcDay(now, -6);
  const each = "FROM usage_days u, json_each(u.counts) j WHERE u.day >= ?";
  const all = async (sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results;
  const [perDay, perMetric, windowMetrics, windowPlayers, weekPlayers] = await Promise.all([
    all("SELECT u.day, COUNT(DISTINCT u.user_id) AS players, " +
        `COUNT(DISTINCT CASE WHEN j.key != 'sync' THEN u.user_id END) AS counted ${each} GROUP BY u.day ORDER BY u.day`, since),
    all(`SELECT u.day, j.key AS metric, SUM(j.value) AS n, COUNT(DISTINCT u.user_id) AS players ${each} AND j.key != 'sync' ` +
        "GROUP BY u.day, j.key", since),
    all(`SELECT j.key AS metric, SUM(j.value) AS n, COUNT(DISTINCT u.user_id) AS players ${each} AND j.key != 'sync' ` +
        "GROUP BY j.key", since),
    all("SELECT COUNT(DISTINCT u.user_id) AS players, " +
        `COUNT(DISTINCT CASE WHEN j.key != 'sync' THEN u.user_id END) AS counted ${each}`, since),
    all("SELECT COUNT(DISTINCT user_id) AS players FROM usage_days WHERE day >= ?", week),
  ]);
  return {
    since, days: perDay, metrics: perMetric,
    window: { players: windowPlayers[0]?.players || 0, counted: windowPlayers[0]?.counted || 0,
              metrics: Object.fromEntries(windowMetrics.map(m => [m.metric, { n: m.n, players: m.players }])) },
    week: weekPlayers[0]?.players || 0,
  };
}
