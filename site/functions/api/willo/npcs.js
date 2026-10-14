// The character search on /willo (LOR-447, lib/willo-custom.js): GET /api/willo/npcs?q=<name> ->
// {npcs: [{npc, name, zone}]}, up to 8 of the lore pages' characters whose name has what was typed, for a Champion's
// tale. Public lore, so no sign-in; 503 while plans are off.

import { fail, noStore } from "../../../lib/accounts.js";
import { plansOn } from "../../../lib/billing.js";
import { loreNpcs, findNpcs } from "../../../lib/willo-custom.js";

export async function onRequest({ request, env }) {
  if (!plansOn(env)) return fail(503, "Plans aren't open yet.");
  if (request.method !== "GET") return fail(405, "Use GET.");
  const q = String(new URL(request.url).searchParams.get("q") || "").slice(0, 80);
  return Response.json({ ok: true, npcs: findNpcs(await loreNpcs(env, request), q) }, { headers: noStore });
}
