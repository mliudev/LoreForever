// /guides/<slug>: one guide or lore article, from public/guides/articles/<slug>.md (lib/guides.js, LOR-414). A draft
// is served for review but marked noindex; an unknown slug is a 404.

import { loadIndex, loadArticle, articlePage, missingPage, htmlHeaders } from "../../lib/guides.js";

export async function onRequestGet({ request, env, params }) {
  const [article, index] = await Promise.all([loadArticle(env, request, params.slug), loadIndex(env, request)]);
  if (!article) return new Response(missingPage(), { status: 404, headers: htmlHeaders("noindex") });
  return new Response(articlePage(article, index), { headers: htmlHeaders(article.meta.draft ? "noindex" : undefined) });
}

export async function onRequestHead(context) {
  const res = await onRequestGet(context);
  return new Response(null, { status: res.status, headers: res.headers });
}
