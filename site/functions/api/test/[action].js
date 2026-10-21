// Test players, on develop only (lib/test-players.js). Anywhere testPlayersOn says no (the live site, Production, a
// host that isn't develop, preview or local), every action answers 404 as if it weren't here.
//   GET  /api/test/status               -> {on: true, players: [{key, name}]}
//   POST /api/test/sign-in  {who, offset?}  -> signs this browser in as that test player (mira, doran or brann): {user}
//   POST /api/test/friends  {offset?}   -> the signed-in account befriends Mira and Doran: {added: [{name, handle}]}
// offset: the page's minutes from UTC (-new Date().getTimezoneOffset()), for the day on Mira's pins.
//   POST /api/test/accept   {who}       -> that test player accepts the friend requests waiting for them: {accepted}
// POSTs need our Origin; 30 a minute from one address.

import { setup, currentUser, startSession, recordTerms, fail, noStore, sameOrigin } from "../../../lib/accounts.js";
import { perMinute, slowDown } from "../../../lib/ratelimit.js";
import { testPlayersOn, testPlayer, befriendTestPlayers, acceptAsTestPlayer, offsetOf, TEST_PLAYERS } from "../../../lib/test-players.js";

const ok = (body = {}, headers = {}) => Response.json({ ok: true, ...body }, { headers: { ...noStore, ...headers } });

export async function onRequest({ request, env, params }) {
  const action = String(params.action);
  if (!testPlayersOn(env, request) || !env.DB) return fail(404, "Not found.");
  await setup(env);
  if (action === "status" && request.method === "GET")
    return ok({ on: true, players: Object.entries(TEST_PLAYERS).map(([key, p]) => ({ key, name: p.name })) });
  if (!["sign-in", "friends", "accept"].includes(action)) return fail(404, "Not found.");
  if (request.method !== "POST") return fail(405, "Use POST.");
  if (!sameOrigin(request)) return fail(403, "Please use the page on this site.");
  if (!(await perMinute(env, "ip:" + (request.headers.get("CF-Connecting-IP") || "local"), "test-players", 30))) return slowDown();
  let input = {};
  try { input = await request.json(); } catch (e) { input = {}; }
  const who = String(input?.who || "").toLowerCase(), offset = offsetOf(input?.offset);
  if (action === "sign-in") {
    const player = await testPlayer(env, who, Date.now(), { offset });
    if (!player) return fail(400, "That isn't one of the test players.");
    await recordTerms(env, player.id);
    const user = await env.DB.prepare("SELECT id, email, display_name FROM users WHERE id = ?").bind(player.id).first();
    return ok({ user: { ...user, handle: player.handle } }, { "Set-Cookie": await startSession(env, request, player.id) });
  }
  if (action === "accept") {
    if (!Object.hasOwn(TEST_PLAYERS, who)) return fail(400, "That isn't one of the test players.");
    return ok({ accepted: await acceptAsTestPlayer(env, who) });
  }
  const user = await currentUser(env, request);
  if (!user) return fail(401, "Sign in first.");
  return ok({ added: await befriendTestPlayers(env, user.id, Date.now(), { offset }) });
}
