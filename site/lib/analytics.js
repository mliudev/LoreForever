// Optional GA4 is attached only after the public page handler succeeds. No browser-supplied
// path, query, title, account data or campaign value becomes analytics configuration.
export const ANALYTICS_ORIGIN = "https://loreforeverwow.com";
const PAGES = new Map([
  ["/", "Home"], ["/downloads", "Downloads"], ["/voices", "Voices"],
  ["/willo", "Willo"], ["/faq", "FAQ"], ["/whats-new", "What's new"],
  ["/privacy", "Privacy"], ["/terms", "Terms"], ["/refunds", "Refunds"],
  ["/plans", "Plans"], ["/contributors", "Contributors"],
  ["/guides", "Guides"], ["/lore", "Lore"],
]);

export function analyticsPage(request, env, response) {
  const url = new URL(request.url);
  const id = String(env.GA4_MEASUREMENT_ID || "").trim();
  if (url.origin !== ANALYTICS_ORIGIN || request.method !== "GET" ||
      String(env.CANONICAL_HOST || "").trim().toLowerCase() !== "loreforeverwow.com" ||
      !/^G-[A-Z0-9]{4,20}$/.test(id) || response.status !== 200 ||
      !/^text\/html\b/i.test(response.headers.get("Content-Type") || "") ||
      /noindex|none/i.test(response.headers.get("X-Robots-Tag") || "")) return null;
  const path = url.pathname;
  let title = PAGES.get(path), kind = "page";
  // These handlers return 404 for unknown entries and noindex for drafts/hidden lore.
  // The editor, data files, profiles and all other routes are outside this allowlist.
  if (!title && /^\/guides\/(?!edit$)[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path)) {
    title = "Guide";
    kind = "article";
  }
  if (!title && /^\/lore\/(?:zone|dungeon|subzone|npc|boss|quest|item|topic)\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path)) {
    title = "Lore entry";
    kind = "lore";
  }
  return title ? { id, path, title, kind } : null;
}

export function analyticsMarkup(page) {
  // Each value is constrained above; escape title as well because What's new has an apostrophe.
  const attr = s => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  // Escape the old unversioned four-hour browser cache after the footer repair.
  // These assets also revalidate on later loads via public/_headers.
  const version = "20261021-footer";
  return `<link rel="stylesheet" href="/analytics.css?v=${version}">` +
    `<script id="lf-analytics" src="/analytics.js?v=${version}" defer data-id="${page.id}" data-path="${page.path}"` +
    ` data-title="${attr(page.title)}" data-kind="${page.kind}"></script>`;
}

export function withAnalytics(response, page) {
  const out = new Response(response.body, response);
  out.headers.set("Cache-Control", "private, no-store");
  // The origin alone protects Google fetches from query/path leakage, while preserving
  // Sources' ability to recognize a same-site navigation via document.referrer.
  // The Google script itself separately uses no-referrer.
  out.headers.set("Referrer-Policy", "origin");
  out.headers.delete("Content-Length");
  out.headers.delete("ETag");
  const csp = out.headers.get("Content-Security-Policy") || "";
  out.headers.set("Content-Security-Policy", csp.replace(/(^|;\s*)script-src\s+([^;]+)/,
    "$1script-src $2 https://www.googletagmanager.com"));
  return new HTMLRewriter().on("head", { element(el) { el.append(analyticsMarkup(page), { html: true }); } }).transform(out);
}
