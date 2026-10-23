// A piece of Willo's spoken reply in a hosted voice, for a paying player's companion (LOR-490, lib/companion-voice.js).
//   POST /api/companion/speak {text (at most 600 letters), piece (optional: its number in the reply, 0 first; a piece
//        asked for again counts its letters once), voice ("willo": Willo's own; or a character's people and
//        gender, "dwarf-male", said in their own voice where one is set up and the plan has one, else in Willo's),
//        reply (the companion's id for the reply, the same for each of its pieces; optional: without it the piece is
//        a reply of its own), line (optional, true: one of Willo's own lines, a tip or a hello, said in the voice the
//        replies get now but never counted as one; its cost is a reply's), reading (optional, with line: the add-on's
//        own short answer read aloud, LOR-547: said on the PC; readings below)} -> 200 audio/mpeg; a line's X-LF-Voice
//        header says which voice said it and its pick ("finest:moonwell"), by which the companion keeps it
//   pick (optional): the player's Willo voice ("moonwell"), remembered for the account; without one, the remembered one.
//   POST /api/companion/speak {text (at most 600 letters), reading: true, narrator ("chronicler" or "female": the
//        narrator at the top of the player's list)} -> 200 audio/mpeg: the add-on's short answer read in that narrator's
//        voice, Hero and up (lib/companion-voice.js speakReading); X-LF-Voice "studio:chronicler". Else {ok: false,
//        speak: "local", reason}: "plan" (402: Free sees it as text), "narrator" (400), "spent", "busy", "unavailable".
//   POST /api/companion/speak {reading: true, quest: "quest:<id>#detail" | "#progress" | "#complete", narrator} -> 200
//        audio/mpeg: a quest page of the add-on's that has no recording, read aloud (lib/companion-voice.js
//        speakQuestPage): in the quest giver's people and gender where the site knows them, else the narrator's voice
//        (X-LF-Voice "studio:dwarf-male" or "studio:chronicler"). It carries no text, and any a client sends is
//        ignored: the site has the words (lib/quest-pages.js), and sends back what it read, percent-encoded, in
//        X-LF-Text, for the companion's captions. Champion and up, and the first-run trial's character tries; else
//        {ok: false, speak: "local", reason} as readings: "plan", "narrator", "spent", "busy", "unavailable" (also a
//        page the site doesn't have).
//   The text is the words as the player reads them; the providers are sent it with the pronunciation lexicon's names
//   respelled so they say them right ("Doon Mor-uh" for Dun Morogh, lib/respell.js).
//   Anything else says the companion should say it in Willo's own voice on the PC: {ok: false, speak: "local", reason}
//   with reason "off" (plans are off, 404), "plan" (the plan's replies are said on the PC, 402), "reading" (the
//   add-on's answers read aloud are always said on the PC, 402; today's companion never asks), "spent" (the month's
//   room for the hosted voice is used, 402), "long" (the reply is past 600 letters, 1,500 on a plan that hears her
//   whole answer, 413), "busy" (too many this
//   minute, 429) or "unavailable" (no voice set up here, or no provider could say it, 503). The companion is signed in
//   exactly as for answers (functions/api/companion/answer.js).
//   POST /api/companion/speak {reply, unheard: true} -> 204: the companion gave up on that reply's first piece and said
//        it on the PC; its place among the hosted voice's replies goes back (lib/companion-voice.js forgetReply, after
//        the piece is counted: the request's waitUntil).

import { setup, fail, noStore } from "../../../lib/accounts.js";
import { planSoon } from "../../../lib/plan-cache.js";
import { currentDevice } from "../../../lib/devices.js";
import { perMinute } from "../../../lib/ratelimit.js";
import { plansOn } from "../../../lib/billing.js";
import { recordVoice, savePick, savedPick } from "../../../lib/plan-usage.js";
import { speakPiece, speakReading, speakQuestPage, hostedSpellings, forgetReply, SPEAK_MAX_CHARS, MAX_PIECE, isVoiceKey, REPLY_ID, UNHEARD_SETTLE_MS }
  from "../../../lib/companion-voice.js";
import { isCompanion } from "../../../lib/client-version.js";

const CLIENT = /^companion\/[\w.-]{1,24}$/;
const MAX_BODY_BYTES = 8 * 1024;
const PIECES_PER_MINUTE = 60;   // a reply is a few pieces; this only stops a runaway client
const local = (status, reason) => Response.json({ ok: false, speak: "local", reason }, { status, headers: noStore });

export async function onRequest({ request, env, waitUntil }) {
  if (!env.DB) return fail(503, "Accounts aren't set up yet.");
  await setup(env);
  if (!isCompanion(request.headers.get("X-LF-Client")) || request.headers.get("Origin"))
    return fail(403, "This is for the Lore Forever companion app.");
  if (request.method !== "POST") return fail(405, "Use POST.");
  // With plans off, Willo talks on the PC, as before plans.
  if (!plansOn(env)) return local(404, "off");
  const app = await currentDevice(env, request);
  if (!app) return fail(401, "Connect the companion to your account for live answers.");
  if (Number(request.headers.get("Content-Length") || 0) > MAX_BODY_BYTES) return fail(413, "That's too much to say at once.");
  let body;
  try {
    const input = await request.text();
    if (new TextEncoder().encode(input).length > MAX_BODY_BYTES) return fail(413, "That's too much to say at once.");
    body = JSON.parse(input);
  } catch { return fail(400, "Couldn't read that."); }
  if (body?.unheard === true) {
    if (typeof body.reply !== "string" || !REPLY_ID.test(body.reply)) return fail(400, "Unknown reply.");
    const settleMs = env.UNHEARD_SETTLE_MS !== undefined ? Number(env.UNHEARD_SETTLE_MS) : UNHEARD_SETTLE_MS;
    const forgot = forgetReply(env, app.user.id, body.reply, new Date(), { settleMs })
      .catch(e => console.warn(`companion speak: unheard: ${e?.message || e}`));
    if (typeof waitUntil === "function") waitUntil(forgot); else await forgot;
    return new Response(null, { status: 204, headers: noStore });
  }
  // The add-on's answers read aloud: on the PC, before the minute's count or the plan are even looked at.
  if (body?.line === true && body?.reading === true) return local(402, "reading");
  // A quest page of the add-on's, read aloud: asked by its key alone, whatever text came with it.
  const quest = body?.reading === true && body?.line !== true && typeof body?.quest === "string";
  const text = !quest && typeof body?.text === "string" ? body.text.trim() : "";
  if (!quest && (!text || text.length > SPEAK_MAX_CHARS)) return fail(400, `Send 1 to ${SPEAK_MAX_CHARS} letters to say.`);
  const reading = !quest && body?.reading === true && body?.line !== true && typeof body?.narrator === "string";
  if (!reading && !quest && !isVoiceKey(body.voice)) return fail(400, "Unknown voice.");
  if (body.reply !== undefined && (typeof body.reply !== "string" || !REPLY_ID.test(body.reply)))
    return fail(400, "Unknown reply.");
  // piece (optional): its number in the reply, 0 first, so a piece asked for again counts once (LOR-673).
  if (body.piece !== undefined && !(Number.isInteger(body.piece) && body.piece >= 0 && body.piece <= MAX_PIECE))
    return fail(400, "Unknown piece.");
  const now = new Date();
  // The minute's count and the plan side by side: every round trip to the database here is before the first audio. The
  // names respelled for the providers come with them (static files, read once per isolate); the text the companion shows
  // is never respelled, only what a provider is sent.
  const [allowed, plan, spellings] = await Promise.all([perMinute(env, app.user.id, "companion-speak", PIECES_PER_MINUTE, now),
    planSoon(env, app.user.id, now), hostedSpellings(env, new URL(request.url).origin)]);
  if (!allowed) return local(429, "busy");
  // pick (optional): the player's Willo voice ("moonwell"); said only on a plan with a choice, else and when unknown
  // in Sprite (lib/companion-voice.js willoPick).
  // Sent, it's remembered for the account (lib/plan-usage.js savePick, after the audio); not sent (the iPhone, which
  // has no picker), the one its PC last sent.
  const sent = typeof body.pick === "string" ? body.pick : undefined;
  const pick = sent ?? (quest ? undefined : await savedPick(env, app.user.id) || undefined);
  if (sent && !reading && !quest) {
    const kept = savePick(env, app.user.id, sent, now);
    if (typeof waitUntil === "function") waitUntil(kept); else await kept;
  }
  if (quest) {
    const read = await speakQuestPage(env, app.user.id, plan, { quest: body.quest, narrator: body.narrator,
      origin: new URL(request.url).origin, spellings }, now, typeof waitUntil === "function" ? waitUntil : null);
    const noted = recordVoice(env, app.user.id, plan, { kind: "reading", said: read.audio ? read.voice
      : `pc:${read.local}`, first: true, chars: read.text?.length || 0 }, now);
    if (typeof waitUntil === "function") waitUntil(noted); else await noted;
    if (!read.audio) return local(read.status, read.local);
    return new Response(read.audio, { headers: { ...noStore, "Content-Type": "audio/mpeg", "X-LF-Voice": read.voice,
      "X-LF-Text": encodeURIComponent(read.text) } });
  }
  if (reading) {
    const read = await speakReading(env, app.user.id, plan, { text, narrator: body.narrator, spellings }, now,
      typeof waitUntil === "function" ? waitUntil : null);
    const noted = recordVoice(env, app.user.id, plan, { kind: "reading", said: read.audio ? read.voice
      : `pc:${read.local}`, first: true, chars: text.length }, now);
    if (typeof waitUntil === "function") waitUntil(noted); else await noted;
    if (!read.audio) return local(read.status, read.local);
    return new Response(read.audio, { headers: { ...noStore, "Content-Type": "audio/mpeg", "X-LF-Voice": read.voice } });
  }
  // What a said piece cost is written after its audio has gone back (waitUntil): its hold already counts against the
  // month's cap, so nothing can slip past it meanwhile.
  const said = await speakPiece(env, app.user.id, plan,
    { text, voice: body.voice, reply: body.reply ?? crypto.randomUUID(), pick, piece: body.piece, line: body.line === true,
      reading: body.line === true && body.reading === true, spellings }, now,
    typeof waitUntil === "function" ? waitUntil : null);
  // Which voice said it, or why the PC did, and the voice the player picked, by plan (lib/plan-usage.js): after the
  // audio has gone back, so the first word never waits for it.
  const noted = recordVoice(env, app.user.id, plan, { kind: body.line === true ? "line" : body.voice === "willo"
    ? "willo" : "character", said: said.audio ? said.voice || "hosted" : `pc:${said.local}`, pick,
    first: !body.piece, chars: text.length }, now);
  if (typeof waitUntil === "function") waitUntil(noted); else await noted;
  if (!said.audio) return local(said.status, said.local);
  return new Response(said.audio, { headers: { ...noStore, "Content-Type": "audio/mpeg",
    ...(said.voice ? { "X-LF-Voice": said.voice } : {}) } });
}
