// /willo: Willo's page (public/willo.html), where the add-on's "Get Willo" sends players (LOR-459: its Get Willo
// button, its in-chat line and /lore willo; add-ons can't open web pages, so players copy loreforeverwow.com/willo into
// a browser). It counts the visit per day in the D1 database (bound as DB), so we can see whether the add-on sends
// players to Willo:
//   SELECT day, n FROM willo_clicks ORDER BY day DESC
// and fills the page's call to action from lib/willo.js: Willo's own download once a release has Willo-Setup.exe,
// else word that Willo is coming. Link-preview bots get the page but aren't counted. ?shared=<code> (a Share Willo
// link, functions/w/[code].js) adds who sent them above the download (lib/referrals.js shareBanner).

import { loadSizes } from "../lib/packs.js";
import { willoGet, willoPreview } from "../lib/willo.js";
import { codeOwner, shareBanner } from "../lib/referrals.js";
import { escape } from "../lib/voices.js";

const SETUP = "CREATE TABLE IF NOT EXISTS willo_clicks (day TEXT PRIMARY KEY, n INTEGER NOT NULL)";
const BOTS = /bot|crawler|spider|preview|facebookexternalhit|embedly|whatsapp|telegram|slack/i;
const GET = /<!-- willo-get -->[\s\S]*?<!-- \/willo-get -->/;
const SHARED = /<!-- willo-shared:[^>]*-->/;

export async function onRequestGet({ request, env, waitUntil, next }) {
  // Counting runs after the response, so it never holds up or breaks the page.
  if (env.DB && !BOTS.test(request.headers.get("user-agent") || "")) waitUntil(count(env.DB));
  const page = await next();
  const html = await page.text();
  if (!GET.test(html)) return new Response(html, page);      // not the page (a missing file is the home page)
  const shared = new URL(request.url).searchParams.get("shared");
  const [sizes, preview, owner] = await Promise.all([loadSizes(env, request), willoPreview(env, request),
    shared && env.DB ? codeOwner(env, shared).catch(() => null) : null]);
  const headers = new Headers(page.headers);
  headers.set("Cache-Control", "no-cache");
  headers.delete("Content-Length");
  headers.delete("ETag");
  return new Response(html.replace(GET, () => willoGet(sizes, preview)).replace(SHARED, () => shareBanner(owner, escape)),
    { status: page.status, headers });
}

async function count(db) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    await db.batch([
      db.prepare(SETUP),
      db.prepare("INSERT INTO willo_clicks (day, n) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET n = n + 1").bind(day),
    ]);
  } catch {
    // A lost count is fine; a broken page is not.
  }
}
