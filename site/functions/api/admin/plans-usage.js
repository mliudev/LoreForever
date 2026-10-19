// What each plan's players use, for /admin's Growth > Plans & usage (lib/plan-usage.js planUsageView,
// public/admin-plans.js), for pricing decisions.
//   GET /api/admin/plans-usage[?days=14|30] -> {ok, days, since, collectingSince, answers: [...], answersDays,
//       allAnswers: {answers, players}, limits: [...], voices: [...], picks: [...], sources: [...]}: by plan label,
//       never who.
// Same key as /api/admin ("Authorization: Bearer <key>"), and a browser must send it from our own pages (Origin).

import { authorized } from "../../../lib/auth.js";
import { sameOrigin, setup } from "../../../lib/accounts.js";
import { planUsageView } from "../../../lib/plan-usage.js";

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
const json = (body, status = 200) => Response.json(body, { status, headers: NO_STORE });

export async function onRequestGet({ request, env }) {
  if (request.headers.get("Origin") && !sameOrigin(request)) return json({ ok: false, error: "Send it from /admin." }, 403);
  if (!(await authorized(request, env))) return json({ ok: false, error: "Needs the admin key." }, 401);
  if (!env.DB) return json({ ok: false, error: "No D1 database bound as DB" }, 503);
  await setup(env);
  const days = new URL(request.url).searchParams.get("days") === "30" ? 30 : 14;
  return json({ ok: true, ...(await planUsageView(env, { days })) });
}
