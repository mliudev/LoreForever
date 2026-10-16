// Willo's numbers (LOR-524), for /admin's Willo panel and Overview tile and the daily stats post in Slack #analytics
// (the "Daily Analytics" routine reads them from /api/admin's "willo"). Counts and sums only: no question, no name.
// One definition of each, used everywhere:
//   downloads  Willo-Setup.exe through the site's link, /download/willo (D1 downloads, file 'willo';
//              functions/download/[file].js), per UTC day. GitHub's own count of Willo-Setup.exe (/api/downloads
//              "willo") is higher: it has the downloads straight from GitHub too.
//   DAU, WAU   Willo's daily and weekly active players: accounts that asked Willo at least once that UTC day, and in
//              the 7 UTC days ending that day (answer_days, lib/activity.js markAsked; every question counts, answered
//              or not), admin and test accounts left out (lib/activity.js counted). Days before answer_days (10/15)
//              hold only each account's latest day, so their DAU is low; their WAU is right.
//   running    installs that sent Willo's daily check-in that day, and in the 7 days ending it (lib/checkins.js,
//              players' builds only), signed in or not: how many have her running, not how many use her.
//   plans      lib/billing.js subscriptionReport (comped and owner plans apart, never revenue), added by /api/admin.
// Kept outside functions/ so Pages doesn't route it.

import { utcDay, counted } from "./activity.js";
import { INTERNAL } from "./checkins.js";

// days: the last `days` UTC days, oldest first: {day, downloads, dau, wau, answers, running, runningWeek}.
// summary: the last whole UTC day (`day`, yesterday) for the daily post, with what to compare it to:
//   downloads {day, week, prevWeek, total}   that day, its 7 days, the 7 before those, and since counting began
//   dau {day, weekAgo}, wau {day, weekAgo}, running {day, week, weekAgo}, answers {day}
//   today {downloads, dau, running}           so far today
export async function willoReport(env, now = Date.now(), days = 30) {
  const all = async (sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results;
  const from = utcDay(now, -(days - 1)), today = utcDay(now);
  const range = "WITH RECURSIVE d(day) AS (SELECT ? UNION ALL SELECT date(day, '+1 day') FROM d WHERE day < ?) ";
  const asker = counted("a.user_id"), player = `NOT ${INTERNAL}`;
  const [downloads, total, asked, running] = await Promise.all([
    all("SELECT day, SUM(n) AS n FROM downloads WHERE file = 'willo' AND day >= ? GROUP BY day", from),
    env.DB.prepare("SELECT COALESCE(SUM(n), 0) AS n FROM downloads WHERE file = 'willo'").first("n"),
    all(range + `SELECT d.day, (SELECT COUNT(*) FROM answer_days a WHERE a.day = d.day AND ${asker}) AS dau, ` +
        `(SELECT COALESCE(SUM(n), 0) FROM answer_days a WHERE a.day = d.day AND ${asker}) AS answers, ` +
        "(SELECT COUNT(DISTINCT a.user_id) FROM answer_days a WHERE a.day BETWEEN date(d.day, '-6 days') AND d.day " +
        `AND ${asker}) AS wau FROM d`, from, today),
    all(range + `SELECT d.day, (SELECT COUNT(*) FROM companion_days c WHERE c.day = d.day AND ${player}) AS running, ` +
        "(SELECT COUNT(DISTINCT c.install) FROM companion_days c WHERE c.day BETWEEN date(d.day, '-6 days') AND d.day " +
        `AND ${player}) AS runningWeek FROM d`, from, today),
  ]);
  const rows = asked.map((a, i) => ({ day: a.day, downloads: downloads.find(d => d.day === a.day)?.n || 0,
    dau: a.dau, wau: a.wau, answers: a.answers, running: running[i]?.running || 0, runningWeek: running[i]?.runningWeek || 0 }));
  const at = offset => rows[rows.length - 1 + offset] || { downloads: 0, dau: 0, wau: 0, answers: 0, running: 0, runningWeek: 0 };
  const sum = (a, b) => rows.slice(Math.max(0, rows.length - 1 + a), rows.length + b).reduce((n, r) => n + r.downloads, 0);
  const [now0, day, weekAgo] = [at(0), at(-1), at(-8)];
  return {
    days: rows,
    summary: {
      day: day.day || utcDay(now, -1),
      downloads: { day: day.downloads, week: sum(-7, -1), prevWeek: sum(-14, -8), total: total || 0 },
      dau: { day: day.dau, weekAgo: weekAgo.dau },
      wau: { day: day.wau, weekAgo: weekAgo.wau },
      running: { day: day.running, week: day.runningWeek, weekAgo: weekAgo.runningWeek },
      answers: { day: day.answers },
      today: { downloads: now0.downloads, dau: now0.dau, running: now0.running },
    },
  };
}
