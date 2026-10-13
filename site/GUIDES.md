# Guides and lore articles: /guides (LOR-414)

Patrick's articles (lore stories and how-to guides) live on the site at **`/guides/<slug>`**, listed at **`/guides`**
and in **`/guides/sitemap.xml`** (named in `public/robots.txt`). Each one is a Markdown file; the site does the rest:
the page in the site's style, a date and kind line, Article structured data, FAQ structured data for search and AI
answers, links to the other guides, and the "Get Lore Forever" call to action (`CTA` in `lib/guides.js`: one place to
point it at Willo later).

## Add an article

1. Put the file in `site/public/guides/articles/<slug>.md`. The slug is the address: lowercase words joined by dashes
   (`who-was-edwin-vancleef.md` → loreforeverwow.com/guides/who-was-edwin-vancleef).
2. Start it with this header, then write the article in Markdown:

   ```markdown
   ---
   title: Who was Edwin VanCleef?
   description: The stonemason Stormwind refused to pay, and how he built the Defias Brotherhood. (Under 170 characters.)
   date: 2026-10-12
   kind: lore
   draft: true
   ---
   Edwin VanCleef was ...

   ## The Stonemasons' Guild
   ...

   ## FAQ
   ### Is VanCleef in WoW Forever?
   Yes: he waits at the end of the Deadmines.
   ```

   - `kind`: `lore` (stories, places, people) or `tutorial` (how to play, how to use Lore Forever).
   - `draft: true` keeps it out of search, the list and the sitemap while it's reviewed; it's still readable at its
     address. Remove the line (or `draft: false`) to publish.
   - Optional: `author:` (a byline; leave it out for "Lore Forever") and `updated:` (a date).
   - Markdown: `##` and `###` headings, paragraphs, `- ` and `1. ` lists, `> ` quotes, `**bold**`, `*italic*` and
     `[links](https://...)`. Link to our own pages with `/lore/...` and `/downloads`. Pictures aren't supported yet.
   - **FAQ:** a `## FAQ` (or `## Questions`) section whose questions are `###` headings, each followed by its answer.
     They become the page's FAQ structured data.
3. Run `node scripts/guides-index.mjs`. It updates `index.json` and lists anything missing from the header.
4. Open a PR. `site/tests/guides.test.mjs` fails if `index.json` is stale or a header is incomplete.

## Review before publishing

The lore rules apply as everywhere else: follow WoW Forever (post-Warcraft III, before The Burning Crusade), no
spoilers past what the article is about, nothing from later expansions, and no "AI" wording in the copy. A draft can
be merged and read at its address on the live site; publishing is the one-line change of removing `draft: true`.
