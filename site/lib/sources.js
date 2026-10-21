import { isReportRead } from "./report-read.js";
// Where visitors come from (Mike and Patrick, 10/19: "trace analytics from articles"): for every article that sends
// people here (press and news posts, creator write-ups, our own guide and lore pages), the whole path, visits ->
// add-on downloads -> sign-ups -> Willo -> paid plans. First-party and without Google Analytics or a consent banner
// (Mike's low-friction rule): one first-party cookie holding only where the visit started, no ID.
//
// A source is one of:
//   a tracked link's slug ("pcgamer-forever", made on /admin: /a/<slug>, or ?src=<slug> on any page), and the site's own
//     markers (?src=lore, ?src=nav), which only count when the visit starts with them;
//   "site:<host>" for a plain link from another site (browsers send only the other site's address, not the page, so
//     the exact article needs a tracked link), or "search:<engine>" for a search engine's.
// A visit starts when a page is opened from another site, a tracked link or an address with ?src= (header.js asks
// POST /api/visit once per tab, functions/api/visit.js), never on a click inside the site or a visit typed in. Each
// is counted (source_events kind "visit"), and the first one a browser makes is kept for 30 days in the lf_src cookie
// (the source and the page it landed on, nothing else): that's where the browser's later downloads, sign-up, first
// Willo connect and plans are counted (lib/sources.js countEvent; the account keeps it in account_sources).
//
// Tables (made by setupSources):
//   source_links (slug, label, target, created, retired, opens): the tracked links, /a/<slug> -> target (a page of
//     this site), and how often each was opened.
//   source_events (day, src, landing, kind, n, cents): per UTC day, source and landing page, how many of each kind:
//     visit, new (a browser's first visit, the cookie set), and later download:<file>, signup, willo, paid (cents: what
//     was paid, without tax).
//   account_sources (user_id, src, landing, first_seen, signup, willo, paid, cents): an account's first source.

const COOKIE = "lf_src";
export const COOKIE_DAYS = 30;
// A tracked link's slug, or the site's own ?src= markers (the same shape as functions/download/[file].js counts).
export const SLUG = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const SOURCE = /^(?:[a-z0-9][a-z0-9_-]{0,31}|site:[a-z0-9.-]{3,64}|search:[a-z]{2,16})$/;
const LANDING_MAX = 120;
// Search engines, by the start or end of their address.
const ENGINES = [["google", /(^|\.)google\.[a-z.]+$/], ["bing", /(^|\.)bing\.com$/], ["duckduckgo", /(^|\.)duckduckgo\.com$/],
  ["yahoo", /(^|\.)yahoo\.[a-z.]+$/], ["ecosia", /(^|\.)ecosia\.org$/], ["brave", /^search\.brave\.com$/],
  ["yandex", /(^|\.)yandex\.[a-z.]+$/], ["baidu", /(^|\.)baidu\.com$/], ["startpage", /(^|\.)startpage\.com$/],
  ["qwant", /(^|\.)qwant\.com$/]];

const iso = (ms = Date.now()) => new Date(ms).toISOString();

const SETUP = [
  `CREATE TABLE IF NOT EXISTS source_links (slug TEXT PRIMARY KEY, label TEXT NOT NULL, target TEXT NOT NULL,
    created TEXT NOT NULL, retired TEXT, opens INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS source_events (day TEXT NOT NULL, src TEXT NOT NULL, landing TEXT NOT NULL, kind TEXT NOT NULL,
    n INTEGER NOT NULL DEFAULT 0, cents INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, src, landing, kind))`,
  "CREATE INDEX IF NOT EXISTS source_events_src ON source_events (src, day)",
  `CREATE TABLE IF NOT EXISTS account_sources (user_id TEXT PRIMARY KEY, src TEXT NOT NULL, landing TEXT NOT NULL,
    first_seen TEXT NOT NULL, signup TEXT, willo TEXT, paid TEXT, cents INTEGER NOT NULL DEFAULT 0)`,
  // Each paid invoice counted once (Stripe sends an event again until it's answered).
  "CREATE TABLE IF NOT EXISTS source_invoices (invoice_id TEXT PRIMARY KEY, created TEXT NOT NULL)",
];
const ready = new WeakMap();
export function setupSources(env) {
  if (isReportRead(env)) return;
  if (!ready.has(env.DB)) ready.set(env.DB, env.DB.batch(SETUP.map(s => env.DB.prepare(s)))
    .catch(e => { ready.delete(env.DB); throw e; }));
  return ready.get(env.DB);
}

// "Delete my account" (lib/accounts.js USER_DATA): where the account came from goes with it; the day's counts stay,
// with nothing about who.
export const SOURCES_USER_DATA = [["DELETE FROM account_sources WHERE user_id = ?", u => u.id]];

// The host a referring address names, without www., m. or amp., or "" when it can't be read.
const hostOf = ref => {
  try { return new URL(String(ref || "")).hostname.toLowerCase().replace(/^(?:www|m|amp)\./, ""); } catch (e) { return ""; }
};
// Whether a referring address is this site (its own host, or any of its addresses).
export function fromHere(ref, ownHost = "") {
  const host = hostOf(ref), own = String(ownHost || "").toLowerCase().replace(/^www\./, "");
  return Boolean(host) && ((own && (host === own || host.endsWith("." + own))) ||
    /(^|\.)(?:loreforeverwow\.com|lore-forever\.pages\.dev|loreforever\.mliu\.io|localhost)$/.test(host));
}

// The source a referring address names: "search:google", "site:pcgamer.com", or "" for this site itself, an
// unreadable one, or none.
export function sourceOfReferrer(ref, ownHost = "") {
  const host = hostOf(ref);
  if (!host || fromHere(ref, ownHost)) return "";
  const engine = ENGINES.find(([, re]) => re.test(host));
  if (engine) return `search:${engine[0]}`;
  const out = `site:${host}`.slice(0, 69);
  return SOURCE.test(out) ? out : "";
}

// A landing page as it's kept: its path only, no query, cut to LANDING_MAX; "/" for anything else.
export function landingOf(path) {
  const p = String(path || "/").split(/[?#]/)[0].replace(/[^\x21-\x7e]/g, "").slice(0, LANDING_MAX);
  return p.startsWith("/") ? p.replace(/(.)\/+$/, "$1") : "/";
}

// The browser's first source, from its lf_src cookie: {src, landing}, or null.
export function firstTouch(request) {
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k !== COOKIE) continue;
    const [src, landing] = v.join("=").split("|").map(x => { try { return decodeURIComponent(x || ""); } catch (e) { return ""; } });
    return SOURCE.test(src || "") ? { src, landing: landingOf(landing) } : null;
  }
  return null;
}

// The cookie that keeps a browser's first source: the source and its landing page, for COOKIE_DAYS.
export const firstTouchCookie = (request, src, landing) =>
  `${COOKIE}=${encodeURIComponent(src)}|${encodeURIComponent(landingOf(landing))}; Path=/; HttpOnly; SameSite=Lax; ` +
  `Max-Age=${COOKIE_DAYS * 86400}` + (new URL(request.url).protocol === "https:" ? "; Secure" : "");

// One more of `kind` for a source and landing page today (cents: what was paid, for "paid"). Never throws: a count is
// never worth a failed page or sign-up.
export async function countEvent(env, src, landing, kind, { cents = 0, now = Date.now() } = {}) {
  if (!env?.DB || !SOURCE.test(src || "")) return;
  try {
    await setupSources(env);
    await env.DB.prepare("INSERT INTO source_events (day, src, landing, kind, n, cents) VALUES (?, ?, ?, ?, 1, ?) " +
      "ON CONFLICT (day, src, landing, kind) DO UPDATE SET n = n + 1, cents = cents + excluded.cents")
      .bind(iso(now).slice(0, 10), src, landingOf(landing), String(kind).slice(0, 40), Math.max(0, Math.round(cents) || 0)).run();
  } catch (e) { console.warn(`sources: ${kind}: ${e?.message || e}`); }
}

// A visit starting here (POST /api/visit from header.js): {src, landing} it counts under, or null when it doesn't
// start a visit (a click inside the site, a visit typed in, nothing readable). asked: the page's ?src=; ref: the page
// that sent them (document.referrer); landing: this page's path.
export function visitSource({ asked, ref, landing }, ownHost) {
  const src = String(asked || "").toLowerCase();
  if (fromHere(ref, ownHost)) return null;     // a click inside the site: the visit started before
  if (SLUG.test(src)) return { src, landing: landingOf(landing) };
  const site = sourceOfReferrer(ref, ownHost);
  return site ? { src: site, landing: landingOf(landing) } : null;
}

// ---- Tracked links ----

// The link /a/<slug> opens: {slug, target}, or null for one that doesn't exist or was retired. Counts the opening.
export async function openLink(env, slug) {
  slug = String(slug || "").toLowerCase();
  if (!SLUG.test(slug) || !env?.DB) return null;
  await setupSources(env);
  const row = await env.DB.prepare("SELECT slug, target FROM source_links WHERE slug = ? AND retired IS NULL").bind(slug).first();
  if (row) await env.DB.prepare("UPDATE source_links SET opens = opens + 1 WHERE slug = ?").bind(slug).run();
  return row || null;
}

// A page of this site a tracked link may point at: a path (with its query), never another site.
export function targetOf(text) {
  const t = String(text || "").trim();
  let url;
  try { url = new URL(t, "https://loreforeverwow.com"); } catch (e) { return null; }
  const ours = /^(?:www\.)?loreforeverwow\.com$/i.test(url.hostname);
  if (!ours && !(t.startsWith("/") && !t.startsWith("//"))) return null;
  if (!ours && url.hostname !== "loreforeverwow.com") return null;
  const path = url.pathname + url.search;
  return path.startsWith("/") && !path.startsWith("//") && path.length <= 300 ? path : null;
}

// Makes (or changes) a tracked link: {link} or {error}. slug: what /a/ ends with ("pcgamer-forever"); label: what
// /admin calls it ("PC Gamer: WoW Forever guide"); target: the page it opens (default the home page).
export async function saveLink(env, { slug, label, target } = {}, now = Date.now()) {
  await setupSources(env);
  slug = String(slug || "").trim().toLowerCase();
  if (!SLUG.test(slug)) return { error: "A link's name is 1-32 letters, digits, dashes or underscores, like pcgamer-forever." };
  const to = targetOf(target || "/");
  if (!to) return { error: "The link must open a page of loreforeverwow.com, like /willo or /downloads." };
  const name = String(label || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 120) || slug;
  await env.DB.prepare("INSERT INTO source_links (slug, label, target, created) VALUES (?, ?, ?, ?) " +
    "ON CONFLICT (slug) DO UPDATE SET label = excluded.label, target = excluded.target, retired = NULL")
    .bind(slug, name, to, iso(now)).run();
  return { link: await env.DB.prepare("SELECT * FROM source_links WHERE slug = ?").bind(slug).first() };
}

export async function retireLink(env, slug, retire = true, now = Date.now()) {
  await setupSources(env);
  const res = await env.DB.prepare("UPDATE source_links SET retired = ? WHERE slug = ?")
    .bind(retire ? iso(now) : null, String(slug || "").toLowerCase()).run();
  return res.meta.changes > 0;
}

// Where /a/<slug> sends a browser: the link's page with ?src=<slug> on it, so the visit counts under it.
export function withSource(target, slug) {
  const url = new URL(target, "https://x.invalid");
  url.searchParams.set("src", slug);
  return url.pathname + url.search;
}

// ---- Carried through: downloads, sign-ups, Willo, plans ----

const idOf = v => typeof v === "string" ? v : typeof v?.id === "string" ? v.id : null;
const accountRow = (env, userId) => env.DB.prepare("SELECT * FROM account_sources WHERE user_id = ?").bind(userId).first();

// A download from the site (functions/download/[file].js): counted under the browser's first source, as
// "download:<file>" (installer, zip, willo). Never throws.
export async function noteDownload(env, request, file, now = Date.now()) {
  const first = firstTouch(request);
  if (first) await countEvent(env, first.src, first.landing, `download:${file}`, { now });
}

// An account made just now (functions/api/auth/[action].js google) in a browser with a first source: the account
// keeps where it came from (account_sources), and the sign-up counts under it. Never throws.
export async function noteSignup(env, request, user, now = Date.now()) {
  const first = firstTouch(request);
  if (!first || !user?.id) return;
  try {
    await setupSources(env);
    const made = await env.DB.prepare("INSERT OR IGNORE INTO account_sources (user_id, src, landing, first_seen, signup) " +
      "VALUES (?, ?, ?, ?, ?)").bind(user.id, first.src, first.landing, iso(now), iso(now)).run();
    if (made.meta.changes) await countEvent(env, first.src, first.landing, "signup", { now });
  } catch (e) { console.warn(`sources: signup: ${e?.message || e}`); }
}

// An account connecting Willo (functions/api/device/[action].js approve): its first time counts under its source. An
// account from before sources (no row) that never had Willo takes the browser's first source here. Never throws.
export async function noteWillo(env, request, user, now = Date.now()) {
  if (!user?.id) return;
  try {
    await setupSources(env);
    let row = await accountRow(env, user.id);
    if (!row) {
      const first = firstTouch(request);
      const before = await env.DB.prepare("SELECT EXISTS (SELECT 1 FROM devices WHERE user_id = ?) AS y").bind(user.id).first();
      if (!first || before?.y) return;
      await env.DB.prepare("INSERT OR IGNORE INTO account_sources (user_id, src, landing, first_seen) VALUES (?, ?, ?, ?)")
        .bind(user.id, first.src, first.landing, iso(now)).run();
      row = await accountRow(env, user.id);
    }
    const first = await env.DB.prepare("UPDATE account_sources SET willo = ? WHERE user_id = ? AND willo IS NULL")
      .bind(iso(now), user.id).run();
    if (first.meta.changes) await countEvent(env, row.src, row.landing, "willo", { now });
  } catch (e) { console.warn(`sources: willo: ${e?.message || e}`); }
}

// A paid invoice (the billing webhook's invoice.paid): counted under the account's source, once per invoice: "paid"
// for the account's first payment and "revenue" for every one, with what was paid without tax (cents). Throws only
// when D1 fails, so Stripe sends it again.
export async function notePaidSource(env, invoice) {
  if (!invoice?.id || !(invoice.amount_paid > 0)) return { skipped: "nothing paid" };
  await setupSources(env);
  const account = await env.DB.prepare("SELECT user_id FROM entitlements WHERE customer_id = ?").bind(idOf(invoice.customer)).first();
  const row = account ? await accountRow(env, account.user_id) : null;
  if (!row) return { skipped: "no source" };
  const fresh = await env.DB.prepare("INSERT OR IGNORE INTO source_invoices (invoice_id, created) VALUES (?, ?)")
    .bind(invoice.id, iso()).run();
  if (!fresh.meta.changes) return { skipped: "counted" };
  const taxes = Array.isArray(invoice.total_taxes) ? invoice.total_taxes.reduce((a, t) => a + (t?.amount || 0), 0)
    : Number(invoice.tax) || 0;
  const cents = Math.max(0, invoice.amount_paid - taxes);
  const paidAt = (invoice.status_transitions?.paid_at || invoice.created || Date.now() / 1000) * 1000;
  const first = await env.DB.prepare("UPDATE account_sources SET paid = ?, cents = cents + ? WHERE user_id = ? AND paid IS NULL")
    .bind(iso(paidAt), cents, row.user_id).run();
  if (first.meta.changes) await countEvent(env, row.src, row.landing, "paid", { now: paidAt });
  else await env.DB.prepare("UPDATE account_sources SET cents = cents + ? WHERE user_id = ?").bind(cents, row.user_id).run();
  await countEvent(env, row.src, row.landing, "revenue", { cents, now: paidAt });
  return { src: row.src, cents, first: Boolean(first.meta.changes) };
}

// ---- What /admin shows ----

const DAY = /^\d{4}-\d{2}-\d{2}$/;
// Each source's path through the site between two UTC days (inclusive), per source, or per source and landing page
// (byLanding): {from, to, rows: [{src, landing?, label (a tracked link's), visits, new, downloads, willoDownloads,
// signups, willo, paid, revenue (US cents, without tax)}], totals, links: [{slug, label, target, opens, created,
// retired}]}. Days are when each step happened (a paid plan counts on the day it was paid).
export async function sourcesReport(env, { from, to, byLanding = false } = {}, now = Date.now()) {
  await setupSources(env);
  const today = iso(now).slice(0, 10);
  to = DAY.test(to || "") ? to : today;
  from = DAY.test(from || "") ? from : iso(Date.parse(to) - 29 * 86400e3).slice(0, 10);
  if (from > to) [from, to] = [to, from];
  const keys = byLanding ? "src, landing" : "src";
  const sum = cond => `COALESCE(SUM(CASE WHEN ${cond} THEN n END), 0)`;
  const [{ results }, { results: links }] = await Promise.all([
    env.DB.prepare(`SELECT ${keys}, ${sum("kind = 'visit'")} AS visits, ${sum("kind = 'new'")} AS new, ` +
      `${sum("kind LIKE 'download:%'")} AS downloads, ${sum("kind = 'download:willo'")} AS willoDownloads, ` +
      `${sum("kind = 'signup'")} AS signups, ${sum("kind = 'willo'")} AS willo, ${sum("kind = 'paid'")} AS paid, ` +
      "COALESCE(SUM(CASE WHEN kind = 'revenue' THEN cents END), 0) AS revenue " +
      `FROM source_events WHERE day BETWEEN ? AND ? GROUP BY ${keys} ORDER BY visits DESC, signups DESC LIMIT 500`)
      .bind(from, to).all(),
    env.DB.prepare("SELECT slug, label, target, opens, created, retired FROM source_links ORDER BY created DESC").all(),
  ]);
  const labels = new Map(links.map(l => [l.slug, l.label]));
  const rows = results.map(r => ({ ...r, label: labels.get(r.src) || null }));
  const totals = Object.fromEntries(["visits", "new", "downloads", "willoDownloads", "signups", "willo", "paid", "revenue"]
    .map(k => [k, rows.reduce((a, r) => a + (r[k] || 0), 0)]));
  return { from, to, byLanding: Boolean(byLanding), rows, totals, links };
}
