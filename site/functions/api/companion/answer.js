// Account-linked companion answers. The site owns the key and pays for a small daily allowance; a player's plan
// (lib/billing.js) gives more. Answers can't be bought: once a plan's are gone (and any friends gave), Willo
// answers from the add-on's lore library until they come back.
import { setup, fail, noStore } from "../../../lib/accounts.js";
import { currentDevice } from "../../../lib/devices.js";
import { perDay, perPeriod, unDay, unPeriod } from "../../../lib/ratelimit.js";
import { markAsked } from "../../../lib/activity.js";
import { allowance, reserveAnswer, answerReservation, seesPicture, writeAnswer, SAY_MAX_CHARS, lookUp, uncapped,
  personaOf, styleOf, lookOf, COMPACTIONS_PER_DAY, ANSWER_PROMPT_BYTES, ANSWER_IMAGE_CHARS, LORE_FOCUS, TRAIL_COLD, CUSTOM_PROMPT_BYTES,
  VERIFICATION_FAILED, smartRoute, keepsPicture } from "../../../lib/companion-answers.js";
import { promptParts, withoutLive, knowledgeFor, asksTheWay, wayQuestion, withQuestion, factSources, offerTaken, meant, otherVersions }
  from "../../../lib/forever-knowledge.js";
import { feedbackKind, logFeedback, IMPLICIT_KINDS } from "../../../lib/answer-feedback.js";
import { registerScreenshot, diagnosticConsent, storageReady } from "../../../lib/diagnostic-screenshots.js";
import { logAnswer, tagAnswer } from "../../../lib/answer-log.js";
import { planLabel, recordLimit } from "../../../lib/plan-usage.js";
import { lastOf, signalsFor, queueWorthy, newAnswerId, signalWords, topicOf } from "../../../lib/answer-signals.js";
import { cachedFinding, keepFinding, findingBlock, wantsSearch, realWorld, searchesBefore, pressedToLook, FOUND_NOTHING,
  askedAgain, needsTalentResearch } from "../../../lib/research-cache.js";
import { helpBlock, helpTopics, helpQuestion, stateOf, asksWhatKept, asksWhereNotes } from "../../../lib/willo-help.js";
import { keptSummary } from "../../../lib/keeps-notebook.js";
import { lookupsFor, actionsFor, actionOf, keepsOffer, offerInstead, offerLine, freeKey, SAYS_DONE, QUEST_READING_OFFER }
  from "../../../lib/willo-tools.js";
import { picksFor, pickNamed, readsQuests } from "../../../lib/companion-voice.js";
import { plansOn, holdUserSpend, releaseUserSpend, addUserSpend, useShare, returnStarter, offersFor,
  poolWindow, capState, companionFeatures, PLANS, setupBilling, MACHINE_ACCOUNTS } from "../../../lib/billing.js";
import { planSoon } from "../../../lib/plan-cache.js";
import { promptRow, blocksOf, allowedFor, NPC_KEY } from "../../../lib/willo-custom.js";
import { memoriesBlock } from "../../../lib/willo-memories.js";
import { takeFirst, returnTaste, takeTasteLookup, giveTasteLookup, holdDay, settleDay, tasteFor, trialOf, trialRow, withTrial,
  tryOnce, untry } from "../../../lib/best-first.js";
import { bulkScope, bulkTurn, bulkReply, bulkLine, relocateOps, relocateLine, undoAsk, undoPages, undoLine, NOTHING_TO_UNDO, UNDO_ELSEWHERE,
  REMINDER_GONE_LINE, tookReminder, setReminder } from "../../../lib/willo-notebook-manage.js";
import { pageOf, notebookIntent, readNotebook, notebookView, notebookTools, notebookCall, plannedChange,
  confirmed, alreadyLine, unclaimed, saidYes, withRest, titleOf, knownPlaces, plannedReminder, reminderLine, isNotebookTool,
  allReminders, undoPage, notebookWritePage, NEED_CHARACTER_LINE,
  NOT_FOUND_LINE, FULL_LINE, UNSAVED_LINE, NOTE_CLAIM, notWritten, REMIND_RULES, REMIND_PLAN_RULE, REMIND_PLAN_SPOKEN, REMINDERS_FULL_LINE,
  unknownPlace, unknownPlaceLine, planReminderLine, asksReminders, remindersAnswer, noMoment, lateReminder, timedReminder, emptyListAnswer }
  from "../../../lib/willo-notebook.js";
import { pinIntent, spotOf, pinTool, pinCall, pinUpdate, pinRules, pinnedLine, unpinned, pinsAnswer, pinsSaid,
  clearAsk, clearTurn, clearReply, NO_SPOT_LINE, NO_PIN_LINE, pinPlaces, spotWithout, phoneNoSpotLine }
  from "../../../lib/willo-pins.js";
import { savedJourney } from "../../../lib/saved-journey.js";
import { asks as asksJourney, hasJourney, recall, withRecall } from "../../../lib/willo-recall.js";
import { savedStock } from "../../../lib/willo-stock.js";
import { stockOf, withSave, GOALS_ON_HERO, goalIntent, writesGoals, goalsOf, askedGoal, goalsBlock, asOfSave, goalTools, goalCall, isGoalTool,
  goalConfirmed, withoutClaims, withoutGoalClaims, goalsNamed, whichLine, goalsList, GOAL_LIST, QUIET_LINES, numbersIn,
  wrongGold, planLine } from "../../../lib/willo-goals.js";
import { guardAnswer, groundedWritten, evidenceOf, SOUNDS } from "../../../lib/willo-guards.js";
import { activateReferral, machineOf } from "../../../lib/referrals.js";
import { checkAlerts } from "../../../lib/free-pool.js";
import { sendIntent, screenshotRecipientReply, sendOffer } from "../../../lib/friend-send.js";
import { withFriendsNote } from "../../../lib/friends-note.js";
import { stubbed, stubAnswer } from "../../../lib/test-players.js";
import { isCompanion, isPhone, tooOld, UPDATE_LINE } from "../../../lib/client-version.js";

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
// Her answer says she can't see or tell where they are or who they target (LOR-802): with no picture sent, the answer
// log marks it "unseen" among its look-ups, so the app's screen look-up (which questions take the screen) grows from
// real misses.
export const UNSEEN = /\b(?:can(?:no|['’])?t|unable to|couldn['’]?t) (?:quite )?(?:see|tell|make out)\b|\bdon['’]?t know where you are\b|\bno target can be seen\b|\bmists are thick\b|\bwhere are you\b/i;
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
// Away from the game, the zone the context gave ("<sub>, <zone>") is where they last were: willo-guards.js fromWhereLast
// says her "right here" and "you are in" as from there.
const placeOf = (parts, away) => away ? [parts.sub, parts.zone].filter(Boolean).join(", ") : "";
// What the facts don't hold, so a question about it is still researched when the companion asks. "Auction" is a
// price, but the auction house or its auctioneers are a place the town facts hold ("where's the auction house in
// Ironforge?", LOR-614).
const NOT_IN_FACTS = /\b(?:rewards?|xp|experience|prices?|costs?|worth|auction(?!(?: ?house|eers?)\b)|how much)\b/i;
const MAX_BODY_BYTES = 64 * 1024; // JSON escaping can expand a valid 16 KB Unicode prompt.
// A spoken question may also carry a picture (base64, a byte per character); the rest of the body keeps MAX_BODY_BYTES.
const MAX_PICTURE_BODY_BYTES = MAX_BODY_BYTES + 2 * ANSWER_IMAGE_CHARS;   // the picture and its close-up (LOR-802)
// offers: the plan the player could move up to for more answers (lib/billing.js offersFor), only when there's one.
const tooMany = (error, retryAfter, allowance, offers = []) => Response.json({ ok: false, error, retryAfter, allowance,
  ...(offers.length ? { offers } : {}) }, { status: 429, headers: { ...noStore, "Retry-After": String(retryAfter) } });
const untilReset = (left, now) => Math.ceil((Date.parse(left.resetsAt) - now.getTime()) / 1000);
const untilTomorrow = now => Math.ceil((Date.parse(now.toISOString().slice(0, 10) + "T00:00:00Z") + 86400e3 - now.getTime()) / 1000);
const dateOf = iso => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
// When her light comes back, in the world's words, from the seconds until it does (LOR-773): never "tomorrow", which
// the day's turn at midnight UTC (5 pm in California, LOR-742) made wrong for the American evening.
const refillWhen = seconds => {
  const h = Math.max(0, seconds) / 3600;
  return h >= 36 ? `in about ${Math.round(h / 24)} days` : h < 1 ? "in under an hour" : h < 1.5 ? "in about an hour"
    : `in about ${Math.round(h)} hours`;
};
// A failed answer, always as JSON (LOR-580): `reason` (what failed, "Gemini HTTP 503", a D1 error) goes in the
// companion's log, which asks once more; the player only ever sees Willo's own line for it.
// answerId: the failed answer's id (lib/answer-signals.js), so the app's next question can say it failed.
// The shared budget's share for the day is spent (reserveAnswer said no): Willo's words, as outOfAnswers' are.
// No "tomorrow": the day turns at midnight UTC, the American evening (the architect, 10/22); her light shows when.
const CROWDED = "So many travelers have drunk from the Moonwell that my light's spent for now. " +
  "Let it rest a while, and it will gather again.";
const failed = (e, answerId = null) => Response.json({ ok: false, error: "Couldn't get a live answer just now. Try again in a moment.",
  reason: String(e?.message || e).slice(0, 160), ...(answerId ? { answer_id: answerId } : {}) }, { status: 502, headers: noStore });

// The plan's answers are gone, today's or the month's (the allowance's period), and any friends gave too: the
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
  const back = refillWhen(untilReset(left, now));
  const words = !plansOn(env) ? `You've used your ${plan.answersPerDay} free answers. They come back ${back}.`
    : capped || left.period === "month"
      ? `My light's spent for this month. The Moonwell refills it on ${dateOf(left.resetsAt)}.`
    : `My light's spent for now. The Moonwell refills it ${back}.`;
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
  if (!isCompanion(request.headers.get("X-LF-Client")) || request.headers.get("Origin"))
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
  let prompt, operation, researchRequired, persona, style, image, closeup, closeupOf, screenLook, autoResearch, npc, dataVersion, keep, names, current,
    offset, stock, layers, last, awayAsked;
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
    // Optional (LOR-802): with it, a close-up of that picture's top-right corner (the minimap and the place name by it),
    // cut from the full-size frame; used only with the picture, the same way. Never logged or stored.
    closeup = body.closeup;
    // closeup_of "target": that close-up is of the target frame, for a question about their target.
    closeupOf = body.closeup_of === "target" ? "target" : null;
    // Optional (LOR-802): look "screen" when the app took that picture for a typed question that needs the screen ("where
    // am I?", "who's this?"): her screen look-up, chosen by the app's code. Anything else, and a typed picture is ignored.
    screenLook = lookOf(body.look);
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
    // character's page beside the account's. Without it the shared page can be read, but writes need explicit scope.
    current = pageOf(body.notebook?.character);
    // and offset: the player's clock, minutes from UTC, for a reminder at a time of day (LOR-663).
    offset = Number.isInteger(body.notebook?.offset) && Math.abs(body.notebook.offset) <= 14 * 60 ? body.notebook.offset : null;
    // Optional (Willo's goals, lib/willo-goals.js stockOf, LOR-665): what the add-on last saved of that character (gold,
    // level, skills, reputation, riding, their evenings), for how their goals stand. Without it she says she can't see
    // it yet. Without it (Willo for iPhone, an older app), the last save the PC's app sent with the profile is read with
    // the notebook below and told as of that save (lib/willo-stock.js); stock sent with the question always wins.
    stock = stockOf(body.stock);
    // Optional (LOR-673, speak short, show full): layers 2 from an app that takes a spoken answer in two layers, her
    // spoken words (say, at most SAY_MAX_CHARS letters) and the written answer, as NDJSON when her words come first
    // (onRequest). Without it (an older app, the iPhone), one answer as before.
    layers = body.layers === 2;
    // Optional (10/21): away true from a Willo on a PC whose game isn't running (the iPhone is always away, below), so her
    // answer speaks of where they last were, not where they are. Anything else, an older companion too, is in the game.
    awayAsked = body.away === true;
    // Optional (the feedback loop, 10/18): what the app knows of the answer before this question (lib/answer-signals.js
    // lastOf: its answer_id, how long ago, whether she was cut off or her voice never played, whether it failed), for
    // the signals it gives that answer. Read only while keep is on.
    last = keep ? lastOf(body.last) : null;
  } catch { return fail(400, "Couldn't read that question."); }
  if (bytes - (typeof image === "string" ? image.length : 0) - (typeof closeup === "string" ? closeup.length : 0)
    > MAX_BODY_BYTES) return tooBig();
  // "character" (LOR-394) is an ordinary answer in the targeted character's voice: same daily answers and budget.
  if (!["answer", "compact", "character"].includes(operation)) return fail(400, "Unknown chat operation.");
  if (typeof prompt !== "string" || !prompt.trim() || new TextEncoder().encode(prompt).length > ANSWER_PROMPT_BYTES)
    return fail(400, "That question has too much context. Try a shorter question.");
  if (typeof researchRequired !== "boolean") return fail(400, "Research preference must be true or false.");
  // An app below its minimum (lib/client-version.js tooOld) gets her update line as its answer, without spending one:
  // today's apps read only answers, so this is how an old one hears it.
  const old = operation !== "compact" && tooOld(request.headers.get("X-LF-Client"), env);
  if (old) {
    const line = UPDATE_LINE[old.platform] || UPDATE_LINE.willo;
    return Response.json({ ok: true, answer: line, ...(style ? { say: line } : {}), model: "willo-update", update: old,
      timing: { model_ms: 0, total_ms: Date.now() - started }, lookups: [], looked_up: "no" }, { headers: noStore });
  }
  // Willo's own state, sent with her answers (LOR-546): lifted out of the prompt, for her help to use when the
  // question is about her (below), never otherwise.
  let state;
  ({ state, prompt } = stateOf(prompt));
  // An older Willo's note about the player's friends, with the newer one in its place (lib/friends-note.js: they/them
  // always, old sightings as last seen, never speaking for them).
  prompt = withFriendsNote(prompt);
  // Away from the game (the iPhone, or a PC whose game isn't running): nothing in the context is what's around them now.
  const away = operation === "answer" && (awayAsked || isPhone(request.headers.get("X-LF-Client")));
  if (away) prompt = withoutLive(prompt);
  const now = new Date();
  const compact = operation === "compact";
  // What WoW Forever changed, for this question and place (LOR-446), looked up while the allowance is checked.
  const parts = compact ? null : promptParts(prompt);
  // Screenshot requests are answered in fixed words without spending an answer. Only an explicitly capable desktop
  // gets a local capture action; phone and older desktop clients get clear directions. Card sends have retired.
  const sending = operation === "answer" && persona === "willo" ? sendIntent(parts.question) || screenshotRecipientReply(parts) : null;
  const [offer, sendLeft] = sending ? await Promise.all([sendOffer(env, app.user.id, sending,
    request.headers.get("X-LF-Capabilities"), now.getTime()),
    allowance(env, app.user.id, now)]) : [];
  if (offer) {
    const asked = markAsked(env, app.user.id, now.getTime());
    if (context.waitUntil) context.waitUntil(asked); else await asked;
    return Response.json({ ok: true, answer: offer.answer, model: "willo-friends", allowance: sendLeft,
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
  // Ask before offering tools or spending an answer. An unknown character is not a request for an account-wide note.
  if (operation === "answer" && !notebookWritePage({ current, question: parts.question })
      && (intent.write || pinning.add || pinning.manage || goalIntent(parts.question).set)) {
    return Response.json({ ok: true, answer: NEED_CHARACTER_LINE, ...(style ? { say: NEED_CHARACTER_LINE } : {}),
      model: "willo-notebook", timing: { model_ms: 0, total_ms: Date.now() - started },
      lookups: [], looked_up: "no" }, { headers: noStore });
  }
  // ...or by a place's name ("pin Fargodeep Mine as the kobold den": one this age has, never a model's), or where their
  // last save left them ("pin where I last was": the journey Willo's app synced) (LOR-672). Willo for iPhone never knows
  // where they stand: asked to pin it, she says so and how to pin from the phone (pinSay).
  const phone = isPhone(request.headers.get("X-LF-Client"));
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
  // Taking many lines off ("clear my done items", her ask's yes) and "undo that" (lib/willo-notebook-manage.js): the
  // site's to do, read from the pages themselves, with no model call.
  const bulking = operation === "answer" && !clearing && Boolean(bulkTurn(parts.question, parts.previous)
    || bulkScope(parts.question));
  const undoing = operation === "answer" && undoAsk(parts.question);
  if (bulking || undoing) intent.read = true;
  if (pinning.manage || (pinning.add && spot)) intent.write = true;
  // "What do you know about me?" (LOR-666): all of it, read with the rest as always, so she can say what she keeps (its
  // counts go in her help, below).
  if (operation === "answer" && !intent.read && asksWhatKept(parts.question)) intent.read = true;
  if (intent.write) [researchRequired, autoResearch, image] = [false, false, null];
  // Their notebook's two pages (this character's and the account's), read from now on alongside the rest: one indexed
  // read, which a failed one reads as empty, never failing the answer.
  // The character's last kept save (stock, when the question came without one) rides in the same batch: no round trip of its own.
  const reading = operation === "answer" ? readNotebook(env, app.user.id, current, { prev: undoing, stock: !stock }).catch(e => {
    console.warn(`companion answer: notebook: ${e?.message || e}`);
    return { pages: [], reminders: [] };
  }) : null;
  // A reminder at a place is checked against the places of this age (LOR-663), read alongside too.
  const placing = intent.remind ? knownPlaces(env).catch(() => new Map()) : null;
  // With the profession ranks the question came with (the add-on's save), for "how do I level my herbalism?".
  const knowledge = compact ? null : knowledgeFor(env, { ...parts, skills: stock?.skills || null },
    { character: operation === "character", dataVersion });
  // Mike's own and test accounts skip the daily answer cap; the monthly budget below still applies to them. The plan
  // sets the daily answers; a paying player skips the shared monthly budget and has a cost cap instead. Both at once:
  // every round trip to D1 here is one a player far from it waits for before Willo can start (LOR-654).
  // A chat memory's compaction reads the account's first-run trial alongside (lib/best-first.js: longer memory while its
  // days last); an answer has it from its take below.
  const memoryRow = compact ? setupBilling(env).then(() => trialRow(env, app.user.id).first()).catch(() => null) : null;
  const [exempt, plan] = await Promise.all([uncapped(env, app.user.id), planSoon(env, app.user.id, now)]);
  const subscriber = plan.id !== "free";
  // Willo's best first and its first-run trial (below), and a customization (lib/willo-custom.js: Willo's style, or
  // their tale of the character; a failure to read it gives an ordinary answer) a paying plan or the trial may use, go
  // out now too, while the answer is counted. Whatever happens to them is seen where they're used; an answer that's
  // out of answers gives the taste back.
  const tasting = compact ? null : takeFirst(env, app.user.id, plan, now, { spoken: Boolean(style) });
  tasting?.catch(() => {});
  const customizing = !compact && (subscriber || tasteFor(env, plan))
    ? promptRow(env, app.user.id, { operation, npc }).catch(e => {
      console.warn(`companion answer: customization: ${e?.message || e}`);
      return null;
    }) : null;
  // What the player told Willo about themselves (lib/willo-memories.js, LOR-729): for her own answers only, read alongside
  // the rest; a failure to read it gives an ordinary answer. "" for a player with none, which leaves the prompt as it was.
  const remembering = operation === "answer" ? memoriesBlock(env, app.user.id, { operation, question: parts.question }).catch(e => {
    console.warn(`companion answer: memories: ${e?.message || e}`);
    return "";
  }) : null;
  // Willo's daily and weekly players (lib/activity.js markAsked, LOR-524): every question counts, answered or not.
  if (!compact) {
    const asked = markAsked(env, app.user.id, now.getTime());
    if (context.waitUntil) context.waitUntil(asked); else await asked;
  }
  // pack: answers friends gave (Share Willo), when this answer comes out of them (the day's plan answers are gone).
  let pack = null;
  // took: what this answer counted on the plan, each marked as its count goes in: the day, and a paid plan's month
  // (pool). An answer that fails gives back what it took, with its pack (giveBack): it's for answers, not attempts.
  // Before, only the pack went back, so a failed answer cost the player one of the day's, and the companion's own
  // second ask (LOR-580) another (LOR-673); a count that went in before an error goes back too.
  let took = null;
  // Past the plan's text cap, her answer on Flash-Lite (lib/billing.js capState "lite").
  let lite = false;
  // Her answers on the smarter model: a plan that has it (lib/billing.js PLANS smarter: Legend), while plans are on.
  const smarter = plansOn(env) && Boolean(plan.smarter);
  // Her smarter mind (lib/companion-answers.js MULL_RULE): her hard questions thought through, every one on a plan with
  // `smarter`, a few a plan month on one with thinkingPerMonth (Hero's taste), while WILLO_SMART_ROUTE isn't off. The
  // taste's count is read now, alongside the rest, so a month whose few are used never gets the rule; one more is
  // taken only when a question turns out hard (takeThought).
  const thinking = plansOn(env) && smartRoute(env) && operation === "answer" && (smarter || plan.thinkingPerMonth > 0);
  const thoughtKey = thinking && !smarter ? `companion-thinking:${poolWindow(plan, now).key}` : null;
  const thoughtsLeft = thoughtKey ? env.DB.prepare("SELECT n FROM rate_limits WHERE user_id = ? AND bucket = ?")
    .bind(app.user.id, thoughtKey).first().then(row => (row?.n || 0) < plan.thinkingPerMonth).catch(() => false)
    : Promise.resolve(thinking);
  const takeThought = thoughtKey ? () => perPeriod(env, app.user.id, "companion-thinking", poolWindow(plan, now).key,
    plan.thinkingPerMonth) : null;
  let mull = false;
  const giveBack = async () => {
    const [plan, given] = [took, pack];
    took = pack = null;
    await Promise.all([plan?.day && unDay(env, app.user.id, "companion-answer", now),
      plan?.month && unPeriod(env, app.user.id, "companion-month", plan.pool.key),
      plan?.machine && unDay(env, `machine:${plan.machine}`, "companion-answer", now), given && returnStarter(env, given.id)]);
  };
  hold.giveBack = giveBack;
  if (compact) {
    // Compaction has its own abuse limit and uses the shared paid budget. It never spends a player's daily answer or
    // one friends gave.
    if (!(await perDay(env, app.user.id, "companion-compact", COMPACTIONS_PER_DAY, now))) {
      const left = await allowance(env, app.user.id, now, exempt, plan);
      return tooMany(`Chat memory has done all it can for now. Your messages are saved; try again ${refillWhen(untilTomorrow(now))}.`, untilTomorrow(now), left);
    }
  } else if (!exempt) {
    // The plan's answers first: today's, and a paid plan's month's (from its renewal day, lib/billing.js poolWindow).
    // Once they're gone, answers friends gave; then the add-on's lore library (the 429).
    // A paying player whose answers this month cost half their plan's net (lib/billing.js capState "lite") gets them on
    // Flash-Lite, not looking online; once answers and hosted voice have cost the whole net ("capped"), none of the
    // plan's are left until the next month: the lore library answers.
    const pool = plansOn(env) && plan.answersPerMonth ? poolWindow(plan, now) : null;
    // The day's and the month's count go in while the text cap is checked, all at once (LOR-654). An answer that turns
    // out not to be the plan's gives back the counts that checking one at a time never made: a capped plan's day and
    // month, and the month of a day over its limit.
    // All three settle before anything goes on, so a failure in one (D1) still knows which counts went in, and the
    // first failure is thrown once they have (the outer catch gives those back).
    // A free answer counts on its computer's day too (X-LF-Machine, lib/referrals.js machineOf): one computer gets at
    // most MACHINE_ACCOUNTS free accounts' day, so new free accounts made on it add no answers (the architect's launch
    // review, 10/21). An app that sends no machine code (the iPhone app, an older Willo) isn't counted this way.
    const machine = plansOn(env) && !subscriber ? await machineOf(request) : null;
    const counting = took = { pool, day: false, month: false, machine: null };
    const checks = await Promise.allSettled([plansOn(env) && capState(env, app.user.id, plan, now),
      perDay(env, app.user.id, "companion-answer", plan.answersPerDay, now).then(ok => (counting.day = true, ok)),
      pool ? perPeriod(env, app.user.id, "companion-month", pool.key, plan.answersPerMonth)
        .then(ok => (counting.month = true, ok)) : true,
      machine ? perDay(env, `machine:${machine}`, "companion-answer", plan.answersPerDay * MACHINE_ACCOUNTS, now)
        .then(ok => (counting.machine = machine, ok)) : true]);
    const broke = checks.find(c => c.status === "rejected");
    if (broke) throw broke.reason;
    const [cap, today, monthly, computer] = checks.map(c => c.value);
    const capped = cap === "capped";
    lite = cap === "lite";
    const planned = !capped && today && monthly && computer;
    if (!planned) {
      took = null;
      const over = capped || !computer;
      await Promise.all([over && unDay(env, app.user.id, "companion-answer", now),
        pool && (over || !today) && unPeriod(env, app.user.id, "companion-month", pool.key),
        machine && computer && unDay(env, `machine:${machine}`, "companion-answer", now)]);
    }
    // Then answers friends gave by sharing Willo (lib/billing.js useShare, any plan; a paying player's only while their
    // month is under its text cap, and paid for like the plan's); one that finds the last one gone is out of answers.
    // The free plan's old starter isn't used (lib/billing.js; Mike, 10/22): nothing past the free plan's day.
    if (!planned && !(!capped && (pack = await useShare(env, app.user.id)))) {
      const taken = tasting && await tasting.catch(() => null);
      if (taken?.taste) await returnTaste(env, taken.taste);
      return outOfAnswers(env, app.user.id, plan, now, exempt, capped);
    }
  }
  // A player saying the last answer was wrong, or losing patience: Willo is told not to argue, and it comes back to us
  // (lib/answer-feedback.js) with what was asked and answered. A character's reply is in character, so not counted.
  // How a name sounds is never a dispute (LOR-653: "It's actually pronounced Dun Moreau" looked online and argued it).
  const sounds = operation === "answer" && SOUNDS.test(parts.question);
  const dispute = operation === "answer" && !sounds ? feedbackKind(parts.question, parts.previous) : null;
  // Her answers on the smarter model's slot for a plan that has it (lib/companion-answers.js SMART_MODEL). A disputed
  // answer, any plan, thinks first on DeepSeek since 10/24 (generate), not on a smarter Gemini (the insistence research,
  // 10/22: Flash-Lite gave way to a wrong player 11 to 16 times in 18, 3.6 Flash none).
  const smartFor = () => smarter;
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
  // trial: its first-run trial (lib/best-first.js trialOf), read with the take: while its days last, what the plan
  // doesn't have is tried here too (look-ups, sight, goals and reminders, her style and tales; longer memory with a
  // compaction), a few times each where a use costs something.
  const [known, first] = await Promise.all([knowledge || { facts: [], block: "" }, tasting]);
  const taste = first?.taste || null;
  const trial = compact ? trialOf(env, plan, await memoryRow, now) : first?.trial || null;
  const trying = Boolean(trial?.on);
  // The free plan, while plans are on (Mike, 2026-10-12): its answers stay with the world's lore (LORE_FOCUS below),
  // without looking online or the game picture, except its best first and its trial's days. Willo still speaks (style
  // "spoken" stays).
  const freePath = plansOn(env) && !subscriber && !taste && !trying;
  const askedToLook = researchRequired === true || autoResearch;   // what the companion asked for, before the plan
  if (freePath) [researchRequired, autoResearch, image] = [false, false, null];
  // The trial's pictures (lib/best-first.js TRIAL.sight), counted once the answer used one: none once they're gone.
  if (plansOn(env) && !subscriber && !(trying && trial.left.sight > 0)) image = null;
  // A spoken question that points at nothing on screen goes without its picture, as text, so her answer host writes it
  // (lib/companion-answers.js keepsPicture; the Software Architect, 10/24). Never a screen look the app asked for, a
  // question about their target (its close-up came) or a dispute. Before the reservation, which follows the picture.
  const unpointed = Boolean(image) && operation === "answer" && Boolean(styleOf(style)) && !screenLook &&
    closeupOf !== "target" && !dispute && !keepsPicture(env, parts.question);
  if (unpointed) [image, closeup] = [null, null];
  // What the plan has, with the trial's days: its reminders and seeing the game (lib/billing.js companionFeatures).
  const features = companionFeatures(plan, { taste: { on: Boolean(taste), left: taste ? 1 : 0, trial } });
  // The site's look-ups for this question (lib/willo-tools.js lookupsFor, LOR-546). A question about Willo herself:
  // her own help, what her app says of itself right now and, about plans, the answers left, never a look online.
  const lookups = compact ? [] : lookupsFor(parts.question, { previous: parts.previousQuestion, answered: parts.previous, persona, operation,
    plans: plansOn(env) });
  const usage = lookups.includes("answers_left") ? await allowance(env, app.user.id, now, exempt, plan) : null;
  const helpAsked = compact ? "" : helpQuestion(parts.question, parts.previousQuestion, parts.previous);   // a follow-up reads with what it follows
  let help = lookups.includes("help") ? helpBlock(helpAsked, { plans: plansOn(env), plan: plan.name,
    client: request.headers.get("X-LF-Client"), state, usage, keeping: keep, spoken: style === "spoken" }) : "";
  // What she reads of their notebook (all of it when asked about it or to write in it, else the lines that share a word
  // with the question), and its tools when asked to write: in place of the app's actions, which a note never needs.
  // Reminders (LOR-663) on Hero and up, while the site sells plans (lib/billing.js companionFeatures).
  const book = await reading;
  if (!stock && book?.stock) stock = savedStock(book.stock);
  // Their professions, talents, and the gear and bags the question bears on, from that save, in PLAYER CONTEXT
  // (lib/willo-goals.js withSave).
  if (operation === "answer" && stock) {
    const told = withSave(prompt, stock, parts?.question, now);
    if (new TextEncoder().encode(told).length <= ANSWER_PROMPT_BYTES) prompt = told;
  }
  // "What do you know about me?" (LOR-666): what she keeps in it, counted here (lib/keeps-notebook.js keptSummary).
  if (help && book && asksWhatKept(parts.question)) {
    help += `\n- What you keep in their notebook now, counted for you (this character's page and the one for all of ` +
      `their characters): ${keptSummary(book.pages, book.reminders) || "nothing yet"}.`;
  }
  // Their goals (lib/willo-goals.js, LOR-665; Hero and up while plans are sold): lines under Goals in the notebook.
  // A question that sets, changes or drops one, or turns her check-ins off, gets the goals' tools (and the notebook
  // numbered, to name them by), and isn't looked up or looked at, like a note. How they stand is worked out here, on
  // this read, from what the add-on last saved (stock): THEIR GOALS, when the question bears on them or one's reached.
  const goalsOn = operation === "answer" && (!plansOn(env) || subscriber || trying);
  const haveGoals = goalsOn && Boolean(book?.pages?.some(p => /^#{1,6}\s+goals?\s*$/im.test(p.body || "")));
  const goalAsk = goalsOn ? goalIntent(parts.question, { have: haveGoals }) : null;
  const goalWrite = Boolean(goalAsk && writesGoals(goalAsk));
  if (goalWrite) [researchRequired, autoResearch, image] = [false, false, null];
  const talentResearch = operation === "answer" && !intent.write && !goalWrite &&
    needsTalentResearch(parts.question, parts.previousQuestion, dispute);
  const view = book ? notebookView(book.pages, { current, question: parts.question, spoken: Boolean(style),
    previous: `${parts.previousQuestion} ${parts.previous}`, reminders: book.reminders, offset,
    level: Number(parts.level) || null, now, intent: goalWrite ? { ...intent, read: true } : intent }) : null;
  if (view) view.places = await placing;
  // A clear, its yes or no, or "undo that", worked out on the pages read (lib/willo-notebook-manage.js): {noted} to
  // write, {undo: pages} to put back, or {answer}, her words for it. Reminders said and waiting are read for a clear of
  // reminders only.
  let managed = null;
  if (view && undoing) {
    const back = setReminder(view, parts.previous, now);
    const pages = back ? [] : undoPages(view, now, parts.previous);
    managed = back ? { noted: { page: back.page, op: { op: "unremind", reminders: [back] } } }
      : pages === null ? { answer: UNDO_ELSEWHERE }
      : pages.length ? { undo: pages } : { answer: tookReminder(parts.previous) ? REMINDER_GONE_LINE : NOTHING_TO_UNDO };
  } else if (view && bulking) {
    const reminders = /\breminders?\b/i.test(`${parts.question} ${parts.previous}`)
      ? await allReminders(env, app.user.id, now).catch(() => []) : [];
    managed = bulkReply(view, parts.question, parts.previous, reminders);
  }
  const reminding = intent.remind && (!plansOn(env) || features.reminders === true);
  // notebook_pin with the notebook's own tools, never beside its reminder or move tools (together they'd pass
  // lib/companion-answers.js ACTIONS_MAX_BYTES, and none would be offered). Asked to pin with no spot from the game,
  // nothing is written at all (not even a note without its place).
  // Asked to pin where they stand with the game's spot ("remember this spot", "mark this place"), only notebook_pin: the
  // notebook's own "remember" would take it as a plain note (the quality owner, 10/18: "Tucked into your notes:
  // Fargodeep Mine" 2 of 2).
  const pinOnly = pinning.add && spot && !intent.remind && !intent.move;
  const noteTools = !view || !intent.write || (pinning.add && !spot) ? [] : pinOnly ? pinTool(spot, pinning)
    : [...notebookTools(view, { move: intent.move, remind: reminding, adding: intent.adding, merge: intent.merge,
      relocate: intent.relocate }),
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
    voices: plan.voice?.choice || trying ? picksFor(request.headers.get("X-LF-Client"), withTrial(plan, trial)) : [],
    current: pickNamed(/^voice now: ([^(\n]+)/m.exec(state)?.[1]),
    key: freeKey(state), liveOff: /^live: (?:bad|warn)\b/m.test(state),
    fixable: /^\w+: (?:bad|warn), .*; fix: /m.test(state), spoken: Boolean(style), plans: plansOn(env),
    off: { live: /^live: off\b/m.test(state), sight: /\bseeing the game when asked out loud: off\b/.test(state) },
    sight: !plansOn(env) || features.sight,
    client: request.headers.get("X-LF-Client"), asked: helpAsked }) : [];
  // Live game info, offered once (the PM, 10/19, after the live check: most questions asked out loud came with no
  // zone): a question that needs where they are, with Live game info off in her window, gets its consent button
  // under her answer, the same explained yes as its first-use card, and the player turns it on there; never again
  // for this account, whatever they chose. Counted beside the model call, so no wait is added.
  // Not for their gear, bags or spells: Live game info doesn't show those (the vision check, 10/19).
  // A question about a quest from a player whose plan reads quest pages with no recording aloud in the giver's voice
  // (lib/companion-voice.js speakQuestPage, Champion and up and the first-run trial) gets the same button once, with the
  // line that says why (QUEST_READING_OFFER; Mike, 2026-10-21): with Live game info off the add-on tells her nothing of
  // the pages. Its own count, once ever, and in place of the plain offer for such a question.
  const questOffer = operation === "answer" && !help && !actions.length && /^live: off\b/m.test(state) &&
    (topicOf(parts.question) === "quest" || /\bquests?\b/i.test(parts.question)) && readsQuests(plan, trial)
    ? perPeriod(env, app.user.id, "quest-reading-offer", "once", 1) : null;
  const liveOffer = operation === "answer" && !help && !actions.length && !questOffer && /^live: off\b/m.test(state) &&
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
  const searchingBefore = !taken && !compact && !real && parts.previousQuestion && searchesBefore(parts.question);
  const subject = taken ? meant(parts) : searchingBefore
    ? { ...parts, question: `${parts.previousQuestion} (about: ${parts.previous.slice(0, 200)})`.slice(0, 600) }
    // A named talent correction keeps its new name, never the model's rejected talent names (LOR-721).
    : talentResearch && !/\btalents?\b/i.test(parts.question)
      ? { ...parts, question: `Talent guidance in WoW Forever: ${parts.question}` } : parts;
  const pressed = operation === "answer" && !real && !help &&
    (talentResearch || dispute === "correction" || pressedToLook(parts?.question));
  // A typed question the companion wants researched (research_required) that its facts answer (FOREVER FACTS,
  // travel and flights among them, QUEST AND NPC FACTS, ITEM FACTS, SPELL FACTS: the same "asked" that skips a spoken question's
  // quick look-up) is answered from them instead, on the ordinary model. Required research throws away an answer
  // without web sources ("what are the stats on the Arcanite Reaper?" came back "I'm not sure" with the facts right
  // there), and given the facts it stops searching and gets thrown away too. On the gold set's 28 typed research
  // questions (the accuracy lab, 10/16), 19 are covered: accuracy 80% and 78% -> 91% and 88%, a wrong claim in 18% and
  // 26% -> 11% and 14%, p50 4.5-5.6 s -> 1.1-1.3 s, $23-25 -> $9.20 per 1,000. Not when the player asks for a look
  // themselves, nor for what the facts don't hold (a quest's rewards, prices), nor when no covering fact has a source
  // to show.
  const fromFacts = operation === "answer" && researchRequired && !talentResearch && !real && !help && !pressedToLook(parts.question)
    && !NOT_IN_FACTS.test(parts.question) && factSources(known.facts.filter(f => f.asked)).length > 0;
  const lookOnline = !freePath;
  // A question about Willo herself never looks online, typed (research_required) or spoken: her help answers it.
  const wantsResearch = operation === "answer" && !help &&
    (researchRequired || ((autoResearch || real || talentResearch) && lookOnline));
  const longMemory = (Boolean(PLANS[plan.id]?.longMemory) || trying) && compact;
  // Looking it up (LOR-446). What another player's search found for the same question here answers without searching
  // again, for required research too. research "auto" (the companion asks for it with spoken questions) looks online
  // quickly only when the lore and Forever facts can't answer: a practical or current question or a correction that no
  // fact covers (lib/research-cache.js wantsSearch). Talent guidance also opts in on older typed clients: incidental
  // race/class facts don't verify talent mechanics. One it wouldn't look up gets no earlier finding either, so where
  // am I or a lore question never shows web sources. Forever facts never cover the player's own world: "the best
  // graphics card for WoW?" shares "best" and "WoW" with facts about Dalaran.
  const searchable = wantsResearch && !fromFacts &&
    (talentResearch || researchRequired || real || wantsSearch(parts.question, dispute, known.facts));
  let finding = searchable ? await cachedFinding(env, subject, now) : null;
  const cached = Boolean(finding);
  let research = researchRequired && !help && !finding && !fromFacts;
  let quick = searchable && !researchRequired && !finding;
  // A plan's answer is paid for, so it skips the shared monthly budget, and its cost is counted as theirs. A free
  // player's answer from friends, and one of Willo's best first, wait for the shared budget like the day's free answers.
  const paid = subscriber;
  // Past the plan's monthly cost cap, the answer goes back to the ordinary model and doesn't look online, until the
  // month ends. Nobody is cut off by it; a longer chat memory stays, since it's cheap. An answer that would look online
  // first holds what reserveAnswer reserves for it against that cap, in one statement
  // (lib/billing.js holdUserSpend), so questions asked at the same moment can't all get in under the cap; settle swaps
  // the hold for what the answer cost.
  let held = null;   // {id, micro}
  const upgrade = () => paid && (research || quick)
    ? answerReservation(research, operation, { lookup: quick, longMemory }) : 0;
  const holdCap = async () => {
    const micro = upgrade();
    if (!micro) return;
    const id = await holdUserSpend(env, app.user.id, micro, now, { cap: plan.costCapMicro, launch: Boolean(plan.launch) });
    if (id) held = { id, micro };
    else research = quick = false;
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
  // The free plan's best first and its trial's days have their own few (lib/best-first.js TASTE_LOOKUPS).
  if ((research || quick) && plansOn(env) && !exempt && !(subscriber
      ? await perPeriod(env, app.user.id, "companion-lookup", poolWindow(plan, now).key, plan.lookupsPerMonth || 0)
      : await takeTasteLookup(env, trying ? trial : null, now))) {
    research = quick = false;
    trailCold = true;
    await release(upgrade());
  }
  // What a free best-first answer may cost is held on the taste's daily cap (lib/best-first.js), and a look-up in the
  // trial's days: one that won't fit answers without looking online, as past the look-ups.
  let tasteHold = null;
  const tasteFree = (Boolean(taste) || trying) && !subscriber;
  if (tasteFree && (research || quick)) {
    tasteHold = await holdDay(env, answerReservation(research, operation,
      { lookup: quick, picture: seesPicture(operation, research, style, image, screenLook), lite, smarter: smartFor() }), now);
    if (!tasteHold) {
      [research, quick, trailCold] = [false, false, true];
      if (!exempt) await giveTasteLookup(env, trial);
    }
  }
  // What a best-first answer cost, on the taste's day (a free one's whole cost; a free Hero month's is Hero's), and that
  // it was one; given back, with its place, when it failed. In the trial's days after it, only the look-up's (look):
  // the answer itself is the free plan's.
  const tasted = (look, cost, ok) => (taste || tasteHold) && settleDay(env, tasteHold, !tasteFree ? 0 : taste ? look + cost
    : look, ok && taste ? { answers: 1, ...(taste.used === 1 ? { starts: 1 } : {}) } : {}, now);
  // A paying player's customization, or the trial's (customizing, above), as the plan allows it now. The free plan's
  // answers get LORE_FOCUS instead, while plans are on.
  let custom = { system: "", tale: false };
  if (customizing) custom = blocksOf(await customizing, allowedFor(plan, trial), { operation });
  if (freePath && operation === "answer") custom = { system: LORE_FOCUS, tale: false };
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
  // One of Willo's best first is on the free pool too (lib/free-pool.js; Mike, 10/22), and its daily cap on top
  // (lib/best-first.js): it waits for the pool's stop as the day's free answers do.
  // Not past the text cap (lite), nor for required research (it searches instead).
  mull = !lite && !research && await thoughtsLeft;
  const reserved = await reserveAnswer(env, now, research, operation, quick,
    { paid, longMemory, picture: seesPicture(operation, research, style, image, screenLook), lite,
      smarter: smartFor(), mull });
  if (!reserved) {
    // What it took (the plan's day and month, or an answer from friends) goes back for a question that never reached the
    // model, and a best-first one. The free pool's stop for today (lib/free-pool.js), past its soft step, is reached:
    // in her words, in the world, it comes back with the next day's slice (the companion says these as they are, since
    // they speak of her light, and the add-on's lore library answers meanwhile, as for any 429 an older Willo knows).
    await giveBack();
    await Promise.all([taste && returnTaste(env, taste), tasted(0, 0, false)]);
    return tooMany(CROWDED, untilTomorrow(now), await allowance(env, app.user.id, now, exempt, plan));
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
  let sighting = null;   // the trial's picture taken for this answer (below)
  // The reply's allowance with this answer's picture among the trial's (took: it was counted), read alongside the count,
  // so it may or may not have it yet: never more than one fewer than the trial had before this answer.
  const seen = (left, took) => {
    const sight = left?.trial?.uses?.sight;
    if (!took || !sight) return left;
    const n = Math.max(0, Math.min(sight.left, trial.left.sight - 1));
    return { ...left, trial: { ...left.trial, uses: { ...left.trial.uses, sight: { ...sight, left: n } } },
             ...(left.features && !n ? { features: { ...left.features, sight: false } } : {}) };
  };
  // The answer, kept KEEP_DAYS for the nightly check while the player's switch is on (keep, above); never a
  // compaction. Written while the reply goes out (waitUntil), so it never holds it up; logAnswer never throws.
  // Snapshot consent before starting the model request; a later opt-in is never retroactive.
  const imageConsent = keep && image && storageReady(env)
    ? diagnosticConsent(env, app.user.id).catch(() => null) : Promise.resolve(null);
  // When her first words went out ahead of the rest (two layers), for first_ms; else they came with the whole answer.
  let firstWordAt = null;
  const keepAnswer = async entry => {
    if (!keep || compact) return;
    // colo: the Cloudflare data centre that served it ("LHR"), so first words can be read by region (the Architect,
    // 10/24: Willo's answers on Together are judged by EU and AU first words against Flash-Lite's).
    const kept = logAnswer(env, app.user.id, { operation, npc, spoken: Boolean(style), zone: parts.zone,
      sub: parts.sub, question: parts.question, feedback: dispute, ref: answerId, total_ms: Date.now() - started,
      first_ms: (firstWordAt ?? Date.now()) - started, colo: request.cf?.colo,
      ctx: { race: parts.race, class: parts.class, level: parts.level, faction: parts.faction, target: parts.target },
      plan: planLabel(plan), ...entry }, { names, now });
    if (context.waitUntil) {
      context.waitUntil(kept);
      if (entry.outcome === "answered" && entry.model !== "site" && seesPicture(operation, research, style, image, screenLook)) {
        context.waitUntil(kept.then(async saved => {
          const consent = await imageConsent;
          if (saved && consent) await registerScreenshot(env, app.user.id, answerId, image, { consent });
        }).catch(() => {}));
      }
    } else await kept;
  };
  try {
    // The allowance the reply carries is read while the answer is written (LOR-654): this answer's count is in already;
    // its cost, settled afterwards, shows from the next one. The trial's picture (lib/best-first.js TRIAL.sight) is
    // counted as it goes with the answer, alongside, and the reply's allowance shows it (seen, below) whichever came
    // first; a failed answer gives it back.
    sighting = image && !subscriber && trying ? tryOnce(env, trial.claim, "sight", now).catch(() => false) : null;
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
    if (searchingBefore) {
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
      names: [parts.zone, parts.sub, parts.target], savedPlace: parts.savedPlace, lastPlace: placeOf(parts, away) });
    const early = layered && !actions.length && !clearing && !dropping.length && !goalText && !goalInfo.reached.length
      && !intent.read && !intent.write && !intent.remind && !intent.move && !pinning.add && !pinning.read
      && !pinning.manage && !pinning.list && !pinning.clearAll
      && !(view && (view.block || asksReminders(parts.question, intent) || saidYes(parts.question, parts.previous)));
    let said = null;
    // Spoken words that claim a note or pin written, with nothing to write it with, never go out early (NOTE_CLAIM).
    const onSay = early ? say => {
      if (NOTE_CLAIM.test(say)) return;
      said = guarded(say);
      hold.say?.(said);
      firstWordAt ??= Date.now();
    } : null;
    const siteSays = listing || (managed ? managed.answer || " " : "");
    const { model_ms, counted, call, say: modelSay, route, ...result } = siteSays ? await Promise.resolve(loggedFirst).then(() => ({
      answer: siteSays, sources: [], web_sources: [], web_search: { status: "not_needed", queries: [], suggestions_html: "" },
      model: "site", usage: null, model_ms: 0, counted: 0 }))
      : await (stubbed(env, request, app.user) ? stubAnswer : writeAnswer)(env, prompt, now, research, operation,
        { persona, style, image, closeup, closeupOf, look: screenLook, facts: knowledgeText, help, dispute, custom: custom.system, memories: remembering ? await remembering : "", longMemory, actions,
          later, layered, onSay, lite, smarter: smartFor(), mull, onMull: takeThought,
          away: away && (parts.zone || parts.sub || parts.savedPlace ? "last" : "none") })
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
    const noted = managed ? managed.noted || null : cleared ? cleared.noted || null : goalCalled?.op ? goalCalled
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
    if (managed?.answer) result.answer = managed.answer;
    // "Undo that": the page (or the two a move changed) as it was before its last change, if nothing's changed it since.
    if (managed?.undo) {
      const undone = [];
      for (const u of managed.undo) {
        const back = await undoPage(env, app.user.id, u.page, u.version, now).catch(e => {
          console.warn(`companion answer: undo: ${e?.message || e}`);
          return null;
        });
        // The first page that can't be undone stops the rest: never half a move.
        if (!back) break;
        undone.push({ ...u, view: back });
      }
      if (undone.length) {
        notebook = { change: "update", did: "undo", ...undone[0].view, changed: [],
          ...(undone.length > 1 ? { also: undone.slice(1).map(u => u.view) } : {}) };
        result.answer = undoLine(undone);
      } else result.answer = "That page has changed since, so there's nothing to undo.";
    }
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
          result.answer = noted.bulk ? bulkLine(noted.bulk, planned.changed)
            : withRest(reminderLine(noted.op, offset, now), result.answer);
        }
      }
    }
    else if (noted && (noted.ops || noted.op?.op === "relocate")) {
      // Over two pages: a clear of both, or lines moved to the other page (lib/willo-notebook-manage.js), each page
      // written in turn. A move writes the lines onto the other page first, so a failed write never loses them.
      const steps = noted.ops || relocateOps(noted).reverse();
      const done = [];
      let failed = null;
      for (const step of steps) {
        const planned = plannedChange(view, app.user.id, step, now);
        if (!planned.page) {
          if (planned.full) { failed = FULL_LINE; break; }
          continue;
        }
        const saved = await planned.write(env).catch(e => {
          console.warn(`companion answer: notebook write: ${e?.message || e}`);
          return null;
        });
        if (!saved) { failed = UNSAVED_LINE; break; }
        done.push({ step, saved, changed: planned.changed });
      }
      const moved = noted.op?.op === "relocate";
      const changed = done.filter(d => moved ? d.step.op.op === "receive" : true).flatMap(d => d.changed);
      // Willo's app (0.23.0 and before) knows add, check, update, remove and move: a move to the other page goes as
      // "move", on the page it left (its Undo then puts it back there, never losing it); did says what it was.
      if (done.length) notebook = { change: moved ? "move" : noted.op.op, ...(moved ? { did: "relocate" } : {}), ...done[done.length - 1].saved,
        changed, ...(done.length > 1 ? { also: done.slice(0, -1).map(d => d.saved) } : {}) };
      result.answer = failed && !changed.length ? failed : !changed.length ? NOT_FOUND_LINE
        : moved ? relocateLine(noted.op.to, changed) : bulkLine(noted.bulk, changed);
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
          // A merge goes to Willo's app as the change it knows ("update"); did says what it was.
          notebook = { change: noted.op.op === "merge" ? "update" : noted.op.op, ...(noted.op.op === "merge" ? { did: "merge" } : {}),
            ...saved, changed: planned.changed };
          // Goals taken off with the notebook's own tool are dropped goals, in her goals' words.
          const dropped = noted.op.op === "remove" ? noted.op.targets.map(t => goals.find(g => g.page === noted.page
            && typeof t.raw === "string" && g.raw.trim() === t.raw.trim())) : [];
          result.answer = noted.bulk ? bulkLine(noted.bulk, planned.changed)
            : noted.pin ? pinnedLine(result.answer, noted.pin)
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
      result.answer = withoutGoalClaims(result.answer, planLine(goals, stock, { question: parts.question, stale: goalInfo.stale === true, ...here }));
    // The wrong-number guard: an answer about their goals that says a gold amount nothing she was given holds (a price
    // remembered from the original game, a sum of her own) says the plan's own line instead.
    if (goalText && result.answer && wrongGold(result.answer, new Set([...numbersIn(knowledgeText, parts.question),
      ...goalInfo.numbers]))) {
      const line = planLine(goals, stock, { asked: goalCalled?.goal || goalInfo.asked, question: parts.question, stale: goalInfo.stale === true, ...here });
      if (line) result.answer = notebook && noted?.goal ? goalConfirmed(line, noted.goal, noted.op) : line;
    }
    // Nothing written, and her own words say she wrote it down (any question, notebook in play or not): never.
    // A question about what she wrote before ("where did you write that down?", "what's on my list?") may say she wrote it.
    if (operation === "answer" && !notebook && !goalsReply && result.answer === fromModel && NOTE_CLAIM.test(result.answer)
      && !asksWhereNotes(parts.question) && !(intent.read && !intent.write))
      result.answer = notWritten(result.answer);
    if (!compact && !result.answer && !action) throw new Error("Empty answer");
    if (action && (!result.answer || SAYS_DONE.test(result.answer))) result.answer = offerInstead(result.answer, action);
    // Her spoken words (layered): what she said already, or the model's own while the answer is still its words; with
    // other words in the answer, none, and the app says the start of the written answer, as it did before.
    const ownWords = result.answer === fromModel;
    if (layered && (said || (ownWords && modelSay))) result.say = said ?? guarded(modelSay);
    // About their goals from a save older than STALE_SECONDS, or from the site's keeping of the last one (the phone's
    // answers: stock.fromSave): her numbers as of that save (asOfSave), out loud or written.
    if (goalText && goalInfo.stale && (style || stock?.fromSave)) for (const k of ["answer", "say"]) if (result[k]) result[k] = asOfSave(result[k]);
    if (said && !ownWords) console.warn("companion answer: her spoken words went out before the site changed the answer");
    // Last checks, in code (lib/willo-guards.js): no map coordinates nothing supplied gives, "your people" in Willo's
    // own words, names spelled as the game spells them. Her own earlier answers are no evidence (evidenceOf).
    const supplied = [evidenceOf(prompt, parts?.question), knowledgeText, help].join("\n");
    if (!compact && result.answer && result.answer !== VERIFICATION_FAILED)
      result.answer = guardAnswer(result.answer, { supplied, own: operation === "answer", researched: research, prompt,
        question: parts.question, names: [parts.zone, parts.sub, parts.target], savedPlace: parts.savedPlace, lastPlace: placeOf(parts, away),
        character: operation === "character" });
    // Two layers: the written answer adds only names and numbers what she was given holds (groundedWritten). No line
    // about the rest any more (Mike, 2026-10-21: "it should always just read everything from now on"): the
    // app says her first words, then the rest of the written answer (lib/billing.js PLAN_VOICE whole).
    // A hard question thought through (route "mulled") keeps the numbers it worked out, its names still checked (the
    // Software Architect, 10/24: watch the first week's answer_feedback on mulled rows).
    if (result.say && ownWords && result.answer && result.answer !== VERIFICATION_FAILED)
      result.answer = groundedWritten(result.answer, result.say, supplied, { numbers: route !== "mulled" });
    if (!action && (questOffer || liveOffer) && result.answer && result.answer !== VERIFICATION_FAILED && await (questOffer || liveOffer)) {
      action = { id: "live_game_info", args: {}, label: "Turn on Live game info…" };
      // Its line goes on the written answer, and also on its own (offer_line): the app shows it under her words with
      // its button, and leaves it out of what she reads aloud (LOR-777: the offer was read out with the answer).
      result.offer_line = questOffer ? QUEST_READING_OFFER : offerLine(action);
      result.answer = `${result.answer} ${result.offer_line}`;
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
    if (taste || tasteHold) {
      const kept = tasted(lookCost, counted || 0, true);
      if (context.waitUntil) context.waitUntil(kept); else await kept;
    }
    const left = seen(await leaving, sighting && await sighting);
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
      ...(view?.block ? ["notebook"] : []), ...(goalText ? ["goals"] : []), ...(image ? ["sight"] : []), ...(unpointed ? ["unpointed"] : []),
      ...(help ? ["help", ...(state ? ["state"] : []), ...(usage ? ["answers_left"] : [])] : [])];
    // "empty": it looked and found nothing; "off": the companion asked and the rule would look, but the plan (the free
    // plan never looks online), its month's look-ups or the day's budget said no. The nightly check tells those apart
    // from a question the rule let go (LOR-627: 42 of 42 kept answers said "no").
    const offline = !research && !quick && !cached && !fromFacts && operation === "answer" && !help &&
      (talentResearch || real || (askedToLook && wantsSearch(parts.question, dispute, known.facts)));
    const lookedUp = cached ? "cached" : research ? "required" : fromFacts ? "facts" : looked ? "quick"
      : quick ? "empty" : offline ? "off" : "no";
    // Of the notebook, only which of its tools ran, never what's in it (a to-do the site wrote itself: notebook_add; a
    // goal the site kept by the words: goal_set).
    await keepAnswer({ answer: result.answer, say: typeof result.say === "string" && result.say !== result.answer
      ? result.say : undefined, action: action?.id || (notebook ? (noted?.goal ? "goal_set"
      : /^(?:notebook_|goal_)/.test(call?.name || "") ? call.name : "notebook_add") : goalsReply ? "goal_checkins" : undefined),
      model: result.model,
      model_ms, looked_up: lookedUp,
      // "together-fallback": Together failed before her first words and Gemini answered; "together-breaker": Together's
      // breaker was open, so Gemini answered without trying it (lib/together.js). A hard question's route
      // (lib/companion-answers.js writeAnswer): "mulled", "mull-fallback" or "mull-spent".
      lookups: [...used, ...(!image && operation === "answer" && UNSEEN.test(result.answer || "") ? ["unseen"] : []),
        ...(result.fellBack ? ["together-fallback"] : []), ...(result.skipped ? ["together-breaker"] : []),
        ...(route ? [route] : [])],
      facts: facts.map(f => f.title), outcome: result.answer === VERIFICATION_FAILED ? "unverified" : "answered" });
    // A real answer activates the friend a share link brought (lib/referrals.js activateReferral: their inviter moves on)
    // and notes Willo's computer; after the reply is on its way, never holding it up. Most accounts skip it unread.
    if (!compact && result.answer !== VERIFICATION_FAILED) await afterwards(machineOf(request).then(machine =>
      activateReferral(env, { userId: app.user.id, deviceId: app.device?.id, machine }, now)).catch(e =>
      console.warn(`companion answer: referral: ${e?.message || e}`)));
    // The free pool's 50% and 80% alerts (lib/free-pool.js checkAlerts: at most once a minute here), after the reply.
    if (!paid) {
      const alerting = checkAlerts(env, now);
      if (alerting) await afterwards(alerting);
    }
    // answer_id: this answer's id, for the app to send back with a report on it or with the next question.
    return Response.json({ ok: true, ...result, allowance: left, timing: { model_ms, total_ms: Date.now() - started },
      ...(answerId ? { answer_id: answerId } : {}),
      ...(compact ? {} : { forever_facts: facts.map(f => f.title), lookups: used, looked_up: lookedUp }),
      ...(action ? { action } : {}), ...(notebook ? { notebook } : {}), ...(goalsReply ? { goals: goalsReply } : {}),
      ...(dispute ? { feedback: dispute } : {}), ...(custom.tale ? { tale: true } : {}) }, { headers: noStore });
  } catch (e) {
    await settle(e?.counted);
    // A failed answer gives back what it took (the plan's day and month, or its answer from friends): it's for answers, not
    // attempts. A best-first one too.
    await giveBack();
    await Promise.all([taste && returnTaste(env, taste), tasted(lookCost, e?.counted || 0, false),
      sighting && sighting.then(took => took && untry(env, app.user.id, "sight")).catch(() => {})]);
    console.warn(`companion answer: ${e?.message || e}`);
    await keepAnswer({ outcome: "failed", error: String(e?.message || e) });
    return failed(e, answerId);
  }
}
