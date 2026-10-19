// Inviting friends and the creator program (Share Willo: LOR-253, LOR-503, CC-72; Patrick's spec, Coaching 74,
// 2026-10-16, LOR-617). Two loops, kept apart: players invite friends and earn product (answers, a free month);
// approved creators bring subscribers and earn cash.
//
// Players. Every player has a link of their own, loreforeverwow.com/w/<code>, shown in Willo's window (Settings and
// the Friends tab), on /account's Willo tab and on their own profile. Only the player who invites earns: a friend
// gets nothing for joining, and earns the same way, by inviting theirs. A friend is "joined" when their account is made
// in a browser that opened the link in the last COOKIE_DAYS days (functions/api/auth/[action].js noteJoin), or, for
// an account that had never used Willo, when it first connects Willo there (functions/api/device/[action].js
// noteConnect); "activated" once Willo has given them a first real answer (functions/api/companion/answer.js
// activateReferral), never on a click. Activated friends move the inviter on (REWARDS): each is a tenth of a free
// month, the fifth of each ten gives bonus answers (answer_packs kind 'share', lib/billing.js useShare), and the tenth
// a free month of their plan (Hero on the free plan; lib/billing.js giveFreeMonth: a Stripe credit for a paying plan,
// a month on us otherwise), each once (referral_rewards), with no manual step. The free month counts activated
// friends, not paying ones (REWARDS.monthCounts, "paid" to change it): paying friends would put it out of reach of a
// mostly free player base, and the guards below plus a bounded reward (a month, at most one a month) make abusing it
// more work than it's worth.
//
// The guards (a friend that fails one is kept as void, with the reason, and counts for nothing): once per Google
// account, ever (sub_hash, kept after "Delete my account"); never the inviter's own account or link; not an account
// that used Willo before; not a throwaway address (DISPOSABLE); not a browser the inviter signed in with, or that
// already brought them a friend (browser_seen, the lf_b cookie); not a computer the inviter's Willo runs on, or one
// another friend was activated on (devices.machine, X-LF-Machine: Willo's one-way code for the computer); not paid
// for with the inviter's card (its Stripe fingerprint); and at most REWARDS.perMonth friends count in a calendar month.
//
// Creators (LOR-503, CC-72). Creators apply on /creators (applyCreator) and /admin approves them (decideApplication),
// or /admin adds one; each gets a readable link (/w/ziqo) tied to their own account, which opens their dashboard on
// /creators (creatorDashboard). They earn share_pct% (CREATOR_DEFAULTS: 70) of what each subscriber they brought pays
// in their first paid month (months: 1), without tax (notePayment); later months are ours. A first month is the first
// invoice for a whole month (a beta checkout's few half-price days before it count too, and so does an upgrade within
// it). Each paid invoice is a row in creator_earnings, payable PAYOUTS.holdDays after it was paid; a refund or a
// dispute of it takes it back (reverseCommission), from the next payout if it was paid out already. Once a month the
// payout list (payoutList) has every creator owed at least PAYOUTS.minimumCents: /admin pays them by hand ("Mark paid")
// or, once Mike has Stripe Connect and switches "Stripe payouts" on (referral_settings stripe_payouts), with a Stripe
// transfer to the Express account the creator set up from their dashboard (startConnect, payCreator). Their audience
// gets a discount or answers only when /admin gives that creator some (discount, gift; none by default). The creator
// terms are on /creators; anything legal is Mike's to look over.
//
// The tables (made by setupReferrals; "Delete my account" removes or strips the account's rows, REFERRAL_USER_DATA):
// share_codes: every code, one live player code per account (retired: when "New link" replaced it; a retired code
//   still credits friends who opened it before, but /w/ no longer takes it). kind 'player' (user_id) or 'creator'.
//   clicks: how often /w/<code> was opened (not by link-preview bots).
// referrals: one row per friend (user_id), the code that brought them, the account that shared it (sharer_id) or the
//   creator, the friend's one-way Google code (sub_hash, so once per Google account), via ('signup', 'connect', or
//   NULL: counted at a Willo connect before activation, 10/16-18), connected (Willo signed in), activated (her first
//   real answer), counted (1: it moves the inviter on), void (why it doesn't count), browser and machine (one-way
//   codes), card (a one-way code of the first payment's card), paid (their first payment), first_month (when their
//   first whole paid month started), answers (what the sharer got for it before 10/18).
// referral_rewards: each reward a player earned (id "bonus:<user>:<n>" or "month:<user>:<n>"), applied once.
// creators: a creator's terms, their account (user_id), Stripe promotion code (promo_id) and Connect account.
// creator_applications: who asked to join the program, and what /admin decided.
// creator_earnings: per paid invoice of a player a creator brought: what was paid (before Stripe's fees, without
//   tax), the creator's share, when it's payable, reversed (refunded or disputed), and the payout that paid it.
// creator_payouts: each payout, by hand or by Stripe transfer.
// referral_settings: stripe_payouts ("on" once Stripe Connect is set up). browser_seen: one-way browser codes and the
//   accounts signed in with them (lib/accounts.js startSession's sign-ins, noteBrowser).

import { PLANS, PAID, setupBilling, starterClaim, planIdNow, billedPlan, promoClaimed, stripe, giveFreeMonth } from "./billing.js";
import { COMPANION_NAME } from "./brand.js";

// ---- The rules (Patrick's example; the numbers are Mike's to change, here) ----

export const REWARDS = {
  monthAt: 10,               // activated friends for a free month of the inviter's plan
  bonusAt: 5,                // in each ten, the friend that gives bonus answers
  bonusPercent: 50,          // the bonus: this share of the plan's month of answers (Free 300, Hero 450, Champion 950)
  freePlanMonth: "hero",     // the free month of a player on the free plan
  monthCounts: "activated",  // what moves the free month on: "activated" friends, or only those who "paid" a month
  perMonth: 10,              // friends who count in one calendar month, at most (so at most one free month a month)
};
// A creator's terms unless /admin says otherwise: their audience gets nothing extra (discount, gift), and they get
// sharePct% of each subscriber's first `months` paid months.
export const CREATOR_DEFAULTS = { discount: 0, sharePct: 70, months: 1, gift: 0 };
// Payouts: a commission is payable holdDays after its invoice was paid (refunds and disputes come first), and a
// creator is paid once at least minimumCents is payable (less carries over to the next month).
export const PAYOUTS = { holdDays: 30, minimumCents: 1000 };
// What a free month's bonus is, by the inviter's plan.
export const bonusAnswersFor = planId => Math.round((PLANS[planId] || PLANS.free).answersPerMonth * REWARDS.bonusPercent / 100);

export const COOKIE = "lf_share";
export const COOKIE_DAYS = 30;
export const BROWSER_COOKIE = "lf_b";
// Player codes: CODE_LENGTH letters from an alphabet without look-alikes (no 0, o, 1, l); about 34 billion codes.
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const CODE_LENGTH = 7;
export const PLAYER_CODE = /^[a-km-np-z2-9]{7}$/;
// Creator codes: what /admin types, readable: "ziqo", "lore-nerd".
export const CREATOR_CODE = /^[a-z0-9][a-z0-9-]{1,23}$/;
const anyCode = code => typeof code === "string" && (PLAYER_CODE.test(code) || CREATOR_CODE.test(code));
// Throwaway addresses (the common services; a Google account can be made with any address).
const DISPOSABLE = new Set(["mailinator.com", "guerrillamail.com", "guerrillamail.net", "sharklasers.com", "grr.la",
  "10minutemail.com", "temp-mail.org", "tempmail.com", "tempmailo.com", "yopmail.com", "trashmail.com", "getnada.com",
  "dispostable.com", "maildrop.cc", "throwawaymail.com", "fakeinbox.com", "mintemail.com", "mohmal.com", "emailondeck.com",
  "moakt.com", "burnermail.io", "tempr.email", "discard.email", "mailnesia.com", "spamgourmet.com", "mailpoof.com"]);

const DAY_MS = 86400e3;
const iso = (ms = Date.now()) => new Date(ms).toISOString();
const idOf = v => typeof v === "string" ? v : typeof v?.id === "string" ? v.id : null;
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
const oneWay = async (kind, value) =>
  hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`lf-${kind}:${value}`))).slice(0, 32);

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
  `CREATE TABLE IF NOT EXISTS referral_rewards (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL,
    cycle INTEGER NOT NULL, status TEXT NOT NULL, method TEXT, plan TEXT, answers INTEGER, cents INTEGER, stripe_id TEXT,
    starts TEXT, ends TEXT, error TEXT, created TEXT NOT NULL, tried TEXT NOT NULL, applied TEXT)`,
  "CREATE INDEX IF NOT EXISTS referral_rewards_user ON referral_rewards (user_id)",
  `CREATE TABLE IF NOT EXISTS creator_applications (id TEXT PRIMARY KEY, user_id TEXT, name TEXT NOT NULL,
    channel TEXT NOT NULL, audience TEXT, contact TEXT, note TEXT, status TEXT NOT NULL DEFAULT 'pending', code TEXT,
    created TEXT NOT NULL, decided TEXT)`,
  "CREATE INDEX IF NOT EXISTS creator_applications_user ON creator_applications (user_id)",
  `CREATE TABLE IF NOT EXISTS creator_payouts (id TEXT PRIMARY KEY, creator TEXT NOT NULL, month TEXT NOT NULL,
    cents INTEGER NOT NULL, items INTEGER NOT NULL, method TEXT NOT NULL, status TEXT NOT NULL, transfer_id TEXT,
    error TEXT, note TEXT, created TEXT NOT NULL, paid_at TEXT)`,
  "CREATE INDEX IF NOT EXISTS creator_payouts_creator ON creator_payouts (creator, created)",
  "CREATE TABLE IF NOT EXISTS referral_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated TEXT NOT NULL)",
  `CREATE TABLE IF NOT EXISTS browser_seen (browser TEXT NOT NULL, user_id TEXT NOT NULL, day TEXT NOT NULL,
    PRIMARY KEY (browser, user_id))`,
  "CREATE INDEX IF NOT EXISTS browser_seen_user ON browser_seen (user_id)",
];
// Columns added after their tables were first made (each fails once it exists), then their indexes.
const MIGRATE = ["referrals via TEXT", "referrals connected TEXT", "referrals activated TEXT",
  "referrals counted INTEGER NOT NULL DEFAULT 0", "referrals void TEXT", "referrals browser TEXT", "referrals machine TEXT",
  "referrals card TEXT", "referrals first_month TEXT", "creators user_id TEXT", "creators channel TEXT",
  "creators connect_id TEXT", "creators connect_ready INTEGER NOT NULL DEFAULT 0", "creators connect_country TEXT",
  "creator_earnings payable_at TEXT", "creator_earnings reversed TEXT", "creator_earnings reversed_why TEXT",
  "creator_earnings payout_id TEXT", "creator_earnings clawed TEXT", "devices machine TEXT"]
  .map(s => { const [table, ...column] = s.split(" "); return `ALTER TABLE ${table} ADD COLUMN ${column.join(" ")}`; });
const INDEXES = ["CREATE INDEX IF NOT EXISTS referrals_machine ON referrals (machine)",
  "CREATE INDEX IF NOT EXISTS referrals_browser ON referrals (browser)",
  "CREATE INDEX IF NOT EXISTS creators_user ON creators (user_id)",
  "CREATE INDEX IF NOT EXISTS creator_earnings_payout ON creator_earnings (payout_id)",
  "CREATE INDEX IF NOT EXISTS devices_machine ON devices (machine)"];
// Once (referral_settings "schema"): friends counted at their first Willo connect before 10/18 were connected then,
// activated by the first question they asked (answer_days, when it's still kept), and their first month started with
// their first payment; earnings from before the hold are payable as they were.
const SCHEMA = "2";
const BACKFILL = [
  "UPDATE referrals SET connected = created WHERE via IS NULL AND connected IS NULL",
  "UPDATE referrals SET activated = (SELECT MIN(day) FROM answer_days a WHERE a.user_id = referrals.user_id) || " +
    "'T00:00:00.000Z', counted = (kind = 'player') WHERE via IS NULL AND activated IS NULL AND " +
    "EXISTS (SELECT 1 FROM answer_days a WHERE a.user_id = referrals.user_id)",
  "UPDATE referrals SET first_month = paid WHERE via IS NULL AND paid IS NOT NULL AND first_month IS NULL",
  "UPDATE creator_earnings SET payable_at = paid_at WHERE payable_at IS NULL",
];
const ready = new WeakMap();
export function setupReferrals(env) {
  if (!ready.has(env.DB)) ready.set(env.DB, (async () => {
    await setupBilling(env);
    await env.DB.batch(SETUP.map(s => env.DB.prepare(s)));
    await Promise.all(MIGRATE.map(sql => env.DB.prepare(sql).run().catch(() => {})));
    await Promise.all(INDEXES.map(sql => env.DB.prepare(sql).run().catch(() => {})));
    const fresh = await env.DB.prepare("INSERT OR IGNORE INTO referral_settings (key, value, updated) VALUES ('schema', ?, ?)")
      .bind(SCHEMA, iso()).run();
    if (fresh.meta.changes) {
      for (const sql of BACKFILL) await env.DB.prepare(sql).run().catch(e => console.warn(`referrals: backfill: ${e?.message || e}`));
    }
  })().catch(e => { ready.delete(env.DB); throw e; }));
  return ready.get(env.DB);
}

// "Delete my account" (lib/accounts.js USER_DATA): their codes go (their link stops working), the answers friends gave
// them go with their packs, and their rewards and free months with them; a friend row that's theirs stays without the
// account, for the counts and a creator's earnings, keeping only the one-way Google code (so coming back doesn't count
// again); a row they shared keeps the friend but not them. A creator's record stays, without the account.
export const REFERRAL_USER_DATA = [
  ["DELETE FROM share_codes WHERE user_id = ? AND kind = 'player'", u => u.id],
  ["UPDATE referrals SET user_id = 'gone:' || lower(hex(randomblob(8))) WHERE user_id = ?", u => u.id],
  ["UPDATE referrals SET sharer_id = NULL WHERE sharer_id = ?", u => u.id],
  ["UPDATE creator_earnings SET user_id = NULL WHERE user_id = ?", u => u.id],
  ["DELETE FROM referral_rewards WHERE user_id = ?", u => u.id],
  ["DELETE FROM plan_grants WHERE user_id = ?", u => u.id],
  ["DELETE FROM creator_applications WHERE user_id = ?", u => u.id],
  ["UPDATE creators SET user_id = NULL WHERE user_id = ?", u => u.id],
  ["DELETE FROM browser_seen WHERE user_id = ?", u => u.id],
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

// Who a code is: {code, kind, userId (a player's, or the creator's own account), name (what the page may show: a
// player's public profile's character name, or a creator's name; null for a player without a public profile), creator
// (a creator's terms)}, or null when there's no such code, or it's retired (unless `retired`: a friend who opened it
// before it was retired still counts).
export async function codeOwner(env, code, { retired = false } = {}) {
  code = String(code || "").toLowerCase();
  if (!anyCode(code)) return null;
  await setupReferrals(env);
  const row = await env.DB.prepare("SELECT * FROM share_codes WHERE code = ?").bind(code).first();
  if (!row || (row.retired && !retired)) return null;
  if (row.kind === "creator") {
    const creator = await creatorRow(env, code);
    if (!creator || (creator.retired && !retired)) return null;
    return { code, kind: "creator", userId: creator.user_id || null, name: creator.name, creator };
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

// /w/<code> opened (not by a bot): one more click on the code, for /admin and the creator's dashboard.
export async function noteClick(env, code) {
  await setupReferrals(env);
  await env.DB.prepare("UPDATE share_codes SET clicks = clicks + 1 WHERE code = ?").bind(code).run();
}

const secure = request => new URL(request.url).protocol === "https:" ? "; Secure" : "";
// The cookie /w/<code> sets: the code, for the friend's sign-up or first Willo connect.
export const shareCookie = (request, code) =>
  `${COOKIE}=${code}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_DAYS * 86400}` + secure(request);

function cookieValue(request, name) {
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}
function cookieCode(request) {
  const code = String(cookieValue(request, COOKIE) || "").toLowerCase();
  return anyCode(code) ? code : null;
}
const browserOf = async request => {
  const id = cookieValue(request, BROWSER_COOKIE);
  return /^[a-f0-9]{32}$/.test(id || "") ? oneWay("browser", id) : null;
};

// A sign-in (functions/api/auth/[action].js): the browser's own random code (the lf_b cookie, made the first time)
// is noted with the account, one-way, so a friend joining from a browser the inviter signed in with doesn't count.
// The cookie to set (a new browser's), or null. Never throws.
export async function noteBrowser(env, request, userId, now = new Date()) {
  try {
    await setupReferrals(env);
    let id = cookieValue(request, BROWSER_COOKIE), cookie = null;
    if (!/^[a-f0-9]{32}$/.test(id || "")) {
      id = hex(crypto.getRandomValues(new Uint8Array(16)));
      cookie = `${BROWSER_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${400 * 86400}` + secure(request);
    }
    await env.DB.prepare("INSERT INTO browser_seen (browser, user_id, day) VALUES (?, ?, ?) " +
      "ON CONFLICT(browser, user_id) DO UPDATE SET day = excluded.day").bind(await oneWay("browser", id), userId,
      iso(now.getTime()).slice(0, 10)).run();
    return cookie;
  } catch (e) {
    console.warn(`referrals: browser: ${e?.message || e}`);
    return null;
  }
}

// ---- Counting a friend ----

// Why a friend joining from this browser doesn't count, or null (the guards that can be seen at the start).
async function joinGuard(env, { user, owner, browser }) {
  const domain = String(user.email || "").split("@")[1]?.toLowerCase();
  if (domain && DISPOSABLE.has(domain)) return "throwaway address";
  if (!browser) return null;
  const row = await env.DB.prepare("SELECT " +
    "EXISTS (SELECT 1 FROM browser_seen WHERE browser = ? AND user_id = ?) AS inviter, " +
    "EXISTS (SELECT 1 FROM referrals WHERE browser = ? AND user_id != ? AND void IS NULL AND " +
    "(sharer_id = ? OR creator = ?)) AS other").bind(browser, owner.userId || "", browser, user.id, owner.userId || "",
    owner.creator?.code ?? "").first();
  return row?.inviter ? "inviter's browser" : row?.other ? "browser of another friend" : null;
}

async function insertFriend(env, request, user, owner, code, via, at) {
  const sub = (await starterClaim(env, user.id)) || `user:${user.id}`;
  const browser = await browserOf(request);
  const made = await env.DB.prepare(
    "INSERT OR IGNORE INTO referrals (user_id, code, kind, sharer_id, creator, sub_hash, created, via, connected, browser) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(user.id, code, owner.kind, owner.kind === "player" ? owner.userId : null,
    owner.creator?.code ?? null, sub, at, via, via === "connect" ? at : null, browser).run();
  if (!made.meta.changes) return null;
  const why = await joinGuard(env, { user, owner, browser });
  if (why) await env.DB.prepare("UPDATE referrals SET void = ? WHERE user_id = ?").bind(why, user.id).run();
  return { kind: owner.kind, void: why };
}

// The link's owner, for an account in this browser, or null when it can't be their friend: no link opened, or it's
// their own (their link, or the creator they are).
async function ownerFor(env, request, user) {
  const code = cookieCode(request);
  if (!code) return null;
  const owner = await codeOwner(env, code, { retired: true });
  return owner && owner.userId !== user.id ? owner : null;
}

// A new account (functions/api/auth/[action].js google), made in a browser that opened a share link: the link's friend,
// joined (not counted yet). {kind, void}, or null.
export async function noteJoin(env, request, user, now = new Date()) {
  const owner = await ownerFor(env, request, user);
  if (!owner) return null;
  await setupReferrals(env);
  return insertFriend(env, request, user, owner, owner.code, "signup", iso(now.getTime()));
}

// An account connecting Willo (functions/api/device/[action].js approve). A friend who joined already is connected
// now (and a creator's gift, if /admin gave that creator one, goes to them). Otherwise, an account new to Willo
// (nothing connected and no question asked of her before) in a browser that opened a share link joins as its friend
// here. {kind, void, gift}, or null.
export async function noteConnect(env, request, user, now = new Date()) {
  await setupReferrals(env);
  const at = iso(now.getTime());
  let row = await env.DB.prepare("SELECT * FROM referrals WHERE user_id = ?").bind(user.id).first();
  if (row) {
    const first = await env.DB.prepare("UPDATE referrals SET connected = ? WHERE user_id = ? AND connected IS NULL")
      .bind(at, user.id).run();
    return first.meta.changes ? { kind: row.kind, void: row.void, gift: await creatorGift(env, row, at) } : null;
  }
  const owner = await ownerFor(env, request, user);
  if (!owner) return null;
  const used = await env.DB.prepare("SELECT EXISTS (SELECT 1 FROM devices WHERE user_id = ?) OR " +
    "EXISTS (SELECT 1 FROM answer_days WHERE user_id = ?) AS y").bind(user.id, user.id).first();
  if (used?.y) return null;
  const made = await insertFriend(env, request, user, owner, owner.code, "connect", at);
  if (!made) return null;
  row = await env.DB.prepare("SELECT * FROM referrals WHERE user_id = ?").bind(user.id).first();
  return { ...made, gift: await creatorGift(env, row, at) };
}

// A creator's gift to their audience (none unless /admin gave the creator one), once, when the friend connects Willo.
async function creatorGift(env, row, at) {
  if (row?.kind !== "creator" || row.void || !row.creator) return 0;
  const creator = await creatorRow(env, row.creator);
  const gift = creator?.gift || 0;
  if (gift > 0) await env.DB.prepare("INSERT OR IGNORE INTO answer_packs (id, user_id, kind, answers, remaining, created) " +
    "VALUES (?, ?, 'share', ?, ?, ?)").bind(`gift:${row.user_id}`, row.user_id, gift, gift, at).run();
  return gift;
}

// Accounts known to have nothing to activate (no friend row, or one activated or void already), so most answers skip
// the read; and the devices whose computer is noted.
const settled = new WeakMap(), noted = new WeakMap();
const KEPT = 5000;
const remember = (map, env, id) => {
  if (!map.has(env.DB)) map.set(env.DB, new Set());
  const set = map.get(env.DB);
  if (set.size >= KEPT) set.clear();
  set.add(id);
};
const known = (map, env, id) => Boolean(map.get(env.DB)?.has(id));
// Willo's one-way code for the computer she runs on (the X-LF-Machine header), one-way again, or null.
export const machineOf = request => {
  const sent = String(request?.headers?.get("X-LF-Machine") || "").toLowerCase();
  return /^[a-f0-9]{32,64}$/.test(sent) ? oneWay("machine", sent) : Promise.resolve(null);
};

// A real answer from Willo (functions/api/companion/answer.js, after the reply is on its way): the device's computer is
// noted, and the account's friend row, when it has one waiting, is activated, unless the computer is the inviter's or
// another activated friend's. An activated player friend counts (at most REWARDS.perMonth a calendar month, in one
// statement so two at once can't both be the eleventh), and the inviter's rewards follow (settleRewards).
// {activated, counted, void}, or null when there was nothing to do.
export async function activateReferral(env, { userId, deviceId = null, machine = null }, now = new Date()) {
  if (deviceId && machine && !known(noted, env, deviceId)) {
    await setupReferrals(env);
    await env.DB.prepare("UPDATE devices SET machine = ? WHERE id = ? AND (machine IS NULL OR machine != ?)")
      .bind(machine, deviceId, machine).run();
    remember(noted, env, deviceId);
  }
  if (!userId || known(settled, env, userId)) return null;
  await setupReferrals(env);
  const row = await env.DB.prepare("SELECT r.*, c.user_id AS creator_user FROM referrals r LEFT JOIN creators c " +
    "ON c.code = r.creator WHERE r.user_id = ?").bind(userId).first();
  if (!row || row.activated || row.void) { remember(settled, env, userId); return null; }
  const at = iso(now.getTime()), inviter = row.sharer_id || row.creator_user || "";
  if (machine) {
    const seen = await env.DB.prepare("SELECT " +
      "EXISTS (SELECT 1 FROM devices WHERE user_id = ? AND machine = ?) AS inviter, " +
      "EXISTS (SELECT 1 FROM referrals WHERE machine = ? AND user_id != ? AND activated IS NOT NULL AND void IS NULL) AS other")
      .bind(inviter, machine, machine, userId).first();
    const why = seen?.inviter ? "inviter's computer" : seen?.other ? "computer of another friend" : null;
    if (why) {
      await env.DB.prepare("UPDATE referrals SET void = ?, machine = ? WHERE user_id = ? AND activated IS NULL")
        .bind(why, machine, userId).run();
      remember(settled, env, userId);
      return { activated: false, counted: false, void: why };
    }
  }
  await env.DB.prepare("UPDATE referrals SET activated = ?, machine = COALESCE(?, machine), connected = COALESCE(connected, ?), " +
    "counted = CASE WHEN kind = 'player' AND (SELECT COUNT(*) FROM referrals r WHERE r.sharer_id = referrals.sharer_id " +
    "AND r.counted = 1 AND substr(r.activated, 1, 7) = ?) < ? THEN 1 ELSE 0 END " +
    "WHERE user_id = ? AND activated IS NULL AND void IS NULL")
    .bind(at, machine, at, at.slice(0, 7), REWARDS.perMonth, userId).run();
  remember(settled, env, userId);
  const after = await env.DB.prepare("SELECT counted, sharer_id FROM referrals WHERE user_id = ?").bind(userId).first();
  if (after?.counted && after.sharer_id) await settleRewards(env, after.sharer_id, now);
  return { activated: true, counted: Boolean(after?.counted), void: null };
}

// ---- Rewards ----

// Where the inviter is: friends (counted ever), paid (of those, who paid a first month), toward (what moves the free
// month on, REWARDS.monthCounts), and in the current ten: have, left (until the next free month), bonusLeft (until its
// bonus; 0 once it's earned), months (free months earned).
export function progressOf({ friends = 0, paid = 0 } = {}) {
  const r = REWARDS, toward = r.monthCounts === "paid" ? paid : friends;
  const have = toward % r.monthAt, inTen = friends % r.monthAt;
  return { friends, paid, toward, have, goal: r.monthAt, left: r.monthAt - have,
           bonusAt: r.bonusAt, bonusLeft: Math.max(0, r.bonusAt - inTen), months: Math.floor(toward / r.monthAt) };
}

// The rewards `counts` (progressOf's) have earned: the bonus of each ten reached (bonus:<user>:<n>, from 0) and each
// free month (month:<user>:<n>, from 1).
function earned(userId, counts) {
  const r = REWARDS, out = [];
  for (let k = 0; k * r.monthAt + r.bonusAt <= counts.friends; k++) out.push({ id: `bonus:${userId}:${k}`, kind: "bonus", cycle: k });
  for (let k = 1; k * r.monthAt <= counts.toward; k++) out.push({ id: `month:${userId}:${k}`, kind: "month", cycle: k });
  return out;
}

const countsSql = "SELECT COALESCE(SUM(counted), 0) AS friends, COALESCE(SUM(counted AND paid IS NOT NULL), 0) AS paid " +
  "FROM referrals WHERE sharer_id = ? AND void IS NULL";
// A reward tried and not finished (a Worker cut off mid-way) is tried again after this long; Stripe's idempotency key
// keeps a credit from being made twice.
const STUCK_MS = 10 * 60e3;

// Gives the inviter every reward their friends have earned and they don't have yet, each once: a reward is claimed
// (its row, 'pending') before it's given, so two settles at once give it once, and one that failed is tried again on
// the next settle (the share card's next look). The rewards given now.
export async function settleRewards(env, userId, now = new Date()) {
  await setupReferrals(env);
  const counts = progressOf(await env.DB.prepare(countsSql).bind(userId).first() || {});
  const want = earned(userId, counts);
  if (!want.length) return [];
  const { results: have } = await env.DB.prepare("SELECT id, status, tried FROM referral_rewards WHERE user_id = ?").bind(userId).all();
  const at = iso(now.getTime()), given = [];
  for (const r of want) {
    const old = have.find(h => h.id === r.id);
    if (old?.status === "applied") continue;
    const claim = old
      ? await env.DB.prepare("UPDATE referral_rewards SET status = 'pending', tried = ?, error = NULL WHERE id = ? AND " +
          "(status = 'failed' OR (status = 'pending' AND tried < ?))").bind(at, r.id, iso(now.getTime() - STUCK_MS)).run()
      : await env.DB.prepare("INSERT OR IGNORE INTO referral_rewards (id, user_id, kind, cycle, status, created, tried) " +
          "VALUES (?, ?, ?, ?, 'pending', ?, ?)").bind(r.id, userId, r.kind, r.cycle, at, at).run();
    if (!claim.meta.changes) continue;
    try {
      const out = r.kind === "bonus" ? await giveBonus(env, userId, r.id, now)
        : await giveFreeMonth(env, userId, { id: r.id, freePlan: REWARDS.freePlanMonth, now,
            description: `A free month: ${REWARDS.monthAt * r.cycle} friends joined ${COMPANION_NAME} with your link` });
      await env.DB.prepare("UPDATE referral_rewards SET status = 'applied', method = ?, plan = ?, answers = ?, cents = ?, " +
        "stripe_id = ?, starts = ?, ends = ?, applied = ? WHERE id = ?").bind(out.method, out.plan || null,
        out.answers ?? null, out.cents ?? null, out.stripeId || null, out.starts || null, out.ends || null, at, r.id).run();
      given.push({ ...r, ...out });
    } catch (e) {
      console.warn(`referrals: reward ${r.id}: ${e?.message || e}`);
      await env.DB.prepare("UPDATE referral_rewards SET status = 'failed', error = ? WHERE id = ?")
        .bind(String(e?.message || e).slice(0, 300), r.id).run();
    }
  }
  return given;
}

// The bonus: REWARDS.bonusPercent of the inviter's plan's month, as answers that keep until they're used (after the
// plan's own: lib/billing.js useShare). A free player's are paid from the shared monthly budget like the starter.
async function giveBonus(env, userId, id, now) {
  const plan = await planIdNow(env, userId, now), answers = bonusAnswersFor(plan);
  await env.DB.prepare("INSERT OR IGNORE INTO answer_packs (id, user_id, kind, answers, remaining, created) " +
    "VALUES (?, ?, 'share', ?, ?, ?)").bind(id, userId, answers, answers, iso(now.getTime())).run();
  return { method: "answers", plan, answers };
}

// ---- What the inviter sees ----

const plural = (n, one, many = one + "s") => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const usd = cents => `$${(cents / 100).toFixed(2)}`;
const longDay = iso => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

// The invite card's words, here so Willo's window, /account and the profile say the same. In Willo's world for the
// invitation (invite, grows); plain for what it gives (about) and where they are (tally: Patrick's "7 / 10 friends
// joined — 3 more until your next month is free"), and for what they've earned and who's still to ask (earned,
// waiting). s: shareSummary's; planId: the inviter's plan now.
export function shareWords(s, planId, billed = null, now = new Date()) {
  const r = REWARDS, p = s.progress;
  const freeName = PLANS[billed?.plan || r.freePlanMonth].name;
  const month = billed?.renews ? `your next month of ${freeName} free, as a credit on your bill` : `a free month of ${freeName}`;
  const counts = r.monthCounts === "paid" ? "sign in to " + COMPANION_NAME + " with your link, ask her a first question and " +
    "pay for a first month" : "sign in to " + COMPANION_NAME + " with your link and ask her a first question";
  const about = `A friend counts once they ${counts}. ${r.bonusAt} friends: ${plural(bonusAnswersFor(planId), "bonus answer")}. ` +
    `${r.monthAt} friends: ${month}. Then it starts again. Up to ${r.perMonth} friends count each month. ` +
    "The reward is yours: friends earn their own by inviting theirs.";
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const tally = `${p.have} / ${p.goal} friends joined — ${p.left} more until ` +
    (billed?.renews ? "your next month is free." : `a free month of ${freeName}.`) +
    (s.month.counted >= r.perMonth ? ` That's this month's ${r.perMonth}; friends who join from ${longDay(next.toISOString())} count again.` : "");
  const months = s.rewards.filter(x => x.kind === "month" && x.status === "applied");
  const bonus = s.rewards.filter(x => x.kind === "bonus" && x.status === "applied").reduce((a, x) => a + (x.answers || 0), 0);
  const earnedWords = [months.length && plural(months.length, "free month"), bonus && plural(bonus, "bonus answer")].filter(Boolean);
  return {
    invite: `Invite a friend to awaken their ${COMPANION_NAME}`,
    grows: `Your ${COMPANION_NAME} grows stronger as your circle grows.`,
    about, tally,
    earned: earnedWords.length ? `You've earned ${earnedWords.join(" and ")} so far.` : "",
    waitingNote: s.waiting ? `${plural(s.waiting, "friend")} joined and ${s.waiting === 1 ? "hasn't" : "haven't"} asked ` +
      `${COMPANION_NAME} anything yet.` : "",
  };
}

// What a reward says on /account: "Free month of Hero, November 4 to December 4" or "$4.99 credit on your bill".
function rewardView(x) {
  const out = { kind: x.kind, status: x.status, when: x.applied || x.created };
  if (x.status !== "applied") return { ...out, text: x.kind === "month" ? "Free month: on its way" : "Bonus answers: on their way" };
  if (x.kind === "bonus") return { ...out, answers: x.answers, text: `${plural(x.answers || 0, "bonus answer")}` };
  if (x.method === "credit") return { ...out, cents: x.cents, text: `A free month of ${PLANS[x.plan]?.name || "your plan"}: ` +
    `${usd(x.cents || 0)} off your next bill` };
  return { ...out, starts: x.starts, ends: x.ends, text: `A free month of ${PLANS[x.plan]?.name || "Hero"}, ` +
    `${longDay(x.starts)} to ${longDay(x.ends)}` };
}

// What the invite card shows (Willo's window, /account, the profile): {code, url, joined (friends who joined, not
// void), waiting (of those, not activated yet), friends (counted), progress (progressOf's), month: {counted, max},
// left (answers from friends and bonuses still to use, a creator's gift included), rewards [{kind, status, text,
// when}], earnedBefore (answers friends gave before 10/18), invite, grows, about, tally, earned, waiting words}. A
// reward that's earned and not given yet (a failure) is given here first.
export async function shareSummary(env, userId, origin, now = new Date()) {
  const code = await shareCode(env, userId);
  const month = iso(now.getTime()).slice(0, 7);
  const read = () => Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS joined, COALESCE(SUM(activated IS NULL), 0) AS waiting, " +
      "COALESCE(SUM(counted), 0) AS friends, COALESCE(SUM(counted AND paid IS NOT NULL), 0) AS paid, " +
      "COALESCE(SUM(counted AND substr(activated, 1, 7) = ?), 0) AS month, COALESCE(SUM(answers), 0) AS answers " +
      "FROM referrals WHERE sharer_id = ? AND void IS NULL").bind(month, userId).first(),
    env.DB.prepare("SELECT * FROM referral_rewards WHERE user_id = ? ORDER BY created, id").bind(userId).all(),
  ]);
  let [row, { results: rewards }] = await read();
  const counts = progressOf(row || {});
  if (earned(userId, counts).some(r => !rewards.some(x => x.id === r.id && x.status === "applied")) &&
      (await settleRewards(env, userId, now)).length) [row, { results: rewards }] = await read();
  const [packs, planId, billed] = await Promise.all([
    env.DB.prepare("SELECT COALESCE(SUM(remaining), 0) AS n FROM answer_packs WHERE user_id = ? AND kind = 'share' " +
      "AND status = 'active'").bind(userId).first(),
    planIdNow(env, userId, now), billedPlan(env, userId, now),
  ]);
  const s = { code, url: shareUrl(origin, code), joined: row?.joined || 0, waiting: row?.waiting || 0,
              friends: row?.friends || 0, progress: progressOf(row || {}), month: { counted: row?.month || 0, max: REWARDS.perMonth },
              left: packs?.n || 0, earnedBefore: row?.answers || 0, rewards };
  return { ...s, rewards: rewards.map(rewardView), ...shareWords(s, planId, billed, now) };
}

// The invite card on the owner's own profile (lib/profiles.js profilePage), with Copy link and New link
// (public/js/profile.js). share: shareSummary's.
export const shareCard = (share, escape) => `<section class="pf-share" aria-labelledby="share-title" data-bar>
    <h2 id="share-title">${escape(share.invite)}</h2>
    <p>${escape(share.grows)}</p>
    <p class="pf-share-tally"><strong data-share-tally>${escape(share.tally)}</strong></p>
    <progress class="invite-bar" max="${share.progress.goal}" value="${share.progress.have}" aria-label="Friends toward your next free month">${share.progress.have} / ${share.progress.goal}</progress>
    <p class="pf-share-link"><code data-share-url>${escape(share.url)}</code>
      <button class="btn-small" type="button" data-share-willo>Copy link</button>
      <button class="btn-small btn-small-alt" type="button" data-new-share>New link</button></p>
    <p class="vp-note">${escape(share.about)}</p>
    <p class="fb-status" role="status" hidden></p>
  </section>`;

// What /willo says above the download for someone a link brought (functions/willo.js): plain words, from the code's
// owner (codeOwner). A creator's says what their audience gets, when /admin gave them anything. HTML, or "".
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
  return `<aside class="w-shared" aria-label="Who sent you"><p>${who} invited you to awaken your own ${COMPANION_NAME}. ` +
    `Once you're in, invite your friends too: ${REWARDS.monthAt} friends who join give you a free month.</p></aside>`;
}

// ---- Creators ----

const creatorRow = (env, code) => env.DB.prepare("SELECT * FROM creators WHERE code = ?").bind(code).first();

// The creator whose link brought this account, for checkout and /plans: {code, name, discount, promoId}, or null.
export async function creatorFor(env, userId) {
  await setupReferrals(env);
  const row = await env.DB.prepare("SELECT c.code, c.name, c.discount, c.promo_id FROM referrals r JOIN creators c " +
    "ON c.code = r.creator WHERE r.user_id = ? AND r.void IS NULL").bind(userId).first();
  return row ? { code: row.code, name: row.name, discount: row.discount, promoId: row.promo_id } : null;
}

// /plans' cards (functions/api/billing/[action].js): a creator's first-month discount on each paid plan that has no
// beta offer for this player (offers: lib/billing.js launchOffers'), while the account hasn't had it. The same shape as
// a beta offer: {price, label, note}. None unless /admin gave the creator a discount.
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

// The account a creator is tied to, by its id (an application's) or its email (/admin's "Account email"): its id,
// undefined to leave it as it is, or {error}.
async function creatorAccount(env, input, code) {
  let userId;
  if (typeof input.user_id === "string" && input.user_id) userId = input.user_id;
  else if (typeof input.account === "string" && input.account.trim()) {
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(input.account.trim().toLowerCase()).first();
    if (!user) return { error: "No account has that email. They sign in on loreforeverwow.com first." };
    userId = user.id;
  } else return undefined;
  const other = await env.DB.prepare("SELECT code FROM creators WHERE user_id = ? AND code != ?").bind(userId, code).first();
  return other ? { error: `That account is ${other.code}'s already.` } : userId;
}

// /admin's "Add creator", its edits and an approved application (functions/api/admin/creators.js): {creator} or
// {error}. A new code must be free (no player or creator has it). Terms left out keep what they were (a new
// creator's: CREATOR_DEFAULTS).
export async function saveCreator(env, input) {
  await setupReferrals(env);
  const code = String(input.code || "").trim().toLowerCase();
  if (!CREATOR_CODE.test(code)) return { error: "A code is 2-24 letters, digits or dashes, like ziqo." };
  const old = await creatorRow(env, code);
  const name = text(input.name, 60) || old?.name;
  if (!name) return { error: "A creator needs a name." };
  const account = await creatorAccount(env, input, code);
  if (account?.error) return account;
  const d = CREATOR_DEFAULTS;
  const row = { code, name, contact: input.contact === undefined ? old?.contact ?? null : text(input.contact, 200) || null,
    discount: whole(input.discount, 0, 100, old?.discount ?? d.discount),
    share_pct: whole(input.share_pct, 0, 100, old?.share_pct ?? d.sharePct),
    months: whole(input.months, 1, 36, old?.months ?? d.months), gift: whole(input.gift, 0, 1000, old?.gift ?? d.gift),
    channel: input.channel === undefined ? old?.channel ?? null : text(input.channel, 200) || null };
  if (!old) {
    const made = await env.DB.prepare("INSERT OR IGNORE INTO share_codes (code, user_id, kind, created) VALUES (?, NULL, 'creator', ?)")
      .bind(code, iso()).run();
    if (!made.meta.changes) return { error: "That code is taken." };
    await env.DB.prepare("INSERT INTO creators (code, name, contact, discount, share_pct, months, gift, channel, created) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(code, row.name, row.contact, row.discount, row.share_pct, row.months,
      row.gift, row.channel, iso()).run();
  } else {
    await env.DB.prepare("UPDATE creators SET name = ?, contact = ?, discount = ?, share_pct = ?, months = ?, gift = ?, " +
      "channel = ? WHERE code = ?").bind(row.name, row.contact, row.discount, row.share_pct, row.months, row.gift,
      row.channel, code).run();
  }
  if (account !== undefined) await env.DB.prepare("UPDATE creators SET user_id = ? WHERE code = ?").bind(account, code).run();
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

// ---- Applying to the program ----

const URLISH = /^https?:\/\/[^\s/]+\.[^\s]+$/i;
// /creators' form (functions/api/creators/[action].js apply), signed in: {application} or {error}. One open or
// approved application per account; agreeing to the creator terms is required.
export async function applyCreator(env, user, input, now = new Date()) {
  await setupReferrals(env);
  const name = text(input.name, 60), channel = text(input.channel, 200);
  if (name.length < 2) return { error: "Tell us the name your audience knows you by." };
  if (!URLISH.test(channel)) return { error: "Paste a link to your channel or page (https://…)." };
  if (input.agree !== true) return { error: "Please agree to the creator terms first." };
  const mine = await env.DB.prepare("SELECT * FROM creator_applications WHERE user_id = ? AND status IN ('pending', 'approved') " +
    "ORDER BY created DESC LIMIT 1").bind(user.id).first();
  if (mine) return { application: mine };
  if (await env.DB.prepare("SELECT 1 AS y FROM creators WHERE user_id = ?").bind(user.id).first())
    return { error: "You're in the program already." };
  const row = { id: crypto.randomUUID(), user_id: user.id, name, channel, audience: text(input.audience, 60) || null,
                contact: text(input.contact, 200) || user.email || null, note: text(input.note, 500) || null };
  await env.DB.prepare("INSERT INTO creator_applications (id, user_id, name, channel, audience, contact, note, status, created) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)").bind(row.id, row.user_id, row.name, row.channel, row.audience,
    row.contact, row.note, iso(now.getTime())).run();
  return { application: await env.DB.prepare("SELECT * FROM creator_applications WHERE id = ?").bind(row.id).first() };
}

// A code for an approved creator, from their name: "Lore Nerd" -> "lore-nerd" (a number on it when that's taken).
async function freeCode(env, name) {
  const base = String(name || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 20) || "creator";
  for (let n = 0; n < 50; n++) {
    const code = (n ? `${base}-${n + 1}` : base).padEnd(2, "0");
    if (CREATOR_CODE.test(code) && !(await env.DB.prepare("SELECT 1 AS y FROM share_codes WHERE code = ?").bind(code).first()))
      return code;
  }
  return null;
}

// /admin's Approve or Decline (functions/api/admin/creators.js): an approved application becomes a creator tied to the
// applicant's account, with CREATOR_DEFAULTS unless given (code: /admin's pick, else one from their name).
// {creator} | {application} | {error}.
export async function decideApplication(env, id, { approve, code = "", ...terms } = {}, now = new Date()) {
  await setupReferrals(env);
  const app = await env.DB.prepare("SELECT * FROM creator_applications WHERE id = ?").bind(id).first();
  if (!app) return { error: "No such application." };
  if (app.status !== "pending") return { error: `That application was ${app.status} already.` };
  if (!approve) {
    await env.DB.prepare("UPDATE creator_applications SET status = 'declined', decided = ? WHERE id = ?")
      .bind(iso(now.getTime()), id).run();
    return { application: { ...app, status: "declined" } };
  }
  const pick = String(code || "").trim().toLowerCase() || await freeCode(env, app.name);
  const out = await saveCreator(env, { ...terms, code: pick, name: app.name, contact: app.contact, channel: app.channel,
                                       user_id: app.user_id });
  if (out.error) return out;
  await env.DB.prepare("UPDATE creator_applications SET status = 'approved', code = ?, decided = ? WHERE id = ?")
    .bind(out.creator.code, iso(now.getTime()), id).run();
  return out;
}

// ---- Commission ----

// The card that paid an invoice, one-way (its Stripe fingerprint), or null (another way to pay, or Stripe can't say).
async function invoiceCard(env, invoice) {
  try {
    const { data } = await stripe(env, "GET", "invoice_payments", { invoice: invoice.id, limit: 1 });
    const pi = idOf(data?.[0]?.payment?.payment_intent);
    if (!pi) return null;
    const intent = await stripe(env, "GET", `payment_intents/${encodeURIComponent(pi)}`, { expand: ["latest_charge"] });
    const print = intent?.latest_charge?.payment_method_details?.card?.fingerprint;
    return print ? oneWay("card", print) : null;
  } catch (e) { return null; }
}
// The cards saved for an account's Stripe customer, one-way.
async function accountCards(env, userId) {
  if (!userId) return [];
  const row = await env.DB.prepare("SELECT customer_id FROM entitlements WHERE user_id = ?").bind(userId).first();
  if (!row?.customer_id) return [];
  try {
    const { data } = await stripe(env, "GET", `customers/${encodeURIComponent(row.customer_id)}/payment_methods`,
      { type: "card", limit: 20 });
    return Promise.all((data || []).map(m => m?.card?.fingerprint).filter(Boolean).map(f => oneWay("card", f)));
  } catch (e) { return []; }
}

// The service period an invoice pays for: {start, end} (Unix seconds) over its lines, and whether it's a whole month.
function invoicePeriod(invoice) {
  const periods = (invoice.lines?.data || []).map(l => l?.period).filter(p => Number.isFinite(p?.start) && p.end > p.start);
  if (!periods.length) return null;
  const start = Math.min(...periods.map(p => p.start)), end = Math.max(...periods.map(p => p.end));
  return { start, end, whole: end - start >= 27 * 86400 };
}
const addMonths = (ms, n) => { const d = new Date(ms); d.setUTCMonth(d.getUTCMonth() + n); return d.getTime(); };

// A paid invoice (the webhook's invoice.paid, functions/api/billing/[action].js). The friend's first payment is noted
// on their referral, with its card: a friend who pays with the inviter's (or the creator's) card is void. A player
// friend's payment moves their inviter on when the free month counts paying friends. When a creator brought them
// (their link, or their code typed at checkout), the creator's share_pct% of what was paid without tax is kept, once
// per invoice, for the invoices of their first `months` paid months: up to the first invoice for a whole month, and
// any whose period starts within `months` of that one's start. Payable PAYOUTS.holdDays after it was paid. Throws when
// Stripe or D1 fails, so Stripe sends the event again.
export async function notePayment(env, invoice) {
  if (!invoice?.id || !(invoice.amount_paid > 0)) return { skipped: "nothing paid" };
  await setupReferrals(env);
  const account = await env.DB.prepare("SELECT user_id FROM entitlements WHERE customer_id = ?")
    .bind(idOf(invoice.customer)).first();
  if (!account) return { skipped: "no account" };
  const userId = account.user_id;
  const paidAt = (invoice.status_transitions?.paid_at || invoice.created || Date.now() / 1000) * 1000;
  const read = () => env.DB.prepare("SELECT * FROM referrals WHERE user_id = ?").bind(userId).first();
  let ref = await read();
  // A creator's code typed at checkout: the invoice's discount names their promotion code.
  if (!ref?.creator && (invoice.discounts || []).length) {
    const full = await stripe(env, "GET", `invoices/${encodeURIComponent(invoice.id)}`, { expand: ["discounts"] });
    for (const d of full.discounts || []) {
      const creator = await env.DB.prepare("SELECT code FROM creators WHERE promo_id = ?").bind(idOf(d?.promotion_code)).first();
      if (!creator) continue;
      const sub = (await starterClaim(env, userId)) || `user:${userId}`;
      await env.DB.batch([
        env.DB.prepare("INSERT OR IGNORE INTO referrals (user_id, code, kind, creator, sub_hash, created, via) " +
          "VALUES (?, ?, 'creator', ?, ?, ?, 'code')").bind(userId, creator.code, creator.code, sub, iso(paidAt)),
        env.DB.prepare("UPDATE referrals SET creator = ? WHERE user_id = ? AND creator IS NULL").bind(creator.code, userId),
      ]);
      ref = await read();
      break;
    }
  }
  if (!ref) return { skipped: "nobody shared" };
  const creator = ref.creator ? await creatorRow(env, ref.creator) : null;
  if (!ref.paid) {
    // The first payment: whose card paid. The inviter's own card makes the friend theirs (void).
    const card = await invoiceCard(env, invoice);
    const inviter = ref.sharer_id || creator?.user_id || null;
    const same = card && inviter && (await accountCards(env, inviter)).includes(card);
    await env.DB.prepare("UPDATE referrals SET paid = ?, card = COALESCE(card, ?), void = COALESCE(void, ?), " +
      "counted = CASE WHEN ? THEN 0 ELSE counted END WHERE user_id = ? AND paid IS NULL")
      .bind(iso(paidAt), card, same ? "inviter's card" : null, same ? 1 : 0, userId).run();
    ref = await read();
    if (ref.kind === "player" && ref.sharer_id && !ref.void && REWARDS.monthCounts === "paid")
      await settleRewards(env, ref.sharer_id, new Date(paidAt));
  }
  if (!creator) return { skipped: "no creator" };
  if (ref.void) return { skipped: `void: ${ref.void}` };
  const period = invoicePeriod(invoice);
  const start = period ? period.start * 1000 : paidAt;
  let first = ref.first_month ? Date.parse(ref.first_month) : null;
  if (first === null && period?.whole) {
    await env.DB.prepare("UPDATE referrals SET first_month = ? WHERE user_id = ? AND first_month IS NULL")
      .bind(iso(start), userId).run();
    first = Date.parse((await read()).first_month);
  }
  if (first !== null && start >= addMonths(first, creator.months)) return { skipped: "past the creator's months" };
  const taxes = Array.isArray(invoice.total_taxes) ? invoice.total_taxes.reduce((a, t) => a + (t?.amount || 0), 0)
    : Number(invoice.tax) || 0;
  const paid = Math.max(0, invoice.amount_paid - taxes);
  const share = Math.round(paid * creator.share_pct / 100);
  await env.DB.prepare("INSERT OR IGNORE INTO creator_earnings (invoice_id, creator, user_id, paid_cents, share_cents, pct, " +
    "paid_at, recorded, payable_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(invoice.id, creator.code, userId, paid, share,
    creator.share_pct, iso(paidAt), iso(), iso(paidAt + PAYOUTS.holdDays * DAY_MS)).run();
  return { creator: creator.code, paid, share };
}

// A refund (charge.refunded) or a dispute (charge.dispute.created) of a payment a creator earned on: that commission
// is taken back (reversed), whatever part was refunded. One already paid out comes off the creator's next payout
// (clawed by it). {reversed: invoice id} or {skipped}.
export async function reverseCommission(env, object, why) {
  await setupReferrals(env);
  if (!(await env.DB.prepare("SELECT 1 AS y FROM creator_earnings LIMIT 1").first())) return { skipped: "no commissions" };
  const pi = idOf(object?.payment_intent);
  if (!pi) return { skipped: "no payment" };
  const { data } = await stripe(env, "GET", "invoice_payments", { payment: { type: "payment_intent", payment_intent: pi }, limit: 1 });
  const invoiceId = idOf(data?.[0]?.invoice);
  if (!invoiceId) return { skipped: "not an invoice's payment" };
  const res = await env.DB.prepare("UPDATE creator_earnings SET reversed = ?, reversed_why = ? WHERE invoice_id = ? AND reversed IS NULL")
    .bind(iso(), why, invoiceId).run();
  return res.meta.changes ? { reversed: invoiceId } : { skipped: "no commission on it" };
}

// ---- Payouts ----

const SETTING = "stripe_payouts";
export async function stripePayoutsOn(env) {
  await setupReferrals(env);
  return (await env.DB.prepare("SELECT value FROM referral_settings WHERE key = ?").bind(SETTING).first())?.value === "on";
}
// /admin's switch, once Mike has Stripe Connect: creators can then set up payouts from their dashboard, and /admin
// pays with Stripe transfers. Turning it on proves the site's key can make Express accounts (Connect is set up and
// the key may write them): it makes one, empty, and deletes it again. Listing accounts proves nothing (it works
// without Connect), and Stripe checks a request's fields before whether Connect is on.
export async function setStripePayouts(env, on) {
  await setupReferrals(env);
  if (on) {
    try {
      const probe = await stripe(env, "POST", "accounts", { type: "express", country: "US",
        capabilities: { transfers: { requested: true } }, metadata: { probe: "lore-forever payouts switch" } });
      await stripe(env, "DELETE", `accounts/${encodeURIComponent(probe.id)}`).catch(e =>
        console.warn(`referrals: payouts probe ${probe.id} not deleted: ${e?.message || e}`));
    } catch (e) { return { error: `Stripe said no to Connect: ${e.message}` }; }
  }
  await env.DB.prepare("INSERT INTO referral_settings (key, value, updated) VALUES (?, ?, ?) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated = excluded.updated").bind(SETTING, on ? "on" : "off", iso()).run();
  return { on: Boolean(on) };
}

const monthKey = (now = new Date()) => iso(now.getTime()).slice(0, 7);
// What's owed to each creator now (US cents): payable (past its hold, not paid, not reversed), clawback (reversed
// after it was paid out, not taken off yet), held (still in its hold) and due (payable less clawback).
const OWED = "SELECT creator, " +
  "COALESCE(SUM(CASE WHEN payout_id IS NULL AND paid_out IS NULL AND reversed IS NULL AND payable_at <= ?1 THEN share_cents END), 0) AS payable, " +
  "COALESCE(SUM(CASE WHEN reversed IS NOT NULL AND (payout_id IS NOT NULL OR paid_out IS NOT NULL) AND clawed IS NULL THEN share_cents END), 0) AS clawback, " +
  "COALESCE(SUM(CASE WHEN payout_id IS NULL AND paid_out IS NULL AND reversed IS NULL AND payable_at > ?1 THEN share_cents END), 0) AS held, " +
  "MIN(CASE WHEN payout_id IS NULL AND paid_out IS NULL AND reversed IS NULL AND payable_at > ?1 THEN payable_at END) AS next_payable " +
  "FROM creator_earnings GROUP BY creator";

// The month's payout list (/admin): every creator owed at least PAYOUTS.minimumCents now, how they're paid (Stripe,
// once payouts are on and their account is ready, else by hand), and what's still in its hold.
// {month, minimum, stripe (payouts on), due: [{code, name, contact, due, payable, clawback, held, method, connect}],
// held: [{code, name, held, next}]}.
export async function payoutList(env, now = new Date()) {
  await setupReferrals(env);
  const at = iso(now.getTime());
  const [{ results: owed }, { results: creators }, stripeOn] = await Promise.all([
    env.DB.prepare(OWED).bind(at).all(),
    env.DB.prepare("SELECT code, name, contact, connect_id, connect_ready FROM creators").all(),
    stripePayoutsOn(env),
  ]);
  const byCode = new Map(creators.map(c => [c.code, c]));
  const due = [], held = [];
  for (const o of owed) {
    const c = byCode.get(o.creator) || { code: o.creator, name: o.creator };
    const amount = o.payable - o.clawback;
    if (amount >= PAYOUTS.minimumCents) due.push({ code: c.code, name: c.name, contact: c.contact || null, due: amount,
      payable: o.payable, clawback: o.clawback, held: o.held,
      method: stripeOn && c.connect_id && c.connect_ready ? "stripe" : "manual", connect: Boolean(c.connect_id && c.connect_ready) });
    else if (o.held > 0 || amount > 0) held.push({ code: c.code, name: c.name, held: o.held, carried: Math.max(0, amount), next: o.next_payable });
  }
  return { month: monthKey(now), minimum: PAYOUTS.minimumCents, stripe: stripeOn, due, held };
}

// Pays a creator what's due now (payoutList's due), once: their payable earnings and the clawbacks it takes off are
// tied to one payout (creator_payouts), so a second "Pay" at the same time finds nothing. method "stripe": a Stripe
// transfer to their Express account (only with payouts on and their account ready; the payout's id is Stripe's
// idempotency key; a failed transfer unties the earnings again); "manual": paid outside the site (a bank transfer,
// PayPal), noted. {payout} or {error}.
export async function payCreator(env, code, { method = "manual", note = "", now = new Date() } = {}) {
  await setupReferrals(env);
  const creator = await creatorRow(env, code);
  if (!creator) return { error: "No such creator." };
  if (method === "stripe" && !(await stripePayoutsOn(env))) return { error: "Stripe payouts aren't on yet." };
  if (method === "stripe" && !(creator.connect_id && creator.connect_ready)) return { error: `${creator.name} hasn't set up payouts with Stripe yet.` };
  const at = iso(now.getTime()), id = `po_${code}_${now.getTime().toString(36)}${hex(crypto.getRandomValues(new Uint8Array(3)))}`;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO creator_payouts (id, creator, month, cents, items, method, status, note, created) " +
      "VALUES (?, ?, ?, 0, 0, ?, 'pending', ?, ?)").bind(id, code, monthKey(now), method, text(note, 200) || null, at),
    env.DB.prepare("UPDATE creator_earnings SET payout_id = ? WHERE creator = ? AND payout_id IS NULL AND paid_out IS NULL " +
      "AND reversed IS NULL AND payable_at <= ?").bind(id, code, at),
    env.DB.prepare("UPDATE creator_earnings SET clawed = ? WHERE creator = ? AND reversed IS NOT NULL AND " +
      "(payout_id IS NOT NULL OR paid_out IS NOT NULL) AND clawed IS NULL").bind(id, code),
  ]);
  const sums = await env.DB.prepare("SELECT COALESCE(SUM(CASE WHEN payout_id = ?1 THEN share_cents END), 0) AS paid, " +
    "COALESCE(SUM(CASE WHEN payout_id = ?1 THEN 1 END), 0) AS items, " +
    "COALESCE(SUM(CASE WHEN clawed = ?1 THEN share_cents END), 0) AS clawed FROM creator_earnings WHERE creator = ?2")
    .bind(id, code).first();
  const cents = sums.paid - sums.clawed;
  const untie = why => env.DB.batch([
    env.DB.prepare("UPDATE creator_earnings SET payout_id = NULL WHERE payout_id = ?").bind(id),
    env.DB.prepare("UPDATE creator_earnings SET clawed = NULL WHERE clawed = ?").bind(id),
    env.DB.prepare("UPDATE creator_payouts SET status = 'failed', error = ? WHERE id = ?").bind(why, id),
  ]);
  if (cents <= 0) { await untie("nothing due"); return { error: `Nothing is due to ${creator.name} now.` }; }
  let transfer = null;
  if (method === "stripe") {
    try {
      transfer = await stripe(env, "POST", "transfers", { amount: cents, currency: "usd", destination: creator.connect_id,
        description: `Lore Forever creator payout, ${monthKey(now)}`, metadata: { creator: code, payout: id } },
        { idempotencyKey: `lf-payout-${id}` });
    } catch (e) {
      await untie(String(e?.message || e).slice(0, 300));
      return { error: `Stripe didn't send it: ${e.message}` };
    }
  }
  await env.DB.batch([
    env.DB.prepare("UPDATE creator_payouts SET cents = ?, items = ?, status = 'paid', transfer_id = ?, paid_at = ? WHERE id = ?")
      .bind(cents, sums.items, transfer?.id || null, at, id),
    env.DB.prepare("UPDATE creator_earnings SET paid_out = ? WHERE payout_id = ?").bind(at, id),
  ]);
  return { payout: await env.DB.prepare("SELECT * FROM creator_payouts WHERE id = ?").bind(id).first() };
}

// A creator's Express account and Stripe's onboarding page for it (their dashboard's "Set up payouts"): {url} or
// {error}. country: theirs (two letters); outside the US, Stripe's recipient agreement (payouts only).
const COUNTRY = /^[A-Z]{2}$/;
export async function startConnect(env, creator, origin, { country = "US", email = null } = {}) {
  if (!(await stripePayoutsOn(env))) return { error: "Payouts through Stripe aren't open yet. We'll pay you by hand until then." };
  country = String(country || "US").toUpperCase();
  if (!COUNTRY.test(country)) return { error: "Pick your country." };
  let id = creator.connect_id;
  try {
    if (!id) {
      const acct = await stripe(env, "POST", "accounts", { type: "express", country, ...(email ? { email } : {}),
        capabilities: { transfers: { requested: true } }, metadata: { creator: creator.code },
        ...(country !== "US" ? { tos_acceptance: { service_agreement: "recipient" } } : {}) },
        { idempotencyKey: `lf-connect-${creator.code}-${country}` });
      id = acct.id;
      await env.DB.prepare("UPDATE creators SET connect_id = ?, connect_country = ?, connect_ready = 0 WHERE code = ?")
        .bind(id, country, creator.code).run();
    }
    const link = await stripe(env, "POST", "account_links", { account: id, type: "account_onboarding",
      refresh_url: `${origin}/creators?payouts=again`, return_url: `${origin}/creators?payouts=done` });
    return { url: link.url };
  } catch (e) {
    console.warn(`referrals: connect ${creator.code}: ${e?.message || e}`);
    return { error: "Stripe couldn't start that just now. Please try again in a moment." };
  }
}

// Whether a creator's Express account can take transfers now (Stripe says so), noted on their row. {ready, due (what
// Stripe still wants from them)}.
export async function refreshConnect(env, creator) {
  if (!creator?.connect_id) return { ready: false };
  try {
    const acct = await stripe(env, "GET", `accounts/${encodeURIComponent(creator.connect_id)}`);
    const ready = Boolean(acct?.payouts_enabled) && acct?.capabilities?.transfers === "active";
    if (ready !== Boolean(creator.connect_ready))
      await env.DB.prepare("UPDATE creators SET connect_ready = ? WHERE code = ?").bind(ready ? 1 : 0, creator.code).run();
    return { ready, due: (acct?.requirements?.currently_due || []).length };
  } catch (e) { return { ready: Boolean(creator.connect_ready) }; }
}

// Stripe's own page for a creator's payouts and bank details (their Express dashboard): {url} or {error}.
export async function connectLogin(env, creator) {
  if (!creator?.connect_id) return { error: "Set up payouts first." };
  try { return { url: (await stripe(env, "POST", `accounts/${encodeURIComponent(creator.connect_id)}/login_links`)).url }; }
  catch (e) { return { error: "Stripe couldn't open that just now." }; }
}

// ---- What creators and /admin see ----

// One creator's numbers (US cents): clicks, signups (accounts their link brought, not void), connected (signed in to
// Willo), activated (a first real answer), paying (paid a first month), earned (commission, not reversed), held (in
// its hold), payable (past it, not paid yet), paidOut, reversed; and by month, the last six.
async function creatorNumbers(env, code, now) {
  const at = iso(now.getTime());
  const [row, { results: months }] = await Promise.all([
    env.DB.prepare("SELECT (SELECT clicks FROM share_codes WHERE code = ?1) AS clicks, " +
      "COALESCE(SUM(void IS NULL), 0) AS signups, COALESCE(SUM(void IS NULL AND connected IS NOT NULL), 0) AS connected, " +
      "COALESCE(SUM(void IS NULL AND activated IS NOT NULL), 0) AS activated, " +
      "COALESCE(SUM(void IS NULL AND paid IS NOT NULL), 0) AS paying, " +
      "(SELECT COALESCE(SUM(CASE WHEN reversed IS NULL THEN share_cents END), 0) FROM creator_earnings WHERE creator = ?1) AS earned, " +
      "(SELECT COALESCE(SUM(CASE WHEN reversed IS NULL AND payout_id IS NULL AND paid_out IS NULL AND payable_at > ?2 THEN share_cents END), 0) " +
      "FROM creator_earnings WHERE creator = ?1) AS held, " +
      "(SELECT COALESCE(SUM(CASE WHEN reversed IS NULL AND payout_id IS NULL AND paid_out IS NULL AND payable_at <= ?2 THEN share_cents END), 0) " +
      "FROM creator_earnings WHERE creator = ?1) AS payable, " +
      "(SELECT COALESCE(SUM(cents), 0) FROM creator_payouts WHERE creator = ?1 AND status = 'paid') AS paidOut, " +
      "(SELECT COALESCE(SUM(CASE WHEN reversed IS NOT NULL THEN share_cents END), 0) FROM creator_earnings WHERE creator = ?1) AS reversed " +
      "FROM referrals WHERE creator = ?1").bind(code, at).first(),
    env.DB.prepare("WITH m AS (SELECT substr(created, 1, 7) AS month, 1 AS signups, 0 AS activated, 0 AS paying, 0 AS earned " +
      "FROM referrals WHERE creator = ?1 AND void IS NULL " +
      "UNION ALL SELECT substr(activated, 1, 7), 0, 1, 0, 0 FROM referrals WHERE creator = ?1 AND void IS NULL AND activated IS NOT NULL " +
      "UNION ALL SELECT substr(paid, 1, 7), 0, 0, 1, 0 FROM referrals WHERE creator = ?1 AND void IS NULL AND paid IS NOT NULL " +
      "UNION ALL SELECT substr(paid_at, 1, 7), 0, 0, 0, share_cents FROM creator_earnings WHERE creator = ?1 AND reversed IS NULL) " +
      "SELECT month, SUM(signups) AS signups, SUM(activated) AS activated, SUM(paying) AS paying, SUM(earned) AS earned " +
      "FROM m GROUP BY month ORDER BY month DESC LIMIT 6").bind(code).all(),
  ]);
  return { ...row, clicks: row?.clicks || 0, months };
}

// The signed-in creator's dashboard (/creators, functions/api/creators/[action].js me): their link and terms, their
// numbers, and how they're paid: {code, name, url, terms: {sharePct, months, holdDays, minimum}, numbers, payouts:
// {stripe (payouts on), connect (set up), ready, next (the 1st of next month), last {cents, when, method}}}, or null
// when the account isn't a creator.
export async function creatorDashboard(env, userId, origin, now = new Date()) {
  await setupReferrals(env);
  const creator = await env.DB.prepare("SELECT * FROM creators WHERE user_id = ?").bind(userId).first();
  if (!creator) return null;
  const [numbers, stripeOn, last, connect] = await Promise.all([
    creatorNumbers(env, creator.code, now), stripePayoutsOn(env),
    env.DB.prepare("SELECT cents, paid_at, method FROM creator_payouts WHERE creator = ? AND status = 'paid' " +
      "ORDER BY paid_at DESC LIMIT 1").bind(creator.code).first(),
    creator.connect_id && !creator.connect_ready ? refreshConnect(env, creator) : null,
  ]);
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
  return { code: creator.code, name: creator.name, url: shareUrl(origin, creator.code), retired: Boolean(creator.retired),
           terms: { sharePct: creator.share_pct, months: creator.months, discount: creator.discount, gift: creator.gift,
                    holdDays: PAYOUTS.holdDays, minimum: PAYOUTS.minimumCents },
           numbers,
           payouts: { stripe: stripeOn, connect: Boolean(creator.connect_id), ready: Boolean(connect?.ready ?? creator.connect_ready),
                      next, last: last ? { cents: last.cents, when: last.paid_at, method: last.method } : null } };
}

// The creator a signed-in account is (for its payout buttons), or null.
export async function creatorOfUser(env, userId) {
  await setupReferrals(env);
  return env.DB.prepare("SELECT * FROM creators WHERE user_id = ?").bind(userId).first();
}

// An account's open or decided application to the program (the latest), or null.
export async function applicationOf(env, userId) {
  await setupReferrals(env);
  return env.DB.prepare("SELECT id, name, channel, status, code, created, decided FROM creator_applications WHERE user_id = ? " +
    "ORDER BY created DESC LIMIT 1").bind(userId).first();
}

// /admin's Creators tab: each creator with their numbers and what's owed, the applications waiting, the month's payout
// list, the last commissions and payouts, players' own invites (friends joined, activated, counted, void by reason,
// rewards given), and whether Stripe payouts are on.
export async function referralReport(env, origin, now = new Date()) {
  await setupReferrals(env);
  const at = iso(now.getTime()), month = at.slice(0, 7);
  const all = (sql, ...args) => env.DB.prepare(sql).bind(...args).all().then(r => r.results || []);
  const [creators, players, voids, rewards, applications, ledger, payouts, list] = await Promise.all([
    all("SELECT c.*, s.clicks, u.email AS account, " +
      "(SELECT COUNT(*) FROM referrals r WHERE r.creator = c.code AND r.void IS NULL) AS joined, " +
      "(SELECT COUNT(*) FROM referrals r WHERE r.creator = c.code AND r.void IS NULL AND r.activated IS NOT NULL) AS activated, " +
      "(SELECT COUNT(*) FROM referrals r WHERE r.creator = c.code AND r.void IS NULL AND r.paid IS NOT NULL) AS paying, " +
      "(SELECT COALESCE(SUM(share_cents), 0) FROM creator_earnings e WHERE e.creator = c.code AND e.reversed IS NULL) AS earned, " +
      "(SELECT COALESCE(SUM(share_cents), 0) FROM creator_earnings e WHERE e.creator = c.code AND e.reversed IS NULL " +
      "AND e.payout_id IS NULL AND e.paid_out IS NULL) AS owed, " +
      "(SELECT COALESCE(SUM(paid_cents), 0) FROM creator_earnings e WHERE e.creator = c.code AND e.reversed IS NULL) AS brought " +
      "FROM creators c LEFT JOIN share_codes s ON s.code = c.code LEFT JOIN users u ON u.id = c.user_id ORDER BY c.created DESC"),
    env.DB.prepare("SELECT COUNT(*) AS joined, COALESCE(SUM(activated IS NOT NULL), 0) AS activated, " +
      "COALESCE(SUM(counted), 0) AS friends, COALESCE(SUM(counted AND substr(activated, 1, 7) = ?), 0) AS month, " +
      "COALESCE(SUM(answers), 0) AS answers, COALESCE(SUM(paid IS NOT NULL), 0) AS paying, " +
      "COUNT(DISTINCT sharer_id) AS sharers FROM referrals WHERE kind = 'player' AND void IS NULL").bind(month).first(),
    all("SELECT void AS why, COUNT(*) AS n FROM referrals WHERE void IS NOT NULL GROUP BY void ORDER BY n DESC"),
    all("SELECT kind, method, status, COUNT(*) AS n, COALESCE(SUM(answers), 0) AS answers, COALESCE(SUM(cents), 0) AS cents " +
      "FROM referral_rewards GROUP BY kind, method, status"),
    all("SELECT a.*, u.email AS account FROM creator_applications a LEFT JOIN users u ON u.id = a.user_id " +
      "WHERE a.status = 'pending' ORDER BY a.created"),
    all("SELECT invoice_id, creator, paid_cents, share_cents, pct, paid_at, payable_at, reversed, reversed_why, payout_id, " +
      "paid_out, clawed FROM creator_earnings ORDER BY paid_at DESC LIMIT 100"),
    all("SELECT * FROM creator_payouts WHERE status = 'paid' ORDER BY paid_at DESC LIMIT 50"),
    payoutList(env, now),
  ]);
  const ledgerView = ledger.map(e => ({ ...e, state: e.reversed ? (e.payout_id || e.paid_out ? "reversed after payout" : "reversed")
    : e.payout_id || e.paid_out ? "paid" : e.payable_at > at ? "in hold" : "payable" }));
  return { creators: creators.map(c => ({ ...c, url: shareUrl(origin, c.code) })), players, voids, rewards, applications,
           ledger: ledgerView, payouts, payoutList: list, rules: { ...REWARDS }, payoutRules: { ...PAYOUTS } };
}
