// Account-linked companion answers. The site owns the key and pays for a small daily allowance.
import { setup, fail, noStore } from "../../../lib/accounts.js";
import { currentDevice } from "../../../lib/devices.js";
import { perDay } from "../../../lib/ratelimit.js";
import { allowance, reserveAnswer, writeAnswer, uncapped, personaOf, styleOf, ANSWERS_PER_DAY, COMPACTIONS_PER_DAY,
  ANSWER_PROMPT_BYTES, ANSWER_IMAGE_CHARS } from "../../../lib/companion-answers.js";

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
  let prompt, operation, researchRequired, persona, style, image;
  try {
    const body = JSON.parse(input);
    prompt = body.prompt;
    researchRequired = body.research_required === undefined ? false : body.research_required;
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
  if (!(await reserveAnswer(env, now, researchRequired, operation))) return tooMany("We're at capacity for free live answers right now. Try again next month.",
    86400, await allowance(env, app.user.id, now, exempt));
  try {
    const { model_ms, ...result } = await writeAnswer(env, prompt, now, researchRequired, operation, { persona, style, image });
    const left = await allowance(env, app.user.id, now, exempt);
    // timing: where the time went, in whole milliseconds (the companion logs it).
    return Response.json({ ok: true, ...result, allowance: left, timing: { model_ms, total_ms: Date.now() - started } },
      { headers: noStore });
  } catch (e) {
    console.warn(`companion answer: ${e?.message || e}`);
    return fail(502, "Couldn't get a live answer just now. Try again in a moment.");
  }
}
