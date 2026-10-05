// Takes an address off the email list, from /unsubscribe (public/unsubscribe.html). Self-serve: no account and no
// confirmation email. It answers "Done" whether or not the address was on the list, so the form can't tell anyone
// who's on it.
//   POST /api/unsubscribe  {"email": "..."}  -> {"ok": true}, or {"ok": false, "error": ...} for a bad address, a post
//                          from another site or too many tries (PER_DAY.unsubscribe per sender per day,
//                          lib/subscribers.js). A plain form post (the page without JavaScript) gets a short page.
// Same guards as /api/subscribe: our own pages only (Origin), a hidden field for bots, and the daily cap.

import { sameOrigin } from "../../lib/accounts.js";
import { perDayFromIp } from "../../lib/ratelimit.js";
import { SETUP, PER_DAY, listEmail } from "../../lib/subscribers.js";

const DONE = "Done. That address won't get any more emails from us.";
const NO_STORE = { "Cache-Control": "no-store" };

// Without JavaScript the form posts here directly, so the answer comes back as a page of its own.
function page(status, text) {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Unsubscribe - Lore Forever</title>
<link rel="icon" href="/img/logo.svg" type="image/svg+xml"><link rel="stylesheet" href="/style.css"></head>
<body><header class="top"><div class="wrap"><span class="crumb"><a href="/">Lore Forever</a> &rsaquo;
Unsubscribe</span></div></header>
<main class="wrap fb-page"><h1>Unsubscribe</h1>
<div class="fb-done"><p>${text}</p>
<p><a href="${status === 200 ? "/" : "/unsubscribe"}">${status === 200 ? "Back to Lore Forever" : "Try again"}</a></p></div>
</main></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE } });
}

export async function onRequestPost({ request, env }) {
  const json = (request.headers.get("Content-Type") || "").includes("application/json");
  const { status, error } = await remove(request, env, json);
  if (json) return Response.json(error ? { ok: false, error } : { ok: true, message: DONE }, { status: status || 200, headers: NO_STORE });
  return page(status || 200, error || DONE);
}

// Returns {} once the address is off the list (or never was on it), or {status, error}.
async function remove(request, env, json) {
  if (!sameOrigin(request)) return { status: 403, error: "Please use the form on loreforeverwow.com." };
  let input;
  try {
    input = json ? await request.json() : Object.fromEntries(await request.formData());
  } catch (e) {
    return { status: 400, error: "Couldn't read the form." };
  }
  if (input.website) return {};   // hidden field only bots fill in
  const email = listEmail(input.email);
  if (!email) return { status: 400, error: "That email address doesn't look right." };
  if (!env.DB) return {};
  if (!(await perDayFromIp(env, request, "unsubscribe", PER_DAY.unsubscribe))) {
    return { status: 429, error: "That's a lot of tries for one day. Please try again tomorrow, or ask us on Discord." };
  }
  await env.DB.batch([
    env.DB.prepare(SETUP),
    env.DB.prepare("DELETE FROM subscribers WHERE email = ?").bind(email),
  ]);
  return {};
}
