// A previously supplied answer image, resent only after the report response requests it.
import { setup, fail, noStore } from "../../../lib/accounts.js";
import { currentDevice } from "../../../lib/devices.js";
import { retainScreenshot, storageReady } from "../../../lib/diagnostic-screenshots.js";
import { perMinute } from "../../../lib/ratelimit.js";
import { ANSWER_ID } from "../../../lib/answer-signals.js";
import { isCompanion } from "../../../lib/client-version.js";

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB || !env.STUDIO || !storageReady(env) || !context.waitUntil) return fail(503, "Screenshot storage is unavailable.");
  if (!isCompanion(request.headers.get("X-LF-Client")) ||request.headers.has("Origin"))
    return fail(403, "Use the companion app.");
  await setup(env);
  const app = await currentDevice(env, request);
  if (!app) return fail(401, "Connect the companion first.");
  // Before the body is read or parsed (the privacy review, 10/21).
  if (!(await perMinute(env, app.user.id, "diagnostic", 6))) return fail(429, "Too many images just now.");
  // Stream limit, including requests without Content-Length.
  const reader = request.body?.getReader();
  if (!reader) return fail(400, "Missing image.");
  const chunks = []; let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 202_000) { await reader.cancel(); return fail(413, "Image too large."); }
    chunks.push(value);
  }
  let body;
  try {
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch { return fail(400, "Invalid image request."); }
  if (typeof body?.answer_id !== "string" || !ANSWER_ID.test(body.answer_id)) return fail(400, "Missing answer reference.");
  // The library checks the server-recorded report, receipt, consent, digest and owner again.
  context.waitUntil(retainScreenshot(env, app.user.id, body.answer_id, body.image).catch(() => false));
  return Response.json({ ok: true }, { status: 202, headers: noStore });
}
