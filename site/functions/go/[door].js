// /go/willo?next=/account and /go/lore?next=/account: a link from one front door to the other that keeps the browser
// signed in (lib/doors.js carryTo; each domain keeps its own sign-in cookie). /go/in?c=<code>&next=<path> is where
// it lands: it takes the one-time code once, signs this browser in to that account (as Google sign-in does,
// lib/accounts.js startSession; one for another account is ended first) and goes on to `next`. A used, expired or
// made-up code still goes on to `next`, signed out.
import { currentUser, startSession, endSession } from "../../lib/accounts.js";
import { carryTo, safePath, takeCarry } from "../../lib/doors.js";

const go = (request, path, cookie) => new Response(null, { status: 303, headers: {
  Location: new URL(path, request.url).toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow", ...(cookie ? { "Set-Cookie": cookie } : {}) } });

export async function onRequestGet({ request, env, params }) {
  if (params.door !== "in") return carryTo(request, env, params.door);
  const url = new URL(request.url);
  const next = safePath(url.searchParams.get("next")) || "/";
  if (!env.DB) return go(request, next);
  const userId = await takeCarry(env, url.searchParams.get("c"));
  if (!userId) return go(request, next);
  const signedIn = await currentUser(env, request);
  if (signedIn?.id === userId) return go(request, next);
  if (signedIn) await endSession(env, request);
  return go(request, next, await startSession(env, request, userId));
}
