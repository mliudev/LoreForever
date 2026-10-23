// Willo's one-click sign-in to the site (lib/weblogin.js). From the companion (X-LF-Client: companion/<version>, no
// Origin, Authorization: Bearer <its device token>):
//   POST /api/companion/web-login {next: "/plans"} -> {url, expires_in}: a one-time link (GET /link/web?t=&next=,
//        functions/link/web.js) that opens the browser signed in to this app's account at `next`. 400 for a `next`
//        that isn't one of the pages Willo may open (lib/weblogin.js safeNext), 401 when the app isn't connected any
//        more. Rate limit: 10 a minute per account.
import { setup, fail, noStore } from "../../../lib/accounts.js";
import { currentDevice } from "../../../lib/devices.js";
import { perMinute, slowDown } from "../../../lib/ratelimit.js";
import { issueWebLogin, safeNext, WEB_LOGIN_SECONDS } from "../../../lib/weblogin.js";
import { isCompanion } from "../../../lib/client-version.js";

const CLIENT = /^companion\/[\w.-]{1,24}$/;

export async function onRequest({ request, env }) {
  if (!env.DB) return fail(503, "Accounts aren't set up yet.");
  if (!isCompanion(request.headers.get("X-LF-Client")) || request.headers.get("Origin"))
    return fail(403, "This is for the Lore Forever companion app.");
  if (request.method !== "POST") return fail(405, "Use POST.");
  await setup(env);
  const app = await currentDevice(env, request);
  if (!app) return fail(401, "This app isn't connected to an account any more.");
  let input = {};
  try { input = await request.json(); } catch (e) { /* no body: the plans */ }
  const next = safeNext(input && typeof input === "object" && "next" in input ? input.next : "/plans");
  if (!next) return fail(400, "That isn't a page Willo can open.");
  if (!(await perMinute(env, app.user.id, "web-login", 10))) return slowDown();
  const url = new URL("/link/web", request.url);
  url.searchParams.set("t", await issueWebLogin(env, app));
  url.searchParams.set("next", next);
  return Response.json({ ok: true, url: url.toString(), expires_in: WEB_LOGIN_SECONDS }, { headers: noStore });
}
