// A player's plan (lib/billing.js planFor), kept 30 seconds per isolate for the answer path, which reads it on every
// answer and on every spoken piece of one: about three round trips to D1 each time, before Willo can start (the
// Software Architect's 10/21 review, item 2). A plan change (a checkout, a cancel, a renewal) reaches answers within
// 30 seconds; nothing can clear it sooner, since a webhook reaches one isolate only. The billing pages, /api/willo and
// the allowance Willo shows read the plan fresh. Kept outside functions/ so Pages doesn't route it.

import { planFor, plansOn } from "./billing.js";

export const PLAN_TTL_MS = 30 * 1000;
const MAX = 5000;
const kept = new Map();

// planFor's answer at `now`, from a read at most PLAN_TTL_MS before it on this database, with plans switched as they
// are now.
export async function planSoon(env, userId, now = new Date()) {
  const at = now.getTime(), on = plansOn(env), hit = kept.get(userId);
  if (hit && hit.db === env.DB && hit.on === on && at >= hit.at && at - hit.at < PLAN_TTL_MS) return hit.plan;
  const plan = await planFor(env, userId, now);
  kept.delete(userId);
  if (kept.size >= MAX) kept.delete(kept.keys().next().value);
  kept.set(userId, { db: env.DB, on, at, plan });
  return plan;
}
