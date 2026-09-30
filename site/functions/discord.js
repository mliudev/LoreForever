// Sends people to the Discord server with the invite for where they clicked, and counts the click per day and
// source in the D1 database (bound as DB). Every Discord link (site, bios, videos, add-on) points here, so an
// invite can be swapped, or the site can move domains, without editing each link.
//   GET /discord?src=request  redirects to that source's invite (lib/discord.js); a missing or unknown src uses "site"
// Counts are at /api/discord (admin key). Link-preview bots are redirected but not counted.

import { INVITES, SETUP } from "../lib/discord.js";

const BOTS = /bot|crawler|spider|preview|facebookexternalhit|embedly|whatsapp|telegram|slack/i;

export async function onRequestGet({ request, env, waitUntil }) {
  const asked = new URL(request.url).searchParams.get("src") || "";
  const src = Object.hasOwn(INVITES, asked) ? asked : "site";

  // Counting runs after the response, so it never holds up or breaks the redirect.
  if (env.DB && !BOTS.test(request.headers.get("user-agent") || "")) waitUntil(count(env.DB, src));

  return new Response(null, {
    status: 302,
    headers: { Location: `https://discord.gg/${INVITES[src]}`, "Cache-Control": "no-store" },
  });
}

async function count(db, src) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    await db.batch([
      db.prepare(SETUP),
      db.prepare(
        "INSERT INTO discord_clicks (day, src, n) VALUES (?, ?, 1) ON CONFLICT(day, src) DO UPDATE SET n = n + 1",
      ).bind(day, src),
    ]);
  } catch {
    // A lost count is fine; a broken Discord link is not.
  }
}
