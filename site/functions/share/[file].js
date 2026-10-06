// /share/<handle>-<sha>.jpg: a public profile's share card (lib/sharecard.js, LOR-150), from R2 (the STUDIO bucket,
// pictures/<user id>/share-card.jpg). Profile pages name it in og:image. The address names the content (sha = the first
// 10 hex of its SHA-256; a new card gets a new one), so it may be kept for a year. A private profile, an old card's
// address, and anything else are 404s.

import { setup } from "../../lib/accounts.js";
import { profileByHandle, setupProfiles } from "../../lib/profiles.js";
import { cardFile } from "../../lib/sharecard.js";

const notFound = () => new Response("Not found.\n", {
  status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
});

export async function onRequest({ request, env, params }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Use GET.\n", { status: 405, headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" } });
  }
  const m = /^([a-z0-9-]{1,40})-([0-9a-f]{10})\.jpg$/.exec(String(params.file || ""));
  if (!m || !env.DB || !env.STUDIO) return notFound();
  await setup(env);
  await setupProfiles(env);
  const p = await profileByHandle(env, m[1]);
  if (!p || !p.public || p.card_sha !== m[2]) return notFound();
  const headers = {
    "Content-Type": "image/jpeg",
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex",
    ETag: `"${p.card_sha}"`,
  };
  if ((request.headers.get("If-None-Match") || "").includes(`"${p.card_sha}"`)) return new Response(null, { status: 304, headers });
  const key = cardFile(p.user_id);
  const obj = request.method === "HEAD" ? await env.STUDIO.head(key) : await env.STUDIO.get(key);
  if (!obj) return notFound();
  return new Response(request.method === "HEAD" ? null : obj.body, { headers: { ...headers, "Content-Length": String(obj.size) } });
}
