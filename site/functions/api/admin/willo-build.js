// A preview's Willo test build (lib/willo.js willoPreview): scripts/upload-willo-preview.sh puts a Willo-Setup.exe in
// this deployment's R2 (STUDIO) with the admin key (lib/auth.js), and /willo, /downloads and /download/willo offer it
// until a release carries one. Previews only: loreforeverwow.com refuses, and never offers one.
//   PUT /api/admin/willo-build?sha256=<hex>&version=<0.18.0-qa>   admin: the .exe as the body (at most 300 MB)
//     -> {ok, key, bytes}: stored at willo/<sha256>/Willo-Setup.exe, and willo/preview.json now points at it

import { authorized } from "../../../lib/auth.js";
import { fail } from "../../../lib/accounts.js";
import { PREVIEW_KEY, WILLO_FILE } from "../../../lib/willo.js";

const MAX_BYTES = 300 * 1024 * 1024;
const SHA256 = /^[0-9a-f]{64}$/;

export async function onRequestPut({ request, env }) {
  if (new URL(request.url).hostname === "loreforeverwow.com") return fail(403, "Test builds are for previews only.");
  if (!(await authorized(request, env))) return fail(401, "Needs the admin key.");
  if (!env.STUDIO) return fail(503, "The STUDIO R2 binding isn't set up here.");
  const q = new URL(request.url).searchParams;
  const sha = (q.get("sha256") || "").toLowerCase();
  const version = (q.get("version") || "").slice(0, 40);
  if (!SHA256.test(sha) || !/^[0-9A-Za-z.+-]+$/.test(version)) return fail(400, "Needs ?sha256=<hex>&version=<x.y.z-qa>.");
  if (Number(request.headers.get("Content-Length") || 0) > MAX_BYTES) return fail(413, "That's too big for Willo-Setup.exe.");
  const body = await request.arrayBuffer();
  const head = new Uint8Array(body, 0, Math.min(2, body.byteLength));
  if (body.byteLength > MAX_BYTES || head[0] !== 0x4d || head[1] !== 0x5a) return fail(415, "That isn't a Windows program.");
  const key = `willo/${sha}/${WILLO_FILE}`;
  try {
    await env.STUDIO.put(key, body, { sha256: sha, httpMetadata: { contentType: "application/vnd.microsoft.portable-executable" } });
  } catch (e) {
    return fail(400, "The file doesn't match its sha256.");
  }
  await env.STUDIO.put(PREVIEW_KEY, JSON.stringify({ key, sha256: sha, bytes: body.byteLength, version,
    uploaded: new Date().toISOString() }), { httpMetadata: { contentType: "application/json" } });
  return Response.json({ ok: true, key, bytes: body.byteLength }, { headers: { "Cache-Control": "no-store" } });
}
