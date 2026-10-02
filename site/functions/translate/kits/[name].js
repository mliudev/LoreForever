// Translator kit downloads, /translate/kits/<locale>.zip and /translate/kits/new.zip, linked from
// public/translate/languages.json and the /translate pages. The zips are in R2, not in git (lib/kits.js).
//   GET|HEAD /translate/kits/deDE.zip             the kit this deployment's languages.json links to (its kitSha256)
//   GET|HEAD /translate/kits/deDE.zip?v=<sha256>  that exact kit
// If this deployment's bucket doesn't have it: anywhere but loreforeverwow.com (a preview, whose Preview bucket only
// has what was uploaded to it, or `wrangler pages dev`) gets a 302 to the same kit there, since `lore.kit site`
// uploads every kit it builds to production. loreforeverwow.com itself falls back to the kit its languages.json links
// to, then to the newest upload of that name (so a missed upload never breaks the download), and only then says 503.
// The ETag is the kit's SHA-256. A Range request gets the whole file.

import { NAME, SHA256, kitKey, linkedKits, listKits } from "../../../lib/kits.js";

const HOME = "loreforeverwow.com";
const RETRY = "This kit is being updated. Please try again in a few minutes, or ask on our Discord: " +
  "https://loreforeverwow.com/discord?src=translate\n";

const text = (status, body, headers = {}) => new Response(body, {
  status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...headers },
});

export async function onRequest({ request, env, params }) {
  if (request.method !== "GET" && request.method !== "HEAD") return text(405, "Use GET.\n", { Allow: "GET, HEAD" });
  const name = /^(.+)\.zip$/.exec(String(params.name || ""))?.[1];
  if (!name || !NAME.test(name)) return text(404, "Not found.\n");
  const url = new URL(request.url);
  const v = url.searchParams.get("v") || "";
  const linked = (await linkedKits(env, request))[name];
  const want = SHA256.test(v) ? v : linked;
  if (!want) return text(404, "Not found.\n");
  if ((request.headers.get("If-None-Match") || "").includes(`"${want}"`)) {
    return new Response(null, { status: 304, headers: { ETag: `"${want}"`, "Cache-Control": "no-cache" } });
  }

  const bucket = env.STUDIO;
  const open = sha => (bucket ? (request.method === "HEAD" ? bucket.head(kitKey(name, sha)) : bucket.get(kitKey(name, sha))) : null);
  let sha = want;
  let obj = await open(sha);
  if (!obj && url.hostname !== HOME) return Response.redirect(`https://${HOME}/translate/kits/${name}.zip?v=${want}`, 302);
  if (!obj && linked && linked !== want) obj = await open((sha = linked));
  if (!obj && bucket) {
    const newest = (await listKits(bucket, name))[0];
    if (newest) obj = await open((sha = newest.sha256));
  }
  if (!obj) return text(503, RETRY, { "Retry-After": "300" });

  const headers = { "Content-Type": "application/zip", "Cache-Control": "no-cache", ETag: `"${sha}"` };
  if (request.method === "HEAD") return new Response(null, { headers: { ...headers, "Content-Length": String(obj.size) } });
  return new Response(obj.body, { headers });
}
