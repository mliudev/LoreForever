// /contribute (LOR-235): public/contribute.html as it is, except for search engines: noindex (meta tag and
// X-Robots-Tag) until the "contribute" feature is on (lib/features.js), i.e. until the add-on release with the
// Contribute button is out. The page always opens by its address: the add-on's links and previews need it.

import { featureOn } from "../../lib/features.js";

export async function onRequestGet({ request, env }) {
  const res = await env.ASSETS.fetch(new URL("/contribute", request.url));
  if (!res.ok) return res;
  const live = featureOn(env, "contribute");
  let html = await res.text();
  if (live) html = html.replace(/<meta name="robots" content="noindex">[^\n]*\n/, "");
  const headers = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" };
  if (!live) headers["X-Robots-Tag"] = "noindex";
  return new Response(html, { headers });
}
