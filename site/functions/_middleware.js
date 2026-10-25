// Sends every request on an old address to the site's main domain with a permanent redirect, keeping the path and
// query, so old links in videos and comments keep working and the API (with the live keys behind it) answers on one
// address only. Pages and other GETs get a 301; other methods a 308, which keeps the method and body. Does nothing
// until CANONICAL_HOST is set in the Pages project (Settings > Variables and Secrets, Production), e.g.
// CANONICAL_HOST = loreforeverwow.com.
// Only the paths in public/_routes.json run through here (every page, /api/*, /download/*, ...). Images, audio,
// install.ps1, /voices/clips.csv and the other files it leaves out are still served as plain files on the old address,
// and don't count against the Functions quota.
// Never redirected: other services' webhooks (STAY), since Stripe doesn't follow redirects and fal.ai was handed this
// address when the job started (lib/storyvoice.js). Scripts and routines call /api/* on loreforeverwow.com with an
// Authorization header, which HTTP clients drop on a redirect to another host, so they must never use an old address.
// Preview deployments (<hash>.lore-forever.pages.dev, develop.lore-forever.pages.dev) are left alone.
// Willo's own domain (WILLO_DOMAIN) is a second front door to the same site: lib/doors.js says which pages belong to
// which door, sends a page asked for through the wrong one across, and shows each door's pages with its own nav,
// footer and content (WILLO_SPLIT=on is the switch for loreforeverwow.com's side).
// It also adds the site-wide headers from public/_headers to every response that passes through without them, since
// Pages doesn't apply _headers to responses from Functions (the profile pages, /downloads, /translate, the API). A file
// served through here keeps its own (/admin's stricter Content-Security-Policy).

import { migratedAdminLocation } from '../lib/admin-location.js';
import { analyticsPage, withAnalytics } from '../lib/analytics.js';
import { tooOld } from '../lib/client-version.js';
import { changes, doorOf, doorRedirect, doorResponse, doorRobots, doorSitemap, willoHome, willoHost } from '../lib/doors.js';

const OLD_HOSTS = ["loreforever.mliu.io", "lore-forever.pages.dev"];
const STAY = ["/api/billing/webhook", "/api/profile/voice/hook"];
// The same Content-Security-Policy as /* in public/_headers (tests/hashes.test.mjs checks they match). Scripts only
// from this site, Google sign-in, Turnstile and Cloudflare's analytics beacon; never from an onclick= or onerror=
// attribute (script-src-attr), which is how text put into a page with innerHTML would run; no plugins or <base>.
const SITE_CSP ="script-src 'self' 'unsafe-inline' https://accounts.google.com https://challenges.cloudflare.com " +
  "https://static.cloudflareinsights.com; script-src-attr 'none'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
const FRAMED_CSP = SITE_CSP.replace("frame-ancestors 'none'", "frame-ancestors 'self'");
const SITE_HEADERS = { "X-Frame-Options": "DENY", "Referrer-Policy": "strict-origin-when-cross-origin",
                       "Content-Security-Policy": SITE_CSP };

export async function onRequest({ request, env, next }) {
  const canonical = (env.CANONICAL_HOST || "").trim().toLowerCase();
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();
  const isOld = OLD_HOSTS.includes(host) || host === "www." + canonical;
  if (canonical && host !== canonical && isOld && !STAY.includes(url.pathname)) {
    url.hostname = canonical;
    url.protocol = "https:";
    url.port = "";
    return Response.redirect(url.toString(), request.method === "GET" || request.method === "HEAD" ? 301 : 308);
  }
  // Willo's own domain (lib/doors.js): www. goes to the bare domain, like loreforeverwow.com's.
  const willo = willoHost(env);
  if (willo && host === "www." + willo && !STAY.includes(url.pathname)) {
    url.hostname = willo;
    url.protocol = "https:";
    url.port = "";
    return Response.redirect(url.toString(), request.method === "GET" || request.method === "HEAD" ? 301 : 308);
  }
  // The two front doors: a page asked for through the other side's door goes there (302: the split can be undone).
  const door = doorOf(request, env);
  const moved = doorRedirect(request, env, door);
  if (moved) return moved;
  const adminLocation = migratedAdminLocation(request, env);
  if (adminLocation) return new Response(null, { status: 302, headers: {
    Location: adminLocation, 'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
  } });
  // A response's headers can be read-only (a redirect, a file from ASSETS), so set them on a copy. Server-Timing says
  // how long the page took here before its first byte (DevTools > Network > Timing; the launch load test reads it).
  const started = Date.now();
  const willoRoot = door?.door === "willo" && url.pathname === "/" && (request.method === "GET" || request.method === "HEAD");
  let res = willoRoot ? await willoHome(request, env) : await next();
  if (changes(door)) {
    if (url.pathname === "/sitemap.xml") res = await doorSitemap(res, door, env);
    else if (url.pathname === "/robots.txt") res = doorRobots(res, door, env);
    else res = await doorResponse(res, door, env);
  }
  const out = new Response(res.body, res);
  if (!out.headers.has("Server-Timing")) out.headers.set("Server-Timing", `fn;dur=${Date.now() - started}`);
  // A page this site frames itself (the home page's preview of a profile) says so with X-Frame-Options: SAMEORIGIN,
  // and its policy then lets this site, and only this site, frame it.
  const framed = out.headers.get("X-Frame-Options") === "SAMEORIGIN";
  for (const [name, value] of Object.entries(SITE_HEADERS)) {
    if (!out.headers.has(name)) out.headers.set(name, framed && name === "Content-Security-Policy" ? FRAMED_CSP : value);
  }
  // An app below its minimum (lib/client-version.js) hears it on every reply too: X-LF-Update: the version it needs.
  const old = request.headers.has("X-LF-Client") && tooOld(request.headers.get("X-LF-Client"), env);
  if (old) out.headers.set("X-LF-Update", old.min);
  const analytics = analyticsPage(request, env, out);
  return analytics ? withAnalytics(out, analytics) : out;
}
