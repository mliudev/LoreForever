# Guides and lore articles: /guides (LOR-414)

Patrick's articles (lore stories and how-to guides) live on the site at **`/guides/<slug>`**, listed at **`/guides`**
and in **`/guides/sitemap.xml`** (named in `public/robots.txt`). Each one is written in Markdown; the site does the
rest: the page in the site's style, a date and kind line, Article structured data, FAQ structured data for search and
AI answers, links to the other guides, and the "Get Lore Forever" call to action (`CTA` in `lib/guides.js`: one place
to point it at Willo later).

## The editor: loreforeverwow.com/guides/edit

The easy way, and the main one. Sign in on the site with an editor's account (the emails in the Pages variable
`GUIDE_EDITORS`, comma-separated: Patrick's and Mike's), then:

- **All articles** are listed, drafts too. **New article** starts one; click a title to edit it.
- **Edit** on the left, the **preview** on the right: the article exactly as the site shows it, updated as you type.
  The toolbar adds headings, bold, italic, links, lists, quotes and a FAQ section.
- **Pictures:** Add picture, or drop or paste one into the text. It's shrunk to 1600px wide, uploaded, and put in as
  `![what it shows](/guides/img/... "caption")`. On a line of its own it's a full-width picture with the caption under
  it; the first picture is also the article's picture when it's shared.
- **Status:** Draft (opens only from its link, kept out of the list and search) or Published. **Save** makes it live
  at once, no deploy. **Open on the site** shows the real page.
- **Earlier versions:** every save is kept; Load one and Save to bring it back. **Delete** hides the article (its
  versions stay).

Under the hood (`lib/guides-cms.js`): articles are rows in D1 (`guides`, every save also in `guide_revisions`),
pictures are in R2 (STUDIO, `guides/img/`) and served at `/guides/img/<name>`. An editor row replaces the file
article with the same address, so the files below open in the editor too and move to it on their first save.

## Add an article as a file (GitHub)

Still works, for articles written in git. Once an article has been saved in the editor, the editor's copy wins, so
edit it there from then on.

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
   - `draft: true` keeps it out of search, the list and the sitemap; it's still readable at its address. Remove the
     line (or `draft: false`) to publish. Patrick decides which (see "Publishing" below).
   - Optional: `author:` (a byline; leave it out for "Lore Forever") and `updated:` (a date).
   - Markdown: `##` and `###` headings, paragraphs, `- ` and `1. ` lists, `> ` quotes, `**bold**`, `*italic*` and
     `[links](https://...)`. Link to our own pages with `/lore/...` and `/downloads`. Pictures aren't supported yet.
   - **FAQ:** a `## FAQ` (or `## Questions`) section whose questions are `###` headings, each followed by its answer.
     They become the page's FAQ structured data.
3. Run `node scripts/guides-index.mjs`. It updates `index.json` and lists anything missing from the header.
4. Open a PR (a regular one, not a draft PR). It publishes itself; see below.

## Publishing

Patrick has the say on publish vs draft, and a guides PR goes live by itself: when a PR changes only files in
`site/public/guides/articles/`, the **Guides publish** check (`.github/workflows/guides-publish.yml`, which runs
`scripts/guides-publish.sh`) runs the guides test, merges the PR, puts it on loreforeverwow.com and comments each
article's address. It's live about three minutes later. Nobody else needs to review or merge it.

- **Publish a draft:** a PR that removes its `draft: true` line (and the rebuilt `index.json`).
- **Back to draft:** a PR that puts `draft: true` back. **Take one down:** a PR that deletes the file.
- **If the check fails** (a stale `index.json`, a header missing something), its comment says what. Fix it and push to
  the same PR; it runs again.
- A PR that also changes anything outside the articles folder merges the usual way (`scripts/merge-pr.sh`).
- When the site has other changes waiting to go out (held for a release), the PR still merges, and the comment says it
  goes live with the next site update.

The lore rules apply as everywhere else: follow WoW Forever (post-Warcraft III, before The Burning Crusade), no
spoilers past what the article is about, nothing from later expansions, and no "AI" wording in the copy.
