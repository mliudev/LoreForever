// Which features players use, from every companion install (LOR-435). The companion's daily check-in
// (functions/api/companion/checkin.js, lib/checkins.js) carries the add-on's usage counts (Log.lua's
// LoreForeverDB.usage, read from SavedVariables) and the companion's own, per day, with the same hashed random install
// id; no account and no profile sync needed. Settings › "Share anonymous usage counts" in the companion turns the
// check-in and the counts off together. Only numbers, plus a few categories: the voice (default, female, ...), the
// language, the level range and which key settings are on. Never text, names, chat, places or positions.
//
// What the companion sends (companion/lore_companion/usage.py payload), next to the check-in's install and versions:
//   "usage": {"v": 2, "days": {"YYYY-MM-DD": {<count>: n, <by>: {<kind>: n}}}}   the player's own dates, newest 8
// KEYS below is the whole list: anything else (an unknown key or kind, text, a negative or huge number) is dropped
// and never stored, and a check-in over MAX_BODY characters is refused (413) before anything is read.
//
//   install_usage (install, day, counts, internal)   counts: JSON of metric -> n ("ask": 2, "play.zone": 3,
//                                                    "lang.deDE": 1); kept KEEP_DAYS; internal builds marked
//   usage_rollup (day, metric, installs, n)          per UTC day: "_installs" (installs that sent counts), each metric,
//                                                    and "f:<feature>" (FEATURES); kept ROLLUP_DAYS, past the raw rows
//
// A day's counts only grow, and the same day comes again with the next check-ins (each sends the newest days): every
// metric keeps the larger of what's stored and what came, so a resend never adds twice.

import { utcDay } from "./activity.js";

export const USAGE_V = 2;
export const MAX_BODY = 16384;   // characters of the whole check-in; the companion keeps its counts under 12 KB
export const KEEP_DAYS = 90;     // like usage_days and companion_days
export const ROLLUP_DAYS = 400;
const MAX_DAYS = 8;              // days per check-in (the companion sends 7)
const PAST_DAYS = 45;            // older days are ignored
const MAX_COUNT = 100000;        // a day's count above this isn't a real one
const DAY = /^\d{4}-\d\d-\d\d$/;

const NARRATION = ["zone", "place", "person", "quest", "dialogue", "answer", "topic", "book", "other"];
const LOCALES = ["enUS", "deDE", "frFR", "esES", "esMX", "ptBR", "itIT", "ruRU", "ukUA", "koKR", "zhCN", "zhTW", "other"];
// The add-on's key settings (Options.DEFAULTS names) and the companion's (config.json names; "connected": a profile is
// connected), as on/off.
const ADDON_SETTINGS = ["autoZone", "onDemand", "narrateFlights", "questDialogue", "readBooks", "skipHeard", "journey",
  "automaticPictures", "capture", "liveStrip", "minimap", "floatPlayer", "zoneNudge", "unitTooltips", "showSpoilers",
  "voiceMatchRace", "tips"];
const COMPANION_SETTINGS = ["send_text", "profile_sync", "pictures", "pictures_auto", "live_game", "daily_checkin",
  "game_dir", "connected"];

// Every key the check-in may carry. Keep in step with companion/lore_companion/usage.py (its test reads this block)
// and addon/LoreForever/Log.lua.
// KEYS-BEGIN
export const KEYS = {
  counts: {
    ask: "questions typed", faq: "suggested questions picked", live: "questions sent to live answers from the game",
    panel: "Lore panel opens", journey: "Journey opens", pic: "pictures taken with the add-on", map: "Bigger map opens",
    mapclick: "moments opened from a map", err: "Lore Forever Lua errors", min: "minutes played with the add-on",
    login: "game sessions", chat: "messages to Willo", newchat: "new Willo chats", answer: "Willo live answers",
    offline: "Willo answers from the lore library (live answers used up)", freecap: "free live answers used up",
    psync: "profile updates sent", picnew: "pictures added to the picture book", picup: "pictures put on the profile",
    listen: "narrations played in the companion",
  },
  byKind: {
    play: NARRATION, done: NARRATION, autoplay: NARRATION, autodone: NARRATION, userplay: NARRATION, userdone: NARRATION,
    tab: ["here", "narrations", "journey", "history", "queue"],
    asked: ["typed", "slash", "hover", "quest", "next", "complete", "primer", "link", "other"],
    pl: ["add", "quest", "here", "play", "next", "prev", "jump", "clear"],
    lv: ["0", "10", "20", "30", "40", "50", "60"],
    voice: ["default", "female", "edition", "other", "none"],
    lang: LOCALES, client: LOCALES,
    on: [...ADDON_SETTINGS, ...COMPANION_SETTINGS], off: [...ADDON_SETTINGS, ...COMPANION_SETTINGS],
    set: COMPANION_SETTINGS.filter(s => s !== "connected"),
  },
};
// KEYS-END
// Categories, not counts: stored as 1 for the day.
const FLAGS = new Set(["lv", "voice", "lang", "client", "on", "off"]);
const CAPS = { min: 2880 };     // two game accounts on one PC can add up past a day's 1440 minutes

const COUNTS = new Set(Object.keys(KEYS.counts));
const BY_KIND = Object.fromEntries(Object.entries(KEYS.byKind).map(([k, v]) => [k, new Set(v)]));
const isCount = (n, cap = MAX_COUNT) => Number.isInteger(n) && n > 0 && n <= cap;
const plainObject = v => v && typeof v === "object" && !Array.isArray(v);

// Features for /admin, each from the metrics that show it was used (GLOB patterns over the stored metric names).
export const FEATURES = [
  ["narration", "Narration (any)", ["play.*"]],
  ["narration.auto", "Narration that started by itself", ["autoplay.*"]],
  ["narration.play", "Narration started with Play", ["userplay.*"]],
  ["narration.end", "Narration heard to the end", ["done.*"]],
  ["places", "Zone and place stories", ["play.zone", "play.place"]],
  ["people", "People stories", ["play.person"]],
  ["quests", "Quest stories", ["play.quest"]],
  ["dialogue", "Quest dialogue", ["play.dialogue"]],
  ["books", "Books", ["play.book"]],
  ["answers.voice", "Narrated answers", ["play.answer"]],
  ["questions", "Questions (typed or picked)", ["ask", "faq", "asked.*"]],
  ["typed", "Questions typed", ["ask"]],
  ["suggested", "Suggested questions picked", ["faq"]],
  ["live", "Live answers asked from the game", ["live"]],
  ["panel", "Lore panel", ["panel"]],
  ["library", "Library tab", ["tab.narrations"]],
  ["history", "History", ["tab.history"]],
  ["journey", "Journey", ["journey", "tab.journey"]],
  ["map", "Bigger map", ["map"]],
  ["mapclick", "Moments opened from a map", ["mapclick"]],
  ["playlist", "Playlist", ["pl.*", "tab.queue"]],
  ["pictures", "Pictures taken", ["pic"]],
  ["sam", "Willo chat", ["chat", "newchat"]],
  ["sam.live", "Willo live answers", ["answer"]],
  ["sam.offline", "Willo answers from the library", ["offline"]],
  ["freecap", "Used up the free live answers", ["freecap"]],
  ["sync", "Profile updates", ["psync"]],
  ["picbook", "Picture book", ["picnew"]],
  ["picup", "Pictures put on the profile", ["picup"]],
  ["listen", "Narration in the companion", ["listen"]],
  ["settings", "Changed a companion setting", ["set.*"]],
  ["errors", "Had a Lua error", ["err"]],
];
// The features as an inline table for SQL. They're constants from this file; the pattern check keeps them plain.
const FEATURE_ROWS = FEATURES.flatMap(([id, , pats]) => pats.map(p => {
  if (!/^[\w.]+$/.test(id) || !/^[\w.*]+$/.test(p)) throw new Error("bad feature " + id);
  return `('${id}', '${p}')`;
})).join(", ");
const WITH_FEATURES = `WITH f(id, pat) AS (VALUES ${FEATURE_ROWS})`;

const SETUP = [
  `CREATE TABLE IF NOT EXISTS install_usage (install TEXT NOT NULL, day TEXT NOT NULL, counts TEXT NOT NULL,
    internal INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (install, day))`,
  "CREATE INDEX IF NOT EXISTS install_usage_day ON install_usage (day)",
  `CREATE TABLE IF NOT EXISTS usage_rollup (day TEXT NOT NULL, metric TEXT NOT NULL, installs INTEGER NOT NULL,
    n INTEGER NOT NULL, PRIMARY KEY (day, metric))`,
];
// Once per Worker and database: every later call costs no round trip to D1.
const ready = new WeakSet();
export async function setupFeatureUsage(env) {
  if (ready.has(env.DB)) return;
  await env.DB.batch(SETUP.map(s => env.DB.prepare(s)));
  ready.add(env.DB);
}

// The check-in's "usage" as {day: {metric: n}}, keeping only KEYS on plausible days; null when nothing usable came
// (an older companion sends none).
export function readFeatureUsage(input, now = Date.now()) {
  if (!plainObject(input) || input.v !== USAGE_V || !plainObject(input.days)) return null;
  const first = utcDay(now, -PAST_DAYS), last = utcDay(now, 1);   // the player's date can be a day ahead of UTC
  const out = {};
  for (const day of Object.keys(input.days).filter(d => DAY.test(d) && d >= first && d <= last).sort().slice(-MAX_DAYS)) {
    const d = input.days[day];
    if (!plainObject(d)) continue;
    const counts = {};
    for (const [k, v] of Object.entries(d)) {
      if (COUNTS.has(k)) {
        if (isCount(v, CAPS[k])) counts[k] = v;
      } else if (BY_KIND[k] && plainObject(v)) {
        for (const [kind, n] of Object.entries(v)) {
          if (BY_KIND[k].has(kind) && isCount(n)) counts[`${k}.${kind}`] = FLAGS.has(k) ? 1 : n;
        }
      }
    }
    if (Object.keys(counts).length) out[day] = counts;
  }
  return Object.keys(out).length ? out : null;
}

// Keep one install's days (from readFeatureUsage). internal: the check-in came from an internal build
// (lib/checkins.js isInternal); kept, but left out of every count. Returns how many days it wrote.
export async function saveFeatureUsage(env, install, usage, internal = false, now = Date.now()) {
  const days = Object.keys(usage || {});
  if (!days.length) return 0;
  await setupFeatureUsage(env);
  const { results } = await env.DB.prepare(
    `SELECT day, counts FROM install_usage WHERE install = ? AND day IN (${days.map(() => "?").join(", ")})`)
    .bind(install, ...days).all();
  const stored = Object.fromEntries(results.map(r => [r.day, r.counts]));
  const writes = [];
  for (const day of days) {
    let old = {};
    try { old = stored[day] ? JSON.parse(stored[day]) : {}; } catch (e) { /* a broken row is replaced */ }
    const merged = { ...old };
    for (const [k, n] of Object.entries(usage[day])) merged[k] = Math.max(Number(old[k]) || 0, n);
    const json = JSON.stringify(merged);
    if (json === stored[day]) continue;
    writes.push(env.DB.prepare("INSERT INTO install_usage (install, day, counts, internal) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(install, day) DO UPDATE SET counts = excluded.counts, internal = excluded.internal")
      .bind(install, day, json, internal ? 1 : 0));
  }
  if (writes.length) await env.DB.batch(writes);
  return writes.length;
}

// Roll the days from..to (inclusive) up into usage_rollup, again from the raw rows: installs that sent counts, each
// metric's installs and total, and each feature's installs. Players' builds only.
export async function rollupUsage(env, from, to) {
  await setupFeatureUsage(env);
  const span = "day >= ? AND day <= ? AND internal = 0";
  await env.DB.batch([
    env.DB.prepare("DELETE FROM usage_rollup WHERE day >= ? AND day <= ? AND metric != '_rolled'").bind(from, to),
    env.DB.prepare("INSERT INTO usage_rollup (day, metric, installs, n) SELECT day, '_installs', COUNT(DISTINCT install), " +
      `COUNT(*) FROM install_usage WHERE ${span} GROUP BY day`).bind(from, to),
    env.DB.prepare("INSERT INTO usage_rollup (day, metric, installs, n) SELECT u.day, j.key, COUNT(DISTINCT u.install), " +
      `SUM(j.value) FROM install_usage u, json_each(u.counts) j WHERE u.${span} GROUP BY u.day, j.key`).bind(from, to),
    env.DB.prepare(`${WITH_FEATURES} INSERT INTO usage_rollup (day, metric, installs, n) SELECT u.day, 'f:' || f.id, ` +
      "COUNT(DISTINCT u.install), SUM(j.value) FROM install_usage u, json_each(u.counts) j, f " +
      `WHERE u.${span} AND j.key GLOB f.pat GROUP BY u.day, f.id`).bind(from, to),
  ]);
}

// Once a UTC day, on the first check-in that brings counts: drop raw rows past KEEP_DAYS and rollups past ROLLUP_DAYS,
// and roll up the last 8 days (the days check-ins can still change), so the trend outlives the raw rows.
export async function dailyUpkeep(env, now = Date.now()) {
  await setupFeatureUsage(env);
  const today = utcDay(now);
  const mark = await env.DB.prepare("INSERT OR IGNORE INTO usage_rollup (day, metric, installs, n) VALUES (?, '_rolled', 0, 0)")
    .bind(today).run();
  if (!mark?.meta?.changes) return false;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM install_usage WHERE day < ?").bind(utcDay(now, -KEEP_DAYS)),
    env.DB.prepare("DELETE FROM usage_rollup WHERE day < ?").bind(utcDay(now, -ROLLUP_DAYS)),
  ]);
  await rollupUsage(env, utcDay(now, -MAX_DAYS), utcDay(now, -1));
  return true;
}

// For /admin (functions/api/admin.js "features"), players' builds only:
//   features   [{id, name}] in FEATURES order
//   active     {d14, d30}: installs that sent counts in the last 14 and 30 days (UTC dates, today included)
//   play       {days, played, minutes, logins} over 30 days: install-days with counts, those with minutes played in the
//              game, the minutes and the game sessions
//   use        {id: {d14, d30}}: how many of them used each feature
//   metrics    {metric: installs} over 30 days, every stored metric (picks and settings: voice.*, lang.*, on.* ...)
//   levels     [{lv, installs, use: {id: installs}}] over 30 days, by the highest level range an install played at
//              (lv -1: no level sent)
//   returning  {new: {installs, use}, returning: {installs, use}}: over 30 days, by whether the install checked in
//              on 2+ different days (lib/checkins.js's "returning")
//   trend      [{day, installs, use: {id: installs}}] the last 30 days, from the rollups (yesterday and today rolled
//              up again first)
export async function featureReport(env, now = Date.now()) {
  await setupFeatureUsage(env);
  const d14 = utcDay(now, -13), d30 = utcDay(now, -29);
  const all = async (sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results;
  const PLAYERS = "u.day >= ? AND u.internal = 0";
  // Only the trend reads the rollups, so the rest don't wait for them.
  const [trend, active, use, metrics, levelUse, levelSize, backUse, backSize] = await Promise.all([
    rollupUsage(env, utcDay(now, -1), utcDay(now)).then(() => all("SELECT day, metric, installs FROM usage_rollup " +
      "WHERE day >= ? AND (metric = '_installs' OR metric GLOB 'f:*') ORDER BY day", d30)),
    env.DB.prepare("SELECT COUNT(DISTINCT CASE WHEN day >= ? THEN install END) AS d14, COUNT(DISTINCT install) AS d30, " +
      "COUNT(*) AS days, COALESCE(SUM(json_extract(counts, '$.min') > 0), 0) AS played, " +
      "COALESCE(SUM(json_extract(counts, '$.min')), 0) AS minutes, COALESCE(SUM(json_extract(counts, '$.login')), 0) AS logins " +
      "FROM install_usage WHERE day >= ? AND internal = 0").bind(d14, d30).first(),
    all(`${WITH_FEATURES} SELECT f.id, COUNT(DISTINCT CASE WHEN u.day >= ? THEN u.install END) AS d14, ` +
        `COUNT(DISTINCT u.install) AS d30 FROM install_usage u, json_each(u.counts) j, f WHERE ${PLAYERS} ` +
        "AND j.key GLOB f.pat GROUP BY f.id", d14, d30),
    all(`SELECT j.key AS metric, COUNT(DISTINCT u.install) AS installs FROM install_usage u, json_each(u.counts) j ` +
        `WHERE ${PLAYERS} GROUP BY j.key`, d30),
    all(`${WITH_FEATURES}, lv AS (${LEVELS}) SELECT COALESCE(lv.lv, -1) AS lv, f.id, COUNT(DISTINCT u.install) AS installs ` +
        `FROM install_usage u JOIN json_each(u.counts) j JOIN f ON j.key GLOB f.pat LEFT JOIN lv ON lv.install = u.install ` +
        `WHERE ${PLAYERS} GROUP BY 1, 2`, d30, d30),
    all(`WITH lv AS (${LEVELS}) SELECT COALESCE(lv.lv, -1) AS lv, COUNT(DISTINCT u.install) AS installs ` +
        `FROM install_usage u LEFT JOIN lv ON lv.install = u.install WHERE ${PLAYERS} GROUP BY 1`, d30, d30),
    all(`${WITH_FEATURES}, back AS (${BACK}) SELECT COALESCE(back.yes, 0) AS back, f.id, COUNT(DISTINCT u.install) AS installs ` +
        `FROM install_usage u JOIN json_each(u.counts) j JOIN f ON j.key GLOB f.pat LEFT JOIN back ON back.install = u.install ` +
        `WHERE ${PLAYERS} GROUP BY 1, 2`, d30),
    all(`WITH back AS (${BACK}) SELECT COALESCE(back.yes, 0) AS back, COUNT(DISTINCT u.install) AS installs ` +
        `FROM install_usage u LEFT JOIN back ON back.install = u.install WHERE ${PLAYERS} GROUP BY 1`, d30),
  ]);
  const levels = levelSize.map(r => ({ lv: r.lv, installs: r.installs, use: Object.fromEntries(
    levelUse.filter(x => x.lv === r.lv).map(x => [x.id, x.installs])) })).sort((a, b) => a.lv - b.lv);
  const group = yes => ({ installs: backSize.find(r => r.back === yes)?.installs || 0,
    use: Object.fromEntries(backUse.filter(x => x.back === yes).map(x => [x.id, x.installs])) });
  const days = {};
  for (const r of trend) {
    const d = days[r.day] ||= { day: r.day, installs: 0, use: {} };
    if (r.metric === "_installs") d.installs = r.installs; else d.use[r.metric.slice(2)] = r.installs;
  }
  return {
    features: FEATURES.map(([id, name]) => ({ id, name })),
    active: { d14: active?.d14 || 0, d30: active?.d30 || 0 },
    play: { days: active?.days || 0, played: active?.played || 0, minutes: active?.minutes || 0, logins: active?.logins || 0 },
    use: Object.fromEntries(use.map(r => [r.id, { d14: r.d14, d30: r.d30 }])),
    metrics: Object.fromEntries(metrics.map(r => [r.metric, r.installs])),
    levels, returning: { new: group(0), returning: group(1) },
    trend: Object.values(days),
  };
}
// Each install's highest level range in the window, and whether it checked in on 2+ different days (companion_days).
const LEVELS = "SELECT u.install, MAX(CAST(substr(j.key, 4) AS INTEGER)) AS lv FROM install_usage u, json_each(u.counts) j " +
  "WHERE u.day >= ? AND u.internal = 0 AND j.key GLOB 'lv.*' GROUP BY u.install";
const BACK = "SELECT install, 1 AS yes FROM companion_days GROUP BY install HAVING COUNT(DISTINCT day) >= 2";
