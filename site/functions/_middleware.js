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
// It also adds the site-wide headers from public/_headers to every response that passes through without them, since
// Pages doesn't apply _headers to responses from Functions (the profile pages, /downloads, /translate, the API). A file
// served through here keeps its own (/admin's stricter Content-Security-Policy).

import { migratedAdminLocation } from '../lib/admin-location.js';
import { analyticsPage, withAnalytics } from '../lib/analytics.js';

const OLD_HOSTS = ["loreforever.mliu.io", "lore-forever.pages.dev"];
const STAY = ["/api/billing/webhook", "/api/profile/voice/hook"];
// The same Content-Security-Policy as /* in public/_headers (tests/hashes.test.mjs checks they match). Scripts only
// from this site, Google sign-in, Turnstile and Cloudflare's analytics beacon; never from an onclick= or onerror=
// attribute (script-src-attr), which is how text put into a page with innerHTML would run; no plugins or <base>.
const SITE_CSP ="script-src 'self' 'unsafe-inline' https://accounts.google.com https://challenges.cloudflare.com " +
  "https://static.cloudflareinsights.com; script-src-attr 'none'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
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
  const adminLocation = migratedAdminLocation(request, env);
  if (adminLocation) return new Response(null, { status: 302, headers: {
    Location: adminLocation, 'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
  } });
  // A response's headers can be read-only (a redirect, a file from ASSETS), so set them on a copy.
  const res = await next();
  const out = new Response(res.body, res);
  for (const [name, value] of Object.entries(SITE_HEADERS)) if (!out.headers.has(name)) out.headers.set(name, value);
  const analytics = analyticsPage(request, env, out);
  return analytics ? withAnalytics(out, analytics) : out;
}
