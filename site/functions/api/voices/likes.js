// GET /api/voices/likes: {"likes": {"<voice id>": n, ...}}, every voice's total thumbs-up. Public, counts only.

import { likeCounts } from "../../../lib/voices.js";

export async function onRequestGet({ env }) {
  return Response.json({ likes: await likeCounts(env) }, { headers: { "Cache-Control": "no-store" } });
}
