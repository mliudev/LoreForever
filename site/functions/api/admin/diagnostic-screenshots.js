import { authorized } from "../../../lib/auth.js";
import { sameOrigin } from "../../../lib/accounts.js";
import { setupDiagnostics, sweepDiagnostics, PRIVATE } from "../../../lib/diagnostic-screenshots.js";

// Direct owner/QA access only. Deliberately not in dashboard-admin-contract's viewer queries.
export async function onRequest({ request, env }) {
  const json = (body, status = 200) => Response.json(body, { status, headers: PRIVATE });
  if (request.headers.has("Origin") && !sameOrigin(request)) return json({ ok: false }, 403);
  if (!(await authorized(request, env))) return json({ ok: false }, 401);
  if (!env.DB || !env.STUDIO) return json({ ok: false }, 503);
  if (request.method === "POST") {
    await sweepDiagnostics(env, new Date(), { force: true });
    return json({ ok: true });
  }
  if (request.method !== "GET") return json({ ok: false }, 405);
  await setupDiagnostics(env);
  const rows = (await env.DB.prepare("SELECT ref, created, reason, sha, question, answer, model, ctx, zone, sub, spoken, say, " +
    "operation FROM diagnostic_screenshots WHERE state='ready' ORDER BY created DESC LIMIT 350").all()).results;
  return json({ ok: true, rows });
}
