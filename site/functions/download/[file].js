// The site's own download links: /download/installer and /download/zip. /download/complete is an old link to the
// complete zip, which the main zip replaced (it carries every narration now), so it serves that. Each one counts the download per
// day in the D1 database (bound as DB), then redirects to the file on the latest GitHub release. This is
// the "downloads from the site" number; GitHub's own count also includes people who download from GitHub.
//   GET /download/installer -> 302 to .../releases/latest/download/LoreForever-Setup.exe
//   GET /download/zip       -> 302 to .../releases/latest/download/LoreForever.zip
//   GET /download/complete  -> 302 to .../releases/latest/download/LoreForever.zip (counted as "complete")
//   GET /download/willo     -> 302 to Willo-Setup.exe on the newest release that has it (lib/willo.js); before the
//                              first one, a preview's test build from its R2 (served here), else 302 to /willo
// ?src=<where the link was> (LOR-413; the lore pages send ?src=lore, and header.js carries a visit's ?src= onto these
// links) also counts it per day and source in download_sources. Only a short slug: anything else counts as "other".
// Signed in (LOR-8): the download also counts for the account, in download_accounts (lib/activity.js), next to the
// anonymous count, so /admin can tell how many accounts downloaded. Signing in is never needed, and that count never
// holds up or stops the redirect: it runs after the response has gone (waitUntil), and a failure is dropped.

import { loadSizes } from "../../lib/packs.js";
import { willoTag, willoUrl, willoPreview, WILLO_FILE } from "../../lib/willo.js";
import { countDownload } from "../../lib/download-count.js";

const RELEASE = "https://github.com/mliudev/LoreForever/releases/latest/download/";
const FILES = { installer: "LoreForever-Setup.exe", zip: "LoreForever.zip", complete: "LoreForever.zip", willo: WILLO_FILE };

export async function onRequestGet({ params, env, request, waitUntil }) {
  const file = FILES[params.file];
  if (!file) return new Response("Not found", { status: 404 });
  await countDownload({ env, request, waitUntil }, params.file);
  if (params.file === "willo") {
    // Willo-Setup.exe isn't on every release (the willo job never holds one up): the newest one that has it.
    const tag = willoTag(await loadSizes(env, request));
    if (tag) return Response.redirect(willoUrl(tag), 302);
    const preview = await willoPreview(env, request);
    const obj = preview && (request.method === "HEAD" ? await env.STUDIO.head(preview.key) : await env.STUDIO.get(preview.key));
    if (!obj) return Response.redirect(new URL("/willo", request.url).href, 302);
    const headers = { "Content-Type": "application/vnd.microsoft.portable-executable", "Cache-Control": "no-cache",
      "Content-Disposition": `attachment; filename="${WILLO_FILE}"`, ETag: `"${preview.sha256}"`, "Content-Length": String(obj.size) };
    return new Response(request.method === "HEAD" ? null : obj.body, { headers });
  }
  return Response.redirect(RELEASE + file, 302);
}

export const onRequestHead = onRequestGet;
