// The guides editor's API (lib/guides-cms.js; /guides/edit). Editors only (GUIDE_EDITORS): 401 signed out, 403 for
// another account.
//   GET  /api/guides                        -> {ok, editor, articles: [{slug, title, date, kind, draft, source, ...}]}
//   GET  /api/guides?slug=x                 -> {ok, article: {slug, title, ..., body, source, saved_at}, revisions}
//   GET  /api/guides?slug=x&revision=3      -> {ok, article} as that earlier version
//   POST /api/guides {action: "preview", slug, meta, body}           -> {ok, html}   the article as the page shows it
//   POST /api/guides {action: "save", slug, meta, body, base, isNew} -> {ok, article}  live at once
//   POST /api/guides {action: "delete", slug}                        -> {ok}

import { fail, noStore, sameOrigin } from "../../../lib/accounts.js";
import { editorFor, fromInput, getOne, getRevision, listAll, remove, revisions, save } from "../../../lib/guides-cms.js";
import { articleBody, loadIndex, privateGuideResponse } from "../../../lib/guides.js";
import { dropEdgeCached } from "../../../lib/edge-cache.js";

// The pages a save or delete changes, forgotten in the editor's data center so they see it at once (lib/edge-cache.js).
const fresh = (env, request, slug) => dropEdgeCached(env, request, ["/guides", "/guides/" + slug]);

async function get({ request, env }) {
  const who = await editorFor(env, request);
  if (who.error) return fail(who.status, who.error);
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug");
  if (!slug) return Response.json({ ok: true, editor: who.user.email, articles: await listAll(env, request) }, { headers: noStore });
  const revision = url.searchParams.get("revision");
  const article = revision ? await getRevision(env, slug, revision) : await getOne(env, request, slug);
  if (!article) return fail(404, "No such article.");
  return Response.json({ ok: true, article, ...(revision ? {} : { revisions: await revisions(env, slug) }) }, { headers: noStore });
}

async function post({ request, env }) {
  if (!sameOrigin(request)) return fail(403, "Not from this site.");
  const who = await editorFor(env, request);
  if (who.error) return fail(who.status, who.error);
  let input;
  try {
    input = await request.json();
  } catch {
    return fail(400, "Expected JSON.");
  }
  if (input?.action === "preview") {
    const article = fromInput(input);
    return Response.json({ ok: true, html: articleBody(article, await loadIndex(env, request)) }, { headers: noStore });
  }
  if (input?.action === "save") {
    const out = await save(env, request, who.user, input);
    if (!out.error) await fresh(env, request, out.article?.slug || String(input.slug || ""));
    return out.error ? fail(out.status, out.error) : Response.json({ ok: true, article: out.article }, { headers: noStore });
  }
  if (input?.action === "delete") {
    const out = await remove(env, request, who.user, String(input.slug || ""));
    if (!out.error) await fresh(env, request, String(input.slug || ""));
    return out.error ? fail(out.status, out.error) : Response.json({ ok: true }, { headers: noStore });
  }
  return fail(400, "Unknown action.");
}

export const onRequestGet = context => privateGuideResponse(() => get(context));
export const onRequestPost = context => privateGuideResponse(() => post(context));
export async function onRequestHead(context) {
  const res = await onRequestGet(context);
  return new Response(null, { status: res.status, headers: res.headers });
}
