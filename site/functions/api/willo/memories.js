// "What she remembers about you" (LOR-729, lib/willo-memories.js): the short facts a player told Willo about themselves,
// which she uses in her own answers and which they can see, change and erase on any plan.
//   GET    /api/willo/memories                -> {ok, plan: {id, name}, limits: {text, memories}, count, memories:
//                                               [{id, text, source, status, reason, created, updated}]}, newest first.
//                                               status "rejected" is text the check turned away: it has a reason in plain
//                                               words, is never used in an answer, and can be edited or erased.
//   POST   /api/willo/memories {text}         -> the same plus {memory}: one more. 400 over the plan's room (limits.memories,
//                                               10 free, 50 on a paid plan or in the first-run trial) or for a repeat.
//   PUT    /api/willo/memories {id, text}     -> the same plus {memory}: its words changed (and checked again). 404 when gone.
//   DELETE /api/willo/memories?id=<id>        -> the same: one erased.
//   DELETE /api/willo/memories?all=1          -> the same: every memory erased ("Forget everything").
// A save the check turns away is 422 {ok: false, error: <the reason>, rejected: true, memory, ...the list}; the text is
// kept as a rejected memory. Saves count against the same day's checked saves as /api/willo's (429 past them).
// Auth: a signed-in player (the session cookie, with our Origin on a change) or Willo's app (Authorization: Bearer
// <device token>); both may read and change. Not behind the plans feature. Friends' APIs never read these.

import { setup, currentUser, fail, noStore, sameOrigin } from "../../../lib/accounts.js";
import { currentDevice } from "../../../lib/devices.js";
import { planFor } from "../../../lib/billing.js";
import { trialFor } from "../../../lib/best-first.js";
import { perMinute, slowDown } from "../../../lib/ratelimit.js";
import {
  listMemories, addMemory, editMemory, deleteMemory, forgetMemories, memoriesBlockOf, memoriesMax, MEMORY_MAX,
} from "../../../lib/willo-memories.js";

const CHANGES_PER_MINUTE = 60;
const MAX_BODY_BYTES = 4 * MEMORY_MAX + 1024;

async function readJson(request) {
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return { error: fail(413, "That's too long.") };
    const input = JSON.parse(text || "{}");
    return input && typeof input === "object" && !Array.isArray(input) ? { input } : { error: fail(400, "Couldn't read that.") };
  } catch (e) { return { error: fail(400, "Couldn't read that.") }; }
}

export async function onRequest({ request, env }) {
  if (!env.DB) return fail(503, "Accounts aren't set up yet.");
  await setup(env);
  const method = request.method;
  if (!["GET", "POST", "PUT", "DELETE"].includes(method)) return fail(405, "Use GET, POST, PUT or DELETE.");
  // Willo's app by its token (nothing a page could send for a player), else our page by its session and Origin.
  let user, app = null;
  if (request.headers.get("Authorization")) {
    app = await currentDevice(env, request);
    user = app?.user || null;
  } else {
    if (method !== "GET" && !sameOrigin(request)) return fail(403, "Please use the page on loreforeverwow.com.");
    user = await currentUser(env, request);
  }
  if (!user) return fail(401, "You're signed out. Please sign in again.");
  if (method !== "GET" && !(await perMinute(env, user.id, "memories-change", CHANGES_PER_MINUTE))) return slowDown();

  const plan = await planFor(env, user.id);
  const trial = await trialFor(env, user.id, plan);
  const list = async (extra = {}) => {
    const memories = await listMemories(env, user.id);
    return Response.json({ ok: true, plan: { id: plan.id, name: plan.name },
      limits: { text: MEMORY_MAX, memories: memoriesMax(plan, trial) }, count: memories.length, memories,
      // Willo's app gets the prompt block as answers use it now, for a model on the player's own PC later.
      ...(app ? { block: memoriesBlockOf(memories) } : {}), ...extra }, { headers: noStore });
  };
  if (method === "GET") return list();

  const q = new URL(request.url).searchParams;
  if (method === "DELETE") {
    if (q.get("all") === "1") await forgetMemories(env, user.id);
    else if (!(await deleteMemory(env, user.id, q.get("id")))) return fail(404, "That one's already gone.");
    return list();
  }

  const { input, error } = await readJson(request);
  if (error) return error;
  const done = method === "POST" ? await addMemory(env, user, plan, { text: input.text }, trial)
    : await editMemory(env, user, { id: input.id, text: input.text });
  if (done.rejected) {
    const res = await list({ memory: done.memory });
    return Response.json({ ...(await res.json()), ok: false, error: done.error, rejected: true },
      { status: 422, headers: noStore });
  }
  return done.error ? fail(done.status || 400, done.error) : list({ memory: done.memory });
}
