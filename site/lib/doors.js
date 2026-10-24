// Two front doors on one site (the Willo site split, plan: ~/lab/willo-site-split): loreforeverwow.com is the free
// add-on, and Willo, the paid companion, gets a domain of her own. Both domains are custom domains of this same Pages
// project, so they share the database, the accounts, Stripe and every /api/* address; only the pages differ.
//
// Two settings (Pages > Settings > Variables and Secrets, Production):
//   WILLO_DOMAIN   Willo's domain, e.g. playwillo.com. Set once the domain is attached to the project. That alone opens
//                  her door there (her landing page, her nav and footer on the shared pages, Lore Forever's pages
//                  sent back to loreforeverwow.com) and changes nothing on loreforeverwow.com, so it's safe to
//                  rehearse on the real domain before the switch.
//   WILLO_SPLIT    "on" is the switch: loreforeverwow.com then sends Willo's pages (/willo, /plans, /link, /w/<code>,
//                  /creators, /refunds) to her domain, links to them point there, and Lore Forever's pages lose
//                  Willo's door, plans and prices (the <!-- door:willo --> blocks). Mike called the switch final on
//                  10/23, so once it's on a page asked for through the wrong door moves permanently (301, which
//                  browsers and search engines keep). Deleting it still turns the split off on the site, but browsers
//                  that saw a 301 keep going to the other domain.
// Never redirected, on either domain: /api/* (the apps, Stripe's webhook and the routines call it with keys, and a
// client drops its Authorization header on a redirect to another host), /download/*, /willo-assets/*, /audio/*, and
// any file (a path with an extension).
//
// Pages mark what belongs to one side:
//   <!-- door:willo --> ... <!-- /door:willo -->   Willo's or money content: gone from Lore Forever once split.
//   <!-- door:lore --> ... <!-- /door:lore -->     Lore Forever-only content: gone on Willo's domain.
//   <!-- door-split: ... :door-split -->           Lore Forever's content for after the split (a "Meet Willo" card),
//                                                  inert inside its comment until the switch; keep "--" out of it.
//   <!-- door-willo: ... :door-willo -->           The same for what only Willo's domain shows.
// and <html> gets data-door="willo" or "lore" whenever a page is changed here, for the CSS and scripts (the account
// page shows each side its own tabs).
//
// Rehearsing on the develop site (lib/test-players.js TEST_HOSTS), which has one address: ?door=willo or ?door=lore
// picks the door and ?split=on or ?split=off the switch, kept in a cookie for that browser only. Links between the two
// doors then stay on the same address and flip the cookie instead.

import { TEST_HOSTS } from "./test-players.js";
import { currentUser, cookieValue, sha256, setup } from "./accounts.js";
import { willoSocial } from "./social.js";

export const LORE_DEFAULT = "loreforeverwow.com";
const CARRY_SECONDS = 60;

const bare = h => String(h || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")
  .replace(/^www\./, "");
export const willoHost = env => bare(env?.WILLO_DOMAIN);
export const loreHost = env => bare(env?.CANONICAL_HOST) || LORE_DEFAULT;
export const splitOn = env => String(env?.WILLO_SPLIT || "").trim().toLowerCase() === "on" && !!willoHost(env);

const WILLO_PAGES = [/^\/willo(\/.*)?$/, /^\/plans\/?$/, /^\/link(\/web)?\/?$/, /^\/w\/[^/]+$/, /^\/creators\/?$/,
                     /^\/refunds\/?$/];
const LORE_PAGES = [/^\/downloads\/?$/, /^\/voices(\/.*)?$/, /^\/translate(\/.*)?$/, /^\/lore(\/.*)?$/,
                    /^\/guides(\/.*)?$/, /^\/contribute(\/.*)?$/, /^\/contributors\/?$/, /^\/clip-report\/?$/,
                    /^\/discord\/?$/, /^\/a\/[^/]+$/];
const isFile = path => /\.[a-z0-9]{1,5}$/i.test(path);

// Which door a page belongs to: "willo", "lore", or "both" (home, account, profiles, legal, feedback, the API...).
export function sideOf(path) {
  if (isFile(path)) return "both";
  if (WILLO_PAGES.some(re => re.test(path))) return "willo";
  if (LORE_PAGES.some(re => re.test(path))) return "lore";
  return "both";
}

// The door this request came through: { door: "willo" | "lore", split, test, path, origin }, or null for any other
// address (a PR preview, the old addresses before their redirect), which is served as it always was. path and origin:
// the page's, for its link-preview tags (lib/social.js).
export function doorOf(request, env) {
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const page = { path: url.pathname, origin: url.origin };
  const willo = willoHost(env);
  if (willo && host === willo) return { door: "willo", split: splitOn(env), test: false, ...page };
  if (host === loreHost(env)) return { door: "lore", split: splitOn(env), test: false, ...page };
  if (!TEST_HOSTS.has(host)) return null;
  return { door: cookieValue(request, "lf_door") === "willo" ? "willo" : "lore",
           split: cookieValue(request, "lf_split") === "on", test: true, ...page };
}

// Whether pages through this door get changed at all: always on Willo's domain, on Lore Forever's only once split.
export const changes = ctx => !!ctx && (ctx.door === "willo" || ctx.split);

// The address of `href` (a path, with any query and #anchor) on the other side's door.
export function crossUrl(ctx, side, href, env) {
  if (ctx.test) {
    const [rest, hash = ""] = href.split("#");
    return rest + (rest.includes("?") ? "&" : "?") + "door=" + side + (hash ? "#" + hash : "");
  }
  return "https://" + (side === "willo" ? willoHost(env) : loreHost(env)) + href;
}

const redirect = (location, extra = {}) => new Response(null, { status: 302, headers: {
  Location: location, "Cache-Control": "no-store", ...extra } });
const moved = location => new Response(null, { status: 301, headers: {
  Location: location, "Cache-Control": "public, max-age=86400" } });

// A redirect this request needs before anything else runs, or null: the develop site's door and switch picks, and a
// page asked for through the wrong door. GET and HEAD of pages only.
export function doorRedirect(request, env, ctx) {
  if (!ctx || (request.method !== "GET" && request.method !== "HEAD")) return null;
  const url = new URL(request.url);
  if (ctx.test && (url.searchParams.has("door") || url.searchParams.has("split"))) {
    const cookies = [];
    const door = url.searchParams.get("door"), split = url.searchParams.get("split");
    if (door === "willo" || door === "lore") cookies.push(`lf_door=${door}; Path=/; SameSite=Lax`);
    if (split === "on" || split === "off") cookies.push(`lf_split=${split}; Path=/; SameSite=Lax`);
    url.searchParams.delete("door");
    url.searchParams.delete("split");
    const headers = new Headers({ Location: url.toString(), "Cache-Control": "no-store" });
    for (const c of cookies) headers.append("Set-Cookie", c);
    return new Response(null, { status: 302, headers });
  }
  const side = sideOf(url.pathname);
  const wrong = (ctx.door === "willo" && side === "lore") || (ctx.door === "lore" && ctx.split && side === "willo");
  if (!wrong) return null;
  // Permanent once split on the real domains; before the switch (the rehearsal) and on the develop site, temporary.
  const to = new URL(crossUrl(ctx, side, url.pathname + url.search + url.hash, env), url).toString();
  return ctx.split && !ctx.test ? moved(to) : redirect(to);
}

// Willo's landing page for "/" on her domain: the swappable template in public/willo-site/ (home.html with its
// tokens.css; a new design replaces those files and nothing else). Falls back to /willo if it's missing.
export async function willoHome(request, env) {
  let res = await env.ASSETS.fetch(new URL("/willo-site/home", request.url));
  if (!res.ok) res = await env.ASSETS.fetch(new URL("/willo", request.url));
  const out = new Response(res.body, res);
  out.headers.delete("X-Robots-Tag");    // the template's own address is noindex (_headers); here it's her home
  return out;
}

const WILLO_BRAND = '<a class="brand" href="/"><img src="/img/wispr.svg" alt="" width="30" height="30"><span>Willo</span></a>';

// Her look on the shared pages (public/willo-site/door.css over her tokens), in her display face. Bump with either file.
const WILLO_LOOK = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Marcellus&display=swap">
<link rel="stylesheet" href="/willo-site/tokens.css?v=20261024g">
<link rel="stylesheet" href="/willo-site/door.css?v=20261024h">
</head>`;

// The same three links as her home page; Get Willo is the header's one button (header.js adds Sign in beside it).
const willoNav = () => `<div class="nav-links">
      <a class="nl nl-willo" id="nav-willo" href="/willo">Meet her</a>
      <a class="nl" id="nav-plans" href="/plans">Plans</a>
      <a class="nl" id="nav-help" href="/faq">Help</a>
    </div>`;
const WILLO_ACTIONS = '<div class="head-actions"><a class="w-get" href="/download/willo?src=willo-nav">Get Willo</a></div>';

const willoFoot = (ctx, env) => `<footer class="h-foot">
  <div class="h-wrap">
    <div class="h-foot-grid">
      <div class="h-sign">
        <span class="h-brand"><img src="/img/wispr.svg" alt="" width="30" height="30">Willo</span>
        <p>A companion for the games you love. Now in World of Warcraft, with the free
          <a href="${crossUrl(ctx, "lore", "/", env)}">Lore Forever</a> add-on.</p>
      </div>
      <nav aria-label="Willo"><h2>Willo</h2><ul><li><a href="/willo">Meet Willo</a></li><li><a href="/plans">Plans</a></li><li><a href="/download/willo?src=willo-foot">Download for Windows</a></li><li><a href="/willo/style">Her ways</a></li></ul></nav>
      <nav aria-label="Your account"><h2>You</h2><ul><li><a href="/account">Your account</a></li><li><a href="/willo/keeps">What Willo keeps</a></li><li><a href="/creators">Creator program</a></li></ul></nav>
      <nav aria-label="About"><h2>About</h2><ul><li><a href="/faq">Help</a></li><li><a href="/feedback">Send feedback</a></li><li><a href="/privacy">Privacy</a></li><li><a href="/terms">Terms</a></li><li><a href="/refunds">Refunds</a></li></ul></nav>
      <nav aria-label="Lore Forever"><h2>Lore Forever</h2><ul><li><a href="${crossUrl(ctx, "lore", "/downloads", env)}">Get the free add-on</a></li><li><a href="${crossUrl(ctx, "lore", "/lore", env)}">Read the lore</a></li></ul></nav>
    </div>
  </div>
</footer>`;

const block = side => new RegExp(`<!-- door:${side} -->[\\s\\S]*?<!-- /door:${side} -->`, "g");
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The page's HTML as this door shows it (see the top of this file). Pure: the same input gives the same page.
export function doorPage(html, ctx, env) {
  const other = ctx.door === "willo" ? "lore" : "willo";
  let out = html.replace(/<html\b/i, `<html data-door="${ctx.door}"`).replace(block(other), "");
  if (ctx.door === "lore") {
    out = out.replace(/<!-- door-split:|:door-split -->/g, "")
      // The footer's Willo column shrinks to one link to her site; Creator program and Refunds go with her.
      .replace(/<nav aria-label="Willo">[\s\S]*?<\/nav>/g,
        `<nav aria-label="Willo"><h2>Willo</h2><ul><li><a href="${crossUrl(ctx, "willo", "/?src=lore-foot", env)}">Meet Willo</a></li></ul></nav>`)
      // The header's Willo link goes straight to her home, not /willo (one hop less), tagged so her site counts it.
      .replace(/(<a class="nl nl-willo" id="nav-willo" href=")\/willo"/g, `$1${crossUrl(ctx, "willo", "/?src=lore-nav", env)}"`)
      .replace(/<li><a href="\/(creators|refunds)">[^<]*<\/a><\/li>/g, "");
  } else {
    out = out.replace(/<!-- door-willo:|:door-willo -->/g, "")
      .replace(/(<title>[^<]*?\s[|-]\s)Lore Forever(<\/title>)/, "$1Willo$2")
      .replace(/(<meta property="og:site_name" content=")Lore Forever"/, '$1Willo"')
      .replace(/<a class="brand" href="\/">[\s\S]*?<\/a>/, WILLO_BRAND)
      .replace(/<div class="nav-links">[\s\S]*?<\/div>/, willoNav)
      .replace(/<div class="head-actions">[\s\S]*?<\/a><\/div>/, WILLO_ACTIONS)
      .replace(/<footer class="h-foot">[\s\S]*?<\/footer>/, () => willoFoot(ctx, env));
    if (!ctx.test) {
      const lore = new RegExp(`(<link rel="canonical" href="|<meta property="og:url" content=")https://${escapeRe(loreHost(env))}`, "g");
      out = out.replace(lore, `$1https://${willoHost(env)}`)
        // Her pages named in structured data are hers too (/willo's SoftwareApplication, its clips).
        .replace(new RegExp(`https://${escapeRe(loreHost(env))}(/(?:willo|plans)\\b[^"]*)`, "g"),
          (m, p) => sideOf(p.split(/[?#]/)[0]) === "willo" ? `https://${willoHost(env)}${p}` : m);
    }
    // Her card, titles, descriptions and icons when the page is shared (lib/social.js).
    out = willoSocial(out, ctx.path || "/", ctx.test ? ctx.origin || "" : `https://${willoHost(env)}`);
    if (!out.includes("/willo-site/tokens.css")) out = out.replace(/<\/head>/i, WILLO_LOOK);   // her home has its own
  }
  // Links to the other side's pages go straight there (no redirect hop).
  return out.replace(/(\shref=")(\/(?!\/)[^"]*)"/g, (m, pre, href) =>
    sideOf(href.split(/[?#]/)[0]) === other ? `${pre}${crossUrl(ctx, other, href, env)}"` : m);
}

// The response with doorPage applied, for an HTML page; anything else as it is.
export async function doorResponse(res, ctx, env) {
  if (!changes(ctx) || res.status !== 200 || !/^text\/html/i.test(res.headers.get("Content-Type") || "")) return res;
  const headers = new Headers(res.headers);
  for (const h of ["Content-Length", "ETag", "Last-Modified"]) headers.delete(h);
  if (ctx.test) headers.set("Cache-Control", "no-store");    // the same address shows either door on develop
  return new Response(doorPage(await res.text(), ctx, env), { status: res.status, headers });
}

// Each door's list of pages for search engines: Willo's own on her domain; Lore Forever's without hers once split.
export async function doorSitemap(res, ctx, env) {
  if (!changes(ctx) || !res.ok) return res;
  const xml = await res.text();
  const host = ctx.test ? null : `https://${willoHost(env)}`;
  let body;
  if (ctx.door === "willo") {
    const urls = ["/", "/willo", "/plans", "/creators", "/faq", "/privacy", "/terms"];
    body = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls.map(u => `  <url><loc>${host || ""}${u}</loc></url>`).join("\n") + "\n</urlset>\n";
  } else {
    body = xml.replace(/\s*<url>\s*<loc>https?:\/\/[^/<]+(\/[^<]*)<\/loc>[\s\S]*?<\/url>/g,
      (m, path) => sideOf(path) === "willo" ? "" : m);
  }
  const headers = new Headers(res.headers);
  for (const h of ["Content-Length", "ETag", "Last-Modified"]) headers.delete(h);
  return new Response(body, { status: 200, headers });
}

export function doorRobots(res, ctx, env) {
  if (!ctx || ctx.door !== "willo" || ctx.test) return res;
  return new Response(`User-agent: *\nAllow: /\n\nSitemap: https://${willoHost(env)}/sitemap.xml\n`,
    { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

// Carrying a sign-in across: GET /go/willo?next=/account (or /go/lore) on one door signs the same browser in on the
// other, since each domain keeps its own sign-in cookie. Signed in, it makes a one-time code (door_carries, lib/
// accounts.js SETUP: its SHA-256, for CARRY_SECONDS, tied to this browser's session) and opens /go/in on the other
// domain, which takes the code once and starts a session there (functions/go/[door].js). Signed out, or on the
// develop site, it just goes there.
const NEXT = /^\/(?![/\\])[A-Za-z0-9\-._~/%]*(\?[A-Za-z0-9\-._~=&%+]*)?(#[A-Za-z0-9\-_]*)?$/;
export const safePath = next => typeof next === "string" && NEXT.test(next) ? next : null;

const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
const iso = ms => new Date(ms).toISOString();

export async function issueCarry(env, userId, sessionToken, now = Date.now()) {
  await setup(env);
  await env.DB.prepare("DELETE FROM door_carries WHERE expires <= ?").bind(iso(now)).run();
  const code = hex(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare("INSERT INTO door_carries (token_hash, user_id, session_hash, created, expires) VALUES (?, ?, ?, ?, ?)")
    .bind(await sha256(code), userId, await sha256(sessionToken), iso(now), iso(now + CARRY_SECONDS * 1000)).run();
  return code;
}

// The account a code signs in, taking it once; null when expired, used, made up, or its sign-in has ended since.
export async function takeCarry(env, code, now = Date.now()) {
  if (!/^[0-9a-f]{64}$/.test(String(code || ""))) return null;
  await setup(env);
  const row = await env.DB.prepare("DELETE FROM door_carries WHERE token_hash = ? RETURNING user_id, session_hash, expires")
    .bind(await sha256(code)).first();
  if (!row || row.expires <= iso(now)) return null;
  const live = await env.DB.prepare("SELECT 1 AS y FROM sessions WHERE token_hash = ? AND user_id = ? AND expires > ?")
    .bind(row.session_hash, row.user_id, iso(now)).first();
  return live ? row.user_id : null;
}

// Where /go/willo or /go/lore sends this browser.
export async function carryTo(request, env, side) {
  const ctx = doorOf(request, env);
  const next = safePath(new URL(request.url).searchParams.get("next")) || "/";
  if (!ctx || (side !== "willo" && side !== "lore") || (side === "willo" && !willoHost(env))) return redirect(next);
  if (ctx.test || side === ctx.door) return redirect(crossUrl(ctx, side, next, env));
  const user = env.DB ? await currentUser(env, request).catch(() => null) : null;
  if (!user) return redirect(crossUrl(ctx, side, next, env));
  const code = await issueCarry(env, user.id, cookieValue(request, "lf_session"));
  return redirect(crossUrl(ctx, side, `/go/in?c=${code}&next=${encodeURIComponent(next)}`, env),
    { "Referrer-Policy": "no-referrer" });
}
