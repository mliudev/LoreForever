// Willo's own answers on DeepSeek V4.1 Flash at Together (Mike, 10/24: "yes switch to deepseek if the stress test
// holds"; the bake-off: faster to her first word than Flash-Lite and at least as accurate), behind one setting:
// WILLO_ANSWER_HOST "together:<Together's model id>" with the TOGETHER_AI_API_KEY secret. Unset, or without the key, every
// answer stays on Gemini as before, so switching back is clearing that one variable.
// The request is the site's Gemini one in Together's chat format, and the reply comes back shaped like Gemini's (one
// generateContent result, or the events streamGenerateContent sends), so generate reads both the same way. It always
// streams from Together, so an error, a 429, or no first words within FIRST_WORD_MS throws before anything is said,
// and generate asks Gemini instead (the Software Architect's fallback, 10/24).
export const TOGETHER_URL = "https://api.together.xyz/v1/chat/completions";
export const FIRST_WORD_MS = 1500;
// A disputed answer (think) waits longer for its first thought: with reasoning on, Together took 1.8 s to start one of two
// (10/24), and the player waits for its thinking anyway.
export const FIRST_THOUGHT_MS = 3000;
// $ per million tokens in and out (Together's list prices, 10/24), for the answer's measured cost.
export const TOGETHER_PRICES = { "deepseek-ai/DeepSeek-V4.1-Flash": { input: 0.30, output: 1.20 } };

// The Together model her answers go to, or null for Gemini.
export function answerHost(env) {
  const set = /^together:(\S+)$/.exec(String(env?.WILLO_ANSWER_HOST || "").trim());
  return set && env.TOGETHER_AI_API_KEY ? set[1] : null;
}

// The circuit breaker (Mike, 10/24: "add the circuit breaker first"): when at least BREAKER_FALLS of her Together
// answers in the last BREAKER_WINDOW_MS fell back to Gemini and they're more than BREAKER_SHARE of them, or the last
// BREAKER_RUN in a row failed outright (an outage on a quiet isolate; a slow first word counts toward the share but
// never toward the run: the Architect, 10/24, after the bursts tripped it on three slow starts), the next BREAKER_OPEN_MS of answers go straight to Gemini,
// so a rush on Together doesn't make each player wait FIRST_WORD_MS first; then Together is tried again. One stray
// fallback never trips it (the Architect, 10/24: at 0.3% of answers falling back, a busy isolate would otherwise spend
// ~8% of its time on Gemini). Kept per isolate (a Worker's own memory), never shared between them: each isolate trips
// on what it sees itself.
export const BREAKER_SHARE = 0.05, BREAKER_FALLS = 3, BREAKER_RUN = 3, BREAKER_WINDOW_MS = 60_000,
  BREAKER_OPEN_MS = 120_000;
let tries = [], openUntil = 0;
// Whether her answers skip Together right now.
export const breakerOpen = (now = Date.now()) => now < openUntil;
// One answer tried on Together: whether it fell back, and if so whether only for a slow first word (slow).
export function noteTogether(fellBack, { slow = false, now = Date.now() } = {}) {
  tries = tries.filter(t => now - t.at < BREAKER_WINDOW_MS);
  tries.push({ at: now, fellBack, failed: fellBack && !slow });
  const fell = tries.filter(t => t.fellBack).length;
  const run = tries.length >= BREAKER_RUN && tries.slice(-BREAKER_RUN).every(t => t.failed);
  if ((fell >= BREAKER_FALLS && fell / tries.length > BREAKER_SHARE) || run) {
    openUntil = now + BREAKER_OPEN_MS;
    tries = [];
    console.warn(`companion answer: Together breaker open for ${BREAKER_OPEN_MS / 1000} s (${fell} fallbacks)`);
  }
}
// A fresh breaker (the tests).
export function resetBreaker() { tries = []; openUntil = 0; }

const FINISH = { stop: "STOP", tool_calls: "STOP", length: "MAX_TOKENS", content_filter: "SAFETY" };
const usageOf = u => u && { promptTokenCount: u.prompt_tokens || 0, candidatesTokenCount: u.completion_tokens || 0 };

// Gemini's request (systemInstruction, one user turn with text and pictures, offered actions, generationConfig) in
// Together's chat format, streamed, without reasoning (her answers think "minimal" on Gemini), or with it (think: a
// disputed answer thinks a little first, LOR-446).
export function chatRequest(body, model, think = false) {
  const system = body.systemInstruction?.parts?.map(p => p.text).join("") || "";
  const parts = body.contents?.[0]?.parts || [];
  const content = parts.some(p => p.inlineData)
    ? parts.map(p => p.inlineData
      ? { type: "image_url", image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } }
      : { type: "text", text: p.text })
    : parts.map(p => p.text).join("\n");
  const g = body.generationConfig || {};
  const declared = body.tools?.flatMap(t => t.functionDeclarations || []) || [];
  return { model, stream: true, stream_options: { include_usage: true }, reasoning: { enabled: think },
    messages: [{ role: "system", content: system }, { role: "user", content }],
    temperature: g.temperature, max_tokens: g.maxOutputTokens,
    ...(g.responseMimeType === "application/json" ? { response_format: { type: "json_object" } } : {}),
    ...(declared.length ? { tools: declared.map(d => ({ type: "function", function: d })),
      tool_choice: body.toolConfig?.functionCallingConfig?.mode === "ANY" ? "required" : "auto" } : {}) };
}

// Together's server-sent events, each parsed.
async function* events(res) {
  const reader = res.body.getReader(), decoder = new TextDecoder();
  let rest = "";
  for (;;) {
    const { value, done } = await reader.read();
    const lines = (rest + decoder.decode(value, { stream: !done })).split(/\r?\n/);
    rest = done ? "" : lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data:") || line.includes("[DONE]")) continue;
      try { yield JSON.parse(line.slice(5)); } catch { /* a keep-alive or broken line */ }
    }
    if (done) return;
  }
}
const hasWords = e => Boolean(e.choices?.[0]?.delta?.content || e.choices?.[0]?.delta?.tool_calls?.length);
// Its thinking (think): proof it's at work, so the first-word wait ends with it, though none of it is said.
const hasThought = e => Boolean(e.choices?.[0]?.delta?.reasoning || e.choices?.[0]?.delta?.reasoning_content);

// Gemini's request to Together: a Response like Gemini's (stream: its events; else one result with any action called
// as a functionCall part). signal: the answer's own time limit, on top of FIRST_WORD_MS for the first words (or the
// first thought, think). An answer given up for a slow first word throws an error marked slow (noteTogether).
export async function viaTogether(env, body, model, { stream = false, signal = null, fetcher = fetch, think = false } = {}) {
  // An offer's answer is inside the action it calls, which only the whole result carries (generate never streams one):
  // streamed, it would be lost, so it goes to Gemini instead.
  if (stream && body.tools?.length) throw new Error("Together: an offer never streams");
  const first = new AbortController();
  const wait = think ? FIRST_THOUGHT_MS : FIRST_WORD_MS;
  const late = Object.assign(new Error(`Together: no first words in ${wait} ms`), { slow: true });
  const timer = setTimeout(() => first.abort(late), wait);
  const slowly = e => { throw first.signal.aborted && !signal?.aborted ? late : e; };
  const res = await fetcher(TOGETHER_URL, { method: "POST",
    signal: signal ? AbortSignal.any([signal, first.signal]) : first.signal,
    // Together's edge refuses a request without a User-Agent of its own (403 to Python's default, 10/24).
    headers: { Authorization: `Bearer ${env.TOGETHER_AI_API_KEY}`, "Content-Type": "application/json",
      "User-Agent": "LoreForever-Willo/1.0" },
    body: JSON.stringify(chatRequest(body, model, think)) }).catch(e => { clearTimeout(timer); slowly(e); });
  if (!res.ok || !res.body) {
    clearTimeout(timer);
    throw Object.assign(new Error(`Together HTTP ${res.status}`), { status: res.status });
  }
  const it = events(res);
  const before = [];
  try {
    // Her first words come before anything goes on. A thought ends the first-word wait (think), but its words are still
    // waited for, within the answer's own time limit: thinking that fills the room and finishes with no words ("length")
    // falls back to Gemini like any reply without them.
    for (;;) {
      const next = await it.next();
      if (next.done) throw new Error("Together: no words");
      before.push(next.value);
      if (hasWords(next.value)) break;
      if (think && hasThought(next.value)) clearTimeout(timer);
    }
  } catch (e) {
    slowly(e);
  } finally {
    clearTimeout(timer);
  }
  async function* all() { yield* before; yield* it; }
  const shaped = e => {
    const choice = e.choices?.[0], text = choice?.delta?.content, finish = choice?.finish_reason;
    return { candidates: [{ content: { parts: text ? [{ text }] : [] }, ...(finish ? { finishReason: FINISH[finish] || "STOP" } : {}) }],
      ...(e.usage ? { usageMetadata: usageOf(e.usage) } : {}), modelVersion: e.model };
  };
  if (stream) {
    const encoder = new TextEncoder(), source = all();
    return new Response(new ReadableStream({
      async pull(controller) {
        const next = await source.next();
        if (next.done) { controller.close(); return; }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(shaped(next.value))}\n\n`));
      },
    }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }
  let text = "", finish, usage, version;
  const calls = [];
  for await (const e of all()) {
    const choice = e.choices?.[0];
    text += choice?.delta?.content || "";
    for (const c of choice?.delta?.tool_calls || []) {
      const call = calls[c.index ?? 0] ??= { name: "", arguments: "" };
      call.name += c.function?.name || "";
      call.arguments += c.function?.arguments || "";
    }
    finish = choice?.finish_reason || finish;
    usage = e.usage || usage;
    version = e.model || version;
  }
  const parts = [...(text ? [{ text }] : []), ...calls.filter(c => c.name).map(c => {
    let args = {};
    try { args = JSON.parse(c.arguments || "{}"); } catch { /* left empty: the answer is the text */ }
    return { functionCall: { name: c.name, args } };
  })];
  return Response.json({ candidates: [{ content: { parts }, finishReason: FINISH[finish] || "STOP" }],
    usageMetadata: usageOf(usage), modelVersion: version });
}
