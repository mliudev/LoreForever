// /pictures/<id>-<sha>.jpg: one picture of a player's picture book (lib/pictures.js), from R2 (the STUDIO bucket,
// pictures/<user id>/<id>.jpg). The address names the content (sha = the first 10 hex of its SHA-256; a picture sent
// again gets a new one), so browsers may keep it for a year. A hidden (reported) or removed picture, an old address,
// and a picture on a private profile (for anyone but its owner) are 404s. It doesn't wait for the "pictures" feature:
// nothing links here until it's on (or ?pictures=1), and the addresses can't be guessed.

import { setup, currentUser } from "../../lib/accounts.js";
import { fileKey } from "../../lib/pictures.js";

const notFound = () => new Response("Not found.\n", {
  status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
});

export async function onRequest({ request, env, params }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Use GET.\n", { status: 405, headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" } });
  }
  const m = /^([0-9a-f]{16})-([0-9a-f]{10})\.jpg$/.exec(String(params.file || ""));
  if (!m || !env.DB || !env.STUDIO) return notFound();
  await setup(env);
  const row = await env.DB.prepare(
    "SELECT p.id, p.user_id, p.sha, p.hidden, f.public FROM profile_pictures p LEFT JOIN profiles f ON f.user_id = p.user_id " +
    "WHERE p.id = ?"
  ).bind(m[1]).first();
  if (!row || row.hidden || row.sha !== m[2]) return notFound();
  // A private profile's pictures: only its owner, and only their browser keeps them.
  const open = row.public === 1;
  if (!open && (await currentUser(env, request))?.id !== row.user_id) return notFound();
  const headers = {
    "Content-Type": "image/jpeg",
    "Cache-Control": `${open ? "public" : "private"}, max-age=31536000, immutable`,
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex",
    ETag: `"${row.sha}"`,
    ...(open ? {} : { Vary: "Cookie" }),
  };
  if ((request.headers.get("If-None-Match") || "").includes(`"${row.sha}"`)) return new Response(null, { status: 304, headers });
  const key = fileKey(row.user_id, row.id);
  const obj = request.method === "HEAD" ? await env.STUDIO.head(key) : await env.STUDIO.get(key);
  if (!obj) return notFound();
  return new Response(request.method === "HEAD" ? null : obj.body, { headers: { ...headers, "Content-Length": String(obj.size) } });
}
