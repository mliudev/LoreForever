// "Claim a zone" on the upload page (LOR-231, lib/claims.js). Listing is public; claiming needs the signed-in account.
//   GET  /api/studio/zones/list?locale=&voice=  {on, zones, locale, mine?}: the zone list for a language (the voice's
//                                               when voice is one of yours, else locale, else English) with who
//                                               claimed what; signed in, also your claims and a suggested zone. on:
//                                               the "zones" feature (lib/features.js), which decides whether the
//                                               upload page shows the zone box (it does with ?zones=1 either way)
//   POST /api/studio/zones/claim                {voice, zone, credit}: claim a zone for one of your voices; credit is
//                                               the name the zone list shows (default: your account's name)
//   POST /api/studio/zones/release              {id}: let your active claim go
// POSTs must come from our own pages (Origin check), like the rest of the upload page's API.

import { setup, currentUser, fail, noStore, sameOrigin } from "../../../../lib/accounts.js";
import { setupStudio, loadLines, ownVoice } from "../../../../lib/studio.js";
import { loadVoices } from "../../../../lib/voices.js";
import { refreshClaims, zoneBoard, myClaims, claimZone, releaseClaim } from "../../../../lib/claims.js";
import { featureOn } from "../../../../lib/features.js";

const ok = (body = {}) => Response.json({ ok: true, ...body }, { headers: noStore });

async function list({ request, env }, user, lines) {
  const q = new URL(request.url).searchParams;
  const voice = user && q.get("voice") ? await ownVoice(env, user, q.get("voice")) : null;
  const want = voice?.locale || q.get("locale") || "enUS";
  const locale = lines.languages.some(l => l.locale === want && l.lines > 0) ? want : "enUS";
  await refreshClaims(env, lines);
  const zones = await zoneBoard(env, lines, locale, await loadVoices(env, request));
  return ok({ on: featureOn(env, "zones"), locale, zones,
              ...(user ? { mine: await myClaims(env, lines, user, voice?.locale ? voice : null) } : {}) });
}

async function claim({ env }, user, lines, input) {
  const voice = await ownVoice(env, user, input.voice);
  const res = await claimZone(env, lines, user, voice, input);
  return res.error ? fail(res.status, res.error) : ok(res);
}

async function release({ env }, user, lines, input) {
  return (await releaseClaim(env, user, input.id)) ? ok() : fail(404, "You have no zone to let go.");
}

const POSTS = { claim, release };

export async function onRequest(context) {
  const { request, env, params } = context;
  const action = String(params.action);
  if (!env.DB) return fail(503, "Zones aren't switched on yet. Please ask on Discord.");
  await setup(env);
  await setupStudio(env);
  const user = await currentUser(env, request);
  const lines = await loadLines(env, request);
  if (request.method === "GET") return action === "list" ? list(context, user, lines) : fail(404, "Not found.");
  if (request.method !== "POST" || !POSTS[action]) return fail(404, "Not found.");
  if (!sameOrigin(request)) return fail(403, "Please use the upload page on loreforeverwow.com.");
  if (!user) return fail(401, "You're signed out. Please sign in again.");
  let input;
  try {
    input = await request.json();
  } catch (e) {
    return fail(400, "Couldn't read that.");
  }
  return POSTS[action](context, user, lines, input);
}
