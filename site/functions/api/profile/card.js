// POST /api/profile/card: the owner's page sends its profile's share card (lib/sharecard.js, LOR-150), drawn by
// public/js/card.js. The body is the JPEG itself (Content-Type: image/jpeg, at most CARD_MAX), X-Card-Key says which
// version of the profile it was drawn from (cardKey). Only from our own pages (Origin), with a session, for a public
// profile. 409 when the profile changed meanwhile or isn't public; the page draws again next time.

import { setup, currentUser, fail, noStore, sameOrigin } from "../../../lib/accounts.js";
import { profileOf, setupProfiles } from "../../../lib/profiles.js";
import { featureOn } from "../../../lib/features.js";
import { perHour } from "../../../lib/ratelimit.js";
import { saveCard, CARD_MAX, CARDS_PER_HOUR } from "../../../lib/sharecard.js";

async function readCapped(request, max) {
  if (Number(request.headers.get("Content-Length") || 0) > max) return null;
  const bytes = new Uint8Array(await request.arrayBuffer());
  return bytes.length > max ? null : bytes;
}

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return fail(405, "Use POST.");
  if (!env.DB || !env.STUDIO) return fail(503, "Share cards aren't set up here.");
  if (!sameOrigin(request)) return fail(403, "Please use the page on loreforeverwow.com.");
  await setup(env);
  await setupProfiles(env);
  const user = await currentUser(env, request);
  if (!user) return fail(401, "You're signed out. Please sign in again.");
  if (!/^image\/jpeg$/i.test(request.headers.get("Content-Type") || "")) return fail(415, "Only a JPEG card, please.");
  if (!(await perHour(env, user.id, "share-card", CARDS_PER_HOUR))) return fail(429, "Too many cards this hour.");
  const bytes = await readCapped(request, CARD_MAX);
  if (bytes === null) return fail(413, "That card is too big.");
  const p = await profileOf(env, user.id);
  const r = await saveCard(env, p, String(request.headers.get("X-Card-Key") || ""), bytes, featureOn(env, "companion"));
  return r.status === 200 ? Response.json({ ok: true, url: `/share/${p.handle}-${r.sha}.jpg` }, { headers: noStore })
    : fail(r.status, r.error);
}
