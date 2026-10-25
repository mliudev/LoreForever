// GET /api/home-book: the book on the home page (lib/home-book.js): Húrin's public profile as a story, a road, pictures
// and finds. The same for every visitor, so the edge keeps it for a few minutes (lib/edge-cache.js) and a launch-day
// crowd doesn't read his whole journey again for each. {ok: false} when his profile isn't public or can't be read, and
// the home page then simply leaves the book out.

import { setup } from "../../lib/accounts.js";
import { edgeCached } from "../../lib/edge-cache.js";
import { homeBook } from "../../lib/home-book.js";

const json = (body, status, cache) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cache },
});

export async function onRequestGet(context) {
  const { env, request } = context;
  return edgeCached(context, async () => {
    if (!env.DB) return json({ ok: false }, 503, "no-store");
    try {
      await setup(env);
      const book = await homeBook(env, request);
      return book ? json(book, 200, "public, max-age=300") : json({ ok: false }, 404, "public, max-age=60");
    } catch (e) {
      console.warn(`home book: ${e?.message || e}`);
      return json({ ok: false }, 503, "no-store");
    }
  }, { ttl: 300 });
}
