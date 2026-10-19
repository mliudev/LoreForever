// Where visitors come from, for /admin's Growth tab (lib/sources.js).
//   GET  /api/admin/sources?from=YYYY-MM-DD&to=YYYY-MM-DD[&by=landing] -> {from, to, rows, totals, links}: per source
//        (or source and landing page), visits, first visits, downloads, sign-ups, first Willo connects, paid plans and
//        revenue (US cents, without tax); the last 30 days unless given
//   GET  /api/admin/sources?search=1&from=&to= -> {search: {on, site, pages: [{landing, clicks, impressions, ctr,
//        position, queries: [...], ours: {visits, signups, willo, paid, revenue} (visits from Google that landed there
//        and what they went on to do)}]}}: Google Search per page (lib/search-console.js); {on: false} until the
//        GSC_SERVICE_ACCOUNT secret is set. Asked apart from the table, so the table never waits for Google.
//   POST /api/admin/sources {"action": "link", "slug", "label", "target"} -> {link, url}: makes (or changes) a tracked
//        link, loreforeverwow.com/a/<slug>, which opens `target` (a page of this site)
//        {"action": "retire" | "restore", "slug"}   switches a tracked link off (it then opens the home page) or on
// Same key as /api/admin ("Authorization: Bearer <key>"), and a browser must send it from our own pages (Origin).

import { authorized } from "../../../lib/auth.js";
import { sameOrigin } from "../../../lib/accounts.js";
import { sourcesReport, saveLink, retireLink } from "../../../lib/sources.js";
import { searchPages } from "../../../lib/search-console.js";

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
const json = (body, status = 200) => Response.json(body, { status, headers: NO_STORE });

async function refused(request, env) {
  if (request.headers.get("Origin") && !sameOrigin(request)) return json({ ok: false, error: "Send it from /admin." }, 403);
  if (!(await authorized(request, env))) return json({ ok: false, error: "Needs the admin key." }, 401);
  if (!env.DB) return json({ ok: false, error: "No D1 database bound as DB" }, 503);
  return null;
}

export async function onRequestGet({ request, env }) {
  const no = await refused(request, env);
  if (no) return no;
  const q = new URL(request.url).searchParams;
  if (q.get("search") === "1") {
    const ours = await sourcesReport(env, { from: q.get("from"), to: q.get("to"), byLanding: true });
    const search = await searchPages(env, { from: ours.from, to: ours.to });
    const google = new Map(ours.rows.filter(r => r.src === "search:google").map(r => [r.landing, r]));
    const mine = r => r ? { visits: r.visits, signups: r.signups, willo: r.willo, paid: r.paid, revenue: r.revenue } : null;
    if (search.pages) search.pages = search.pages.map(p => ({ ...p, ours: mine(google.get(p.landing)) }));
    return json({ ok: true, search });
  }
  return json({ ok: true, ...(await sourcesReport(env, { from: q.get("from"), to: q.get("to"), byLanding: q.get("by") === "landing" })) });
}

export async function onRequestPost({ request, env }) {
  const no = await refused(request, env);
  if (no) return no;
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Expected JSON." }, 400); }
  if (body?.action === "link") {
    const out = await saveLink(env, body);
    return out.error ? json({ ok: false, error: out.error }, 400)
      : json({ ok: true, link: out.link, url: `${new URL(request.url).origin}/a/${out.link.slug}` });
  }
  if (body?.action === "retire" || body?.action === "restore") {
    return (await retireLink(env, body.slug, body.action === "retire")) ? json({ ok: true })
      : json({ ok: false, error: "No such link." }, 404);
  }
  return json({ ok: false, error: "Unknown action." }, 400);
}
