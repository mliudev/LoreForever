// Creators and players' invites for /admin (lib/referrals.js, LOR-503, CC-72, LOR-836).
//   GET  /api/admin/creators  -> {"ok": true, "creators": [{code, name, contact, account (their account's email), url,
//                                discount, share_pct, gift, promo_code, stripe_error, term_start, term_end, payout_method,
//                                payout_email, tax_form, clicks, joined, activated, paying, conversions, tier: {pct,
//                                conversions, next}, brought, earned, owed (US cents), created, retired (the agreement
//                                ended)}], "applications": [...], "payoutList": {month, minimum, due: [...], held: [...]},
//                                "ledger": [{invoice_id, creator, paid_cents, share_cents, pct, state, ...}], "payouts": [...],
//                                "players": {joined, activated, friends, month, answers, paying, sharers},
//                                "voids": [{why, n}], "rewards": [{kind, method, status, n, answers, cents}], "rules",
//                                "payoutRules", "tiers", "term"}
//   POST /api/admin/creators  {"action": "save", "code", "name", "contact"?, "account"? (their account's email),
//                              "channel"?, "discount"?, "share_pct"?, "gift"?, "promo_id"?, "term_start"?, "term_end"?
//                              (YYYY-MM-DD), "tax_form"? ("w9" | "w8ben" | "")}
//                                add a creator, or change one's terms (its Stripe code follows the discount)
//                             {"action": "approve" | "decline", "id", "code"?}   an application
//                             {"action": "retire" | "restore", "code"}   end a creator's agreement (link, code and free
//                               plan off; what they earned is still paid), or undo that
//                             {"action": "pay", "code", "note"?}   mark what's due now paid, once Mike has sent it by
//                               PayPal or bank wire (lib/referrals.js payCreator) -> {"payout"}; "paid" is its old name
// Same key as /api/admin ("Authorization: Bearer <key>"), and a browser must send it from our own pages (Origin).

import { authorized } from "../../../lib/auth.js";
import { sameOrigin } from "../../../lib/accounts.js";
import { referralReport, saveCreator, retireCreator, payCreator, decideApplication } from "../../../lib/referrals.js";

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
const json = (body, status = 200) => Response.json(body, { status, headers: NO_STORE });
const answer = out => out.error ? json({ ok: false, error: out.error }, 400) : json({ ok: true, ...out });

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
  switch (body?.action) {
    case "save": return answer(await saveCreator(env, body));
    case "approve": case "decline": {
      const { action, id, ...terms } = body;
      return answer(await decideApplication(env, String(id || ""), { ...terms, approve: action === "approve" }));
    }
    case "retire": case "restore":
      return (await retireCreator(env, code, body.action === "retire")) ? json({ ok: true })
        : json({ ok: false, error: "No such creator." }, 404);
    case "pay": case "paid":
      return answer(await payCreator(env, code, { note: body.note }));
    default: return json({ ok: false, error: "Unknown action." }, 400);
  }
}
