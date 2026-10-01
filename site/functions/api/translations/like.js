// POST /api/translations/like  {"locale": "deDE"}: one thumbs-up for a language on /translate ("I want this one").
// Counts once per language, per sender, per day (lib/translations.js); liking again the same day changes nothing.
// A JSON post gets {"ok": true, "count": n}; the plain form (the page without JavaScript) is sent back to the page.

import { loadLanguages, addLike, LOCALE } from "../../../lib/translations.js";
import { clean } from "../../../lib/form.js";

const fail = (status, error) => Response.json({ ok: false, error }, { status, headers: { "Cache-Control": "no-store" } });

export async function onRequestPost({ request, env }) {
  const json = (request.headers.get("Content-Type") || "").includes("application/json");
  let input;
  try {
    input = json ? await request.json() : Object.fromEntries(await request.formData());
  } catch (e) {
    return fail(400, "Couldn't read the like.");
  }
  const locale = clean(input.locale, 8);
  if (!LOCALE.test(locale) || !(await loadLanguages(env, request)).some(l => l.locale === locale)) {
    return fail(404, "No such language.");
  }
  if (!env.DB) return fail(503, "Likes aren't set up yet.");
  const count = await addLike(env, request, locale);
  if (json) return Response.json({ ok: true, count }, { headers: { "Cache-Control": "no-store" } });
  return Response.redirect(new URL("/translate#lang-" + locale, request.url).href, 303);
}
