// Puts one of Willo's one-time downloads (the voice, ears and lore-search models) in R2 so /willo-assets/<sha256>/<file>
// serves it (functions/willo-assets/[sha]/[file].js). scripts/mirror-willo-assets.py calls this with the admin key
// (lib/auth.js). A file can be 500 MB, more than one request may carry, so it goes up in parts (R2 multipart):
//   GET  ?sha256=<hex>&file=<name>                          {exists, bytes}
//   POST ?action=start&sha256=<hex>&file=<name>             {exists: true}, or {uploadId} for a new upload
//   PUT  ?action=part&sha256&file&uploadId&n=<1..>          the part as the body (at most 32 MB): {etag}
//   POST ?action=finish&sha256&file&uploadId                body {parts: [{partNumber, etag}]}: {ok, bytes}
// The object's key holds its SHA-256 and R2 cannot check a multipart upload against it, so the script downloads the
// file back from the public address and hashes it. Nothing here deletes or replaces an object that is there.

import { authorized } from "../../../lib/auth.js";
import { fail, noStore } from "../../../lib/accounts.js";
import { KEY, PREFIX } from "../../willo-assets/[sha]/[file].js";

export const MAX_PART = 32 * 1024 * 1024;
const MAX_PARTS = 40;
const json = body => Response.json(body, { headers: noStore });

export async function onRequest({ request, env }) {
  if (!(await authorized(request, env))) return fail(401, "Needs the admin key.");
  if (!env.STUDIO) return fail(503, "The STUDIO R2 binding isn't set up here.");
  const q = new URL(request.url).searchParams;
  const key = `${(q.get("sha256") || "").toLowerCase()}/${q.get("file") || ""}`;
  if (!KEY.test(key)) return fail(400, "Needs ?sha256=<hex>&file=<name>.");
  const full = PREFIX + key;
  const action = q.get("action") || "";
  if (request.method === "GET" && !action) {
    const head = await env.STUDIO.head(full);
    return json({ exists: Boolean(head), bytes: head ? head.size : 0 });
  }
  if (request.method === "POST" && action === "start") {
    if (await env.STUDIO.head(full)) return json({ exists: true });
    const upload = await env.STUDIO.createMultipartUpload(full, { httpMetadata: { contentType: "application/octet-stream" } });
    return json({ exists: false, uploadId: upload.uploadId });
  }
  const uploadId = q.get("uploadId") || "";
  if (!uploadId) return fail(400, "Needs ?uploadId=.");
  const upload = env.STUDIO.resumeMultipartUpload(full, uploadId);
  if (request.method === "PUT" && action === "part") {
    const n = Number(q.get("n"));
    if (!Number.isInteger(n) || n < 1 || n > MAX_PARTS) return fail(400, `Needs ?n= from 1 to ${MAX_PARTS}.`);
    if (Number(request.headers.get("Content-Length") || 0) > MAX_PART) return fail(413, "That part is too big.");
    const body = await request.arrayBuffer();
    if (body.byteLength > MAX_PART) return fail(413, "That part is too big.");
    const part = await upload.uploadPart(n, body);
    return json({ etag: part.etag });
  }
  if (request.method === "POST" && action === "finish") {
    let parts;
    try { parts = (await request.json()).parts; } catch (e) { parts = null; }
    if (!Array.isArray(parts) || !parts.length || parts.length > MAX_PARTS
        || !parts.every(p => Number.isInteger(p?.partNumber) && typeof p?.etag === "string")) {
      return fail(400, "Needs {parts: [{partNumber, etag}]}.");
    }
    const obj = await upload.complete(parts.map(p => ({ partNumber: p.partNumber, etag: p.etag })));
    return json({ ok: true, bytes: obj.size });
  }
  return fail(405, "Use GET, or POST start/finish, or PUT part.");
}
