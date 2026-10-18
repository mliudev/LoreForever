// GET /api/contributions: everything the signed-in player sent (translation edits and files, shared Forever text, voices,
// reports on recordings), each with what became of it, for "My contributions" on /account (LOR-621; lib/contributions.js).
// Only the player's own items. Signed out: 401.

import { setup, currentUser, fail, noStore } from "../../lib/accounts.js";
import { setup as setupContrib } from "../../lib/contribute.js";
import { mine } from "../../lib/contributions.js";

export async function onRequestGet({ request, env }) {
  if (!env.DB) return fail(503, "Accounts aren't set up yet.");
  await setup(env);
  const user = await currentUser(env, request);
  if (!user) return fail(401, "Sign in to see your contributions.");
  try { await setupContrib(env); } catch (e) { /* no shared text yet */ }
  return Response.json({ ok: true, ...(await mine(env, user, { request })) }, { headers: noStore });
}
