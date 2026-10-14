// Account-linked companion answers. The site owns the key and pays for a small daily allowance; a player's plan
// (lib/billing.js) gives more, and top-ups more again once the day's plan answers are gone.
import { setup, fail, noStore } from "../../../lib/accounts.js";
import { currentDevice } from "../../../lib/devices.js";
import { perDay, perPeriod } from "../../../lib/ratelimit.js";
import { allowance, reserveAnswer, answerReservation, writeAnswer, lookUp, uncapped, personaOf, styleOf,
  COMPACTIONS_PER_DAY, ANSWER_PROMPT_BYTES, ANSWER_IMAGE_CHARS, LORE_FOCUS } from "../../../lib/companion-answers.js";
import { promptParts, knowledgeFor } from "../../../lib/forever-knowledge.js";
import { feedbackKind, logFeedback } from "../../../lib/answer-feedback.js";
import { cachedFinding, keepFinding, findingBlock, wantsSearch } from "../../../lib/research-cache.js";
import { planFor, plansOn, holdUserSpend, releaseUserSpend, addUserSpend, topupFor, useTopup, returnTopup, offersFor,
  dayMax, poolWindow, PLANS } from "../../../lib/billing.js";
import { promptBlocks, NPC_KEY } from "../../../lib/willo-custom.js";

const CLIENT = /^companion\/[\w.-]{1,24}$/;
const MAX_BODY_BYTES = 64 * 1024; // JSON escaping can expand a valid 16 KB Unicode prompt.
// A spoken question may also carry a picture (base64, a byte per character); the rest of the body keeps MAX_BODY_BYTES.
const MAX_PICTURE_BODY_BYTES = MAX_BODY_BYTES + ANSWER_IMAGE_CHARS;
// offers: what the player could buy for more answers (lib/billing.js offersFor), only when there's something.
const tooMany = (error, retryAfter, allowance, offers = []) => Response.json({ ok: false, error, retryAfter, allowance,
  ...(offers.length ? { offers } : {}) }, { status: 429, headers: { ...noStore, "Retry-After": String(retryAfter) } });
const untilReset = (left, now) => Math.ceil((Date.parse(left.resetsAt) - now.getTime()) / 1000);
const untilTomorrow = now => Math.ceil((Date.parse(now.toISOString().slice(0, 10) + "T00:00:00Z") + 86400e3 - now.getTime()) / 1000);
const dateOf = iso => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

// The plan's answers are gone, today's or the month's (the allowance's period), and there's no top-up left: the 429,
// with what's for sale. While plans are off it says what it said before plans.
async function outOfAnswers(env, userId, plan, now, exempt) {
  const [left, offers] = await Promise.all([allowance(env, userId, now, exempt, plan), offersFor(env, userId, plan, now)]);
  const more = offers.some(o => o.id === "topup") ? " Top-ups and plans are on loreforeverwow.com/plans." : "";
  const used = !plansOn(env) ? `today's ${plan.answersPerDay} free answers. They come back tomorrow.`
    : left.period === "month" ? `this month's ${left.limit} live answers. They come back on ${dateOf(left.resetsAt)}.`
    : `today's ${left.limit} live answers. They come back tomorrow.`;
  return tooMany(`You've used ${used}${plansOn(env) ? more : ""}`, untilReset(left, now), left, offers);
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

async function answerQuestion({ request, env }, hold) {
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
  // The free plan, while plans are on (Mike, 2026-10-12): its answers stay with the world's lore (LORE_FOCUS below),
  // without looking online or the game picture. Willo still speaks in its own voice (style "spoken" stays).
  if (plansOn(env) && !subscriber) [researchRequired, autoResearch, image] = [false, false, null];
  // pack: the starter or top-up this answer comes out of, when the day's plan answers are gone.
  let pack = null;
  if (compact) {
    // Compaction has its own abuse limit and uses the shared paid budget. It never spends a player's daily answer or
    // a top-up.
    if (!(await perDay(env, app.user.id, "companion-compact", COMPACTIONS_PER_DAY, now))) {
      const left = await allowance(env, app.user.id, now, exempt, plan);
      return tooMany("Chat memory is at its daily limit. Your messages are saved; try again tomorrow.", untilTomorrow(now), left);
    }
  } else if (!exempt) {
    // The plan's answers first: today's, and a paid plan's month's (from its renewal day, lib/billing.js poolWindow).
    // Once they're gone, while plans are on, the free plan's starter, then a top-up.
    const pool = plansOn(env) && plan.answersPerMonth ? poolWindow(plan, now) : null;
    const planned = await perDay(env, app.user.id, "companion-answer", plan.answersPerDay, now)
      && (!pool || await perPeriod(env, app.user.id, "companion-month", pool.key, plan.answersPerMonth));
    const packs = !planned && plansOn(env) ? await topupFor(env, app.user.id, now) : null;
    if (!planned && !(packs && packs.remaining + (subscriber ? 0 : packs.starter) > 0))
      return outOfAnswers(env, app.user.id, plan, now, exempt);
    // While plans are on, every live answer, plan, starter or top-up, counts toward the most an account gets in a day,
    // whatever was bought.
    if (plansOn(env) && !(await perDay(env, app.user.id, "companion-day", dayMax(plan), now))) {
      const left = await allowance(env, app.user.id, now, exempt, plan);
      return tooMany("That's the most live answers for one day. They come back tomorrow.", untilTomorrow(now), left);
    }
    // Taken in one statement, so a question asked at the same moment can't spend the same answer; one that finds the
    // last answer gone is out of answers.
    if (!planned && !(pack = await useTopup(env, app.user.id, { starter: !subscriber })))
      return outOfAnswers(env, app.user.id, plan, now, exempt);
  }
  // A player saying the last answer was wrong, or losing patience: Willo is told not to argue, and it comes back to us
  // (lib/answer-feedback.js) with what was asked and answered. A character's reply is in character, so not counted.
  const dispute = operation === "answer" ? feedbackKind(parts.question, parts.previous) : null;
  const known = knowledge ? await knowledge : { facts: [], block: "" };
  const stronger = Boolean(PLANS[plan.id]?.stronger);
  const wantsResearch = operation === "answer" && (researchRequired || autoResearch);
  let strong = stronger && !compact;
  const longMemory = Boolean(PLANS[plan.id]?.longMemory) && compact;
  // Looking it up (LOR-446). What another player's search found for the same question here answers without searching
  // again, for required research too. research "auto" (the companion asks for it with spoken questions) looks online
  // quickly only when no Forever fact covers a practical question or a correction (lib/research-cache.js wantsSearch).
  let finding = wantsResearch ? await cachedFinding(env, parts, now) : null;
  const cached = Boolean(finding);
  let research = researchRequired && !finding;
  let quick = operation === "answer" && autoResearch && !researchRequired && !finding
    && wantsSearch(parts.question, dispute, known.facts);
  // A plan's or a top-up's answer is paid for, so it skips the shared monthly budget, and its cost is counted as theirs.
  // A starter answer is free: it waits for the shared budget like the day's free answers.
  let paid = subscriber || pack?.kind === "topup";
  // Past the monthly cost cap of the plan, or the cost cap of the top-up the answer comes out of, the answer goes back
  // to the ordinary model and doesn't look online, until the month ends. Nobody is cut off by either; a longer chat
  // memory stays, since it's cheap. An answer that would look online or use the stronger model first holds what
  // reserveAnswer reserves for it against that cap, in one statement (lib/billing.js holdUserSpend), so questions asked
  // at the same moment can't all get in under the cap; settle swaps the hold for what the answer cost.
  let held = null;   // {id, micro}
  const upgrade = () => paid && (research || quick || strong)
    ? answerReservation(research, operation, { lookup: quick, strong, longMemory }) : 0;
  const holdCap = async () => {
    const micro = upgrade();
    if (!micro) return;
    const id = await holdUserSpend(env, app.user.id, micro, now,
      pack?.kind === "topup" ? { packId: pack.id } : { cap: plan.costCapMicro });
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
  // The plan's web look-ups a month (lib/billing.js lookupsPerMonth, the month from its renewal day): past them, the
  // month's answers don't look online, and their hold shrinks to fit. A finding another player's search kept costs
  // nothing, so it isn't counted.
  if ((research || quick) && plansOn(env) && !exempt && !(await perPeriod(env, app.user.id, "companion-lookup",
      poolWindow(plan, now).key, plan.lookupsPerMonth || 0))) {
    research = quick = false;
    await release(upgrade());
  }
  // A paying player's customization (lib/willo-custom.js): Willo's style, or their tale of the character. A failure to
  // read it gives an ordinary answer. The free plan's answers get LORE_FOCUS instead, while plans are on.
  let custom = { system: "", tale: false };
  if (subscriber) {
    try { custom = await promptBlocks(env, app.user.id, plan, { operation, npc }); }
    catch (e) { console.warn(`companion answer: customization: ${e?.message || e}`); }
  } else if (plansOn(env) && operation === "answer") custom = { system: LORE_FOCUS, tale: false };
  let reserved = await reserveAnswer(env, now, research, operation, quick, { paid, strong, longMemory });
  // The shared budget is full, but this free player bought a top-up: their answer comes out of it instead, with its
  // cost cap, and a starter answer taken for it goes back.
  let topup;
  if (!reserved && !paid && !compact && plansOn(env) && (topup = await useTopup(env, app.user.id))) {
    if (pack) await returnTopup(env, pack.id);
    [pack, paid] = [topup, true];
    await holdCap();
    reserved = await reserveAnswer(env, now, research, operation, quick, { paid, strong, longMemory });
  }
  if (!reserved) {
    // A starter answer taken for a question that never reached the model goes back.
    if (pack) await returnTopup(env, pack.id);
    return tooMany("We're at capacity for free live answers right now. Try again next month.",
      86400, await allowance(env, app.user.id, now, exempt, plan));
  }
  // Kept while the answer is written; logFeedback never throws.
  const logged = dispute && logFeedback(env, app.user.id, { kind: dispute, said: parts.question,
    question: parts.previousQuestion, answer: parts.previous, zone: parts.zone, sub: parts.sub, persona,
    spoken: Boolean(style) });
  // A paid-for answer's cost goes on the player's month (lib/billing.js addUserSpend), once: what the quick look online
  // and the answer cost, as lib/companion-answers.js counts them, whether the answer came or not. It takes the place of
  // what the answer held against its cap.
  let lookCost = 0, settled = !paid;
  const settle = async counted => {
    if (settled) return;
    settled = true;
    await addUserSpend(env, app.user.id, lookCost + (counted || 0), now, pack?.id, held?.id);
    held = null;
  };
  try {
    // The quick look online writes a finding first (companion-answers.js lookUp), kept for the next player; the answer
    // is then written from it. Without one (no evidence, too slow) it's answered as it would have been.
    const look = quick ? await lookUp(env, parts, now) : null;
    lookCost = look?.counted || 0;
    const looked = look?.found;
    if (looked) {
      finding = { answer: looked.answer, sources: looked.web_sources, created: now.toISOString() };
      await keepFinding(env, parts, looked.answer, looked.web_sources, now);
    }
    // Required research searches instead (companion-answers.js systemPrompt), so it gets no facts.
    const facts = research ? [] : known.facts;
    const knowledgeText = [research ? "" : known.block, findingBlock(finding)].filter(Boolean).join("\n\n");
    const { model_ms, counted, ...result } = await writeAnswer(env, prompt, now, research, operation,
      { persona, style, image, facts: knowledgeText, dispute, custom: custom.system, strong, longMemory })
      .finally(() => logged);
    await settle(counted);
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
    return Response.json({ ok: true, ...result, allowance: left, timing: { model_ms, total_ms: Date.now() - started },
      ...(compact ? {} : { forever_facts: facts.map(f => f.title),
        looked_up: cached ? "cached" : research ? "required" : looked ? "quick" : "no" }),
      ...(dispute ? { feedback: dispute } : {}), ...(custom.tale ? { tale: true } : {}) }, { headers: noStore });
  } catch (e) {
    await settle(e?.counted);
    // A failed answer gives its top-up answer back: the player paid for answers, not attempts.
    if (pack) await returnTopup(env, pack.id);
    console.warn(`companion answer: ${e?.message || e}`);
    return fail(502, "Couldn't get a live answer just now. Try again in a moment.");
  }
}
