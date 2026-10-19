// /admin's Retention as CSV (public/admin-retention.js's buttons; GET /api/admin/retention's report, lib/retention.js).
// Kept apart so site/tests/retention.test.mjs can check it. Never anything about who.

const PLAN = { hero: "Hero", champion: "Champion", legend: "Legend" };
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const cell = v => /[",\n]/.test(String(v ?? "")) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? "");
const csv = rows => rows.map(r => r.map(cell).join(",")).join("\n") + "\n";
const usd = cents => cents === null || cents === undefined ? "" : (cents / 100).toFixed(2);

// The cohort table: one line per start week, then Patrick's summary line.
export function cohortCsv(report) {
  const head = ["Start week (Monday)", "Plans", "Not charged yet", "Cancelled",
    ...Array.from({ length: report.weeks }, (_, i) => `Still on after ${plural(i + 1, "week")}`)];
  return csv([head, ...report.cohorts.map(c => [c.week, c.n, c.notCharged, c.cancelled,
    ...c.kept.map(k => k ? `${k.kept} of ${k.of}` : "")]), [], ["Summary", report.summary]]);
}

// One line per subscriber, newest first.
export function subscriberCsv(report) {
  const head = ["Started", "Start week (Monday)", "Plan", "Now", "Paid so far (USD)", "Not charged yet", "Cancelled or ended",
    "Days kept", "Weeks kept", "Reason", "What they wrote"];
  return csv([head, ...report.subscribers.map(s => [s.start.slice(0, 10), s.week, PLAN[s.plan] || s.plan, s.state,
    usd(s.paid), s.notCharged ? "yes" : "no", s.churn ? s.churn.slice(0, 10) : "", s.days, s.weeks, s.reason, s.comment])]);
}
