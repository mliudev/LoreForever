// /u/<handle>: a player's profile (lib/profiles.js, LOR-181). Anyone can open a public one; a private one only its
// owner, who also gets the bar to make it public, share it and view it as a visitor. Everyone else gets "No profile
// here" (404), whether it's private or doesn't exist. /u/me goes to your own profile, or to /account to make one.
// Signed in, the header shows you so from the start (lib/voices.js siteNav), so the page is private to you.

import { setup, currentUser } from "../../lib/accounts.js";
import { profileOf, profileByHandle, profilePage, missingPage, visitorBar, publicLinks } from "../../lib/profiles.js";
import { contributionBadges } from "../../lib/credits.js";
import { loadLinks } from "../../lib/trails.js";
import { featureOn } from "../../lib/features.js";
import { listPictures } from "../../lib/pictures.js";
import { storyVoice, listenBox } from "../../lib/storyvoice.js";
import { historyEnabled, historyPage } from "../../lib/history.js";
import { escape } from "../../lib/voices.js";
import { countSite, BOT } from "../../lib/usage.js";

const html = (body, status, cache) => new Response(body, {
  status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": cache, "Vary": "Cookie" },
});

export async function onRequestGet({ request, env, params, waitUntil }) {
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
  if (!p || (!p.public && !owner)) return html(missingPage(handle, { viewer }), 404, "no-store");
  // View as a visitor (LOR-302): ?as=visitor shows the owner what everyone else gets, with a bar to go back; anyone
  // else is a visitor already. A private one is "No profile here" for visitors, so that's what the owner sees too.
  // The header still shows them signed in: they are.
  const url = new URL(request.url);
  const asVisitor = owner && url.searchParams.get("as") === "visitor";
  const query = url.searchParams.get("pictures") === "1" ? "pictures=1" : "";
  if (asVisitor && !p.public) {
    return html(missingPage(handle, { bar: visitorBar(p, query), viewer }), 200, "private, no-store");
  }
  // The share loop (LOR-151): someone else opened it, and whether a link from outside the site brought them. Only the
  // day's numbers (lib/usage.js countSite); not its owner, link previews, prefetches or paging through saved history.
  const prefetch = /prefetch|prerender/i.test(request.headers.get("Sec-Purpose") || request.headers.get("Purpose") || "");
  if (!owner && !prefetch && !url.searchParams.has("history") && !BOT.test(request.headers.get("User-Agent") || "")) {
    let outside = true;
    try { outside = new URL(request.headers.get("Referer")).origin !== url.origin; } catch (e) { /* none: typed or pasted */ }
    const counting = countSite(env, outside ? ["profile.view", "profile.outside"] : ["profile.view"]).catch(() => {});
    if (waitUntil) waitUntil(counting); else await counting;
  }
  const user = await env.DB.prepare("SELECT links FROM users WHERE id = ?").bind(p.user_id).first();
  const badges = await contributionBadges(env, request, p.user_id);   // Narrator, Translator, Contributed N lines (LOR-239)
  // The journey's trails and lore links (LOR-248); names link to lore pages once those are on (the "lore" feature).
  const names = await loadLinks(env, request);
  // The picture book (lib/pictures.js) once the "pictures" feature is on; ?pictures=1 shows it before.
  const book = featureOn(env, "pictures") || Boolean(query);
  const pictures = book ? await listPictures(env, p.user_id) : null;
  // The story read aloud (lib/storyvoice.js, LOR-316) once the "storyvoice" feature is on: opening the page records a
  // new story in the background.
  const voice = await storyVoice(env, p, { kick: true, origin: url.origin, waitUntil });
  const listen = listenBox(voice, { owner: owner && !asVisitor, name: p.data.name, handle: p.handle });
  let historyJourney = null, historyLinks = "";
  if (historyEnabled(env)) {
    const archived = url.searchParams.get("history") === "1";
    const page = await historyPage(env, p, { before: archived ? url.searchParams.get("before") || "" : "",
      limit: archived ? 250 : 1 });
    if (!page) return html(missingPage(handle, { viewer }), 400, "no-store");
    if (page.records.length) {
      const base = `/u/${encodeURIComponent(p.handle)}`;
      if (archived) historyJourney = { v: 1, tz: 0, moments: page.records.map(r => ({
        ...r.moment, tz: r.tz,
      })).sort((a, b) => a.t - b.t) };
      historyLinks = `<nav class="pf-history" aria-label="Saved history">
        <a href="${base}?history=1#timeline">${archived ? "Newest saved moments" : "Browse saved history"}</a>
        ${archived && page.next ? `<a rel="next" href="${base}?history=1&amp;before=${escape(encodeURIComponent(page.next))}#timeline">Older saved moments</a>` : ""}
        ${archived ? `<a href="${base}#timeline">Back to profile</a>` : ""}
        ${owner && !asVisitor ? '<a href="/api/profile/history?export=1" data-history-export>Download history page</a><span data-history-export-status role="status" aria-live="polite"></span>' : ""}
      </nav>`;
    }
  }
  return html(profilePage(p, { links: publicLinks(user), owner: owner && !asVisitor, asVisitor, query, badges, names,
    lore: featureOn(env, "lore"), pictures, viewer, herald: featureOn(env, "companion"), listen, historyLinks, historyJourney }), 200,
    viewer ? "private, no-store" : "no-cache");
}
