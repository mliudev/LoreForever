// Account-linked companion answers. The site owns the key and pays for a small daily allowance; a player's plan
// (lib/billing.js) gives more. Answers can't be bought: once a plan's are gone (and a free player's starter), Willo
// answers from the add-on's lore library until they come back.
import { setup, fail, noStore } from "../../../lib/accounts.js";
import { currentDevice } from "../../../lib/devices.js";
import { perDay, perPeriod, unDay, unPeriod } from "../../../lib/ratelimit.js";
import { markAsked } from "../../../lib/activity.js";
import { allowance, reserveAnswer, answerReservation, seesPicture, writeAnswer, restLine, sayOf, SAY_MAX_CHARS, lookUp, uncapped,
  personaOf, styleOf, COMPACTIONS_PER_DAY, ANSWER_PROMPT_BYTES, ANSWER_IMAGE_CHARS, LORE_FOCUS, TRAIL_COLD, CUSTOM_PROMPT_BYTES,
  VERIFICATION_FAILED } from "../../../lib/companion-answers.js";
import { promptParts, knowledgeFor, asksTheWay, wayQuestion, withQuestion, factSources, offerTaken, meant, otherVersions }
  from "../../../lib/forever-knowledge.js";
import { feedbackKind, logFeedback, IMPLICIT_KINDS } from "../../../lib/answer-feedback.js";
import { logAnswer, tagAnswer } from "../../../lib/answer-log.js";
import { planLabel, recordLimit } from "../../../lib/plan-usage.js";
import { lastOf, signalsFor, queueWorthy, newAnswerId, signalWords, topicOf } from "../../../lib/answer-signals.js";
import { cachedFinding, keepFinding, findingBlock, wantsSearch, realWorld, searchesBefore, pressedToLook, FOUND_NOTHING,
  askedAgain } from "../../../lib/research-cache.js";
import { helpBlock, helpTopics, helpQuestion, stateOf, asksWhatKept, asksWhereNotes } from "../../../lib/willo-help.js";
import { keptSummary } from "../../../lib/keeps-notebook.js";
import { lookupsFor, actionsFor, actionOf, keepsOffer, offerInstead, offerLine, freeKey, SAYS_DONE } from "../../../lib/willo-tools.js";
import { picksFor, pickNamed } from "../../../lib/companion-voice.js";
import { planFor, plansOn, holdUserSpend, releaseUserSpend, addUserSpend, useStarter, useShare, returnStarter, offersFor,
  poolWindow, capState, companionFeatures, PLANS } from "../../../lib/billing.js";
import { promptBlocks, NPC_KEY } from "../../../lib/willo-custom.js";
import { takeTaste, returnTaste, takeTasteLookup, holdDay, settleDay } from "../../../lib/best-first.js";
import { pageOf, notebookIntent, readNotebook, notebookView, notebookTools, notebookCall, plannedChange,
  confirmed, alreadyLine, unclaimed, saidYes, withRest, titleOf, knownPlaces, plannedReminder, reminderLine, isNotebookTool,
  NOT_FOUND_LINE, FULL_LINE, UNSAVED_LINE, REMIND_RULES, REMIND_PLAN_RULE, REMIND_PLAN_SPOKEN, REMINDERS_FULL_LINE,
  unknownPlace, unknownPlaceLine, planReminderLine, asksReminders, remindersAnswer, noMoment, lateReminder, timedReminder, emptyListAnswer }
  from "../../../lib/willo-notebook.js";
import { pinIntent, spotOf, pinTool, pinCall, pinUpdate, pinRules, pinnedLine, unpinned, pinsAnswer, pinsSaid,
  clearAsk, clearTurn, clearReply, NO_SPOT_LINE, NO_PIN_LINE, pinPlaces, spotWithout, phoneNoSpotLine }
  from "../../../lib/willo-pins.js";
import { savedJourney } from "../../../lib/saved-journey.js";
import { asks as asksJourney, hasJourney, recall, withRecall } from "../../../lib/willo-recall.js";
import { stockOf, GOALS_ON_HERO, goalIntent, writesGoals, goalsOf, askedGoal, goalsBlock, asOfSave, goalTools, goalCall, isGoalTool,
  goalConfirmed, withoutClaims, withoutGoalClaims, goalsNamed, whichLine, goalsList, GOAL_LIST, QUIET_LINES, numbersIn,
  wrongGold, planLine } from "../../../lib/willo-goals.js";
import { guardAnswer, groundedWritten, evidenceOf, SOUNDS } from "../../../lib/willo-guards.js";
import { activateReferral, machineOf } from "../../../lib/referrals.js";
import { sendIntent, sendOffer, sendsFrom } from "../../../lib/friend-send.js";
import { withFriendsNote } from "../../../lib/friends-note.js";

// A typed question about Willo herself that the companion asked to have researched is answered from her help, which
// it keeps only with a source (companion/lore_companion/sponsored.py): her own page (LOR-623: "can you see my gear or
// stats?" got "I'm not sure of that one yet").
const HELP_SOURCE = { title: "Lore Forever: Willo", url: "https://loreforeverwow.com/willo" };
// A player's note on how a name sounds (willo-guards.js SOUNDS): thanks, and the name spelled as ever (LOR-653).
const SOUND_NOTE = "PRONUNCIATION: the player is telling you how a name sounds, not correcting a fact. Thank them in a few words; keep writing every name exactly as PLAYER CONTEXT and SOURCES spell it, never as they spelled the sound, and never promise to say or remember it differently.";

// Where they are, unknown (the live blind check, 10/19: 56% of the answers asked out loud came with no zone, and on
// "where's the flight master?", "who's this in front of me?" or "is my gear good?" she named a town, a creature or
// their gear and guessed wrong). Only for a question that depends on it, with no zone, target or picture, and
// none of the site's own look-ups (a place, quest or item it found) answering it ("I'm in their nazis, where's a
// griffin?" names its place).
const NO_PLACE = "WHERE THEY ARE: no game info and no picture came with this question, so you don't know where " +
  "they are, who or what is in front of them, or what they carry. Never name a place, a creature or their gear as " +
  "theirs: ask in one short line (which zone or town, who it is), and give what holds wherever they are.";
const NEEDS_PLACE = new Set(["route", "place", "here", "next", "quest"]);
const OWN_STATE = /\b(?:my (?:current |own )?(?:gear|items?|armou?r|weapons?|bags?|quests?|quest log|spells?|talents?)|items of mine|in front of me|near(?:by| me)|closest|nearest|around here|this (?:monster|mob|creature|guy|one|npc|place|town|city))\b/i;
// What Live game info doesn't show (its offer leaves these out).
const NOT_LIVE = /\b(?:gear|items?|armou?r|weapons?|bags?|spells?|talents?)\b/i;
export const needsPlace = (question, parts, image, facts = []) => !parts?.zone && !parts?.target && !image &&
  !facts.some(f => f.asked && !f.id) &&
  (NEEDS_PLACE.has(topicOf(question)) || OWN_STATE.test(String(question || "")));

const CLIENT = /^companion\/[\w.-]{1,24}$/;
// What the facts don't hold, so a question about it is still researched when the companion asks. "Auction" is a
// price, but the auction house or its auctioneers are a place the town facts hold ("where's the auction house in
// Ironforge?", LOR-614).
const NOT_IN_FACTS = /\b(?:rewards?|xp|experience|prices?|costs?|worth|auction(?!(?: ?house|eers?)\b)|how much)\b/i;
const MAX_BODY_BYTES = 64 * 1024; // JSON escaping can expand a valid 16 KB Unicode prompt.
// A spoken question may also carry a picture (base64, a byte per character); the rest of the body keeps MAX_BODY_BYTES.
const MAX_PICTURE_BODY_BYTES = MAX_BODY_BYTES + ANSWER_IMAGE_CHARS;
// offers: the plan the player could move up to for more answers (lib/billing.js offersFor), only when there's one.
const tooMany = (error, retryAfter, allowance, offers = []) => Response.json({ ok: false, error, retryAfter, allowance,
  ...(offers.length ? { offers } : {}) }, { status: 429, headers: { ...noStore, "Retry-After": String(retryAfter) } });
const untilReset = (left, now) => Math.ceil((Date.parse(left.resetsAt) - now.getTime()) / 1000);
const untilTomorrow = now => Math.ceil((Date.parse(now.toISOString().slice(0, 10) + "T00:00:00Z") + 86400e3 - now.getTime()) / 1000);
const dateOf = iso => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
// A failed answer, always as JSON (LOR-580): `reason` (what failed, "Gemini HTTP 503", a D1 error) goes in the
// companion's log, which asks once more; the player only ever sees Willo's own line for it.
// answerId: the failed answer's id (lib/answer-signals.js), so the app's next question can say it failed.
const failed = (e, answerId = null) => Response.json({ ok: false, error: "Couldn't get a live answer just now. Try again in a moment.",
  reason: String(e?.message || e).slice(0, 160), ...(answerId ? { answer_id: answerId } : {}) }, { status: 502, headers: noStore });

// The plan's answers are gone, today's or the month's (the allowance's period), and a free player's starter too: the
// 429, with the plan above theirs for the companion's own buttons (Free's is Hero; Legend's is nothing). Its words
// become the start of the add-on's lore-library answer (companion/lore_companion/answer.py offline_answer, which goes
// on "Until then, here's what the lore library says."), so they're Willo's, in the world, and only say when live
// answers come back, never what to buy (Mike, 2026-10-13). capped: the plan's month of answers and hosted voice cost
// its whole net (lib/billing.js capState "capped"): the month's words, and nothing offered. While plans are off it
// says what it said before plans. Which limit it was goes in lib/plan-usage.js's limit_hits (one write, on this
// turned-away path only).
async function outOfAnswers(env, userId, plan, now, exempt, capped = false) {
  const left = await allowance(env, userId, now, exempt, plan);
  if (plansOn(env)) await recordLimit(env, userId, plan,
    capped ? "cost_cap" : left.period === "month" ? "month" : plan.brake ? "brake" : "day", now);
  const offers = capped ? [] : offersFor(env, plan);
  const words = !plansOn(env) ? `You've used today's ${plan.answersPerDay} free answers. They come back tomorrow.`
    : capped || left.period === "month"
      ? `My light's spent for this month. The Moonwell refills it on ${dateOf(left.resetsAt)}.`
    : "My light's spent for today. The Moonwell refills it tomorrow.";
  return tooMany(words, untilReset(left, now), left, offers);
}

// An answer that holds part of its player's cost cap (answerQuestion) settles the hold with what it cost once it's
// written; whatever is still held when the request ends any other way, early or by an error, goes back. The work
// carries on for a while (waitUntil) if the player disconnects first, so it's still settled; a hold cut off even so
// stops counting after lib/billing.js HOLD_SECONDS. Anything that throws on the way (a D1 hiccup before the answer is
// written) is a JSON 502 too, never Cloudflare's error page: on 10/14 one came back as a page the companion couldn't
// read, and Willo said her thoughts got tangled (LOR-580).
export async function onRequest(context) {
  // say: her spoken words, when a two-layer answer has them before the rest (answerQuestion's onSay).
  let heard;
  const said = new Promise(resolve => { heard = resolve; });
  const hold = { release: async () => {}, say: words => heard({ words }) };
  const work = answerQuestion(context, hold)
    .catch(async e => {
      console.warn(`companion answer: ${e?.message || e}`);
      // What it took from the plan goes back (answerQuestion's giveBack): it never became an answer.
      await hold.giveBack?.().catch(g => console.warn(`companion answer: give back: ${g?.message || g}`));
      return failed(e);
    })
    .finally(() => hold.release().catch(e => console.warn(`companion answer: hold: ${e?.message || e}`)));
  context.waitUntil?.(work.catch(() => {}));
  // Her spoken words before the rest (LOR-673): a 200 of NDJSON, {"say": ...} on its first line, then the answer's own
  // JSON as it would have been (with its status, when it isn't a 200) on the second. Anything else, or the answer first:
  // the answer's own response, as before.
  const first = await Promise.race([work.then(res => ({ res })), said]);
  if (first.res) return first.res;
  const { readable, writable } = new TransformStream();
  const out = writable.getWriter(), line = value => out.write(new TextEncoder().encode(`${JSON.stringify(value)}\n`));
  line({ say: first.words });
  const rest = work.then(async res => {
    const body = await res.json().catch(() => ({ ok: false, error: "Couldn't get a live answer just now. Try again in a moment." }));
    await line(res.status === 200 ? body : { ...body, status: res.status });
  }).finally(() => out.close());
  context.waitUntil?.(rest.catch(() => {}));
  return new Response(readable, { headers: { ...noStore, "Content-Type": "application/x-ndjson" } });
}

async function answerQuestion(context, hold) {
  const { request, env } = context;
  const started = Date.now();
  if (!env.DB) return fail(503, "Accounts aren't set up yet.");
  await setup(env);
  if (!CLIENT.test(request.headers.get("X-LF-Client") || "") || request.headers.get("Origin"))
    return fail(403, "This is for the Lore Forever companion app.");
  if (!env.GEMINI_API_KEY) return fail(503, "Free live answers aren't available just now.");
  if (request.method !== "GET" && request.method !== "POST") return fail(405, "Use GET or POST.");
  const app = await currentDevice(env, request);
  if (!app) return fail(401, "Connect the companion to your account for free live answers.");
  if (request.method === "GET") return Response.json({ ok: true, allowance: await allowance(env, app.user.id) }, { headers: noStore });
  const tooBig = () => fail(413, "That question has too much context. Try again after updating the companion.");
  if (Number(request.headers.get("Content-Length") || 0) > MAX_PICTURE_BODY_BYTES) return tooBig();
  let input;
  try { input = await request.text(); } catch { return fail(400, "Couldn't read that question."); }
  const bytes = new TextEncoder().encode(input).length;
  if (bytes > MAX_PICTURE_BODY_BYTES) return tooBig();
  let prompt, operation, researchRequired, persona, style, image, autoResearch, npc, dataVersion, keep, names, current,
    offset, stock, layers, last;
  try {
    const body = JSON.parse(input);
    prompt = body.prompt;
    researchRequired = body.research_required === undefined ? false : body.research_required;
    // Optional (LOR-446): research "auto" lets the site decide whether to look online (anything else is ignored).
    autoResearch = body.research === "auto";
    operation = body.operation ?? "answer";
    // Optional (LOR-438): persona "willo" and style "spoken". Unknown values are ignored, so old companions get Sam.
    persona = personaOf(body.persona);
    style = styleOf(body.style);
    // Optional: a picture of the game window with a spoken question. writeAnswer uses it only when it's a valid JPEG
    // with a spoken, unresearched answer; otherwise the question is answered as text. Never logged or stored.
    image = body.image;
    // Optional (LOR-447): the lore key of the character a "character" answer speaks for, for the player's own tale of
    // them. Anything else is ignored.
    npc = typeof body.npc === "string" && NPC_KEY.test(body.npc) ? body.npc : null;
    // Optional (LOR-471): the player's installed add-on data version (ns.DB.version), so an older one's SOURCES give
    // way to newer Forever facts (lib/forever-knowledge.js olderData).
    dataVersion = typeof body.data_version === "string" ? body.data_version.slice(0, 40) : "";
    // Optional (2026-10-16): keep true while "Help improve Willo's answers" is on in the companion, so this answer is
    // kept KEEP_DAYS for the nightly check (lib/answer-log.js); anything else (an older companion too) keeps nothing.
    // names: the account's character names, only to take them out of what's kept, never kept themselves.
    keep = body.keep === true;
    names = keep && Array.isArray(body.names) ? body.names.slice(0, 60) : [];
    // Optional (Willo's notebook, lib/willo-notebook.js): {character: the add-on's key for who's asking}, for that
    // character's page beside the account's. Without it (an older companion, the iPhone), the account's page only.
    current = pageOf(body.notebook?.character);
    // and offset: the player's clock, minutes from UTC, for a reminder at a time of day (LOR-663).
    offset = Number.isInteger(body.notebook?.offset) && Math.abs(body.notebook.offset) <= 14 * 60 ? body.notebook.offset : null;
    // Optional (Willo's goals, lib/willo-goals.js stockOf, LOR-665): what the add-on last saved of that character (gold,
    // level, skills, reputation, riding, their evenings), for how their goals stand. Without it she says she can't see
    // it yet.
    stock = stockOf(body.stock);
    // Optional (LOR-673, speak short, show full): layers 2 from an app that takes a spoken answer in two layers, her
    // spoken words (say, at most SAY_MAX_CHARS letters) and the written answer, as NDJSON when her words come first
    // (onRequest). Without it (an older app, the iPhone), one answer as before.
    layers = body.layers === 2;
    // Optional (the feedback loop, 10/18): what the app knows of the answer before this question (lib/answer-signals.js
    // lastOf: its answer_id, how long ago, whether she was cut off or her voice never played, whether it failed), for
    // the signals it gives that answer. Read only while keep is on.
    last = keep ? lastOf(body.last) : null;
  } catch { return fail(400, "Couldn't read that question."); }
  if (bytes - (typeof image === "string" ? image.length : 0) > MAX_BODY_BYTES) return tooBig();
  // "character" (LOR-394) is an ordinary answer in the targeted character's voice: same daily answers and budget.
  if (!["answer", "compact", "character"].includes(operation)) return fail(400, "Unknown chat operation.");
  if (typeof prompt !== "string" || !prompt.trim() || new TextEncoder().encode(prompt).length > ANSWER_PROMPT_BYTES)
    return fail(400, "That question has too much context. Try a shorter question.");
  if (typeof researchRequired !== "boolean") return fail(400, "Research preference must be true or false.");
  // Willo's own state, sent with her answers (LOR-546): lifted out of the prompt, for her help to use when the
  // question is about her (below), never otherwise.
  let state;
  ({ state, prompt } = stateOf(prompt));
  // An older Willo's note about the player's friends, with the newer one in its place (lib/friends-note.js: they/them
  // always, old sightings as last seen, never speaking for them).
  prompt = withFriendsNote(prompt);
  const now = new Date();
  const compact = operation === "compact";
  // What WoW Forever changed, for this question and place (LOR-446), looked up while the allowance is checked.
  const parts = compact ? null : promptParts(prompt);
  // "Willo, send this to Mike" (lib/friend-send.js, LOR-674): answered here in fixed words, with the send offered as an
  // action, never by the answer model and without using one of their answers. Only a Willo that runs the action.
  const sending = operation === "answer" && persona === "willo" && sendsFrom(request.headers.get("X-LF-Client"))
    ? sendIntent(parts.question) : null;
  if (sending) {
    const asked = markAsked(env, app.user.id, now.getTime());
    if (context.waitUntil) context.waitUntil(asked); else await asked;
    const [offer, left] = await Promise.all([sendOffer(env, app.user.id, sending, parts, prompt, now.getTime()),
      allowance(env, app.user.id, now)]);
    return Response.json({ ok: true, answer: offer.answer, model: "willo-friends", allowance: left,
      timing: { model_ms: 0, total_ms: Date.now() - started }, lookups: ["friends"], looked_up: "no",
      ...(offer.action ? { action: offer.action } : {}) }, { headers: noStore });
  }
  // A question about their own past asked without a journey of the app's own (Willo for iPhone, LOR-672): searched here
  // over the journey Willo on the PC synced (lib/willo-recall.js), read now, alongside the rest, so it costs no wait.
  const recalling = operation === "answer" && !hasJourney(prompt) && asksJourney(parts.question)
    ? savedJourney(env, app.user.id, current) : null;
  // Asked to write in their notebook (lib/willo-notebook.js notebookIntent: "remember…", "add … to my list", "tick off
  // …"): her answer is offered its tools, and it's a note, not a question to look up or a picture to look at. Asked
  // about it, she reads it. Only her own answers: a character never reads the player's notebook.
  const intent = operation === "answer" ? notebookIntent(parts.question, parts.previous) : { write: false, read: false };
  // Pinned spots (lib/willo-pins.js, LOR-664: "pin this spot", "what pins do I have?", "rename the cave pin") live in the
  // notebook, so asked about one she reads it, and asked to pin or change one she's offered its tools. Where they stand
  // comes only from Willo's app ("spot now:" in PLAYER CONTEXT); without it nothing can be pinned.
  const pinning = operation === "answer" ? pinIntent(parts.question) : { add: false, manage: false, read: false };
  // ...or by a place's name ("pin Fargodeep Mine as the kobold den": one this age has, never a model's), or where their
  // last save left them ("pin where I last was": the journey Willo's app synced) (LOR-672). Willo for iPhone never knows
  // where they stand: asked to pin it, she says so and how to pin from the phone (pinSay).
  const phone = /^companion\/ios-/.test(request.headers.get("X-LF-Client") || "");
  let spot = pinning.add && !pinning.named && !pinning.last ? spotOf(prompt) : null, pinSay = null;
  if (pinning.add && (pinning.named || pinning.last)) {
    const [places, saved] = await Promise.all([pinning.named ? pinPlaces(env) : null,
      pinning.last ? savedJourney(env, app.user.id, current) : null]);
    const got = spotWithout(pinning, places, saved?.theirs ? saved.journey : null, now, offset);
    spot = got?.spot || null;
    pinSay = got?.say || null;
  } else if (pinning.add && !spot && phone) {
    const saved = await savedJourney(env, app.user.id, current);
    pinSay = phoneNoSpotLine(saved.theirs ? saved.journey : null);
  }
  // A yes or a no to her "Both of Húrin's pins? Say yes and I'll take them off.": the site's to answer.
  const clearing = operation === "answer" && Boolean(clearTurn(parts.question, parts.previous));
  if (pinning.read || clearing) intent.read = true;
  if (pinning.manage || (pinning.add && spot)) intent.write = true;
  // "What do you know about me?" (LOR-666): all of it, read with the rest as always, so she can say what she keeps (its
  // counts go in her help, below).
  if (operation === "answer" && !intent.read && asksWhatKept(parts.question)) intent.read = true;
  if (intent.write) [researchRequired, autoResearch, image] = [false, false, null];
  // Their notebook's two pages (this character's and the account's), read from now on alongside the rest: one indexed
  // read, which a failed one reads as empty, never failing the answer.
  const reading = operation === "answer" ? readNotebook(env, app.user.id, current).catch(e => {
    console.warn(`companion answer: notebook: ${e?.message || e}`);
    return { pages: [], reminders: [] };
  }) : null;
  // A reminder at a place is checked against the places of this age (LOR-663), read alongside too.
  const placing = intent.remind ? knownPlaces(env).catch(() => new Map()) : null;
  const knowledge = compact ? null : knowledgeFor(env, parts, { character: operation === "character", dataVersion });
  // Mike's own and test accounts skip the daily answer cap; the monthly budget below still applies to them. The plan
  // sets the daily answers; a paying player skips the shared monthly budget and has a cost cap instead. Both at once:
  // every round trip to D1 here is one a player far from it waits for before Willo can start (LOR-654).
  const [exempt, plan] = await Promise.all([uncapped(env, app.user.id), planFor(env, app.user.id, now)]);
  const subscriber = plan.id !== "free";
  // Willo's best first (below) and a paying player's customization (lib/willo-custom.js: Willo's style, or their tale
  // of the character; a failure to read it gives an ordinary answer) go out now too, while the answer is counted.
  // Whatever happens to them is seen where they're used; an answer that's out of answers gives the taste back.
  const tasting = compact ? null : takeTaste(env, app.user.id, plan, now, { spoken: Boolean(style) });
  tasting?.catch(() => {});
  const customizing = subscriber ? promptBlocks(env, app.user.id, plan, { operation, npc }).catch(e => {
    console.warn(`companion answer: customization: ${e?.message || e}`);
    return { system: "", tale: false };
  }) : null;
  // Willo's daily and weekly players (lib/activity.js markAsked, LOR-524): every question counts, answered or not.
  if (!compact) {
    const asked = markAsked(env, app.user.id, now.getTime());
    if (context.waitUntil) context.waitUntil(asked); else await asked;
  }
  // pack: the free plan's starter, when this answer comes out of it (the day's plan answers are gone).
  let pack = null;
  // took: what this answer counted on the plan, each marked as its count goes in: the day, and a paid plan's month
  // (pool). An answer that fails gives back what it took, with its starter (giveBack): it's for answers, not attempts.
  // Before, only the starter went back, so a failed answer cost the player one of the day's, and the companion's own
  // second ask (LOR-580) another (LOR-673); a count that went in before an error goes back too.
  let took = null;
  // Past the plan's text cap, her answer on Flash-Lite (lib/billing.js capState "lite").
  let lite = false;
  // Her answers on the smarter model: a plan that has it (lib/billing.js PLANS smarter: Legend), while plans are on.
  const smarter = plansOn(env) && Boolean(plan.smarter);
  const giveBack = async () => {
    const [plan, starter] = [took, pack];
    took = pack = null;
    await Promise.all([plan?.day && unDay(env, app.user.id, "companion-answer", now),
      plan?.month && unPeriod(env, app.user.id, "companion-month", plan.pool.key), starter && returnStarter(env, starter.id)]);
  };
  hold.giveBack = giveBack;
  if (compact) {
    // Compaction has its own abuse limit and uses the shared paid budget. It never spends a player's daily answer or
    // a starter answer.
    if (!(await perDay(env, app.user.id, "companion-compact", COMPACTIONS_PER_DAY, now))) {
      const left = await allowance(env, app.user.id, now, exempt, plan);
      return tooMany("Chat memory has done all it can for today. Your messages are saved; try again tomorrow.", untilTomorrow(now), left);
    }
  } else if (!exempt) {
    // The plan's answers first: today's, and a paid plan's month's (from its renewal day, lib/billing.js poolWindow).
    // Once they're gone, while plans are on, the free plan's starter; then the add-on's lore library (the 429).
    // A paying player whose answers this month cost half their plan's net (lib/billing.js capState "lite") gets them on
    // Flash-Lite, not looking online; once answers and hosted voice have cost the whole net ("capped"), none of the
    // plan's are left until the next month: the lore library answers.
    const pool = plansOn(env) && plan.answersPerMonth ? poolWindow(plan, now) : null;
    // The day's and the month's count go in while the text cap is checked, all at once (LOR-654). An answer that turns
    // out not to be the plan's gives back the counts that checking one at a time never made: a capped plan's day and
    // month, and the month of a day over its limit.
    // All three settle before anything goes on, so a failure in one (D1) still knows which counts went in, and the
    // first failure is thrown once they have (the outer catch gives those back).
    const counting = took = { pool, day: false, month: false };
    const checks = await Promise.allSettled([plansOn(env) && capState(env, app.user.id, plan, now),
      perDay(env, app.user.id, "companion-answer", plan.answersPerDay, now).then(ok => (counting.day = true, ok)),
      pool ? perPeriod(env, app.user.id, "companion-month", pool.key, plan.answersPerMonth)
        .then(ok => (counting.month = true, ok)) : true]);
    const broke = checks.find(c => c.status === "rejected");
    if (broke) throw broke.reason;
    const [cap, today, monthly] = checks.map(c => c.value);
    const capped = cap === "capped";
    lite = cap === "lite";
    const planned = !capped && today && monthly;
    if (!planned) {
      took = null;
      await Promise.all([capped && unDay(env, app.user.id, "companion-answer", now),
        pool && (capped || !today) && unPeriod(env, app.user.id, "companion-month", pool.key)]);
    }
    // A starter answer is taken in one statement, so a question asked at the same moment can't spend the same answer;
    // then answers friends gave by sharing Willo (lib/billing.js useShare, any plan; a paying player's only while their
    // month is under its text cap, and paid for like the plan's); one that finds the last one gone is out of answers.
    if (!planned && !(plansOn(env) && !subscriber && (pack = await useStarter(env, app.user.id)))
        && !(!capped && (pack = await useShare(env, app.user.id)))) {
      const taken = tasting && await tasting.catch(() => null);
      if (taken) await returnTaste(env, taken);
      return outOfAnswers(env, app.user.id, plan, now, exempt, capped);
    }
  }
  // A player saying the last answer was wrong, or losing patience: Willo is told not to argue, and it comes back to us
  // (lib/answer-feedback.js) with what was asked and answered. A character's reply is in character, so not counted.
  // How a name sounds is never a dispute (LOR-653: "It's actually pronounced Dun Moreau" looked online and argued it).
  const sounds = operation === "answer" && SOUNDS.test(parts.question);
  const dispute = operation === "answer" && !sounds ? feedbackKind(parts.question, parts.previous) : null;
  // This answer's id (the app keeps it on the turn: a report or the next question names it), and what this question
  // says about the answer before it (lib/answer-signals.js): word rules and the app's facts, no model call. While keep
  // is on they tag that answer's row in the answer log, and a strong one goes in the review queue; after the reply is
  // on its way, so never slower.
  const answerId = compact ? null : newAnswerId();
  const signals = !compact && keep ? signalsFor({ question: parts.question, previousQuestion: parts.previousQuestion,
    last, spoken: Boolean(style), dispute, sounds, answered: Boolean(parts.previous) }) : [];
  if (signals.length) {
    const noting = tagAnswer(env, app.user.id, { ref: last?.answer_id, tags: signals }, { now }).then(tagged =>
      tagged && queueWorthy(signals, dispute) && logFeedback(env, app.user.id, { kind: "signal", said: signalWords(signals),
        question: parts.previousQuestion, answer: parts.previous, zone: parts.zone, sub: parts.sub, persona,
        spoken: last?.spoken, answerRef: last?.answer_id, signals, source: last?.spoken ? "voice" : "typed" }, { names, now }));
    if (context.waitUntil) context.waitUntil(noting.catch(() => {})); else await noting.catch(() => {});
  }
  // Willo's best first (lib/best-first.js, LOR-602): the account's first live answers on the free plan or the beta's
  // free Hero month earn a reply in her finest voice when asked out loud (lib/companion-voice.js speakTaste), and on the
  // free plan look online and see the game as a paid plan's do. Taken while the Forever facts are looked up, after the
  // plan's own answer, and given back if this one fails; the day's cap reached, it's the plan's own answer, uncounted.
  const [known, taste] = await Promise.all([knowledge || { facts: [], block: "" }, tasting]);
  // The free plan, while plans are on (Mike, 2026-10-12): its answers stay with the world's lore (LORE_FOCUS below),
  // without looking online or the game picture, except its best first. Willo still speaks (style "spoken" stays).
  const freePath = plansOn(env) && !subscriber && !taste;
  const askedToLook = researchRequired === true || autoResearch;   // what the companion asked for, before the plan
  if (freePath) [researchRequired, autoResearch, image] = [false, false, null];
  const stronger = Boolean(PLANS[plan.id]?.stronger);
  // The site's look-ups for this question (lib/willo-tools.js lookupsFor, LOR-546). A question about Willo herself:
  // her own help, what her app says of itself right now and, about plans, the answers left, never a look online.
  const lookups = compact ? [] : lookupsFor(parts.question, { previous: parts.previousQuestion, answered: parts.previous, persona, operation,
    plans: plansOn(env) });
  const usage = lookups.includes("answers_left") ? await allowance(env, app.user.id, now, exempt, plan) : null;
  const helpAsked = compact ? "" : helpQuestion(parts.question, parts.previousQuestion, parts.previous);   // a follow-up reads with what it follows
  let help = lookups.includes("help") ? helpBlock(helpAsked, { plans: plansOn(env), plan: plan.name,
    client: request.headers.get("X-LF-Client"), state, usage, keeping: keep }) : "";
  // What she reads of their notebook (all of it when asked about it or to write in it, else the lines that share a word
  // with the question), and its tools when asked to write: in place of the app's actions, which a note never needs.
  // Reminders (LOR-663) on Hero and up, while the site sells plans (lib/billing.js companionFeatures).
  const book = await reading;
  // "What do you know about me?" (LOR-666): what she keeps in it, counted here (lib/keeps-notebook.js keptSummary).
  if (help && book && asksWhatKept(parts.question)) {
    help += `\n- What you keep in their notebook now, counted for you (this character's page and the one for all of ` +
      `their characters): ${keptSummary(book.pages, book.reminders) || "nothing yet"}.`;
  }
  // Their goals (lib/willo-goals.js, LOR-665; Hero and up while plans are sold): lines under Goals in the notebook.
  // A question that sets, changes or drops one, or turns her check-ins off, gets the goals' tools (and the notebook
  // numbered, to name them by), and isn't looked up or looked at, like a note. How they stand is worked out here, on
  // this read, from what the add-on last saved (stock): THEIR GOALS, when the question bears on them or one's reached.
  const goalsOn = operation === "answer" && (!plansOn(env) || subscriber);
  const haveGoals = goalsOn && Boolean(book?.pages?.some(p => /^#{1,6}\s+goals?\s*$/im.test(p.body || "")));
  const goalAsk = goalsOn ? goalIntent(parts.question, { have: haveGoals }) : null;
  const goalWrite = Boolean(goalAsk && writesGoals(goalAsk));
  if (goalWrite) [researchRequired, autoResearch, image] = [false, false, null];
  const view = book ? notebookView(book.pages, { current, question: parts.question, spoken: Boolean(style),
    previous: `${parts.previousQuestion} ${parts.previous}`, reminders: book.reminders, offset,
    level: Number(parts.level) || null, now, intent: goalWrite ? { ...intent, read: true } : intent }) : null;
  if (view) view.places = await placing;
  const reminding = intent.remind && (!plansOn(env) || companionFeatures(plan).reminders === true);
  // notebook_pin with the notebook's own tools, never beside its reminder or move tools (together they'd pass
  // lib/companion-answers.js ACTIONS_MAX_BYTES, and none would be offered). Asked to pin with no spot from the game,
  // nothing is written at all (not even a note without its place).
  // Asked to pin where they stand with the game's spot ("remember this spot", "mark this place"), only notebook_pin: the
  // notebook's own "remember" would take it as a plain note (the quality owner, 10/18: "Tucked into your notes:
  // Fargodeep Mine" 2 of 2).
  const pinOnly = pinning.add && spot && !intent.remind && !intent.move;
  const noteTools = !view || !intent.write || (pinning.add && !spot) ? [] : pinOnly ? pinTool(spot, pinning)
    : [...notebookTools(view, { move: intent.move, remind: reminding, adding: intent.adding }),
      ...(intent.remind || intent.move ? [] : pinTool(spot, pinning))];
  const goals = goalsOn && view ? goalsOf(view) : [];
  const asked = goalAsk && (goalAsk.set || goalAsk.change) ? askedGoal(parts.question) : null;
  // The live level and their people from the question's PLAYER CONTEXT, for a character the add-on hasn't saved yet.
  const here = { live: Number.parseInt(parts?.level, 10) || null, race: parts?.race || null };
  const goalInfo = goalsOn && view && (goals.length || asked) ? goalsBlock(goals, stock, { intent: goalAsk,
    question: parts.question, asked, ...here, now })
    : { block: "", reached: [], asked: null, numbers: new Set(), cheer: "" };
  const goalOffer = goalWrite && view ? goalTools(goalAsk, { goals, noteTools: notebookTools(view) })
    .filter(t => !noteTools.some(n => n.name === t.name)) : [];
  // The free plan while plans are sold: what it takes, from the facts, and (typed) one plain line that she keeps goals
  // from Hero up. Out loud she never names a plan.
  const goalsOnHero = operation === "answer" && !goalsOn && !style && goalIntent(parts.question).set;
  // "What are my goals?": the site says them, from this character's Goals and the account's (lib/willo-goals.js
  // goalsList), with no model call: one written from the chat gave Brynn the goal Húrin set (the blind check, case 11).
  const listing = goalsOn && view && !goalWrite && GOAL_LIST.test(parts.question)
    ? goalsList(goals, stock, { current, ...here, now }) : "";
  // Dropping one by what it's about ("forget the mount goal"): the site finds it (goalsNamed), as it finds the goal to
  // keep, by the words; two that fit get her question back.
  const dropping = goalAsk?.drop ? goalsNamed(parts.question, goals) : [];
  // What her answer may offer to do for them (lib/willo-tools.js actionsFor, LOR-546 slice 2), by what the question
  // asks of her: her voices only where the plan picks one (the Voices of Azeroth too for a companion that has them,
  // lib/companion-voice.js picksFor), never the one she speaks in now (WILLO STATE's "voice now"), a talk key only the
  // one her own check found free, and "Willo and the game" when her check says Live game info is off.
  // Consent (slice 3): Live game info or seeing the game, only when it's off in her window, and seeing the game only on
  // a plan with it (lib/billing.js companionFeatures).
  // Asked to write in their notebook, its tools instead (noteTools, above): a note never needs the app's.
  const actions = noteTools.length || goalOffer.length ? [...noteTools, ...goalOffer] : help ? actionsFor(helpTopics(helpAsked, { plans: plansOn(env), client: request.headers.get("X-LF-Client") }), {
    voices: plan.voice?.choice ? picksFor(request.headers.get("X-LF-Client")) : [],
    current: pickNamed(/^voice now: ([^(\n]+)/m.exec(state)?.[1]),
    key: freeKey(state), liveOff: /^live: (?:bad|warn)\b/m.test(state),
    fixable: /^\w+: (?:bad|warn), .*; fix: /m.test(state), spoken: Boolean(style), plans: plansOn(env),
    off: { live: /^live: off\b/m.test(state), sight: /\bseeing the game when asked out loud: off\b/.test(state) },
    sight: !plansOn(env) || companionFeatures(plan, { taste: taste && { on: true, left: 1 } }).sight,
    client: request.headers.get("X-LF-Client"), asked: helpAsked }) : [];
  // Live game info, offered once (the PM, 10/19, after the live check: most questions asked out loud came with no
  // zone): a question that needs where they are, with Live game info off in her window, gets its consent button
  // under her answer, the same explained yes as its first-use card, and the player turns it on there; never again
  // for this account, whatever they chose. Counted beside the model call, so no wait is added.
  // Not for their gear, bags or spells: Live game info doesn't show those (the vision check, 10/19).
  const liveOffer = operation === "answer" && !help && !actions.length && /^live: off\b/m.test(state) &&
    needsPlace(parts.question, parts, image, known.facts) && !NOT_LIVE.test(parts.question)
    ? perPeriod(env, app.user.id, "live-offer", "once", 1) : null;
  // The player's own world (their graphics card, the game's settings, addons, prices: lib/research-cache.js realWorld)
  // goes stale, so it looks online typed too, not only spoken (research "auto"), where the free plan would (LOR-545).
  // A short follow-up to one ("I'm in Seattle") is looked up with the question before it.
  const real = lookups.includes("web");
  const lookFor = !real ? "" : realWorld(parts.question) ? parts.question : `${parts.previousQuestion} (${parts.question})`;
  // "Can you search on the interwebs?", "are you sure?": what to look up is what they asked before (LOR-593: on 10/15
  // the site looked up "what is WoW Forever" instead of Shoni's Disarming Tool). Asked to look, or doubted, and nothing
  // found: FOUND_NOTHING, never a guess.
  // Her last answer rides along: it may spell what speech misheard ("Shoney's disarm" was Shoni's Disarming Tool).
  // A yes to her own offer ("Want me to tell you where to train?" "Yes.") looks up the offer (forever-knowledge.js meant).
  const taken = !compact && !real && Boolean(offerTaken(parts));
  const subject = taken ? meant(parts) : !compact && !real && parts.previousQuestion && searchesBefore(parts.question)
    ? { ...parts, question: `${parts.previousQuestion} (about: ${parts.previous.slice(0, 200)})`.slice(0, 600) } : parts;
  const pressed = operation === "answer" && !real && !help && (dispute === "correction" || pressedToLook(parts?.question));
  // A typed question the companion wants researched (research_required) that its facts answer (FOREVER FACTS,
  // travel and flights among them, QUEST AND NPC FACTS, ITEM FACTS: the same "asked" that skips a spoken question's
  // quick look-up) is answered from them instead, on the ordinary model. Required research throws away an answer
  // without web sources ("what are the stats on the Arcanite Reaper?" came back "I'm not sure" with the facts right
  // there), and given the facts it stops searching and gets thrown away too. On the gold set's 28 typed research
  // questions (the accuracy lab, 10/16), 19 are covered: accuracy 80% and 78% -> 91% and 88%, a wrong claim in 18% and
  // 26% -> 11% and 14%, p50 4.5-5.6 s -> 1.1-1.3 s, $23-25 -> $9.20 per 1,000. Not when the player asks for a look
  // themselves, nor for what the facts don't hold (a quest's rewards, prices), nor when no covering fact has a source
  // to show.
  const fromFacts = operation === "answer" && researchRequired && !real && !help && !pressedToLook(parts.question)
    && !NOT_IN_FACTS.test(parts.question) && factSources(known.facts.filter(f => f.asked)).length > 0;
  const lookOnline = !freePath;
  // A question about Willo herself never looks online, typed (research_required) or spoken: her help answers it.
  const wantsResearch = operation === "answer" && !help && (researchRequired || ((autoResearch || real) && lookOnline));
  let strong = stronger && !compact;
  const longMemory = Boolean(PLANS[plan.id]?.longMemory) && compact;
  // Looking it up (LOR-446). What another player's search found for the same question here answers without searching
  // again, for required research too. research "auto" (the companion asks for it with spoken questions) looks online
  // quickly only when the lore and Forever facts can't answer: a practical or current question or a correction that no
  // fact covers (lib/research-cache.js wantsSearch). One it wouldn't look up gets no earlier finding either, so where
  // am I or a lore question never shows web sources. Forever facts never cover the player's own world: "the best
  // graphics card for WoW?" shares "best" and "WoW" with facts about Dalaran.
  const searchable = wantsResearch && !fromFacts &&
    (researchRequired || real || wantsSearch(parts.question, dispute, known.facts));
  let finding = searchable ? await cachedFinding(env, subject, now) : null;
  const cached = Boolean(finding);
  let research = researchRequired && !help && !finding && !fromFacts;
  let quick = searchable && !researchRequired && !finding;
  // A plan's answer is paid for, so it skips the shared monthly budget, and its cost is counted as theirs. A starter
  // answer is free: it waits for the shared budget like the day's free answers.
  const paid = subscriber;
  // Past the plan's monthly cost cap, the answer goes back to the ordinary model and doesn't look online, until the
  // month ends. Nobody is cut off by it; a longer chat memory stays, since it's cheap. An answer that would look online
  // or use the stronger model first holds what reserveAnswer reserves for it against that cap, in one statement
  // (lib/billing.js holdUserSpend), so questions asked at the same moment can't all get in under the cap; settle swaps
  // the hold for what the answer cost.
  let held = null;   // {id, micro}
  const upgrade = () => paid && (research || quick || strong)
    ? answerReservation(research, operation, { lookup: quick, strong, longMemory }) : 0;
  const holdCap = async () => {
    const micro = upgrade();
    if (!micro) return;
    const id = await holdUserSpend(env, app.user.id, micro, now, { cap: plan.costCapMicro, launch: Boolean(plan.launch) });
    if (id) held = { id, micro };
    else research = quick = strong = false;
  };
  // Gives back what's held, all of it, or down to `keep` for an answer that needs less.
  const release = hold.release = async (keep = 0) => {
    if (!held || held.micro <= keep) return;
    const { id } = held;
    held = keep ? { id, micro: keep } : null;
    await releaseUserSpend(env, id, keep);
  };
  await holdCap();
  // The plan's web look-ups a month (lib/billing.js lookupsPerMonth, the month from its renewal day), a quiet guard
  // inside its cost caps that players never see as a number: past them, the month's answers don't look online, and
  // their hold shrinks to fit. A finding another player's search kept costs nothing, so it isn't counted, and still
  // answers. One that would have looked gets TRAIL_COLD: a warm in-world line when it truly needs fresh news.
  // The free plan never looks online, so its questions about the player's own world get the same plain line about the
  // very latest (LOR-545: without it Flash-Lite named last year's cards as today's and made up a town's weather).
  let trailCold = !lookOnline && operation === "answer" && !help && (real || /\b(?:weather|forecast)\b/i.test(parts.question));
  // The free plan's best first has its own few (lib/best-first.js TASTE_LOOKUPS).
  if ((research || quick) && plansOn(env) && !exempt && !(subscriber
      ? await perPeriod(env, app.user.id, "companion-lookup", poolWindow(plan, now).key, plan.lookupsPerMonth || 0)
      : await takeTasteLookup(env, taste))) {
    research = quick = false;
    trailCold = true;
    await release(upgrade());
  }
  // What a free best-first answer may cost is held on the taste's daily cap (lib/best-first.js): one that won't fit
  // answers without looking online, as past the look-ups.
  let tasteHold = null;
  const tasteFree = Boolean(taste) && !subscriber;
  if (tasteFree && (research || quick)) {
    tasteHold = await holdDay(env, answerReservation(research, operation,
      { lookup: quick, picture: seesPicture(operation, research, style, image), lite, smarter }), now);
    if (!tasteHold) [research, quick, trailCold] = [false, false, true];
  }
  // What a best-first answer cost, on the taste's day (a free one's whole cost; a free Hero month's is Hero's), and that
  // it was one; given back, with its place, when it failed.
  const tasted = (cost, ok) => taste && settleDay(env, tasteHold, tasteFree ? cost : 0,
    ok ? { answers: 1, ...(taste.used === 1 ? { starts: 1 } : {}) } : {}, now);
  // A paying player's customization (customizing, above). The free plan's answers get LORE_FOCUS instead, while plans
  // are on.
  let custom = { system: "", tale: false };
  if (subscriber) custom = await customizing;
  else if (freePath && operation === "answer") custom = { system: LORE_FOCUS, tale: false };
  const withBlock = (system, block) => {
    const added = [system, block].filter(Boolean).join("\n\n");
    return new TextEncoder().encode(added).length <= CUSTOM_PROMPT_BYTES ? added : system;
  };
  const coldTrail = system => withBlock(system, TRAIL_COLD);
  if (trailCold) custom = { ...custom, system: coldTrail(custom.system) };
  if (goalsOnHero) custom = { ...custom, system: withBlock(custom.system, GOALS_ON_HERO) };
  if (sounds) custom = { ...custom, system: withBlock(custom.system, SOUND_NOTE) };
  if (operation === "answer" && needsPlace(parts?.question, parts, image, known.facts)) custom = { ...custom, system: withBlock(custom.system, NO_PLACE) };
  // A reminder asked for (LOR-663): how she keeps one, or, on a plan without them, plain words about it.
  if (intent.remind && noteTools.length) custom = { ...custom, system: withBlock(custom.system,
    reminding ? REMIND_RULES : style ? REMIND_PLAN_SPOKEN : REMIND_PLAN_RULE) };
  // Pins (LOR-664): how she pins, renames and takes one out, and that the place and day are the game's.
  if (pinning.read && view) custom = { ...custom, system: withBlock(custom.system,
    pinRules(spot, { spoken: Boolean(style), adding: pinning.add })) };
  const reserved = await reserveAnswer(env, now, research, operation, quick,
    { paid, strong, longMemory, picture: seesPicture(operation, research, style, image), lite, smarter });
  if (!reserved) {
    // What it took (the plan's day and month, or a starter answer) goes back for a question that never reached the
    // model, and a best-first one.
    await giveBack();
    if (taste) await Promise.all([returnTaste(env, taste), tasted(0, false)]);
    return tooMany("We're at capacity for free live answers right now. Try again next month.",
      86400, await allowance(env, app.user.id, now, exempt, plan));
  }
  // Kept while the answer is written, and never waited for where the reply can go on without it (waitUntil: the queue's
  // write reads the account's names first, 10/18); logFeedback never throws. "No, I meant…" and "never mind" aren't
  // said to report anything: kept only while "Help improve Willo's answers" is on (keep), like the signals.
  const logged = dispute && (keep || !IMPLICIT_KINDS.includes(dispute)) && logFeedback(env, app.user.id, { kind: dispute, said: parts.question,
    question: parts.previousQuestion, answer: parts.previous, zone: parts.zone, sub: parts.sub, persona,
    spoken: Boolean(style), answerRef: last?.answer_id, signals, source: style ? "voice" : "typed" }, { context, names,
    client: request.headers.get("X-LF-Client") });
  if (logged && context.waitUntil) context.waitUntil(logged);
  const loggedFirst = context.waitUntil ? null : logged;
  // A paid-for answer's cost goes on the player's month (lib/billing.js addUserSpend), once: what the quick look online
  // and the answer cost, as lib/companion-answers.js counts them, whether the answer came or not. It takes the place of
  // what the answer held against its cap. The beta's free Hero's is kept apart (launch).
  // The hold is the batch's to settle from here, so nothing gives it back meanwhile (hold.release); a batch that fails
  // gives it back itself, as release would have.
  let lookCost = 0, settled = !paid;
  const settle = async counted => {
    if (settled) return;
    settled = true;
    const holdId = held?.id;
    held = null;
    await addUserSpend(env, app.user.id, lookCost + (counted || 0), now, holdId, Boolean(plan.launch))
      .catch(async e => {
        if (holdId) await releaseUserSpend(env, holdId).catch(() => {});
        throw e;
      });
  };
  // What can wait until the answer is on its way (LOR-654): the budget's and the player's bookkeeping of what it cost,
  // a round trip to D1 each that a player far from it waited for after the answer was written. Kept going with
  // waitUntil; without it (tests, the eval), waited for where it starts, as before.
  const later = context.waitUntil ? work => context.waitUntil(work.catch(e =>
    console.warn(`companion answer: after the answer: ${e?.message || e}`))) : null;
  const afterwards = work => later ? later(work) : work;
  // The answer, kept KEEP_DAYS for the nightly check while the player's switch is on (keep, above); never a
  // compaction. Written while the reply goes out (waitUntil), so it never holds it up; logAnswer never throws.
  const keepAnswer = async entry => {
    if (!keep || compact) return;
    const kept = logAnswer(env, app.user.id, { operation, npc, spoken: Boolean(style), zone: parts.zone,
      sub: parts.sub, question: parts.question, feedback: dispute, ref: answerId, total_ms: Date.now() - started,
      ctx: { race: parts.race, class: parts.class, level: parts.level, faction: parts.faction, target: parts.target },
      plan: planLabel(plan), ...entry }, { names, now });
    if (context.waitUntil) context.waitUntil(kept); else await kept;
  };
  try {
    // The allowance the reply carries is read while the answer is written (LOR-654): this answer's count is in already;
    // its cost, settled afterwards, shows from the next one.
    const leaving = allowance(env, app.user.id, now, exempt, plan);
    leaving.catch(() => {});
    // The quick look online writes a finding first (companion-answers.js lookUp), kept for the next player; the answer
    // is then written from it. Without one (no evidence, too slow) it's answered as it would have been.
    const look = quick ? await lookUp(env, real ? { ...parts, question: lookFor } : subject, now, { real, later }) : null;
    lookCost = look?.counted || 0;
    const looked = look?.found;
    if (looked) {
      finding = { answer: looked.answer, sources: looked.web_sources, created: now.toISOString() };
      await keepFinding(env, subject, looked.answer, looked.web_sources, now);
    } else if (real && quick) {
      // A look at the player's own world that found nothing (Flash-Lite skips the search about 1 time in 9): the plain
      // line about the very latest, never last year's graphics cards as today's.
      custom = { ...custom, system: coldTrail(custom.system) };
    }
    // What the answer model reads as the question (the chat keeps the player's words): a bare "search it" or "are you
    // sure?" is their earlier question asked again (LOR-593: Willo answered "I cannot search the interwebs"), and
    // "where do I turn for the dig site?" the way there (LOR-594: answered as a turn-in).
    const reread = question => {
      const reworded = withQuestion(prompt, question);
      if (new TextEncoder().encode(reworded).length <= ANSWER_PROMPT_BYTES) prompt = reworded;
    };
    // Another people's version of a quest the quest facts place here goes from the sources (forever-knowledge.js).
    if (operation === "answer") prompt = otherVersions(prompt, known.facts);
    // FROM THEIR JOURNEY before SOURCES and its reminder after the question, as Willo on the PC puts them. Too long with
    // it, the conversation before goes (the search has used the question before it already).
    if (recalling) {
      const found = recall(parts.question, await recalling, { previous: parts.previousQuestion, now, tz: offset });
      const size = text => new TextEncoder().encode(text).length;
      let recalled = withRecall(prompt, found);
      if (size(recalled) > ANSWER_PROMPT_BYTES) recalled = recalled.replace(/\n\nCONVERSATION\n[\s\S]*?(?=\n\nQUESTION\n)/, "");
      if (size(recalled) <= ANSWER_PROMPT_BYTES) prompt = recalled;
    }
    if (subject !== parts && !taken) {
      reread(parts.previousQuestion);
      custom = { ...custom, system: withBlock(custom.system, askedAgain(parts.previousQuestion, Boolean(finding))) };
    } else if (pressed && !finding && !research) custom = { ...custom, system: withBlock(custom.system, FOUND_NOTHING) };
    if (operation === "answer" && subject === parts && asksTheWay(parts.question)) reread(wayQuestion(parts.question));
    // Required research searches instead (companion-answers.js systemPrompt), so it gets no facts.
    // ...and a question about the player's own world gets none either: Forever facts never answer it (above).
    // A question about Willo herself gets none either: her help answers it, and facts about Westfall only get in its way.
    const facts = research || real || help ? [] : known.facts;
    // THEIR GOALS: never with her own help, which a question about her gets instead.
    const goalText = help ? "" : goalInfo.block;
    const knowledgeText = [research || real || help ? "" : known.block, findingBlock(finding), view?.block || "", goalText]
      .filter(Boolean).join("\n\n");
    // Speak short, show full (LOR-673): a spoken answer in two layers for an app that asks (layers), her spoken words
    // guarded as her answer is (below). They go out first (onSay, onRequest's NDJSON) only when nothing after the answer
    // can put other words in her mouth: no tool or offer, nothing of the notebook, goals or pins in play, no list or
    // line the site writes itself. Otherwise they come with the rest, when the answer is still the model's own words.
    const layered = layers && Boolean(style) && operation === "answer" && !research && !listing;
    const guarded = text => guardAnswer(text, { supplied: [evidenceOf(prompt, parts.question), knowledgeText, help]
      .join("\n"), own: true, researched: research, prompt, question: parts.question,
      names: [parts.zone, parts.sub, parts.target], savedPlace: parts.savedPlace });
    const early = layered && !actions.length && !clearing && !dropping.length && !goalText && !goalInfo.reached.length
      && !intent.read && !intent.write && !intent.remind && !intent.move && !pinning.add && !pinning.read
      && !pinning.manage && !pinning.list && !pinning.clearAll
      && !(view && (view.block || asksReminders(parts.question, intent) || saidYes(parts.question, parts.previous)));
    let said = null;
    const onSay = early ? say => { said = guarded(say); hold.say?.(said); } : null;
    const { model_ms, counted, call, say: modelSay, ...result } = listing ? await Promise.resolve(loggedFirst).then(() => ({
      answer: listing, sources: [], web_sources: [], web_search: { status: "not_needed", queries: [], suggestions_html: "" },
      model: "site", usage: null, model_ms: 0, counted: 0 }))
      : await writeAnswer(env, prompt, now, research, operation,
        { persona, style, image, facts: knowledgeText, help, dispute, custom: custom.system, strong, longMemory, actions,
          later, layered, onSay, lite, smarter })
        .finally(() => loggedFirst);
    const fromModel = result.answer;
    await afterwards(settle(counted));
    // The one action her answer offers, checked against what was offered; never run here. An offer that came without
    // words gets a line of hers that offers it, and one with words saying it's done already loses those words for it.
    // Never one of the notebook's tools, which are done here (below). A question about what she keeps always offers its
    // page (keepsOffer, LOR-666).
    let action = noteTools.length || goalOffer.length ? null : keepsOffer(actions) || actionOf(call, actions);
    // A change to their notebook (lib/willo-notebook.js), checked against the lines it names and worked out on the page
    // her answer read, then written before she answers (one write, a few milliseconds, on a note's answer only), so what
    // she says is what was saved: the blind check (10/18) made the save fail and she still said "Noted". Her line comes
    // from what was written (lib/willo-notebook.js confirmed), never the model's claim: already so, a line she can't
    // find, one she has to ask about, a full page or a save that failed each get their own words.
    // A goal kept or changed (lib/willo-goals.js goalCall) is a change to the notebook the same way, with its own line
    // (goalConfirmed) before her words about what it takes; dropping one is the notebook's own notebook_remove. Her
    // check-ins off or on go back to Willo's app (goals.checkins).
    const noteOffer = [...noteTools, ...goalOffer.filter(t => isNotebookTool(t.name))];
    // The goal their words name is kept whatever the call's arguments say, and even when the answer didn't call
    // goal_set at all (lib/willo-goals.js goalCall): asked to keep one, the site decides by the words.
    const named = goalOffer.some(t => t.name === "goal_set") ? asked : null;
    const goalCalled = goalOffer.length && (isGoalTool(call?.name) || (named && !isNotebookTool(call?.name)))
      ? goalCall(isGoalTool(call?.name) ? call : { name: "goal_set", args: {} }, goalOffer, view, goals,
        { question: parts.question, stock, asked: named, change: goalAsk.change }) : null;
    // "Remind me to feed my pet", no moment in their words: a to-do, from the site, whatever the model called.
    // A pin (lib/willo-pins.js) is hers to write, the game's place and day in it; renaming one is the notebook's own
    // notebook_update, its name taken from the model and its place and day kept; clearing them all, a yes to her ask.
    const cleared = clearing && view ? clearReply(view, parts.question, parts.previous) : null;
    const noted = cleared ? cleared.noted || null : goalCalled?.op ? goalCalled
      : dropping.length === 1 ? { page: dropping[0].page, op: { op: "remove", targets: [{ raw: dropping[0].raw,
        text: dropping[0].text }] } }
      : dropping.length > 1 ? { say: whichLine(dropping) }
      : noMoment(view, intent) || (reminding ? lateReminder(view, intent) || timedReminder(view, intent) : null)
        || (noteOffer.length ? pinCall(call, noteOffer, view, spot)
        || pinUpdate(view, notebookCall(call, noteOffer, view), parts.question) : null);
    let notebook = null, goalsReply = null;
    if (goalCalled && "checkins" in goalCalled) {
      goalsReply = { checkins: goalCalled.checkins };
      result.answer = QUIET_LINES[!goalCalled.checkins];
    } else if (goalCalled?.same) result.answer = goalConfirmed(result.answer, goalCalled.goal, null);
    // Nothing of the notebook written (no tool, or none called) on a question about it: never a claim that it was. A
    // goal's own reply (her check-ins off, a goal kept already) has its words from the site already.
    // And on a "yes" to her offer to do something, unless it was one of the app's that her answer offered to do:
    // "Consider it done, your map is clear of those pins now" with none taken off (the vision session, 10/18).
    const yes = !action && saidYes(parts?.question, parts?.previous);
    // "Where did you write that down?": saying where it was written is the answer, not a change claimed now.
    const where = asksWhereNotes(parts?.question) && !intent.write && !yes;
    if (!noted && !goalCalled && view && !where && (intent.read || intent.write || view.block || yes))
      result.answer = unclaimed(result.answer, { reminding: Boolean(intent.remind), changing: Boolean(intent.write || yes || intent.clear),
        clear: Boolean(intent.clear), plain: yes && !(intent.read || intent.write || view.block) });
    // A pin asked for and none written: never "Pinned"; and with no spot from the game, why not and how she could.
    if (!noted && pinning.add) result.answer = spot ? unpinned(result.answer) : pinSay || NO_SPOT_LINE;
    // Asked for a reminder on a plan without them: the site's words for it, plain typed, never a plan out loud, and
    // what it put on their list (LOR-663's blind check, case 20: the model wrote a to-do and said nothing of it).
    // "What reminders do I have?": what's waiting, built on the site, never from the talk before.
    if (view && asksReminders(parts.question, intent)) result.answer = remindersAnswer(view, { spoken: Boolean(style) });
    // "What's on my list?" with nothing on it: the site's words too.
    const empty = !noted && !listing && view ? emptyListAnswer(view, intent, parts.question) : "";
    if (empty) result.answer = empty;
    // "What pins do I have?", "clear all my pins" and the answer to that: the site's words, from this character's pins.
    if (view && pinning.list) result.answer = pinsAnswer(view, { spoken: Boolean(style) });
    if (pinning.clearAll && view) result.answer = clearAsk(view);
    if (cleared?.answer) result.answer = cleared.answer;
    const planless = Boolean(intent.remind && !reminding);
    if (planless && !noted) result.answer = planReminderLine([], Boolean(style));
    // A reminder asked for at a place not of this age: only that she doesn't know it, never what lies beyond.
    if (!noted && reminding && unknownPlace(view)) result.answer = unknownPlaceLine(unknownPlace(view));
    else if (noted?.missing) result.answer = pinning.manage ? NO_PIN_LINE : NOT_FOUND_LINE;
    // A reminder that can't be kept as asked: her question or answer for it (a place to name, a level reached).
    else if (noted?.say) result.answer = pinning.read ? pinsSaid(noted.say, view) : noted.say;
    else if (noted?.op?.op === "remind" || noted?.op?.op === "unremind") {
      // A reminder set, changed or taken off (LOR-663), written before she answers like a note, and said as the site
      // wrote it: what and when, a time on their clock. The reply carries it for Willo's app to watch for its moment.
      const planned = plannedReminder(view, app.user.id, noted, now);
      if (planned.full) result.answer = REMINDERS_FULL_LINE;
      else {
        const saved = await planned.write(env).then(r => r?.meta?.changes > 0).catch(e => {
          console.warn(`companion answer: reminder write: ${e?.message || e}`);
          return false;
        });
        if (!saved) result.answer = noted.op.op === "unremind" ? NOT_FOUND_LINE : UNSAVED_LINE;
        else {
          notebook = { change: noted.op.op, page: noted.page, title: titleOf(noted.page), reminders: planned.reminders,
            changed: planned.changed };
          result.answer = withRest(reminderLine(noted.op, offset, now), result.answer);
        }
      }
    }
    else if (noted) {
      const planned = plannedChange(view, app.user.id, noted, now);
      if (planned.full) result.answer = FULL_LINE;
      else if (!planned.page) result.answer = noted.goal ? goalConfirmed(result.answer, noted.goal, null)
        : noted.pin ? `That spot's already pinned: ${noted.pin.name}.` : alreadyLine(noted.op);
      else {
        const saved = await planned.write(env).catch(e => {
          console.warn(`companion answer: notebook write: ${e?.message || e}`);
          return null;
        });
        if (!saved) result.answer = UNSAVED_LINE;
        else {
          notebook = { change: noted.op.op, ...saved, changed: planned.changed };
          // Goals taken off with the notebook's own tool are dropped goals, in her goals' words.
          const dropped = noted.op.op === "remove" ? noted.op.targets.map(t => goals.find(g => g.page === noted.page
            && typeof t.raw === "string" && g.raw.trim() === t.raw.trim())) : [];
          result.answer = noted.pin ? pinnedLine(result.answer, noted.pin)
            : noted.goal ? goalConfirmed(result.answer, noted.goal, noted.op)
            : dropped.length && dropped.every(Boolean) ? goalConfirmed(result.answer, dropped[0].goal, noted.op,
              dropped.map(g => g.goal))
            : planless && noted.op.op === "add" && noted.op.why !== "no-moment"
              ? planReminderLine(planned.changed, Boolean(style))
            : confirmed(result.answer, noted.op, planned.changed, noted.page, parts.question);
        }
      }
    }
    // A goal their last save shows reached gets ticked and her answer opens with its cheer (the site's own words, as
    // after a save: lib/willo-goals.js goalsBlock cheer), unless this answer changed the notebook already: Willo's app
    // ticks it after the next save then (POST /api/notebook/goals). The cheer doesn't wait on the tick: it's saved
    // while the reply goes out.
    if (!notebook && goalInfo.reached.length && result.answer) {
      if (goalInfo.cheer) result.answer = `${goalInfo.cheer} ${result.answer}`;
      const page = goalInfo.reached[0].page;
      const planned = plannedChange(view, app.user.id, { page, op: { op: "check", done: true,
        targets: goalInfo.reached.filter(g => g.page === page).map(g => ({ raw: g.raw, text: g.text })) } }, now);
      if (planned.page) {
        notebook = { change: "check", ...planned.page, changed: planned.changed };
        const saved = planned.write(env).catch(e => console.warn(`companion answer: goal tick: ${e?.message || e}`));
        if (context.waitUntil) context.waitUntil(saved); else await saved;
      }
    }
    // Offered the goals' tools and nothing was kept or changed: never her "I've added it" for nothing. And on any
    // answer about their goals that wrote nothing, never "Goal updated" (the blind check, case 6): only the site's own
    // line says a goal changed.
    if (goalOffer.length && !notebook && !goalsReply && !goalCalled?.same && !noted?.missing && !noted?.say)
      result.answer = withoutClaims(result.answer);
    else if ((goalText || goalOffer.length) && !notebook && !listing && !goalsReply && !noted?.say && !noted?.missing
      && !goalCalled?.same)
      result.answer = withoutGoalClaims(result.answer, planLine(goals, stock, { question: parts.question, ...here }));
    // The wrong-number guard: an answer about their goals that says a gold amount nothing she was given holds (a price
    // remembered from the original game, a sum of her own) says the plan's own line instead.
    if (goalText && result.answer && wrongGold(result.answer, new Set([...numbersIn(knowledgeText, parts.question),
      ...goalInfo.numbers]))) {
      const line = planLine(goals, stock, { asked: goalCalled?.goal || goalInfo.asked, question: parts.question, ...here });
      if (line) result.answer = notebook && noted?.goal ? goalConfirmed(line, noted.goal, noted.op) : line;
    }
    if (!compact && !result.answer && !action) throw new Error("Empty answer");
    if (action && (!result.answer || SAYS_DONE.test(result.answer))) result.answer = offerInstead(result.answer, action);
    // Her spoken words (layered): what she said already, or the model's own while the answer is still its words; with
    // other words in the answer, none, and the app says the start of the written answer, as it did before.
    const ownWords = result.answer === fromModel;
    if (layered && (said || (ownWords && modelSay))) result.say = said ?? guarded(modelSay);
    // Out loud, about their goals, from a save older than STALE_SECONDS: her numbers as of that save (asOfSave).
    if (style && goalText && goalInfo.stale) for (const k of ["answer", "say"]) if (result[k]) result[k] = asOfSave(result[k]);
    if (said && !ownWords) console.warn("companion answer: her spoken words went out before the site changed the answer");
    // Last checks, in code (lib/willo-guards.js): no map coordinates nothing supplied gives, "your people" in Willo's
    // own words, names spelled as the game spells them. Her own earlier answers are no evidence (evidenceOf).
    const supplied = [evidenceOf(prompt, parts?.question), knowledgeText, help].join("\n");
    if (!compact && result.answer && result.answer !== VERIFICATION_FAILED)
      result.answer = guardAnswer(result.answer, { supplied, own: operation === "answer", researched: research, prompt,
        question: parts.question, names: [parts.zone, parts.sub, parts.target], savedPlace: parts.savedPlace });
    // Two layers: the written answer adds only names and numbers what she was given holds (groundedWritten), then
    // her line about the rest when it still says more than her words (restLine): on the end of her words when they go
    // with the answer, or as rest for the app to say after the words it said already.
    if (result.say && ownWords && result.answer && result.answer !== VERIFICATION_FAILED)
      result.answer = groundedWritten(result.answer, result.say, supplied);
    const rest = result.say ? restLine(result.say, result.answer) : "";
    if (rest && said) result.rest = rest;
    else if (rest) result.say = `${sayOf(result.say, SAY_MAX_CHARS - rest.length - 1)} ${rest}`;
    if (!action && liveOffer && result.answer && result.answer !== VERIFICATION_FAILED && await liveOffer) {
      action = { id: "live_game_info", args: {}, label: "Turn on Live game info…" };
      result.answer = `${result.answer} ${offerLine(action)}`;
    }
    if (finding) {
      result.web_sources = finding.sources;
      result.web_search = looked ? looked.web_search : { status: "searched", queries: [], suggestions_html: "" };
    } else if (research && !custom.system && result.web_search?.status === "searched" && result.web_sources?.length) {
      // Kept for other players only when written without this player's own style or tale.
      await keepFinding(env, subject, result.answer, result.web_sources, now);
    } else if (fromFacts) {
      // Companions keep an answer they asked to be researched only with its sources (companion/lore_companion/
      // sponsored.py): these are the records its facts come from. Nothing was searched, so no queries or suggestions.
      result.web_sources = factSources(facts.filter(f => f.asked));
      result.web_search = { status: "searched", queries: [], suggestions_html: "" };
    } else if (help && researchRequired && operation === "answer") {
      result.web_sources = [HELP_SOURCE];
      result.web_search = { status: "searched", queries: [], suggestions_html: "" };
    }
    if (taste) {
      const kept = tasted(lookCost + (counted || 0), true);
      if (context.waitUntil) context.waitUntil(kept); else await kept;
    }
    const left = await leaving;
    // timing: where the time went, in whole milliseconds (the companion logs it). forever_facts: the titles of the
    // Forever facts the answer was given; feedback: what we kept of this message ("correction", "frustration");
    // looked_up: "required", "quick" (research "auto" looked online and found something), "cached" (an earlier
    // search's finding), "facts" (asked to research, answered from the facts that cover it instead) or "no". tale: the
    // reply used the player's own tale, which the companion marks on it.
    // lookups: the site's look-ups the answer was written with (lib/willo-tools.js LOOKUPS), for the companion's log.
    // action: what the answer offers to do, {id, args, label} (lib/willo-tools.js ACTIONS), for Willo's app to show as a
    // button and run on a tap; only with an answer of hers about herself. notebook: the page her answer changed, as it
    // will be once saved ({change, page, title, body, version, updated, undo, changed}), for Willo's app to show; a goal
    // kept, changed, dropped or ticked is one too (lib/willo-goals.js). goals: {checkins: false | true} when the player
    // turned her goal check-ins off or on, for Willo's app to keep.
    const used = [...(facts.length ? ["forever_facts"] : []), ...(cached || research || looked ? ["web"] : []),
      ...(view?.block ? ["notebook"] : []), ...(goalText ? ["goals"] : []), ...(image ? ["sight"] : []),
      ...(help ? ["help", ...(state ? ["state"] : []), ...(usage ? ["answers_left"] : [])] : [])];
    // "empty": it looked and found nothing; "off": the companion asked and the rule would look, but the plan (the free
    // plan never looks online), its month's look-ups or the day's budget said no. The nightly check tells those apart
    // from a question the rule let go (LOR-627: 42 of 42 kept answers said "no").
    const offline = !research && !quick && !cached && !fromFacts && operation === "answer" && !help &&
      (real || (askedToLook && wantsSearch(parts.question, dispute, known.facts)));
    const lookedUp = cached ? "cached" : research ? "required" : fromFacts ? "facts" : looked ? "quick"
      : quick ? "empty" : offline ? "off" : "no";
    // Of the notebook, only which of its tools ran, never what's in it (a to-do the site wrote itself: notebook_add; a
    // goal the site kept by the words: goal_set).
    await keepAnswer({ answer: result.answer, say: typeof result.say === "string" && result.say !== result.answer
      ? result.say : undefined, action: action?.id || (notebook ? (noted?.goal ? "goal_set"
      : /^(?:notebook_|goal_)/.test(call?.name || "") ? call.name : "notebook_add") : goalsReply ? "goal_checkins" : undefined),
      model: result.model,
      model_ms, looked_up: lookedUp,
      lookups: used, facts: facts.map(f => f.title), outcome: result.answer === VERIFICATION_FAILED ? "unverified" : "answered" });
    // A real answer activates the friend a share link brought (lib/referrals.js activateReferral: their inviter moves on)
    // and notes Willo's computer; after the reply is on its way, never holding it up. Most accounts skip it unread.
    if (!compact && result.answer !== VERIFICATION_FAILED) await afterwards(machineOf(request).then(machine =>
      activateReferral(env, { userId: app.user.id, deviceId: app.device?.id, machine }, now)).catch(e =>
      console.warn(`companion answer: referral: ${e?.message || e}`)));
    // answer_id: this answer's id, for the app to send back with a report on it or with the next question.
    return Response.json({ ok: true, ...result, allowance: left, timing: { model_ms, total_ms: Date.now() - started },
      ...(answerId ? { answer_id: answerId } : {}),
      ...(compact ? {} : { forever_facts: facts.map(f => f.title), lookups: used, looked_up: lookedUp }),
      ...(action ? { action } : {}), ...(notebook ? { notebook } : {}), ...(goalsReply ? { goals: goalsReply } : {}),
      ...(dispute ? { feedback: dispute } : {}), ...(custom.tale ? { tale: true } : {}) }, { headers: noStore });
  } catch (e) {
    await settle(e?.counted);
    // A failed answer gives back what it took (the plan's day and month, or its starter answer): it's for answers, not
    // attempts. A best-first one too.
    await giveBack();
    if (taste) await Promise.all([returnTaste(env, taste), tasted(lookCost + (e?.counted || 0), false)]);
    console.warn(`companion answer: ${e?.message || e}`);
    await keepAnswer({ outcome: "failed", error: String(e?.message || e) });
    return failed(e, answerId);
  }
}
