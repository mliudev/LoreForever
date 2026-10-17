// A piece of Willo's spoken reply in a hosted voice, for a paying player's companion (LOR-490, lib/companion-voice.js).
//   POST /api/companion/speak {text (at most 600 letters), voice ("willo": Willo's own; or a character's people and
//        gender, "dwarf-male", said in their own voice where one is set up and the plan has one, else in Willo's),
//        reply (the companion's id for the reply, the same for each of its pieces; optional: without it the piece is
//        a reply of its own), line (optional, true: one of Willo's own lines, a tip or a hello, said in the voice the
//        replies get now but never counted as one; its cost is a reply's), reading (optional, with line: the add-on's
//        own short answer read aloud, LOR-547: always said on the PC)} -> 200 audio/mpeg; a line's X-LF-Voice
//        header says which voice said it and its pick ("finest:moonwell"), by which the companion keeps it
//   Anything else says the companion should say it in Willo's own voice on the PC: {ok: false, speak: "local", reason}
//   with reason "off" (plans are off, 404), "plan" (the plan's replies are said on the PC, 402), "reading" (the
//   add-on's answers read aloud are always said on the PC, 402; today's companion never asks), "spent" (the month's
//   room for the hosted voice is used, 402), "long" (the reply is past 600 letters, 413), "busy" (too many this
//   minute, 429) or "unavailable" (no voice set up here, or no provider could say it, 503). The companion is signed in
//   exactly as for answers (functions/api/companion/answer.js).

import { setup, fail, noStore } from "../../../lib/accounts.js";
import { currentDevice } from "../../../lib/devices.js";
import { perMinute } from "../../../lib/ratelimit.js";
import { planFor, plansOn } from "../../../lib/billing.js";
import { speakPiece, SPEAK_MAX_CHARS, isVoiceKey, REPLY_ID } from "../../../lib/companion-voice.js";

const CLIENT = /^companion\/[\w.-]{1,24}$/;
const MAX_BODY_BYTES = 8 * 1024;
const PIECES_PER_MINUTE = 60;   // a reply is a few pieces; this only stops a runaway client
const local = (status, reason) => Response.json({ ok: false, speak: "local", reason }, { status, headers: noStore });

export async function onRequest({ request, env, waitUntil }) {
  if (!env.DB) return fail(503, "Accounts aren't set up yet.");
  await setup(env);
  if (!CLIENT.test(request.headers.get("X-LF-Client") || "") || request.headers.get("Origin"))
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
  // The add-on's answers read aloud: on the PC, before the minute's count or the plan are even looked at.
  if (body?.line === true && body?.reading === true) return local(402, "reading");
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text || text.length > SPEAK_MAX_CHARS) return fail(400, `Send 1 to ${SPEAK_MAX_CHARS} letters to say.`);
  if (!isVoiceKey(body.voice)) return fail(400, "Unknown voice.");
  if (body.reply !== undefined && (typeof body.reply !== "string" || !REPLY_ID.test(body.reply)))
    return fail(400, "Unknown reply.");
  const now = new Date();
  // The minute's count and the plan side by side: every round trip to the database here is before the first audio.
  const [allowed, plan] = await Promise.all([perMinute(env, app.user.id, "companion-speak", PIECES_PER_MINUTE, now),
    planFor(env, app.user.id, now)]);
  if (!allowed) return local(429, "busy");
  // pick (optional): the player's Willo voice ("moonwell"); said only on a plan with a choice, else and when unknown
  // in Sprite (lib/companion-voice.js willoPick).
  const pick = typeof body.pick === "string" ? body.pick : undefined;
  // What a said piece cost is written after its audio has gone back (waitUntil): its hold already counts against the
  // month's cap, so nothing can slip past it meanwhile.
  const said = await speakPiece(env, app.user.id, plan,
    { text, voice: body.voice, reply: body.reply ?? crypto.randomUUID(), pick, line: body.line === true,
      reading: body.line === true && body.reading === true }, now,
    typeof waitUntil === "function" ? waitUntil : null);
  if (!said.audio) return local(said.status, said.local);
  return new Response(said.audio, { headers: { ...noStore, "Content-Type": "audio/mpeg",
    ...(said.voice ? { "X-LF-Voice": said.voice } : {}) } });
}
