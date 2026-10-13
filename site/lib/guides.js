// Guides and lore articles (LOR-414): /guides lists them and /guides/<slug> is one article. Patrick writes them in
// Markdown; each is a file in public/guides/articles/<slug>.md with a short header (site/GUIDES.md says how to add
// one), and public/guides/articles/index.json lists them (rebuilt by `node scripts/guides-index.mjs`, checked by
// tests/guides.test.mjs). Every article ends with the download call to action (CTA below: one place to point it at
// Willo later). Kept outside functions/ so Pages doesn't route it.

import { page, escape } from "./voices.js";

export const ARTICLES = "/guides/articles";
export const HOME = "https://loreforeverwow.com";
// The call to action under every article. The add-on today; point it at Willo here when that's the better first step.
export const CTA = {
  heading: "Hear the story as you play",
  text: "Lore Forever tells you the story of each zone, place, character and quest as you reach it in WoW Forever, read "
    + "aloud, and answers what you wonder about along the way. Free, no account.",
  label: "Get Lore Forever",
  href: "/downloads?src=guides",
};
export const KINDS = { lore: "Lore", tutorial: "Guide" };
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEAD = `<link rel="stylesheet" href="/lore/lore.css">\n<link rel="stylesheet" href="/guides/guides.css">`;

// ---- The article file ----

// The header between two "---" lines: one "key: value" per line (title, description, date, kind, author, draft).
// Everything after it is the article's Markdown.
export function parseArticle(text) {
  const m = String(text || "").replace(/^\uFEFF/, "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const meta = {};
  if (!m) return { meta, body: String(text || "") };
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
    meta[kv[1].toLowerCase()] = v;
  }
  meta.draft = /^(true|yes)$/i.test(meta.draft || "");
  return { meta, body: m[2] };
}

// What's wrong with an article's header, if anything (the index script and the tests use it).
export function problems(slug, meta) {
  const out = [];
  if (!SLUG.test(slug)) out.push(`file name "${slug}" must be lowercase words joined by dashes`);
  if (!meta.title) out.push("needs a title");
  if (!meta.description) out.push("needs a description (one or two sentences for search results)");
  else if (meta.description.length > 170) out.push(`description is ${meta.description.length} characters; keep it under 170`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date || "")) out.push("needs a date like 2026-10-12");
  if (!KINDS[meta.kind]) out.push(`kind must be ${Object.keys(KINDS).join(" or ")}`);
  return out;
}

// ---- Markdown (the plain subset articles use) ----

// Inline: **bold**, *italic*, `code` and [links](url). Text is escaped first, so an article can't inject HTML.
function inline(s) {
  let out = escape(s);
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, url) => {
    const safe = /^(https?:\/\/|\/|#)/.test(url) ? url : "#";
    const ext = /^https?:\/\//.test(safe) && !safe.startsWith(HOME) ? ' rel="noopener"' : "";
    return `<a href="${safe}"${ext}>${text}</a>`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  return out;
}

const anchor = s => s.toLowerCase().replace(/<[^>]+>/g, "").replace(/&[a-z#0-9]+;/g, "").replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");

// Headings (## and ###; a # becomes ## since the page's title is the h1), paragraphs, "- " and "1. " lists and "> "
// quotes. Returns the HTML and the questions under a "## FAQ" (or "## Questions") heading: each "### question" and
// the text under it, for the page's FAQ structured data.
export function renderMarkdown(md) {
  const lines = String(md || "").replace(/\r\n?/g, "\n").split("\n");
  const html = [];
  const faq = [];
  let para = [], list = null, quote = [], inFaq = false, q = null;
  const flushPara = () => {
    if (!para.length) return;
    const text = para.join(" ");
    html.push(`<p>${inline(text)}</p>`);
    if (q) q.a.push(text);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    html.push(`<${list.tag}>${list.items.map(i => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`);
    if (q) q.a.push(list.items.join(" "));
    list = null;
  };
  const flushQuote = () => {
    if (!quote.length) return;
    html.push(`<blockquote><p>${inline(quote.join(" "))}</p></blockquote>`);
    quote = [];
  };
  const flush = () => { flushPara(); flushList(); flushQuote(); };
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { flush(); continue; }
    if ((m = line.match(/^(#{1,3})\s+(.+)$/))) {
      flush();
      const level = Math.max(2, m[1].length);
      const text = m[2].trim();
      if (level === 2) {
        inFaq = /^(faq|questions|frequently asked questions)\b/i.test(text);
        q = null;
      } else if (inFaq) {
        q = { q: text, a: [] };
        faq.push(q);
      }
      html.push(`<h${level} id="${anchor(text)}">${inline(text)}</h${level}>`);
      continue;
    }
    if ((m = line.match(/^>\s?(.*)$/))) { flushPara(); flushList(); quote.push(m[1]); continue; }
    if ((m = line.match(/^\s*(?:[-*]|(\d+)\.)\s+(.+)$/))) {
      flushPara(); flushQuote();
      const tag = m[1] ? "ol" : "ul";
      if (list && list.tag !== tag) flushList();
      list = list || { tag, items: [] };
      list.items.push(m[2]);
      continue;
    }
    if (list && /^\s{2,}\S/.test(raw)) { list.items[list.items.length - 1] += " " + line.trim(); continue; }
    flushList(); flushQuote();
    para.push(line.trim());
  }
  flush();
  return { html: html.join("\n      "), faq: faq.filter(x => x.a.length).map(x => ({ q: x.q, a: x.a.join(" ") })) };
}

// ---- Loading ----

async function asset(env, request, path) {
  try {
    const res = await env.ASSETS.fetch(new URL(path, request.url));
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

// index.json: [{slug, title, description, date, kind, draft}], newest first.
export async function loadIndex(env, request) {
  const res = await asset(env, request, `${ARTICLES}/index.json`);
  try {
    return res ? await res.json() : [];
  } catch {
    return [];
  }
}

export async function loadArticle(env, request, slug) {
  if (!SLUG.test(slug || "")) return null;
  const res = await asset(env, request, `${ARTICLES}/${slug}.md`);
  if (!res) return null;
  const { meta, body } = parseArticle(await res.text());
  // Pages answers a file it doesn't have with the home page (200), so an article is one with a header and a title.
  return meta.title ? { slug, meta, body } : null;
}

export const published = index => index.filter(a => !a.draft);
// A draft is served (for review: Mike reads it at its address) but kept out of search, the list and the sitemap.
export const htmlHeaders = robots => ({
  "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache",
  ...(robots ? { "X-Robots-Tag": robots } : {}),
});

const dateText = d => {
  const t = Date.parse(d + "T12:00:00Z");
  return Number.isFinite(t) ? new Date(t).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }) : "";
};

const jsonLd = obj => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`;

const ctaHtml = `<aside class="lp-cta">
    <h2>${escape(CTA.heading)}</h2>
    <p>${escape(CTA.text)}</p>
    <p><a class="btn-download" href="${escape(CTA.href)}">${escape(CTA.label)}</a></p>
  </aside>`;

const foot = `<p>Lore Forever is a fan project. Story details follow WoW Forever as it plays today.</p>`;

// ---- Pages ----

// /guides/<slug>: one article, with Article (and, when it has a FAQ, FAQPage) structured data.
export function articlePage({ slug, meta, body }, index = []) {
  const path = `/guides/${slug}`;
  const { html, faq } = renderMarkdown(body);
  const kind = KINDS[meta.kind] || "Guide";
  const when = dateText(meta.date);
  const more = published(index).filter(a => a.slug !== slug).slice(0, 5);
  const related = more.length ? `<section class="lp-rel" aria-labelledby="rel-title">
      <h2 id="rel-title">More from the guides</h2>
      <ul class="lp-links">
        ${more.map(a => `<li><a href="/guides/${escape(a.slug)}">${escape(a.title)}</a></li>`).join("\n        ")}
      </ul>
    </section>` : "";
  const data = [jsonLd({
    "@context": "https://schema.org", "@type": "Article", headline: meta.title, description: meta.description,
    datePublished: meta.date, ...(meta.updated ? { dateModified: meta.updated } : {}),
    author: { "@type": meta.author ? "Person" : "Organization", name: meta.author || "Lore Forever" },
    publisher: { "@type": "Organization", name: "Lore Forever", url: HOME },
    mainEntityOfPage: HOME + path,
  })];
  if (faq.length) {
    data.push(jsonLd({
      "@context": "https://schema.org", "@type": "FAQPage",
      mainEntity: faq.map(x => ({ "@type": "Question", name: x.q, acceptedAnswer: { "@type": "Answer", text: x.a } })),
    }));
  }
  const bodyHtml = `  <article class="lp gd" data-slug="${escape(slug)}">
    <p class="lp-where"><span class="tag lp-tag">${escape(kind)}</span>${when ? ` &middot; <time datetime="${escape(meta.date)}">${escape(when)}</time>` : ""}${meta.author ? ` &middot; ${escape(meta.author)}` : ""}</p>
    <h1>${escape(meta.title)}</h1>
    <div class="lp-text gd-text">
      ${html}
    </div>
    ${related}
  </article>
  ${ctaHtml}
  ${data.join("\n  ")}`;
  return page({
    title: meta.title, description: meta.description || meta.title, path, body: bodyHtml,
    crumbs: `<a href="/guides">Guides</a> &rsaquo; ${escape(meta.title)}`, foot, scripts: "",
    robots: meta.draft ? "noindex" : undefined, head: HEAD,
  });
}

// /guides: the published articles, newest first. noindex while there are none.
export function indexPage(index) {
  const list = published(index);
  const items = list.length
    ? `<ul class="gd-list">
      ${list.map(a => `<li><a href="/guides/${escape(a.slug)}"><span class="tag lp-tag">${escape(KINDS[a.kind] || "Guide")}</span>
        <strong>${escape(a.title)}</strong></a><p>${escape(a.description)}</p></li>`).join("\n      ")}
    </ul>`
    : `<p>The first guides are on their way.</p>`;
  const body = `  <section class="lp gd">
    <h1>Guides and lore</h1>
    <p class="lp-intro">Stories, places and people of WoW Forever, and how to get the most out of Lore Forever.</p>
    ${items}
  </section>
  ${ctaHtml}`;
  return page({
    title: "Guides and lore", description: "Stories, places and people of WoW Forever, and guides to Lore Forever.",
    path: "/guides", body, crumbs: "", foot, scripts: "", robots: list.length ? undefined : "noindex", head: HEAD,
  });
}

export function missingPage() {
  return page({
    title: "Guide not found", description: "This guide isn't here.", path: "/guides",
    body: `  <section class="lp gd"><h1>Guide not found</h1><p><a href="/guides">See every guide</a>.</p></section>`,
    crumbs: `<a href="/guides">Guides</a>`, foot, scripts: "", robots: "noindex", head: HEAD,
  });
}

// /guides/sitemap.xml: /guides and every published article (empty, and valid, while there are none).
export function sitemap(index) {
  const list = published(index);
  const urls = list.length ? [{ loc: `${HOME}/guides` }, ...list.map(a => ({ loc: `${HOME}/guides/${a.slug}`, lastmod: a.updated || a.date }))] : [];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${escape(u.loc)}</loc>${u.lastmod ? `<lastmod>${escape(u.lastmod)}</lastmod>` : ""}</url>`).join("\n")}
</urlset>
`;
}
