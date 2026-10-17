// Share Willo (LOR-253, LOR-503, CC-72; Mike and Patrick, 2026-10-16): every player has a link of their own,
// loreforeverwow.com/w/<code>, shown in Willo's window, on /account's Willo tab and on their own profile. Willo thrives
// on companionship: the more friends she has, the more energy she has. So when a friend opens the link and then
// connects Willo to an account for the first time, the player who shared it gets more answers: SHARE_PERCENT of their
// plan's month for each friend (Free 60, Hero 90, Champion 190, Legend 400), for up to SHARES_PER_MONTH friends a
// calendar month (ten friends: a whole month more, Patrick's "10 shares = a 100% top-up"). The answers stay until
// they're used, after the plan's own (and a free player's starter): answer_packs kind 'share' (lib/billing.js useShare).
// A free player's are free answers, paid from the shared monthly budget like the starter (so its $100 holds); a paying
// player's still count against their plan's cost caps, so nobody costs more than they pay.
//
// What counts as a friend: an account connecting Willo (POST /api/device/approve) for the first time, with no Willo
// connected and no question asked of her before, in a browser that opened a share link in the last COOKIE_DAYS days
// (the lf_share cookie /w/<code> sets; the latest link opened wins). Once per Google account, ever: referrals keeps
// its one-way code (lib/billing.js starterClaim) after "Delete my account", so deleting it and connecting again with
// someone else's link doesn't count twice. Never the link's own account.
//
// Creators (LOR-503, CC-72): a creator's link is a readable code (/w/ziqo), made on /admin with its terms (creators):
// their audience gets `gift` answers (CREATOR_DEFAULTS: 100) when they connect Willo, and `discount`% off their first
// month of any plan, through a Stripe promotion code (the creator's code in capitals, so it can be typed at checkout
// too, on a phone, say). Checkout applies it by itself to an account their link brought (lib/billing.js
// createCheckout), once per account and only when no beta offer applies (Checkout takes one discount). The creator
// earns share_pct% of what those players pay in their first `months` months (CREATOR_DEFAULTS: 20% of 3 months, Mike's
// call to change; Patrick floated 80-90% for 50K+ creators on 10/13), kept per paid invoice in creator_earnings
// (notePayment) for /admin, which pays out by hand: "Mark paid" notes it. A refund after the fact isn't taken off;
// check Stripe before paying.
//
// The tables (made by setupReferrals; "Delete my account" removes or strips the account's rows, REFERRAL_USER_DATA):
// share_codes: every code, one live player code per account (retired: when "New link" replaced it; a retired code
//   still credits friends who opened it before, but /w/ no longer takes it). kind 'player' (user_id) or 'creator'.
//   clicks: how often /w/<code> was opened (not by link-preview bots).
// referrals: one row per friend counted (user_id), the code that brought them, the account that shared it
//   (sharer_id) or the creator, the friend's one-way Google code (sub_hash, so once per Google account), answers: what
//   the sharer got for it (0 past the month's SHARES_PER_MONTH), and paid: when the friend first paid for a plan.
// creators: a creator's terms; promo_id: their Stripe promotion code, or stripe_error when Stripe refused it.
// creator_earnings: per paid invoice of a player a creator brought: what was paid (before Stripe's fees, without
//   tax), the creator's share, and paid_out once it's been paid.

import { PLANS, PAID, setupBilling, starterClaim, planIdNow, promoClaimed, stripe } from "./billing.js";
import { COMPANION_NAME } from "./brand.js";

export const SHARE_PERCENT = 10;
export const SHARES_PER_MONTH = 10;
// What a friend's share gives, by the sharer's plan: SHARE_PERCENT of its month's answers.
export const shareAnswersFor = planId => Math.round((PLANS[planId] || PLANS.free).answersPerMonth * SHARE_PERCENT / 100);
// A creator's terms unless /admin says otherwise (Mike sets the money ones; these are the defaults he can change).
export const CREATOR_DEFAULTS = { discount: 50, sharePct: 20, months: 3, gift: 100 };
export const COOKIE = "lf_share";
export const COOKIE_DAYS = 30;
// Player codes: CODE_LENGTH letters from an alphabet without look-alikes (no 0, o, 1, l); about 34 billion codes.
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const CODE_LENGTH = 7;
export const PLAYER_CODE = /^[a-km-np-z2-9]{7}$/;
// Creator codes: what /admin types, readable: "ziqo", "lore-nerd".
export const CREATOR_CODE = /^[a-z0-9][a-z0-9-]{1,23}$/;
const anyCode = code => typeof code === "string" && (PLAYER_CODE.test(code) || CREATOR_CODE.test(code));

const iso = (ms = Date.now()) => new Date(ms).toISOString();
const idOf = v => typeof v === "string" ? v : typeof v?.id === "string" ? v.id : null;

const SETUP = [
  `CREATE TABLE IF NOT EXISTS share_codes (code TEXT PRIMARY KEY, user_id TEXT, kind TEXT NOT NULL DEFAULT 'player',
    created TEXT NOT NULL, retired TEXT, clicks INTEGER NOT NULL DEFAULT 0)`,
  "CREATE UNIQUE INDEX IF NOT EXISTS share_codes_live ON share_codes (user_id) WHERE kind = 'player' AND retired IS NULL",
  `CREATE TABLE IF NOT EXISTS referrals (user_id TEXT PRIMARY KEY, code TEXT NOT NULL, kind TEXT NOT NULL,
    sharer_id TEXT, creator TEXT, sub_hash TEXT UNIQUE, answers INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL,
    paid TEXT)`,
  "CREATE INDEX IF NOT EXISTS referrals_sharer ON referrals (sharer_id, created)",
  "CREATE INDEX IF NOT EXISTS referrals_creator ON referrals (creator)",
  `CREATE TABLE IF NOT EXISTS creators (code TEXT PRIMARY KEY, name TEXT NOT NULL, contact TEXT,
    discount INTEGER NOT NULL, share_pct INTEGER NOT NULL, months INTEGER NOT NULL, gift INTEGER NOT NULL,
    promo_id TEXT, promo_code TEXT, stripe_error TEXT, created TEXT NOT NULL, retired TEXT)`,
  `CREATE TABLE IF NOT EXISTS creator_earnings (invoice_id TEXT PRIMARY KEY, creator TEXT NOT NULL, user_id TEXT,
    paid_cents INTEGER NOT NULL, share_cents INTEGER NOT NULL, pct INTEGER NOT NULL, paid_at TEXT NOT NULL,
    recorded TEXT NOT NULL, paid_out TEXT)`,
  "CREATE INDEX IF NOT EXISTS creator_earnings_creator ON creator_earnings (creator, paid_at)",
];
const ready = new WeakSet();
export async function setupReferrals(env) {
  if (ready.has(env.DB)) return;
  await env.DB.batch(SETUP.map(s => env.DB.prepare(s)));
  ready.add(env.DB);
}

// "Delete my account" (lib/accounts.js USER_DATA): their codes go (their link stops working), the answers friends gave
// them go with their packs; a friend row that's theirs stays without the account, for the counts and a creator's
// earnings, keeping only the one-way Google code (so coming back doesn't count again); a row they shared keeps the
// friend but not them.
export const REFERRAL_USER_DATA = [
  ["DELETE FROM share_codes WHERE user_id = ? AND kind = 'player'", u => u.id],
  ["UPDATE referrals SET user_id = 'gone:' || lower(hex(randomblob(8))) WHERE user_id = ?", u => u.id],
  ["UPDATE referrals SET sharer_id = NULL WHERE sharer_id = ?", u => u.id],
  ["UPDATE creator_earnings SET user_id = NULL WHERE user_id = ?", u => u.id],
];

// ---- Codes ----

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return [...bytes].map(b => ALPHABET[b % ALPHABET.length]).join("");
}

// The account's share code, made the first time it's asked for. Two asks at once both get the one that was made
// (share_codes_live: one live code per account).
export async function shareCode(env, userId) {
  await setupReferrals(env);
  const live = () => env.DB.prepare(
    "SELECT code FROM share_codes WHERE user_id = ? AND kind = 'player' AND retired IS NULL").bind(userId).first();
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await live();
    if (row) return row.code;
    await env.DB.prepare("INSERT OR IGNORE INTO share_codes (code, user_id, kind, created) VALUES (?, ?, 'player', ?)")
      .bind(newCode(), userId, iso()).run();
  }
  throw new Error("Couldn't make a share code");
}

// "New link": the account's code is retired (friends who opened it before still count) and a new one made.
export async function newShareCode(env, userId) {
  await setupReferrals(env);
  await env.DB.prepare("UPDATE share_codes SET retired = ? WHERE user_id = ? AND kind = 'player' AND retired IS NULL")
    .bind(iso(), userId).run();
  return shareCode(env, userId);
}

export const shareUrl = (origin, code) => `${origin}/w/${code}`;

// Who a code is: {code, kind, userId (a player's), name (what the page may show: a player's public profile's character
// name, or a creator's name; null for a player without a public profile), creator (a creator's terms)}, or null when
// there's no such code, or it's retired (unless `retired`: a friend who opened it before it was retired still counts).
export async function codeOwner(env, code, { retired = false } = {}) {
  code = String(code || "").toLowerCase();
  if (!anyCode(code)) return null;
  await setupReferrals(env);
  const row = await env.DB.prepare("SELECT * FROM share_codes WHERE code = ?").bind(code).first();
  if (!row || (row.retired && !retired)) return null;
  if (row.kind === "creator") {
    const creator = await creatorRow(env, code);
    if (!creator || (creator.retired && !retired)) return null;
    return { code, kind: "creator", userId: null, name: creator.name, creator };
  }
  if (!row.user_id) return null;
  // Never a Google name: only the character a player chose to make public.
  let name = null;
  try {
    const p = await env.DB.prepare("SELECT data FROM profiles WHERE user_id = ? AND public = 1").bind(row.user_id).first();
    name = p ? String(JSON.parse(p.data)?.name || "").slice(0, 40) || null : null;
  } catch (e) { /* no profile table yet, or an unreadable one: no name */ }
  return { code, kind: "player", userId: row.user_id, name, creator: null };
}

// /w/<code> opened (not by a bot): one more click on the code, for /admin.
export async function noteClick(env, code) {
  await setupReferrals(env);
  await env.DB.prepare("UPDATE share_codes SET clicks = clicks + 1 WHERE code = ?").bind(code).run();
}

// The cookie /w/<code> sets: the code, for the friend's first Willo connect (countShare).
export const shareCookie = (request, code) =>
  `${COOKIE}=${code}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_DAYS * 86400}` +
  (new URL(request.url).protocol === "https:" ? "; Secure" : "");

function cookieCode(request) {
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) {
      const code = v.join("=").toLowerCase();
      return anyCode(code) ? code : null;
    }
  }
  return null;
}

// ---- Counting a friend ----

// An account connecting Willo (functions/api/device/[action].js approve), with the share cookie: counts it as the
// code's friend when it's new to Willo and its Google account was never anyone's friend before, and gives the answers:
// the sharer's (SHARE_PERCENT of their plan's month, while they have fewer than SHARES_PER_MONTH this calendar month),
// or a creator's gift to the friend. {kind, answers (the sharer's), gift (the friend's)}, or null when it doesn't count.
export async function countShare(env, request, friend, now = new Date()) {
  const code = cookieCode(request);
  if (!code) return null;
  const owner = await codeOwner(env, code, { retired: true });
  if (!owner || owner.userId === friend.id) return null;
  // New to Willo: nothing connected, and no question asked of her (lib/activity.js answer_days), before this connect.
  const used = await env.DB.prepare("SELECT EXISTS (SELECT 1 FROM devices WHERE user_id = ?) OR " +
    "EXISTS (SELECT 1 FROM answer_days WHERE user_id = ?) AS y").bind(friend.id, friend.id).first();
  if (used?.y) return null;
  await setupBilling(env);
  const sub = (await starterClaim(env, friend.id)) || `user:${friend.id}`;
  const at = iso(now.getTime());
  const made = await env.DB.prepare(
    "INSERT OR IGNORE INTO referrals (user_id, code, kind, sharer_id, creator, sub_hash, created) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(friend.id, code, owner.kind, owner.userId, owner.creator?.code ?? null, sub, at).run();
  if (!made.meta.changes) return null;
  if (owner.kind === "creator") {
    const gift = owner.creator.gift;
    if (gift > 0) await env.DB.prepare("INSERT OR IGNORE INTO answer_packs (id, user_id, kind, answers, remaining, created) " +
      "VALUES (?, ?, 'share', ?, ?, ?)").bind(`gift:${friend.id}`, friend.id, gift, gift, at).run();
    return { kind: "creator", answers: 0, gift };
  }
  // The sharer's answers, in one statement with the month's count, so two friends connecting at once can't both be the
  // eleventh.
  const answers = shareAnswersFor(await planIdNow(env, owner.userId, now));
  const pack = `share:${friend.id}`;
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO answer_packs (id, user_id, kind, answers, remaining, created) " +
      "SELECT ?, ?, 'share', ?, ?, ? WHERE (SELECT COUNT(*) FROM referrals WHERE sharer_id = ? AND answers > 0 AND " +
      "substr(created, 1, 7) = ?) < ?").bind(pack, owner.userId, answers, answers, at, owner.userId, at.slice(0, 7),
      SHARES_PER_MONTH),
    env.DB.prepare("UPDATE referrals SET answers = ? WHERE user_id = ? AND EXISTS (SELECT 1 FROM answer_packs WHERE id = ?)")
      .bind(answers, friend.id, pack),
  ]);
  const row = await env.DB.prepare("SELECT answers FROM referrals WHERE user_id = ?").bind(friend.id).first();
  return { kind: "player", answers: row?.answers || 0, gift: 0 };
}

const plural = (n, one, many = one + "s") => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
// The share card's words, here so Willo's window, /account and the profile say the same: about (what sharing does) and
// tally (what it has done). Plain, with no plans or prices: Willo's window shows them as they are.
export function shareWords(s, now = new Date()) {
  const about = `${COMPANION_NAME} thrives on companionship: the more friends she has, the more energy she has. When a ` +
    `friend connects ${COMPANION_NAME} for the first time with your link, you get ${plural(s.perShare, "more answer", "more answers")}, ` +
    `for up to ${s.month.max} friends a month.`;
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
    .toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
  const tally = !s.friends ? "No friends have joined with your link yet."
    : `${plural(s.friends, "friend")} joined with your link: ${plural(s.earned, "answer")} from friends` +
      (s.left ? ` (${s.left.toLocaleString("en-US")} still to use)` : "") + "." +
      (s.month.counted >= s.month.max ? ` That's this month's ${s.month.max}; friends who join from ${next} count again.` : "");
  return { about, tally };
}

// What the share card shows (Willo's window, /account, the profile): {code, url, friends (all counted, ever), earned
// (answers friends gave, ever), perShare (what the next friend gives now), month: {counted, max}, left (answers from
// friends still to use, a creator's gift included), about, tally (shareWords)}.
export async function shareSummary(env, userId, origin, now = new Date()) {
  const code = await shareCode(env, userId);
  await setupBilling(env);
  const [row, packs, planId] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS friends, COALESCE(SUM(answers), 0) AS earned, " +
      "COALESCE(SUM(answers > 0 AND substr(created, 1, 7) = ?), 0) AS month FROM referrals WHERE sharer_id = ?")
      .bind(iso(now.getTime()).slice(0, 7), userId).first(),
    env.DB.prepare("SELECT COALESCE(SUM(remaining), 0) AS n FROM answer_packs WHERE user_id = ? AND kind = 'share' " +
      "AND status = 'active'").bind(userId).first(),
    planIdNow(env, userId, now),
  ]);
  const s = { code, url: shareUrl(origin, code), friends: row?.friends || 0, earned: row?.earned || 0,
              perShare: shareAnswersFor(planId), month: { counted: row?.month || 0, max: SHARES_PER_MONTH },
              left: packs?.n || 0 };
  return { ...s, ...shareWords(s, now) };
}

// The share card on the owner's own profile (lib/profiles.js profilePage), with Copy link and New link
// (public/js/profile.js). share: shareSummary's.
export const shareCard = (share, escape) => `<section class="pf-share" aria-labelledby="share-title" data-bar>
    <h2 id="share-title">Share ${COMPANION_NAME}</h2>
    <p>${escape(share.about)}</p>
    <p class="pf-share-link"><code data-share-url>${escape(share.url)}</code>
      <button class="btn-small" type="button" data-share-willo>Copy link</button>
      <button class="btn-small btn-small-alt" type="button" data-new-share>New link</button></p>
    <p class="pf-share-tally" data-share-tally>${escape(share.tally)}</p>
    <p class="fb-status" role="status" hidden></p>
  </section>`;

// What /willo says above the download for someone a link brought (functions/willo.js): plain words, from the code's
// owner (codeOwner). A creator's says what their audience gets. HTML, or "".
export function shareBanner(owner, escape) {
  if (!owner) return "";
  if (owner.kind === "creator") {
    const c = owner.creator;
    const gets = [c.gift > 0 && `${c.gift} extra answers when you connect ${COMPANION_NAME}`,
                  c.discount > 0 && `${c.discount}% off your first month if you choose a plan`].filter(Boolean);
    return `<aside class="w-shared" aria-label="Who sent you"><p><strong>${escape(owner.name)}</strong> sent you here` +
      (gets.length ? `: ${escape(gets.join(", and "))}.` : ".") + "</p></aside>";
  }
  const who = owner.name ? `<strong>${escape(owner.name)}</strong>` : "A friend";
  return `<aside class="w-shared" aria-label="Who sent you"><p>${who} shared ${COMPANION_NAME} with you. ` +
    `${COMPANION_NAME} thrives on companionship: when you connect her, your friend's ${COMPANION_NAME} gets more ` +
    "energy too.</p></aside>";
}

// ---- Creators ----

const creatorRow = (env, code) => env.DB.prepare("SELECT * FROM creators WHERE code = ?").bind(code).first();

// The creator whose link brought this account, for checkout and /plans: {code, name, discount, promoId}, or null.
export async function creatorFor(env, userId) {
  await setupReferrals(env);
  const row = await env.DB.prepare("SELECT c.code, c.name, c.discount, c.promo_id FROM referrals r JOIN creators c " +
    "ON c.code = r.creator WHERE r.user_id = ?").bind(userId).first();
  return row ? { code: row.code, name: row.name, discount: row.discount, promoId: row.promo_id } : null;
}

// /plans' cards (functions/api/billing/[action].js): a creator's first-month discount on each paid plan that has no
// beta offer for this player (offers: lib/billing.js launchOffers'), while the account hasn't had it. The same shape as
// a beta offer: {price, label, note}.
export async function creatorOffers(env, userId, offers = {}) {
  const creator = userId ? await creatorFor(env, userId) : null;
  if (!creator?.promoId || !(creator.discount > 0) || await promoClaimed(env, userId, "creator")) return {};
  const out = {};
  for (const id of PAID) {
    if (offers[id]) continue;
    const monthly = PLANS[id].monthly;
    out[id] = { price: monthly - Math.round(monthly * creator.discount / 100), label: `${creator.name}: ${creator.discount}% off`,
                note: `your first month, then $${(monthly / 100).toFixed(2)}` };
  }
  return out;
}

// The coupon for a discount (made once, by its id) and the creator's promotion code on it: their code in capitals,
// only for a customer's first payment. Stripe's error is kept on the row (stripe_error) instead of thrown, so /admin
// can try again; the link works either way, without the discount.
async function syncPromo(env, creator) {
  if (!env.STRIPE_SECRET_KEY || !(creator.discount > 0)) return creator;
  const couponId = `lore_forever_creator_${creator.discount}`;
  try {
    const found = await stripe(env, "GET", `coupons/${couponId}`).catch(e => e.status === 404 ? null : Promise.reject(e));
    if (!found) await stripe(env, "POST", "coupons", { id: couponId, name: `${creator.discount}% off your first month`,
      percent_off: creator.discount, duration: "once" }, { idempotencyKey: `lf-coupon-${couponId}` });
    if (creator.promo_id) {
      const old = await stripe(env, "GET", `promotion_codes/${encodeURIComponent(creator.promo_id)}`).catch(() => null);
      if (old?.active && idOf(old.promotion?.coupon ?? old.coupon) === couponId) return creator;
      if (old?.active) await stripe(env, "POST", `promotion_codes/${encodeURIComponent(creator.promo_id)}`, { active: false });
    }
    const code = creator.code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const base = { code, metadata: { creator: creator.code }, restrictions: { first_time_transaction: true } };
    let promo;
    // Since Stripe's 2025-09-30 API a promotion code names its coupon under `promotion`; before it, as `coupon`.
    try { promo = await stripe(env, "POST", "promotion_codes", { ...base, promotion: { type: "coupon", coupon: couponId } }); }
    catch (e) {
      if (e.status !== 400 || !/promotion\b|unknown|received unknown/i.test(e.message) || /already/i.test(e.message)) throw e;
      promo = await stripe(env, "POST", "promotion_codes", { ...base, coupon: couponId });
    }
    await env.DB.prepare("UPDATE creators SET promo_id = ?, promo_code = ?, stripe_error = NULL WHERE code = ?")
      .bind(promo.id, promo.code || code, creator.code).run();
  } catch (e) {
    console.warn(`referrals: creator ${creator.code}'s Stripe code: ${e?.message || e}`);
    await env.DB.prepare("UPDATE creators SET stripe_error = ? WHERE code = ?")
      .bind(String(e?.message || e).slice(0, 300), creator.code).run();
  }
  return creatorRow(env, creator.code);
}

const whole = (v, min, max, fallback) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};
const text = (v, max) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);

// /admin's "Add creator" and its edits (functions/api/admin/creators.js): {creator} or {error}. A new code must be
// free (no player or creator has it). Terms left out keep what they were (a new creator's: CREATOR_DEFAULTS).
export async function saveCreator(env, input) {
  await setupReferrals(env);
  const code = String(input.code || "").trim().toLowerCase();
  if (!CREATOR_CODE.test(code)) return { error: "A code is 2-24 letters, digits or dashes, like ziqo." };
  const old = await creatorRow(env, code);
  const name = text(input.name, 60) || old?.name;
  if (!name) return { error: "A creator needs a name." };
  const d = CREATOR_DEFAULTS;
  const row = { code, name, contact: input.contact === undefined ? old?.contact ?? null : text(input.contact, 200) || null,
    discount: whole(input.discount, 0, 100, old?.discount ?? d.discount),
    share_pct: whole(input.share_pct, 0, 100, old?.share_pct ?? d.sharePct),
    months: whole(input.months, 1, 36, old?.months ?? d.months), gift: whole(input.gift, 0, 1000, old?.gift ?? d.gift) };
  if (!old) {
    const made = await env.DB.prepare("INSERT OR IGNORE INTO share_codes (code, user_id, kind, created) VALUES (?, NULL, 'creator', ?)")
      .bind(code, iso()).run();
    if (!made.meta.changes) return { error: "That code is taken." };
    await env.DB.prepare("INSERT INTO creators (code, name, contact, discount, share_pct, months, gift, created) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(code, row.name, row.contact, row.discount, row.share_pct, row.months,
      row.gift, iso()).run();
  } else {
    await env.DB.prepare("UPDATE creators SET name = ?, contact = ?, discount = ?, share_pct = ?, months = ?, gift = ? " +
      "WHERE code = ?").bind(row.name, row.contact, row.discount, row.share_pct, row.months, row.gift, code).run();
  }
  // A promotion code made by hand in Stripe's Dashboard (when the site's key may not make one): used as it is.
  const byHand = String(input.promo_id || "").trim();
  if (/^promo_[A-Za-z0-9]{4,64}$/.test(byHand)) {
    await env.DB.prepare("UPDATE creators SET promo_id = ?, promo_code = ?, stripe_error = NULL WHERE code = ?")
      .bind(byHand, code.toUpperCase().replace(/[^A-Z0-9]/g, ""), code).run();
    return { creator: await creatorRow(env, code) };
  }
  return { creator: await syncPromo(env, await creatorRow(env, code)) };
}

// Retire a creator's link (or bring it back): a retired link no longer brings anyone, and its Stripe code is switched
// off; friends it brought before still earn for it.
export async function retireCreator(env, code, retire = true) {
  await setupReferrals(env);
  const creator = await creatorRow(env, code);
  if (!creator) return false;
  const at = retire ? iso() : null;
  await env.DB.batch([
    env.DB.prepare("UPDATE creators SET retired = ? WHERE code = ?").bind(at, code),
    env.DB.prepare("UPDATE share_codes SET retired = ? WHERE code = ?").bind(at, code),
  ]);
  if (creator.promo_id && env.STRIPE_SECRET_KEY) {
    try { await stripe(env, "POST", `promotion_codes/${encodeURIComponent(creator.promo_id)}`, { active: !retire }); }
    catch (e) { console.warn(`referrals: creator ${code}'s Stripe code: ${e?.message || e}`); }
  }
  return true;
}

// "Mark paid": everything owed to the creator so far is paid out now. How many cents that was.
export async function markPaidOut(env, code, now = new Date()) {
  await setupReferrals(env);
  const row = await env.DB.prepare("SELECT COALESCE(SUM(share_cents), 0) AS cents FROM creator_earnings WHERE creator = ? " +
    "AND paid_out IS NULL").bind(code).first();
  await env.DB.prepare("UPDATE creator_earnings SET paid_out = ? WHERE creator = ? AND paid_out IS NULL")
    .bind(iso(now.getTime()), code).run();
  return row?.cents || 0;
}

// A paid invoice (the webhook's invoice.paid, functions/api/billing/[action].js): the friend's first payment is noted
// on their referral, and when a creator brought them (their link, or their code typed at checkout) and it's within the
// creator's `months` from that first payment, the creator's share of it is kept, once per invoice. What was paid is
// the invoice's amount_paid without its tax. Throws when Stripe or D1 fails, so Stripe sends the event again.
export async function notePayment(env, invoice) {
  if (!invoice?.id || !(invoice.amount_paid > 0)) return { skipped: "nothing paid" };
  await setupReferrals(env);
  await setupBilling(env);
  const account = await env.DB.prepare("SELECT user_id FROM entitlements WHERE customer_id = ?")
    .bind(idOf(invoice.customer)).first();
  if (!account) return { skipped: "no account" };
  const userId = account.user_id;
  const paidAt = (invoice.status_transitions?.paid_at || invoice.created || Date.now() / 1000) * 1000;
  let ref = await env.DB.prepare("SELECT * FROM referrals WHERE user_id = ?").bind(userId).first();
  // A creator's code typed at checkout: the invoice's discount names their promotion code.
  if (!ref?.creator && (invoice.discounts || []).length) {
    const full = await stripe(env, "GET", `invoices/${encodeURIComponent(invoice.id)}`, { expand: ["discounts"] });
    for (const d of full.discounts || []) {
      const creator = await env.DB.prepare("SELECT code FROM creators WHERE promo_id = ?").bind(idOf(d?.promotion_code)).first();
      if (!creator) continue;
      const sub = (await starterClaim(env, userId)) || `user:${userId}`;
      await env.DB.batch([
        env.DB.prepare("INSERT OR IGNORE INTO referrals (user_id, code, kind, creator, sub_hash, created) VALUES (?, ?, 'creator', ?, ?, ?)")
          .bind(userId, creator.code, creator.code, sub, iso(paidAt)),
        env.DB.prepare("UPDATE referrals SET creator = ? WHERE user_id = ? AND creator IS NULL").bind(creator.code, userId),
      ]);
      ref = await env.DB.prepare("SELECT * FROM referrals WHERE user_id = ?").bind(userId).first();
      break;
    }
  }
  if (!ref) return { skipped: "nobody shared" };
  if (!ref.paid) await env.DB.prepare("UPDATE referrals SET paid = ? WHERE user_id = ? AND paid IS NULL")
    .bind(iso(paidAt), userId).run();
  const creator = ref.creator ? await creatorRow(env, ref.creator) : null;
  if (!creator) return { skipped: "no creator" };
  const first = new Date(ref.paid ? Date.parse(ref.paid) : paidAt);
  const end = new Date(first);
  end.setUTCMonth(end.getUTCMonth() + creator.months);
  if (paidAt >= end.getTime()) return { skipped: "past the creator's months" };
  const taxes = Array.isArray(invoice.total_taxes) ? invoice.total_taxes.reduce((a, t) => a + (t?.amount || 0), 0)
    : Number(invoice.tax) || 0;
  const paid = Math.max(0, invoice.amount_paid - taxes);
  const share = Math.round(paid * creator.share_pct / 100);
  await env.DB.prepare("INSERT OR IGNORE INTO creator_earnings (invoice_id, creator, user_id, paid_cents, share_cents, pct, " +
    "paid_at, recorded) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(invoice.id, creator.code, userId, paid, share,
    creator.share_pct, iso(paidAt), iso()).run();
  return { creator: creator.code, paid, share };
}

// /admin's Creators tab: each creator with their link's clicks, the players it brought who connected Willo, those who
// went on to pay, and what they've earned, still owe and have been paid (US cents); and the players' own sharing:
// friends counted this calendar month and ever, and the answers they gave.
export async function referralReport(env, origin, now = new Date()) {
  await setupReferrals(env);
  const month = iso(now.getTime()).slice(0, 7);
  const [{ results: creators }, players] = await Promise.all([
    env.DB.prepare(
      "SELECT c.*, s.clicks, (SELECT COUNT(*) FROM referrals r WHERE r.creator = c.code) AS joined, " +
      "(SELECT COUNT(*) FROM referrals r WHERE r.creator = c.code AND r.paid IS NOT NULL) AS paying, " +
      "(SELECT COALESCE(SUM(share_cents), 0) FROM creator_earnings e WHERE e.creator = c.code) AS earned, " +
      "(SELECT COALESCE(SUM(share_cents), 0) FROM creator_earnings e WHERE e.creator = c.code AND e.paid_out IS NULL) AS owed, " +
      "(SELECT COALESCE(SUM(paid_cents), 0) FROM creator_earnings e WHERE e.creator = c.code) AS brought " +
      "FROM creators c LEFT JOIN share_codes s ON s.code = c.code ORDER BY c.created DESC").all(),
    env.DB.prepare("SELECT COUNT(*) AS friends, COALESCE(SUM(substr(created, 1, 7) = ?), 0) AS month, " +
      "COALESCE(SUM(answers), 0) AS answers, COALESCE(SUM(paid IS NOT NULL), 0) AS paying, " +
      "COUNT(DISTINCT sharer_id) AS sharers FROM referrals WHERE kind = 'player'").bind(month).first(),
  ]);
  return { creators: creators.map(c => ({ ...c, url: shareUrl(origin, c.code) })), players };
}
