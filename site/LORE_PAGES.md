# Lore pages: /lore and one page per entry (LOR-233)

Every lore entry Lore Forever ships, on the site, as one open book (below): **`/lore`** is the book with no entry open
and **`/lore/<type>/<id>`** is one crawlable page per entry, open at that entry. An entry with a narration has its
script, a player per voice (1×/1.25×/1.5×, read-along) and "Report a problem with this line"; one without has its
spoiler-free text under its section headings and no Listen box. Both have their sources, "On the same road", links out
and a "Get Lore Forever" box. It's LOR-20 (lore entry pages: the narrated ones since 2026-10-04,
every entry the add-on ships since 2026-10-11) and the base of LOR-22 (SEO); the add-on's "Read more on the site"
(LOR-23) can link every entry it ships.

**The v2 page (LOR-809, Mike approved 2026-10-24):** an entry is a parchment page of the add-on's book (`.lp-book`
in `lore.css`; guides share the plain `.lp` styles), with the pages on the same road (the Related list), Hear it in
game, Look it up and the download button beside it, or under it on a phone. Listen is for everyone, no sign-in: "Play
the whole page" plays its recordings in a row, a bar stays at the bottom while it plays, and "Next plays on" (shared
with `/lore`'s) opens the next page in `/lore`'s order that has a recording (`nextPlayable`) with `?play=1`, which goes
on playing there in the same voice (or waits on the bar's Play if the browser won't start sound by itself). Plays are
counted as plain daily numbers in `site_counts` (`lore.play`, `lore.whole`, `lore.onward`; `POST /api/count/<what>`),
since nothing recorded them before.

**It's on (Mike, 2026-10-04):** the recordings are in R2 and the `lore` feature is on, so the pages are indexable, in
the sitemap and linked from the header and from player profiles. How it was turned on, for reference (below).

## The book (Mike's pick "Lore 2", 2026-10-24)

Both kinds of address are the same open book on the site's leather: two parchment pages in a dark frame, and a foot
player pinned under them (`lib/lore.js` `bookHtml`; styles `.bk` in `public/lore/lore.css`; `public/lore/lore.js`).

- **Left page** (`#lore-page`, the server's): the entry (its kind and zone, Listen with its narrator, the text, a player
  per recording, "On the same road" as chips, then sources, what's in it, "Hear it in game", Look it up and the download
  box). On `/lore` it says what the book is and lists every zone under "Browse by zone", so every page is linked from
  there without JavaScript. Every address keeps its own title, description, breadcrumbs, structured data and text.
- **Right page** (built by `lore.js`): a now-playing box, Up next, and the tools: search, language, zone, kind, sort (by zone,
  A to Z, recorded first), the download filter (LOR-437), "Playable here", "In my book" and **Play all**, which queues
  what the list shows; then one row per page grouped by zone, each with its play button (it plays the page's first
  recording in the narrator picked: the foot's narrator button, or `v`). The list is index.json + more.json (7,000 rows,
  100 at a time) with R2's recordings manifest. Searching also matches the questions a page answers.
- **Foot player**: play and pause, previous, next, how far along, the narrator, the speed, Report for what is playing, and
  Download. A row plays on to the next row with "Next plays on" ticked (remembered), or always after Play all; the page's
  own "Listen" plays its recordings in a row and then goes on the same way.
- **One address, one page**: a click on a row, a chip or any lore link fetches that address's page and puts its left page,
  title, description and trail in (`history.pushState`; back and forward work), so the click and a full load of the same
  address show the same thing. Anything unexpected is a normal page load. The player keeps playing across the swap.
- **Language**: the switch in the tools changes the page being read to the translated page when one exists (`/de/lore/...`);
  a page with none shows English with "Not in <language> yet". Only native recordings play for another language: in one,
  the rows have no play button, Play all is off and the page says there is no recording in that language yet (never the
  English narrator under translated text; the translated pages have no recordings of their own today).
- **Signed in**: with a profile, `GET /api/profile/found` lists the lore pages the journey names; those rows get a tick and the
  rest dim, "In my book" filters to them, and the left page's "Is this page in your book?" line is the one from
  `/api/profile/page`. Signed out, or without a profile, nothing changes.
- **Phones**: the entry on top and the playlist under it; the foot stays pinned. The book keeps parchment pages in both
  themes (the page colours are set on `.bk`, not by the site's theme), like the add-on.
- Remembered in the browser: `lf-lore-voice`, `lf-lore-rate`, `lf-lore-auto`, `lf-lore-lang` (what the list opens next:
  an address's own language wins).

## Turning it on

1. Upload the recordings (once; later runs send only what changed), from a full worktree at `origin/main` (the main
   checkout leaves out the recordings):

   ```bash
   scripts/new-worktree.sh --pointers ~/wt/upload-narration && cd ~/wt/upload-narration && python3 scripts/audio_store.py hydrate
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
| `item:dalin-s-heart` | `/lore/item/dalin-s-heart` |
| `topic:skyborne` | `/lore/topic/skyborne` |
| `quest:176` | `/lore/quest/176-wanted-hogger` (the quest's number, then its title as a slug) |

- **`/lore/quest/<id>` redirects** (301) to the page with the title, and so does an old title or any capitals, so a
  link never needs the title: the add-on can build `https://loreforeverwow.com/lore/` + the key with `:` → `/`.
- **Anchors** on a page: `#story` (the entry's narration), `#faq3` (a narrated answer: the `#faq3` of its clip id),
  `#detail`, `#progress`, `#complete` (quest dialogue).
- **Which entries have a page:** every lore entry the add-on ships (the keys in its own database, the same rule as
  `compile_lua`: the slice manifest's entities and the hand-written overrides), plus every quest that has quest
  dialogue and no lore entry: about 3,970. So **the add-on can link any entry it ships, without checking**: build
  `https://loreforeverwow.com/lore/` + the key with `:` → `/`, and for a quest whose key isn't a number
  (`quest:cutting-teeth`) use the first quest ID it claims (`meta.ids`; `/lore/quest/788`). A key outside the
  database, or a quest with neither lore nor dialogue, is a 404 page. `test_every_entry_the_addon_ships_has_a_page`
  fails if one of the add-on's keys has no page.
- **What a search result shows** (`searchTitle`, `searchDescription`, `breadcrumbLd` in `lib/lore.js`). Search
  Console (9/28-10/13) had the pages on page one for their own names and "wow forever <name>", and almost no clicks,
  so: the title is "<name> – WoW Forever Lore" (a place: "<name>, <zone> – WoW Forever Lore"; a quest: "<name> – WoW
  Forever Quest in <zone>"), with " | Lore Forever" when it still fits in 60 characters. The description is the
  entry's spoiler-safe summary in whole sentences (never cut mid-sentence unless the first one is longer than 160
  characters), then, when it fits, what the page has: a quest's level and zone and "with the quest giver's words read
  aloud", or "Read it, or hear it read aloud." for a narration. A quest with no summary gets its level and zone and the
  quest giver's first words. Every page has BreadcrumbList structured data (Lore › zone › entry, like the page's own
  trail), and the canonical URL is the address above.
- **Pages with nothing to play** (no narration, no quest dialogue: every item, most topics, and the characters and
  places that aren't narrated) show the summary, then each spoiler-free section under its own heading, then the same
  Sources, Look it up, "In <zone>", Related and "Get Lore Forever" as any page. No Listen box, no speed bar, no report
  link. (An entry whose summary `lore.spoilers` rewrote shows only its first section, as its narration would.)
- **Very thin pages are `noindex`.** A page with nothing to play and under **400 characters** of spoiler-free text
  (the summary and the sections together: a line or two, `THIN_CHARS` in `site_lore.py`) is served and listed on
  `/lore`, in its zone's list and in Related, but carries `noindex` (meta tag and `X-Robots-Tag`) and isn't in
  `/lore/sitemap.xml`; its links are still followed. Today that is 20 pages (15 items, 4 characters, 1 place), found
  in `more.json` and `index.json` as `"x": 1` and in the page's own data as `"thin": true`. The one exception is an
  entry whose summary was rewritten to keep a twist back (Onyxia): it is the page players look up, and it has been
  indexed since 10/4. A page that gets a narration or quest dialogue is never thin. Change the number in
  `site_lore.py`, rebuild, and the sitemap follows.
- **Related** is the entry's own list first, then an item's quests and a quest's giver and ender (when the name is one
  character's), then the pages that link to it, at most 12 (`RELATED_MAX`). A page is also listed under its zone
  ("In Elwynn Forest", grouped by kind); topics, which have no zone page, are listed at the bottom of `/lore`.

## Where the data comes from

`pipeline/lore/site_lore.py build` (`scripts/rebuild-generated.sh` runs it; commit what it changes) writes
**`public/lore/data/`** from `data/lore`, `data/clips.json`, `data/clips-quests.json`, `data/quest_dialogue.json`,
`data/spoilers.json`, the zone list in `data/slice/manifest.json` and our voice packs' `Clips.lua`:

- `index.json`: every page **with a recording or quest dialogue**, in browsing order (zone, kind, name), with its
  narrations: part, text hash and, per voice, the recording's sha and length. `/lore` and the sitemap read it, and so
  does the companion's lore player (`companion/lore_companion/lore_player.py`), which rejects a page kind it doesn't
  know (an `item` page would break it for every installed companion): so the pages with nothing to play are not here.
  Narrate a kind the companion doesn't know (items) and its player has to learn it first.
- `more.json`: the other pages (path, name, kind, zone, `x` when thin) for `/lore` (which merges the two lists back
  into browsing order) and the sitemap. About 160 KB (30 KB gzipped); `index.json` is no bigger than before.
- `e/<type>_<id>.json`: one page each. The Function `functions/lore/[type]/[id].js` renders it with
  `lib/lore.js`; `functions/lore/index.js` renders `/lore`.
- `links.json`: the pages by name, with each quest's giver (`data/quest_givers.json`) and storyline
  (`data/storylines.json`), for player profiles: their moments link here once the `lore` feature is on (LOR-248,
  `lib/trails.js`, site/README.md "Player profiles").

`pipeline/tests/test_site_lore.py` (in `scripts/check.sh`) builds the data and checks what it writes: no spoiler, no
answer that isn't narrated, every entry the add-on ships has a page, recordings read the current text. It doesn't
compare with the committed files, so after a lore or narration change run `scripts/rebuild-generated.sh` and commit
what it changes; the site serves the committed files.

**Kept off the site:** spoiler-flagged sections (`clips.script` reads the first spoiler-free section; the text pages
show only sections with `spoiler: 0`, and `test_no_spoilers_and_no_unnarrated_answers` checks every page), a narration
whose summary `lore.spoilers` flagged (the page shows the rewritten summary and plays nothing; 6 entries today, and a
text page uses the rewritten summary too), narrated answers flagged as spoilers, and every answer that isn't narrated: the
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
(`https://www.wowhead.com/forever/quest=176`, `npc=`, `zone=`, `item=`) and its Warcraft Wiki article (the first one it was
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
  (`GET /api/admin/narration/audio`), PUTs the rest (`PUT /api/admin/narration/audio?key=&sha256=`: MP3 or Ogg Vorbis
  only, at most 25 MB, R2 checks the SHA-256), then `POST /api/admin/narration/manifest` lists the bucket into
  `narration/manifest.json`. Pages play only what that manifest lists (`GET /api/narration/live`, public, cached
  5 minutes), so a page never shows a button that 404s. The upload routes sit under `/api/admin/` so Cloudflare Access
  covers them (LOR-493): the call sends the service token (`CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`, from
  `.env`) and `ADMIN_KEY` as the Bearer key. The routes accept a verified Access service token or `ADMIN_KEY`, never
  `FEEDBACK_KEY` (site/README.md, "Routes that verify the token themselves"). No wrangler
  login, so a routine can run it. The old `/api/narration/audio` and `/manifest` answer 410 Gone and name the new
  address; until the new route is deployed (it answers 404) the script falls back to the old one and says so. Nothing
  deletes old recordings (cheap to keep; remove them by hand if ever needed).
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

## Packs: which download has a recording (LOR-437)

`pipeline/lore/site_packs.py build` (after `site_lore build` in `scripts/rebuild-generated.sh`, and at each release's
stamp in `scripts/release.sh`) writes **`public/data/packs.json`**, what each pack the release ships holds (its
recordings and entries, a count per kind, the zones it covers, its zip, CurseForge project and what it needs) with two
or three examples per card on /downloads, and **`public/data/pack-entries.json`**, which packs have a recording of each
lore page that reads today's text. `lib/packs.js` renders them: "What's in the main download vs. the extra packs" and
the pack cards on /downloads, **Hear it in game** on an entry page (links to `/downloads#pack-<folder>`, e.g.
`#pack-voice-female-alliance`), and the **download filter** on /lore (`?p=<folder>`; `lore.js` reads
pack-entries.json when one is picked). A pack shows once it's out: in the main download, or released in voices.json
(translate/packs.json for text packs), checked at request time.

The examples play from `/audio/clip/` like the lore pages: our English narrators' story, lands and quest packs under
their voice ids (the same recordings R2 already has), every other pack under its folder (`voice-female-answers-places/`,
`voice-default-dede/`, `voice-questgivers/`, `edition-densuad-eses-audio/`...). `scripts/upload-narration-r2.sh` uploads
them after the lore pages' recordings (`site_packs upload`, which fetches a recording through Git LFS when the checkout
has only its pointer), and a page shows a ▶ only for what R2's manifest lists. Each example is a recording that reads
today's text, never a spoiler; the preferences are `EXAMPLES` in site_packs.py.

## Other languages (LOR-809)

`/de/lore/zone/elwynn`: a lore page in one of the add-on's languages (de, es, fr, it, pt-br, ru, uk, zh), at the English
address with the language in front, so the language switch only swaps the first segment. A page is translated when its
translation (`data/i18n/<locale>/lore/`) is current, the same `src_hash` check the language packs use, and has the summary
and every spoiler-free section; thin pages aren't translated. It's text only: no recordings (English audio under German
text is the wrong accent).

- **Built and kept in R2, not Pages or git:** about 36,000 pages, more than Pages' 20,000-file cap. `pipeline/lore/
  site_i18n.py` builds them from main in the English page's shape (`e/*.json`) plus `lang` and `en`, and uploads what
  changed to the STUDIO bucket under `lore-i18n/<seg>/<type>/<id>.json` through `functions/api/admin/lore-i18n.js` (ADMIN_KEY only, behind Cloudflare Access; scripts send the service token):
  the pages first, then `lore-i18n/index.json` (the languages, and each English page's languages as a bitmask), then
  deletes what's gone, so the index never names a page R2 lacks. `scripts/site-lore-i18n.sh` runs build, upload and
  check from origin/main in its own sparse checkout; release.sh and post-release.sh start it in the background after
  each site-live push (log: `~/.cache/lore-forever/site-lore-i18n.log`). There's no Pages build step to hang it on.
- **Served by** `functions/[lang]/lore/[type]/[id].js` with the same `entryPage` as English: only the loader differs.
  `lang` gives the page's labels (`lib/lore-strings.js`), `<html lang>`, its canonical and the hreflang alternates (only
  the languages that page has, plus English and x-default). Edge-cached like English, keyed on the index's etag too.
- **A missing or stale translation** is a 302 to the English page; a segment that isn't a language is the 404 page.
- **The switch:** "Read in" chips under the title on every page that has another language. Translated pages have no
  "Your page" line (the profile's moments name English pages).
- **Search:** each language's sitemap, `/<seg>/lore/sitemap.xml`, named in `public/robots.txt`, empty while the lore
  feature is off.

## Reports

"Report a problem with this line" posts to `POST /api/clip-report` (LOR-232, `site/CLIP_REPORT_API.md` from its
PR): `{clip: "<clip id>@<text hash>", voice: "<voices.json id, e.g. male-narrator>", reason:
"name|voice|cut|stage|quality|text|other", name? (≤ 60), say_as? (≤ 80; both only for "name"), note? (≤ 300),
source: "site", website: ""}` (`website` is the honeypot; the server folds `male-narrator` into
`LoreForever_Voice_Default`, so a report from the site and one from the add-on add up). Next to the button, the
clip's open-report count from `GET /api/clip-report/counts?clips=<ids>` (public; the reports' text stays private),
and in the foot player the playing clip's. The buttons and counts show only where that endpoint answers with its
JSON: until it's deployed, Pages answers with its home page (there's no 404.html) and they stay hidden, so this works
whichever PR lands first. Reports are about a recording, so a clip without a player has no button.

## Files

| File | What |
| --- | --- |
| `pipeline/lore/site_lore.py` | build / sizes / upload |
| `public/lore/data/` | generated data (committed): `index.json` (pages with a recording), `more.json` (the rest), `links.json`, `e/` |
| `lib/features.js` | the `lore` feature (the flag) |
| `lib/lore.js` | data loading, the manifest, page templates, sitemap |
| `functions/lore/index.js`, `functions/lore/[type]/[id].js`, `functions/lore/sitemap.xml.js` | the pages |
| `functions/audio/clip/[voice]/[file].js` | the recordings |
| `functions/api/narration/[action].js` | `live` (public); `audio`, `manifest` answer 410 |
| `functions/api/admin/narration/[action].js` | `audio`, `manifest` (upload; Access + `ADMIN_KEY`) |
| `public/lore/lore.js`, `public/lore/lore.css` | the book: playlist, foot player, page swaps, read-along, keys, filters, report form |
| `public/robots.txt` | names `/lore/sitemap.xml` |
| `tests/lore.test.mjs`, `pipeline/tests/test_site_lore.py` | tests |

Keys (anywhere in the book): `j`/`k` move through the list, space plays or pauses, enter opens the selected page, `/`
searches, `s` changes the speed, `v` the narrator. Speed, narrator and "Next plays on" are remembered in the browser.
