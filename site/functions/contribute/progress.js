// /contribute/progress (LOR-238): what's captured and narrated of Forever's new content, by zone, and the "Wanted"
// list (lib/progress.js, from public/data/coverage.json). Noindex until the "contribute" feature is on
// (lib/features.js), i.e. until the add-on release with the Contribute button ships.

import { loadCoverage, progressPage } from "../../lib/progress.js";
import { featureOn } from "../../lib/features.js";

export async function onRequestGet({ request, env }) {
  const hidden = !featureOn(env, "contribute");
  const headers = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" };
  if (hidden) headers["X-Robots-Tag"] = "noindex";
  return new Response(progressPage(await loadCoverage(env, request), { hidden }), { headers });
}
