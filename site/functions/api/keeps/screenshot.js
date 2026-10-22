import { setup, currentUser } from "../../../lib/accounts.js";
import { authorized } from "../../../lib/auth.js";
import { readScreenshot, PRIVATE } from "../../../lib/diagnostic-screenshots.js";
import { ANSWER_ID } from "../../../lib/answer-signals.js";

// No dashboard bridge, public media URL, new role, or shared cache.
export async function onRequestGet({ env, request }) {
  const missing = () => new Response("Not found", { status: 404, headers: PRIVATE });
  const ref = new URL(request.url).searchParams.get("ref");
  if (!ANSWER_ID.test(ref || "") || !env.DB || !env.STUDIO) return missing();
  await setup(env);
  const qa = await authorized(request, env);
  const user = qa ? null : await currentUser(env, request);
  const kept = await readScreenshot(env, ref, { userId: user?.id, qa });
  if (!kept) return missing();
  if (new URL(request.url).searchParams.get("context") === "1") {
    const { ref, answer_id, question, answer, model, ctx, zone, sub, spoken, say, operation, created, sha } = kept.row;
    return Response.json({ ref, answer_id, question, answer, model, ctx, zone, sub, spoken, say, operation, created, sha,
      representation: "Exact model-supplied JPEG; only the app's own info strip and sky painted over. Text uses the answer log's name scrubbing." },
    { headers: PRIVATE });
  }
  return new Response(kept.object.body, { headers: { ...PRIVATE, "Content-Type": "image/jpeg" } });
}
