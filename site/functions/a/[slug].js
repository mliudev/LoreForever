// /a/<slug>: a tracked link for an article (lib/sources.js, made on /admin). It opens the link's page with
// ?src=<slug>, so the visit counts under it (header.js -> /api/visit), and keeps the slug as the browser's first source
// when it has none yet (the lf_src cookie), so it holds even without scripts. A link that doesn't exist (or was
// retired) opens the home page. Link previews and crawlers aren't counted.

import { BOT } from "../../lib/usage.js";
import { openLink, withSource, firstTouch, firstTouchCookie, countEvent } from "../../lib/sources.js";

export async function onRequestGet({ request, env, params, waitUntil }) {
  const bot = BOT.test(request.headers.get("User-Agent") || "");
  const link = env.DB && !bot ? await openLink(env, params.slug).catch(() => null) : null;
  const headers = new Headers({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex",
    Location: link ? withSource(link.target, link.slug) : "/" });
  if (link && !firstTouch(request)) {
    headers.set("Set-Cookie", firstTouchCookie(request, link.slug, link.target));
    // The browser's first visit, counted here: its page's visit report (functions/api/visit.js) finds this cookie and
    // counts only the visit (QA 10/19: a tracked link showed 1 visit, 0 first visits).
    const counting = countEvent(env, link.slug, link.target, "new");
    if (waitUntil) waitUntil(counting); else await counting;
  }
  return new Response(null, { status: 302, headers });
}
