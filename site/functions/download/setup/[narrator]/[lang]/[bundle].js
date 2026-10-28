// The Windows button on /downloads (LOR-848): /download/setup/<narrator>/<lang>/<bundle>, e.g. /download/setup/female/de/storyteller.
// It serves the release's own signed LoreForever-Setup.exe, byte for byte, under a name that says the pick:
// "Lore Forever Setup (female, de, storyteller).exe". Setup reads that name and opens its voice page already ticked to
// match (release/installer/LoreForever.iss); an older Setup ignores it. The file name isn't part of the Authenticode
// signature, so the signature stays valid. Counted as an installer download, like /download/installer. If GitHub
// doesn't answer, it falls back to the plain redirect.
//   It's the Setup of the release the site's download feed names (public/data/download-files.json publishedTag), the
// one the page's cards were drawn for, not GitHub's "latest", which turns over mid-release; X-Release-Tag says which
// (scripts/verify-release.sh checks it).

import { countDownload } from "../../../../../lib/download-count.js";
import { loadSizes } from "../../../../../lib/packs.js";

const RELEASES = "https://github.com/mliudev/LoreForever/releases/";
const NARRATORS = new Set(["male", "female", "community", "edition"]);
const LANGS = new Set(["en", "de", "es", "fr", "pt", "it", "ru", "uk", "ro"]);
const BUNDLES = new Set(["addon", "storyteller", "everything"]);

export async function onRequestGet({ params, env, request, waitUntil }) {
  const { narrator, lang, bundle } = params;
  if (!NARRATORS.has(narrator) || !LANGS.has(lang) || !BUNDLES.has(bundle)) return new Response("Not found", { status: 404 });
  await countDownload({ env, request, waitUntil }, "installer");
  const tag = (await loadSizes(env, request))?.publishedTag;
  const setup = RELEASES + (/^v\d+\.\d+\.\d+$/.test(tag || "") ? `download/${tag}` : "latest/download") + "/LoreForever-Setup.exe";
  let upstream;
  try { upstream = await fetch(setup, { method: request.method === "HEAD" ? "HEAD" : "GET" }); } catch (e) {}
  if (!upstream?.ok) return Response.redirect(setup, 302);
  const headers = new Headers({
    "Content-Type": "application/vnd.microsoft.portable-executable",
    "Content-Disposition": `attachment; filename="Lore Forever Setup (${narrator}, ${lang}, ${bundle}).exe"`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (tag) headers.set("X-Release-Tag", tag);
  const length = upstream.headers.get("Content-Length");
  if (length) headers.set("Content-Length", length);
  return new Response(request.method === "HEAD" ? null : upstream.body, { status: 200, headers });
}

export const onRequestHead = onRequestGet;
