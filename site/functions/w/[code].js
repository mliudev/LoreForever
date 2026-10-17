// /w/<code>: a Share Willo link (lib/referrals.js). It keeps the code in a cookie for COOKIE_DAYS days, so the friend's
// first Willo connect counts for whoever shared it, and goes on to Willo's page, which says who sent them
// (functions/willo.js). An unknown or retired code goes to Willo's page as it is. Link-preview bots get the page
// without a cookie or a click counted.

import { codeOwner, noteClick, shareCookie } from "../../lib/referrals.js";

const BOTS = /bot|crawler|spider|preview|facebookexternalhit|embedly|whatsapp|telegram|slack|discord/i;

export async function onRequestGet({ request, env, params, waitUntil }) {
  const to = new URL("/willo", request.url);
  const headers = new Headers({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Location": to.toString() });
  const owner = env.DB ? await codeOwner(env, params.code).catch(() => null) : null;
  if (owner) {
    to.searchParams.set("shared", owner.code);
    headers.set("Location", to.toString());
    if (!BOTS.test(request.headers.get("User-Agent") || "")) {
      headers.set("Set-Cookie", shareCookie(request, owner.code));
      const counted = noteClick(env, owner.code).catch(() => {});
      if (waitUntil) waitUntil(counted); else await counted;
    }
  }
  return new Response(null, { status: 302, headers });
}
