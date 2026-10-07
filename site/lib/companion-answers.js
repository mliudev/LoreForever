// Short live answers paid for by Lore Forever. Limits are enforced on the server before a Gemini call.

export const ANSWERS_PER_DAY = 20;
export const ANSWER_MODEL = "gemini-3.1-flash-lite";
export const ANSWER_RESERVATION_MICRO = 6_000;      // upper bound for the capped input and output
export const ANSWER_PROMPT_BYTES = 16_000;
export const ANSWER_OUTPUT_TOKENS = 512;

const SYSTEM = `You are Lore Forever, a World of Warcraft lore companion. Answer the player's question directly and briefly, in at most 100 words. Use the supplied player context, journey, and lore sources when relevant. Stay in the original world a few years after the Third War; never reveal later Warcraft events. Do not invent names, events, or motives. Only completed quests are safe to discuss as past events. Avoid quest twists unless directly asked. Return JSON with answer (plain text) and sources (names from the supplied sources).`;
const SCHEMA = { type: "object", properties: { answer: { type: "string" }, sources: { type: "array", items: { type: "string" } } }, required: ["answer", "sources"] };
const month = (now = new Date()) => now.toISOString().slice(0, 7);
const day = (now = new Date()) => now.toISOString().slice(0, 10);
export function paidBudgetMicro(env) {
  const usd = Number(env.STORY_BUDGET_USD ?? 100);
  return Math.round((Number.isFinite(usd) && usd >= 0 ? usd : 100) * 1e6);
}

export async function answerBudgetUsed(env, now = new Date()) {
  const row = await env.DB.prepare("SELECT reserved_micro FROM answer_spend WHERE month = ?").bind(month(now)).first();
  return row?.reserved_micro || 0;
}

async function otherPaidSpend(env, now = new Date()) {
  const row = await env.DB.prepare("SELECT micro_usd, voice_micro_usd, reserved_micro FROM story_spend WHERE month = ?")
    .bind(month(now)).first();
  return (row?.micro_usd || 0) + (row?.voice_micro_usd || 0) + (row?.reserved_micro || 0);
}

// Profile stories and their voice use the same atomic budget gate as answers. In-flight requests hold their maximum
// estimated cost; a successful response moves that amount into the service's measured spend.
export async function reserveOtherPaid(env, micro, now = new Date()) {
  if (!Number.isSafeInteger(micro) || micro < 0) return false;
  await env.DB.prepare("INSERT OR IGNORE INTO story_spend (month) VALUES (?)").bind(month(now)).run();
  const row = await env.DB.prepare(
    "UPDATE story_spend SET reserved_micro = reserved_micro + ? WHERE month = ? AND " +
    "micro_usd + voice_micro_usd + reserved_micro + ? + " +
    "COALESCE((SELECT reserved_micro FROM answer_spend WHERE month = ?), 0) <= ? RETURNING reserved_micro"
  ).bind(micro, month(now), micro, month(now), paidBudgetMicro(env)).first();
  return Boolean(row);
}

export async function allowance(env, userId, now = new Date()) {
  const row = await env.DB.prepare("SELECT n FROM rate_limits WHERE user_id = ? AND bucket = ?")
    .bind(userId, `companion-answer:${day(now)}`).first();
  const paid = await Promise.all([answerBudgetUsed(env, now), otherPaidSpend(env, now)]);
  return { limit: ANSWERS_PER_DAY, remaining: Math.max(0, ANSWERS_PER_DAY - (row?.n || 0)),
    resetsAt: new Date(Date.parse(day(now) + "T00:00:00Z") + 86400e3).toISOString(),
    available: Boolean(env.GEMINI_API_KEY) && paid[0] + paid[1] + ANSWER_RESERVATION_MICRO <= paidBudgetMicro(env) };
}

// Atomic reservation: concurrent accounts cannot spend past the monthly cap. Reservations stay counted even if
// Gemini fails; successful calls reconcile to their measured cost. Profile story and voice spend share this cap.
export async function reserveAnswer(env, now = new Date()) {
  await env.DB.prepare("INSERT OR IGNORE INTO answer_spend (month, reserved_micro, actual_micro, calls) VALUES (?, 0, 0, 0)")
    .bind(month(now)).run();
  const row = await env.DB.prepare(
    "UPDATE answer_spend SET reserved_micro = reserved_micro + ?, calls = calls + 1 WHERE month = ? " +
    "AND reserved_micro + ? + COALESCE((SELECT micro_usd + voice_micro_usd + reserved_micro FROM story_spend WHERE month = ?), 0) <= ? " +
    "RETURNING reserved_micro"
  ).bind(ANSWER_RESERVATION_MICRO, month(now), ANSWER_RESERVATION_MICRO, month(now), paidBudgetMicro(env)).first();
  return Boolean(row);
}

export async function writeAnswer(env, prompt, now = new Date()) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${ANSWER_MODEL}:generateContent`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0.4,
        maxOutputTokens: ANSWER_OUTPUT_TOKENS, thinkingConfig: { thinkingLevel: "minimal" } } }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const result = await res.json();
  const content = (result.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || "").join("");
  const parsed = JSON.parse(content);
  const answer = String(parsed.answer || "").trim().slice(0, 900);
  if (!answer) throw new Error("Empty answer");
  const sources = Array.isArray(parsed.sources) ? parsed.sources.filter(s => typeof s === "string").slice(0, 8) : [];
  const usage = result.usageMetadata || {};
  const validCount = count => typeof count === "number" && Number.isFinite(count) && count >= 0;
  // If Gemini omits measured usage, keep the full reservation counted against capacity.
  if (!validCount(usage.promptTokenCount) || !validCount(usage.candidatesTokenCount) ||
      (usage.thoughtsTokenCount != null && !validCount(usage.thoughtsTokenCount)))
    return { answer, sources, usage: null };
  const input = usage.promptTokenCount;
  const output = usage.candidatesTokenCount + (usage.thoughtsTokenCount || 0);
  const actual = Math.ceil(input * 0.25 + output * 1.5); // Gemini 3.1 Flash-Lite USD per million tokens
  await env.DB.prepare("UPDATE answer_spend SET actual_micro = actual_micro + ?, " +
    "reserved_micro = reserved_micro - ? + ? WHERE month = ?")
    .bind(actual, ANSWER_RESERVATION_MICRO, actual, month(now)).run();
  return { answer, sources, usage: { in: input, out: output } };
}
