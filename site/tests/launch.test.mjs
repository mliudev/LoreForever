// The launch (lib/billing.js): the beta promo (from the Pages variable LAUNCH_WEEK_START to BETA_END, November 3 by
// default, none while the start is unset), when every free account gets a month of Hero on us from its first look,
// apart from the free budget and up to the promo's brake, and its offers (Keep Hero as a trial to the free month's end,
// or 30 days without one, Champion and
// Legend 50% off, once per account); PROMO_NOW, a preview's clock for it, which Production ignores; the welcome page the
// first companion connection goes to; and the finest-voice pack (VOICE_PACK), used after the plan's own finest replies and before the
// voice steps down, never expiring, at most three bought a month. Stripe and the voice providers are mocked through
// fetch; D1 is node:sqlite (helpers.mjs).
// Run: node --test 'site/tests/*.test.mjs'

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { onRequest as billing } from "../functions/api/billing/[action].js";
import { onRequest as device } from "../functions/api/device/[action].js";
import { onRequest as speakApi } from "../functions/api/companion/speak.js";
import { findOrCreateUser, startSession, setup, deleteUser } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { setupBilling, planFor, launchOffer, addUserSpend, userSpend, launchNow, previewDeploy, launchText,
  LAUNCH_WEEK_BRAKE_MICRO, LEGEND_BEST_PER_MONTH, VOICE_PACK, VOICE_PACK_TEXT, TRIAL_MIN_SECONDS, poolWindow } from "../lib/billing.js";
import { allowance, answerBudgetUsed } from "../lib/companion-answers.js";

import { d1 } from "./helpers.mjs";

const ORIGIN = "https://preview.example";
const NOW = Date.parse("2026-10-20T12:00:00Z");
// The promo's start as the ship step would set it: the release published at noon on October 21, Los Angeles time.
// Its end: BETA_END unset, so the beta's last moment, November 3, 23:59:59 Pacific.
const LAUNCH_WEEK_START = "2026-10-21T19:00:00.000Z";
const START = Date.parse(LAUNCH_WEEK_START), END = Date.parse("2026-11-03T23:59:59-08:00");
const MONTH = 30 * 86400e3;
const env = { DB: d1(), STRIPE_SECRET_KEY: "sk_test_123", STRIPE_WEBHOOK_SECRET: "whsec_test", SITE_FEATURES: "plans",
              LAUNCH_WEEK_START,
              DEEPINFRA_API_KEY: "di-test", INWORLD_API_KEY: "iw-test",
              HOSTED_VOICES: JSON.stringify({ willo: { deepinfra: "willo-studio", inworld: "willo-finest" } }) };
const originalFetch = globalThis.fetch;
const MP3 = Buffer.from("ID3\x04\x00\x00fake-mp3-frames", "latin1");
let subscriptions, sessions, voiceCalls, stripeCalls;

beforeEach(async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  await setup(env);
  await setupBilling(env);
  for (const table of ["users", "sessions", "devices", "device_links", "rate_limits", "entitlements", "billing_events",
                       "answer_user_spend", "answer_packs", "answer_holds", "starter_claims", "voice_replies", "answer_spend",
                       "promo_claims"])
    env.DB.sqlite.exec(`DELETE FROM ${table}`);
  subscriptions = {};
  sessions = {};
  voiceCalls = [];
  stripeCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    const u = new URL(url);
    if (u.hostname === "api.inworld.ai" || u.hostname === "api.deepinfra.com") {
      const provider = u.hostname === "api.inworld.ai" ? "inworld" : "deepinfra";
      voiceCalls.push({ provider, body: JSON.parse(options.body) });
      return provider === "deepinfra" ? Response.json({ audio: MP3.toString("base64") })
        : new Response(JSON.stringify({ result: { audioContent: MP3.toString("base64") } }) + "\n");
    }
    const path = u.pathname.replace("/v1/", ""), route = `${options.method} ${path}`;
    stripeCalls.push({ route, body: new URLSearchParams(options.body || "") });
    if (route === "GET prices") return Response.json({ data: [{ id: "price_voice", lookup_key: VOICE_PACK.key },
      ...["hero", "champion", "legend"].map(id => ({ id: `price_${id}_m`, lookup_key: `${id}_monthly` }))] });
    if (route === "GET subscriptions") return Response.json({ data: Object.values(subscriptions)
      .filter(s => s.customer === u.searchParams.get("customer")) });
    if (route === "GET checkout/sessions") return Response.json({ data: [] });
    if (options.method === "GET" && path.startsWith("payment_intents/"))
      return Response.json({ id: path.slice(16), latest_charge: { refunded: false, amount_refunded: 0, disputed: false } });
    if (route === "POST customers") return Response.json({ id: "cus_1" });
    if (route === "POST checkout/sessions") return Response.json({ id: "cs_new", url: "https://checkout.stripe.com/c/pay/cs_new" });
    if (options.method === "GET" && path.startsWith("subscriptions/")) return Response.json(subscriptions[path.slice(14)]);
    if (options.method === "GET" && path.startsWith("checkout/sessions/")) return Response.json(sessions[path.slice(18)]);
    return Response.json({ error: { message: `No such route: ${route}` } }, { status: 404 });
  };
});
afterEach((t) => { globalThis.fetch = originalFetch; t.mock.timers.reset(); });

const sign = body => {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${createHmac("sha256", env.STRIPE_WEBHOOK_SECRET).update(`${t}.${body}`).digest("hex")}`;
};
async function hook(event) {
  const body = JSON.stringify(event);
  const res = await billing({ env, params: { action: "webhook" }, request: new Request(ORIGIN + "/api/billing/webhook",
    { method: "POST", headers: { "Stripe-Signature": sign(body), "Content-Type": "application/json" }, body }) });
  assert.equal(res.status, 200);
}
let events = 0;
// A Hero subscription Stripe made at `createdMs`, as the webhook hears of it.
async function subscribe(user, id, createdMs, status = "active") {
  const customer = `cus_${user.id}`;
  subscriptions[id] = { id, object: "subscription", customer, status, created: Math.floor(createdMs / 1000),
    cancel_at_period_end: false, metadata: { user_id: user.id },
    items: { data: [{ current_period_end: NOW / 1000 + 20 * 86400,
                      price: { id: "price_hero_m", lookup_key: "hero_monthly", recurring: { interval: "month" } } }] } };
  await hook({ id: `evt_${++events}`, type: "customer.subscription.updated", data: { object: { id, customer } } });
}
// A player with a connected companion, made at `createdMs`.
async function player(sub, createdMs = NOW) {
  const user = await findOrCreateUser(env, { email: `${sub}@example.com`, googleSub: sub, name: sub });
  env.DB.sqlite.prepare("UPDATE users SET created = ? WHERE id = ?").run(new Date(createdMs).toISOString(), user.id);
  const link = await startLink(env);
  assert.equal(await decideLink(env, link.user_code, user, true), true);
  const { token } = await claimToken(env, link.device_code);
  const speak = async (text, reply) => {
    const res = await speakApi({ env, request: new Request(ORIGIN + "/api/companion/speak", { method: "POST",
      headers: { "X-LF-Client": "companion/0.1.0", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: "willo", ...(reply ? { reply } : {}) }) }) });
    return { status: res.status, body: res.headers.get("Content-Type")?.startsWith("audio/") ? "audio" : await res.json() };
  };
  return { user, speak };
}
const entitle = (user, plan) => env.DB.prepare("INSERT OR REPLACE INTO entitlements (user_id, subscription_id, plan, status, " +
  "current_period_end, updated) VALUES (?, ?, ?, 'active', ?, ?)").bind(user.id, `sub-${user.id}`, plan,
  new Date(NOW + 20 * 86400e3).toISOString(), new Date(NOW).toISOString()).run();
const addVoicePack = (user, id, { remaining = VOICE_PACK.replies, daysAgo = 0 } = {}) => env.DB.prepare(
  "INSERT INTO answer_packs (id, user_id, kind, answers, remaining, payment_intent, created) VALUES (?, ?, 'voice', ?, ?, ?, ?)"
).bind(id, user.id, VOICE_PACK.replies, remaining, `pi_${id}`, new Date(NOW - daysAgo * 86400e3).toISOString()).run();
const packLeft = id => env.DB.sqlite.prepare("SELECT remaining FROM answer_packs WHERE id = ?").get(id).remaining;
const MINUTE = 60e3, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
const la = ms => new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit",
  day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);

test("the beta: a full month of Hero for every free account from its first look, even past November 3", async () => {
  assert.equal(la(END), "11/03/2026, 23:59", "the beta's last minute, by default");
  const { user } = await player("visitor");
  const at = async (ms, e = env, who = user) => {
    const p = await planFor(e, who.id, new Date(ms));
    return [p.id, p.answersPerDay, p.launch];
  };
  assert.deepEqual(await at(START - MINUTE), ["free", 20, undefined], "nothing before the release");
  assert.deepEqual(await at(START + HOUR), ["hero", 100, true], "its month starts at its first look in the beta");
  assert.deepEqual(await at(END + DAY), ["hero", 100, true], "and runs past the beta's end");
  assert.deepEqual(await at(START + HOUR + MONTH - MINUTE), ["hero", 100, true], "30 days");
  assert.deepEqual(await at(START + HOUR + MONTH), ["free", 20, undefined], "then back on Free by itself");
  // Hero's plan for the month: its answers a day and its 900 in one pool, its voices and push-to-talk.
  const hero = await planFor(env, user.id, new Date(START + 2 * HOUR));
  assert.deepEqual([hero.since, hero.until, hero.ends, hero.answersPerMonth],
    [new Date(START + HOUR).toISOString(), new Date(START + HOUR + MONTH).toISOString(), "November 20", 900]);
  assert.equal(poolWindow(hero, new Date(START + 2 * HOUR)).resetsAt, hero.until, "one pool for the month");
  assert.equal(poolWindow(hero, new Date(END + DAY)).resetsAt, hero.until);
  const left = await allowance(env, user.id, new Date(START + 2 * HOUR));
  assert.deepEqual([left.plan.id, left.limit, left.period, left.features.voices, left.features.push_to_talk],
    ["hero", 100, "day", "all", true]);
  // An account first seen near the end has its own 30 days; one first seen after it has none.
  const { user: late } = await player("late"), { user: after } = await player("after");
  assert.deepEqual(await at(END - HOUR, env, late), ["hero", 100, true]);
  assert.equal((await planFor(env, late.id, new Date(END + 20 * DAY))).ends, "December 3");
  assert.deepEqual(await at(END + MINUTE, env, after), ["free", 20, undefined], "joined after the beta");
  assert.deepEqual(await at(END + DAY, env, after), ["free", 20, undefined]);
  // Once per Google account: deleting it and signing in again keeps the month's start.
  await deleteUser(env, user);
  const { user: again } = await player("visitor");
  assert.notEqual(again.id, user.id);
  assert.equal((await planFor(env, again.id, new Date(END))).until, hero.until, "the same month, not a new one");
  assert.deepEqual(await at(START + HOUR + MONTH + DAY, env, again), ["free", 20, undefined]);

  // The copy: the banner and the cards' offers during the beta (Mike, 2026-10-14).
  assert.equal(launchText(env), "Beta: Hero is free for your first month, and Champion and Legend are 50% off your " +
    "first month. Join by November 3.");
  assert.equal(launchOffer(env, "hero", new Date(START - MINUTE)), null, "nothing before the release");
  assert.deepEqual(launchOffer(env, "hero", new Date(START)),
    { price: 0, label: "Beta: free month", note: "until November 20, then $4.99 a month" }, "a trial from today");
  assert.deepEqual(launchOffer(env, "champion", new Date(END)),
    { price: 499, label: "Beta: 50% off", note: "your first month, then $9.99" }, "$4.99, exactly, to the last minute");
  assert.deepEqual(launchOffer(env, "legend", new Date(START)),
    { price: 999, label: "Beta: 50% off", note: "your first month, then $19.99" }, "$9.99, exactly");
  assert.equal(launchOffer(env, "hero", new Date(END + 1000)), null);
  assert.equal(launchOffer(env, "champion", new Date(END + 1000)), null, "no coupon after the beta");
  assert.equal(launchOffer(env, "free", new Date(START)), null);
  // BETA_END moves the end; one that isn't a date-time with its zone is the default.
  const early = { ...env, BETA_END: "2026-10-24T23:59:59-07:00" };
  assert.match(launchText(early), /Join by October 24\.$/);
  assert.equal(launchOffer(early, "champion", new Date(Date.parse("2026-10-25T08:00:00Z"))), null);
  const { user: newcomer } = await player("newcomer");
  assert.deepEqual(await at(Date.parse("2026-10-25T08:00:00Z"), early, newcomer), ["free", 20, undefined]);
  assert.match(launchText({ ...env, BETA_END: "soon" }), /Join by November 3\.$/);
  // Unset, or not a date-time with its zone: no promo, whenever it is.
  for (const set of [undefined, "", "next week", "2026-10-21"]) {
    const off = { ...env, LAUNCH_WEEK_START: set };
    assert.deepEqual(await at(START + HOUR, off, newcomer), ["free", 20, undefined], `LAUNCH_WEEK_START ${set}`);
    assert.equal(launchText(off), "");
    assert.equal(launchOffer(off, "champion", new Date(START + HOUR)), null);
  }
});

test("Keep Hero during a free Hero month: its trial ends when that month does, so the offer is one month", async () => {
  const { user } = await player("member");
  const cookie = (await startSession(env, new Request(ORIGIN), user.id)).split(";")[0];
  const at = (ms, extra = {}) => ({ ...env, PROMO_NOW: new Date(ms).toISOString(), ...extra });
  const plans = async e => (await billing({ env: e, params: { action: "plans" }, request: new Request(ORIGIN + "/api/billing/plans",
    { headers: { Cookie: cookie } }) })).json();
  const checkout = async e => {
    stripeCalls = [];
    const res = await billing({ env: e, params: { action: "checkout" }, request: new Request(ORIGIN + "/api/billing/checkout",
      { method: "POST", headers: { Cookie: cookie, Origin: ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify({ plan: "hero" }) }) });
    assert.equal(res.status, 200, await res.clone().text());
    const b = stripeCalls.find(c => c.route === "POST checkout/sessions").body;
    return { trialEnd: b.get("subscription_data[trial_end]"), trialDays: b.get("subscription_data[trial_period_days]") };
  };
  // Its first look (/plans here) starts its month.
  const monthEnd = START + HOUR + MONTH;
  assert.equal((await plans(at(START + HOUR))).current.until, new Date(monthEnd).toISOString());
  const later = START + 5 * DAY;
  assert.deepEqual(await checkout(at(later)), { trialEnd: String(Math.floor((NOW + monthEnd - later) / 1000)), trialDays: null },
    "the trial ends with the free month (as far from the real clock as from the preview's)");
  assert.equal((await plans(at(later))).plans.find(p => p.id === "hero").promo.note, "until November 20, then $4.99 a month",
    "the card says that day");
  // A beta that runs longer: near the month's end, Checkout's 48 hours at least; after it, 30 days from then.
  const long = { BETA_END: new Date(START + 40 * DAY).toISOString() };
  assert.deepEqual(await checkout(at(monthEnd - HOUR, long)),
    { trialEnd: String(Math.floor((NOW + TRIAL_MIN_SECONDS * 1000) / 1000)), trialDays: null });
  assert.deepEqual(await checkout(at(monthEnd + DAY, long)), { trialEnd: null, trialDays: "30" }, "no free month running");
});

test("the beta's checkout: Keep Hero with no free month is a 30-day trial, Champion and Legend 50% off, once per account", async () => {
  const { user } = await player("buyer");
  const cookie = (await startSession(env, new Request(ORIGIN), user.id)).split(";")[0];
  // The promo's clock on a preview (PROMO_NOW), so checkout sees the beta.
  const at = ms => ({ ...env, PROMO_NOW: new Date(ms).toISOString() });
  const checkout = async (plan, e) => {
    stripeCalls = [];
    const res = await billing({ env: e, params: { action: "checkout" }, request: new Request(ORIGIN + "/api/billing/checkout",
      { method: "POST", headers: { Cookie: cookie, Origin: ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify({ plan }) }) });
    assert.equal(res.status, 200, await res.clone().text());
    const b = stripeCalls.find(c => c.route === "POST checkout/sessions").body;
    return { trialEnd: b.get("subscription_data[trial_end]"), trialDays: b.get("subscription_data[trial_period_days]"),
             coupon: b.get("discounts[0][coupon]"), codes: b.get("allow_promotion_codes"),
             launch: b.get("subscription_data[metadata][launch]") };
  };
  const week = at(START + 2 * DAY);
  assert.deepEqual(await checkout("hero", week),
    { trialEnd: null, trialDays: "30", coupon: null, codes: "true", launch: "hero" }, "nothing charged for a full month");
  assert.deepEqual(await checkout("champion", week),
    { trialEnd: null, trialDays: null, coupon: "lore_forever_launch_champion", codes: null, launch: "half" },
    "the coupon Checkout shows, and no promotion codes beside it");
  assert.deepEqual((await checkout("legend", week)).coupon, "lore_forever_launch_legend");
  // On the beta's last day too: the full 30 days, past its end.
  assert.deepEqual((await checkout("hero", at(END - HOUR))).trialDays, "30");
  // After the beta: nothing, Hero's trial or a coupon.
  assert.deepEqual(await checkout("champion", at(END + MINUTE)),
    { trialEnd: null, trialDays: null, coupon: null, codes: "true", launch: null });
  assert.deepEqual(await checkout("hero", at(END + MINUTE)),
    { trialEnd: null, trialDays: null, coupon: null, codes: "true", launch: null });

  // Once each, ever: a subscription that had an offer (its metadata.launch) claims it, ended or not.
  const customer = env.DB.sqlite.prepare("SELECT customer_id FROM entitlements WHERE user_id = ?").get(user.id).customer_id;
  for (const [id, launch] of [["sub_trial", "hero"], ["sub_half", "half"]]) {
    subscriptions[id] = { id, object: "subscription", customer, status: "canceled", created: Math.floor((START + DAY) / 1000),
      cancel_at_period_end: false, metadata: { user_id: user.id, launch },
      items: { data: [{ current_period_end: Math.floor((START + DAY) / 1000),
                        price: { id: "price_hero_m", lookup_key: "hero_monthly", recurring: { interval: "month" } } }] } };
    await hook({ id: `evt_${++events}`, type: "customer.subscription.deleted", data: { object: { id, customer } } });
  }
  assert.deepEqual(await checkout("hero", week), { trialEnd: null, trialDays: null, coupon: null, codes: "true", launch: null },
    "buying, cancelling and buying again: no second trial");
  assert.equal((await checkout("legend", week)).coupon, null, "nor a second 50% month, Champion's or Legend's");
  const offers = await (await billing({ env: week, params: { action: "plans" }, request: new Request(ORIGIN + "/api/billing/plans",
    { headers: { Cookie: cookie } }) })).json();
  assert.deepEqual(offers.plans.map(p => [p.id, p.promo?.label ?? null]), [["free", null], ["hero", null], ["champion", null],
    ["legend", null]], "the cards stop offering them");
  const fresh = await (await billing({ env: week, params: { action: "plans" }, request: new Request(ORIGIN + "/api/billing/plans") })).json();
  assert.deepEqual(fresh.plans.map(p => p.promo?.price ?? null), [null, 0, 499, 999], "signed out, every offer shows");
  // The plans side by side, for /willo's table (planCompare), from the plans themselves.
  assert.deepEqual(fresh.compare.map(r => [r.label, Object.values(r.values).join(" | ")]), [
    ["Answers a day", "20 | 100 | 200 | 300"],
    ["Willo's voice: when you ask out loud", "Your first 30 answers | Studio | Pick from five | Finest"],
    ["Characters' own voices", "— | — | ✓ | ✓"],
    ["Willo sees your game", "— | ✓ | ✓ | ✓"],
    ["Checks the web when the lore runs out", "— | ✓ | ✓ | ✓"],
    ["Willo's style", "— | Presets | Presets or your own words | Presets or your own words"],
    ["Longer memory", "— | — | ✓ | ✓"],
  ]);
});

test("the beta's free Hero is apart from the free budget, and past its brake free accounts are on Free", async () => {
  const { user } = await player("crowd"), { user: other } = await player("busy");
  const at = new Date(START + DAY), later = new Date(END + 5 * DAY);
  // What the free months' answers cost, as an answer is reserved and then settled: never the shared free budget's.
  env.DB.sqlite.prepare("INSERT INTO answer_spend (month, reserved_micro, actual_micro, calls) VALUES (?, ?, ?, 1)")
    .run(at.toISOString().slice(0, 7), LAUNCH_WEEK_BRAKE_MICRO - 2, LAUNCH_WEEK_BRAKE_MICRO - 2);
  await addUserSpend(env, other.id, LAUNCH_WEEK_BRAKE_MICRO - 2, at, null, true);
  assert.equal(await answerBudgetUsed(env, at), 0, "none of it is the $100 free budget's");
  assert.equal((await planFor(env, user.id, at)).launch, true, "under the brake");
  // A month that runs past the beta counts toward the same brake.
  await addUserSpend(env, other.id, 1, later, null, true);
  assert.equal((await planFor(env, user.id, later)).launch, true, "still under it, in November");
  await addUserSpend(env, other.id, 1, later, null, true);
  const braked = await planFor(env, user.id, later);
  assert.deepEqual([braked.id, braked.answersPerDay, braked.launch, braked.brake], ["free", 20, undefined, undefined],
    "Free's answers from then on, and nothing says why");
  assert.equal(await userSpend(env, other.id, at), 0, "a plan bought later doesn't count the free month's answers");
});

test("PROMO_NOW moves the beta promo's clock on a preview; Production ignores it", async () => {
  const { user } = await player("tester");
  const preview = { ...env, PROMO_NOW: "2026-10-25T12:00:00-07:00" };
  const plansPage = async e => (await (await billing({ env: e, params: { action: "plans" },
    request: new Request(ORIGIN + "/api/billing/plans") })).json()).launch;
  assert.equal(previewDeploy(preview), true, "a test Stripe key");
  assert.equal((await planFor(preview, user.id)).launch, true, "it's October 20, but the preview's clock says October 25");
  assert.equal(await plansPage(preview), launchText(preview));
  assert.equal(await plansPage(env), null, "the real clock says October 20, before the beta promo");
  // The preview's clock after the month: back on Free.
  assert.equal((await planFor({ ...env, PROMO_NOW: "2026-11-25T12:00:00-08:00" }, user.id)).id, "free");
  // Production: a live key with STRIPE_LIVE, or no Stripe key at all.
  for (const production of [{ ...preview, STRIPE_SECRET_KEY: "sk_live_abc", STRIPE_LIVE: "1" },
                            { ...preview, STRIPE_SECRET_KEY: "rk_test_abc", STRIPE_LIVE: "1" },
                            { ...preview, STRIPE_SECRET_KEY: undefined }]) {
    assert.equal(previewDeploy(production), false);
    assert.equal(launchNow(production).getTime(), NOW);
    assert.deepEqual([(await planFor(production, user.id)).id, (await planFor(production, user.id)).launch], ["free", undefined]);
  }
  assert.equal(await plansPage({ ...preview, STRIPE_SECRET_KEY: "sk_live_abc", STRIPE_LIVE: "1" }), null);
});

test("the first companion connection goes to the welcome page, once, while plans are for sale", async () => {
  const signedIn = async sub => {
    const user = await findOrCreateUser(env, { email: `${sub}@example.com`, googleSub: sub, name: sub });
    return { user, cookie: (await startSession(env, new Request(ORIGIN), user.id)).split(";")[0] };
  };
  const connect = async ({ cookie }, e = env) => {
    const { user_code } = await startLink(e);
    const res = await device({ env: e, params: { action: "approve" }, request: new Request(ORIGIN + "/api/device/approve",
      { method: "POST", headers: { Cookie: cookie, Origin: ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ code: user_code }) }) });
    return res.json();
  };
  const newcomer = await signedIn("newcomer");
  assert.deepEqual(await connect(newcomer, { ...env, SITE_FEATURES: "" }), { ok: true, connected: true }, "plans off");
  assert.deepEqual(await connect(newcomer), { ok: true, connected: true, welcome: "/plans?welcome=1" });
  assert.deepEqual(await connect(newcomer), { ok: true, connected: true }, "never again");
  const subscriber = await signedIn("subscriber");
  await entitle(subscriber.user, "hero");
  assert.deepEqual(await connect(subscriber), { ok: true, connected: true }, "a player with a plan isn't sold one");
});

test("a finest-voice pack is used after Legend's own finest replies, before the studio voice, and never expires", async () => {
  const { user, speak } = await player("bard");
  await entitle(user, "legend");
  await addVoicePack(user, "cs_old", { daysAgo: 200 });   // bought months ago: still there
  const period = poolWindow(await planFor(env, user.id)).key;
  const add = env.DB.sqlite.prepare("INSERT INTO voice_replies (user_id, reply, period, pieces, heard, best, created) " +
    "VALUES (?, ?, ?, 1, 1, 1, ?)");
  for (let i = 0; i < LEGEND_BEST_PER_MONTH - 1; i++) add.run(user.id, `earlier-${i}`, period, new Date(NOW).toISOString());
  assert.equal((await speak("The plan's own last finest reply.")).status, 200);
  assert.equal(packLeft("cs_old"), VOICE_PACK.replies, "the plan's own come first");
  assert.equal((await speak("Then the pack's.", "reply-pack")).status, 200);
  assert.equal((await speak("Its second piece.", "reply-pack")).status, 200);
  assert.equal(packLeft("cs_old"), VOICE_PACK.replies - 1, "one reply, however many pieces");
  assert.deepEqual(voiceCalls.map(c => c.provider), ["inworld", "inworld", "inworld"]);
  // The pack's replies pay for themselves: none of it is the plan's month.
  const spend = env.DB.sqlite.prepare("SELECT micro, topup_micro, voice_micro FROM answer_user_spend WHERE user_id = ?").get(user.id);
  assert.equal(spend.micro - spend.topup_micro, spend.voice_micro, "only the plan's own reply is the plan's");
  env.DB.sqlite.prepare("UPDATE answer_packs SET remaining = 0 WHERE id = 'cs_old'").run();
  assert.equal((await speak("Then the studio voice.")).status, 200);
  assert.equal(voiceCalls.at(-1).provider, "deepinfra");
  assert.equal((await allowance(env, user.id)).remaining > 0, true, "it adds no answers, and takes none");
});

test("on a Hero, a pack's replies are in the finest voice, then the studio voice; it's spent only when Inworld says one", async () => {
  const { user, speak } = await player("hero");
  await entitle(user, "hero");
  assert.equal((await speak("No pack yet.")).status, 200);
  assert.equal(voiceCalls.at(-1).provider, "deepinfra", "Hero's own: the studio voice");
  await addVoicePack(user, "cs_1", { remaining: 1 });
  assert.deepEqual([(await allowance(env, user.id)).voice.tier, (await allowance(env, user.id)).voice.now], ["hosted", "finest"]);
  // Inworld down: the studio voice says it, all of it, and the reply goes back to its pack.
  const answering = globalThis.fetch;
  globalThis.fetch = async (url, options) => new URL(url).hostname === "api.inworld.ai"
    ? new Response("overloaded", { status: 503 }) : answering(url, options);
  try {
    assert.equal((await speak("Heard in the studio voice.", "reply-down")).status, 200);
    assert.equal((await speak("All of it.", "reply-down")).status, 200);
  } finally { globalThis.fetch = answering; }
  assert.deepEqual(voiceCalls.slice(1).map(c => c.provider), ["deepinfra", "deepinfra"]);
  assert.equal(packLeft("cs_1"), 1, "Inworld said none of it: still the pack's");
  assert.equal((await speak("Heard in the finest voice.")).status, 200);
  assert.equal(voiceCalls.at(-1).provider, "inworld");
  assert.equal(packLeft("cs_1"), 0);
  assert.deepEqual([(await allowance(env, user.id)).voice.tier, (await allowance(env, user.id)).voice.now], ["hosted", "studio"]);
});

test("/plans offers Legend the finest-voice pack only near its month's last finest replies, as more of them", async () => {
  const offered = async user => {
    const cookie = (await startSession(env, new Request(ORIGIN), user.id)).split(";")[0];
    const res = await billing({ env, params: { action: "plans" }, request: new Request(ORIGIN + "/api/billing/plans",
      { headers: { Cookie: cookie } }) });
    return (await res.json()).voicePack;
  };
  const { user: legend } = await player("legend");
  await entitle(legend, "legend");
  const period = poolWindow(await planFor(env, legend.id)).key;
  let replies = 0;
  const said = n => { for (let i = 0; i < n; i++) env.DB.sqlite.prepare("INSERT INTO voice_replies (user_id, reply, " +
    "period, pieces, heard, best, created) VALUES (?, ?, ?, 1, 1, 1, ?)").run(legend.id, `said-${++replies}`, period,
    new Date(NOW).toISOString()); };
  said(LEGEND_BEST_PER_MONTH - 191);
  assert.equal(await offered(legend), null, "191 of its own left: nothing to sell");
  said(1);
  const near = await offered(legend);
  assert.equal(near.text, "400 more replies in Willo's finest voice, for after your monthly 1,900 (back on November 9). " +
    "$2.99, yours until you use them.", "190 left: more of it, and when its own come back");
  assert.equal(near.open, true);
  const { user: hero } = await player("herald");
  await entitle(hero, "hero");
  const plain = await offered(hero);
  assert.deepEqual([plain.text, plain.buy, plain.open], [VOICE_PACK_TEXT, undefined, true], "Hero's offer, as it is");
});

test("finest-voice packs: three a month, on a paid plan only", async () => {
  const { user } = await player("buyer");
  const cookie = (await startSession(env, new Request(ORIGIN), user.id)).split(";")[0];
  const buy = async () => {
    const res = await billing({ env, params: { action: "voicepack" }, request: new Request(ORIGIN + "/api/billing/voicepack",
      { method: "POST", headers: { Cookie: cookie, Origin: ORIGIN, "Content-Type": "application/json" }, body: "{}" }) });
    return { status: res.status, body: await res.json() };
  };
  assert.equal((await buy()).status, 400, "the free plan has no finest voice to buy");
  await entitle(user, "champion");
  assert.equal((await buy()).status, 200);
  const session = stripeCalls.find(c => c.route === "POST checkout/sessions").body;
  assert.deepEqual([session.get("mode"), session.get("metadata[kind]"), session.get("line_items[0][price]")],
    ["payment", "voice", "price_voice"]);
  for (const id of ["cs_a", "cs_b", "cs_c"]) await addVoicePack(user, id);
  await addVoicePack(user, "cs_last_month", { daysAgo: 25 });
  const full = await buy();
  assert.equal(full.status, 400);
  assert.match(full.body.error, /this month's 3/);

  // The webhook credits a paid one once, as a pack of replies, not answers.
  sessions.cs_paid = { id: "cs_paid", object: "checkout.session", mode: "payment", customer: "cus_1",
    client_reference_id: user.id, payment_status: "paid", payment_intent: "pi_paid", metadata: { kind: "voice" } };
  const credit = { id: "evt_pack", type: "checkout.session.completed", data: { object: sessions.cs_paid } };
  await hook(credit);
  await hook({ ...credit, id: "evt_pack_again" });
  assert.deepEqual({ ...env.DB.sqlite.prepare("SELECT kind, answers, remaining FROM answer_packs WHERE id = 'cs_paid'").get() },
    { kind: "voice", answers: VOICE_PACK.replies, remaining: VOICE_PACK.replies });
  assert.equal((await allowance(env, user.id)).remaining, 200, "no answers in it: Champion's own 200 today");
});
