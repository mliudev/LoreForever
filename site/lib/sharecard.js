// The share card (LOR-150; Harold on it, LOR-266): the picture a link to a public profile shows on Discord, X, Bluesky
// and the rest (og:image), 1200x630. The site draws no images itself: the owner's browser draws the card
// (public/js/card.js, from the facts profilePage puts in #pf-sharecard) when they open their public profile and its
// card is out of date, and sends it to POST /api/profile/card (functions/api/profile/card.js). Owners share from their
// own page, so the card is fresh when it matters. It's kept in R2 (STUDIO) with the picture book, at
// pictures/<user id>/share-card.jpg, so "Delete my profile" (forgetPictures) and "Delete my account" take it along, and
// served at /share/<handle>-<sha>.jpg (functions/share/[file].js): the address names the content. Until a profile has
// one, its links show its newest picture or the site's own card.

import { isJpeg, jpegSize } from "./pictures.js";

export const CARD_W = 1200, CARD_H = 630;
export const CARD_MAX = 512 * 1024;   // a JPEG at q0.9 of the card is about 150 KB
export const CARDS_PER_HOUR = 20;
export const CARD_VERSION = 1;        // raise it when the card's design changes, and every card is drawn again

export const cardFile = userId => `pictures/${userId}/share-card.jpg`;
export const cardUrl = p => p?.card_sha && p.public ? `https://loreforeverwow.com/share/${p.handle}-${p.card_sha}.jpg` : null;

// What a card is drawn from changes when the profile does (updated), its address does (handle), or Harold comes or goes
// (the "companion" feature). The owner's page draws a new card when the profile's key isn't its card's.
export const cardKey = (p, herald) => `${CARD_VERSION}|${p.updated}|${p.handle}|${herald ? 1 : 0}`;

async function sha10(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...d.slice(0, 5)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// Keeps the owner's card for profile `p`, drawn for `key`. Returns {status, error?, sha?}.
export async function saveCard(env, p, key, bytes, herald) {
  if (!p) return { status: 404, error: "Make your profile first." };
  if (!p.public) return { status: 409, error: "Make your profile public first." };
  if (key !== cardKey(p, herald)) return { status: 409, error: "Your profile changed meanwhile. Reload the page." };
  if (!isJpeg(bytes)) return { status: 415, error: "Only a JPEG card, please." };
  const size = jpegSize(bytes);
  if (!size || size.w !== CARD_W || size.h !== CARD_H) return { status: 400, error: `The card is ${CARD_W}x${CARD_H}.` };
  const sha = await sha10(bytes);
  await env.STUDIO.put(cardFile(p.user_id), bytes, { httpMetadata: { contentType: "image/jpeg" } });
  await env.DB.prepare("UPDATE profiles SET card_sha = ?, card_key = ? WHERE user_id = ?").bind(sha, key, p.user_id).run();
  return { status: 200, sha };
}
