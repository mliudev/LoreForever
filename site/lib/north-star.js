// The north-star metric (Mike and Patrick, 10/21): Willo's daily players who come back week over week and whose
// questions can be studied, against a target of 100 a day. For the private dashboard's Overview tile
// (/api/dashboard-admin/north-star). Counts only: no account, key, question or name leaves this file.
// One definition of each, per UTC day:
//   dau        accounts that asked Willo that day (answer_days, as lib/willo-stats.js counts DAU), admin and test
//              accounts left out (lib/activity.js counted)
//   returning  of those, the ones that also asked on at least one of the 7 days before it
//   studied    of those, the ones with that day's questions in the answer log (lib/answer-log.js: kept only while
//              "Help improve Willo's answers" is on, so an account that turned it off isn't here). The log keeps
//              KEEP_DAYS, so days older than that have none: null, not 0.
// The answer log keys players by a salted hash, never the account; the account ids are hashed here with the same salt
// to match the two, and only the counts are returned. Reads only, no new tracking. Kept outside functions/ so Pages
// doesn't route it.

import { utcDay, counted } from "./activity.js";
import { KEEP_DAYS, keyWith } from "./answer-log.js";

export const TARGET = 100;
export const WINDOW = 7;

// asked: [{day, key}] (one per account and day it asked); logged: [{day, key}] (one per player and day with a kept
// answer); both keyed alike. Returns the `days` UTC days ending `today`, oldest first: {day, dau, returning, studied}.
export function northStarDays(asked, logged, today, days = 30, keepDays = KEEP_DAYS) {
  const byDay = new Map(), loggedOn = new Map();
  const put = (map, day, key) => { if (!map.has(day)) map.set(day, new Set()); map.get(day).add(key); };
  for (const a of asked) put(byDay, a.day, a.key);
  for (const l of logged) put(loggedOn, l.day, l.key);
  const t = Date.parse(today + "T00:00:00Z");
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = utcDay(t, -i), dayT = Date.parse(day + "T00:00:00Z");
    const players = byDay.get(day) || new Set();
    const before = new Set();
    for (let j = 1; j <= WINDOW; j++) for (const key of byDay.get(utcDay(dayT, -j)) || []) before.add(key);
    const back = [...players].filter(key => before.has(key));
    const kept = loggedOn.get(day) || new Set();
    out.push({ day, dau: players.size, returning: back.length,
      studied: i < keepDays ? back.filter(key => kept.has(key)).length : null });
  }
  return out;
}

export async function northStarReport(env, now = Date.now(), days = 30) {
  const all = async (sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results;
  const today = utcDay(now);
  const [rows, salt, logged] = await Promise.all([
    all(`SELECT day, user_id FROM answer_days WHERE day >= ? AND day <= ? AND ${counted("user_id")}`,
      utcDay(now, -(days - 1 + WINDOW)), today),
    env.DB.prepare("SELECT salt FROM answer_log_salt WHERE id = 1").first("salt"),
    all("SELECT DISTINCT player AS key, substr(created, 1, 10) AS day FROM answer_log WHERE created >= ?",
      new Date(now - KEEP_DAYS * 864e5).toISOString()),
  ]);
  // No salt yet: nothing has been kept, so nobody can match.
  const asked = salt ? await Promise.all(rows.map(async r => ({ day: r.day, key: await keyWith(salt, r.user_id) })))
    : rows.map(r => ({ day: r.day, key: "account:" + r.user_id }));
  const list = northStarDays(asked, logged, today, days);
  return { target: TARGET, window: WINDOW, keepDays: KEEP_DAYS, today: list.at(-1), yesterday: list.at(-2), days: list };
}
