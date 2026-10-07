// Account-linked companion answers. The site owns the key and pays for a small daily allowance.
import { setup, fail, noStore } from "../../../lib/accounts.js";
import { currentDevice } from "../../../lib/devices.js";
import { perDay } from "../../../lib/ratelimit.js";
import { allowance, reserveAnswer, writeAnswer, ANSWERS_PER_DAY, ANSWER_PROMPT_BYTES } from "../../../lib/companion-answers.js";

const CLIENT = /^companion\/[\w.-]{1,24}$/;
const MAX_BODY_BYTES = 64 * 1024; // JSON escaping can expand a valid 16 KB Unicode prompt.
const tooMany = (error, retryAfter, allowance) => Response.json({ ok: false, error, retryAfter, allowance },
  { status: 429, headers: { ...noStore, "Retry-After": String(retryAfter) } });

export async function onRequest({ request, env }) {
  if (!env.DB) return fail(503, "Accounts aren't set up yet.");
  await setup(env);
  if (!CLIENT.test(request.headers.get("X-LF-Client") || "") || request.headers.get("Origin"))
    return fail(403, "This is for the Lore Forever companion app.");
  if (!env.GEMINI_API_KEY) return fail(503, "Free live answers aren't available just now.");
  if (request.method !== "GET" && request.method !== "POST") return fail(405, "Use GET or POST.");
  const app = await currentDevice(env, request);
  if (!app) return fail(401, "Connect the companion to your account for free live answers.");
  if (request.method === "GET") return Response.json({ ok: true, allowance: await allowance(env, app.user.id) }, { headers: noStore });
  if (Number(request.headers.get("Content-Length") || 0) > MAX_BODY_BYTES)
    return fail(413, "That question has too much context. Try again after updating the companion.");
  let input;
  try { input = await request.text(); } catch { return fail(400, "Couldn't read that question."); }
  if (new TextEncoder().encode(input).length > MAX_BODY_BYTES)
    return fail(413, "That question has too much context. Try again after updating the companion.");
  let prompt;
  try { prompt = JSON.parse(input).prompt; } catch { return fail(400, "Couldn't read that question."); }
  if (typeof prompt !== "string" || !prompt.trim() || new TextEncoder().encode(prompt).length > ANSWER_PROMPT_BYTES)
    return fail(400, "That question has too much context. Try a shorter question.");
  const now = new Date();
  if (!(await perDay(env, app.user.id, "companion-answer", ANSWERS_PER_DAY, now))) {
    const left = await allowance(env, app.user.id, now);
    return tooMany("You've used today's 20 free answers. Add your own key in Settings for more.",
      Math.ceil((Date.parse(left.resetsAt) - now.getTime()) / 1000), left);
  }
  if (!(await reserveAnswer(env, now))) return tooMany("We're at capacity for free live answers right now. Try again next month, or use your own key.",
    86400, await allowance(env, app.user.id, now));
  try {
    const result = await writeAnswer(env, prompt, now);
    return Response.json({ ok: true, ...result, allowance: await allowance(env, app.user.id, now) }, { headers: noStore });
  } catch (e) {
    console.warn(`companion answer: ${e?.message || e}`);
    return fail(502, "Couldn't get a live answer just now. Try again in a moment.");
  }
}
