import { isReportRead, refuseReportEffect } from "./report-read.js";
import { markActionUncertain } from "./dashboard-action.js";
// Plans (LOR-252): what a player's subscription gives them, paid through Stripe. The free plan is Adventurer; Hero,
// Champion and Legend are monthly subscriptions, nothing yearly (Mike, 2026-10-13). A plan sets how many live answers Willo, the companion,
// gets a day and a month, and what kind (lib/companion-answers.js, functions/api/companion/answer.js): free answers
// stay with the world's lore, without web research or the game picture; paid ones may check the web, and Champion's
// and Legend's keep a longer chat memory. It sets which voice says Willo's answers out loud (PLAN_VOICE,
// lib/companion-voice.js), what a paying player's month may cost us (its text and total cost caps), and what the
// companion app may do on its own PC (COMPANION_FEATURES: Willo's voices, push-to-talk, sight). Launch plans: Mike,
// 2026-10-12; reshaped 2026-10-13 (charge for live answers, the hosted voice at least breaks even, and no player ever
// costs more than they pay).
//
// How a subscription reaches us: /plans asks POST /api/billing/checkout (functions/api/billing/[action].js), which
// makes a Stripe Checkout page (createCheckout) and sends the player there. Stripe then calls our webhook
// (POST /api/billing/webhook) with signed events (verifyWebhook); applyEvent fetches the subscription from Stripe and
// stores what it says now in `entitlements`, so an event that comes twice or out of order changes nothing (and a new
// subscriber gets one thank-you email from Mike: lib/thanks.js). Switching
// plan happens on /plans itself (changePlan: POST /api/billing/change); the card, invoices and cancelling on Stripe's
// billing portal (createPortal), which offers no plan changes. We never see card details: D1 keeps
// the plan, its status and dates, and Stripe's ids for the customer and the subscription. "Delete my account" cancels
// the subscription and removes those rows (lib/accounts.js deleteUser, cancelPlan here).
//
// The lifecycle (Mike, 2026-10-13):
// - Upgrade (Hero, Champion, Legend, in that order): now, charged now (Stripe's proration, always_invoice: never left
//   as pending invoice items for the renewal); the new plan's voice, features and month's pool start now, and answers
//   already used this plan month count against that pool (the pool is the account's, lib/companion-answers.js).
// - Downgrade: at the renewal, without a refund (a subscription schedule; entitlements.next_plan says what's coming).
// - Cancel: the plan runs to the period's end; "Keep" before then just undoes it, with nothing charged. After the end a
//   plan is a new subscription, with a new plan month.
// - A failed renewal keeps the plan while Stripe retries (past_due); when Stripe gives up, the free plan.
// - The whole of the current period's payment refunded by us, or a dispute of any of the plan's payments, ends the
//   plan now (endPlanFor); an earlier month's or an upgrade's refund is goodwill and the plan stays. A pack's refund or
//   dispute takes back that pack only. Saved styles and tales stay (lib/willo-custom.js), and so do packs otherwise.
// - One subscription per account: checkout looks at Stripe first, and a second one made anyway (two checkout pages at
//   once) is cancelled and refunded (keepOldest).
//
// The one thing bought once is the finest-voice pack (VOICE_PACK): replies in Willo's finest voice, never answers.
// POST /api/billing/voicepack makes a Checkout page in payment mode (createVoicePack); the webhook credits the pack
// once per checkout session (creditPack) and a refund or a dispute takes its replies back (refundPack). Answers can't
// be bought (Mike, 2026-10-13: the 300-answer top-up went): once a plan's answers are gone, Willo answers from the
// add-on's lore library until they come back, and the next plan up is the only offer (offersFor).
//
// The starter (the free plan's one-time STARTER_ANSWERS answers, answer_packs kind 'starter') is over: none were credited
// after 10/21, and since 10/22 (Mike: end it) the ones credited before aren't used either, so no one has answers past
// the free plan's day. Its rows stay, unused, and starter_claims still keys a Google account (starterClaim).
//
// The "plans" site feature (lib/features.js) switches all of it: while it's off (the default), nothing is for sale,
// stored subscriptions are ignored and every account gets OFF_ANSWERS a day, with research and pictures, as before
// plans. SITE_FEATURES=plans turns it on.
//
// Pages settings (Settings > Variables and Secrets):
//   STRIPE_SECRET_KEY        a key: restricted (rk_..., what Stripe recommends) or secret (sk_...); a test one on Preview
//                            (develop), a live one in Production. Without it nothing is for sale, and live answers use
//                            the free plan's limits.
//   STRIPE_WEBHOOK_SECRET    the webhook's signing secret (whsec_...), from scripts/stripe-setup.mjs --webhook. With
//                            --live it's written to .env as STRIPE_LIVE_WEBHOOK_SECRET, and Production may keep it
//                            under that name instead (verifyWebhook reads either, STRIPE_WEBHOOK_SECRET first).
//   BILLING_PLANS            optional: which plans are for sale, e.g. "hero,champion" (default: SELLABLE)
//   STRIPE_MANAGED_PAYMENTS  "1" makes Stripe the merchant of record (it handles VAT and sales tax). Only once
//                            Managed Payments is turned on in the Stripe Dashboard.
//   STRIPE_LIVE              "1" lets a live key work, in Production only. Unset, a live key is refused, so one pasted
//                            into the wrong place can't charge anyone.
//   LAUNCH_WEEK_START        when the beta promo starts (an ISO date-time with its zone): the ship step sets it in
//                            Production when the Willo release publishes. Unset, there's no promo (launchWindow).
//   BETA_END                 optional: when the beta promo ends and full price starts, WoW Forever's launch (an ISO
//                            date-time with its zone); unset, or not such a date-time, BETA_END_DEFAULT (November 4,
//                            2026, 3 p.m. Pacific).
//   PROMO_NOW                a preview's clock for the beta promo (test-mode Stripe only; Production ignores it).
// scripts/stripe-setup.mjs makes the products, prices, portal settings and webhook from the constants below.
// Kept outside functions/ so Pages doesn't route it.

import { featureOn } from "./features.js";
import { poolNow, softStep } from "./free-pool.js";
import { COMPANION_NAME } from "./brand.js";
import { thankSubscriber } from "./thanks.js";
import { createMissing, addMissing } from "./schema.js";

// Who says each plan's answers out loud (LOR-490, Mike, 2026-10-13): "local" (Willo's voices made on the player's PC,
// free to us), "chatterbox" (its studio voices: DeepInfra's Chatterbox Turbo, lib/companion-voice.js) or "inworld" (its
// finest voice, Inworld's "model", for the first "best" replies of the plan month, then the studio voice). A spoken reply
// is just an answer read aloud, counted once, as an answer. choice: the player may pick among Willo's hosted voices.
// Willo's own voices on the PC (Kokoro) only stand in when a hosted one is slow or down, or the month's room for it is
// used. The free plan (Mike, 2026-10-13, the fastest route): its first STARTER_ANSWERS replies in the studio voice
// (starter), paid for by the shared free budget, about $0.009 a new player; then text (COMPANION_FEATURES below). Hero
// has the studio voice on every answer, without a choice, and asks out loud. Moving a plan to another voice is one line
// here; the cost caps below already cover it (Hero's busiest month on Chatterbox costs about $2.39 of its $4.37).
// Legend's finest voice is Inworld TTS 2 Flash ($15 a million characters), whose cost breaks even over about 1,900
// replies a month; "inworld-tts-2" ($25) is the one-line way back (lib/companion-voice.js prices both).
export const LEGEND_BEST_MODEL = "inworld-tts-2-flash";
export const LEGEND_BEST_PER_MONTH = 6000;
// Option D (Mike, 2026-10-19: "OK this is good enough for now let's ship it", the pricing review): her voice gets
// better with each plan. Free answers out loud in her studio voice on every spoken answer (always: no starter count;
// the shared free budget pays, about $0.0002 a reply). Hero hears her finest voice (Inworld TTS 2 Flash) on every reply,
// Champion picks hers too and characters answer in their own, and Legend's is richer (Inworld TTS 2, RICHER_MODEL).
// best is the plan month's answers, so every reply is the finest one; the total cost cap still steps the voice down
// before a month would cost more than the plan brings.
export const RICHER_MODEL = "inworld-tts-2";
const POOL = { free: 900, hero: 1500, champion: 3000, legend: 6000 };
// Characters who answer in person in a voice of their own (lib/character-voices.js; Mike, 2026-10-13: Inworld TTS 2
// Flash, CHARACTER_MODEL, with Fish S2.1 Pro when Inworld is slow or down): characters is how many of a plan month's
// replies they get, a number of their own (Champion's), or "best" (Legend's: out of its finest replies, at the same
// $15 a million letters as Willo's own). Free and Hero have none: their characters speak in Willo's voice, unless a
// finest-voice pack (VOICE_PACK) pays. A 300-letter character line costs about $0.0045 (Fish's, about $0.0047 and
// more with its cues), so a maxed Champion month (its text, and all 1,900 replies spoken, 300 of them by characters)
// costs about $6.25 of its $9.05, and Legend's finest replies cost the same whoever says them (about $18.38 of $18.41
// for a maxed month); past that the total cap steps the voice down, so neither costs more than its net.
export const CHAMPION_CHARACTER_REPLIES = 300;
export const CHARACTER_MODEL = "inworld-tts-2-flash";
export const PLAN_VOICE = {
  free: { voice: "chatterbox", choice: false, always: true, whole: true },
  hero: { voice: "inworld", choice: false, best: POOL.hero, model: LEGEND_BEST_MODEL, whole: true },
  champion: { voice: "inworld", choice: true, best: POOL.champion, model: LEGEND_BEST_MODEL, characters: "best",
              whole: true },
  legend: { voice: "inworld", choice: true, best: POOL.legend, model: RICHER_MODEL, characters: "best", azeroth: true,
            whole: true },
};
// The voices and plans picks (Mike, 2026-10-21: "voices and plans picks make sense ship it"): the Voices of Azeroth are
// Legend's (azeroth: lib/companion-voice.js picksFor and willoPick; Champion picks among her own). Every plan hears her
// whole answer spoken (whole: the companion speaks the written answer after her first words, not only its short spoken
// part, with no "I've written the rest out"; Mike, 2026-10-21: "it should always just read everything from now on"),
// at most WHOLE_MAX_CHARS letters a reply (lib/companion-voice.js replyMax). The add-on's short
// answers are read in the player's own narrator's voice from Hero up (READINGS_FROM; lib/companion-voice.js
// speakReading), on the studio engine; Free sees them as text.
export const READINGS_FROM = "hero";

// The plans, cheapest first. Prices and net (what a month brings after Stripe's fees) in US cents. A plan's answers are
// a month's pool (answersPerMonth) with a most in one day (answersPerDay), and lookupsPerMonth of them may look online
// (required research or a quick look-up; a finding another player's search kept is free): a quiet guard inside the
// cost caps, never a number players read (WEB below). A paid plan's month runs from
// its renewal day (poolWindow), so a month paid for never holds two pools; the free plan's is the calendar month.
// The cost caps (Mike, 2026-10-13): a paying player's live answers may cost us half of their plan's net in a calendar
// month (costCapMicro, the text cap, millionths of a dollar), and their answers and hosted voice together the whole of
// it (totalCapMicro). Past the text cap their answers step down to Flash-Lite without looking online (capState "lite"),
// and once the total is reached they come from the add-on's lore library (as when the month's pool is used) until the
// next month; the hosted voice steps down to a cheaper one, then to Willo's own voice on the PC, before the total would
// pass. At about $0.0012 an answer on Flash-Lite and $0.05 a look-up, a maxed Hero or Champion month stays under its
// text cap; Legend's answers on 3.6 Flash (smarter: about $0.0035 each, twice that from 2027) reach it after about
// 2,050 answers (1,040 from 2027) of its 4,000; players ask about 11 a day they play.
// longMemory: chat memory keeps twice as much. smarter: her answers, pictures too, on the smarter model
// (lib/companion-answers.js SMART_MODEL, Gemini 3.6 Flash; Mike, 10/19: "yes to both": Legend's only). stronger:
// answers and character replies on the stronger model (RESEARCH_MODEL); no plan has it: 3.8 Flash costs what 3.6 Flash
// does but is over a second slower to her first word (the model bake-off, 10/19).
const caps = net => ({ net, costCapMicro: Math.floor(net / 2) * 10_000, totalCapMicro: net * 10_000 });
export const PLANS = {
  free: { id: "free", name: "Adventurer", monthly: 0, answersPerDay: 30, answersPerMonth: POOL.free,
          lookupsPerMonth: 0, costCapMicro: 0 },
  hero: { id: "hero", name: "Hero", monthly: 499, answersPerDay: 100, answersPerMonth: POOL.hero,
          lookupsPerMonth: 10, ...caps(437) },
  champion: { id: "champion", name: "Champion", monthly: 999, answersPerDay: 200, answersPerMonth: POOL.champion,
              lookupsPerMonth: 20, longMemory: true, ...caps(905) },
  legend: { id: "legend", name: "Legend", monthly: 1999, answersPerDay: 300, answersPerMonth: POOL.legend,
            lookupsPerMonth: 80, longMemory: true, smarter: true, ...caps(1841) },
};
export const PAID = Object.keys(PLANS).filter(id => id !== "free");

// The free plan's old spoken starter's replies (lib/companion-voice.js, before PLAN_VOICE.free.always). The starter's
// answers are over (above): since option D (10/21) the free plan is 30 answers a day, and after them she says once
// that she's resting her voice and writes (the first-run trial is the newcomer's taste now).
export const STARTER_ANSWERS = 30;
// Willo's best first: an account's first live answers at her best (lib/best-first.js, which uses it; kept here so the
// plan cards can say it without the two modules loading each other first).
export const TASTE_ANSWERS = 50;
// Its first-run trial's days (lib/best-first.js TRIAL_DAYS, which the Pages variable TRIAL_DAYS can change; Mike,
// 2026-10-19: "I think 7 days is more than enough").
export const TRIAL_DAYS = 7;
// Willo's voices in the companion app (companion/lore_companion/talk/tts.py KOKORO_VOICES); the free plan has its
// default one.
export const WILLO_VOICES = 7;
// Willo's hosted voices a plan with PLAN_VOICE choice picks from (lib/companion-voice.js WILLO_PICKS), and the Voices of
// Azeroth it picks from too (AZEROTH_VOICES, lib/companion-voice.js AZEROTH_PICKS, LOR-609): what /plans and the
// Stripe blurbs say of them waits for the site feature "azeroth" (lib/features.js: on in the release whose companion
// has them in its picker).
// Her male partners (WILLO_PARTNERS, LOR-610) count among her own once "azeroth" is on too.
export const HOSTED_PICKS = 5;
export const WILLO_PARTNERS = 5;
export const AZEROTH_VOICES = 22;
// How many voices Champion and Legend pick Willo's from, as /plans says it (the thank-you email, lib/thanks.js).
// planId: the Voices of Azeroth count only on the plan that has them (PLAN_VOICE azeroth, Legend's).
export const voicePicks = (env, planId = "legend") => !featureOn(env, "azeroth") ? HOSTED_PICKS
  : HOSTED_PICKS + WILLO_PARTNERS + (PLAN_VOICE[planId]?.azeroth ? AZEROTH_VOICES : 0);
const pickLine = azeroth => azeroth
  ? `Pick ${COMPANION_NAME}'s voice: her own ${HOSTED_PICKS + WILLO_PARTNERS}, women's and men's, or one of ` +
    `${AZEROTH_VOICES} voices of Azeroth's peoples`
  : `Pick ${COMPANION_NAME}'s voice from ${HOSTED_PICKS}`;
// Champion's picker: her own voices, her male partners among them once the Voices of Azeroth are out (they came
// together, LOR-610); the Voices of Azeroth themselves are Legend's (PLAN_VOICE azeroth).
const ownPickLine = azeroth => azeroth
  ? `Pick ${COMPANION_NAME}'s voice from her own ${HOSTED_PICKS + WILLO_PARTNERS}, women's and men's`
  : `Pick ${COMPANION_NAME}'s voice from ${HOSTED_PICKS}`;

// What the companion app may do on each plan, sent with the allowance (lib/companion-answers.js `features`): Willo's
// session turns its own features on or off by it. voices: "all" of Willo's voices, only its "default" one, or "none"
// (answers show as text and nothing is spoken: the free plan once its spoken starter is used); push_to_talk: asking
// out loud; sight: Willo sees the game (the site also drops a free player's picture); npc_voices: unused since
// characters answer in Willo's own voice (older companions still read it); research: answers that check the web (the
// site also enforces it).
export const COMPANION_FEATURES = {
  free: { voices: "default", push_to_talk: false, sight: false, npc_voices: false, research: false, reminders: false },
  paid: { voices: "all", push_to_talk: true, sight: true, npc_voices: true, research: true, reminders: true },
};
// starter: the free plan's spoken starter replies left (lib/companion-voice.js voiceAllowance starterLeft). Typed
// questions get text answers; only questions asked out loud are answered aloud (Mike, 2026-10-14), so while the
// starter lasts a free account may ask out loud (push_to_talk) and Willo answers in her studio voice; after it, free
// answers are text and there's no asking out loud. The same 30 spoken replies are counted. The beta's free Hero month
// (planFor launch) is Hero's. taste: the free plan's best first (lib/best-first.js tasteState), whose answers left ask
// out loud, see the game and look online as a paid plan's do, and whose finest replies still owed are spoken. Its
// trial (taste.trial, lib/best-first.js trialOf), while its days last: all of Willo's voices on the PC, asking out
// loud, goals and reminders, and sight and look-ups while their uses last. Since option D (Mike, 2026-10-19) the free
// plan asks out loud and hears her studio voice always (PLAN_VOICE.free.always), not only for its starter.
export function companionFeatures(plan, { starter = 0, taste = null } = {}) {
  if (plan.id !== "free") return COMPANION_FEATURES.paid;
  const asks = Boolean(taste?.on && taste.left > 0), trial = taste?.trial?.on ? taste.trial : null;
  const talks = Boolean(PLAN_VOICE.free.always);
  return { ...COMPANION_FEATURES.free, voices: trial ? "all" : talks || starter > 0 || taste?.on ? "default" : "none",
           push_to_talk: talks || starter > 0 || asks || Boolean(trial), ...(asks ? { sight: true, research: true } : {}),
           ...(trial ? { sight: trial.left.sight > 0, research: trial.left.lookups > 0, reminders: true } : {}) };
}

// What /plans lists on each plan's card, in plain words: how it feels to play with Willo first, then the month's
// answers. Counts, never limits: no "unlimited", "limit", "cap" or "fair use" in what players read (Mike, 2026-10-13).
// The style and the tales are /willo/style (lib/willo-custom.js).
const NAME = COMPANION_NAME;
const count = n => n.toLocaleString("en-US");
const answers = plan => `${count(plan.answersPerMonth)} ${NAME} answers a month`;
// Web look-ups aren't a number players read (Mike, 2026-10-13): a plan's lookupsPerMonth is a quiet guard inside its
// cost caps, and past it Willo answers from the lore and the searches other players' questions kept.
const WEB = `${NAME} can check the web when the lore runs out`;
// The voices and plans picks (Mike, 2026-10-21): Hero's card sells in words, at a glance, since players buy before they
// hear her (her finest voice, and the narrator reads the add-on's short answers); Legend's adds the Voices of Azeroth,
// and new features first. readings waits for the release whose companion does it
// (lib/features.js), so a card never promises what the app can't do yet.
const READS = `your narrator reads the add-on's short answers`;
const FIRST = {
  free: `Chat with ${NAME}: ${PLANS.free.answersPerDay} answers a day, out loud when you ask out loud. Your first ` +
        `${TRIAL_DAYS} days, try everything she can do, a few times each, with your first ${TASTE_ANSWERS} answers in ` +
        "her finest voice",
  hero: readings => readings ? `${NAME}'s finest voice on every answer, and ${READS}`
    : `${NAME}'s finest voice on every answer you ask out loud`,
  champion: `Characters answer in their own voices, up to 8 hours a day`,
  legend: `${NAME}'s richer voice and smarter mind`,
};
const NEW_FIRST = "New features first";
// azeroth: the Voices of Azeroth are in the picker (the site feature "azeroth", or the asking companion has them);
// readings: the site feature of that name (lib/features.js).
export const planFeatures = ({ azeroth = false, readings = false } = {}) => ({
  free: [FIRST.free, "The whole add-on, every narration pack and language"],
  hero: [FIRST.hero(readings), answers(PLANS.hero), `${NAME} sees your game and keeps your goals`, WEB,
         `Reminders and preset ${NAME} styles`],
  champion: [FIRST.champion, ownPickLine(azeroth), answers(PLANS.champion), `${NAME}'s longer memory`,
             `Write ${NAME}'s personality`, "Everything in Hero"],
  legend: [FIRST.legend, ...(azeroth ? [pickLine(azeroth)] : []), answers(PLANS.legend), NEW_FIRST,
           "Rewrite NPCs as your own tale", "Everything in Champion"],
});
// The site features the cards read, for a request (env) or for the code's own default (null).
export const cardFlags = env => ({ azeroth: featureOn(env, "azeroth"), readings: featureOn(env, "readings") });
// /willo's one line about the plans (functions/willo.js): what Hero leads with, as its card says it.
export const plansLine = env => `From Hero, ${planFeatures(cardFlags(env)).hero[0]}.`;
const AZEROTH = featureOn(null, "azeroth");   // the code's own switch: the Stripe blurbs have no request
export const FEATURES = planFeatures(cardFlags(null));
// /plans' one line of fine print about the finest voice.
export const VOICE_NOTE = `${NAME}'s finest voice on every spoken answer from Hero up, and Legend's is richer; in an ` +
  "unusually busy month she may answer in her studio voice.";

// The line under each plan's name on Stripe's checkout page, invoices and billing portal (its product's description,
// set by scripts/stripe-setup.mjs, whose next run publishes a change here).
// blurbs(flags): the same, for flags other than the code's own (scripts/stripe-setup.mjs --print stages them).
export const blurbs = ({ azeroth = AZEROTH, readings = featureOn(null, "readings") } = {}) => ({
  hero: `${FIRST.hero(readings)}: ${answers(PLANS.hero)}, and ${NAME} sees your game and keeps your goals. ${WEB}.`,
  champion: `${FIRST.champion}: ${answers(PLANS.champion)}, ${NAME}'s longer memory and ${NAME}'s personality in ` +
            `your words. ${ownPickLine(azeroth)}. Everything in Hero too.`,
  legend: `${FIRST.legend}: ${answers(PLANS.legend)}, ` + (azeroth ? `the ${AZEROTH_VOICES} Voices of Azeroth, ` : "") +
          `new features first, NPCs rewritten as your own tale, and everything in Champion.`,
});
export const BLURBS = blurbs();

// For sale unless BILLING_PLANS says otherwise. A hidden plan is never for sale or listed.
export const SELLABLE = ["hero", "champion", "legend"];

// The finest-voice pack (Mike, 2026-10-13): `replies` of a paying player's spoken replies in Willo's finest voice
// (Inworld, LEGEND_BEST_MODEL), bought once, never expiring, at most monthMax a calendar month, on any paid plan. It
// adds no answers. Its replies are used after the plan's own finest ones (Legend's LEGEND_BEST_PER_MONTH) and before
// the voice steps down to the studio voice or the PC (lib/companion-voice.js), oldest pack first. costCapMicro: what a
// pack's replies may cost us, about what it brings after Stripe's fees; past it they step down like the plan's own.
// Kept in answer_packs (kind 'voice'). key, product: its Stripe price's lookup key and product's id.
export const VOICE_PACK = { replies: 400, price: 299, monthMax: 3, costCapMicro: 2_600_000, key: "voice_400",
                            product: "lore_forever_voice_pack" };
// Retired with option D (Mike, 2026-10-19; none sold): every paid plan hears the finest voice now. Packs bought before
// still work; /plans no longer offers one, and /api/billing/voicepack says it isn't sold.
export const VOICE_PACK_SOLD = false;
// What /plans says of it, plain, no meters; and its Stripe product's description (scripts/stripe-setup.mjs).
export const VOICE_PACK_TEXT = `${VOICE_PACK.replies} replies in ${COMPANION_NAME}'s finest voice, ` +
  `$${(VOICE_PACK.price / 100).toFixed(2)}, yours until you use them.`;
export const VOICE_PACK_BLURB = `${VOICE_PACK.replies} replies in ${COMPANION_NAME}'s finest voice, used after your ` +
  "plan's own. Yours until you use them.";

// The beta promo (LOR-500, Mike, 2026-10-14: "If you sign up during the beta, you get half off or free hero for a
// month"; then 2026-10-17: "the promise for the plans is half off for the beta period only, then full price for when
// the full game launches"). It runs from the moment the Willo release publishes to WoW Forever's launch
// (launchWindow): the start is the Pages variable LAUNCH_WEEK_START (an ISO date-time with its zone, e.g.
// "2026-10-20T18:30:00Z"; named for the launch week it first started), which the ship step sets in Production when it
// publishes the release, and the end is BETA_END, the same kind of date-time, or BETA_END_DEFAULT (the launch,
// November 4, 3 p.m. Pacific: Blizzard) when that's unset or not one. LAUNCH_WEEK_START unset or not such a
// date-time: no promo at all, nothing on /plans. The launch is every plan's pay day: from it, everyone pays full price.
// - Hero on us, with no card (planFor, with launch: true): a signed-in free account's free Hero month starts the first
//   time its plan is looked at during the beta (signing in on /account or /plans, or the companion's first check;
//   freeHeroMonth) and runs to the launch (or BETA_HERO_DAYS, if that's sooner). Once per Google account, ever (its
//   "free" claim in promo_claims, with the month's start), so deleting the account and coming back doesn't start
//   another. It's Hero's plan: Hero's 900 answers (one pool: poolWindow reads `until`) and 100 a day, look-ups, sight,
//   styles, and all of Willo's voices on the PC with push-to-talk; they don't count toward the free plan's month.
//   At the launch the account is on the free plan again by itself.
// - What those answers cost is kept apart (answer_user_spend.launch_micro): never the shared free budget's, nor a plan
//   bought later's; Hero's cost caps hold it for each account. Once the promo's total passes LAUNCH_WEEK_BRAKE_MICRO,
//   free accounts are on the free plan (months under way stop, no new one starts), and nothing says so.
// - A plan bought during the beta (createCheckout) starts its months at the launch (billing_cycle_anchor), so its
//   first full charge is then and every month after is the full price. Until then: "Keep Hero" is free (no
//   proration: nothing charged before the launch), and Champion and Legend are half price for the days left (a
//   prorated first invoice with BETA_HALF on it: 50% off, once). An upgrade then is half price for the days left too
//   (changePlan), and one from a plan that's free until the launch (a Stripe trial: Keep Hero, or a plan moved to
//   the launch by payDay) keeps it free until then. The plans bought before this (the 11 of 2026-10-18) were moved to
//   the launch by payDay, with what they'd paid for the days after it credited back.
// - /plans and /account say so (launchText: "Half price during the beta. Full price from launch, November 4."; the
//   cards' crossed-out prices and tags) during the beta; a free Hero month and Keep Hero say the day they end.
export const BETA_END_DEFAULT = "2026-11-04T15:00:00-08:00";
export const BETA_HERO_DAYS = 30;
const DAY_MS = 86400e3;
// Checkout's shortest trial_end (48 hours, and a little): the soonest payDay moves a plan to.
export const TRIAL_MIN_SECONDS = 2 * 86400 + 600;
// The beta's half price (BETA_HALF): Stripe's coupon for the days until the launch, 50% off once (the prorated first
// invoice, or an upgrade's), for Champion and Legend. Stripe won't put an amount_off coupon on a prorated first
// invoice, so it's a percent_off one; made by scripts/stripe-setup.mjs, or by the site itself the first time it's
// needed (betaCoupon). name: what Checkout and the invoice show (40 characters at most).
export const BETA_HALF = { id: "lore_forever_beta_half", percentOff: 50, name: "Beta: half price until launch",
                           plans: ["champion", "legend"] };
// The first months' $5 and $10 off from before (2026-10-14 to 10-18): no longer offered, kept for the subscriptions that
// had them (/admin's comps leave them out) and for scripts/stripe-setup.mjs.
export const LAUNCH_COUPONS = {
  champion: { id: "lore_forever_launch_champion", amountOff: 500, name: "Beta: 50% off your first month" },
  legend: { id: "lore_forever_launch_legend", amountOff: 1000, name: "Beta: 50% off your first month" },
};
// Which beta price a plan has, for its metadata.launch and promo_claims (/admin's counts): Hero free ("hero"), or
// Champion's or Legend's half price ("half"). The free Hero month's claim is "free" (freeHeroMonth).
const offerKind = planId => planId === "hero" ? "hero" : BETA_HALF.plans.includes(planId) ? "half" : null;
export const LAUNCH_WEEK_BRAKE_MICRO = 300_000_000;
const ISO_MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const moment = v => { const s = String(v ?? "").trim(); return ISO_MOMENT.test(s) ? Date.parse(s) : NaN; };
// The beta promo, from LAUNCH_WEEK_START to BETA_END (the launch, not included): {start, end} (milliseconds), or null
// when the start isn't set to an ISO date-time (or isn't before the end).
export function launchWindow(env) {
  const start = moment(env?.LAUNCH_WEEK_START), set = moment(env?.BETA_END);
  const end = Number.isFinite(set) ? set : Date.parse(BETA_END_DEFAULT);
  return Number.isFinite(start) && end > start ? { start, end } : null;
}
// Whether `at` (a Date: launchNow's, or when a subscription was made) is in the beta promo: before the launch.
export function launchWeek(env, at = launchNow(env)) {
  const week = launchWindow(env), ms = at?.getTime?.();
  return Boolean(week) && Number.isFinite(ms) && ms >= week.start && ms < week.end;
}
// A day as players read it: "November 4" (Pacific time, where the promo is told).
const pacificDay = ms => new Date(ms).toLocaleDateString("en-US", { month: "long", day: "numeric",
  timeZone: "America/Los_Angeles" });
// The launch's day, the beta promo's end: "November 4".
export const launchEnds = env => {
  const week = launchWindow(env);
  return week ? pacificDay(week.end) : "";
};
// The line /plans (its banner) and /account show during the beta; "" with no promo.
export const launchText = env => launchWindow(env)
  ? `Half price during the beta. Full price from launch, ${launchEnds(env)}.` : "";
const usd = cents => `$${(cents / 100).toFixed(2)}`;
// A plan card's beta price (now: launchNow's), as GET /api/billing/plans sends it (plans[].promo): {price (US cents a
// month until the launch; the usual price is the plan's monthly), label, note}, or null (not the beta, or Adventurer).
export function launchOffer(env, planId, now = launchNow(env)) {
  if (!launchWeek(env, now)) return null;
  const plan = PLANS[planId], kind = offerKind(planId), until = `until ${launchEnds(env)}, then ${usd(plan.monthly)} a month`;
  if (kind === "hero") return { price: 0, label: "Beta: free", note: until };
  return kind === "half" ? { price: Math.floor(plan.monthly / 2), label: "Beta: half price", note: until } : null;
}

// The plans side by side (GET /api/billing/plans compare, for /willo's and /plans' table): [{label, values: {free,
// hero, champion, legend}}], all strings ("✓" and "—" for yes and no), from PLANS, PLAN_VOICE and COMPANION_FEATURES,
// and allowed (lib/willo-custom.js ALLOWED: what each plan may customize; passed in, since that file reads this one);
// azeroth: the Voices of Azeroth count among the picks (planFeatures).
// Look-ups are never a count here (WEB).
const WORDS = ["none", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
export function planCompare(allowed = {}, { azeroth = false, readings = false } = {}) {
  const row = (label, of) => ({ label, values: Object.fromEntries(Object.keys(PLANS).map(id => [id, of(id)])) });
  const yes = on => on ? "✓" : "—";
  const paid = id => id !== "free";
  const features = id => COMPANION_FEATURES[paid(id) ? "paid" : "free"];
  const voice = id => {
    const v = PLAN_VOICE[id];
    if (v.starter) return `Your first ${STARTER_ANSWERS} answers`;
    const picks = HOSTED_PICKS + (azeroth ? WILLO_PARTNERS + (v.azeroth ? AZEROTH_VOICES : 0) : 0);
    const kind = v.voice === "inworld" ? (v.model === RICHER_MODEL ? "Richer" : "Finest") : "Studio";
    return v.choice ? `${kind}, pick from ${WORDS[picks] || picks}` : kind;
  };
  const style = id => (allowed[id] || []).includes("words") ? "Presets or your own words"
    : (allowed[id] || []).includes("presets") ? "Presets" : "—";
  return [
    row("Answers a day", id => count(PLANS[id].answersPerDay)),
    row(`${NAME}'s voice: when you ask out loud`, voice),
    row("Characters' own voices", id => yes(Boolean(PLAN_VOICE[id].characters))),
    ...(readings ? [row("Your narrator reads the add-on's short answers", id => yes(paid(id)))] : []),
    ...(azeroth ? [row(`${AZEROTH_VOICES} Voices of Azeroth for ${NAME}`, id => yes(Boolean(PLAN_VOICE[id].azeroth)))] : []),
    // Asking out loud is the voice row's (free has its first answers aloud), so this row is only sight.
    row(`${NAME} sees your game`, id => yes(features(id).sight)),
    row("Checks the web when the lore runs out", id => yes(features(id).research)),
    row(`${NAME}'s style`, style),
    row("Longer memory", id => yes(Boolean(PLANS[id].longMemory))),
    row(`${NAME}'s smarter mind`, id => yes(Boolean(PLANS[id].smarter))),
    row("Rewrite NPCs as your own tale", id => yes((allowed[id] || []).includes("tales"))),
    row("New features first", id => yes(id === "legend")),
  ];
}
// The beta prices by plan (launchOffer), the same for every account: the beta is a price until the launch, not an offer
// used once.
export async function launchOffers(env, userId, now = launchNow(env)) {
  const out = {};
  for (const id of PAID) {
    const offer = launchOffer(env, id, now);
    if (offer) out[id] = offer;
  }
  return out;
}

// BETA_HALF's id once Stripe has it (made the first time it's needed, with the site's own key), or null when it can't
// be made (the key may not write coupons: then scripts/stripe-setup.mjs, or the Dashboard, makes it). Looked up once
// per isolate and Stripe mode.
const couponsReady = new Set();
export async function betaCoupon(env) {
  const mode = /^[sr]k_live_/.test(String(env.STRIPE_SECRET_KEY || "")) ? "live" : "test";
  if (couponsReady.has(mode)) return BETA_HALF.id;
  try {
    await stripe(env, "GET", `coupons/${BETA_HALF.id}`);
  } catch (e) {
    if (e.status !== 404) { console.warn(`billing: reading coupon ${BETA_HALF.id}: ${e.message}`); return null; }
    try {
      await stripe(env, "POST", "coupons", { id: BETA_HALF.id, name: BETA_HALF.name, percent_off: BETA_HALF.percentOff,
        duration: "once", applies_to: { products: BETA_HALF.plans.map(id => `lore_forever_${id}`) } },
        { idempotencyKey: `coupon-${BETA_HALF.id}` });
    } catch (e2) {
      console.warn(`billing: can't make coupon ${BETA_HALF.id}: ${e2.message}`);
      return null;
    }
  }
  couponsReady.add(mode);
  return BETA_HALF.id;
}

// Every live subscription in this deployment's Stripe (active, trialing, past_due), as Stripe has them now.
async function liveSubscriptionsAll(env) {
  const subs = [];
  for (const status of ["active", "trialing", "past_due"]) {
    let after = null;
    do {
      const page = await stripe(env, "GET", "subscriptions",
        { status, limit: 100, ...(after ? { starting_after: after } : {}) });
      subs.push(...(page?.data || []));
      after = page?.has_more ? page.data.at(-1)?.id : null;
    } while (after);
  }
  return subs;
}

// The launch as every plan's pay day (Mike, 2026-10-17: "the promise for the plans is half off for the beta period
// only, then full price for when the full game launches"), for the plans bought before checkout anchored them there
// (/admin's "pay-day", once, at 2026-10-18 03:30 UTC for the 11 then): every live plan's next charge on `at` (an ISO
// date-time with its zone; the launch, launchWindow's end, unless given), a Stripe trial to it with no proration
// (Stripe's way to move a billing date: nothing charged or credited by the move). A paying plan's
// month already paid runs past it, so with `credit` the part of what it paid for those days goes back as a credit on
// the account's Stripe balance, which that charge uses first (so nobody pays twice for the same days); without it,
// those days are lost. What a plan paid is its paid invoices (amount_paid over 0) whose period runs past the day, each
// in proportion: a 50% first month credits half as much, and a comped plan or a trial nothing. The charge on the day
// is Stripe's own preview of the plan's next invoice (its price and any discount still on it), less the credit.
// A plan the player cancelled is never charged again: a trial (nothing paid) ends on the day, and a paid one when
// what it paid for ends (its cancellation moves with it; no credit, since nothing more is charged).
// Dry (the default) only reads; otherwise each one not on the day yet is moved (its metadata says pay_day, and
// play_gap_from what it was: entitlements.gap_from) and its credit added once (an idempotency key per subscription).
// Once a plan is on the day, Stripe's preview already has its credit, so the charge shown is the preview's.
// {at, credit, dry, counts, totals: {charge, credit} (US cents), subscriptions: [{id, plan, status, from, to (ISO),
// lastPaid, unusedDays, credit, charge (US cents), why, error}]}: ids and amounts only. Or {error}.
export async function payDay(env, { at, credit = false, dry = true } = {}) {
  const day = at === undefined || at === null ? launchWindow(env)?.end ?? NaN : moment(at);
  if (!Number.isFinite(day)) return { error: "Give the day as an ISO date-time with its zone (at)." };
  if (!dry && day < Date.now() + TRIAL_MIN_SECONDS * 1000) return { error: "That day is too soon for a trial to end on." };
  const subs = await liveSubscriptionsAll(env);
  const counts = {}, rows = [], totals = { charge: 0, credit: 0 };
  for (const sub of subs) {
    const item = sub.items?.data?.[0], plan = planOfPrice(item?.price), status = String(sub.status || "");
    const from = status === "trialing" && Number.isFinite(sub.trial_end) ? sub.trial_end
      : item?.current_period_end ?? sub.current_period_end;
    const cancelling = Boolean(sub.cancel_at_period_end || (Number.isFinite(sub.cancel_at) && sub.cancel_at > 0));
    const row = { id: sub.id, plan: PAID.includes(plan) ? plan : null, status,
                  from: Number.isFinite(from) ? iso(from * 1000) : null, to: iso(day), ...(cancelling ? { cancelling } : {}) };
    let why = !row.plan ? "not a plan" : status === "past_due" ? "payment failing" : null, error;
    if (!why) {
      try {
        // What it paid for days after the pay day: each paid invoice's share of its period past it.
        const { data: invoices } = await stripe(env, "GET", "invoices", { subscription: sub.id, status: "paid", limit: 20 });
        let lastPaid = 0, owed = 0, unused = 0, paidEnd = 0;
        for (const invoice of invoices || []) {
          if (!(invoice.amount_paid > 0)) continue;
          lastPaid ||= invoice.amount_paid;
          const period = (invoice.lines?.data || []).map(l => l.period).find(p => p?.end > p?.start);
          paidEnd = Math.max(paidEnd, (period?.end || 0) * 1000);
          if (!period || period.end * 1000 <= day) continue;
          const left = (period.end * 1000 - Math.max(day, period.start * 1000)) / ((period.end - period.start) * 1000);
          owed += invoice.amount_paid * left;
          unused = Math.max(unused, (period.end * 1000 - day) / DAY_MS);
        }
        // A cancelled plan has no next invoice (Stripe says so): nothing is charged.
        const next = cancelling ? null
          : await stripe(env, "POST", "invoices/create_preview", { customer: idOf(sub.customer), subscription: sub.id });
        const end = cancelling && paidEnd > day ? paidEnd : day;
        const back = credit && !cancelling ? Math.round(owed) : 0;
        why = from === Math.floor(end / 1000) && sub.metadata?.pay_day === iso(day) ? "already on the day"
          : dry ? "would move" : "moved";
        const credited = why === "already on the day" ? 0 : back;   // on the day, the preview has it already
        Object.assign(row, { to: iso(end), lastPaid, unusedDays: Math.round(unused * 10) / 10, credit: back,
                             charge: cancelling ? 0 : Math.max(0, (next?.amount_due ?? 0) - credited) });
        totals.charge += row.charge;
        totals.credit += back;
        if (!dry && why === "moved") {
          const key = `lf-payday-${iso(day).slice(0, 10)}-${sub.id}`;
          await stripe(env, "POST", `subscriptions/${encodeURIComponent(sub.id)}`, { trial_end: Math.floor(end / 1000),
            proration_behavior: "none", ...(cancelling && !sub.cancel_at_period_end ? { cancel_at: Math.floor(end / 1000) } : {}),
            metadata: { pay_day: iso(day),
              play_gap_from: sub.metadata?.play_gap_from || status } },
            { idempotencyKey: key });
          if (back > 0) await stripe(env, "POST", `customers/${encodeURIComponent(idOf(sub.customer))}/balance_transactions`,
            { amount: -back, currency: "usd", description: "Days already paid for after the launch" },
            { idempotencyKey: `${key}-credit` });
        }
      } catch (e) { why = "failed"; error = String(e?.message || e); }
    }
    counts[why] = (counts[why] || 0) + 1;
    rows.push({ ...row, why, ...(error ? { error } : {}) });
  }
  return { at: iso(day), credit, dry, counts, totals, subscriptions: rows };
}

// A deployment that isn't Production, for trying the beta promo before and after it (PROMO_NOW below): Stripe in test mode (a
// test key, sk_test_ or rk_test_) and no STRIPE_LIVE. The site has no other sign of which it is (Pages' CF_PAGES_* are
// for builds). Production takes a live key with STRIPE_LIVE "1" (stripe() refuses a live key without it), and with no
// Stripe key at all it counts as Production too, so PROMO_NOW can never work there.
export const previewDeploy = env => /^[sr]k_test_/.test(String(env?.STRIPE_SECRET_KEY || "")) && env?.STRIPE_LIVE !== "1";
// The beta promo's clock: the real time, or on a preview deployment the Pages variable PROMO_NOW (an ISO date-time,
// e.g. "2026-10-25T12:00:00-07:00"), so the promo, a free Hero month and its copy can be tried before and after (with
// a LAUNCH_WEEK_START set there too). Production never reads it. Only the promo's checks and copy use this clock;
// answers, months and renewals keep the real time.
const previewClock = env => {
  const set = previewDeploy(env) ? Date.parse(String(env?.PROMO_NOW ?? "")) : NaN;
  return Number.isFinite(set) ? new Date(set) : null;
};
export const launchNow = (env, now = new Date()) => previewClock(env) || now;
// A paid plan's month, for its answer pool and web look-ups: from its renewal (the day of the month and the time its
// paid period ends, `renews` from planFor, the day clamped to a shorter month's last) to the same moment the next
// month, UTC, so a month paid for never holds two pools, and the pool comes back when the renewal does, not hours
// before it; the calendar month without a renewal. The beta's free Hero month (planFor launch) is anchored on its
// end (`until`) the same way, so its 30 days hold one pool. {key: the month's first day (YYYY-MM-DD, for the
// rate_limits bucket), resetsAt: when the next one starts (ISO)}.
export function poolWindow(plan, now = new Date()) {
  const anchorAt = plan?.renews || plan?.until;
  const renews = anchorAt ? new Date(anchorAt) : null;
  const known = renews && !isNaN(renews);
  const anchor = known ? renews.getUTCDate() : 1, at = known ? renews.getTime() % 86400e3 : 0;
  const on = (y, m) => new Date(Date.UTC(y, m, Math.min(anchor, new Date(Date.UTC(y, m + 1, 0)).getUTCDate())) + at);
  let start = on(now.getUTCFullYear(), now.getUTCMonth());
  if (start > now) start = on(now.getUTCFullYear(), now.getUTCMonth() - 1);
  return { key: start.toISOString().slice(0, 10), resetsAt: on(start.getUTCFullYear(), start.getUTCMonth() + 1).toISOString() };
}

// The free plan's brake, its soft step (lib/free-pool.js): once the day's allowance of the shared free pool is used,
// free players get BRAKE_ANSWERS a day, so the rest of the day stretches over more of them instead of running out for
// everyone at once; the next day's slice lifts it again. Starter answers still need the pool; paying players are
// unaffected.
export const BRAKE_ANSWERS = 5;
// How many free accounts' day one computer gets (functions/api/companion/answer.js: its X-LF-Machine code), so new free
// accounts made on it add no answers. A household of three still has a day each.
export const MACHINE_ACCOUNTS = 3;

// Stripe statuses that keep the plan until the paid period ends. past_due: a payment failed and Stripe is retrying it.
export const ACTIVE = ["active", "trialing", "past_due"];
export const STRIPE_VERSION = "2026-08-26.dahlia";   // every call, and the webhook's events, use this API version
export const WEBHOOK_TOLERANCE = 300;                // seconds a webhook's signature stays good, as Stripe's libraries allow
// Stripe asks each integration to label its Checkout Sessions: a name and 8 random letters, kept the same.
export const INTEGRATION_ID = "willo_plans_qkzmhtra";
// Events that can change a plan. Each fetches the subscription from Stripe and stores what it says now.
const PLAN_EVENTS = ["checkout.session.completed", "checkout.session.async_payment_succeeded",
                     "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted",
                     "invoice.paid", "invoice.payment_failed"];
// A paid checkout in payment mode (the first two of PLAN_EVENTS) credits a finest-voice pack instead; a refund or a
// dispute takes one back. scripts/stripe-setup.mjs --webhook subscribes the webhook to them.
const PACK_EVENTS = ["charge.refunded", "charge.dispute.created"];
// What the webhook subscribes to: those, and a delayed payment that failed, which is only recorded (its subscription
// never became active, and a pack is credited only once paid, so there's nothing to take away).
export const WEBHOOK_EVENTS = [...PLAN_EVENTS, ...PACK_EVENTS, "checkout.session.async_payment_failed"];

// Live answers a day for every account while the plans feature is off: the number from before plans.
export const OFF_ANSWERS = 20;
export const plansOn = env => featureOn(env, "plans");
export const billingOn = env => plansOn(env) && Boolean(env.STRIPE_SECRET_KEY && env.DB);
// A plan's Stripe price, by lookup key: monthly only (the yearly ones, hero_yearly and the like, are archived by
// scripts/stripe-setup.mjs).
export const lookupKey = planId => `${planId}_monthly`;

// The plans for sale: BILLING_PLANS when it's set, else SELLABLE. Never the free one.
export function sellablePlans(env) {
  const set = String(env.BILLING_PLANS ?? "").trim();
  return (set ? set.split(",").map(s => s.trim()) : SELLABLE).filter(id => PAID.includes(id) && !PLANS[id].hidden);
}

const month = (now = new Date()) => now.toISOString().slice(0, 7);
const iso = (ms = Date.now()) => new Date(ms).toISOString();
const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
// Two signatures compared in constant time, so the answer's timing says nothing about how close a guess was.
const same = (s, want) => {
  if (typeof s !== "string" || s.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < s.length; i++) diff |= s.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
};
const idOf = v => typeof v === "string" ? v : typeof v?.id === "string" ? v.id : null;

// ---- The tables ----

// Created here rather than in lib/accounts.js SETUP, since only plans use them; "Delete my account" removes their rows.
// entitlements: one row per account that ever opened checkout. plan: free unless the subscription is in ACTIVE;
// interval: month (a yearly one from before is kept as it was); current_period_end: when the paid period ends (ISO);
// promo_champion_until: unused since the launch offers changed (2026-10-14); next_plan and next_plan_at: a
// downgrade waiting for the renewal (its subscription schedule's next phase, nextOf); gap_from: what the subscription
// was when its next charge was moved to the launch (payDay; gapFrom: "active", a paying plan; "trialing", a trial), else
// NULL.
// promo_claims: the beta promo's offers each account has had (promoClaim), "<kind>:<code>" (kind hero, the trial;
// half, a 50% first month; free, the card-less free Hero month, whose created is the month's start and whose
// subscription_id is ''; or creator, a creator's first-month discount: lib/referrals.js) by the same one-way code as starter_claims (or "user:<id>" without a Google ID), with the
// subscription that had it; kept after "Delete my account".
// billing_locks: a plan change under way for an account (changePlan), so a double click or a second tab waits.
// billing_events: the webhook events
// already applied (Stripe's event id), so a repeat is skipped. answer_user_spend: what a player's paid-for live answers
// cost this month (UTC, "2026-10"): micro is all of it, topup_micro the part finest-voice packs paid for (named for the
// answer top-ups it first counted), so a plan's cost caps count only the plan's own, voice_micro the part its hosted
// voice cost (lib/companion-voice.js), which counts
// toward the total cap but not the text one, and launch_micro the part the beta's free Hero months cost, which only
// the free Hero month's caps and the promo's brake count (also in lib/accounts.js SETUP, since the shared budget reads it). users.welcomed_at:
// when the account was sent to the welcome page (welcomeOnce).
// answer_packs: one row per finest-voice pack bought (kind 'voice', VOICE_PACK), keyed by its Checkout Session's id so
// a pack is credited once, and the account's starter (kind 'starter', keyed "starter:<user id>", so it's credited once
// too); remaining: a voice pack's replies left (the starter's answers); spent_micro: what a pack's replies have cost,
// for its costCapMicro; payment_intent: Stripe's payment, which a refund or a dispute names (none for a starter);
// status: active, refunded or disputed. answer_holds: what answers and hosted replies still being written hold against
// a plan's cost cap (pack_id null) or a finest-voice pack's (holdUserSpend), one row each, gone once it's settled.
// starter_claims: the Google accounts that have had a starter, by a salted hash of their Google ID (starterClaim), kept
// after "Delete my account" so deleting it and signing in again doesn't bring another;
// billing_salt: that hash's random salt, made once. voice_replies: the replies a paying player's hosted voice said in
// their current plan month (lib/companion-voice.js), one row per reply: reply is the companion's id for it (its pieces
// come one by one), period the plan month's first day (poolWindow), chars what its pieces said so far, pieces how many
// are on their way or said, heard how many were said, best whether Willo's finest voice says it (PLAN_VOICE best),
// pack the finest-voice pack that pays for it instead (VOICE_PACK), npc whether it's one of Champion's character
// replies (PLAN_VOICE characters), provider the one its pieces go to (LOR-596: one voice a reply); older months'
// rows go as a new one starts.
// plan_log (LOR-524): every subscription seen, one row each, for /admin's new and cancelled plans per day
// (subscriptionReport): its plan, Stripe's status, when it started (start_date), when it was cancelled (canceled_at:
// when the player asked, though the plan runs to its period's end) and ended, its discounts' ids as last seen, and
// comp: NULL until its coupons are read (checkPlanLog), '' for a paid plan, or the coupon that makes it free
// (COMP_COUPONS). Kept after the plan ends, and after "Delete my account" without the account (user_id NULL). source:
// where its checkout started (createCheckout's source: "welcome", "plans", a link from Willo's app such as
// "willo-empty"), first seen wins; NULL for one made before it was kept, or not through Checkout.
const SETUP = [
  `CREATE TABLE IF NOT EXISTS entitlements (
    user_id TEXT PRIMARY KEY, customer_id TEXT UNIQUE, subscription_id TEXT, plan TEXT NOT NULL DEFAULT 'free',
    interval TEXT, status TEXT, current_period_end TEXT, cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
    updated TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS billing_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, created TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS answer_user_spend (
    user_id TEXT NOT NULL, month TEXT NOT NULL, micro INTEGER NOT NULL DEFAULT 0, calls INTEGER NOT NULL DEFAULT 0,
    topup_micro INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, month))`,
  `CREATE TABLE IF NOT EXISTS answer_packs (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, answers INTEGER NOT NULL, remaining INTEGER NOT NULL,
    spent_micro INTEGER NOT NULL DEFAULT 0, payment_intent TEXT, status TEXT NOT NULL DEFAULT 'active', created TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'topup')`,
  "CREATE INDEX IF NOT EXISTS answer_packs_user ON answer_packs (user_id, created)",
  `CREATE TABLE IF NOT EXISTS answer_holds (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, pack_id TEXT, micro INTEGER NOT NULL, created TEXT NOT NULL)`,
  "CREATE INDEX IF NOT EXISTS answer_holds_user ON answer_holds (user_id, created)",
  "CREATE TABLE IF NOT EXISTS starter_claims (sub_hash TEXT PRIMARY KEY, created TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS billing_salt (id INTEGER PRIMARY KEY CHECK (id = 1), salt TEXT NOT NULL)",
  `CREATE TABLE IF NOT EXISTS voice_replies (
    user_id TEXT NOT NULL, reply TEXT NOT NULL, period TEXT NOT NULL, chars INTEGER NOT NULL DEFAULT 0,
    pieces INTEGER NOT NULL DEFAULT 0, heard INTEGER NOT NULL DEFAULT 0, best INTEGER NOT NULL DEFAULT 0,
    created TEXT NOT NULL, PRIMARY KEY (user_id, reply))`,
  "CREATE INDEX IF NOT EXISTS voice_replies_period ON voice_replies (user_id, period)",
  "CREATE TABLE IF NOT EXISTS promo_claims (claim TEXT PRIMARY KEY, subscription_id TEXT NOT NULL, created TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS billing_locks (user_id TEXT PRIMARY KEY, until TEXT NOT NULL)",
  `CREATE TABLE IF NOT EXISTS plan_log (subscription_id TEXT PRIMARY KEY, user_id TEXT, plan TEXT, status TEXT,
    started TEXT, canceled TEXT, ended TEXT, discounts TEXT, comp TEXT, updated TEXT NOT NULL)`,
  // Willo's best first for new players (lib/best-first.js says what each column is, LOR-602). best_first is kept after
  // "Delete my account" without the account (user_id NULL), so a Google account's taste comes once.
  `CREATE TABLE IF NOT EXISTS best_first (claim TEXT PRIMARY KEY, user_id TEXT, used INTEGER NOT NULL DEFAULT 0,
    voices INTEGER NOT NULL DEFAULT 0, lookups INTEGER NOT NULL DEFAULT 0, started TEXT, finished TEXT)`,
  "CREATE INDEX IF NOT EXISTS best_first_user ON best_first (user_id)",
  // Plan months given, not bought (giveFreeMonth: a free month for the friends a player brought, lib/referrals.js):
  // the plan, from `starts` to `ends` (ISO), on us. id: what gave it (the reward's id), so it's given once.
  `CREATE TABLE IF NOT EXISTS plan_grants (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, plan TEXT NOT NULL,
    starts TEXT NOT NULL, ends TEXT NOT NULL, reason TEXT NOT NULL, created TEXT NOT NULL)`,
  "CREATE INDEX IF NOT EXISTS plan_grants_user ON plan_grants (user_id, ends)",
  `CREATE TABLE IF NOT EXISTS best_first_days (day TEXT PRIMARY KEY, reserved_micro INTEGER NOT NULL DEFAULT 0,
    spent_micro INTEGER NOT NULL DEFAULT 0, answers INTEGER NOT NULL DEFAULT 0, replies INTEGER NOT NULL DEFAULT 0,
    lines INTEGER NOT NULL DEFAULT 0, starts INTEGER NOT NULL DEFAULT 0, capped INTEGER NOT NULL DEFAULT 0,
    unreachable INTEGER NOT NULL DEFAULT 0)`,
];
// Columns added after their table was first made. Packs from before the starter were all answer top-ups (none was ever
// sold on the live site; nothing reads that kind now).
const MIGRATE = ["ALTER TABLE answer_user_spend ADD COLUMN topup_micro INTEGER NOT NULL DEFAULT 0",
                 "ALTER TABLE answer_packs ADD COLUMN kind TEXT NOT NULL DEFAULT 'topup'",
                 "ALTER TABLE answer_user_spend ADD COLUMN voice_micro INTEGER NOT NULL DEFAULT 0",
                 "ALTER TABLE voice_replies ADD COLUMN pack TEXT",
                 "ALTER TABLE entitlements ADD COLUMN promo_champion_until TEXT",
                 "ALTER TABLE answer_user_spend ADD COLUMN launch_micro INTEGER NOT NULL DEFAULT 0",
                 "ALTER TABLE users ADD COLUMN welcomed_at TEXT",
                 // Where a plan's checkout started (createCheckout source), for pricing.
                 "ALTER TABLE plan_log ADD COLUMN source TEXT",
                 "ALTER TABLE voice_replies ADD COLUMN npc INTEGER NOT NULL DEFAULT 0",
                 "ALTER TABLE entitlements ADD COLUMN next_plan TEXT",
                 "ALTER TABLE entitlements ADD COLUMN next_plan_at TEXT",
                 "ALTER TABLE voice_replies ADD COLUMN provider TEXT",
                 "ALTER TABLE entitlements ADD COLUMN gap_from TEXT",
                 // The pieces of a reply whose letters are counted, one bit each (lib/companion-voice.js PIECE_BIT).
                 "ALTER TABLE voice_replies ADD COLUMN bits INTEGER NOT NULL DEFAULT 0",
                 // The first-run trial's counted uses (lib/best-first.js TRIAL), JSON {sight, cast}.
                 "ALTER TABLE best_first ADD COLUMN tries TEXT"];
// The column checks go out at once (each fails once its column exists): one after another, a fresh Worker waited a round
// trip to D1 for each before a live answer could start, about 2 s for a player far from the database (LOR-654).
// Callers at the same moment share one setup.
const ready = new WeakMap();
export function setupBilling(env) {
  if (isReportRead(env)) return;
  if (!ready.has(env.DB)) ready.set(env.DB, (async () => {
    await createMissing(env, SETUP);
    await addMissing(env, MIGRATE);
  })().catch(e => { ready.delete(env.DB); throw e; }));
  return ready.get(env.DB);
}

// ---- Stripe ----

// Stripe's form encoding: nested objects and arrays as bracketed keys (line_items[0][price]=...).
export function formBody(params, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") formBody(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

// One call to Stripe's API. Throws with Stripe's own message when it fails, with anything that looks like a key taken
// out, so no key reaches a log. A live key is refused unless STRIPE_LIVE is "1", so a key pasted into the wrong place
// (Preview, say) can't charge anyone.
export async function stripe(env, method, path, params, { idempotencyKey } = {}) {
  if (method !== "GET") refuseReportEffect(env, "a Stripe mutation");
  const key = String(env.STRIPE_SECRET_KEY || "");
  if (!key) throw new Error("Stripe isn't set up (no STRIPE_SECRET_KEY).");
  if (/^[sr]k_live_/.test(key) && env.STRIPE_LIVE !== "1")
    throw new Error("STRIPE_SECRET_KEY is a live key, and STRIPE_LIVE isn't \"1\" here. Use a test key (rk_test_ or sk_test_).");
  const body = formBody(params).toString();
  const headers = { Authorization: `Bearer ${key}`, "Stripe-Version": STRIPE_VERSION };
  if (method !== "GET") headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  let res;
  try {
    res = await fetch(`https://api.stripe.com/v1/${path}${method === "GET" && body ? "?" + body : ""}`,
      { method, headers, body: method === "GET" ? undefined : body, signal: AbortSignal.timeout(15000) });
  } catch (error) { if (method !== "GET") markActionUncertain(env); throw error; }
  const data = await res.json().catch(() => null);
  if (method !== "GET" && (res.status >= 500 || !data)) markActionUncertain(env);
  if (!res.ok) {
    const message = String(data?.error?.message || `Stripe HTTP ${res.status}`).replace(/\b(?:[sr]k|whsec)_[\w*]+/g, "[key]");
    throw Object.assign(new Error(message), { status: res.status });
  }
  return data;
}

// Price ids by lookup key ("hero_monthly", "voice_400"), kept for the life of the isolate: a key only moves to a new
// price when scripts/stripe-setup.mjs changes an amount, and the next deploy or cold start picks that up.
const prices = new Map();
async function priceId(env, key) {
  if (!prices.has(key)) {
    const keys = [...PAID.map(lookupKey), VOICE_PACK.key];
    const list = await stripe(env, "GET", "prices", { lookup_keys: keys, active: true, limit: 100 });
    for (const p of list?.data || []) if (p.lookup_key) prices.set(p.lookup_key, p.id);
  }
  return prices.get(key) || null;
}

// The billing portal settings scripts/stripe-setup.mjs made for plans (metadata lore_forever=plans), or null for the
// Stripe account's default ones. Looked up once per isolate.
let portalSettings;
async function portalConfiguration(env) {
  if (portalSettings === undefined) {
    const list = await stripe(env, "GET", "billing_portal/configurations", { active: true, limit: 100 });
    portalSettings = (list?.data || []).find(c => c.metadata?.lore_forever === "plans")?.id || null;
  }
  return portalSettings;
}

// ---- Plans ----

const entitlement = (env, userId) => env.DB.prepare("SELECT * FROM entitlements WHERE user_id = ?").bind(userId).first();
// What a subscription was when its next charge was moved (entitlements.gap_from: payDay's, or the play gap's of
// 2026-10-18 before it), from its metadata: "active" (a paying plan, now a Stripe trial to the launch), "trialing" or
// "checkout"; else null.
const GAP_FROM = ["active", "trialing", "checkout"];
const gapFrom = sub => {
  const from = sub?.metadata?.play_gap_from;
  return (sub.metadata?.pay_day || sub.metadata?.play_gap) && GAP_FROM.includes(from) ? from : null;
};

// Whether a stored subscription still gives its plan: a status in ACTIVE and a paid period that hasn't ended.
function paidNow(row, now = new Date()) {
  return Boolean(row && PAID.includes(row.plan) && ACTIVE.includes(row.status) &&
    (!row.current_period_end || Date.parse(row.current_period_end) > now.getTime()));
}


// The account's Google ID (users.google_sub) as a salted SHA-256, for starter_claims: it can be matched against a
// Google account signing in, but doesn't hold the ID itself. null for an account without one. Share Willo
// (lib/referrals.js) keys a friend by it too, so a Google account counts as a friend once, ever.
const salts = new WeakMap();   // env.DB -> the salt, so most checks skip the lookup
const claimHash = async (salt, googleSub) =>
  hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${googleSub}`)));
// An account's Google ID never changes once it has one, so a Worker keeps the ones it has read: a live answer looked it
// up two or three times, a round trip each (the plan's free Hero month, the starter and Willo's best first, LOR-654).
// One without (an Apple sign-in) is read again each time, since it can be linked to Google later.
const googleSubs = new WeakMap();   // env.DB -> Map(user id -> Google ID)
const GOOGLE_SUBS_KEPT = 5000;
export async function starterClaim(env, userId) {
  await setupBilling(env);
  if (!googleSubs.has(env.DB)) googleSubs.set(env.DB, new Map());
  const kept = googleSubs.get(env.DB);
  let googleSub = kept.get(userId);
  if (!googleSub) {
    googleSub = (await env.DB.prepare("SELECT google_sub FROM users WHERE id = ?").bind(userId).first())?.google_sub;
    if (!googleSub) return null;
    if (kept.size >= GOOGLE_SUBS_KEPT) kept.clear();
    kept.set(userId, googleSub);
  }
  const user = { google_sub: googleSub };
  if (!salts.has(env.DB)) {
    // Two isolates can get here at once: both insert, one wins, and both read back the winner's salt.
    await env.DB.prepare("INSERT OR IGNORE INTO billing_salt (id, salt) VALUES (1, ?)")
      .bind(hex(crypto.getRandomValues(new Uint8Array(32)))).run();
    salts.set(env.DB, (await env.DB.prepare("SELECT salt FROM billing_salt WHERE id = 1").first()).salt);
  }
  return claimHash(salts.get(env.DB), user.google_sub);
}

// The plan an account has right now: {id, name, answersPerDay, answersPerMonth, lookupsPerMonth, costCapMicro (the text
// cap), totalCapMicro (a paid plan's), voice (PLAN_VOICE's: who says its replies, choice, best), status, renews,
// cancelAtPeriodEnd, portal}. renews: when the paid period ends (it renews then unless cancelAtPeriodEnd). portal:
// they have a subscription to manage on the billing portal, even an ended one. On the free plan, answersPerDay is the
// brake's when it applies (with brake: true). During its free Hero
// month (the beta promo, freeHeroMonth) a free account has Hero's plan instead, with launch: true, since and until
// (the month's start and end, ISO) and ends (its end as players read it, "November 20"). A "Keep Hero" bought during
// the beta starts its months at the launch (renews). changesTo: {id, name, at}, a downgrade waiting for the renewal
// (changePlan). paidBefore: a paying plan whose next charge was moved to the launch (payDay), so a Stripe trial
// ("trialing") until renews, though it's paid for.
const voiceOf = id => ({ voice: { ...PLAN_VOICE[id] } });
export async function planFor(env, userId, now = new Date()) {
  // Plans switched off: everyone has the free plan with the answers from before plans, whatever is stored, and Willo
  // talks in its own voice on the PC as before.
  if (!plansOn(env)) {
    return { id: "free", name: PLANS.free.name, answersPerDay: OFF_ANSWERS, costCapMicro: 0, status: null, renews: null,
             cancelAtPeriodEnd: false, portal: false };
  }
  await setupBilling(env);
  // What a free account's plan needs is read while its entitlement is, one round trip to D1 instead of three for the free plan and its beta Hero month (LOR-654).
  const at = launchNow(env, now), week = launchWindow(env);
  const promo = Boolean(week) && at.getTime() < week.end;
  const quiet = p => p.catch(() => null);   // a paying plan doesn't need them; a free one reads them again on a failure
  const ahead = Promise.all([quiet(poolNow(env, now)), promo ? quiet(launchSpend(env, week)) : null,
    promo ? quiet((async () => {
      const claim = await claimOf(env, userId, "free");
      return { claim, row: await promoRow(env, claim) };
    })()) : null]);
  // A plan month given for bringing friends (giveFreeMonth), read alongside too: a failed read is no month.
  const granted = grantNow(env, userId, now).catch(() => null);
  const row = await entitlement(env, userId);
  const portal = Boolean(row?.subscription_id);
  if (paidNow(row, now)) {
    const plan = PLANS[row.plan];
    const next = PAID.includes(row.next_plan) && row.next_plan !== row.plan && Date.parse(row.next_plan_at) > now.getTime()
      ? { changesTo: { id: row.next_plan, name: PLANS[row.next_plan].name, at: row.next_plan_at } } : {};
    return { id: plan.id, name: plan.name, answersPerDay: plan.answersPerDay, answersPerMonth: plan.answersPerMonth,
             lookupsPerMonth: plan.lookupsPerMonth, costCapMicro: plan.costCapMicro, totalCapMicro: plan.totalCapMicro,
             ...voiceOf(plan.id), status: row.status, renews: row.current_period_end,
             cancelAtPeriodEnd: Boolean(row.cancel_at_period_end), ...next, portal,
             ...(row.gap_from === "active" ? { paidBefore: true } : {}), ...(plan.smarter ? { smarter: true } : {}) };
  }
  // The beta's free Hero month: looked for while one can still be running (until the launch). A read that failed ahead
  // is read again here, so its error is this one's, as before.
  const [poolAhead, launchAhead, promoAhead] = await ahead;
  const pool = poolAhead ?? await poolNow(env, now);
  const launchSpent = !promo ? null : launchAhead ?? await launchSpend(env, week);
  // Hero's plan, on us, for the account's month, until the promo's brake.
  const freeMonth = launchSpent !== null && launchSpent < LAUNCH_WEEK_BRAKE_MICRO
    ? await freeHeroMonth(env, userId, at, week, promoAhead) : null;
  if (freeMonth) {
    const hero = PLANS.hero;
    return { id: hero.id, name: hero.name, answersPerDay: hero.answersPerDay, answersPerMonth: hero.answersPerMonth,
             lookupsPerMonth: hero.lookupsPerMonth, costCapMicro: hero.costCapMicro, totalCapMicro: hero.totalCapMicro,
             ...voiceOf(hero.id), launch: true, since: iso(freeMonth.start), until: iso(freeMonth.end),
             ends: pacificDay(freeMonth.end), status: null, renews: null, cancelAtPeriodEnd: false, portal };
  }
  // A free month for the friends they brought: that plan, on us like the beta's month (launch), with reward: true.
  const grant = await granted;
  if (grant) {
    const p = PLANS[grant.plan];
    return { id: p.id, name: p.name, answersPerDay: p.answersPerDay, answersPerMonth: p.answersPerMonth,
             lookupsPerMonth: p.lookupsPerMonth, costCapMicro: p.costCapMicro, totalCapMicro: p.totalCapMicro,
             ...voiceOf(p.id), launch: true, reward: true, since: grant.starts, until: grant.ends,
             ends: pacificDay(Date.parse(grant.ends)), status: null, renews: null, cancelAtPeriodEnd: false, portal,
             ...(p.smarter ? { smarter: true } : {}) };
  }
  const brake = softStep(pool);
  const free = PLANS.free;
  return { id: free.id, name: free.name, costCapMicro: 0, lookupsPerMonth: 0, status: null, renews: null,
           cancelAtPeriodEnd: false, portal, answersPerMonth: free.answersPerMonth, ...voiceOf(free.id),
           answersPerDay: brake ? BRAKE_ANSWERS : free.answersPerDay, ...(brake ? { brake: true } : {}) };
}

// The plan an account has now, read only (no starter credited, no free Hero month started, unlike planFor): its id,
// for what a friend's share gives the account that shared (lib/referrals.js). The beta's free Hero month is Hero.
export async function planIdNow(env, userId, now = new Date()) {
  if (!plansOn(env)) return "free";
  await setupBilling(env);
  const [row, grant] = await Promise.all([entitlement(env, userId), grantNow(env, userId, now).catch(() => null)]);
  if (paidNow(row, now)) return row.plan;
  if (await freeHeroMonth(env, userId, launchNow(env, now))) return "hero";
  return grant?.plan || "free";
}

// The plan the account pays for now, read only: {plan, renews (false once they've cancelled it)}, or null (the free
// plan, the beta's free Hero month or a month given: nothing billed).
export async function billedPlan(env, userId, now = new Date()) {
  if (!plansOn(env)) return null;
  await setupBilling(env);
  const row = await entitlement(env, userId);
  return paidNow(row, now) ? { plan: row.plan, renews: !row.cancel_at_period_end } : null;
}

// The plan month given to the account that runs at `now` (plan_grants: {plan, starts, ends}), or null.
async function grantNow(env, userId, now = new Date()) {
  const at = iso(now.getTime());
  const row = await env.DB.prepare("SELECT plan, starts, ends FROM plan_grants WHERE user_id = ? AND starts <= ? AND ends > ? " +
    "ORDER BY starts LIMIT 1").bind(userId, at, at).first();
  return row && PLANS[row.plan] && row.plan !== "free" ? row : null;
}

// A free month of the account's plan, for `id` (what earned it: lib/referrals.js's reward, once), applied with no
// manual step:
// - A paying plan that renews: a credit on their Stripe balance as big as their next month's charge (Stripe's own
//   preview of it, its discounts in, the balance they have left out; at most the plan's price, which is also what's
//   credited when the preview fails), which the next invoice uses first. Stripe's idempotency key is the reward's, so
//   a retry never credits twice.
// - Anyone else (the free plan, the beta's free Hero month, a plan they cancelled): a month of the plan on us
//   (plan_grants), `freePlan` on the free plan, theirs when they're cancelling (from the day it ends), starting when
//   any month they have already ends.
// {method: "credit" | "grant", plan, cents (a credit's), stripeId (its balance transaction), starts, ends (a
// grant's, ISO)}. Throws when Stripe fails, so the caller can try again.
export const GRANT_DAYS = 30;
export async function giveFreeMonth(env, userId, { id, freePlan = "hero", description = "A free month", now = new Date() }) {
  await setupBilling(env);
  const row = await entitlement(env, userId);
  const paying = paidNow(row, now);
  if (paying && !row.cancel_at_period_end && row.customer_id && row.subscription_id && env.STRIPE_SECRET_KEY) {
    const plan = PLANS[row.plan];
    let cents = plan.monthly;
    try {
      const next = await stripe(env, "POST", "invoices/create_preview", { customer: row.customer_id, subscription: row.subscription_id });
      if (Number.isFinite(next?.total) && next.total > 0) cents = Math.min(next.total, plan.monthly);
    } catch (e) { console.warn(`billing: free month ${id}: no preview (${e?.message || e}), the plan's price`); }
    const txn = await stripe(env, "POST", `customers/${encodeURIComponent(row.customer_id)}/balance_transactions`,
      { amount: -cents, currency: "usd", description, metadata: { reward: id } }, { idempotencyKey: `lf-reward-${id}` });
    return { method: "credit", plan: plan.id, cents, stripeId: txn?.id || null };
  }
  const [grant, last, beta] = await Promise.all([grantNow(env, userId, now),
    env.DB.prepare("SELECT MAX(ends) AS ends FROM plan_grants WHERE user_id = ?").bind(userId).first(),
    freeHeroMonth(env, userId, launchNow(env, now))]);
  const plan = paying ? row.plan : grant?.plan || freePlan;
  const starts = Math.max(now.getTime(), paying ? Date.parse(row.current_period_end) || 0 : 0,
    beta ? beta.end - launchNow(env, now).getTime() + now.getTime() : 0, Date.parse(last?.ends || "") || 0);
  const ends = starts + GRANT_DAYS * DAY_MS;
  await env.DB.prepare("INSERT OR IGNORE INTO plan_grants (id, user_id, plan, starts, ends, reason, created) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, userId, plan, iso(starts), iso(ends), description, iso(now.getTime())).run();
  const kept = await env.DB.prepare("SELECT plan, starts, ends FROM plan_grants WHERE id = ?").bind(id).first();
  return { method: "grant", plan: kept.plan, starts: kept.starts, ends: kept.ends };
}

// The account's free Hero month ({start, end}, milliseconds) while it runs at `at` (launchNow's clock), else null.
// It starts the first time this is asked during the beta promo (week: launchWindow's), as the account's "free" claim
// in promo_claims (created: the month's start; by its one-way Google code, so once per Google account, even after
// "Delete my account"), and runs to the launch (or BETA_HERO_DAYS days, if that's sooner: freeMonthEnd). Read first,
// so only an account's first look writes; without `week`, it only reads.
// ahead: {claim, row}, the account's claim and its promo_claims row as planFor read them ahead, or null.
const promoRow = (env, claim) => env.DB.prepare("SELECT created FROM promo_claims WHERE claim = ?").bind(claim).first();
async function freeHeroMonth(env, userId, at, week = null, ahead = null) {
  const claim = ahead?.claim || await claimOf(env, userId, "free");
  const ms = at.getTime();
  const read = () => promoRow(env, claim);
  let row = ahead ? ahead.row : await read();
  if (!row && week && ms >= week.start && ms <= week.end) {
    await env.DB.prepare("INSERT OR IGNORE INTO promo_claims (claim, subscription_id, created) VALUES (?, '', ?)")
      .bind(claim, iso(ms)).run();
    row = await read();
  }
  const start = Date.parse(row?.created ?? ""), end = freeMonthEnd(env, start);
  return Number.isFinite(start) && ms >= start && ms < end ? { start, end } : null;
}

// When a free Hero month started at `start` (milliseconds) ends: at the launch (Mike, 2026-10-17: full price from
// launch), or BETA_HERO_DAYS on if that's sooner.
const freeMonthEnd = (env, start) => Math.min(start + BETA_HERO_DAYS * DAY_MS, launchWindow(env)?.end ?? Infinity);

// What the beta's free Hero months have cost so far, site-wide (answer_user_spend.launch_micro, from the promo's
// first calendar month on: the months run past its end), for its brake. week: launchWindow's.
async function launchSpend(env, week) {
  const row = await env.DB.prepare("SELECT COALESCE(SUM(launch_micro), 0) AS micro FROM answer_user_spend WHERE month >= ?")
    .bind(iso(week.start).slice(0, 7)).first();
  return row?.micro || 0;
}

// The welcome page (Mike, 2026-10-13): the first time an account connects the companion on /link
// (functions/api/device/[action].js approve), while plans are for sale and the account has none, the browser goes to
// WELCOME_URL instead of the connected page: a warm line, the plan cards and "Continue free", which goes on to that
// page. Once per account (users.welcomed_at, set here in one statement, so two tabs can't both get it). Only the
// companion makes those links (lib/devices.js), so the add-on never leads here. The site decides; the companion just
// opens sign-in as before. WELCOME_URL, or null.
export const WELCOME_URL = "/plans?welcome=1";
export async function welcomeOnce(env, userId, now = new Date()) {
  if (!billingOn(env) || !sellablePlans(env).length) return null;
  await setupBilling(env);
  if (paidNow(await entitlement(env, userId), now)) return null;
  const res = await env.DB.prepare("UPDATE users SET welcomed_at = ? WHERE id = ? AND welcomed_at IS NULL")
    .bind(iso(now.getTime()), userId).run();
  return res.meta.changes ? WELCOME_URL : null;
}

// Holds `micro` (what lib/companion-answers.js answerReservation reserves for an answer) against the cost cap that
// pays for the answer, before it's written: a finest-voice pack's (packId, its packCap: VOICE_PACK.costCapMicro) or the
// plan's month (cap, its costCapMicro; with `total`, its totalCapMicro, against what its answers and hosted voice cost
// together, for a piece of a hosted reply, and then only while `need`, the room the piece wants, still fits under
// it). One statement, and only while the cap isn't reached yet, counting the holds of answers still being written, so questions asked at
// the same moment can't all get in under a cap one of them reaches (security review M3). A hold counts for
// HOLD_SECONDS at most, longer than any answer takes, so one whose request was cut off before it could settle (the
// player disconnected, say) doesn't keep their cap for the rest of the month. The hold's id when it's held, else null;
// addUserSpend settles it with what the answer cost, and releaseUserSpend gives it back. launch: the beta's free
// Hero (planFor launch), whose cap counts only its own answers (ownSpend).
export const HOLD_SECONDS = 300;
// What of the month's answer_user_spend row a plan's caps count: for the beta's free Hero its own answers
// (launch_micro); for a plan everything but finest-voice packs' replies (topup_micro) and the free Hero month's answers, and
// for the text cap not its hosted voice either.
const ownSpend = ({ total = false, launch = false } = {}) =>
  launch ? "launch_micro" : `micro - topup_micro - launch_micro${total ? "" : " - voice_micro"}`;
export async function holdUserSpend(env, userId, micro, now = new Date(), opts = {}) {
  await setupBilling(env);
  const hold = holdStatements(env, userId, micro, now, opts);
  if (!hold) return null;
  const [, held] = await env.DB.batch(hold.statements);
  return held.meta.changes ? hold.id : null;
}

// holdUserSpend's statements, for a caller that runs them in a batch with its own (lib/companion-voice.js: a hosted
// piece's claim on its reply, one round trip for both): {id, statements}, held when the last one changed a row; null
// when there's nothing to hold against (no pack, no cap). also: {sql, binds}, one more condition on the hold.
export function holdStatements(env, userId, micro, now = new Date(),
  { packId = null, packCap = VOICE_PACK.costCapMicro, cap = 0, total = false, need = micro, launch = false } = {},
  also = null) {
  if (!packId && !(cap > 0)) return null;
  const id = crypto.randomUUID(), since = iso(now.getTime() - HOLD_SECONDS * 1000);
  const spent = packId ? "(SELECT spent_micro FROM answer_packs WHERE id = ?)"
    : `COALESCE((SELECT ${ownSpend({ total, launch })} FROM answer_user_spend WHERE user_id = ? AND month = ?), 0)`;
  // A hosted piece must fit whole; an answer only needs the cap not reached yet (its cost is known once it's written).
  const fits = total ? "+ ? <= ?" : "< ?";
  return { id, statements: [
    env.DB.prepare("DELETE FROM answer_holds WHERE user_id = ? AND created <= ?").bind(userId, since),
    env.DB.prepare(
      "INSERT INTO answer_holds (id, user_id, pack_id, micro, created) SELECT ?, ?, ?, ?, ? WHERE " +
      `${spent} + (SELECT COALESCE(SUM(micro), 0) FROM answer_holds WHERE user_id = ? AND pack_id IS ? AND created > ?) ${fits}` +
      (also ? ` AND ${also.sql}` : "")
    ).bind(id, userId, packId, micro, iso(now.getTime()), ...(packId ? [packId] : [userId, month(now)]),
           userId, packId, since, ...(total ? [need] : []), packId ? packCap : cap, ...(also ? also.binds : [])),
  ] };
}

// Gives back a hold (holdUserSpend), for an answer that ended without being written; with `keep`, only down to that,
// for an answer that needs less.
export async function releaseUserSpend(env, holdId, keep = 0) {
  await setupBilling(env);
  await (keep ? env.DB.prepare("UPDATE answer_holds SET micro = ? WHERE id = ?").bind(keep, holdId)
    : env.DB.prepare("DELETE FROM answer_holds WHERE id = ?").bind(holdId)).run();
}

// What a paying player's live answer cost, for their plan's cost caps (lib/companion-answers.js counts each answer's
// cost; functions/api/companion/answer.js adds it here). It goes into answer_user_spend, so the shared budget leaves it
// out. holdId: the answer's hold on its cap (holdUserSpend), which goes in the same batch. launch: an answer of launch
// week's free Hero (planFor launch), kept apart in launch_micro for that week's caps and brake.
export async function addUserSpend(env, userId, micro, now = new Date(), holdId = null, launch = false) {
  await setupBilling(env);
  const cost = Math.max(0, Math.round(Number(micro) || 0));
  const statements = [env.DB.prepare(
    "INSERT INTO answer_user_spend (user_id, month, micro, calls, launch_micro) VALUES (?, ?, ?, 1, ?) " +
    "ON CONFLICT (user_id, month) DO UPDATE SET micro = micro + excluded.micro, calls = calls + 1, " +
    "launch_micro = launch_micro + excluded.launch_micro"
  ).bind(userId, month(now), cost, launch ? cost : 0)];
  if (holdId) statements.push(env.DB.prepare("DELETE FROM answer_holds WHERE id = ?").bind(holdId));
  await env.DB.batch(statements);
}

// What a paying player's hosted voice cost (lib/companion-voice.js), for their plan's cost cap: on their month in
// answer_user_spend, and on the month's answer_spend too, so /admin sees it and the shared budget, which leaves out
// what answer_user_spend holds, stays as it was; voice_micro keeps it apart from the text cap. Not an answer: no call is
// counted. holdId: its hold on the total cap (holdUserSpend), which goes in the same batch. packId: a finest-voice pack
// (VOICE_PACK) paid for it instead: then it's that pack's (topup_micro), not the plan's.
// launch: the beta's free Hero's, which goes in launch_micro too (addUserSpend).
export async function addVoiceSpend(env, userId, micro, now = new Date(), holdId = null, packId = null, launch = false) {
  await setupBilling(env);
  const cost = Math.max(0, Math.round(Number(micro) || 0));
  await env.DB.batch([
    ...(packId ? [env.DB.prepare("UPDATE answer_packs SET spent_micro = spent_micro + ? WHERE id = ?").bind(cost, packId)] : []),
    env.DB.prepare("INSERT INTO answer_spend (month, reserved_micro, actual_micro, calls) VALUES (?, ?, ?, 0) " +
      "ON CONFLICT (month) DO UPDATE SET reserved_micro = reserved_micro + excluded.reserved_micro, " +
      "actual_micro = actual_micro + excluded.actual_micro").bind(month(now), cost, cost),
    env.DB.prepare("INSERT INTO answer_user_spend (user_id, month, micro, calls, voice_micro, topup_micro, launch_micro) " +
      "VALUES (?, ?, ?, 0, ?, ?, ?) ON CONFLICT (user_id, month) DO UPDATE SET micro = micro + excluded.micro, " +
      "voice_micro = voice_micro + excluded.voice_micro, topup_micro = topup_micro + excluded.topup_micro, " +
      "launch_micro = launch_micro + excluded.launch_micro")
      .bind(userId, month(now), cost, packId ? 0 : cost, packId ? cost : 0, launch && !packId ? cost : 0),
    ...(holdId ? [env.DB.prepare("DELETE FROM answer_holds WHERE id = ?").bind(holdId)] : []),
  ]);
}

// What the plan's answers cost this month (calendar month, UTC), for its text cap (costCapMicro): a finest-voice pack's
// replies pay for themselves, and its hosted voice is counted apart. With `total`, its answers and hosted voice
// together, for the total cap (totalCapMicro). Holds of answers still being written aren't counted. launch: the beta's free Hero's own
// answers instead (ownSpend).
export async function userSpend(env, userId, now = new Date(), { total = false, launch = false } = {}) {
  await setupBilling(env);
  const row = await env.DB.prepare(`SELECT ${ownSpend({ total, launch })} AS micro FROM answer_user_spend `
    + `WHERE user_id = ? AND month = ?`).bind(userId, month(now)).first();
  return row?.micro || 0;
}

// Where a paying player's calendar month stands against their plan's caps (her answers on 3.6 Flash, Mike, 10/19; the
// step-down is the pricing session's): "under" its text cap (costCapMicro, half its net); "lite" past it, when her
// answers go back to Flash-Lite (lib/companion-answers.js modelFor), not looking online, rather than to the lore library
// earlier than on Flash-Lite before; "capped" once its answers and hosted voice together have cost the plan's whole net
// (totalCapMicro), when the plan's answers wait for the next month, as when its pool is used
// (lib/companion-answers.js allowance, functions/api/companion/answer.js), so no player costs more than they pay.
// Never for the free plan, which the shared budget and the brake look after. The beta's free Hero has Hero's, on its
// own answers.
export async function capState(env, userId, plan, now = new Date()) {
  if (plan.id === "free" || !(plan.costCapMicro > 0)) return "under";
  await setupBilling(env);
  const launch = Boolean(plan.launch);
  const row = await env.DB.prepare(`SELECT ${ownSpend({ launch })} AS text, ${ownSpend({ total: true, launch })} AS total `
    + "FROM answer_user_spend WHERE user_id = ? AND month = ?").bind(userId, month(now)).first();
  return (row?.total || 0) >= plan.totalCapMicro ? "capped" : (row?.text || 0) >= plan.costCapMicro ? "lite" : "under";
}

// ---- Answers from friends and the finest-voice packs ----

// The account's answers from friends left (Share Willo, kind 'share': lib/referrals.js), and its finest-voice packs
// (VOICE_PACK): their replies left and how many it bought this month (a refunded one isn't counted):
// {share, voice: {remaining, boughtThisMonth}}.
export async function packsFor(env, userId, now = new Date()) {
  await setupBilling(env);
  const row = await env.DB.prepare(
    "SELECT COALESCE(SUM(CASE WHEN status = 'active' AND kind = 'share' THEN remaining ELSE 0 END), 0) AS share, " +
    "COALESCE(SUM(CASE WHEN status = 'active' AND kind = 'voice' THEN remaining ELSE 0 END), 0) AS voice, " +
    "COALESCE(SUM(kind = 'voice' AND status != 'refunded' AND substr(created, 1, 7) = ?), 0) AS voice_bought " +
    "FROM answer_packs WHERE user_id = ?"
  ).bind(month(now), userId).first();
  return { share: row?.share || 0,
           voice: { remaining: row?.voice || 0, boughtThisMonth: row?.voice_bought || 0 } };
}

// How /plans offers the finest-voice pack to this player (functions/api/billing/[action].js), decided here so the page
// doesn't guess: {text, buy (its button, when not the usual one)}, or null to leave it out. Legend already has the
// finest voice for its PLAN_VOICE best replies a plan month, so (Mike, 2026-10-13) it sees the pack only once 90% of
// them are said (LEGEND_PACK_LEFT or fewer left), as more of it for after them, with the day they come back. Every
// other plan sees it as it is: on Hero and Champion it's the finest voice they don't have. The companion never offers
// it.
export const LEGEND_PACK_LEFT = Math.floor(PLAN_VOICE.legend.best / 10);
export async function voicePackFor(env, userId, plan, now = new Date()) {
  if (plan?.id !== "legend") return { text: VOICE_PACK_TEXT };
  await setupBilling(env);
  const window = poolWindow(plan, now);
  const said = await env.DB.prepare("SELECT COALESCE(SUM(best), 0) AS n FROM voice_replies WHERE user_id = ? AND period = ?")
    .bind(userId, window.key).first();
  if (PLAN_VOICE.legend.best - (said?.n || 0) > LEGEND_PACK_LEFT) return null;
  const back = new Date(window.resetsAt).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
  return { text: `${VOICE_PACK.replies} more replies in ${NAME}'s finest voice, for after your monthly ` +
                 `${count(PLAN_VOICE.legend.best)} (back on ${back}). $${(VOICE_PACK.price / 100).toFixed(2)}, yours until ` +
                 "you use them.",
           buy: `Buy ${VOICE_PACK.replies} more replies` };
}

// Takes one of the account's answers from friends (Share Willo, lib/referrals.js), the oldest pack first, in one
// statement, so two questions at once can't spend the same answer: used once the plan's answers are gone, on any plan. A
// paying player's is a paid-for answer, so their plan's cost caps still hold it. The pack ({id, kind}), or null.
export async function useShare(env, userId) {
  await setupBilling(env);
  return env.DB.prepare(
    "UPDATE answer_packs SET remaining = remaining - 1 WHERE id = (SELECT id FROM answer_packs WHERE user_id = ? AND " +
    "kind = 'share' AND status = 'active' AND remaining > 0 ORDER BY created, id LIMIT 1) AND remaining > 0 RETURNING id, kind"
  ).bind(userId).first();
}

// Gives back an answer from friends whose live answer failed, or never reached the model
// (functions/api/companion/answer.js): it's for answers, not attempts.
export async function returnStarter(env, packId) {
  await env.DB.prepare("UPDATE answer_packs SET remaining = remaining + 1 WHERE id = ? AND status = 'active' AND remaining < answers")
    .bind(packId).run();
}

// The next plan up from this one that's for sale (from the free plan, and the beta's free Hero, which is the free
// plan's: Hero), or null: none above it (Legend), or nothing for sale.
export function planAbove(env, plan) {
  if (!billingOn(env)) return null;
  const sellable = sellablePlans(env);
  const id = PAID.slice(plan.launch ? 0 : PAID.indexOf(plan.id) + 1).find(p => sellable.includes(p));
  return id ? PLANS[id] : null;
}

// What the companion offers a player whose answers ran out (functions/api/companion/answer.js): the next plan up
// while it's for sale (planAbove), so Free's one offer is Hero. Answers can't be bought, and a finest-voice pack is
// about the voice, not more answers, so neither is offered; Legend gets nothing.
export function offersFor(env, plan) {
  const next = planAbove(env, plan);
  return next ? [{ id: next.id, text: `Get ${next.name}: ${count(next.answersPerMonth)} answers a month`, url: "/plans" }] : [];
}

// ---- Checkout and the billing portal ----

// Stripe's payment page for a plan: {url}, or {error} for a plan that isn't for sale or a yearly one (plans are
// monthly; interval may be left out). A player who already has a plan (in D1, or at Stripe a moment before the
// webhook says so: paid in another tab) is sent back to /plans, where they switch (changePlan), so nobody ends up
// with two subscriptions. creator: the creator whose link brought this account (lib/referrals.js creatorFor: {code,
// promoId}), or null: their promotion code takes its discount off the first month (once per account, its "creator"
// claim) when no beta offer applies, since Checkout takes one discount; and the subscription names the creator either
// way (metadata.creator), so what it pays counts for them (lib/referrals.js notePayment). source: where the checkout
// started, as /plans says it (CHECKOUT_SOURCE: "welcome", "plans", "willo-empty"...), kept on the subscription
// (metadata.source) and in plan_log, so /admin can tell which moments sell plans; anything else is left out.
export const CHECKOUT_SOURCE = /^[a-z][a-z-]{0,29}$/;
export async function createCheckout(env, user, planId, interval, origin, { creator = null, source = null } = {}) {
  await setupBilling(env);
  if (!sellablePlans(env).includes(planId)) return { error: "That plan isn't open yet." };
  if (interval !== undefined && interval !== null && interval !== "month") return { error: "Plans are monthly." };
  const row = await entitlement(env, user.id);
  if (paidNow(row)) return { url: `${origin}/plans` };
  const price = await priceId(env, lookupKey(planId));
  if (!price) throw new Error(`No Stripe price has the lookup key ${lookupKey(planId)}; run scripts/stripe-setup.mjs`);
  const customer = row?.customer_id || await newCustomer(env, user);
  const [live] = await liveSubscriptions(env, customer);
  if (live) {
    await storeSubscription(env, user.id, live);
    return { url: `${origin}/plans` };
  }
  // Also applies to a prepared customer whose id was not yet recorded in D1.
  // A plan's checkout page left open in another tab could start a second subscription: earlier ones are closed first.
  await closeOpenCheckouts(env, customer);
  // The beta (launchWeek): the plan's months start at the launch (billing_cycle_anchor; as far from the real clock as
  // from the promo's, PROMO_NOW on a preview, since Stripe wants it in its future), its first full charge then. Until
  // then Hero is free (no proration) and Champion and Legend half price for the days left (a prorated first invoice
  // with BETA_HALF on it, which Checkout shows and then takes no promotion codes: Stripe allows one or the other). If
  // Stripe has no BETA_HALF and the site can't make it (betaCoupon), they're free until then rather than full price.
  // metadata.launch says which, so the webhook records the claim for /admin (storeSubscription).
  const launchAt = launchNow(env), week = launchWindow(env);
  const offer = launchWeek(env, launchAt) ? offerKind(planId) : null;
  const coupon = offer === "half" ? await betaCoupon(env) : null;
  const anchor = offer ? { billing_cycle_anchor: Math.floor((Date.now() + week.end - launchAt.getTime()) / 1000),
                           proration_behavior: coupon ? "create_prorations" : "none" } : {};
  const fromCreator = !offer && creator?.promoId && !(await promoClaimed(env, user.id, "creator"));
  // Payment methods come from the Dashboard's settings (so no payment_method_types here), and tax from Managed
  // Payments when it's on (so no automatic_tax): prices include tax, and players pay exactly what's listed.
  const params = discounts => ({
    mode: "subscription", customer, line_items: [{ price, quantity: 1 }], client_reference_id: user.id,
    subscription_data: { metadata: { user_id: user.id, ...(offer ? { launch: offer } : {}),
      ...(creator?.code ? { creator: creator.code } : {}), ...(discounts && fromCreator ? { creator_offer: "1" } : {}),
      ...(CHECKOUT_SOURCE.test(source || "") ? { source } : {}) },
      ...anchor },
    ...(coupon ? { discounts: [{ coupon }] }
      : discounts && fromCreator ? { discounts: [{ promotion_code: creator.promoId }] } : { allow_promotion_codes: true }),
    integration_identifier: INTEGRATION_ID,
    ...(env.STRIPE_MANAGED_PAYMENTS === "1" ? { managed_payments: { enabled: true } } : {}),
    success_url: `${origin}/plans?billing=done`, cancel_url: `${origin}/plans`,
  });
  let session;
  try { session = await checkoutSession(env, params(true)); }
  catch (e) {
    // A creator's promotion code Stripe won't take (switched off in the Dashboard, or this customer paid before): the
    // checkout goes on without it, and the typed-code box is back.
    if (!fromCreator || e.status !== 400) throw e;
    console.warn(`billing: creator code ${creator.code} refused at checkout: ${e.message}`);
    session = await checkoutSession(env, params(false));
  }
  return { url: session.url };
}

// Stripe's payment page for a finest-voice pack (VOICE_PACK): {url}, or {error} for a player without a paid plan or
// once they've bought this month's VOICE_PACK.monthMax (the webhook counts them again when the payment lands). The
// beta's free Hero month isn't a paid plan: its pack would wait for one.
export async function createVoicePack(env, user, origin, now = new Date()) {
  await setupBilling(env);
  const plan = await planFor(env, user.id, now);
  if (plan.id === "free" || plan.launch) return { error: `${COMPANION_NAME}'s finest voice comes with a plan.` };
  if ((await packsFor(env, user.id, now)).voice.boughtThisMonth >= VOICE_PACK.monthMax)
    return { error: `You've bought this month's ${VOICE_PACK.monthMax}. You can buy more next month.` };
  const price = await priceId(env, VOICE_PACK.key);
  if (!price) throw new Error(`No Stripe price has the lookup key ${VOICE_PACK.key}; run scripts/stripe-setup.mjs`);
  const customer = (await entitlement(env, user.id))?.customer_id || await newCustomer(env, user);
  // As for plans: payment methods from the Dashboard, tax from Managed Payments. metadata.kind "voice" tells the
  // webhook what it is; the payment carries the account too, for Stripe's dashboard.
  const session = await checkoutSession(env, {
    mode: "payment", customer, line_items: [{ price, quantity: 1 }], client_reference_id: user.id,
    metadata: { kind: "voice" }, payment_intent_data: { metadata: { user_id: user.id } },
    integration_identifier: INTEGRATION_ID,
    ...(env.STRIPE_MANAGED_PAYMENTS === "1" ? { managed_payments: { enabled: true } } : {}),
    success_url: `${origin}/plans?voicepack=done#voicepack`, cancel_url: `${origin}/plans#voicepack`,
  });
  return { url: session.url };
}

// A Checkout page that asks for the Terms (consent_collection: a required, unticked box), for a plan or a pack. The
// Terms (public/terms.html "Starting right away") say that starting now ends the EU and UK 14-day right of
// withdrawal, as far as the law allows: Managed Payments shows Link's standard payment terms but asks nothing of the
// kind itself, and it refuses custom_text, so the box has Stripe's own words and links the Terms of service URL in the
// Dashboard's public details (Mike sets it: https://loreforeverwow.com/terms). Until that URL is set Stripe refuses
// the box; checkout then goes on without it, logged, so buying never breaks over it.
async function checkoutSession(env, params) {
  try {
    return await stripe(env, "POST", "checkout/sessions", { ...params, consent_collection: { terms_of_service: "required" } });
  } catch (e) {
    if (e.status !== 400 || !/terms of service/i.test(e.message)) throw e;
    console.warn("billing: Checkout can't ask for the Terms until Stripe's public details have a Terms of service URL");
    return stripe(env, "POST", "checkout/sessions", params);
  }
}

// Closes the customer's plan checkout pages that are still open (best effort: logged when Stripe can't be reached).
async function closeOpenCheckouts(env, customer) {
  try {
    const open = await stripe(env, "GET", "checkout/sessions", { customer, status: "open", limit: 20 });
    for (const s of open?.data || [])
      if (s.mode === "subscription") await stripe(env, "POST", `checkout/sessions/${encodeURIComponent(s.id)}/expire`);
  } catch (e) { console.warn(`billing: couldn't close earlier checkouts for ${customer}: ${e?.message || e}`); }
}

// The customer's subscriptions that still give a plan (a status in ACTIVE), oldest first, as Stripe has them now.
async function liveSubscriptions(env, customer) {
  const list = await stripe(env, "GET", "subscriptions", { customer, status: "all", limit: 20 });
  return (list?.data || []).filter(s => ACTIVE.includes(s.status))
    .sort((a, b) => (a.created || 0) - (b.created || 0) || (a.id < b.id ? -1 : 1));
}

// Reuse a customer prepared for this account (for example, a customer-bound creator offer). Email alone never
// establishes ownership: the user_id must also match. Otherwise create one, with the same idempotency key for a
// double click (two checkouts at once).
async function newCustomer(env, user) {
  const found = await stripe(env, "GET", "customers", { email: user.email, limit: 100 });
  const matching = (found.data || []).filter(c => c.email === user.email && c.metadata?.user_id === user.id && !c.deleted);
  if (found.has_more || matching.length > 1) throw new Error("Couldn't identify a single Stripe customer for this account.");
  const customer = matching[0] || await stripe(env, "POST", "customers",
    { email: user.email, metadata: { user_id: user.id } }, { idempotencyKey: `customer-${user.id}` });
  const assigned = await env.DB.prepare(
    "INSERT INTO entitlements (user_id, customer_id, updated) VALUES (?, ?, ?) " +
    "ON CONFLICT (user_id) DO UPDATE SET customer_id = COALESCE(entitlements.customer_id, excluded.customer_id), " +
    "updated = excluded.updated RETURNING customer_id"
  ).bind(user.id, customer.id, iso()).first();
  return assigned.customer_id;
}

// Stripe's billing portal (change plan, card, cancel, invoices): {url}, or {error} when there's nothing to manage.
export async function createPortal(env, user, origin) {
  await setupBilling(env);
  const row = await entitlement(env, user.id);
  if (!row?.customer_id) return { error: "There's no plan on this account to manage yet." };
  const configuration = await portalConfiguration(env);
  const session = await stripe(env, "POST", "billing_portal/sessions",
    { customer: row.customer_id, return_url: `${origin}/plans`, configuration });
  return { url: session.url };
}

// "Delete my account" (lib/accounts.js deleteUser): ends a subscription that could still charge, right away. Best
// effort: a failure is logged (cancel it by hand in Stripe's dashboard), and the account goes either way.
export async function cancelPlan(env, userId) {
  await setupBilling(env);
  const row = await entitlement(env, userId);
  if (!row?.customer_id) return;
  if (!env.STRIPE_SECRET_KEY) {
    if (row.subscription_id) console.warn(`billing: no Stripe key to cancel ${row.subscription_id} for a deleted account`);
    return;
  }
  try {
    const list = await stripe(env, "GET", "subscriptions", { customer: row.customer_id, status: "all", limit: 100 });
    for (const s of list?.data || [])
      if (!["canceled", "incomplete_expired"].includes(s.status)) await cancelNow(env, s);
  } catch (e) {
    throw Object.assign(new Error(`couldn't cancel ${row.customer_id}'s plan: ${e?.message || e}`), { billing: true });
  }
}

// Ends a subscription now, without a refund or a credit for the rest of its period (a waiting downgrade's schedule
// goes first). key: an idempotency key, for a webhook that may run twice.
async function cancelNow(env, subscription, key) {
  if (idOf(subscription.schedule)) await releaseSchedule(env, idOf(subscription.schedule));
  return stripe(env, "DELETE", `subscriptions/${encodeURIComponent(subscription.id)}`, {}, key ? { idempotencyKey: key } : {});
}

// Lets go of a subscription schedule (a downgrade waiting for the renewal): the subscription carries on as it is now.
// One that's already let go of, or done, is left as it is.
async function releaseSchedule(env, id) {
  try { await stripe(env, "POST", `subscription_schedules/${encodeURIComponent(id)}/release`); }
  catch (e) { if (e.status !== 400) throw e; }
}

// ---- Switching plans ----
//
// On /plans (POST /api/billing/change; the billing portal offers no plan changes, scripts/stripe-setup.mjs): a player
// with a plan picks another, reads what happens in plain words, and confirms. Upgrade: now, and charged now: Stripe's
// proration for the rest of the period, always_invoice, so nothing is left as pending invoice items for the renewal
// (where cancelling first would have kept the difference unpaid). What the confirm says is Stripe's own preview of that
// invoice, with the proration date the change then uses, so it's what's charged. If the card needs another step or
// fails, the change waits for the payment (pending_if_incomplete) and the player is sent to Stripe's page for that
// invoice. Downgrade: at the renewal, with nothing refunded (a subscription schedule: this period on the plan they
// have, then the lower one). Keep: undoes a waiting downgrade or a cancellation, with nothing charged. While a payment
// is failing (past_due) only an upgrade waits: the card comes first.
//
// Safe to click twice or from two tabs: a confirm holds a lock on the account (billing_locks) while it runs, reads the
// subscription from Stripe, not D1, says so when it isn't what the player saw (`from`), and its Stripe calls carry an
// idempotency key from the quote it confirms, so a retried call can't charge twice.
//
// changePlan: {preview: {kind ("upgrade" | "downgrade" | "keep"), plan, from, text, amount (an upgrade's, US cents),
// quote}}, {done: true, text}, {url} (Stripe's page to finish an upgrade's payment), or {error, reload (the page should
// load the plans again), stale (a new preview after an old quote)}.
const QUOTE_MINUTES = 30;
const money = cents => `$${(cents / 100).toFixed(2)}`;
const dayOf = seconds => new Date(seconds * 1000).toLocaleDateString("en-US", { month: "long", day: "numeric",
  timeZone: "UTC" });
const rankOf = id => PAID.indexOf(id);

export async function changePlan(env, user, planId, { confirm = false, from = null, quote = null } = {}) {
  await setupBilling(env);
  if (!PAID.includes(planId)) return { error: "That plan isn't open yet." };
  const row = await entitlement(env, user.id);
  if (!row?.customer_id) return { error: "There's no plan on this account to switch yet.", reload: true };
  const lock = confirm ? await lockChange(env, user.id) : "preview";
  if (!lock) return { error: "Your last change is still going through. One moment.", reload: true };
  try {
    const [sub] = await liveSubscriptions(env, row.customer_id);
    if (!sub) return { error: "That plan has ended. Choose a plan to start a new one.", reload: true };
    const state = await subscriptionState(env, sub);
    if (!state.plan) return { error: "That plan can't be switched here. Ask us on Discord." };
    if (from && from !== state.plan) {
      await storeSubscription(env, user.id, sub);
      return { error: "Your plan changed in another tab. Here's how it stands now.", reload: true };
    }
    if (planId !== state.plan && !sellablePlans(env).includes(planId)) return { error: "That plan isn't open yet." };
    const kind = planId === state.plan ? keepPlan : rankOf(planId) > rankOf(state.plan) ? upgradePlan : downgradePlan;
    const out = await kind(env, user, sub, state, planId, { confirm, quote });
    // What Stripe has now, in D1 at once, so the page shows it without waiting for the webhook.
    if (confirm && (out.done || out.url)) await storeSubscription(env, user.id, await stripe(env, "GET", `subscriptions/${sub.id}`));
    return out;
  } finally {
    if (confirm) await env.DB.prepare("DELETE FROM billing_locks WHERE user_id = ? AND until = ?").bind(user.id, lock).run();
  }
}

// The lock a confirm holds for 30 seconds at most (a request cut off can't keep it): its `until`, or null while
// another holds it.
async function lockChange(env, userId, now = Date.now()) {
  const until = iso(now + 30e3);
  const res = await env.DB.prepare("INSERT INTO billing_locks (user_id, until) VALUES (?, ?) ON CONFLICT (user_id) " +
    "DO UPDATE SET until = excluded.until WHERE billing_locks.until < ?").bind(userId, until, iso(now)).run();
  return res.meta.changes ? until : null;
}

// What a subscription is now: {plan (the one billed), item, ends (unix seconds), schedule (a waiting change's, or
// null), next ({plan, at}, a downgrade waiting for the renewal), cancelling}.
async function subscriptionState(env, sub) {
  const item = sub.items?.data?.[0];
  const plan = planOfPrice(item?.price);
  const schedule = await scheduleOf(env, sub);
  return { plan: PAID.includes(plan) ? plan : null, item, ends: item?.current_period_end ?? sub.current_period_end,
           schedule, next: nextOf(schedule, plan), cancelling: Boolean(sub.cancel_at_period_end || sub.cancel_at) };
}

// A subscription's schedule that's still to run (active or not started), with its phases' prices, or null.
async function scheduleOf(env, sub) {
  const id = idOf(sub.schedule);
  if (!id) return null;
  const schedule = await stripe(env, "GET", `subscription_schedules/${encodeURIComponent(id)}`, { expand: ["phases.items.price"] });
  return ["active", "not_started"].includes(schedule?.status) ? schedule : null;
}

// The plan a schedule changes to after its current phase ({plan, at: ISO}), or null when it changes nothing.
function nextOf(schedule, plan) {
  const end = schedule?.current_phase?.end_date;
  const next = end ? (schedule.phases || []).find(p => p.start_date >= end) : null;
  const to = planOfPrice(next?.items?.[0]?.price);
  return PAID.includes(to) && to !== plan ? { plan: to, at: iso(next.start_date * 1000) } : null;
}

// The plan a Stripe price is for: by its lookup key, or, for an older price whose key moved to a newer one
// (scripts/stripe-setup.mjs), by its product (lore_forever_<plan>).
export function planOfPrice(price) {
  const byKey = String(price?.lookup_key || "").replace(/_(monthly|yearly)$/, "");
  return PAID.includes(byKey) ? byKey : String(idOf(price?.product) || "").replace(/^lore_forever_/, "");
}

const renewsLine = (planId, state) => `It renews on ${dayOf(state.ends)} at ${money(PLANS[planId].monthly)} a month.`;

async function keepPlan(env, user, sub, state, planId, { confirm }) {
  const name = PLANS[planId].name;
  if (!state.next && !state.cancelling) return { done: true, text: `${name} is already your plan. ${renewsLine(planId, state)}` };
  if (!confirm) return { preview: { kind: "keep", plan: planId, from: state.plan,
    text: `You keep ${name}. ${renewsLine(planId, state)}` } };
  if (state.schedule) await releaseSchedule(env, state.schedule.id);
  if (state.cancelling) await stripe(env, "POST", `subscriptions/${sub.id}`, { cancel_at_period_end: false });
  return { done: true, text: `You're keeping ${name}. ${renewsLine(planId, state)}` };
}

async function upgradePlan(env, user, sub, state, planId, { confirm, quote }) {
  if (!["active", "trialing"].includes(sub.status))
    return { error: "Your last payment didn't go through. Update your card under Manage billing, then switch." };
  const price = await priceId(env, lookupKey(planId));
  if (!price) throw new Error(`No Stripe price has the lookup key ${lookupKey(planId)}; run scripts/stripe-setup.mjs`);
  const name = PLANS[planId].name;
  // The beta (launchWeek: before the launch, every plan's pay day). A plan that's free until the launch (a Stripe
  // trial: Keep Hero, or a paid plan moved to the launch by payDay) stays so: the new plan starts now and nothing is
  // charged until the launch, then its full price. A paid one is charged now for the days left, at half price
  // (BETA_HALF on the new price's item, duration once: this change's invoice; the same in the preview and the change,
  // so what's shown is what's charged), and the full price from the launch. After the launch, a trial ends now: the
  // new plan's paid month starts today.
  const trialing = sub.status === "trialing", beta = launchWeek(env);
  const keep = trialing && beta;
  const coupon = beta && !keep && offerKind(planId) === "half" ? await betaCoupon(env) : null;
  const change = { items: [{ id: state.item.id, price, ...(coupon ? { discounts: [{ coupon }] } : {}) }],
                   proration_behavior: keep ? "none" : "always_invoice", ...(trialing && !keep ? { trial_end: "now" } : {}) };
  const q = confirm ? await readQuote(env, quote, { u: user.id, s: sub.id, f: state.plan, t: planId, c: coupon }) : null;
  const after = `then ${money(PLANS[planId].monthly)} a month`;
  if (keep && !q) return { ...(confirm ? { stale: true } : {}), preview: { kind: "upgrade", plan: planId, from: state.plan,
    amount: 0, text: `${name} starts now, with nothing to pay until ${dayOf(state.ends)}: ${after}.`,
    quote: await makeQuote(env, { u: user.id, s: sub.id, f: state.plan, t: planId, c: coupon, amount: 0, renews: state.ends }) } };
  if (!q) {
    // Stripe's own invoice for the change, made now: what the confirm says is what's charged.
    const preview = await stripe(env, "POST", "invoices/create_preview", { customer: idOf(sub.customer),
      subscription: sub.id, subscription_details: change });
    const at = preview.parent?.subscription_details?.subscription_proration_date ?? preview.subscription_proration_date ?? null;
    if (!Number.isFinite(at) && !trialing) throw new Error("Stripe's preview has no proration date");
    const amount = preview.amount_due;
    // When the month after this one is charged: the period's end, or a month from now after a trial.
    const renews = Math.max(state.ends || 0, ...(preview.lines?.data || []).map(l => l.period?.end || 0));
    const today = trialing ? "your first month" : coupon ? "the days until launch, at half price" : "the rest of this month";
    return { ...(confirm ? { stale: true } : {}), preview: { kind: "upgrade", plan: planId, from: state.plan, amount,
      text: `${name} starts now. You'll pay ${money(amount)} today for ${today}, then ` +
            `${money(PLANS[planId].monthly)} on ${dayOf(renews)}.`,
      quote: await makeQuote(env, { u: user.id, s: sub.id, f: state.plan, t: planId, c: coupon, at, amount, renews }) } };
  }
  // A downgrade waiting for the renewal would undo this one then: it goes first.
  if (state.schedule) await releaseSchedule(env, state.schedule.id);
  let updated;
  try {
    // A kept trial makes no invoice, so there's no payment to wait for.
    updated = await stripe(env, "POST", `subscriptions/${sub.id}`, { ...change,
      ...(Number.isFinite(q.at) ? { proration_date: q.at } : {}), ...(keep ? {} : { payment_behavior: "pending_if_incomplete" }),
      expand: ["latest_invoice"] }, { idempotencyKey: `lf-upgrade-${q.n}` });
  } catch (e) {
    if (e.status === 409) return { error: "Your last change is still going through. One moment.", reload: true };
    throw e;
  }
  const invoice = updated.latest_invoice;
  if (updated.pending_update) {
    // The card needs another step, or was declined: the change waits for this invoice to be paid.
    if (invoice?.hosted_invoice_url) return { url: invoice.hosted_invoice_url };
    return { error: `The payment didn't go through, so you're still on ${PLANS[state.plan].name}. Update your card ` +
                    "under Manage billing, then try again." };
  }
  if (coupon) {
    await promoClaim(env, user.id, "half", sub.id);
    await stripe(env, "POST", `subscriptions/${sub.id}`, { metadata: { launch: "half" } });
  }
  if (state.cancelling) await stripe(env, "POST", `subscriptions/${sub.id}`, { cancel_at_period_end: false });
  if (keep) return { done: true, charged: 0,
    text: `You're on ${name} now, with nothing to pay until ${dayOf(q.renews || state.ends)}: ${after}.` };
  const paid = invoice?.amount_paid ?? q.amount;
  return { done: true, charged: paid, invoice: invoice?.id,
           text: `You're on ${name} now. You paid ${money(paid)} today, then ${money(PLANS[planId].monthly)} on ` +
                 `${dayOf(q.renews || state.ends)}.` };
}

async function downgradePlan(env, user, sub, state, planId, { confirm, quote }) {
  const name = PLANS[planId].name;
  const text = `You keep ${PLANS[state.plan].name} until ${dayOf(state.ends)}, then ${name} at ` +
               `${money(PLANS[planId].monthly)} a month.`;
  if (state.next?.plan === planId && !state.cancelling) return { done: true, text };
  const q = confirm ? await readQuote(env, quote, { u: user.id, s: sub.id, f: state.plan, t: planId }) : null;
  if (!q) return { ...(confirm ? { stale: true } : {}), preview: { kind: "downgrade", plan: planId, from: state.plan,
    text, quote: await makeQuote(env, { u: user.id, s: sub.id, f: state.plan, t: planId }) } };
  const price = await priceId(env, lookupKey(planId));
  if (!price) throw new Error(`No Stripe price has the lookup key ${lookupKey(planId)}; run scripts/stripe-setup.mjs`);
  if (state.cancelling) await stripe(env, "POST", `subscriptions/${sub.id}`, { cancel_at_period_end: false });
  if (state.schedule) await releaseSchedule(env, state.schedule.id);
  // This period on the plan they have, then the lower one; released after it, so the subscription carries on by
  // itself. Nothing is prorated either way. A discount the subscription has (a promotion code) stays on both. A trial
  // (free until the launch) stays one to its end, so nothing is charged before the lower plan starts.
  const schedule = await stripe(env, "POST", "subscription_schedules", { from_subscription: sub.id },
    { idempotencyKey: `lf-downgrade-${q.n}` });
  const now = schedule.phases?.[0] || {};
  const discounts = (now.discounts || []).map(d => d.discount ? { discount: idOf(d.discount) } : { coupon: idOf(d.coupon) });
  await stripe(env, "POST", `subscription_schedules/${schedule.id}`, { end_behavior: "release", proration_behavior: "none",
    phases: [{ items: [{ price: state.item.price.id, quantity: 1 }], start_date: now.start_date, end_date: state.ends,
               proration_behavior: "none", discounts, ...(sub.status === "trialing" ? { trial_end: state.ends } : {}) },
             { items: [{ price, quantity: 1 }], duration: { interval: "month", interval_count: 1 },
               proration_behavior: "none", discounts }] },
    { idempotencyKey: `lf-downgrade-phases-${q.n}` });
  return { done: true, text };
}

// A quote: what a preview showed (u: the account, s: the subscription, f and t: from and to, at: the proration date,
// amount), signed with a key only the site has, so a confirm uses exactly that (a later proration date would charge
// less). Good for QUOTE_MINUTES; n: its own random id, for Stripe's idempotency keys.
async function quoteSign(env, body) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`quote:${env.STRIPE_SECRET_KEY}`),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
}
async function makeQuote(env, fields) {
  const body = btoa(JSON.stringify({ ...fields, n: hex(crypto.getRandomValues(new Uint8Array(12))), iat: Date.now() }));
  return `${body}.${await quoteSign(env, body)}`;
}
// The quote's fields when it's ours, fresh, and for this very change (want), else null.
async function readQuote(env, quote, want) {
  const [body, sig] = String(quote || "").split(".");
  if (!body || !sig || !same(sig, await quoteSign(env, body))) return null;
  let q;
  try { q = JSON.parse(atob(body)); } catch (e) { return null; }
  if (!(Date.now() - q.iat < QUOTE_MINUTES * 60e3)) return null;
  return Object.entries(want).every(([k, v]) => q[k] === v) ? q : null;
}

// ---- The webhook ----

// The event, when the Stripe-Signature header ("t=<unix seconds>,v1=<hex>", more than one v1 while a secret is being
// rolled) is an HMAC-SHA256 of "<t>.<raw body>" with STRIPE_WEBHOOK_SECRET made in the last WEBHOOK_TOLERANCE
// seconds; null otherwise.
export async function verifyWebhook(env, rawBody, signatureHeader, now = new Date()) {
  // Production keeps the live webhook's secret under the name scripts/stripe-setup.mjs --live writes it as; each one
  // set is tried, so a test secret left beside it can't turn the live events away.
  const secrets = [env.STRIPE_WEBHOOK_SECRET, env.STRIPE_LIVE_WEBHOOK_SECRET].filter(s => typeof s === "string" && s);
  if (!secrets.length || typeof rawBody !== "string") return null;
  let t = "";
  const signatures = [];
  for (const part of String(signatureHeader || "").split(",")) {
    const at = part.indexOf("=");
    const k = part.slice(0, at).trim(), v = part.slice(at + 1).trim();
    if (k === "t") t = v;
    else if (k === "v1") signatures.push(v);
  }
  if (!/^\d{1,12}$/.test(t) || !signatures.length) return null;
  if (Math.abs(now.getTime() / 1000 - Number(t)) > WEBHOOK_TOLERANCE) return null;
  const signed = new TextEncoder().encode(`${t}.${rawBody}`);
  const expected = await Promise.all(secrets.map(async secret => hex(await crypto.subtle.sign("HMAC",
    await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
    signed))));
  if (!signatures.some(s => expected.some(want => same(s, want)))) return null;
  try {
    const event = JSON.parse(rawBody);
    return event && typeof event.id === "string" && typeof event.type === "string" ? event : null;
  } catch (e) { return null; }
}

// Applies a verified event once (a repeat of its id is skipped). Plan events fetch the subscription from Stripe and
// store what it says now, so their order doesn't matter. A checkout in payment mode is a finest-voice pack. A refund
// or a dispute (refunded, disputed): of a pack's payment, it takes that pack's replies back and nothing else; of a
// plan's payment (an invoice's), the plan ends now (a refund only when it's the whole of the current period's own
// payment; an earlier month's or an upgrade's is goodwill). Other events are
// recorded and ignored. Throws when Stripe or D1 fails; the event is forgotten then, so Stripe's retry gets another go.
export async function applyEvent(env, event) {
  await setupBilling(env);
  const fresh = await env.DB.prepare("INSERT OR IGNORE INTO billing_events (id, type, created) VALUES (?, ?, ?)")
    .bind(event.id, event.type, iso()).run();
  if (!fresh.meta.changes) return { skipped: "seen" };
  if (!PLAN_EVENTS.includes(event.type) && !PACK_EVENTS.includes(event.type)) return { skipped: "recorded" };
  // A test-mode event reaching the live site (or the reverse) never credits anything.
  if (typeof event.livemode === "boolean" && event.livemode !== /^[sr]k_live_/.test(String(env.STRIPE_SECRET_KEY || "")))
    return { skipped: "other mode" };
  const object = event.data?.object || {};
  try {
    if (event.type === "charge.refunded") return await refunded(env, object);
    if (event.type === "charge.dispute.created") return await disputed(env, object);
    if (event.type.startsWith("checkout.session.") && object.mode === "payment") return await creditPack(env, object);
    return await applySubscription(env, event);
  } catch (e) {
    await env.DB.prepare("DELETE FROM billing_events WHERE id = ?").bind(event.id).run();
    throw e;
  }
}

async function applySubscription(env, event) {
  const object = event.data?.object || {};
  const checkout = event.type.startsWith("checkout.session.");
  // A checkout whose payment is still on its way (a bank debit, say) gives nothing yet; async_payment_succeeded follows.
  if (checkout && object.payment_status === "unpaid") return { skipped: "unpaid" };
  // An invoice names its subscription under parent since API version 2025-03-31, directly before that.
  const subscriptionId = idOf(checkout ? object.subscription : event.type.startsWith("invoice.")
    ? object.parent?.subscription_details?.subscription ?? object.subscription : object.id);
  if (!subscriptionId) return { skipped: "no subscription" };
  const subscription = await stripe(env, "GET", `subscriptions/${encodeURIComponent(subscriptionId)}`);
  const userId = await userFor(env, idOf(subscription.customer) || idOf(object.customer),
    checkout ? object.client_reference_id : null, subscription.metadata?.user_id);
  if (!userId) return { skipped: "no account" };
  return storeSubscription(env, userId, subscription);
}

// The account a subscription is for, through Stripe's own objects first: the customer we made for the account, then a
// checkout's client_reference_id, and only then the user id we put in the subscription's metadata. null for an
// account that's gone.
async function userFor(env, customerId, ...claimed) {
  if (customerId) {
    const row = await env.DB.prepare("SELECT user_id FROM entitlements WHERE customer_id = ?").bind(customerId).first();
    if (row) return row.user_id;
  }
  for (const id of claimed) {
    if (typeof id !== "string" || !id) continue;
    const user = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(id).first();
    if (user) return user.id;
  }
  return null;
}

// Stores what a subscription (as Stripe has it now) gives the account. deduped: keepOldest already looked at Stripe.
async function storeSubscription(env, userId, subscription, { deduped = false } = {}) {
  const item = subscription.items?.data?.[0];
  const key = String(item?.price?.lookup_key || "");
  const planId = planOfPrice(item?.price);
  const status = String(subscription.status || "");
  // Deleted, cancelled, unpaid and the like are the free plan; the row keeps its status for /admin.
  const plan = ACTIVE.includes(status) && PAID.includes(planId) ? planId : "free";
  const interval = item?.price?.recurring?.interval || (key.endsWith("_yearly") ? "year" : key.endsWith("_monthly") ? "month" : null);
  // Since API version 2025-03-31 the period is on the subscription's item; older versions have it on the subscription.
  const end = item?.current_period_end ?? subscription.current_period_end;
  const row = await entitlement(env, userId);
  const other = row?.subscription_id && row.subscription_id !== subscription.id && paidNow(row);
  // An old subscription's late news (it was cancelled, say) never replaces a newer one that's still paid.
  if (plan === "free" && other) return { skipped: "older subscription" };
  // Two live subscriptions (two checkout pages paid at once): the oldest stays, the others are cancelled and refunded,
  // whichever's news came first.
  if (plan !== "free" && other && !deduped) {
    const kept = await keepOldest(env, idOf(subscription.customer) || row.customer_id);
    return kept ? storeSubscription(env, userId, kept, { deduped: true }) : { skipped: "no live subscription" };
  }
  // A downgrade waiting for the renewal (changePlan): what it changes to, and when.
  const next = plan === "free" ? null : nextOf(await scheduleOf(env, subscription), planId);
  // The beta's offer it was made with (checkout's metadata.launch, or an upgrade's): the account has had it now.
  const kind = subscription.metadata?.launch;
  if (kind === "hero" || kind === "half") await promoClaim(env, userId, kind, subscription.id);
  // A creator's first-month discount (createCheckout creator): once per account too.
  if (subscription.metadata?.creator_offer === "1") await promoClaim(env, userId, "creator", subscription.id);
  const promo = null;   // promo_champion_until: the old Champion-month promo, gone
  await env.DB.prepare(
    "INSERT INTO entitlements (user_id, customer_id, subscription_id, plan, interval, status, current_period_end, " +
    "cancel_at_period_end, promo_champion_until, next_plan, next_plan_at, gap_from, updated) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT (user_id) DO UPDATE SET " +
    "customer_id = COALESCE(excluded.customer_id, entitlements.customer_id), subscription_id = excluded.subscription_id, " +
    "plan = excluded.plan, interval = excluded.interval, status = excluded.status, " +
    "current_period_end = excluded.current_period_end, cancel_at_period_end = excluded.cancel_at_period_end, " +
    "promo_champion_until = excluded.promo_champion_until, next_plan = excluded.next_plan, " +
    "next_plan_at = excluded.next_plan_at, gap_from = excluded.gap_from, updated = excluded.updated"
  ).bind(userId, idOf(subscription.customer), subscription.id, plan, interval, status,
         Number.isFinite(end) ? iso(end * 1000) : null, subscription.cancel_at_period_end || subscription.cancel_at ? 1 : 0,
         promo, next?.plan ?? null, next?.at ?? null, gapFrom(subscription), iso()).run();
  // For /admin only, so it never fails the webhook.
  try { await logSubscription(env, userId, subscription); }
  catch (e) { console.warn(`billing: plan_log: ${e?.message || e}`); }
  // A new subscriber's thank-you from Mike, once per account (lib/thanks.js); it never fails the webhook either. Its
  // trial is the beta's Keep Hero from before the launch anchor (a paid plan moved to the launch is a trial too).
  if (plan !== "free") await thankSubscriber(env, userId, subscription, { id: plan, name: PLANS[plan].name,
    picks: voicePicks(env, plan), trial: status === "trialing" && subscription.metadata?.launch === "hero" });
  return { user: userId, plan, status, ...(next ? { next: next.plan } : {}) };
}

// The beta promo's offers, once per account, ever: an offer of a kind ("hero", the trial; "half", a 50% first month)
// is claimed by the first subscription that had it, by the account's one-way Google code (starterClaim), so it
// outlives "Delete my account" as the starter's does; the free Hero month ("free") the same way (freeHeroMonth), and
// Willo's best first ("taste", lib/best-first.js).
export const claimOf = async (env, userId, kind) => `${kind}:${(await starterClaim(env, userId)) || `user:${userId}`}`;
async function promoClaim(env, userId, kind, subscriptionId) {
  await env.DB.prepare("INSERT OR IGNORE INTO promo_claims (claim, subscription_id, created) VALUES (?, ?, ?)")
    .bind(await claimOf(env, userId, kind), subscriptionId, iso()).run();
}
export async function promoClaimed(env, userId, kind) {
  if (!kind) return true;
  await setupBilling(env);
  return Boolean(await env.DB.prepare("SELECT 1 AS y FROM promo_claims WHERE claim = ?")
    .bind(await claimOf(env, userId, kind)).first());
}

// One subscription per account: of the customer's live ones, the oldest stays and the others are cancelled now and
// their payments refunded in full (logged). The one kept, or null.
async function keepOldest(env, customer) {
  const [kept, ...extra] = await liveSubscriptions(env, customer);
  for (const sub of extra) {
    console.warn(`billing: ${customer} has a second plan, ${sub.id}; cancelling and refunding it`);
    await cancelNow(env, sub, `lf-second-${sub.id}`);
    const { data: invoices } = await stripe(env, "GET", "invoices", { subscription: sub.id, status: "paid", limit: 20 });
    for (const invoice of invoices || []) {
      const { data: payments } = await stripe(env, "GET", "invoice_payments", { invoice: invoice.id, limit: 10 });
      for (const p of payments || []) {
        const pi = idOf(p.payment?.payment_intent);
        if (pi && p.status === "paid") await stripe(env, "POST", "refunds", { payment_intent: pi,
          metadata: { reason: "second plan" } }, { idempotencyKey: `lf-second-refund-${pi}` });
      }
    }
  }
  return kept || null;
}

// charge.refunded: a pack's payment takes back that pack (refundPack, a partial refund too); the whole of the plan's
// payment for its current period ends the plan now (endPlanFor). A refund of an earlier month's payment, or of an
// upgrade's charge, is goodwill: the plan stays (Mike, 2026-10-14).
async function refunded(env, charge) {
  const pack = await refundPack(env, charge);
  if (!pack.skipped || pack.skipped === "no payment") return pack;
  if (!charge.refunded) return { skipped: "part of a payment" };
  return endPlanFor(env, idOf(charge.payment_intent), "refunded");
}

// charge.dispute.created: a dispute of a pack's payment takes back that pack's replies, and only that; a dispute of a
// plan's payment ends the plan now, and leaves the packs.
async function disputed(env, dispute) {
  const pack = await refundPack(env, dispute, "disputed");
  if (!pack.skipped || pack.skipped === "no payment") return pack;
  return endPlanFor(env, idOf(dispute.payment_intent), "disputed");
}

// The plan a payment paid for (its invoice's subscription) ends now, and the account is on the free plan. A payment
// that's no plan's (a pack's, or one Stripe has no invoice for) changes nothing. A dispute counts whichever of the
// plan's payments it is; a refund only the current period's own (the invoice that started or renewed into it:
// billing_reason subscription_create or subscription_cycle, its line's period starting when the subscription's does).
async function endPlanFor(env, paymentIntent, why) {
  if (!paymentIntent) return { skipped: "no payment" };
  const { data } = await stripe(env, "GET", "invoice_payments",
    { payment: { type: "payment_intent", payment_intent: paymentIntent }, limit: 1 });
  const invoiceId = idOf(data?.[0]?.invoice);
  if (!invoiceId) return { skipped: "not a plan's payment" };
  const invoice = await stripe(env, "GET", `invoices/${encodeURIComponent(invoiceId)}`);
  const subscriptionId = idOf(invoice.parent?.subscription_details?.subscription ?? invoice.subscription);
  if (!subscriptionId) return { skipped: "not a plan's payment" };
  let sub = await stripe(env, "GET", `subscriptions/${encodeURIComponent(subscriptionId)}`);
  // Only a subscription of one of our accounts is ended (one we don't know of is left as it is).
  const userId = await userFor(env, idOf(sub.customer), sub.metadata?.user_id);
  if (!userId) return { skipped: "no account" };
  if (why === "refunded") {
    const start = sub.items?.data?.[0]?.current_period_start ?? sub.current_period_start;
    const period = (invoice.lines?.data || []).find(l => l.period)?.period;
    const current = ["subscription_create", "subscription_cycle"].includes(invoice.billing_reason) &&
      Number.isFinite(start) && period?.start === start;
    if (!current) return { skipped: "goodwill refund", user: userId, invoice: invoiceId };
  }
  if (!["canceled", "incomplete_expired"].includes(sub.status)) sub = await cancelNow(env, sub, `lf-end-${subscriptionId}`);
  await storeSubscription(env, userId, sub);
  return { user: userId, ended: subscriptionId, why };
}

// A paid finest-voice pack checkout (checkout metadata.kind "voice"; completed, or its delayed payment succeeded): one
// pack for the account, keyed by the session's id, so its events together credit it once. What's credited is what
// Stripe says about the session now, as for plans, not what the event carried. A purchase past the month's
// VOICE_PACK.monthMax (two checkouts opened at once) was paid for, so it still credits, and is logged. Any other
// payment-mode checkout (an answer top-up from before they went) credits nothing. Stripe can send a refund or a
// dispute of the payment before the checkout's own event (seconds before, in Mike's sandbox): the payment's charge is
// read too, and a refunded or disputed one is kept as such, with no replies.
async function creditPack(env, sent) {
  if (sent.metadata?.kind !== "voice" || typeof sent.id !== "string") return { skipped: "not a pack" };
  const session = await stripe(env, "GET", `checkout/sessions/${encodeURIComponent(sent.id)}`);
  if (session.mode !== "payment" || session.metadata?.kind !== "voice") return { skipped: "not a pack" };
  if (session.payment_status !== "paid") return { skipped: "unpaid" };
  const userId = await userFor(env, idOf(session.customer), session.client_reference_id);
  if (!userId) return { skipped: "no account" };
  const paymentIntent = idOf(session.payment_intent);
  const charge = paymentIntent ? (await stripe(env, "GET", `payment_intents/${encodeURIComponent(paymentIntent)}`,
    { expand: ["latest_charge"] }))?.latest_charge : null;
  const status = charge?.disputed ? "disputed" : charge?.amount_refunded > 0 || charge?.refunded ? "refunded" : "active";
  const bought = (await packsFor(env, userId)).voice.boughtThisMonth, size = VOICE_PACK.replies;
  const made = await env.DB.prepare(
    "INSERT OR IGNORE INTO answer_packs (id, user_id, kind, answers, remaining, payment_intent, status, created) " +
    "VALUES (?, ?, 'voice', ?, ?, ?, ?, ?)"
  ).bind(session.id, userId, size, status === "active" ? size : 0, paymentIntent, status, iso()).run();
  if (!made.meta.changes) return { skipped: "credited" };
  if (status !== "active") return { user: userId, voice: 0, [status]: paymentIntent };
  if (bought >= VOICE_PACK.monthMax)
    console.warn(`billing: voice pack ${session.id} is number ${bought + 1} this month for ${userId}; credited anyway`);
  return { user: userId, voice: size };
}

// A refunded finest-voice pack payment (Stripe sends charge.refunded for a partial refund too), or a disputed one (a
// chargeback: charge.dispute.created, with status "disputed"; security review L5): that pack's replies left go, and
// it's marked so; the account's other packs and its plan stay. A refund or dispute of a plan's payment matches no pack
// (endPlanFor), and a starter, never bought, is never touched. A disputed pack still counts as one of the month's
// (packsFor).
async function refundPack(env, charge, status = "refunded") {
  const paymentIntent = idOf(charge.payment_intent);
  if (!paymentIntent) return { skipped: "no payment" };
  const res = await env.DB.prepare(
    "UPDATE answer_packs SET remaining = 0, status = ? WHERE payment_intent = ? AND kind = 'voice'"
  ).bind(status, paymentIntent).run();
  return res.meta.changes ? { [status]: paymentIntent } : { skipped: "not a pack" };
}

// ---- /admin ----

// Coupons that make a plan free on purpose, never revenue. Any coupon that takes 100% off counts, once Stripe's coupon
// can be read (compOf), so a new creator's comp needs nothing here; these ids count even when only the id arrives and
// the coupon can't be read: Mike's own Legend ("owner-legend-free", 100% off forever) and TikTok creator domin0gam3s's
// three months of Legend (Mike, 10/20: "domino-games-free"; "creator-legend-3mo", the name planned for it). When a
// comp's months end and the plan carries on paid, its discounts change and it counts as paid again.
export const COMP_COUPONS = ["owner-legend-free", "creator-legend-3mo", "domino-games-free"];
const LAUNCH_COUPON_IDS = [...Object.values(LAUNCH_COUPONS).map(c => c.id), BETA_HALF.id];

// The coupons a subscription's discounts name ([] for none), or null when Stripe sent the discounts as ids only (the
// webhook's fetch doesn't expand them; checkPlanLog does).
function couponsOf(subscription) {
  const discounts = [...(Array.isArray(subscription.discounts) ? subscription.discounts : []),
                     ...(subscription.discount ? [subscription.discount] : [])];
  if (discounts.some(d => typeof d === "string")) return null;
  return discounts.map(d => d?.coupon ?? d?.source?.coupon).filter(Boolean);
}

// '' when the coupons leave it a paid plan, or the id of the one that makes it free. A coupon known by its id alone is
// read from Stripe (read-only); one that can't be read counts as paid.
async function compOf(env, coupons) {
  for (const c of coupons) {
    const id = idOf(c);
    if (COMP_COUPONS.includes(id)) return id;
    if (!id || LAUNCH_COUPON_IDS.includes(id)) continue;
    const coupon = typeof c === "object" ? c
      : await stripe(env, "GET", `coupons/${encodeURIComponent(id)}`).catch(() => null);
    if (coupon?.percent_off === 100) return id;
  }
  return "";
}

// Notes what a subscription is now in plan_log (storeSubscription, checkPlanLog). Its comp stays as read while its
// discounts don't change.
async function logSubscription(env, userId, subscription) {
  const coupons = couponsOf(subscription);
  const comp = coupons ? await compOf(env, coupons) : null;
  const at = s => Number.isFinite(s) ? iso(s * 1000) : null;
  const planId = planOfPrice(subscription.items?.data?.[0]?.price);
  await env.DB.prepare(
    "INSERT INTO plan_log (subscription_id, user_id, plan, status, started, canceled, ended, discounts, comp, updated, " +
    "source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (subscription_id) DO UPDATE SET " +
    "user_id = COALESCE(excluded.user_id, plan_log.user_id), plan = excluded.plan, status = excluded.status, " +
    "started = excluded.started, canceled = excluded.canceled, ended = excluded.ended, " +
    "comp = CASE WHEN excluded.comp IS NULL AND excluded.discounts = plan_log.discounts THEN plan_log.comp ELSE excluded.comp END, " +
    "discounts = excluded.discounts, updated = excluded.updated, source = COALESCE(plan_log.source, excluded.source)"
  ).bind(subscription.id, userId, PAID.includes(planId) ? planId : null, String(subscription.status || ""),
         at(subscription.start_date ?? subscription.created), at(subscription.canceled_at), at(subscription.ended_at),
         JSON.stringify((subscription.discounts || []).map(idOf)), comp, iso(),
         CHECKOUT_SOURCE.test(subscription.metadata?.source || "") ? subscription.metadata.source : null).run();
}

// Before /admin counts plans: reads from Stripe (GET only) the subscriptions plan_log doesn't know yet, or whose
// coupons it hasn't read, at most `limit` a load, so comps are never counted as revenue. Without a Stripe key, nothing.
export async function checkPlanLog(env, limit = 10) {
  if (isReportRead(env)) return;
  if (!env.STRIPE_SECRET_KEY) return 0;
  const { results } = await env.DB.prepare(
    "SELECT e.user_id, e.subscription_id FROM entitlements e LEFT JOIN plan_log p ON p.subscription_id = e.subscription_id " +
    "WHERE e.subscription_id IS NOT NULL AND (p.subscription_id IS NULL OR p.comp IS NULL) " +
    "UNION SELECT user_id, subscription_id FROM plan_log WHERE comp IS NULL LIMIT ?").bind(limit).all();
  const done = await Promise.all(results.map(async r => {
    try {
      const sub = await stripe(env, "GET", `subscriptions/${encodeURIComponent(r.subscription_id)}`, { expand: ["discounts"] });
      await logSubscription(env, r.user_id, sub);
      return 1;
    } catch (e) {
      console.warn(`billing: checking ${r.subscription_id}: ${e?.message || e}`);
      return 0;
    }
  }));
  return done.reduce((a, b) => a + b, 0);
}

// The beta's free Hero months running at `now`, for subscriptionReport's onPlan: {players, owner}, the accounts that have
// one and no plan some other way (covered: the ids on a paid plan now), real players and owner or test accounts
// (excluded_accounts) apart. A free month is a promo_claims row, "free:<the account's one-way Google code>" ("free:user:<id>"
// without a Google ID) with created = its start (freeHeroMonth), so which account has it is found by coding the ones that
// could matter (those with a subscription, and the owner ones) the same way (claimHash; read only, and no salt yet means
// no coded claim yet). planFor gives a free month only while the promo runs (until the launch) and the promo's
// brake hasn't tripped, so the same holds here. A claim that matches none of them is an ordinary player's; it also
// counts an account deleted during its month (the claim outlives "Delete my account").
async function freeHeroMonths(env, now, covered) {
  const at = launchNow(env, now).getTime(), week = launchWindow(env);
  if (!week || at >= week.end || await launchSpend(env, week) >= LAUNCH_WEEK_BRAKE_MICRO)
    return { players: 0, owner: 0 };
  const all = async (sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results;
  // A month runs to the launch, or BETA_HERO_DAYS from its start if that's sooner (freeMonthEnd).
  const claims = (await all("SELECT claim, created FROM promo_claims WHERE claim LIKE 'free:%' AND created <= ? AND created > ?",
    iso(at), iso(at - BETA_HERO_DAYS * DAY_MS)))
    .filter(r => freeMonthEnd(env, Date.parse(r.created)) > at).map(r => r.claim);
  if (!claims.length) return { players: 0, owner: 0 };
  const [owners, users, salt] = await Promise.all([
    all("SELECT user_id FROM excluded_accounts WHERE reason != 'counted'"),
    all("SELECT id, google_sub FROM users WHERE id IN (SELECT user_id FROM excluded_accounts WHERE reason != 'counted') " +
        "OR id IN (SELECT user_id FROM entitlements WHERE subscription_id IS NOT NULL)"),
    env.DB.prepare("SELECT salt FROM billing_salt WHERE id = 1").first(),
  ]);
  const ownerIds = new Set(owners.map(o => o.user_id)), who = new Map();   // claim -> "covered", "owner" or ""
  for (const u of users) {
    const code = !u.google_sub ? `user:${u.id}` : salt ? await claimHash(salt.salt, u.google_sub) : null;
    if (code) who.set(`free:${code}`, covered.has(u.id) ? "covered" : ownerIds.has(u.id) ? "owner" : "");
  }
  const out = { players: 0, owner: 0 };
  for (const claim of claims) {
    const kind = who.get(claim);
    if (kind !== "covered") out[kind === "owner" ? "owner" : "players"]++;
  }
  return out;
}

// Subscriptions for /admin and the daily stats post (LOR-524), one way everywhere: every plan that's on now (paidNow)
// is one of
//   paying    a paid plan, active or past due: monthlyUsd (MRR: their plans' list prices, before Stripe's fees; a beta
//             half price still renews at the full price) and netUsd (after the fees) count the active ones; a paying
//             plan moved to the launch (payDay) is a Stripe trial until then, and counted here
//   trialing  the beta's Keep Hero trial, nothing charged yet
//   cancelling  cancelled by the player (cancel_at_period_end): on the plan until its period ends, never charged
//             again, so neither paying nor MRR (Stripe's MRR leaves them out too; audit 10/23)
//   comped    free on purpose (plan_log comp: COMP_COUPONS), never revenue
//   owner     the admin's or a test account's (lib/activity.js excluded_accounts), never revenue
// each {hero, champion, legend}, with `unchecked`: paying plans whose coupons plan_log hasn't read yet (checkPlanLog).
// renewing {count, usd}: the plans that will be charged at their next renewal, paying and trialing together, usd their
// full monthly price (the beta's anchored plans and trials all first charge at the launch).
// days: the last `days` UTC days, oldest first: {day, started, cancelled, claims: {free, hero, half}, packs}, where
// started and cancelled are plans (comped and owner ones left out) by when they started and when the player cancelled,
// claims the beta promo's offers taken (promo_claims: free, the card-less free Hero month; hero, a Keep Hero trial;
// half, a 50% first month) and packs finest-voice packs sold (not refunded, owner accounts left out).
// claims and packs: the same since the start, packs with usd at VOICE_PACK's price.
// onPlan (Mike, 2026-10-17: count everyone above Adventurer, not only the paying): every account on a plan now, each
// counted once, whatever got it there: {total, paid (= paying), trial (Keep Hero), cancelling, freeMonth (the beta's free Hero
// month, running now), comped (comped and owner plans, and an owner account's free Hero month), byPlan: {hero,
// champion, legend}, freeUnread}. The free Hero month isn't a subscription but a promo_claims row, which
// freeHeroMonths reads; one whose account is on a plan some other way (its Keep Hero trial, say) is left out.
// freeUnread: that read failed, so freeMonth is 0 for now.
export async function subscriptionReport(env, now = new Date(), days = 30) {
  await setupBilling(env);
  const owner = column => `${column} IN (SELECT user_id FROM excluded_accounts WHERE reason != 'counted')`;
  const from = new Date(now.getTime() - (days - 1) * 864e5).toISOString().slice(0, 10);
  const all = async (sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results;
  const counted = `COALESCE(comp, '') = '' AND NOT ${owner("COALESCE(user_id, '')")}`;
  const [plans, started, cancelled, claims, packs] = await Promise.all([
    all("SELECT e.user_id, e.plan, e.status, e.current_period_end, e.gap_from, e.cancel_at_period_end, p.comp, " +
        "p.subscription_id IS NOT NULL AND p.comp IS NOT NULL AS checked, " +
        `${owner("e.user_id")} AS owner FROM entitlements e LEFT JOIN plan_log p ON p.subscription_id = e.subscription_id ` +
        "WHERE e.subscription_id IS NOT NULL"),
    all(`SELECT substr(started, 1, 10) AS day, COUNT(*) AS n FROM plan_log WHERE started >= ? AND ${counted} GROUP BY day`, from),
    all(`SELECT substr(canceled, 1, 10) AS day, COUNT(*) AS n FROM plan_log WHERE canceled >= ? AND ${counted} GROUP BY day`, from),
    all("SELECT substr(claim, 1, instr(claim, ':') - 1) AS kind, substr(created, 1, 10) AS day, COUNT(*) AS n " +
        "FROM promo_claims GROUP BY kind, day"),
    all("SELECT substr(created, 1, 10) AS day, status, COUNT(*) AS n FROM answer_packs " +
        `WHERE kind = 'voice' AND NOT ${owner("user_id")} GROUP BY day, status`),
  ]);
  const byPlan = () => Object.fromEntries(PAID.map(id => [id, 0]));
  const out = { paying: 0, byPlan: byPlan(), trialing: byPlan(), cancelling: byPlan(), comped: byPlan(), owner: byPlan(),
                pastDue: 0, unchecked: 0, monthlyUsd: 0, netUsd: 0, renewing: { count: 0, usd: 0 } };
  let cents = 0, net = 0, renewCents = 0;
  const covered = new Set();   // the accounts on a paid plan now, of any kind
  for (const r of plans) {
    if (!paidNow(r, now)) continue;
    covered.add(r.user_id);
    // A paying plan moved to the launch (payDay) is a Stripe trial until then, and still a paying one.
    const kind = r.comp ? "comped" : r.owner ? "owner" : r.cancel_at_period_end ? "cancelling"
      : r.status === "trialing" && r.gap_from !== "active" ? "trialing" : "byPlan";
    out[kind][r.plan]++;
    if (kind === "byPlan" || kind === "trialing") { out.renewing.count++; renewCents += PLANS[r.plan].monthly; }
    if (kind !== "byPlan") continue;
    out.paying++;
    if (!r.checked) out.unchecked++;
    if (r.status === "past_due") out.pastDue++;
    else { cents += PLANS[r.plan].monthly; net += PLANS[r.plan].net; }
  }
  out.monthlyUsd = cents / 100;
  out.netUsd = net / 100;
  out.renewing.usd = renewCents / 100;
  const free = await freeHeroMonths(env, now, covered).catch(e => {
    console.warn(`billing: free Hero months: ${e?.message || e}`);
    return null;
  });
  const sum = counts => Object.values(counts).reduce((a, n) => a + n, 0);
  const onPlan = Object.fromEntries(PAID.map(id =>
    [id, out.byPlan[id] + out.trialing[id] + out.cancelling[id] + out.comped[id] + out.owner[id]]));
  onPlan.hero += (free?.players || 0) + (free?.owner || 0);
  out.onPlan = { total: sum(onPlan), paid: out.paying, trial: sum(out.trialing), cancelling: sum(out.cancelling),
                 freeMonth: free?.players || 0,
                 comped: sum(out.comped) + sum(out.owner) + (free?.owner || 0), byPlan: onPlan, freeUnread: !free };
  const on = (rows, day) => rows.filter(r => r.day === day).reduce((a, r) => a + r.n, 0);
  const kinds = day => Object.fromEntries(["free", "hero", "half"].map(k =>
    [k, claims.filter(c => c.kind === k && (!day || c.day === day)).reduce((a, c) => a + c.n, 0)]));
  const sold = packs.filter(p => p.status === "active");
  out.days = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(now.getTime() - i * 864e5).toISOString().slice(0, 10);
    out.days.push({ day, started: on(started, day), cancelled: on(cancelled, day), claims: kinds(day), packs: on(sold, day) });
  }
  out.claims = kinds(null);
  const n = sold.reduce((a, p) => a + p.n, 0);
  out.packs = { sold: n, refunded: packs.filter(p => p.status !== "active").reduce((a, p) => a + p.n, 0),
                usd: n * VOICE_PACK.price / 100 };
  return out;
}

// For the Plans tile: accounts by plan and status, paying players, everyone on a plan (onPlan), what the paying ones
// bring in a month (subscriptionReport's paying and monthlyUsd: comped and owner plans left out) and what paying
// players' live answers cost this month; and
// finest-voice packs: sold this month, replies bought and still unused, and what their replies cost this month.
// subscriptions: subscriptionReport's whole report, for Willo's panel (lib/willo-stats.js).
export async function billingReport(env, now = new Date()) {
  await setupBilling(env);
  try { await checkPlanLog(env); } catch (e) { console.warn(`billing: plan_log: ${e?.message || e}`); }
  const [{ results }, spend, packs, subscriptions, sources] = await Promise.all([
    env.DB.prepare("SELECT plan, status, interval, current_period_end FROM entitlements WHERE subscription_id IS NOT NULL").all(),
    env.DB.prepare("SELECT COALESCE(SUM(micro > topup_micro), 0) AS players, COALESCE(SUM(micro - topup_micro), 0) AS micro, " +
                   "COALESCE(SUM(calls), 0) AS calls, COALESCE(SUM(topup_micro), 0) AS topup_micro " +
                   "FROM answer_user_spend WHERE month = ?").bind(month(now)).first(),
    env.DB.prepare("SELECT COALESCE(SUM(substr(created, 1, 7) = ?), 0) AS sold, " +
                   "COALESCE(SUM(CASE WHEN status = 'active' THEN remaining ELSE 0 END), 0) AS unused FROM answer_packs " +
                   "WHERE kind = 'voice'").bind(month(now)).first(),
    subscriptionReport(env, now),
    // Where each plan's checkout started (plan_log source), comped plans left out: which moments sell plans.
    env.DB.prepare("SELECT COALESCE(source, '') AS source, plan, COUNT(*) AS n FROM plan_log " +
                   "WHERE plan IS NOT NULL AND (comp IS NULL OR comp = '') GROUP BY source, plan ORDER BY n DESC").all()
      .then(r => r.results),
  ]);
  const counts = {};
  for (const r of results) {
    const k = `${r.plan}:${r.status}`;
    counts[k] = { plan: r.plan, status: r.status, n: (counts[k]?.n || 0) + 1 };
  }
  const apart = kind => Object.values(subscriptions[kind]).reduce((a, n) => a + n, 0);
  return { on: billingOn(env), paying: subscriptions.paying, comped: apart("comped"), owner: apart("owner"),
           trialing: apart("trialing"), cancelling: apart("cancelling"), onPlan: subscriptions.onPlan, counts: Object.values(counts), monthlyUsd: subscriptions.monthlyUsd,
           spend: { usd: (spend?.micro || 0) / 1e6, players: spend?.players || 0, calls: spend?.calls || 0 },
           voicePacks: { sold: packs?.sold || 0, unused: packs?.unused || 0, usd: (spend?.topup_micro || 0) / 1e6 },
           subscriptions, sources };
}
