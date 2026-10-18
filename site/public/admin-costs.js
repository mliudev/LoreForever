// The Costs tab's numbers (public/admin.html, admin-page.js): totals, each service's share, and the one thing that needs
// attention, all worked out here from the snapshot /api/admin/costs serves (lib/costs.js has its shape). No DOM, so a
// test can read it. Severity is "good", "warn" or "crit"; the page shows it as colour and as words.

export const KIND_WORDS = { fixed: "Fixed subscription", usage: "Usage", prepaid: "Prepaid balance" };
const SEVERITY = { good: 0, warn: 1, crit: 2 };
const STALE_DAYS = 10;

const sum = (list, key) => Math.round(list.reduce((a, s) => a + (s[key] || 0), 0) * 100) / 100;
export const dollars = (n, cents = false) => "$" + Number(n).toLocaleString("en-US", cents || n % 1
  ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 0 });
const pct = n => Math.round(n * 100) + "%";

// Days of a prepaid balance left at its monthly estimate (30-day month); null with no balance or no spending.
function runwayDays(s) {
  if (s.kind !== "prepaid" || s.balance == null || !s.monthly_estimate) return null;
  return s.balance / (s.monthly_estimate / 30);
}

export function costsView(snapshot, now = Date.now()) {
  const services = snapshot.services.map(s => ({ ...s })).sort((a, b) =>
    b.monthly_estimate - a.monthly_estimate || b.month_to_date - a.month_to_date || a.name.localeCompare(b.name));
  const monthToDate = sum(services, "month_to_date"), estimate = sum(services, "monthly_estimate");
  for (const s of services) {
    s.share = estimate ? s.monthly_estimate / estimate : 0;
    s.capUsed = s.cap ? s.month_to_date / s.cap : null;
    s.runway = runwayDays(s);
  }

  const budget = snapshot.budget_monthly, gap = Math.round((estimate - budget) * 100) / 100;
  const over = gap > 0;
  const budgetState = {
    severity: !over ? "good" : estimate > budget * 1.5 ? "crit" : "warn",
    words: over ? "Over budget by " + dollars(gap) : "Under budget by " + dollars(-gap),
  };

  // The one thing to look at: the worst of an over-budget total (named by its biggest service), a service near its
  // cap, a prepaid balance about to run out, or a snapshot gone stale. Nothing wrong says so.
  const found = [];
  const top = services[0];
  if (over && top) {
    found.push({ severity: budgetState.severity, title: top.name + " is " + pct(top.share) + " of the monthly cost",
      detail: "The estimate is " + dollars(estimate) + " against a " + dollars(budget) + " budget." +
        (top.capUsed != null ? " It has used " + pct(top.capUsed) + " of its " + dollars(top.cap) + " cap." : "") });
  }
  for (const s of services) {
    if (s.capUsed != null && s.capUsed >= 0.75) {
      found.push({ severity: s.capUsed >= 0.9 ? "crit" : "warn", title: s.name + " has used " + pct(s.capUsed) + " of its cap",
        detail: dollars(s.month_to_date) + " of " + dollars(s.cap) + " this month." });
    }
    if (s.runway != null && s.runway < 7) {
      found.push({ severity: s.runway < 3 ? "crit" : "warn", title: s.name + " balance runs out in about " + Math.max(1, Math.floor(s.runway)) + " days",
        detail: dollars(s.balance) + " left at the current pace." });
    }
  }
  const age = (now - Date.parse(snapshot.taken_at)) / 864e5;
  if (age > STALE_DAYS) {
    found.push({ severity: "warn", title: "These figures are " + Math.floor(age) + " days old", detail: "Ask Operations for a fresh check." });
  }
  found.sort((a, b) => SEVERITY[b.severity] - SEVERITY[a.severity]);
  const attention = found[0] || { severity: "good", title: "Nothing needs attention", detail: "Spending is inside the budget and every cap." };

  const revenue = snapshot.revenue || null;
  return { services, monthToDate, estimate, budget, gap, over, budgetState, attention, revenue,
           notChecked: snapshot.not_checked || [], takenAt: snapshot.taken_at };
}
