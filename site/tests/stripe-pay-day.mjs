// The launch as every plan's pay day (lib/billing.js: payDay, the pre-order's checkout anchor, the upgrades) against
// real Stripe, in TEST mode only: what Stripe charges, read back from it rather than assumed. First a dry run of
// payDay over the whole test account (read only). Then each
// scenario gets its own customer on its own test clock, a subscription made the way the site makes it, the clock is
// advanced past the launch, and the invoices are read:
//   I  a Legend paid now, moved to the launch with a credit: charged on the launch less what it paid for the days after
//      it; then monthly from the launch
//   J  the same without the credit: the whole price on the launch
//   K  a Keep Hero trial moved to the launch: $4.99 then, nothing credited
//   L  Hero pre-ordered (anchored at the launch, no proration): nothing now, $4.99 at the launch
//   M  Champion pre-ordered with a creator's 15% (a once coupon): nothing now, $8.49 at the launch, then $9.99
//   N  an upgrade from Keep Hero before the launch (the trial kept): nothing now, Champion's $9.99 at the launch
//   O  an upgrade from a pre-ordered Champion (no proration): nothing now, Legend's $19.99 at the launch
//   P  Checkout itself takes the pre-order sessions (createCheckout, against a throwaway local D1): Hero's and Champion's
//
//   node site/tests/stripe-pay-day.mjs [I J ...]   (from the repo, in WSL; Node 22+; some scenarios only, by letter)
//
// Not a *.test.mjs: it needs the network and a test key (STRIPE_SECRET_KEY, else the repo's .env; a live key is
// refused), and takes a few minutes. Prints a PASS/FAIL line per check; deletes its test clocks (and so their
// customers) when it's done. The launch is BETA_END from the environment, else the default (November 4, 3 p.m.
// Pacific), moved to 18 days from now when that's past.
import { readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { payDay, createCheckout, setupBilling, BETA_END_DEFAULT } from "../lib/billing.js";
import { setup as setupAccounts, findOrCreateUser } from "../lib/accounts.js";
import { d1 } from "./helpers.mjs";

const KEY = (() => {
  let k = process.env.STRIPE_SECRET_KEY;
  const file = path.join(os.homedir(), "git/lore-forever/.env");
  if (!k && existsSync(file)) for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*STRIPE_SECRET_KEY\s*=\s*(.*?)\s*$/.exec(line);
    if (m) { k = m[1].replace(/^(['"])(.*)\1$/, "$2"); break; }
  }
  if (!/^[sr]k_test_/.test(k || "")) { console.error("Needs a TEST Stripe key (sk_test_ or rk_test_)."); process.exit(2); }
  return k;
})();
const DAY = 86400;
const now = Math.floor(Date.now() / 1000);
const launchAt = (() => {
  const set = Date.parse(process.env.BETA_END || BETA_END_DEFAULT);
  return set / 1000 > now + 2 * DAY ? set : (now + 18 * DAY) * 1000;
})();
const LAUNCH = Math.floor(launchAt / 1000);
// The beta, as the site has it: started a few days ago, ending at the launch.
const env = { STRIPE_SECRET_KEY: KEY, LAUNCH_WEEK_START: new Date((now - 3 * DAY) * 1000).toISOString(),
              BETA_END: new Date(launchAt).toISOString(), SITE_FEATURES: "plans" };
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const day = s => new Date(s * 1000).toISOString().slice(0, 16);

const originalFetch = globalThis.fetch;
async function S(method, p, params = {}) {
  const body = new URLSearchParams();
  const add = (v, k) => {
    if (v === undefined || v === null) return;
    if (typeof v === "object") for (const [kk, vv] of Object.entries(v)) add(vv, `${k}[${kk}]`);
    else body.append(k, String(v));
  };
  for (const [k, v] of Object.entries(params)) add(v, k);
  const q = method === "GET" && [...body].length ? `?${body}` : "";
  const res = await originalFetch(`https://api.stripe.com/v1/${p}${q}`, { method, headers: { Authorization: `Bearer ${KEY}`,
    "Stripe-Version": "2026-08-26.dahlia", ...(method === "GET" ? {} : { "Content-Type": "application/x-www-form-urlencoded" }) },
    body: method === "GET" ? undefined : body.toString() });
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${p}: ${res.status} ${data?.error?.message}`.replace(/\b(?:[sr]k|whsec)_[\w*]+/g, "[key]"));
  return data;
}
// payDay for these subscriptions only: Stripe's listing of them (a test clock's subscriptions aren't in its
// listing without the clock's id, so they're read one by one, by the status asked for).
let only = new Set();
globalThis.fetch = async (url, options = {}) => {
  const u = new URL(url);
  if ((options.method || "GET") !== "GET" || u.pathname !== "/v1/subscriptions" || !only.size) return originalFetch(url, options);
  const subs = await Promise.all([...only].map(id => S("GET", `subscriptions/${id}`)));
  return Response.json({ object: "list", data: subs.filter(x => x.status === u.searchParams.get("status")), has_more: false });
};

const clocks = [];
async function clockAt(name) {
  const c = await S("POST", "test_helpers/test_clocks", { frozen_time: now, name: `lf-payday-${name}` });
  clocks.push(c.id);
  return c.id;
}
async function advance(clock, to) {
  await S("POST", `test_helpers/test_clocks/${clock}/advance`, { frozen_time: Math.floor(to) });
  for (let i = 0; i < 300; i++) {
    const c = await S("GET", `test_helpers/test_clocks/${clock}`);
    if (c.status === "ready") return;
    if (c.status === "internal_failure") throw new Error("test clock failed");
    await sleep(2000);
  }
  throw new Error("test clock didn't finish advancing");
}
const prices = Object.fromEntries((await S("GET", "prices", { lookup_keys: ["hero_monthly", "champion_monthly", "legend_monthly"],
  active: true, limit: 10 })).data.map(p => [p.lookup_key.replace("_monthly", ""), p.id]));
async function customer(clock) {
  return (await S("POST", "customers", { test_clock: clock, email: "pay-day@lifecycle.test", payment_method: "pm_card_visa",
    invoice_settings: { default_payment_method: "pm_card_visa" } })).id;
}
const subscribe = async (clock, plan, extra = {}) => S("POST", "subscriptions", { customer: await customer(clock),
  items: [{ price: prices[plan] }], ...extra });
const paid = async sub => (await S("GET", "invoices", { subscription: sub, limit: 20 })).data
  .filter(i => i.status === "paid" && i.amount_paid > 0).map(i => i.amount_paid).reverse();
const get = id => S("GET", `subscriptions/${id}`);
const endOf = s => s.status === "trialing" ? s.trial_end : s.items.data[0].current_period_end;
// One at a time, since the scenarios run side by side and the narrowed listing is shared.
let queue = Promise.resolve();
function narrowed(sub, job) {
  const run = queue.then(async () => {
    only = new Set([sub.id]);
    try { return (await job()).subscriptions[0]; } finally { only = new Set(); }
  });
  queue = run.catch(() => {});
  return run;
}
const toPayDay = (sub, credit) => narrowed(sub, () => payDay(env, { credit, dry: false }));
const lastInvoice = async sub => (await S("GET", "invoices", { subscription: sub, limit: 1 })).data[0];

console.log(`The launch: ${new Date(launchAt).toISOString()}; the beta from ${env.LAUNCH_WEEK_START}`);
const dry = await payDay(env, { dry: true });
console.log(`Test account dry run: ${JSON.stringify(dry.counts)}`);
check("the pay day's dry run changes nothing", dry.dry === true && Array.isArray(dry.subscriptions));

const scenarios = {
  async I() {
    const clock = await clockAt("i"), s0 = await subscribe(clock, "legend");
    const r = await toPayDay(s0, true), s1 = await get(s0.id);
    check("I: on the launch, with a credit for the paid days after it", r.why === "moved" && s1.trial_end === LAUNCH &&
      r.credit > 0 && r.charge === 1999 - r.credit, `credit ${r.credit}, charge ${r.charge}`);
    check("I: moved once", (await toPayDay(s0, true)).why === "already on the day");
    await advance(clock, LAUNCH - DAY);
    check("I: nothing charged before the launch", (await paid(s0.id)).join() === "1999");
    await advance(clock, LAUNCH + 7200);
    const s2 = await get(s0.id);
    check("I: the launch's charge is the price less the credit, then monthly from it",
      (await paid(s0.id)).join() === `1999,${r.charge}` && s2.status === "active", `${(await paid(s0.id)).join()}, next ` +
      day(s2.items.data[0].current_period_end));
  },
  async J() {
    const clock = await clockAt("j"), s0 = await subscribe(clock, "legend");
    const r = await toPayDay(s0, false);
    await advance(clock, LAUNCH + 7200);
    check("J: without the credit, the whole price on the launch", r.credit === 0 && (await paid(s0.id)).join() === "1999,1999",
      (await paid(s0.id)).join());
  },
  async K() {
    const clock = await clockAt("k"), s0 = await subscribe(clock, "hero", { trial_period_days: 30, metadata: { launch: "hero" } });
    const r = await toPayDay(s0, true);
    await advance(clock, LAUNCH + 7200);
    check("K: a Keep Hero trial pays $4.99 on the launch, nothing credited", r.credit === 0 && (await paid(s0.id)).join() === "499",
      (await paid(s0.id)).join());
  },
  async L() {
    const clock = await clockAt("l");
    const s0 = await subscribe(clock, "hero", { billing_cycle_anchor: LAUNCH, proration_behavior: "none", metadata: { launch: "hero" } });
    check("L: Hero pre-ordered: active, nothing charged now", s0.status === "active" && (await paid(s0.id)).length === 0);
    await advance(clock, LAUNCH + 7200);
    const s1 = await get(s0.id);
    check("L: $4.99 at the launch, then monthly from it", (await paid(s0.id)).join() === "499" &&
      s1.items.data[0].current_period_start === LAUNCH, (await paid(s0.id)).join());
  },
  async M() {
    // A creator's first-month 15% (lib/referrals.js syncPromo: percent off, once) on a pre-order: Stripe must keep it
    // for the launch's charge, not spend it on the days before, which cost nothing.
    const coupon = "lore_forever_creator_15";
    await S("GET", `coupons/${coupon}`).catch(() => S("POST", "coupons", { id: coupon, name: "15% off your first month",
      percent_off: 15, duration: "once" }));
    const clock = await clockAt("m");
    const s0 = await subscribe(clock, "champion", { billing_cycle_anchor: LAUNCH, proration_behavior: "none",
      discounts: [{ coupon }], metadata: { preorder: "1", creator_offer: "1" } });
    check("M: Champion pre-ordered with a creator's 15%: active, nothing charged now", s0.status === "active" &&
      (await paid(s0.id)).length === 0);
    await advance(clock, LAUNCH + 7200);
    check("M: $8.49 at the launch: the 15% is on the first real charge", (await paid(s0.id)).join() === "849",
      (await paid(s0.id)).join());
    await advance(clock, LAUNCH + 31 * DAY);
    check("M: then $9.99", (await paid(s0.id)).join() === "849,999", (await paid(s0.id)).join());
  },
  async N() {
    const clock = await clockAt("n"), s0 = await subscribe(clock, "hero", { trial_end: LAUNCH, metadata: { launch: "hero" } });
    // changePlan's upgrade in the beta from a trial (keep): the price swapped, no proration, no coupon, the trial kept.
    const up = await S("POST", `subscriptions/${s0.id}`, { items: [{ id: s0.items.data[0].id, price: prices.champion }],
      proration_behavior: "none" });
    check("N: the upgrade from Keep Hero charges nothing now and keeps the trial", up.status === "trialing" &&
      up.trial_end === LAUNCH && (await paid(s0.id)).length === 0);
    await advance(clock, LAUNCH + 7200);
    check("N: Champion's $9.99 at the launch", (await paid(s0.id)).join() === "999", (await paid(s0.id)).join());
  },
  async O() {
    const clock = await clockAt("o");
    const s0 = await subscribe(clock, "champion", { billing_cycle_anchor: LAUNCH, proration_behavior: "none",
      metadata: { preorder: "1" } });
    // changePlan's upgrade before the launch from a pre-order: the price swapped, no proration.
    const up = await S("POST", `subscriptions/${s0.id}`, { items: [{ id: s0.items.data[0].id, price: prices.legend }],
      proration_behavior: "none" });
    check("O: the upgrade from a pre-ordered Champion charges nothing now", up.status === "active" &&
      (await paid(s0.id)).length === 0);
    await advance(clock, LAUNCH + 7200);
    check("O: Legend's $19.99 at the launch", (await paid(s0.id)).join() === "1999", (await paid(s0.id)).join());
  },
  async P() {
    // createCheckout itself, against Stripe test mode with a throwaway local D1: Stripe takes the pre-order sessions.
    // As Production makes them: Stripe as merchant of record (Managed Payments), on in the test account too.
    const local = { ...env, DB: d1(), STRIPE_MANAGED_PAYMENTS: "1" };
    await setupAccounts(local);
    await setupBilling(local);
    const user = await findOrCreateUser(local, { email: "pay-day-checkout@lifecycle.test", googleSub: `payday-${now}`, name: "P" });
    for (const plan of ["hero", "champion"]) {
      const out = await createCheckout(local, user, plan, undefined, "https://develop.lore-forever.pages.dev");
      const id = /\/(cs_test_[\w]+)/.exec(out.url || "")?.[1];
      const session = id ? await S("GET", `checkout/sessions/${id}`, { expand: ["line_items"] }) : null;
      check(`P: Checkout takes the pre-order ${plan} session, nothing due now`, Boolean(session?.url) && session.amount_total === 0,
        session ? `amount now ${session.amount_total}, ${session.payment_status}` : String(out.error || out.url));
      if (id) await S("POST", `checkout/sessions/${id}/expire`).catch(() => {});
    }
    const customer = local.DB.sqlite.prepare("SELECT customer_id FROM entitlements").get()?.customer_id;
    if (customer) await S("DELETE", `customers/${customer}`).catch(() => {});
  },
};

try {
  const pick = process.argv.slice(2).filter(a => scenarios[a]);
  await Promise.all((pick.length ? pick : Object.keys(scenarios)).map(name => scenarios[name]().catch(e => check(`${name}: ran`, false, e.message))));
} finally {
  for (const c of clocks) await S("DELETE", `test_helpers/test_clocks/${c}`).catch(() => {});
}
const failed = results.filter(r => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
