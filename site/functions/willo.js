// The link the add-on gives players who don't have Willo yet (LOR-459: its Get Willo button and its suggestion when it
// has no answer). Add-ons can't open web pages, so players copy loreforeverwow.com/willo into a browser. Until Willo
// launches (the add-on hides those entry points, Companion.OFFER_WILLO), it's a small "coming soon" page; at launch it
// goes back to redirecting to the Windows installer on /downloads#installer, whose full install includes Willo. Each
// visit is counted per day in the D1 database (bound as DB), so we can see whether the add-on sends players to Willo:
//   SELECT day, n FROM willo_clicks ORDER BY day DESC
// Link-preview bots get the page but aren't counted.

const SETUP = "CREATE TABLE IF NOT EXISTS willo_clicks (day TEXT PRIMARY KEY, n INTEGER NOT NULL)";
const BOTS = /bot|crawler|spider|preview|facebookexternalhit|embedly|whatsapp|telegram|slack/i;

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Willo is coming soon - Lore Forever</title>
<meta name="description" content="Willo, Lore Forever's companion app, is coming soon.">
<link rel="icon" href="/img/logo.svg" type="image/svg+xml"><link rel="stylesheet" href="/style.css"></head>
<body><header class="top"><div class="wrap"><span class="crumb"><a href="/">Lore Forever</a> &rsaquo;
Willo</span></div></header>
<main class="wrap fb-page"><h1>Willo is coming soon</h1>
<div class="fb-done"><p>Willo, Lore Forever's companion app, isn't out yet. It's coming soon.</p>
<p><a href="/">Back to Lore Forever</a></p></div>
</main></body></html>`;

export async function onRequestGet({ request, env, waitUntil }) {
  // Counting runs after the response, so it never holds up or breaks the page.
  if (env.DB && !BOTS.test(request.headers.get("user-agent") || "")) waitUntil(count(env.DB));
  return new Response(PAGE, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

async function count(db) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    await db.batch([
      db.prepare(SETUP),
      db.prepare("INSERT INTO willo_clicks (day, n) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET n = n + 1").bind(day),
    ]);
  } catch {
    // A lost count is fine; a broken link is not.
  }
}
