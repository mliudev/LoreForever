// Account-linked companion answers. The site owns the key and pays for a small daily allowance.
import { setup, fail, noStore } from "../../../lib/accounts.js";
import { currentDevice } from "../../../lib/devices.js";
import { perDay } from "../../../lib/ratelimit.js";
import { allowance, reserveAnswer, writeAnswer, lookUp, uncapped, personaOf, styleOf, ANSWERS_PER_DAY, COMPACTIONS_PER_DAY,
  ANSWER_PROMPT_BYTES, ANSWER_IMAGE_CHARS } from "../../../lib/companion-answers.js";
import { promptParts, knowledgeFor } from "../../../lib/forever-knowledge.js";
import { feedbackKind, logFeedback } from "../../../lib/answer-feedback.js";
import { cachedFinding, keepFinding, findingBlock, wantsSearch } from "../../../lib/research-cache.js";

const CLIENT = /^companion\/[\w.-]{1,24}$/;
const MAX_BODY_BYTES = 64 * 1024; // JSON escaping can expand a valid 16 KB Unicode prompt.
// A spoken question may also carry a picture (base64, a byte per character); the rest of the body keeps MAX_BODY_BYTES.
const MAX_PICTURE_BODY_BYTES = MAX_BODY_BYTES + ANSWER_IMAGE_CHARS;
const tooMany = (error, retryAfter, allowance) => Response.json({ ok: false, error, retryAfter, allowance },
  { status: 429, headers: { ...noStore, "Retry-After": String(retryAfter) } });

export async function onRequest({ request, env }) {
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
  let prompt, operation, researchRequired, persona, style, image, autoResearch;
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
  const knowledge = compact ? null : knowledgeFor(env, parts, { character: operation === "character" });
  // Mike's own and test accounts skip the daily answer cap; the monthly budget below still applies to them.
  const exempt = await uncapped(env, app.user.id);
  // Compaction has its own abuse limit and uses the shared paid budget. It never spends a player's daily answer.
  if (!(compact ? await perDay(env, app.user.id, "companion-compact", COMPACTIONS_PER_DAY, now)
    : exempt || await perDay(env, app.user.id, "companion-answer", ANSWERS_PER_DAY, now))) {
    const left = await allowance(env, app.user.id, now, exempt);
    return tooMany(compact ? "Chat memory is at its daily limit. Your messages are saved; try again tomorrow."
      : "You've used today's 20 free answers. They come back tomorrow.",
      Math.ceil((Date.parse(left.resetsAt) - now.getTime()) / 1000), left);
  }
  // A player saying the last answer was wrong, or losing patience: Willo is told not to argue, and it comes back to us
  // (lib/answer-feedback.js) with what was asked and answered. A character's reply is in character, so not counted.
  const dispute = operation === "answer" ? feedbackKind(parts.question, parts.previous) : null;
  const known = knowledge ? await knowledge : { facts: [], block: "" };
  // Looking it up (LOR-446). What another player's search found for the same question here answers without searching
  // again, for required research too. research "auto" (the companion asks for it with spoken questions) looks online
  // quickly only when no Forever fact covers a practical question or a correction (lib/research-cache.js wantsSearch).
  let finding = operation === "answer" && (researchRequired || autoResearch) ? await cachedFinding(env, parts, now) : null;
  const cached = Boolean(finding);
  const research = researchRequired && !finding;
  const quick = operation === "answer" && autoResearch && !researchRequired && !finding
    && wantsSearch(parts.question, dispute, known.facts);
  if (!(await reserveAnswer(env, now, research, operation, quick))) return tooMany("We're at capacity for free live answers right now. Try again next month.",
    86400, await allowance(env, app.user.id, now, exempt));
  // Kept while the answer is written; logFeedback never throws.
  const logged = dispute && logFeedback(env, app.user.id, { kind: dispute, said: parts.question,
    question: parts.previousQuestion, answer: parts.previous, zone: parts.zone, sub: parts.sub, persona,
    spoken: Boolean(style) });
  try {
    // The quick look online writes a finding first (companion-answers.js lookUp), kept for the next player; the answer
    // is then written from it. Without one (no evidence, too slow) it's answered as it would have been.
    const looked = quick ? await lookUp(env, parts, now) : null;
    if (looked) {
      finding = { answer: looked.answer, sources: looked.web_sources, created: now.toISOString() };
      await keepFinding(env, parts, looked.answer, looked.web_sources, now);
    }
    // Required research searches instead (companion-answers.js systemPrompt), so it gets no facts.
    const facts = research ? [] : known.facts;
    const knowledgeText = [research ? "" : known.block, findingBlock(finding)].filter(Boolean).join("\n\n");
    const { model_ms, ...result } = await writeAnswer(env, prompt, now, research, operation,
      { persona, style, image, facts: knowledgeText, dispute }).finally(() => logged);
    if (finding) {
      result.web_sources = finding.sources;
      result.web_search = looked ? looked.web_search : { status: "searched", queries: [], suggestions_html: "" };
    } else if (research && result.web_search?.status === "searched" && result.web_sources?.length) {
      await keepFinding(env, parts, result.answer, result.web_sources, now);
    }
    const left = await allowance(env, app.user.id, now, exempt);
    // timing: where the time went, in whole milliseconds (the companion logs it). forever_facts: the titles of the
    // Forever facts the answer was given; feedback: what we kept of this message ("correction", "frustration");
    // looked_up: "required", "quick" (research "auto" looked online and found something), "cached" (an earlier
    // search's finding) or "no".
    return Response.json({ ok: true, ...result, allowance: left, timing: { model_ms, total_ms: Date.now() - started },
      ...(compact ? {} : { forever_facts: facts.map(f => f.title),
        looked_up: cached ? "cached" : research ? "required" : looked ? "quick" : "no" }),
      ...(dispute ? { feedback: dispute } : {}) }, { headers: noStore });
  } catch (e) {
    console.warn(`companion answer: ${e?.message || e}`);
    return fail(502, "Couldn't get a live answer just now. Try again in a moment.");
  }
}
