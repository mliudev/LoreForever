// Who comes back (LOR-304), downloads by signed-in players (LOR-8) and the funnel from download to returning player
// (LOR-10), for Mike's /admin. Kept outside functions/ so Pages doesn't route it.
//
// What it keeps per account is only dates and counts: no IP, no time of day, nothing else about the person.
//   users.last_seen        the last UTC day ("2026-10-11") the account was signed in on the site: set at Google sign-in
//                          and by the first signed-in request of each day (lib/accounts.js currentUser), so a sign-in
//                          the 30-day cookie remembers counts too. It stays until the account goes.
//   signin_days            (user_id, day): each UTC day the account was signed in, kept SEEN_KEEP_DAYS, for returning
//                          players and cohorts.
//   download_accounts      (day, file, user_id, n): site downloads (functions/download/[file].js) made while signed in.
//                          The anonymous `downloads` table counts every download either way; this sits next to it, so
//                          "signed up -> downloaded" can be measured per account. Downloading never needs an account.
// The companion's sync days are lib/usage.js's usage_days; profile updates per day (pasted or synced) are plain
// numbers in site_counts (lib/usage.js countSite). "Delete my account" removes these rows (lib/accounts.js USER_DATA).

export const SEEN_KEEP_DAYS = 90;   // like the usage counts
export const ACTIVITY_SETUP = [
  "CREATE TABLE IF NOT EXISTS signin_days (user_id TEXT NOT NULL, day TEXT NOT NULL, PRIMARY KEY (user_id, day))",
  "CREATE INDEX IF NOT EXISTS signin_days_day ON signin_days (day)",
  `CREATE TABLE IF NOT EXISTS download_accounts (
    day TEXT NOT NULL, file TEXT NOT NULL, user_id TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, file, user_id))`,
  "CREATE INDEX IF NOT EXISTS download_accounts_user ON download_accounts (user_id)",
  // Accounts /admin's counts leave out (syncExclusions): reason "admin" (signed in on the browser that opened /admin
  // with the admin key), "config" (ANALYTICS_EXCLUDE), "manual" (left out from Contacts), or "counted" (counted again
  // from Contacts, which no automatic reason overrides).
  "CREATE TABLE IF NOT EXISTS excluded_accounts (user_id TEXT PRIMARY KEY, reason TEXT NOT NULL, created TEXT NOT NULL)",
];
// Run once, when lib/accounts.js setup adds users.last_seen to a database from before LOR-304: an account's last
// sign-in is its newest kept session's (sessions last 30 days), and the days it signed in on are those sessions' and
// the day it was made.
export const SEEN_BACKFILL = [
  "UPDATE users SET last_seen = MAX(substr(created, 1, 10), " +
  "COALESCE((SELECT substr(MAX(s.created), 1, 10) FROM sessions s WHERE s.user_id = users.id), ''))",
  "INSERT OR IGNORE INTO signin_days (user_id, day) SELECT id, substr(created, 1, 10) FROM users " +
  "UNION SELECT user_id, substr(created, 1, 10) FROM sessions",
];

export const utcDay = (now = Date.now(), offsetDays = 0) => new Date(now + offsetDays * 864e5).toISOString().slice(0, 10);
// The Monday (UTC) of a "YYYY-MM-DD" day's week; SQL spells it date(day, 'weekday 0', '-6 days').
export function weekOf(day) {
  const t = Date.parse(day + "T00:00:00Z");
  return utcDay(t, -((new Date(t).getUTCDay() + 6) % 7));
}
const WEEK = day => `date(${day}, 'weekday 0', '-6 days')`;

// Notes that the account is signed in today (UTC). lastSeen: users.last_seen as read, so a day already noted costs
// nothing: one write per account and day. Never throws; signing in never depends on it.
export async function markSeen(env, userId, lastSeen, now = Date.now()) {
  const today = utcDay(now);
  if (!env.DB || !userId || lastSeen === today) return false;
  try {
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET last_seen = ? WHERE id = ? AND (last_seen IS NULL OR last_seen < ?)")
        .bind(today, userId, today),
      env.DB.prepare("INSERT OR IGNORE INTO signin_days (user_id, day) VALUES (?, ?)").bind(userId, today),
      env.DB.prepare("DELETE FROM signin_days WHERE day < ?").bind(utcDay(now, -SEEN_KEEP_DAYS)),
    ]);
    return true;
  } catch (e) {
    return false;
  }
}

// One site download by a signed-in account (the table comes from lib/accounts.js setup).
export async function countAccountDownload(env, userId, file, day) {
  await env.DB.prepare("INSERT INTO download_accounts (day, file, user_id, n) VALUES (?, ?, ?, 1) " +
    "ON CONFLICT(day, file, user_id) DO UPDATE SET n = n + 1").bind(day, file, userId).run();
}

// ---- Accounts the counts leave out ----

// An account /admin counts: not left out (a "counted" row keeps it in).
export const counted = column => `${column} NOT IN (SELECT user_id FROM excluded_accounts WHERE reason != 'counted')`;

// Brings the list up to date before /admin counts: the accounts named in ANALYTICS_EXCLUDE (a Pages variable: emails
// or account ids, separated by commas or spaces; test accounts go there or are left out from Contacts), and `admin`,
// the account signed in on the browser that opened /admin with the admin key (Mike's own). A "counted" or "manual"
// row stays as it is.
export async function syncExclusions(env, admin = null, now = Date.now()) {
  const stamp = new Date(now).toISOString();
  const listed = String(env.ANALYTICS_EXCLUDE || "").split(/[\s,;]+/).map(s => s.trim().toLowerCase())
    .filter(s => s && s.length <= 254).slice(0, 90);
  const writes = [env.DB.prepare("DELETE FROM excluded_accounts WHERE reason = 'config'")];
  if (listed.length) {
    const marks = listed.map(() => "?").join(", ");
    writes.push(env.DB.prepare("INSERT OR IGNORE INTO excluded_accounts (user_id, reason, created) SELECT id, 'config', ? " +
      `FROM users WHERE lower(email) IN (${marks}) OR id IN (${marks})`).bind(stamp, ...listed, ...listed));
  }
  if (admin?.id) {
    writes.push(env.DB.prepare("INSERT OR IGNORE INTO excluded_accounts (user_id, reason, created) VALUES (?, 'admin', ?)")
      .bind(admin.id, stamp));
  }
  await env.DB.batch(writes);
}

// From /admin's Contacts: leave an account out of the counts, or count it again (even an admin or test one).
export async function setExclusion(env, userId, excluded, now = Date.now()) {
  await env.DB.prepare("INSERT INTO excluded_accounts (user_id, reason, created) VALUES (?, ?, ?) " +
    "ON CONFLICT(user_id) DO UPDATE SET reason = excluded.reason, created = excluded.created")
    .bind(userId, excluded ? "manual" : "counted", new Date(now).toISOString()).run();
}

// [{user_id, reason}] of the accounts left out, for /admin's Contacts.
export async function exclusions(env) {
  return (await env.DB.prepare("SELECT user_id, reason FROM excluded_accounts").all()).results;
}

// Every day each account was seen: the day it was made (its first sign-in), its last sign-in, the sign-in days kept
// and the days the companion synced for it. "Returning" everywhere on /admin means seen on 2+ different days of these.
const SEEN = "WITH seen AS (SELECT id AS user_id, substr(created, 1, 10) AS day FROM users " +
  "UNION SELECT id, last_seen FROM users WHERE last_seen IS NOT NULL " +
  "UNION SELECT user_id, day FROM signin_days UNION SELECT user_id, day FROM usage_days), " +
  "seen_days AS (SELECT user_id, COUNT(*) AS n FROM seen GROUP BY user_id) ";
const BACK = "COALESCE(sd.n, 0) >= 2";                       // seen on 2+ different days (signed in or synced)
const SIGNED_BACK = "u.last_seen > substr(u.created, 1, 10)";   // signed in on 2+ different days
const SITE_DOWNLOADS = "file IN ('installer', 'zip', 'complete')";

// "Veteran or new" from a profile's journey record: its level, and its time played (the game's /played, else the
// hours the journey recorded). Veteran: level 40+ or 3+ days played; new: under level 20 and under a day played.
export const LEVELS = ["1-19", "20-39", "40-59", "60", "unknown"];
export const PLAYED = ["<1d", "1-3d", "3d+", "unknown"];
export function playerKind(level, played) {
  if (level === "40-59" || level === "60" || played === "3d+") return "veteran";
  if (level === "1-19" && (played === "<1d" || played === "unknown")) return "new";
  return "between";
}

const query = env => ({
  all: async (sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results,
  first: (sql, ...args) => env.DB.prepare(sql).bind(...args).first(),
});
// A table that doesn't exist yet (site_counts before its first count) reads as nothing; any other error is a bug and
// fails the report, so /admin shows it rather than zeros.
const orNull = p => p.catch(e => { if (/no such table/i.test(String(e?.message))) return null; throw e; });

// Accounts and profile owners, and how many came back: {accounts, returned (seen on 2+ days: signed in or synced),
// returnedSignin (signed in on 2+ days), owners, ownersReturned, ownersReturnedSignin}. Counted accounts only.
async function returningCounts(env) {
  return env.DB.prepare(SEEN + `SELECT COUNT(*) AS accounts, COALESCE(SUM(${BACK}), 0) AS returned, ` +
    `COALESCE(SUM(${SIGNED_BACK}), 0) AS returnedSignin, COUNT(p.user_id) AS owners, ` +
    `COALESCE(SUM(p.user_id IS NOT NULL AND ${BACK}), 0) AS ownersReturned, ` +
    `COALESCE(SUM(p.user_id IS NOT NULL AND ${SIGNED_BACK}), 0) AS ownersReturnedSignin ` +
    `FROM users u LEFT JOIN profiles p ON p.user_id = u.id LEFT JOIN seen_days sd ON sd.user_id = u.id WHERE ${counted("u.id")}`).first();
}

// Sign-in activity for /admin's Players tab, the last 30 days (UTC), counted accounts only (syncExclusions):
//   since       the first sign-in day on record
//   signedIn    {today, week, month}: different accounts signed in today, in the last 7 and 30 days
//   days        [{day, n}]: accounts signed in each day
//   profiles    [{day, n, public}]: profiles made each day, and how many of those are public now
//   updates     [{day, metric, n}]: profile updates each day, profile.paste (a pasted record) or profile.sync (the
//               companion), counting only those that changed it (plain numbers: they can't leave anyone out);
//               updatesSince: the first day counted
//   returning   returningCounts
//   excluded    {accounts, admin, test, config, manual}: the accounts left out
//   players     {grid: [{level, played, n, kind}], veteran, between, new}: profiles by level and time played (LEVELS,
//               PLAYED), kind: playerKind
export async function activityReport(env, now = Date.now()) {
  const { all, first } = query(env);
  const today = utcDay(now), week = utcDay(now, -6), month = utcDay(now, -29);
  const [signedIn, days, profiles, updates, returning, excluded, grid] = await Promise.all([
    orNull(first("SELECT COUNT(DISTINCT CASE WHEN day = ? THEN user_id END) AS today, " +
      "COUNT(DISTINCT CASE WHEN day >= ? THEN user_id END) AS week, COUNT(DISTINCT user_id) AS month, " +
      `(SELECT MIN(day) FROM signin_days) AS since FROM signin_days WHERE day >= ? AND ${counted("user_id")}`,
      today, week, month)),
    orNull(all(`SELECT day, COUNT(*) AS n FROM signin_days WHERE day >= ? AND ${counted("user_id")} GROUP BY day ORDER BY day`, month)),
    orNull(all("SELECT substr(created, 1, 10) AS day, COUNT(*) AS n, COALESCE(SUM(public = 1), 0) AS public " +
      `FROM profiles WHERE created >= ? AND ${counted("user_id")} GROUP BY day ORDER BY day`, month)),
    orNull(all("SELECT day, metric, n, (SELECT MIN(day) FROM site_counts WHERE metric IN ('profile.paste', 'profile.sync')) " +
      "AS since FROM site_counts WHERE day >= ? AND metric IN ('profile.paste', 'profile.sync') ORDER BY day", month)),
    orNull(returningCounts(env)),
    orNull(all("SELECT reason, COUNT(*) AS n FROM excluded_accounts WHERE reason != 'counted' GROUP BY reason")),
    orNull(all("SELECT CASE WHEN lv IS NULL OR lv < 1 THEN 'unknown' WHEN lv >= 60 THEN '60' WHEN lv >= 40 THEN '40-59' " +
      "WHEN lv >= 20 THEN '20-39' ELSE '1-19' END AS level, " +
      "CASE WHEN h IS NULL THEN 'unknown' WHEN h >= 72 THEN '3d+' WHEN h >= 24 THEN '1-3d' ELSE '<1d' END AS played, " +
      "COUNT(*) AS n FROM (SELECT CAST(json_extract(data, '$.level') AS INTEGER) AS lv, " +
      "NULLIF(MAX(COALESCE(json_extract(data, '$.stats.played'), 0), COALESCE(json_extract(data, '$.stats.recorded'), 0)), 0) AS h " +
      `FROM profiles WHERE ${counted("user_id")}) GROUP BY level, played`)),
  ]);
  const players = { grid: (grid || []).map(g => ({ ...g, kind: playerKind(g.level, g.played) })), veteran: 0, between: 0, new: 0 };
  for (const g of players.grid) players[g.kind] += g.n;
  const left = Object.fromEntries((excluded || []).map(r => [r.reason, r.n]));
  return {
    since: signedIn?.since || null,
    signedIn: { today: signedIn?.today || 0, week: signedIn?.week || 0, month: signedIn?.month || 0 },
    days: days || [], profiles: profiles || [],
    updates: (updates || []).map(({ day, metric, n }) => ({ day, metric, n })), updatesSince: updates?.[0]?.since || null,
    returning: { accounts: 0, returned: 0, returnedSignin: 0, owners: 0, ownersReturned: 0, ownersReturnedSignin: 0,
                 ...(returning || {}) },
    excluded: { accounts: Object.values(left).reduce((a, n) => a + n, 0), ...left },
    players,
  };
}

// The funnel for /admin (LOR-10), counted accounts only. Visits aren't in D1 (Cloudflare Web Analytics counts them,
// in the Pages project's Metrics).
//   stages      {downloads, installer, accounts, profiles, companion, returning}, since counting began: add-on
//               downloads through this site's links (installer and zip; installer: the installer's alone), accounts
//               (each one a Google sign-in), player profiles, accounts the companion synced for, and accounts seen
//               (signed in or synced) on 2+ different days (the same as activityReport's returning.returned)
// functions/api/admin.js adds lib/stores.js's CurseForge and GitHub counts ("stores", LOR-421) and lib/checkins.js's
// companion check-ins ("companions", "companionWeeks", LOR-422).
//   signedInDownloads   {downloads, accounts, since}: site downloads made while signed in (LOR-8), and by how many accounts
//   weeks       [{week, downloads, accounts, profiles, signedIn, synced, active, back}] the last `weeks` weeks (Monday,
//               UTC), this one last: back = active that week (signed in or synced) and first seen in an earlier week
//   cohorts     [{week, accounts, returned, w1, w2, w3, w4}] accounts by the week they were made (first signed in):
//               how many came back on a later day, and how many were active 1, 2, 3 and 4 weeks after that week
export async function funnelReport(env, now = Date.now(), weeks = 8) {
  const { all, first } = query(env);
  const thisWeek = weekOf(utcDay(now)), from = utcDay(Date.parse(thisWeek + "T00:00:00Z"), -7 * (weeks - 1));
  const active = `SELECT ${WEEK("day")} AS week, user_id FROM signin_days WHERE day >= ? ` +
    `UNION SELECT ${WEEK("day")}, user_id FROM usage_days WHERE day >= ?`;
  const later = k => `COALESCE(s.day >= date(c.week, '+${7 * k} days') AND s.day < date(c.week, '+${7 * (k + 1)} days'), 0)`;
  const [downloads, accounts, profiles, companion, returning, signedInDownloads, dlWeeks, accountWeeks, profileWeeks,
         signinWeeks, syncWeeks, activeWeeks, cohorts] = await Promise.all([
    orNull(first("SELECT COALESCE(SUM(n), 0) AS n, COALESCE(SUM(CASE WHEN file = 'installer' THEN n END), 0) AS installer " +
      `FROM downloads WHERE ${SITE_DOWNLOADS}`)),
    orNull(first(`SELECT COUNT(*) AS n FROM users WHERE ${counted("id")}`)),
    orNull(first(`SELECT COUNT(*) AS n FROM profiles WHERE ${counted("user_id")}`)),
    orNull(first(`SELECT COUNT(*) AS n FROM users u WHERE ${counted("u.id")} AND (EXISTS (SELECT 1 FROM usage_days d ` +
      "WHERE d.user_id = u.id) OR EXISTS (SELECT 1 FROM devices d WHERE d.user_id = u.id AND d.last_sync IS NOT NULL))")),
    orNull(returningCounts(env)),
    orNull(first("SELECT COALESCE(SUM(n), 0) AS downloads, COUNT(DISTINCT user_id) AS accounts, MIN(day) AS since " +
      `FROM download_accounts WHERE ${counted("user_id")}`)),
    orNull(all(`SELECT ${WEEK("day")} AS week, SUM(n) AS n FROM downloads WHERE ${SITE_DOWNLOADS} AND day >= ? GROUP BY week`, from)),
    orNull(all(`SELECT ${WEEK("substr(created, 1, 10)")} AS week, COUNT(*) AS n FROM users WHERE created >= ? AND ` +
      `${counted("id")} GROUP BY week`, from)),
    orNull(all(`SELECT ${WEEK("substr(created, 1, 10)")} AS week, COUNT(*) AS n FROM profiles WHERE created >= ? AND ` +
      `${counted("user_id")} GROUP BY week`, from)),
    orNull(all(`SELECT ${WEEK("day")} AS week, COUNT(DISTINCT user_id) AS n FROM signin_days WHERE day >= ? AND ` +
      `${counted("user_id")} GROUP BY week`, from)),
    orNull(all(`SELECT ${WEEK("day")} AS week, COUNT(DISTINCT user_id) AS n FROM usage_days WHERE day >= ? AND ` +
      `${counted("user_id")} GROUP BY week`, from)),
    orNull(all(`SELECT a.week, COUNT(DISTINCT a.user_id) AS active, ` +
      `COUNT(DISTINCT CASE WHEN substr(u.created, 1, 10) < a.week THEN a.user_id END) AS back ` +
      `FROM (${active}) a JOIN users u ON u.id = a.user_id WHERE ${counted("u.id")} GROUP BY a.week`, from, from)),
    orNull(all("WITH seen AS (SELECT user_id, day FROM signin_days UNION SELECT user_id, day FROM usage_days), " +
      `c AS (SELECT id, substr(created, 1, 10) AS first, ${WEEK("substr(created, 1, 10)")} AS week, last_seen ` +
      `FROM users WHERE created >= ? AND ${counted("id")}), ` +
      "per AS (SELECT c.id, c.week, MAX(COALESCE(c.last_seen > c.first, 0), COALESCE(MAX(s.day > c.first), 0)) AS returned, " +
      `MAX(${later(1)}) AS w1, MAX(${later(2)}) AS w2, MAX(${later(3)}) AS w3, MAX(${later(4)}) AS w4 ` +
      "FROM c LEFT JOIN seen s ON s.user_id = c.id GROUP BY c.id) " +
      "SELECT week, COUNT(*) AS accounts, SUM(returned) AS returned, SUM(w1) AS w1, SUM(w2) AS w2, SUM(w3) AS w3, " +
      "SUM(w4) AS w4 FROM per GROUP BY week ORDER BY week", from)),
  ]);
  const byWeek = rows => Object.fromEntries((rows || []).map(r => [r.week, r]));
  const dl = byWeek(dlWeeks), ac = byWeek(accountWeeks), pr = byWeek(profileWeeks), si = byWeek(signinWeeks),
        sy = byWeek(syncWeeks), act = byWeek(activeWeeks);
  const list = Array.from({ length: weeks }, (_, i) => utcDay(Date.parse(from + "T00:00:00Z"), 7 * i));
  return {
    stages: { downloads: downloads?.n || 0, installer: downloads?.installer || 0, accounts: accounts?.n || 0,
              profiles: profiles?.n || 0, companion: companion?.n || 0, returning: returning?.returned || 0 },
    signedInDownloads: { downloads: 0, accounts: 0, since: null, ...(signedInDownloads || {}) },
    weeks: list.map(week => ({ week, downloads: dl[week]?.n || 0, accounts: ac[week]?.n || 0, profiles: pr[week]?.n || 0,
      signedIn: si[week]?.n || 0, synced: sy[week]?.n || 0, active: act[week]?.active || 0, back: act[week]?.back || 0 })),
    cohorts: cohorts || [],
  };
}
