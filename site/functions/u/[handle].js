// /u/<handle>: a player's profile (lib/profiles.js, LOR-181). Anyone can open a public one; a private one only its
// owner, who also gets the bar to make it public. Everyone else gets "No profile here" (404), whether it's private or
// doesn't exist. /u/me goes to your own profile, or to /account to make one.

import { setup, currentUser } from "../../lib/accounts.js";
import { profileOf, profileByHandle, profilePage, missingPage, publicLinks } from "../../lib/profiles.js";
import { contributionBadges } from "../../lib/credits.js";
import { loadLinks } from "../../lib/trails.js";
import { featureOn } from "../../lib/features.js";

const html = (body, status, cache) => new Response(body, {
  status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": cache, "Vary": "Cookie" },
});

export async function onRequestGet({ request, env, params }) {
  const handle = String(params.handle || "").toLowerCase();
  if (!env.DB) return html(missingPage(handle), 404, "no-store");
  await setup(env);
  const viewer = await currentUser(env, request);
  if (handle === "me") {
    const mine = viewer && await profileOf(env, viewer.id);
    return Response.redirect(new URL(mine ? `/u/${mine.handle}` : "/account#profile", request.url).toString(), 302);
  }
  const p = /^[a-z0-9-]{1,40}$/.test(handle) ? await profileByHandle(env, handle) : null;
  const owner = Boolean(p && viewer && viewer.id === p.user_id);
  if (!p || (!p.public && !owner)) return html(missingPage(handle), 404, "no-store");
  const user = await env.DB.prepare("SELECT links FROM users WHERE id = ?").bind(p.user_id).first();
  const badges = await contributionBadges(env, request, p.user_id);   // Narrator, Translator, Contributed N lines (LOR-239)
  // The journey's trails and lore links (LOR-248); names link to lore pages once those are on (the "lore" feature).
  const names = await loadLinks(env, request);
  return html(profilePage(p, { links: publicLinks(user), owner, badges, names, lore: featureOn(env, "lore") }), 200,
    owner ? "private, no-store" : "no-cache");
}
