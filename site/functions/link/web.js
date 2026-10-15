// GET /link/web?t=<one-time secret>&next=/plans: Willo's one-click sign-in (lib/weblogin.js). The companion opens
// this in the browser after POST /api/companion/web-login. A good link signs the browser in to the app's account
// (the session Google sign-in makes, lib/accounts.js startSession; one for another account is ended first) and
// goes on to `next`. An expired, used or made-up link goes on to `next` when the browser is signed in already, and
// otherwise to the sign-in page (/account?link=expired, which says so in a plain line, then on to `next`). A `next`
// that isn't one of ours (lib/weblogin.js safeNext) signs nobody in and goes to /account.
import { setup, currentUser, startSession, endSession } from "../../lib/accounts.js";
import { safeNext, takeWebLogin } from "../../lib/weblogin.js";

const go = (request, path, cookie) => new Response(null, { status: 303, headers: {
  Location: new URL(path, request.url).toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow", ...(cookie ? { "Set-Cookie": cookie } : {}) } });

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next"));
  if (!next || !env.DB) return go(request, "/account");
  await setup(env);
  const userId = await takeWebLogin(env, url.searchParams.get("t"));
  const signedIn = await currentUser(env, request);
  if (!userId) {
    if (signedIn) return go(request, next);
    // The sign-in page takes `next` without its #anchor, and needs none for itself.
    const back = next.split("#")[0];
    return go(request, `/account?${back === "/account" ? "" : `next=${encodeURIComponent(back)}&`}link=expired`);
  }
  if (signedIn?.id === userId) return go(request, next);
  if (signedIn) await endSession(env, request);
  return go(request, next, await startSession(env, request, userId));
}
