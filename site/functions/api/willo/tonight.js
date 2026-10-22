// Willo's Tonight card (LOR-733, lib/willo-tonight.js): what happened last time, picks for the next session and a word
// from the realm, built from templates, with no answer model and no answer used.
//   POST /api/willo/tonight {character: "Húrin-ClassicBetaPvE", stock?}  (GET takes ?character= and has no stock)
//     -> {ok, title, character, previously, picks: [{title, sub}], news?, gap, locked?, offer?, fold_key}
// stock is what the add-on last saved of the character, as Willo's app sends it with each answer (lib/willo-goals.js
// stockOf), for the numbers of a goal; without it a goal is named with none. From the companion: X-LF-Client:
// companion/<version>, no Origin, Authorization: Bearer <device token>. From the phone's app the same, and from our pages
// the session cookie, with our Origin on a POST.

import { setup, currentUser, fail, noStore, sameOrigin } from "../../../lib/accounts.js";
import { currentDevice } from "../../../lib/devices.js";
import { stockOf } from "../../../lib/willo-goals.js";
import { tonightFor } from "../../../lib/willo-tonight.js";

const COMPANION = /^companion\/[\w.-]{1,24}$/;
const MAX_BODY_BYTES = 32 * 1024;

async function who(env, request) {
  if (COMPANION.test(request.headers.get("X-LF-Client") || "") && !request.headers.get("Origin")) {
    return (await currentDevice(env, request))?.user || null;
  }
  if (request.method === "POST" && !sameOrigin(request)) return null;
  return currentUser(env, request);
}

export async function onRequest({ request, env }) {
  if (!env.DB) return fail(503, "Accounts aren't set up yet.");
  if (request.method !== "GET" && request.method !== "POST") return fail(405, "Use GET or POST.");
  await setup(env);
  const user = await who(env, request);
  if (!user) return fail(401, "Connect Willo to your Lore Forever account first.");
  let input = {};
  if (request.method === "POST") {
    try {
      const text = await request.text();
      if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return fail(413, "That is too much to read.");
      input = JSON.parse(text || "{}");
    } catch (e) { return fail(400, "Couldn't read that."); }
    if (!input || typeof input !== "object" || Array.isArray(input)) return fail(400, "Couldn't read that.");
  } else input = { character: new URL(request.url).searchParams.get("character") };
  const character = typeof input.character === "string" ? input.character.slice(0, 80) : null;
  return Response.json(await tonightFor(env, user.id, { character, stock: stockOf(input.stock), now: new Date() }),
    { headers: noStore });
}
