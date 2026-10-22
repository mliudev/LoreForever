// /guides/<slug>: one guide or lore article from the Worker bundle or CMS (lib/guides.js, LOR-414). A draft
// is only served to signed-in GUIDE_EDITORS; an unknown or inaccessible slug is a 404.

import { loadIndex, loadArticle, articlePage, missingPage, htmlHeaders, privateHeaders, guideResponse,
  unavailableResponse } from "../../lib/guides.js";
import { editorFor } from "../../lib/guides-cms.js";

export async function onRequestGet({ request, env, params }) {
  return guideResponse(async () => {
    const article = await loadArticle(env, request, params.slug);
    const missing = () => new Response(missingPage(), { status: 404, headers: { ...htmlHeaders(), ...privateHeaders } });
    if (!article) return missing();
    if (article.meta.draft) {
      let who;
      try { who = await editorFor(env, request); }
      catch { return unavailableResponse(); }
      if (!who.user) return missing();
    }
    const index = await loadIndex(env, request);
    return new Response(articlePage(article, index), { headers: { ...htmlHeaders(), ...(article.meta.draft ? privateHeaders : {}) } });
  });
}

export async function onRequestHead(context) {
  const res = await onRequestGet(context);
  return new Response(null, { status: res.status, headers: res.headers });
}
