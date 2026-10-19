// Google Search for /admin's Sources (lib/sources.js): per page of the site, the searches that showed it, from Google
// Search Console's API (Search Analytics: clicks, impressions, click rate and average position, per page and per
// query), beside what visits from Google went on to do. Read only, with a service account Mike adds as a user of the
// Search Console property; its JSON key is the Pages secret GSC_SERVICE_ACCOUNT. Without it, the view says so and
// nothing is asked of Google. Google's numbers are 2-3 days behind, and kept 6 hours (lib/cache.js), so /admin asks
// Google at most a few times a day.
//
// Pages settings: GSC_SERVICE_ACCOUNT (secret: the service account's key, the whole JSON file), and optionally
// GSC_SITE: the property as Search Console names it (default "https://loreforeverwow.com/", the URL-prefix property
// verified by public/googled2031faf95c3d5c2.html).

import { cached } from "./cache.js";

export const SITE_DEFAULT = "https://loreforeverwow.com/";
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const QUERIES_PER_PAGE = 10;

export const searchConsoleOn = env => Boolean(String(env?.GSC_SERVICE_ACCOUNT || "").trim());

const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_")
  .replace(/=+$/, "");
const b64urlText = text => b64url(new TextEncoder().encode(text));

// A short-lived access token for the service account (a signed JWT traded at Google's token endpoint), kept for the
// life of the isolate until a minute before it ends.
let kept = { key: "", token: "", until: 0 };
async function accessToken(env) {
  let account;
  try { account = JSON.parse(env.GSC_SERVICE_ACCOUNT); } catch (e) { throw new Error("GSC_SERVICE_ACCOUNT isn't a service account's JSON key."); }
  if (!account?.client_email || !account?.private_key) throw new Error("GSC_SERVICE_ACCOUNT has no client_email or private_key.");
  const now = Math.floor(Date.now() / 1000);
  if (kept.key === account.client_email && kept.until > now + 60) return kept.token;
  const der = Uint8Array.from(atob(account.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const unsigned = `${b64urlText(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64urlText(JSON.stringify({
    iss: account.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }))}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const res = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64url(signature)}` }),
    signal: AbortSignal.timeout(10000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`Google refused the service account: ${data.error_description || data.error || res.status}`);
  kept = { key: account.client_email, token: data.access_token, until: now + (data.expires_in || 3600) };
  return kept.token;
}

async function query(env, token, site, body) {
  const res = await fetch(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`,
    { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Search Console: ${data.error?.message || res.status}`);
  return data.rows || [];
}

// A page's address as a landing page of ours ("/guides/leveling"), as lib/sources.js keeps them.
const landingOfPage = page => {
  try { const p = new URL(page).pathname; return p.length > 1 ? p.replace(/\/+$/, "") : "/"; } catch (e) { return page; }
};

// Per page, Google Search between two days: {on, site, from, to, pages: [{landing, clicks, impressions, ctr, position,
// queries: [{query, clicks, impressions, position}] (the QUERIES_PER_PAGE with the most impressions)}]}, the pages with
// the most impressions first; {on: false} without the service account; {on: true, error} when Google says no.
export async function searchPages(env, { from, to }) {
  if (!searchConsoleOn(env)) return { on: false };
  const site = String(env.GSC_SITE || SITE_DEFAULT).trim();
  try {
    return await cached(env, `search-console:${site}:${from}:${to}`, { stamp: async () => "", minAge: 6 * 3600, maxAge: 6 * 3600 },
      async () => {
        const token = await accessToken(env);
        const [pages, pairs] = await Promise.all([
          query(env, token, site, { startDate: from, endDate: to, dimensions: ["page"], rowLimit: 500 }),
          query(env, token, site, { startDate: from, endDate: to, dimensions: ["page", "query"], rowLimit: 5000 }),
        ]);
        const byPage = new Map();
        for (const r of pairs) {
          const list = byPage.get(r.keys[0]) || [];
          list.push({ query: r.keys[1], clicks: r.clicks, impressions: r.impressions, position: Math.round(r.position * 10) / 10 });
          byPage.set(r.keys[0], list);
        }
        return { on: true, site, from, to, pages: pages.sort((a, b) => b.impressions - a.impressions).map(r => ({
          landing: landingOfPage(r.keys[0]), clicks: r.clicks, impressions: r.impressions, ctr: Math.round(r.ctr * 1000) / 10,
          position: Math.round(r.position * 10) / 10,
          queries: (byPage.get(r.keys[0]) || []).sort((a, b) => b.impressions - a.impressions).slice(0, QUERIES_PER_PAGE) })) };
      });
  } catch (e) {
    console.warn(`search console: ${e?.message || e}`);
    return { on: true, site, error: String(e?.message || e).slice(0, 300) };
  }
}
