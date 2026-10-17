// Creators and Share Willo for /admin (lib/referrals.js, LOR-503, CC-72).
//   GET  /api/admin/creators  -> {"ok": true, "creators": [{code, name, contact, url, discount, share_pct, months, gift,
//                                promo_code, stripe_error, clicks, joined, paying, brought, earned, owed (US cents),
//                                created, retired}], "players": {friends, month, answers, paying, sharers}}
//   POST /api/admin/creators  {"action": "save", "code", "name", "contact"?, "discount"?, "share_pct"?, "months"?,
//                              "gift"?}   add a creator, or change one's terms (its Stripe code follows the discount)
//                             {"action": "retire" | "restore", "code"}   switch a creator's link (and Stripe code) off/on
//                             {"action": "paid", "code"}   what's owed to them is paid out now -> {"cents"}
//                             save also takes "promo_id": a promotion code made by hand in Stripe (promo_...)
// Same key as /api/admin ("Authorization: Bearer <key>"), and a browser must send it from our own pages (Origin).

import { authorized } from "../../../lib/auth.js";
import { sameOrigin } from "../../../lib/accounts.js";
import { referralReport, saveCreator, retireCreator, markPaidOut } from "../../../lib/referrals.js";

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
const json = (body, status = 200) => Response.json(body, { status, headers: NO_STORE });

async function refused(request, env) {
  if (request.headers.get("Origin") && !sameOrigin(request)) return json({ ok: false, error: "Send it from /admin." }, 403);
  if (!(await authorized(request, env))) return json({ ok: false, error: "Needs the admin key." }, 401);
  if (!env.DB) return json({ ok: false, error: "No D1 database bound as DB" }, 503);
  return null;
}

export async function onRequestGet({ request, env }) {
  const no = await refused(request, env);
  if (no) return no;
  return json({ ok: true, ...(await referralReport(env, new URL(request.url).origin)) });
}

export async function onRequestPost({ request, env }) {
  const no = await refused(request, env);
  if (no) return no;
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Expected JSON." }, 400); }
  const code = String(body?.code || "").trim().toLowerCase();
  if (body?.action === "save") {
    const out = await saveCreator(env, body);
    return out.error ? json({ ok: false, error: out.error }, 400) : json({ ok: true, creator: out.creator });
  }
  if (body?.action === "retire" || body?.action === "restore")
    return (await retireCreator(env, code, body.action === "retire")) ? json({ ok: true })
      : json({ ok: false, error: "No such creator." }, 404);
  if (body?.action === "paid") return json({ ok: true, cents: await markPaidOut(env, code) });
  return json({ ok: false, error: "Unknown action." }, 400);
}
