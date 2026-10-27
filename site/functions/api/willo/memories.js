// "What she remembers about you" (LOR-729, lib/willo-memories.js): the short facts a player told Willo about themselves,
// which she uses in her own answers and which they can see, change and erase on any plan.
//   GET    /api/willo/memories                -> {ok, plan: {id, name}, limits: {text, memories}, count, memories:
//                                               [{id, text, source, status, reason, character, created, updated}]},
//                                               newest first. status "rejected" is text the check turned away: it has a
//                                               reason in plain words, is never used in an answer, and can be edited or
//                                               erased. character: the add-on's "Name-Realm" of the one character it's
//                                               about, or null for the whole account.
//   POST   /api/willo/memories {text, character?, asked?}
//                                            -> the same plus {memory}: one more. 400 over the plan's room (limits.memories,
//                                               10 free, 50 on a paid plan or in the first-run trial), or for a repeat
//                                               (with already: the memory it repeats). asked: true when the player asked
//                                               her for it (her app's memory.remember): turned-away text isn't kept then.
//   POST   /api/willo/memories {restore: [ids]}
//                                            -> the same plus {restored}: forgotten ones put back as they were (Undo),
//                                               within an hour of forgetting, with no check and no save spent.
//   PUT    /api/willo/memories {id, text}     -> the same plus {memory}: its words changed (and checked again). 404 when gone.
//   DELETE /api/willo/memories?id=<id>[,<id>] -> the same plus {forgotten}: those forgotten (Undo: restore). 404 when none.
//   DELETE /api/willo/memories?all=1          -> the same plus {forgotten}: every memory forgotten ("Forget everything").
// A save the check turns away is 422 {ok: false, error: <the reason>, rejected: true, memory, ...the list}; the text is
// kept as a rejected memory unless asked. Saves count against the same day's checked saves as /api/willo's (429 past them).
// Auth: a signed-in player (the session cookie, with our Origin on a change) or Willo's app (Authorization: Bearer
// <device token>); both may read and change. Not behind the plans feature. Friends' APIs never read these.

import { setup, currentUser, fail, noStore, sameOrigin } from "../../../lib/accounts.js";
import { currentDevice } from "../../../lib/devices.js";
import { planFor } from "../../../lib/billing.js";
import { trialFor } from "../../../lib/best-first.js";
import { perMinute, slowDown } from "../../../lib/ratelimit.js";
import {
  listMemories, addMemory, editMemory, forgetMemories, restoreMemories, memoriesBlockOf, memoriesMax, MEMORY_MAX,
} from "../../../lib/willo-memories.js";

const CHANGES_PER_MINUTE = 60;
const MAX_BODY_BYTES = 4 * MEMORY_MAX + 1024;
const MAX_IDS = 60;
const idsOf = value => (Array.isArray(value) ? value : String(value ?? "").split(","))
  .map(id => String(id).trim()).filter(Boolean).slice(0, MAX_IDS);

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
  const list = async (extra = {}, status = 200) => {
    const memories = await listMemories(env, user.id);
    return Response.json({ ok: status < 400, plan: { id: plan.id, name: plan.name },
      limits: { text: MEMORY_MAX, memories: memoriesMax(plan, trial) }, count: memories.length, memories,
      // Willo's app gets the prompt block as answers use it now, for a model on the player's own PC later.
      ...(app ? { block: memoriesBlockOf(memories) } : {}), ...extra }, { status, headers: noStore });
  };
  if (method === "GET") return list();

  const q = new URL(request.url).searchParams;
  if (method === "DELETE") {
    const forgotten = await forgetMemories(env, user.id, q.get("all") === "1" ? { all: true } : { ids: idsOf(q.get("id")) });
    if (!forgotten.length && q.get("all") !== "1") return fail(404, "That one's already gone.");
    return list({ forgotten });
  }

  const { input, error } = await readJson(request);
  if (error) return error;
  if (method === "POST" && "restore" in input) {
    const restored = await restoreMemories(env, user.id, idsOf(input.restore));
    return restored.length ? list({ restored }) : fail(404, "That can't be brought back now.");
  }
  const done = method === "POST"
    ? await addMemory(env, user, plan, { text: input.text, character: input.character, asked: input.asked === true }, trial)
    : await editMemory(env, user, { id: input.id, text: input.text });
  if (done.rejected) return list({ error: done.error, rejected: true, memory: done.memory }, 422);
  if (done.already) return list({ error: done.error, already: done.already }, 400);
  return done.error ? fail(done.status || 400, done.error) : list({ memory: done.memory });
}
