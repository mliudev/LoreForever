// Willo, your way (LOR-447, lib/willo-custom.js): how Willo talks to a paying player, and a Champion's own tales; a new
// player tries both in their first-run trial's days (lib/best-first.js; trial: {until?} while they last).
//   GET    /api/willo -> {plan: {id, name}, allowed, presets: [{id, name, blurb}], limits: {style, tale, tales}, style:
//                        {preset, text, status, reason}, tales: [{npc, name, zone, text, status, reason, updated}]}. With
//                        the companion's token, also blocks: {willo, tales?}, the prompt blocks answers use now (LOR-448).
//   PUT    /api/willo {kind: "style", preset, text?} or {kind: "tale", npc, text} -> the same as GET, or {error}: 422
//                     with the check's reason when it turns the text away (saved as rejected, with the rest of the GET)
//   DELETE /api/willo?kind=style (back to Classic) or ?kind=tale&npc=npc:... -> the same as GET
// GET takes a signed-in player or the companion's device token; PUT and DELETE need a signed-in player and our Origin.
// 503 while plans are off.

import { setup, currentUser, fail, noStore, sameOrigin } from "../../lib/accounts.js";
import { currentDevice } from "../../lib/devices.js";
import { plansOn, planFor } from "../../lib/billing.js";
import { trialFor } from "../../lib/best-first.js";
import {
  getCustom, saveCustom, deleteCustom, composedBlocks, loreNpcs, allowedFor, talesMax, PRESETS, STYLE_MAX, TALE_MAX,
} from "../../lib/willo-custom.js";

// What the page shows: the account's plan and what it saved, each tale with its character's name and zone, and the
// first-run trial while its days last.
async function view(env, request, user, plan, trial) {
  const [custom, npcs] = await Promise.all([getCustom(env, user, plan, trial), loreNpcs(env, request)]);
  return {
    plan: { id: plan.id, name: plan.name },
    ...(trial?.on ? { trial: trial.until ? { until: trial.until } : {} } : {}),
    presets: Object.entries(PRESETS).map(([id, p]) => ({ id, name: p.name, blurb: p.blurb })),
    limits: { style: STYLE_MAX, tale: TALE_MAX, tales: talesMax(plan, trial) },
    ...custom,
    tales: custom.tales.map(t => ({ ...t, ...(npcs.get(t.npc) || {}) })),
  };
}

export async function onRequest({ request, env }) {
  if (!plansOn(env)) return fail(503, "Plans aren't open yet.");
  if (!env.DB) return fail(503, "Accounts aren't set up yet.");
  await setup(env);
  const method = request.method;
  if (!["GET", "PUT", "DELETE"].includes(method)) return fail(405, "Use GET, PUT or DELETE.");
  if (method !== "GET" && !sameOrigin(request)) return fail(403, "Please use the page on loreforeverwow.com.");
  let user = await currentUser(env, request), app = null;
  if (!user && method === "GET") {
    app = await currentDevice(env, request);
    user = app?.user || null;
  }
  if (!user) return fail(401, "You're signed out. Please sign in again.");
  const plan = await planFor(env, user.id);
  const trial = await trialFor(env, user.id, plan);
  const ok = async (extra = {}) => Response.json({ ok: true, ...await view(env, request, user, plan, trial), ...extra },
    { headers: noStore });

  if (method === "GET") return ok(app ? { blocks: await composedBlocks(env, user.id, plan, trial) } : {});

  if (method === "DELETE") {
    const q = new URL(request.url).searchParams;
    await deleteCustom(env, user, { kind: q.get("kind"), target: q.get("npc") });
    return ok();
  }

  let input;
  try { input = await request.json(); } catch (e) { return fail(400, "Couldn't read that."); }
  if (!input || typeof input !== "object") return fail(400, "Couldn't read that.");
  if (input.kind === "tale" && allowedFor(plan, trial).includes("tales")) {
    // A tale is for a character with a lore page, when the lore index is there to say so.
    const npcs = await loreNpcs(env, request);
    if (npcs.size && !npcs.has(String(input.npc ?? ""))) return fail(400, "We don't have that character's story yet.");
  }
  const saved = await saveCustom(env, user, plan,
    { kind: input.kind, target: input.npc, preset: input.preset, text: input.text }, trial);
  if (saved.rejected) {
    return Response.json({ ok: false, error: saved.error, rejected: true, ...await view(env, request, user, plan, trial) },
      { status: 422, headers: noStore });
  }
  return saved.error ? fail(saved.status || 400, saved.error) : ok();
}
