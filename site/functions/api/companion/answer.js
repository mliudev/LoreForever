// Account-linked companion answers. The site owns the key and pays for a small daily allowance; a player's plan
// (lib/billing.js) gives more. Answers can't be bought: once a plan's are gone (and a free player's starter), Willo
// answers from the add-on's lore library until they come back.
import { setup, fail, noStore } from "../../../lib/accounts.js";
import { currentDevice } from "../../../lib/devices.js";
import { perDay, perPeriod } from "../../../lib/ratelimit.js";
import { markAsked } from "../../../lib/activity.js";
import { allowance, reserveAnswer, answerReservation, writeAnswer, lookUp, uncapped, personaOf, styleOf,
  COMPACTIONS_PER_DAY, ANSWER_PROMPT_BYTES, ANSWER_IMAGE_CHARS, LORE_FOCUS, TRAIL_COLD, CUSTOM_PROMPT_BYTES }
  from "../../../lib/companion-answers.js";
import { promptParts, knowledgeFor } from "../../../lib/forever-knowledge.js";
import { feedbackKind, logFeedback } from "../../../lib/answer-feedback.js";
import { cachedFinding, keepFinding, findingBlock, wantsSearch, realWorld } from "../../../lib/research-cache.js";
import { helpBlock, helpTopics, stateOf } from "../../../lib/willo-help.js";
import { lookupsFor, actionsFor, actionOf, offerInstead, freeKey, SAYS_DONE } from "../../../lib/willo-tools.js";
import { WILLO_PICKS } from "../../../lib/companion-voice.js";
import { planFor, plansOn, holdUserSpend, releaseUserSpend, addUserSpend, useStarter, returnStarter, offersFor,
  poolWindow, overTextCap, companionFeatures, PLANS } from "../../../lib/billing.js";
import { promptBlocks, NPC_KEY } from "../../../lib/willo-custom.js";

const CLIENT = /^companion\/[\w.-]{1,24}$/;
const MAX_BODY_BYTES = 64 * 1024; // JSON escaping can expand a valid 16 KB Unicode prompt.
// A spoken question may also carry a picture (base64, a byte per character); the rest of the body keeps MAX_BODY_BYTES.
const MAX_PICTURE_BODY_BYTES = MAX_BODY_BYTES + ANSWER_IMAGE_CHARS;
// offers: the plan the player could move up to for more answers (lib/billing.js offersFor), only when there's one.
const tooMany = (error, retryAfter, allowance, offers = []) => Response.json({ ok: false, error, retryAfter, allowance,
  ...(offers.length ? { offers } : {}) }, { status: 429, headers: { ...noStore, "Retry-After": String(retryAfter) } });
const untilReset = (left, now) => Math.ceil((Date.parse(left.resetsAt) - now.getTime()) / 1000);
const untilTomorrow = now => Math.ceil((Date.parse(now.toISOString().slice(0, 10) + "T00:00:00Z") + 86400e3 - now.getTime()) / 1000);
const dateOf = iso => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

// The plan's answers are gone, today's or the month's (the allowance's period), and a free player's starter too: the
// 429, with the plan above theirs for the companion's own buttons (Free's is Hero; Legend's is nothing). Its words
// become the start of the add-on's lore-library answer (companion/lore_companion/answer.py offline_answer, which goes
// on "Until then, here's what the lore library says."), so they're Willo's, in the world, and only say when live
// answers come back, never what to buy (Mike, 2026-10-13). capped: the plan's month of answers cost its text cap
// (lib/billing.js overTextCap): the month's words, and nothing offered. While plans are off it says what it said
// before plans.
async function outOfAnswers(env, userId, plan, now, exempt, capped = false) {
  const left = await allowance(env, userId, now, exempt, plan);
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
// stops counting after lib/billing.js HOLD_SECONDS.
export async function onRequest(context) {
  const hold = { release: async () => {} };
  const work = answerQuestion(context, hold)
    .finally(() => hold.release().catch(e => console.warn(`companion answer: hold: ${e?.message || e}`)));
  context.waitUntil?.(work.catch(() => {}));
  return work;
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
  let prompt, operation, researchRequired, persona, style, image, autoResearch, npc, dataVersion;
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
  const now = new Date();
  const compact = operation === "compact";
  // What WoW Forever changed, for this question and place (LOR-446), looked up while the allowance is checked.
  const parts = compact ? null : promptParts(prompt);
  const knowledge = compact ? null : knowledgeFor(env, parts, { character: operation === "character", dataVersion });
  // Mike's own and test accounts skip the daily answer cap; the monthly budget below still applies to them.
  const exempt = await uncapped(env, app.user.id);
  // The plan sets the daily answers; a paying player skips the shared monthly budget and has a cost cap instead.
  const plan = await planFor(env, app.user.id, now);
  const subscriber = plan.id !== "free";
  // Willo's daily and weekly players (lib/activity.js markAsked, LOR-524): every question counts, answered or not.
  if (!compact) {
    const asked = markAsked(env, app.user.id, now.getTime());
    if (context.waitUntil) context.waitUntil(asked); else await asked;
  }
  // The free plan, while plans are on (Mike, 2026-10-12): its answers stay with the world's lore (LORE_FOCUS below),
  // without looking online or the game picture. Willo still speaks in its own voice (style "spoken" stays).
  if (plansOn(env) && !subscriber) [researchRequired, autoResearch, image] = [false, false, null];
  // pack: the free plan's starter, when this answer comes out of it (the day's plan answers are gone).
  let pack = null;
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
    // A paying player whose answers this month cost half their plan's net (lib/billing.js overTextCap) has none of the
    // plan's left until the next month: the lore library answers.
    const pool = plansOn(env) && plan.answersPerMonth ? poolWindow(plan, now) : null;
    const capped = plansOn(env) && await overTextCap(env, app.user.id, plan, now);
    const planned = !capped && await perDay(env, app.user.id, "companion-answer", plan.answersPerDay, now)
      && (!pool || await perPeriod(env, app.user.id, "companion-month", pool.key, plan.answersPerMonth));
    // A starter answer is taken in one statement, so a question asked at the same moment can't spend the same answer;
    // one that finds the last one gone is out of answers.
    if (!planned && !(plansOn(env) && !subscriber && (pack = await useStarter(env, app.user.id))))
      return outOfAnswers(env, app.user.id, plan, now, exempt, capped);
  }
  // A player saying the last answer was wrong, or losing patience: Willo is told not to argue, and it comes back to us
  // (lib/answer-feedback.js) with what was asked and answered. A character's reply is in character, so not counted.
  const dispute = operation === "answer" ? feedbackKind(parts.question, parts.previous) : null;
  const known = knowledge ? await knowledge : { facts: [], block: "" };
  const stronger = Boolean(PLANS[plan.id]?.stronger);
  // The site's look-ups for this question (lib/willo-tools.js lookupsFor, LOR-546). A question about Willo herself:
  // her own help, what her app says of itself right now and, about plans, the answers left, never a look online.
  const lookups = compact ? [] : lookupsFor(parts.question, { previous: parts.previousQuestion, persona, operation,
    plans: plansOn(env) });
  const usage = lookups.includes("answers_left") ? await allowance(env, app.user.id, now, exempt, plan) : null;
  const help = lookups.includes("help") ? helpBlock(parts.question, { plans: plansOn(env), plan: plan.name,
    client: request.headers.get("X-LF-Client"), state, usage }) : "";
  // What her answer may offer to do for them (lib/willo-tools.js actionsFor, LOR-546 slice 2), by what the question
  // asks of her: her voices only where the plan picks one, never the one she speaks in now (WILLO STATE's "voice now"),
  // a talk key only the one her own check found free, and "Willo and the game" when her check says Live game info is off.
  // Consent (slice 3): Live game info or seeing the game, only when it's off in her window, and seeing the game only on
  // a plan with it (lib/billing.js companionFeatures).
  const actions = help ? actionsFor(helpTopics(parts.question, { plans: plansOn(env) }), {
    voices: plan.voice?.choice ? Object.keys(WILLO_PICKS) : [], current: /^voice now: (\w+)/m.exec(state)?.[1] || "",
    key: freeKey(state), liveOff: /^live: (?:bad|warn)\b/m.test(state),
    fixable: /^\w+: (?:bad|warn), .*; fix: /m.test(state), spoken: Boolean(style), plans: plansOn(env),
    off: { live: /^live: off\b/m.test(state), sight: /\bseeing the game when asked out loud: off\b/.test(state) },
    sight: !plansOn(env) || companionFeatures(plan).sight }) : [];
  // The player's own world (their graphics card, the game's settings, addons, prices: lib/research-cache.js realWorld)
  // goes stale, so it looks online typed too, not only spoken (research "auto"), where the free plan would (LOR-545).
  // A short follow-up to one ("I'm in Seattle") is looked up with the question before it.
  const real = lookups.includes("web");
  const lookFor = !real ? "" : realWorld(parts.question) ? parts.question : `${parts.previousQuestion} (${parts.question})`;
  const lookOnline = !(plansOn(env) && !subscriber);
  const wantsResearch = operation === "answer" && (researchRequired || ((autoResearch || real) && lookOnline && !help));
  let strong = stronger && !compact;
  const longMemory = Boolean(PLANS[plan.id]?.longMemory) && compact;
  // Looking it up (LOR-446). What another player's search found for the same question here answers without searching
  // again, for required research too. research "auto" (the companion asks for it with spoken questions) looks online
  // quickly only when the lore and Forever facts can't answer: a practical or current question or a correction that no
  // fact covers (lib/research-cache.js wantsSearch). One it wouldn't look up gets no earlier finding either, so where
  // am I or a lore question never shows web sources. Forever facts never cover the player's own world: "the best
  // graphics card for WoW?" shares "best" and "WoW" with facts about Dalaran.
  const searchable = wantsResearch && (researchRequired || real || wantsSearch(parts.question, dispute, known.facts));
  let finding = searchable ? await cachedFinding(env, parts, now) : null;
  const cached = Boolean(finding);
  let research = researchRequired && !finding;
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
  if ((research || quick) && plansOn(env) && !exempt && !(await perPeriod(env, app.user.id, "companion-lookup",
      poolWindow(plan, now).key, plan.lookupsPerMonth || 0))) {
    research = quick = false;
    trailCold = true;
    await release(upgrade());
  }
  // A paying player's customization (lib/willo-custom.js): Willo's style, or their tale of the character. A failure to
  // read it gives an ordinary answer. The free plan's answers get LORE_FOCUS instead, while plans are on.
  let custom = { system: "", tale: false };
  if (subscriber) {
    try { custom = await promptBlocks(env, app.user.id, plan, { operation, npc }); }
    catch (e) { console.warn(`companion answer: customization: ${e?.message || e}`); }
  } else if (plansOn(env) && operation === "answer") custom = { system: LORE_FOCUS, tale: false };
  const coldTrail = system => {
    const cold = [system, TRAIL_COLD].filter(Boolean).join("\n\n");
    return new TextEncoder().encode(cold).length <= CUSTOM_PROMPT_BYTES ? cold : system;
  };
  if (trailCold) custom = { ...custom, system: coldTrail(custom.system) };
  const reserved = await reserveAnswer(env, now, research, operation, quick, { paid, strong, longMemory });
  if (!reserved) {
    // A starter answer taken for a question that never reached the model goes back.
    if (pack) await returnStarter(env, pack.id);
    return tooMany("We're at capacity for free live answers right now. Try again next month.",
      86400, await allowance(env, app.user.id, now, exempt, plan));
  }
  // Kept while the answer is written; logFeedback never throws.
  const logged = dispute && logFeedback(env, app.user.id, { kind: dispute, said: parts.question,
    question: parts.previousQuestion, answer: parts.previous, zone: parts.zone, sub: parts.sub, persona,
    spoken: Boolean(style) });
  // A paid-for answer's cost goes on the player's month (lib/billing.js addUserSpend), once: what the quick look online
  // and the answer cost, as lib/companion-answers.js counts them, whether the answer came or not. It takes the place of
  // what the answer held against its cap. The beta's free Hero's is kept apart (launch).
  let lookCost = 0, settled = !paid;
  const settle = async counted => {
    if (settled) return;
    settled = true;
    await addUserSpend(env, app.user.id, lookCost + (counted || 0), now, held?.id, Boolean(plan.launch));
    held = null;
  };
  try {
    // The quick look online writes a finding first (companion-answers.js lookUp), kept for the next player; the answer
    // is then written from it. Without one (no evidence, too slow) it's answered as it would have been.
    const look = quick ? await lookUp(env, real ? { ...parts, question: lookFor } : parts, now, { real }) : null;
    lookCost = look?.counted || 0;
    const looked = look?.found;
    if (looked) {
      finding = { answer: looked.answer, sources: looked.web_sources, created: now.toISOString() };
      await keepFinding(env, parts, looked.answer, looked.web_sources, now);
    } else if (real && quick) {
      // A look at the player's own world that found nothing (Flash-Lite skips the search about 1 time in 9): the plain
      // line about the very latest, never last year's graphics cards as today's.
      custom = { ...custom, system: coldTrail(custom.system) };
    }
    // Required research searches instead (companion-answers.js systemPrompt), so it gets no facts.
    // ...and a question about the player's own world gets none either: Forever facts never answer it (above).
    // A question about Willo herself gets none either: her help answers it, and facts about Westfall only get in its way.
    const facts = research || real || help ? [] : known.facts;
    const knowledgeText = [research || real || help ? "" : known.block, findingBlock(finding)].filter(Boolean).join("\n\n");
    const { model_ms, counted, call, ...result } = await writeAnswer(env, prompt, now, research, operation,
      { persona, style, image, facts: knowledgeText, help, dispute, custom: custom.system, strong, longMemory, actions })
      .finally(() => logged);
    await settle(counted);
    // The one action her answer offers, checked against what was offered; never run here. An offer that came without
    // words gets a line of hers that offers it, and one with words saying it's done already loses those words for it.
    const action = actionOf(call, actions);
    if (!compact && !result.answer && !action) throw new Error("Empty answer");
    if (action && (!result.answer || SAYS_DONE.test(result.answer))) result.answer = offerInstead(result.answer, action);
    if (finding) {
      result.web_sources = finding.sources;
      result.web_search = looked ? looked.web_search : { status: "searched", queries: [], suggestions_html: "" };
    } else if (research && !custom.system && result.web_search?.status === "searched" && result.web_sources?.length) {
      // Kept for other players only when written without this player's own style or tale.
      await keepFinding(env, parts, result.answer, result.web_sources, now);
    }
    const left = await allowance(env, app.user.id, now, exempt, plan);
    // timing: where the time went, in whole milliseconds (the companion logs it). forever_facts: the titles of the
    // Forever facts the answer was given; feedback: what we kept of this message ("correction", "frustration");
    // looked_up: "required", "quick" (research "auto" looked online and found something), "cached" (an earlier
    // search's finding) or "no". tale: the reply used the player's own tale, which the companion marks on it.
    // lookups: the site's look-ups the answer was written with (lib/willo-tools.js LOOKUPS), for the companion's log.
    // action: what the answer offers to do, {id, args, label} (lib/willo-tools.js ACTIONS), for Willo's app to show as a
    // button and run on a tap; only with an answer of hers about herself.
    const used = [...(facts.length ? ["forever_facts"] : []), ...(cached || research || looked ? ["web"] : []),
      ...(help ? ["help", ...(state ? ["state"] : []), ...(usage ? ["answers_left"] : [])] : [])];
    return Response.json({ ok: true, ...result, allowance: left, timing: { model_ms, total_ms: Date.now() - started },
      ...(compact ? {} : { forever_facts: facts.map(f => f.title), lookups: used,
        looked_up: cached ? "cached" : research ? "required" : looked ? "quick" : "no" }),
      ...(action ? { action } : {}),
      ...(dispute ? { feedback: dispute } : {}), ...(custom.tale ? { tale: true } : {}) }, { headers: noStore });
  } catch (e) {
    await settle(e?.counted);
    // A failed answer gives its starter answer back: it's for answers, not attempts.
    if (pack) await returnStarter(env, pack.id);
    console.warn(`companion answer: ${e?.message || e}`);
    return fail(502, "Couldn't get a live answer just now. Try again in a moment.");
  }
}
