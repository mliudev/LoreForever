// Sends visitors on an old address to the site's main domain with a permanent (301) redirect, keeping the path and
// query, so old links in videos and comments keep working. Does nothing until CANONICAL_HOST is set in the Pages
// project (Settings > Variables and Secrets, Production), e.g. CANONICAL_HOST = loreforeverwow.com.
// Only the paths in public/_routes.json run through here (/, /feedback, /voices, /voices/*, /translate, /translate/*,
// /discord, /api/*, /download/*). Images, audio, install.ps1, /voices/clips.csv, /translate/data and /admin on the old
// address are still served as plain files (keeping their _headers), and don't count against the free Functions quota.
// The translation kits (/translate/kits/*) are a Function now (they're in R2), so they are redirected like pages.
// /api/* is never redirected: scripts and routines call it with an Authorization header, which HTTP clients drop
// when a redirect goes to another host. Preview deployments (<hash>.lore-forever.pages.dev) are left alone.

const OLD_HOSTS = ["loreforever.mliu.io", "lore-forever.pages.dev"];

export async function onRequest({ request, env, next }) {
  const canonical = (env.CANONICAL_HOST || "").trim().toLowerCase();
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();
  const isOld = OLD_HOSTS.includes(host) || host === "www." + canonical;
  const isPage = request.method === "GET" || request.method === "HEAD";
  if (canonical && host !== canonical && isOld && isPage && !url.pathname.startsWith("/api/")) {
    url.hostname = canonical;
    url.protocol = "https:";
    url.port = "";
    return Response.redirect(url.toString(), 301);
  }
  return next();
}
