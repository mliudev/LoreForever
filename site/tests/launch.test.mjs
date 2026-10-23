// The launch (lib/billing.js): the beta promo (from the Pages variable LAUNCH_WEEK_START to BETA_END, WoW Forever's
// launch on November 4, 3 p.m. Pacific, by default, none while the start is unset), when every free account gets Hero on
// us from its first look until the launch, apart from the free budget and up to the promo's brake, and its prices (a
// plan bought then starts its months at the launch: Hero free and Champion and Legend half price until then, full price
// from it); PROMO_NOW, a preview's clock for it, which Production ignores; the welcome page the
// first companion connection goes to; and the finest-voice pack (VOICE_PACK), retired from sale on 10/19 (VOICE_PACK_SOLD)
// but kept for those bought: used after the plan's own finest replies and before the voice steps down, never expiring,
// at most three bought a month. Stripe and the voice providers are mocked through fetch; D1 is node:sqlite (helpers.mjs).
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
  LAUNCH_WEEK_BRAKE_MICRO, LEGEND_BEST_PER_MONTH, VOICE_PACK, TRIAL_MIN_SECONDS, poolWindow }
  from "../lib/billing.js";
import { allowance, answerBudgetUsed } from "../lib/companion-answers.js";

import { d1 } from "./helpers.mjs";

const ORIGIN = "https://preview.example";
const NOW = Date.parse("2026-10-20T12:00:00Z");
// The promo's start as the ship step would set it: the release published at noon on October 21, Los Angeles time.
// Its end: BETA_END unset, so the launch, November 4, 3 p.m. Pacific.
const LAUNCH_WEEK_START = "2026-10-21T19:00:00.000Z";
const START = Date.parse(LAUNCH_WEEK_START), END = Date.parse("2026-11-04T15:00:00-08:00");
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
                       "answer_user_spend", "answer_packs", "answer_holds", "starter_claims", "voice_replies", "answer_spend", "free_pool_days",
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
    if (options.method === "GET" && path.startsWith("coupons/")) return Response.json({ id: path.slice(8), percent_off: 50 });
    if (options.method === "GET" && path.startsWith("payment_intents/"))
      return Response.json({ id: path.slice(16), latest_charge: { refunded: false, amount_refunded: 0, disputed: false } });
    if (route === "POST customers") return Response.json({ id: "cus_1" });
    if (route === "GET customers") return Response.json({ data: [] });
    if (route === "GET subscriptions" || route === "GET checkout/sessions") return Response.json({ data: [] });
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

test("the beta: Hero on us for every free account from its first look, until the launch", async () => {
  assert.equal(la(END), "11/04/2026, 15:00", "the launch, by default");
  const { user } = await player("visitor");
  const at = async (ms, e = env, who = user) => {
    const p = await planFor(e, who.id, new Date(ms));
    return [p.id, p.answersPerDay, p.launch];
  };
  assert.deepEqual(await at(START - MINUTE), ["free", 30, undefined], "nothing before the release");
  assert.deepEqual(await at(START + HOUR), ["hero", 100, true], "its Hero starts at its first look in the beta");
  assert.deepEqual(await at(END - MINUTE), ["hero", 100, true], "and runs to the launch");
  assert.deepEqual(await at(END), ["free", 30, undefined], "then back on Free by itself: full price from launch");
  // Hero's plan until then: its answers a day and its 1,500 in one pool, its voices and push-to-talk.
  const hero = await planFor(env, user.id, new Date(START + 2 * HOUR));
  assert.deepEqual([hero.since, hero.until, hero.ends, hero.answersPerMonth],
    [new Date(START + HOUR).toISOString(), new Date(END).toISOString(), "November 4", 1500]);
  assert.equal(poolWindow(hero, new Date(START + 2 * HOUR)).resetsAt, hero.until, "one pool for it");
  assert.equal(poolWindow(hero, new Date(END - DAY)).resetsAt, hero.until);
  const left = await allowance(env, user.id, new Date(START + 2 * HOUR));
  assert.deepEqual([left.plan.id, left.limit, left.period, left.features.voices, left.features.push_to_talk],
    ["hero", 100, "day", "all", true]);
  // An account first seen near the end has Hero until the launch too; one first seen after it has none.
  const { user: late } = await player("late"), { user: after } = await player("after");
  assert.deepEqual(await at(END - HOUR, env, late), ["hero", 100, true]);
  assert.equal((await planFor(env, late.id, new Date(END - MINUTE))).ends, "November 4");
  assert.deepEqual(await at(END + MINUTE, env, after), ["free", 30, undefined], "joined after the launch");
  // Once per Google account: deleting it and signing in again keeps its start.
  await deleteUser(env, user);
  const { user: again } = await player("visitor");
  assert.notEqual(again.id, user.id);
  assert.equal((await planFor(env, again.id, new Date(END - HOUR))).since, hero.since, "the same one, not a new one");
  assert.deepEqual(await at(END + DAY, env, again), ["free", 30, undefined]);

  // The copy: the banner and the cards' prices during the beta (Mike, 2026-10-17).
  assert.equal(launchText(env), "Half price during the beta. Full price from launch, November 4.");
  assert.equal(launchOffer(env, "hero", new Date(START - MINUTE)), null, "nothing before the release");
  assert.deepEqual(launchOffer(env, "hero", new Date(START)),
    { price: 0, label: "Beta: free", note: "until November 4, then $4.99 a month" });
  assert.deepEqual(launchOffer(env, "champion", new Date(END - MINUTE)),
    { price: 499, label: "Beta: half price", note: "until November 4, then $9.99 a month" }, "to the last minute");
  assert.deepEqual(launchOffer(env, "legend", new Date(START)),
    { price: 999, label: "Beta: half price", note: "until November 4, then $19.99 a month" });
  assert.equal(launchOffer(env, "hero", new Date(END)), null);
  assert.equal(launchOffer(env, "champion", new Date(END)), null, "full price from the launch");
  assert.equal(launchOffer(env, "free", new Date(START)), null);
  // BETA_END moves the launch; one that isn't a date-time with its zone is the default.
  const early = { ...env, BETA_END: "2026-10-24T23:59:59-07:00" };
  assert.match(launchText(early), /from launch, October 24\.$/);
  assert.equal(launchOffer(early, "champion", new Date(Date.parse("2026-10-25T08:00:00Z"))), null);
  const { user: newcomer } = await player("newcomer");
  assert.deepEqual(await at(Date.parse("2026-10-25T08:00:00Z"), early, newcomer), ["free", 30, undefined]);
  assert.match(launchText({ ...env, BETA_END: "soon" }), /from launch, November 4\.$/);
  // Unset, or not a date-time with its zone: no promo, whenever it is.
  for (const set of [undefined, "", "next week", "2026-10-21"]) {
    const off = { ...env, LAUNCH_WEEK_START: set };
    assert.deepEqual(await at(START + HOUR, off, newcomer), ["free", 30, undefined], `LAUNCH_WEEK_START ${set}`);
    assert.equal(launchText(off), "");
    assert.equal(launchOffer(off, "champion", new Date(START + HOUR)), null);
  }
});

test("the beta's checkout: the plan's months start at the launch; Hero free and Champion and Legend half price until then", async () => {
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
    return { anchor: b.get("subscription_data[billing_cycle_anchor]"), proration: b.get("subscription_data[proration_behavior]"),
             trial: b.get("subscription_data[trial_end]") ?? b.get("subscription_data[trial_period_days]"),
             coupon: b.get("discounts[0][coupon]"), codes: b.get("allow_promotion_codes"),
             launch: b.get("subscription_data[metadata][launch]") };
  };
  // The anchor is as far from the real clock (NOW) as the launch is from the preview's.
  const day = START + 2 * DAY, anchor = String(Math.floor((NOW + END - day) / 1000));
  assert.deepEqual(await checkout("hero", at(day)),
    { anchor, proration: "none", trial: null, coupon: null, codes: "true", launch: "hero" },
    "Hero: nothing charged until the launch, then $4.99 a month from it");
  assert.deepEqual(await checkout("champion", at(day)),
    { anchor, proration: "create_prorations", trial: null, coupon: "lore_forever_beta_half", codes: null, launch: "half" },
    "Champion: half price for the days until the launch (the coupon Checkout shows, no promotion codes beside it)");
  assert.deepEqual((await checkout("legend", at(day))).coupon, "lore_forever_beta_half");
  // The last minute before the launch too; from the launch, full price as always.
  assert.equal((await checkout("champion", at(END - MINUTE))).anchor, String(Math.floor((NOW + MINUTE) / 1000)));
  for (const plan of ["hero", "champion"])
    assert.deepEqual(await checkout(plan, at(END)), { anchor: null, proration: null, trial: null, coupon: null, codes: "true",
      launch: null }, `${plan} after the launch`);

  // The beta is a price until the launch, not an offer used once: buying, cancelling and buying again has it too.
  const customer = env.DB.sqlite.prepare("SELECT customer_id FROM entitlements WHERE user_id = ?").get(user.id).customer_id;
  for (const [id, launch] of [["sub_trial", "hero"], ["sub_half", "half"]]) {
    subscriptions[id] = { id, object: "subscription", customer, status: "canceled", created: Math.floor((START + DAY) / 1000),
      cancel_at_period_end: false, metadata: { user_id: user.id, launch },
      items: { data: [{ current_period_end: Math.floor((START + DAY) / 1000),
                        price: { id: "price_hero_m", lookup_key: "hero_monthly", recurring: { interval: "month" } } }] } };
    await hook({ id: `evt_${++events}`, type: "customer.subscription.deleted", data: { object: { id, customer } } });
  }
  assert.equal((await checkout("legend", at(day))).coupon, "lore_forever_beta_half");
  const week = at(day);
  const cards = await (await billing({ env: week, params: { action: "plans" }, request: new Request(ORIGIN + "/api/billing/plans",
    { headers: { Cookie: cookie } }) })).json();
  assert.deepEqual(cards.plans.map(p => [p.id, p.promo?.label ?? null, p.promo?.note ?? null]), [["free", null, null],
    ["hero", "Beta: free", "until November 4, then $4.99 a month"], ["champion", "Beta: half price", "until November 4, then $9.99 a month"],
    ["legend", "Beta: half price", "until November 4, then $19.99 a month"]]);
  assert.equal(cards.launch, "Half price during the beta. Full price from launch, November 4.");
  const fresh = await (await billing({ env: week, params: { action: "plans" }, request: new Request(ORIGIN + "/api/billing/plans") })).json();
  assert.deepEqual(fresh.plans.map(p => p.promo?.price ?? null), [null, 0, 499, 999], "signed out, the same");
  // The plans side by side, for /willo's table (planCompare), from the plans themselves.
  assert.deepEqual(fresh.compare.map(r => [r.label, Object.values(r.values).join(" | ")]), [
    ["Answers a day", "30 | 100 | 200 | 300"],
    ["Willo's voice: when you ask out loud", "Studio | Finest | Finest, pick from ten | Richer, pick from 32"],
    ["Characters' own voices", "— | — | ✓ | ✓"],
    ["Your narrator reads the add-on's short answers", "— | ✓ | ✓ | ✓"],
    ["22 Voices of Azeroth for Willo", "— | — | — | ✓"],
    ["Willo sees your game", "— | ✓ | ✓ | ✓"],
    ["Checks the web when the lore runs out", "— | ✓ | ✓ | ✓"],
    ["Willo's style", "— | Presets | Presets or your own words | Presets or your own words"],
    ["Longer memory", "— | — | ✓ | ✓"],
    ["Willo's smarter mind", "— | — | — | ✓"],
    ["Rewrite NPCs as your own tale", "— | — | — | ✓"],
    ["New features first", "— | — | — | ✓"],
  ]);
  // The Voices of Azeroth in the plans' words, on since 0.21.0 shipped them (LOR-609).
  assert.match(fresh.plans.find(p => p.id === "legend").features.join("\n"),
    /^Pick Willo's voice: her own 10, women's and men's, or one of 22 voices of Azeroth's peoples$/m);
  // With "azeroth" off, her own five again.
  const own = await (await billing({ env: { ...week, SITE_FEATURES: `${week.SITE_FEATURES || ""},-azeroth` },
    params: { action: "plans" }, request: new Request(ORIGIN + "/api/billing/plans") })).json();
  assert.equal(own.compare[1].values.champion, "Finest, pick from five");
  assert.match(own.plans.find(p => p.id === "champion").features.join("\n"), /^Pick Willo's voice from 5$/m);
});

test("the beta's free Hero is apart from the free budget, and past its brake free accounts are on Free", async () => {
  const { user } = await player("crowd"), { user: other } = await player("busy");
  const at = new Date(START + DAY), later = new Date(END - DAY);
  // What the free months' answers cost, as an answer is reserved and then settled: never the shared free budget's.
  env.DB.sqlite.prepare("INSERT INTO answer_spend (month, reserved_micro, actual_micro, calls) VALUES (?, ?, ?, 1)")
    .run(at.toISOString().slice(0, 7), LAUNCH_WEEK_BRAKE_MICRO - 2, LAUNCH_WEEK_BRAKE_MICRO - 2);
  await addUserSpend(env, other.id, LAUNCH_WEEK_BRAKE_MICRO - 2, at, null, true);
  assert.equal(await answerBudgetUsed(env, at), 0, "none of it is the $100 free budget's");
  assert.equal((await planFor(env, user.id, at)).launch, true, "under the brake");
  // Its days in November count toward the same brake.
  await addUserSpend(env, other.id, 1, later, null, true);
  assert.equal((await planFor(env, user.id, later)).launch, true, "still under it, in November");
  await addUserSpend(env, other.id, 1, later, null, true);
  const braked = await planFor(env, user.id, later);
  assert.deepEqual([braked.id, braked.answersPerDay, braked.launch, braked.brake], ["free", 30, undefined, undefined],
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

test("on a Hero past its month's finest replies, a pack's replies are in the finest voice, then the studio voice; it's spent only when Inworld says one", async () => {
  const { user, speak } = await player("hero");
  await entitle(user, "hero");
  const period = poolWindow(await planFor(env, user.id)).key;
  const add = env.DB.sqlite.prepare("INSERT INTO voice_replies (user_id, reply, period, pieces, heard, best, created) " +
    "VALUES (?, ?, ?, 1, 1, 1, ?)");
  for (let i = 0; i < 1500; i++) add.run(user.id, `earlier-${i}`, period, new Date(NOW).toISOString());
  assert.equal((await speak("No pack yet.")).status, 200);
  assert.equal(voiceCalls.at(-1).provider, "deepinfra", "Hero's own finest replies said: the studio voice");
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

test("the finest-voice pack is retired (Mike, 2026-10-19): /plans offers none to any plan and the buy endpoint says so", async () => {
  const cookieOf = async user => (await startSession(env, new Request(ORIGIN), user.id)).split(";")[0];
  const offered = async user => {
    const res = await billing({ env, params: { action: "plans" }, request: new Request(ORIGIN + "/api/billing/plans",
      { headers: { Cookie: await cookieOf(user) } }) });
    return (await res.json()).voicePack;
  };
  const buy = async user => {
    const res = await billing({ env, params: { action: "voicepack" }, request: new Request(ORIGIN + "/api/billing/voicepack",
      { method: "POST", headers: { Cookie: await cookieOf(user), Origin: ORIGIN, "Content-Type": "application/json" }, body: "{}" }) });
    return { status: res.status, body: await res.json() };
  };
  const { user } = await player("buyer");
  const signedOut = await billing({ env, params: { action: "plans" }, request: new Request(ORIGIN + "/api/billing/plans") });
  assert.ok(!(await signedOut.json()).voicePack, "signed out: none");
  for (const plan of [null, "hero", "champion", "legend"]) {
    if (plan) await entitle(user, plan);
    assert.ok(!(await offered(user)), `${plan || "free"}: no pack offered`);
    const res = await buy(user);
    assert.equal(res.status, 400, `${plan || "free"}: not sold`);
    assert.match(res.body.error, /isn't sold anymore/);
  }
  assert.equal(stripeCalls.length, 0, "nothing reaches Stripe");
  // Legend with only a few of its finest replies left is offered nothing either: every paid plan has the finest voice.
  await entitle(user, "legend");
  const period = poolWindow(await planFor(env, user.id)).key;
  const add = env.DB.sqlite.prepare("INSERT INTO voice_replies (user_id, reply, period, pieces, heard, best, created) " +
    "VALUES (?, ?, ?, 1, 1, 1, ?)");
  for (let i = 0; i < LEGEND_BEST_PER_MONTH - 10; i++) add.run(user.id, `said-${i}`, period, new Date(NOW).toISOString());
  assert.ok(!(await offered(user)), "10 of its finest left: still none");
});
