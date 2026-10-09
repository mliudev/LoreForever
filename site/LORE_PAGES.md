# Lore pages: /lore and one page per entry (LOR-233)

Every narration Lore Forever ships, on the site: **`/lore`** lists them all with filters (zone, kind, voice),
search, keyboard keys and a player bar, and **`/lore/<type>/<id>`** is one crawlable page per entry with its
narration script, a player per voice (1×/1.25×/1.5×, read-along), "Report a problem with this line", its sources
and a "Get Lore Forever" button. It's the start of LOR-20 (lore entry pages) and LOR-22 (SEO); the add-on's future
"Read more on the site" (LOR-23) links here.

**It's on (Mike, 2026-10-04):** the recordings are in R2 and the `lore` feature is on, so the pages are indexable, in
the sitemap and linked from the header and from player profiles. How it was turned on, for reference (below).

## Turning it on

1. Upload the recordings (once; later runs send only what changed), from the main checkout on `main`:

   ```bash
   scripts/upload-narration-r2.sh            # --dry-run first if you like
   ```

   Then `curl -s https://loreforeverwow.com/api/narration/live | head -c 300` should list keys, and a page such as
   https://loreforeverwow.com/lore/zone/stormwind shows play buttons.
2. Turn on the **`lore` site feature**: `FEATURES = { ..., lore: true }` in `site/lib/features.js` (the site's one
   switch for unreleased features). The pages become indexable, `/lore/sitemap.xml` fills, the
   `X-Robots-Tag: noindex` goes, the header shows a **Lore** link after Download, and player profiles link their
   moments to these pages (LOR-248). `site/tests/lore.test.mjs` asserts the feature is off: flip that line too. Add a
   CHANGELOG line ("Hear every narration on the site...").
3. Merge, then publish the site as usual (`git push origin origin/main:site-live`).

The Pages variable **`SITE_FEATURES=lore`** turns it on without a code change, e.g. on Preview to look at it as it
will be (`-lore` turns it off). Don't use it as the switch for production: a variable needs a redeploy and isn't in
git. The Lore link is in the header's markup (`SITE_NAV` in `lib/voices.js` and every static page's copy) while the
feature is on, so it's there from the first paint and without JavaScript; `header.js` hides it when
`GET /api/auth/me` says the feature is off (and remembers that for the next page, `lf-features`). Turning the feature
off in `lib/features.js` means taking the link out of `SITE_NAV` and the copies too.

## Addresses (the slug scheme)

An entry's page comes from its key, `<type>:<id>`, with the colon as a slash. Every key part is already lowercase
`[a-z0-9-]`.

| Entry key | Page |
| --- | --- |
| `zone:stormwind` (zone, capital or dungeon) | `/lore/zone/stormwind` |
| `subzone:goldshire` | `/lore/subzone/goldshire` |
| `npc:edwin-vancleef` (character or boss) | `/lore/npc/edwin-vancleef` |
| `topic:skyborne` | `/lore/topic/skyborne` |
| `quest:176` | `/lore/quest/176-wanted-hogger` (the quest's number, then its title as a slug) |

- **`/lore/quest/<id>` redirects** (301) to the page with the title, and so does an old title or any capitals, so a
  link never needs the title: the add-on can build `https://loreforeverwow.com/lore/` + the key with `:` → `/`.
- **Anchors** on a page: `#story` (the entry's narration), `#faq3` (a narrated answer: the `#faq3` of its clip id),
  `#detail`, `#progress`, `#complete` (quest dialogue).
- **Which entries have a page:** every lore entry with a narration in `data/clips.json` and every quest with quest
  dialogue (`data/clips-quests.json`): about 2,160 today. Any other address is a 404 page for now; LOR-20 adds the
  rest. Before the add-on links an entry, it should check it has a page (the same rule, or a list from the pipeline).
- The page title is "<name>: lore and narration" (quests: "<name>: quest dialogue read aloud"), the description is
  the entry's spoiler-safe summary cut to 155 characters, and the canonical URL is the address above.

## Where the data comes from

`pipeline/lore/site_lore.py build` (`scripts/rebuild-generated.sh` runs it; commit what it changes) writes
**`public/lore/data/`** from `data/lore`, `data/clips.json`, `data/clips-quests.json`, `data/quest_dialogue.json`,
`data/spoilers.json`, the zone list in `data/slice/manifest.json` and our voice packs' `Clips.lua`:

- `index.json`: every page in browsing order (zone, kind, name) with its narrations: part, text hash and, per voice,
  the recording's sha and length. `/lore` and the sitemap read it.
- `e/<type>_<id>.json`: one page each. The Function `functions/lore/[type]/[id].js` renders it with
  `lib/lore.js`; `functions/lore/index.js` renders `/lore`.
- `links.json`: the pages by name, with each quest's giver (`data/quest_givers.json`) and storyline
  (`data/storylines.json`), for player profiles: their moments link here once the `lore` feature is on (LOR-248,
  `lib/trails.js`, site/README.md "Player profiles").

`pipeline/tests/test_site_lore.py` (in `scripts/check.sh`) fails when the committed data isn't what `build` writes,
so a lore or narration change that skips the rebuild is caught like any other generated file.

**Kept off the site:** spoiler-flagged sections (the scripts already skip them: `clips.script` reads the first
spoiler-free section), a narration whose summary `lore.spoilers` flagged (the page shows the rewritten summary and
plays nothing; 6 entries today), narrated answers flagged as spoilers, and every answer that isn't narrated: the
Q&A set stays in the add-on, so the site can't be scraped for it. Narrated answers (about 110) are narrations, so
they're shown and played. What a quest giver says when you turn a quest in is folded ("Show the words").

**Sources** on each page, the "earn trust" point: the Warcraft Wiki articles the entry was adapted from (linked, CC
BY-SA), "Forever's own quest text, captured in game" for text harvested from the client (`In-game quest text:`
attributions and quest dialogue with `src: forever`), "Classic quest text" or "as quoted on the Warcraft Wiki" for
other quest dialogue, with "Quest text © Blizzard Entertainment", and **Community** for quest dialogue with
`src: community` (text one player sent in through lore.contrib, LOR-237, not confirmed by a second yet; a confirmed
line goes into the harvest as the client's text and shows as Forever's) or a `Community: ...` attribution. Nothing
on a page comes from Wowhead, so Sources never name it.

**Look it up** (LOR-263), under the sources: the entry on Wowhead's WoW Forever database
(`https://www.wowhead.com/forever/quest=176`, `npc=`, `zone=`) and its Warcraft Wiki article (the first one it was
adapted from, else the wiki's search). Plain links by game ID: the page's `wowhead` field, which `site_lore.py build`
takes from the language packs' `client_names.json` (Forever's own client tables and the community server databases,
`lore.client_names`; quests by their own ID), never from Wowhead. Wowhead has no pages for subzones (they 404), so
those link only the wiki. Profiles link their moments out the same way (site/README.md, "Player profiles").

## The recordings: R2, not git

Measured on 2026-10-04 (`uv run python -m lore.site_lore sizes`, current recordings only; a contested zone's clips
are in both lands packs but counted once):

| Voice | Narration | Quest dialogue |
| --- | --- | --- |
| Male narrator (core + lands) | 815 files, 301 MB | 3,481 files, 315 MB |
| Female narrator (core + lands) | 815 files, 312 MB | 419 files, 53 MB |
| **Total** | | **5,530 files, 981 MB** |

**Chosen: R2**, the `STUDIO` bucket the site already has (production `lore-forever-voices`, Preview
`lore-forever-voices-preview`), under `narration/<voice>/<stem>-<sha>.<ext>`, served by
`functions/audio/clip/[voice]/[file].js` at `/audio/clip/<voice>/<stem>-<sha>.<ext>`. `sha` is the first 10 hex
digits of the file's SHA-256 (the generator reads it from the Git LFS pointer when a worktree has no recordings, so
every checkout writes the same data). The address names the content, so it's cached for a year and a re-recording
gets a new address; an old deployment keeps playing what it named. Range requests get 206s (Safari needs them).

- **Upload** (`scripts/upload-narration-r2.sh` = `uv run python -m lore.site_lore upload`): checks the checkout's
  packs give exactly the recordings `index.json` names, refuses LFS pointers, asks the site what it has
  (`GET /api/narration/audio`), PUTs the rest (`PUT /api/narration/audio?key=&sha256=`: MP3 or Ogg Vorbis only, at
  most 25 MB, R2 checks the SHA-256), then `POST /api/narration/manifest` lists the bucket into
  `narration/manifest.json`. Pages play only what that manifest lists (`GET /api/narration/live`, public, cached
  5 minutes), so a page never shows a button that 404s. All of it uses the admin key (`ADMIN_KEY`, else
  `FEEDBACK_KEY`, from `.env`), like the translator kits: no wrangler login, so a routine can run it. Nothing deletes
  old recordings (cheap to keep; remove them by hand if ever needed).
- **Previews** have none in their own bucket: they ask production's manifest and their `/audio/clip/` redirects
  (302) to production's.
- **Why not a copy under `site/public`:** Pages serves from git and can't use LFS, so ~1 GB of audio (still ~300 MB
  re-encoded at 24 kbps) would go into the repo's history, again with every re-recording, and 5,530 files would count
  toward Pages' 20,000 (the site has about 2,400 with this data). R2's free tier covers this (10 GB stored, free
  egress).
- **Cost to watch:** each play is a Functions request (100,000 a day free on the Pages plan; a browser can make a
  few range requests per clip). If the pages get big, put the bucket on a custom domain (Cloudflare dashboard >
  R2 > bucket > Settings > Custom domains, e.g. `audio.loreforeverwow.com`) and point `AUDIO` in `lib/lore.js` and
  `public/lore/lore.js` at it: plays then skip the Functions quota.

## Reports

"Report a problem with this line" posts to `POST /api/clip-report` (LOR-232, `site/CLIP_REPORT_API.md` from its
PR): `{clip: "<clip id>@<text hash>", voice: "<voices.json id, e.g. male-narrator>", reason:
"name|voice|cut|stage|quality|text|other", name? (≤ 60), say_as? (≤ 80; both only for "name"), note? (≤ 300),
source: "site", website: ""}` (`website` is the honeypot; the server folds `male-narrator` into
`LoreForever_Voice_Default`, so a report from the site and one from the add-on add up). Next to the button, the
clip's open-report count from `GET /api/clip-report/counts?clips=<ids>` (public; the reports' text stays private),
and in `/lore`'s player bar the playing clip's. The buttons and counts show only where that endpoint answers with its
JSON: until it's deployed, Pages answers with its home page (there's no 404.html) and they stay hidden, so this works
whichever PR lands first. Reports are about a recording, so a clip without a player has no button.

## Files

| File | What |
| --- | --- |
| `pipeline/lore/site_lore.py` | build / sizes / upload |
| `public/lore/data/` | generated data (committed) |
| `lib/features.js` | the `lore` feature (the flag) |
| `lib/lore.js` | data loading, the manifest, page templates, sitemap |
| `functions/lore/index.js`, `functions/lore/[type]/[id].js`, `functions/lore/sitemap.xml.js` | the pages |
| `functions/audio/clip/[voice]/[file].js` | the recordings |
| `functions/api/narration/[action].js` | `live`, `audio`, `manifest` |
| `public/lore/lore.js`, `public/lore/lore.css` | player, read-along, keys, filters, report form |
| `public/robots.txt` | names `/lore/sitemap.xml` |
| `tests/lore.test.mjs`, `pipeline/tests/test_site_lore.py` | tests |

Keys on `/lore`: `j`/`k` move, space plays or pauses, enter opens the page, `/` searches, `s` changes the speed, `v`
the voice. On a page: space, `j`/`k` (next or previous narration), `s`. Speed, voice and "Next plays on" are
remembered in the browser.
