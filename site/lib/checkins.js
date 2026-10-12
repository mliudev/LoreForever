// The companion's daily check-in (LOR-422): how many companion installs are in use, and come back, with no account.
// Since 0.14.0 the companion ships inside Setup.exe and runs whether or not the player signs in. Once a day while it
// runs (unless its "Count this install" setting is off) it sends a random id made on that PC, hashed (SHA-256, like
// the contribute uploads' install hash), and the companion's and the add-on's versions
// (functions/api/companion/checkin.js). Nothing else: no account, no name, no game data, and the IP isn't kept.
//
//   companion_days (day, install, companion, addon)   one row per install and UTC day, kept CHECKIN_KEEP_DAYS

import { utcDay } from "./activity.js";

export const CHECKIN_KEEP_DAYS = 90;   // like usage_days
const SETUP = [
  `CREATE TABLE IF NOT EXISTS companion_days (day TEXT NOT NULL, install TEXT NOT NULL, companion TEXT, addon TEXT,
    PRIMARY KEY (day, install))`,
  "CREATE INDEX IF NOT EXISTS companion_days_install ON companion_days (install)",
];
const INSTALL = /^[0-9a-f]{64}$/;
const VERSION = /^\d{1,4}(\.\d{1,6}){0,3}([-+][0-9A-Za-z.-]{1,20})?$/;

// The check-in's fields, or null when it isn't one: the install hash as sent, versions only when they look like one.
export function readCheckin(input) {
  if (!input || typeof input !== "object" || input.v !== 1 || !INSTALL.test(input.install || "")) return null;
  const version = v => typeof v === "string" && VERSION.test(v) ? v : null;
  return { install: input.install, companion: version(input.companion), addon: version(input.addon) };
}

export async function saveCheckin(env, { install, companion, addon }, now = Date.now()) {
  await env.DB.batch([
    ...SETUP.map(s => env.DB.prepare(s)),
    env.DB.prepare("INSERT INTO companion_days (day, install, companion, addon) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(day, install) DO UPDATE SET companion = excluded.companion, addon = excluded.addon")
      .bind(utcDay(now), install, companion, addon),
    env.DB.prepare("DELETE FROM companion_days WHERE day < ?").bind(utcDay(now, -CHECKIN_KEEP_DAYS)),
  ]);
}

// Internal builds aren't players: Mike's and the QA's own companions. A companion with no version, the source's
// unstamped 0.1.0 (release builds carry the release's version), or either version marked -dev or -preview. They're
// left out of every count below and only counted on their own (`internal`).
export const INTERNAL = "(companion IS NULL OR companion = '0.1.0' OR companion LIKE '%-dev%' OR companion LIKE '%-preview%' " +
  "OR addon LIKE '%-dev%' OR addon LIKE '%-preview%')";
// The same rule for one check-in (lib/featureuse.js marks its counts with it). LIKE is case-blind for ASCII.
export const isInternal = ({ companion, addon }) => !companion || companion === "0.1.0" ||
  [companion, addon].some(v => /-(dev|preview)/i.test(v || ""));
const PLAYERS = `FROM companion_days WHERE NOT ${INTERNAL}`;

// For /admin (functions/api/admin.js puts it in the funnel's "companions"), from the days kept, players' builds only:
//   since, today, week, month   the first day, and installs checked in today and in the last 7 and 30 days
//   installs, returning         every install kept, and those seen on 2+ different days
//   days       [{day, n}] the last 30 days
//   versions   [{companion, addon, n}] installs seen in the last 7 days, by the versions of their latest check-in
//   internal   {installs, versions: [{companion, addon, n}]}: internal builds in the last 30 days
export async function checkinReport(env, now = Date.now()) {
  const all = async (sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results;
  const today = utcDay(now), week = utcDay(now, -6), month = utcDay(now, -29);
  const [counts, days, versions, internal] = await Promise.all([
    env.DB.prepare("SELECT MIN(day) AS since, COUNT(DISTINCT CASE WHEN day = ? THEN install END) AS today, " +
      "COUNT(DISTINCT CASE WHEN day >= ? THEN install END) AS week, COUNT(DISTINCT CASE WHEN day >= ? THEN install END) AS month, " +
      `COUNT(DISTINCT install) AS installs, (SELECT COUNT(*) FROM (SELECT install ${PLAYERS} GROUP BY install ` +
      `HAVING COUNT(*) >= 2)) AS back ${PLAYERS}`).bind(today, week, month).first(),
    all(`SELECT day, COUNT(*) AS n ${PLAYERS} AND day >= ? GROUP BY day ORDER BY day`, month),
    all(`SELECT companion, addon, COUNT(*) AS n FROM companion_days c WHERE NOT ${INTERNAL} AND day >= ? AND ` +
        "day = (SELECT MAX(day) FROM companion_days d WHERE d.install = c.install) " +
        "GROUP BY companion, addon ORDER BY n DESC LIMIT 20", week),
    all(`SELECT companion, addon, COUNT(DISTINCT install) AS n FROM companion_days WHERE ${INTERNAL} AND day >= ? ` +
        "GROUP BY companion, addon ORDER BY n DESC LIMIT 10", month),
  ]);
  return { since: counts?.since || null, today: counts?.today || 0, week: counts?.week || 0, month: counts?.month || 0,
           installs: counts?.installs || 0, returning: counts?.back || 0, days, versions,
           internal: { installs: internal.reduce((a, r) => a + r.n, 0), versions: internal } };
}

// Players' installs checked in per week (Monday, UTC) from `from` on: {week: n}.
export async function checkinWeeks(env, from) {
  const { results } = await env.DB.prepare("SELECT date(day, 'weekday 0', '-6 days') AS week, COUNT(DISTINCT install) AS n " +
    `${PLAYERS} AND day >= ? GROUP BY week`).bind(from).all();
  return Object.fromEntries(results.map(r => [r.week, r.n]));
}
