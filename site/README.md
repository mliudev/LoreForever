# Lore Forever landing page

**Live:** https://loreforeverwow.com (Cloudflare Pages project `lore-forever`, also at https://lore-forever.pages.dev). Production deploys from the `site-live` branch of github.com/mliudev/lore-forever, not from `main`: pushes to
`main` and PR branches only make preview deploys (`<hash>.lore-forever.pages.dev`, listed in the Pages project),
so merging never changes the live site by itself.

**Publishing the site** (after checking the preview of the commit you want live):

```bash
git fetch origin && git push origin origin/main:site-live
```

That fast-forwards `site-live` to main and Cloudflare deploys it to loreforeverwow.com. To roll back, push an older
commit to `site-live` (`git push -f origin <sha>:site-live`) or use Rollback on an earlier production deployment in
the Pages project.

**The develop site** is https://develop.lore-forever.pages.dev: the `develop` branch, a scratch branch on Pages'
Preview environment (Preview's own D1 `loreforever-preview` and R2 `lore-forever-voices-preview`, so its data is
disposable). It's the one Preview address in the Google OAuth client, so it's where anything that needs signing in
gets tested: put a branch there with `scripts/deploy-develop.sh <branch>` (a force push; it says what it replaces).
Per-PR previews still build and are fine for pages that don't need an account, but sign-in only works on develop,
and no other preview address should be added to the OAuth client. develop holds one branch at a time: on release
days the release coordinator hands it out. Never merge develop into anything.

A static landing page and feedback page (`public/`) plus small Cloudflare Pages Functions in `functions/`
(download counts, sign-ups, stats, click counts and feedback). Hosted on Cloudflare Pages (free).
`functions/_middleware.js` redirects old addresses once the site has its own domain; see [DOMAIN.md](DOMAIN.md).
**`public/_routes.json` lists which paths run Functions: a new function outside `/api/*` and `/download/*` needs
its path added there**, or Pages serves a 404 instead.
Every page is sent with `X-Frame-Options: DENY` (nothing frames our pages, so nobody can overlay the account page's
buttons) and `Referrer-Policy: strict-origin-when-cross-origin`: `/*` in `public/_headers` for files, and
`functions/_middleware.js` for Function responses, which Pages doesn't apply `_headers` to. There's no CSP.

## Fill in before going live

**The page describes 0.2.0** (about 3,400 entries, narration, tooltips, primers). Only put it live once 0.2.0 is
the file on CurseForge and you've checked those features in game. Otherwise the page promises more than the
download does.

**Quotes must match the add-on.** The zone-card questions and the parchment sample answer are copied word for
word from `addon/LoreForever/Data`. Regenerating lore can reword them, so recheck them after each recompile
(last checked against the 3,422-entry build on 2026-09-27).

| What | Where |
| --- | --- |
| Download links and count | The main button, **Download for Windows**, fetches the latest signed installer from the GitHub release (`mliudev/LoreForever`) through `/download/installer`. The Downloads page recommends the Windows installer first, followed by the manual ZIP (`/download/zip`) and CurseForge (https://www.curseforge.com/wow/addons/lore-forever) as alternatives. No email step (removed in LOR-77). The count adds GitHub release downloads (public API) and CurseForge project `1715510` (`CURSEFORGE_PROJECT_ID` in the `<script>` at the bottom of `public/index.html`). The page shows "New release" until the count is above 0. |
| Author card and socials | The "Made by Mike" card in the header. Its bio is a placeholder for Mike to rewrite. Discord and Twitch (twitch.tv/jiuthaimike) are live there, in the sidebar and on the "Vote on Discord" button. Every Discord link goes through `/discord?src=...` (see "Discord redirect" below), never a raw invite. The LoreForeverWoW accounts (LOR-74) are listed in a comment in the card: move each one out of the comment once its account exists. |

## Screenshots and narration samples

### Download file details

`/api/download-files` shares GitHub release sizes at the edge. If GitHub fails, it serves the verified public
release snapshot in `public/data/download-files.json`. That response uses `publishedTag`, never an unverified
`latestTag`; `voices-page.js` pins its manual links to the same release before showing the sizes. Healthy live
metadata takes precedence again after the retry cooldown. Worker logs record the upstream HTTP status or
failure category without tokens or raw upstream bodies.

`scripts/release.sh` regenerates this snapshot after uploading release and language assets and before publishing
the site, using the existing `gh` login when available. A metadata outage leaves the previous verified snapshot
in place without blocking the release; its fallback downloads stay pinned to that older release. For an already
published release, run `python3 scripts/download_snapshot.py 0.10.0` from the repo root.
The generator refuses drafts, wrong tags, invalid sizes and missing catalog downloads.

**Screenshots** (`public/screenshots/`) are real captures from the Forever beta on 2026-09-27, cropped from the
desktop originals to hide player names and chat, then saved as JPEG:

| File | Shows | Source |
| --- | --- | --- |
| `01-stormwind-panel.jpg` | The panel in Stormwind; also the blurred banner background and link-preview image | `Screenshot 2026-09-27 170347.png` |
| `02-zephras-quest-chat.jpg` | Follow-up questions about a Skyborne quest (in the "Ask" section) | `170757` |
| `03-npc-tooltip.jpg` | Lore line on an NPC tooltip | `170337` |
| `05-zone-hint-chat.jpg` | Zone-entry chat message with a question and Listen link | `170842` |
| `06-spoiler-suggestions.jpg` | Spoiler-tagged section and suggested questions | `170156` |

Left out: `171159` (item tooltip) shows a "Keep: wanted for the quest" line that 0.2.0 removed; recapture one showing "Needed for your quest" if you want an item shot back. `165852` shows a raw color code (`|cff9d9d9d(narrated)|r`) in an answer title, and the uncropped
`170156` has overlapping legend text in the bottom-left corner. Both are fixed in the current build (c12db21), so a recapture would work now.

**Narration samples** (`public/audio/`) are copies of three clips from `addon/LoreForever_Voice_Default/Audio`
(`zone_stormwind`, `zone_zephras`, `zone_durotar`). The "Read along" text is exactly what each clip reads
(`lore.narrate.script`). If the clips are regenerated, copy them over again and update the text.

## Counters and visits

- **Public download count:** the zip and installer downloads of every GitHub release (the site's own download
  links included) plus CurseForge's own total, which counts app installs that never touch this page. The home page
  gets it from `GET /api/downloads` (`functions/api/downloads.js`, cached at the edge for a minute) and refreshes it
  every minute while it's open. CurseForge comes from its official API when the `CURSEFORGE_API_KEY` secret is set
  (a free key from console.curseforge.com, the freshest number), else cfwidget's exact total (about hourly), else
  shields.io's rounded badge. An optional `GITHUB_TOKEN` secret (no scopes needed) lifts GitHub's 60 calls an hour.
  If a source fails there, the page asks it from the browser instead.
- **Clicks from this page:** each click on a download link (Get it on CurseForge, Windows installer or zip) adds
  one to a per-day tally in a free D1 database. It's the site's only signal for CurseForge clicks, since those
  downloads happen on CurseForge.
  See the numbers at https://loreforeverwow.com/api/click with the admin key (D1 database `loreforever`, bound as `DB`). It's a rough traffic signal, not a unique-people count,
  and anyone who knows the address could bump it.
- **Site downloads:** the installer and zip links go to `/download/installer` and `/download/zip`
  (`functions/download/[file].js`), which count each download per day in the D1 table `downloads`, then
  redirect to the latest GitHub release. Link-preview bots aren't counted. This is the number for "is the
  site the download source?". `https://loreforeverwow.com/api/stats` shows site downloads, sign-ups and
  clicks (counts only, no addresses). Both `GET /api/stats` and `GET /api/click` need the admin key (see
  Private dashboard below):
  `curl -s -H "Authorization: Bearer $FEEDBACK_KEY" https://loreforeverwow.com/api/stats`
- **The daily IP hash** (`senderHash` in `lib/form.js`) is how every form and like counts "one sender per day" without
  keeping addresses: SHA-256 of that day's random salt, the day and the IP, cut to 24 hex characters. The salts are in
  D1 `daily_salts` (created on first use). The request that makes a new day's salt also deletes the salts from
  before yesterday and replaces earlier days' stored hashes (`ip_hash` in `voice_likes` and `translation_likes`,
  `sender` in the form tables) with random values, so like counts stay the same and an old hash can't be turned back
  into an address, even by trying every IPv4 address. The unsalted hashes from before 2026-10-03 go the same way.
- **Emails:** the optional sign-up box at the bottom of the page saves straight into the same D1 database, table
  `subscribers` (email, source, created_at), through `functions/api/subscribe.js`. Its source is `landing-page`;
  rows with `download-popup` came from the email pop-up before downloads, removed in LOR-77.
  No confirmation email. To see them: Cloudflare dashboard > Storage & databases > D1 > `loreforever` > Console,
  then run `SELECT email, source, created_at FROM subscribers ORDER BY created_at DESC;`
  There's no public way to list them. **Unsubscribing is self-serve:** `/unsubscribe` (`public/unsubscribe.html`)
  posts to `functions/api/unsubscribe.js`, which deletes the address and always answers "Done", so it never says
  whether an address was on the list. When you email this list, link https://loreforeverwow.com/unsubscribe.
  Both endpoints only take posts from our own pages (Origin check) and cap each sender per day (20 sign-ups, 10
  unsubscribes; `PER_DAY` in `lib/subscribers.js`), counted by the daily IP hash in `rate_limits`
  (`perDayFromIp` in `lib/ratelimit.js`).
- **Visits:** Cloudflare Web Analytics, turned on in the dashboard on 2026-09-27 (no code, no cookies, no cookie banner). See it under the Pages project > Metrics.

## Privacy page

`public/privacy.html` (https://loreforeverwow.com/privacy) says in plain language what the site keeps, why, who else
handles it (Cloudflare, Google, Discord, GitHub/CurseForge), what "Delete my account" removes and what stays. Every
footer links it (`page()` in `lib/voices.js` and each static page; `site/tests/privacy.test.mjs` fails if one doesn't),
and so do the account page's "What we keep", the sign-up box, the voice studio's release box and the narrator release.
It must stay true to the code: a feature that stores something new about people updates it and its date.

## Feedback form

`public/feedback.html` (served at https://loreforeverwow.com/feedback) posts to `functions/api/feedback.js`,
which saves each report in the same `loreforever` D1 database (table `feedback`, created on the first report).
Linked from the landing page's sidebar, footer and Known limits tab, the public README and the CurseForge listing.

- **Sign-in required (LOR-106):** sending feedback needs a Lore Forever account (Google sign-in, see "Voice profiles
  and contributor accounts" below). Signed out, the page shows a "Sign in to send feedback" box instead of the form;
  it goes through `/account?next=...` and comes back to the same address, query string included. `POST /api/feedback`
  without a session is refused (401 JSON, or a plain form post back to `/feedback?error=...`). Each report stores the
  account's `user_id` (null on reports from before this).
- **Fields:** kind (lore / bug / idea / review), optional 1-5 stars, message, optional entry code, name (starts as the
  account's name) and "OK to quote me". Only quote players on the site if they ticked that box. There's no email
  field: a reply goes to the account's email, which `GET /api/feedback` and the dashboard show in `email` (joined
  from `users`; older reports keep the email typed on the form). Once an account is deleted its reports stay,
  without an email.
- **Prefill links:** `/feedback?code=...&kind=lore&note=...` fills in the code, the kind and the message.
- **Report codes from the add-on (LOR-120):** the cross under an answer in the add-on asks why and "Copy report"
  gives a link to this page with a code like `LF1~0.4.0~w~ta~topic:kobold.f1~45~westfall/sentinel-hill~~65~why_are_...`
  (at most 120 characters: question, zone/subzone, target, quest ids, entry and FAQ shown, score, reason, add-on
  version; never the character name). `public/report-code.js` decodes it (format in its header, written by
  `Log.ReportCode` in `addon/LoreForever/Log.lua`); the page shows players what it carries, the message becomes
  optional, and `POST /api/feedback` finds the code even in a pasted link or Discord message. The decoded report is
  stored as JSON in the `report` column, spelled out in the Discord post and on the /admin card, and returned as
  `report` by `GET /api/feedback`.
- **Spam:** a hidden honeypot field, the sign-in, and at most 10 reports per account per day. Cloudflare Turnstile is
  optional, see below.
- **Without JavaScript:** signing in needs JavaScript, so the page shows only a sign-in link and a Discord link.
  A plain form post from a signed-in browser is still sent back to `/feedback?sent=1` or `?error=...`.
- **Needs `GOOGLE_CLIENT_ID`:** without it nobody can sign in, so nobody can send feedback.

**Set up in the Pages project** (Settings > Variables and Secrets, as encrypted secrets, then redeploy):

| Name | What it does |
| --- | --- |
| `FEEDBACK_KEY` | Any long random string. Needed to read reports; without it, reading is off. |
| `FEEDBACK_WEBHOOK` | Optional. A Discord webhook URL (Channel settings > Integrations > Webhooks, in a private channel). Each report is posted there as it comes in, with the name and a short account tag, never the email address. |
| `TURNSTILE_SECRET` | Optional, only if spam shows up. Create a Turnstile widget (Cloudflare dashboard > Turnstile, domain `loreforeverwow.com`), put its secret here and its site key in `TURNSTILE_SITE_KEY` at the top of the `<script>` in `public/feedback.html`. Set both or neither: a secret without the site key turns every report away. |

**Reading reports:**

```bash
curl -s -H "Authorization: Bearer $FEEDBACK_KEY" https://loreforeverwow.com/api/feedback
curl -s -H "Authorization: Bearer $FEEDBACK_KEY" "https://loreforeverwow.com/api/feedback?since=42"   # only newer than id 42
```

Or in the Cloudflare dashboard: D1 > `loreforever` > Console, `SELECT * FROM feedback ORDER BY id DESC`.

## Clip reports (LOR-232)

Players report a recording that's wrong (a name said wrong, the wrong voice, cut off, a stage direction read out...)
from the add-on's narration player: right-click > Report a problem with this narration (or its small cross, off by
default: Options > Show the report button on the narration player) gives a link to `/clip-report#c=LCR1~...`. `public/clip-report.html` reads the report from the fragment, takes it out of the
address bar, shows it and sends it with one click; no sign-in (a signed-in report counts for more). Any other page
can post the same report (the narration browser's report button does). API, fields and the code's format:
[CLIP_REPORT_API.md](CLIP_REPORT_API.md).

- **Nothing waits on Mike:** `uv run python -m lore.clipreports pull` (the nightly narration routine runs it) queues a
  clip for re-recording once 2+ people report it, or 1 signed-in player, and adds a name's sound to the pronunciation
  lexicon once 2+ people (or 1 signed in) give it. `/admin` > Clip reports only rejects spam, all of one uploader's
  open reports at once (Restore undoes it).
- **Public:** each clip's open-report count (`GET /api/clip-report/counts`). The reports' text stays private.
- **Spam:** honeypot, at most 30 new reports per sender per day (daily IP hash), one open report per person, clip and
  voice (sending again updates it), text capped at 60 / 80 / 300 characters. Table `clip_reports` (in `lib/accounts.js`
  `SETUP`; "Delete my account" removes a user's reports).
- Tests: `site/tests/clip-report.test.mjs`; `site/tests/fixtures/clip-report-codes.json` pins the add-on's codes
  (`pipeline/tests/wow_sim.py` checks the add-on against it).

## Site header and What's new (LOR-222)

Every page has the same header: the brand, **Download** (`/downloads`), **Lore** (`/lore`, while the `lore` feature is
on), **What's new** (`/whats-new`) and **Community** (`/feedback` without JavaScript), and on the right **Make your
profile** (`/account#profile`; **Your profile**, `/u/me`, once signed in) next to **Sign in** or the account chip. The
markup is `SITE_NAV` in `lib/voices.js`; each static page in `public/` carries a copy and `site/tests/nav.test.mjs`
fails if one differs, so change them together. Deeper pages add a breadcrumb row under it (`.subcrumb`).
`public/header.js` marks the link for the section you're on, turns Community into its menu (Discord, Send feedback,
Request a feature, Report a bug, then Record your voice, Translate and Contributors), switches the profile link and adds
the chip from `GET /api/auth/me`. It fits every width from 320 px: up to 840 px it's two rows (the brand, the profile
link and the account, then the four links), the short labels (Profile) go up to 960 px, and a long account name
shortens in the chip rather than push the header wider.

**Site features in the header:** the same answer says which features are on (`lib/features.js`). The Lore link is in
the markup while `lore` is on (`nav.test.mjs` keeps the two in step) and hidden while the answer says it's off;
**Share Forever text** joins the Community menu while `contribute` is on. `header.js` keeps the last answer's flags in
localStorage (`lf-features`) and shows them at once on the next page (the nav's inline script hides a Lore link that
was off before anything is drawn), so a returning visitor's header is complete from the start.

**Signed in or not, without a flash:** the answer from `GET /api/auth/me` takes a moment, so `header.js` keeps the
last one in localStorage (`lf-auth`: signed in with the chip's name and when that sign-in ends, or signed out and
whether sign-in is on; never the email) and shows it at once on the next page, correcting it if the answer differs.
With nothing kept (a first visit, private mode, a sign-in that has ended) the profile link's spot stays blank but keeps
its place until the answer: the nav's inline script sets `hd-wait` on `<html>` and `style.css` hides `.head-actions`
until `header.js` takes it off (shown anyway after 3 s; without JavaScript there's no `hd-wait`). `/u/<handle>` knows
who's signed in and puts it in the page (`siteNav` in `lib/voices.js`, so the page is `private, no-store` for them);
`/account` and `/link` tell the header when you sign in or out there (an `lf-auth` event).
`site/tests/header.test.mjs` runs `header.js` on a small DOM double.

**What's new** is `public/whats-new.html`: every version's notes, newest first, its headline changes as cards (the
first three with a bold lead-in). The home page's **"New in X.Y" strip** (`#newbar`, under the header) links to it,
and the What's new link gets a green dot while there's a version the visitor hasn't seen. "Seen" is `lf-seen` in
localStorage, set by opening What's new, following the strip or closing it; a first visit gets no dot, and the strip
stays until it's closed. **All three come from `CHANGELOG.md`**: `scripts/changelog.py site` writes the page, the strip
and `LATEST` in `header.js` along with the Changelog tab, and `scripts/release.sh` runs it at the stamp
(`pipeline/tests/test_changelog_site.py` checks the copies are current).

## Downloads, voice list and likes

`/downloads` (`public/downloads.html`, filled in by `functions/downloads/index.js`) has every file a player might
want: Lore Forever itself (installer, zip, CurseForge), then the narrator voices as a section, then the languages.
It was `/voices` until 2026-10-03; `functions/voices/index.js` now sends `/voices` there with a 301 (the add-on, old
videos and the CurseForge description may say either), and the voice pages under `/voices/` stay where they are.
The voice rows come from **`public/voices/voices.json`** through `lib/downloads.js`, with each voice's like count, so
the list works without JavaScript (`public/voices/player.js` plays samples in place and handles the likes). The house
narrators are ordinary entries, listed like any community voice.

- **Download choices (LOR-320):** the main add-on includes English male narration. A simple table has one choice per
  language and narrator, plus the optional quest-giver recordings. Language and voice filters narrow the choices;
  without JavaScript every released choice and its installation details remain available. Recording counts and
  compressed download sizes have separate labels. Details group every available component and the matching
  translation, while keeping CurseForge's actual coverage clear. Full manual bundles are used only after the release
  metadata confirms that exact version's file exists; older releases keep their working component downloads.
- **File sizes and version:** `GET /api/download-files` reads the official public GitHub release metadata through
  `lib/download-files.js` and caches complete answers at the edge for five minutes. `public/voices-page.js` uses one
  same-origin request to show each exact asset's size and the latest tag. Latest-release failure returns 503;
  recent-list failure keeps latest usable. Both return `no-store` to visitors; a separate internal cooldown avoids
  repeated upstream requests (one minute normally, five minutes for rate limits, up to one hour for retry/reset
  hints). The page keeps working download
  links while details are loading or unavailable. MB and GB are decimal units, and never an installed-size estimate.

- **Adding a voice:** add one entry to `voices.json` (id, name, credit, language, clips, coverage, tagline, sample,
  download) and put its sample under `public/audio/voices/`. `status: "soon"` lists it with a placeholder and no
  download. `download` is the zip on a GitHub release of the public repo; `/download/voice/<id>`
  (`functions/download/voice/[id].js`) reads it from the same file, counts the download in `downloads` as
  `voice:<id>` and redirects. Optional: `bio` (the profile page; blank lines split paragraphs), `samples` (the
  profile page; defaults to `sample`), `avatar`, `curseforge`, and `owner` (a contributor's account id, below).
  Never write how a voice is made in any of this copy, and never claim a person.
- **Likes (thumbs up only, no accounts):** `POST /api/voices/like` `{"id": ...}` adds a row to the D1 table
  `voice_likes` (voice_id, day, ip_hash; created on the first like), at most one per voice, per sender, per day
  (the same daily IP hash as the forms). The total is every row for that voice. `GET /api/voices/likes` returns
  all totals (public). Without JavaScript the button is a form post that comes back to the page.
- **Locally**, a plain static server shows an empty list; run `cd site && npx wrangler pages dev public` to run the
  Functions.

## Voice profiles and contributor accounts

- **Profiles:** `/voices/<id>` (`functions/voices/[id].js`) is built from the same `voices.json` entry for every voice,
  house narrators included: name, bio, avatar, all samples, like button, download. Any other `/voices/<name>`
  falls through to the static page. `/contributors` groups the voices by who made them, next to the translators and
  text finders (see "Contributors and credit" below); its old address `/voices/contributors` redirects there. Page
  templates are in `lib/voices.js`.
- **Accounts** (`lib/accounts.js`, API in `functions/api/auth/[action].js`, page `/account`): one Lore Forever
  account for every kind of contributor (per-user tables go in `SETUP` and `USER_DATA` there, so "Delete my
  account" removes them). Sending a voice from `/voices/submit` or feedback from `/feedback` requires it; playing,
  listening and liking don't. Sign-in is
  **Google only** (Mike, 2026-09-30; email sign-in was dropped, Firebase's email link is the option if it's ever
  wanted): the browser gets an ID token and the Function checks it against Google's keys and `GOOGLE_CLIENT_ID`
  (no client secret). The session is a random token in an HttpOnly cookie (`lf_session`, 30 days); D1 keeps only
  its hash. Tables, created on first use: `users`, `sessions`, `voices` (a contributor's voice: pending until
  published), plus `user_id` and `voice_id` columns on `voice_submissions`.
- **Publishing a contributor's voice:** the submission (dashboard, webhook, or `GET /api/voices`) carries
  `voice_id` and `user_id`. Add a `voices.json` entry with `"id": <voice_id>` and `"owner": <user_id>`. Its profile
  then shows the bio the contributor writes on their account page, and their name and links if they chose to show
  them. If they delete their account, the voice drops off the site at once (and so do their D1 rows).
- **Pages setting:** `GOOGLE_CLIENT_ID` (plain variable, Production and Preview; the OAuth web client in the GCP
  project under mike.liu.dev@gmail.com). Its authorized JavaScript origins must include every host that serves
  `/account`: the domain, `lore-forever.pages.dev` and the develop site `develop.lore-forever.pages.dev` (test
  sign-in there, not on per-PR previews; see "The develop site" at the top). Without it the account
  page says sign-in isn't on yet, and **`/voices/submit` and `/feedback` can't take anything**.

## Player profiles (LOR-181)

Any player can sign in (Google, as above) and make a profile: a page at `/u/<handle>` about their character, built
from the text the add-on's **Copy my journey record** gives them (Journey page; `addon/LoreForever/JourneyRecord.lua`).
Signing in is never needed to download. Entry points: "Make your profile" under the landing page's download buttons,
"Sign in" in the header for signed-out visitors, and "Your profile" in the account menu (`/u/me` goes to yours, or
to `/account#profile` when there's none yet).

- **Import** (`/account`, section "Your profile"): one paste, one click. `POST /api/profile/import`
  (`functions/api/profile/[action].js`) reads the record with `lib/journey.js`: size-capped (64 KB), line by line
  against the add-on's own strings in English, deDE, frFR, esES and ptBR. It keeps only the facts the page shows
  (JSON in `profiles.data`), never the text. The "with Dwarf Priest, Orc Warrior" on group content is dropped and only
  counted, and a "slain by" killer that isn't also a foe in the record is dropped, so no other player's name is kept.
  At most 10 imports a minute per account.
- **Address:** `/u/<handle>` starts as the character's name ("aelric", then "aelric-2", ...) and stays put when the
  record is updated. The owner can pick another on `/account` (3-24 letters, digits or dashes); the old one is
  then free, and links to it stop working. A record of a different character (name or realm) replaces the profile
  but makes it private again at that character's own address, so a page the player shared never turns into
  another character's; `/account` says so.
- **Privacy:** a profile is private until its owner ticks Public (on `/account`, or Make it public on the page);
  until then `/u/<handle>` is a 404 for everyone else. Pages are `noindex`. The page shows the character, never the
  account's name (often a real name from Google), plus the links from the account's "Your name and links". Delete my
  profile removes it; Delete my account removes it too (`profiles` is in `SETUP` and `USER_DATA`).
- **The page** (`functions/u/[handle].js`, templates in `lib/profiles.js`): the character's head (level, race,
  class, faction, realm, favorite spec), stat tiles, the story, the road so far (lands in the order first reached),
  then cards for bosses, dungeons, notable kills, most fought, best finds, mounts, professions, reputation and books,
  and a "Make your own" box (Download for Windows, Make your profile). OG and Twitter tags for link previews.
- **Share and View as a visitor (LOR-150, LOR-302):** every profile has a **Share** button at the top
  (`public/js/share.js`): the device's share sheet where there is one, else the link copied with "Link copied" and
  links to post it on X, Bluesky or Reddit. Visitors find it at the right of the head; the owner in their bar, next to
  **View as a visitor** and Make it public / private. On a private profile Share says to make it public first.
  **View as a visitor** (`?as=visitor`, owner only; anyone else is a visitor already) renders exactly the visitor's
  page, with one sticky bar on top saying so and **Back to my view**; for a private profile that's "No profile here"
  plus Make it public. `/account`'s link to the profile has the same Share button.
- **The share card (LOR-150, `lib/sharecard.js`):** the picture a link to a public profile shows (`og:image`), 1200x630:
  the name, race and class, four tiles (quests done, places, bosses, deaths), the story's first sentence and the
  address, with Harold (LOR-266) while the `companion` feature is on. The site draws no images itself: the owner's own
  page draws it in a canvas (`public/js/card.js`) whenever the profile changed since its card, and sends it to
  `POST /api/profile/card`. It's kept in R2 with the picture book (`pictures/<user id>/share-card.jpg`, so deleting
  the profile or the account takes it along) and served at `/share/<handle>-<sha>.jpg`. Before a profile has one,
  links show its newest picture, or the site's own card.
- **The journey in numbers (LOR-246):** since LOR-246 the add-on keeps a small tally per character (`Journey.lua`, "The
  tally": yards walked per zone from a running count, a look every 2.5 seconds from the update on, kills by creature
  type and rank, deaths, time online, the last `/played`) and prints it first in the record as "Journey stats", always
  the same lines in the same order, then
  "Yards walked, by land" and "Foes slain, by kind" as `Name: n` lists. `lib/journey.js` reads them into `data.stats`
  (by their words in the record's language or English, else by their place, so a newer translation still reads;
  `null` for an older add-on's record, which imports as before), and `lib/profile-stats.js` shows them under the stat
  tiles: steps walked (1.2 to the yard, `STEPS`, as the add-on counts them; Mike's call), foes slain, elites, rares and
  time played, a few lines told for fun ("the road from Goldshire to Booty Bay 3 times over") and where the steps went
  and foes by kind. Distances beside the steps are in miles; **Distances in miles / kilometres** (`public/js/units.js`,
  shown only with the script) switches them all and is remembered in the browser. It's the character's journey, not
  combat detail: no ranks or comparisons with other players. With stats, the Deaths tile counts every death.
  - *LOR-262* adds, after the six fixed lines (read by their words only): yards ridden, swum and flown, flights,
    places flown to, boat trips, fish, days played, the longest run of days in a row, words of the lore of the journey
    and narrations heard; and the lists "Slain by" (only creatures the character also killed, so the site trusts them
    as foes for "slain by"), "Most loyal patrons" (quests handed in per NPC), "Inns you've called home", "Flights, by
    destination" and "Minutes spent, by land". Deaths can say "drowned" (`cause`). The page adds Days played and Fish
    caught tiles, a line for "on this day" (a week, a month or a year ago, from `timeline`), a nemesis (a creature that
    slew them twice or more), the sea, famous figures met (`FAMOUS`, era leaders found in People met), the patron, the
    home zone, inns, fish, days in a row and how long the story's lore takes to read aloud (150 words a minute), and
    cards for how they traveled, where the time went and their patrons.
- **The journey, moment by moment (LOR-248,** `lib/trails.js`, `public/js/journey.js`**):** the site's take on the
  add-on's Journey tab (LOR-242). `lib/journey.js` keeps the record's moments in time order (`timeline`:
  `[section, index, day]`, the day only, never the hour; the record's times have no year, so it's the latest one
  that isn't in the future). The page lists them newest first by day, the latest 25 open and the rest folded, with
  filter chips (Places, Quests, People, Foes, Finds, Deaths, More). Each moment has its **trails**, in-page links
  (`#m-<n>`, dotted) that only ever lead to other moments of the same record, so nothing goes past what the player
  did: a quest to meeting whoever gave it, a person to their quests, a quest to the player's earlier and later
  chapters of its storyline (shown only as "Storyline · <zone>: <name>", no step numbers), "Last time here" / "Next
  time here" to the previous and next visit to the same place (moments in the same zone that name only the zone don't
  end a visit), a quest reward to its quest, and a death to the foe beaten later. `public/js/journey.js` unfolds and
  unfilters a moment a trail leads to, marks it and moves focus there; Back walks the trail back. Without JavaScript
  every moment is still there and the trails are plain anchors.
  - *Lore links* follow the **`lore` feature** (the lore pages are noindex and linked from nowhere until it's on):
    then each moment's name links its page (quest, character, boss, place, zone or dungeon), and the road and the
    cards link theirs. Items, books, mounts and factions have no lore pages yet: those moments link the place they
    happened. Names are matched through `public/lore/data/links.json` (`pipeline/lore/site_lore.py`
    `profile_links`: the pages by name, each quest's giver and storyline, a storyline's same-titled chapters in
    chapter order so the nth one done never links a later chapter). The lore pages are in English, so a record in
    another language links only the names that read the same.
  - *Links out (LOR-263):* each moment ends in a small **Wowhead** link to what it names on Wowhead's WoW Forever
    database (`https://www.wowhead.com/forever/quest=176`; `npc=`, `zone=`, `item=`, `faction=`) when `links.json`
    has its game ID (`refs`, from the language packs' client names: never Wowhead's data), else **Wiki**, the
    Warcraft Wiki's search for the name (it opens the article when one has that title). Quests, the people and
    bosses we know, zones and dungeons mostly have IDs; loot, books, mounts and subzones mostly go to the wiki (Wowhead
    has no subzone pages). They're other sites, so they don't wait for the `lore` feature.
  - *The character's Blizzard page:* none to link yet. Forever has no realms (one world per region and game mode,
    two-part names), and Blizzard's armory doesn't list Forever characters (checked 2026-10-04; third-party armories
    wait for API access). When it does, link it from the head, as the player's choice. Until then a player can add
    any page under "Your name and links" on `/account`.
  - *From the companion's journey data* (`profiles.journey`, below): when the profile has it, the moments come from
    it instead of the record: the player's own day for each (its `tz`), quests by ID (their lore page, giver and
    storyline by ID; Wowhead by ID even without a page), and quests taken as moments of their own ("Took on"), with
    **Taken at** / **Turned in at** trails between the two by quest ID, and a reward to its quest by ID. The page shows
    the newest 600 moments (`SHOWN`); a trail to an older one is just its name. A paste keeps the record's moments.
  - **Two views, right under the head** (Mike, 10/4: whoever a player shares the page with follows the trek):
    **Map** (the road chart, `#map`) and **Timeline** (the moments, `#timeline`; the old `#journey` opens it too),
    before the stats and the story. `public/js/journey.js` shows one at a time (Map first when there is one); a link
    to either view, or to a moment (`#m-<n>`), opens on it; Share passes on the page's link, and the owner bar also
    copies its map link or its timeline link. Without JavaScript both are there, one after the other.
  - **The road chart** (`lib/roadchart.js`, `public/js/roadchart.js`), the Map view: the lands reached as
    stops on **our own schematic chart** (Mike, 10/4: no map art from the game), each land at a hand-placed spot
    (`LANDS`: Kalimdor left, the Eastern Kingdoms right, Forever's own lands where their lore puts them), with the road
    drawn between them in the order travelled (one leg each time the next moment is in another land; thicker for a
    road taken often; the latest leg gold). With the companion's data a leg knows how it was travelled, and flights,
    boats, hearthstones and portals are dashed; from a paste every leg is a road. Only lands reached have names
    (the rest are faint dots), capitals and dungeons label on the other side from their zone (a name that would run off the
    chart moves to the other side), and names that match
    no land are listed under it. It opens fitted to the lands reached; wheel, pinch, + and − zoom, drag or arrow keys
    pan, ⤢ (or 0) shows it all again, and stops and names keep their size at any zoom. A stop shows that land's
    moments in the journey (`pf-land` → `public/js/journey.js`); without JavaScript it jumps to the first one there.
  - **The coasts behind it** (LOR-303, `lib/coasts.js`): our own drawing of Kalimdor and the Eastern Kingdoms in the
    chart's units, so the stops sit on land instead of an empty dark box (the "black box" on the 10/5 coaching call).
    No Blizzard art: each landmass is a ring of points placed one by one around where `LANDS` puts its lands (not
    traced from any map), with a fixed-seed wiggle between them and a smooth curve through it all, inline in the chart
    behind the roads. The world before the Dark Portal reopens: Teldrassil and a few isles (Echo, Theramore, Sardor), Lordamere
    Lake, Gilneas behind its wall, no Quel'Thalas and nothing later; Zephras Isle floats in Skywall, dashed. Moving a
    land in `LANDS` may need its coast moved too: `site/tests/coasts.test.mjs` checks every land is on its own
    continent, at least 15 units inside the coast.
  - Profiles saved before this have no `timeline`: they show as before, and their owner gets a line asking to update
    (the companion's next sync or a paste brings it).
- **The story:** with the Pages secret **`GEMINI_API_KEY`** (Production and Preview; optional; use a paid-tier key,
  whose prompts Google doesn't use for training), each import writes one with `gemini-3.1-flash-lite` (a
  `STORY_MODEL` variable can name another model, but only one with a price in `STORY_PRICES` is ever called): third
  person, 120-200 words, only the record's facts, in the record's language, never past Forever's era. A long record
  the add-on cut short is told as "the latest stretch", with no claim about where it began. A failed or out-of-era
  story (`offCanon`) keeps the previous one, or falls back to a summary built from the record (`templateStory`),
  which is also what every profile gets without the key. Each failure's reason goes to the Functions log
  ("profile story: ..."). Players only ever see "story".
- **What paid calls may cost:** at most **$100 a calendar month** (UTC) for profile stories, their voices, and
  companion live answers together (`STORY_BUDGET_USD` variable to change it). After each story call its cost is
  added to D1 `story_spend` from the reply's `usageMetadata`
  at Google's published paid-tier rates (`STORY_PRICES`: $0.25 per million input tokens, $1.50 per million output
  tokens including thinking, checked 2026-10-03), and at the budget no more calls are made until the next month.
  A story costs about $0.0006 and takes 2-4 seconds (measured 2026-10-03). Live answers reserve their maximum
  possible cost before calling Gemini and reconcile to the measured cost afterward (`answer_spend`).
  Each account also gets 3 tries a day (`STORIES_PER_DAY`, counted in `rate_limits`
  before each try, so deleting the profile doesn't reset it). `story_count` keeps an account's total, so writing it
  again can be gated later.
- **Listen (LOR-316; `lib/storyvoice.js`, behind the `storyvoice` feature, below):** a written story read aloud by
  the male campfire narrator, with a Listen button over it (`public/js/storyvoice.js`: plays the parts in order,
  lights up the paragraph being read, never starts by itself). A narrator choice in profile settings comes later.
  - *Recording:* the first time a page with a new written story opens, each part (a paragraph, split between sentences
    at 500 characters) goes to fal.ai's queue for its hosted Qwen3-TTS 1.7B, in the male narrator's voice: the packs'
    model and voices, respelled like them (`/lore/data/respell.json`, from `data/pronunciation.json`), no GPU of
    ours. fal posts each take to `POST /api/profile/voice/hook` (an HMAC of the part made with `FAL_KEY` in its
    address); it's stored in R2 at `story-voice/<user id>/<story>/<voice>-<part>.mp3` and served at
    `/audio/story/<story>-<voice>-<part>-<sha>.mp3`, like the picture book's files (a private profile's only to its
    owner). A failed part is sent again once. A new story's recordings replace the old one's; Delete my profile and
    Delete my account remove them. Template stories aren't recorded.
  - *Setup:* the Pages secret `FAL_KEY`, and the male narrator's speaker embedding in R2 (`story-voice/_narrators/`), sent
    once per site with `experiments/voices/local/story_voice_embed.py` (`PUT /api/profile/voice?narrator=`, admin key).
    The uploader prepares only the male narrator by default; `--narrator female-narrator` explicitly prepares another.
  - *Cost:* $0.09 per 1,000 characters, so about $0.09 per story (1,000 characters, a minute of audio),
    added to `story_spend.voice_micro_usd` and inside the stories' $100 monthly budget. The owner's page says the story
    is on its way while it's recorded (`GET /api/profile/voice?handle=`); visitors see Listen once it's ready.
- **Mike's view:** `/admin` shows "Profile stories this month" (spend against the budget, stories written, tries).
  Contributors lists each account's profile (character, level, class, public or private, link) and links, with a
  "Players" filter and CSV columns. The account page promises email only about feedback and contributions, so
  reach players through their public links.
- **Kept up to date by the companion (LOR-148):** the companion app can update the profile by itself after every
  `/reload` or logout, so nobody pastes again (`companion/README.md`, "Your profile on loreforeverwow.com").
  - *Connecting* is a device code, as a TV signs in (`lib/devices.js`, API `functions/api/device/[action].js`): the
    companion asks `POST /api/device/start` and opens **`/link?code=XXXX-XXXX`** (`public/link.html`, noindex); the
    player signs in there (Google) and clicks **Connect** (`POST /api/device/approve`; Not now: `deny`); the companion,
    asking `POST /api/device/token` every 3 seconds, then gets its own token, once. Codes last 10 minutes, are 8
    characters without vowels or look-alikes, and are typed any way. D1 keeps only SHA-256 hashes, of the link's
    secret device code (`device_links`) and of each app's token (`devices`), like sessions. Rate limits: 20 links an
    hour and 60 polls a minute per sender (daily IP hash), 10 approvals a minute per account.
  - *A token* (`Authorization: Bearer`) can only update its account's profile (`POST /api/profile/sync`) and read
    which character it shows (`GET /api/device/status`). It's revoked by **Connected apps › Disconnect** on
    `/account`, by the companion's Disconnect (`POST /api/device/disconnect`), by Delete my profile (a companion
    still connected would make it again), after a year unused, and with the account (`devices` and `device_links` are
    in `SETUP` and `USER_DATA`).
  - *An update* is a paste, read the same way, with three differences: it never switches the profile to another
    character (409 with the profile's `{name, realm}`, and the companion sends that character instead; switching is
    still a paste on `/account`); a record whose facts haven't changed skips fact delivery but can refresh a due
    story (`{unchanged: true}`); and the story isn't rewritten on every `/reload` (below). 6 a minute and 60 an hour per account.
  - *The journey data* (LOR-248): an update can carry `journey: {v: 1, tz, moments: [{t, k, ...}]}` next to the
    record (`companion/README.md`), built from the companion's journal: every story moment with its time and game IDs.
    `lib/journey.js` `readJourney` keeps only Journey.lua's moment kinds and the fields the page uses, tidies and caps
    names (2,000 moments at most, the newest), keeps no group and no positions, and keeps a killer only when the
    journey or the record lists it as a foe. It's stored in `profiles.journey` (a column added by `setupProfiles`)
    and counts in the "unchanged" check. An update without it (an older companion) or with data that doesn't read,
    and a paste of the same character, keep what's there; another character's paste drops it. Requests may be 256 KB.
  - *Stories from updates* (`lib/profiles.js` `storyDue`): the game fires the same event for `/reload` and logout, so
    "on logout" can't be told apart. An update writes a new story only when there's **something new to tell** since
    the last written one (a level, a new land, dungeon, boss or mount, or 5 more quests: `movedOn` against
    `profiles.story_basis`) **and at least 6 hours since the last try** (`profiles.story_at`, failed tries included),
    within the same 3 a day and $100 a month as pastes. A profile with no written story gets one on its first update.
    Automatic updates keep this cadence, rather than one story per `/reload`. A paste still writes one each
    time when its writer input changed (within the daily allowance). **Sync now** explicitly requests the newest
    story inside the automatic cooldown. The exact writer input is stored as a key; repeated current records reuse
    the story, and a database claim prevents concurrent writers. Facts save before writing; failure or limits keep
    the working story and return a separate status and retry time. The companion retries a pending story even when
    the delivered facts are identical.
  - `/account` lists **Connected apps** (when it last updated the profile, Disconnect) and says in the profile section
    that the companion keeps it up to date. Until the companion ships in Setup.exe (LOR-132), the invitation to
    connect it waits for the `companion` feature (below); connecting, updates and the list work either way.
- **Companion live answers:** `POST /api/companion/answer` takes the same linked-device token as profile sync and a
  capped lore/context prompt. The site uses its Gemini 3.1 Flash-Lite key, returns a short answer, and counts one
  of 20 free answers per account per UTC day. A successful call's input and output tokens go into `answer_spend`;
  its reserved cost and profile story/voice spend share the $100 monthly budget. The admin dashboard shows all
  three costs. Players can add their own provider key in the companion when the free allowance is used up.
- **The picture book** (Mike, 2026-10-05; `lib/pictures.js`, behind the **`pictures` feature**, below): pictures a
  player takes in game with the picture key, which the companion app puts on the profile, newest first, under the
  Map and Timeline views, each with its place, day (the player's own, from the journey data's `tz`), level and the
  caption the companion wrote; a picture opens large (`public/js/pictures.js`; without it, a link to the image).
  - *Uploads* (`functions/api/profile/pictures/index.js`): `POST /api/profile/pictures` from the companion with its
    token (as `/api/profile/sync`) or from our pages signed in, multipart `meta` (JSON: `cid, t, realm, faction, race,
    class, lv, z, s, at, clean, caption`) and `image`. JPEG only, told by its bytes (and its size read from them, not
    the meta), at most 1 MB, 500 per account (409 `{full}`), 30 a minute and 600 an hour (429 with Retry-After). The
    same `cid` again updates that picture; without `image` only its meta (a caption written later; 404 `{missing}` for
    a picture the site never got). Captions are capped at 600 characters and escaped on the page. `DELETE
    ?cid=` (or `?id=`) removes one, file and all. Removed with Remove on the page, its cid is remembered
    (`picture_tombstones`): a later POST of it from the companion, a late caption or the whole picture, gets 410
    `{removed}`, unless it's the whole picture with `restore: true` in its meta (the player turned "On my profile" on
    again by hand). The companion's own DELETE remembers nothing: it won't send that picture again by itself. Delete
    my profile or account forgets them with the rest. `GET ?handle=` lists a public profile's
    pictures while the feature is on (or with `&pictures=1`); the owner always gets theirs.
  - *The files* are in R2 (`STUDIO`) at `pictures/<user id>/<id>.jpg`, served by `functions/pictures/[file].js` at
    `/pictures/<id>-<sha>.jpg` (`/pictures/*` is in `_routes.json`): the address names the content, so it's cached for
    a year; a hidden or removed picture, an old address, or one on a private profile (but for its owner) is a 404.
  - *For later:* realm, faction, map position (`map`, `x`, `y` in thousandths) and when it was taken (`t`) are kept,
    with indexes on `(realm, t)` and `(map, t)`, for a realm chronicle that gathers many players' pictures of one live
    event. Nothing reads them yet.
  - *Reports:* anyone on the page can report a picture (`POST /api/profile/pictures/report {id}`, our Origin only, 30
    a day per sender; no account needed). Nobody reviews them: 3 from independent senders hide it for good. Senders
    are told apart by account when signed in, else by IP, on any day: the IP's hash is salted per picture
    (`report_salt`), not per day like the forms' hashes, so nobody can hide a picture alone by coming back the next
    day; an account and the IP it reported from count as one (`lib/contribute.js` `independentSenders`). Its owner
    can remove any picture.
  - Tables `profile_pictures` and `picture_reports` (`lib/accounts.js` SETUP, made on first use like the others; no
    migration step). Delete my profile and Delete my account remove the pictures and their files.
- Tests: `site/tests/journey.test.mjs` (the parser, including records the add-on itself makes, in
  `tests/fixtures/journey/`), `site/tests/profiles.test.mjs` (the API and the page end to end),
  `site/tests/pictures.test.mjs` (the picture book: uploads, updates, the cap, Remove, reports, the images, the feature),
  `site/tests/devices.test.mjs` (connecting, tokens, Disconnect, updates and when they write a story),
  `site/tests/trails.test.mjs` (the timeline, names to lore pages, the trails and the journey on the page),
  `site/tests/journeydata.test.mjs` (the companion's journey data, its moments and trails, and the road chart) and
  `site/tests/coasts.test.mjs` (the coasts behind the chart).

## Contributors and credit (LOR-239)

`/contributors` (`functions/contributors.js`, page and queries in `lib/credits.js`) thanks everyone who helps, in
three sections: **Narrators** (the voices in `voices.json`, grouped by who made them, with each voice's narration
count; a narrator's card keeps the `#c-<name>` anchor the voice pages link to), **Translators** (accepted or pulled
`translation_edits`, each string counted once per language) and **Text finders** (accepted or shipped lines from the
text intake at `/contribute`, LOR-235: the very list `GET /api/contribute/contributors` gives, `lib/contribute.js`
`contributors()`, so the two always agree; "accepted" is defined there and in `site/CONTRIBUTE_API.md`). The old
address `/voices/contributors` redirects there (301), and it's in the header's Community menu under Help out.

- **No ranks:** translators and text finders are listed alphabetically, never by how much they sent; counts show
  accepted work only. Narrators keep `voices.json` order (the house voices first). `/translate`'s "Translated by"
  lines list people in the order they started.
- **Only names people chose to show:** an account is listed by its display name, with its links, only when it ticked
  "Show my name and links" on `/account` (`users.show_public`); otherwise it isn't listed at all, even under a nickname
  it typed on an upload. A nickname typed without an account is listed as typed (the same name in any case counts
  once). Anonymous uploads aren't listed; their lines still count in totals. "Delete my account" unlinks that
  account's lines (`lib/contribute.js` `forgetUser`).
- **The Text finders section** appears once someone has an accepted line, or, with the `contribute` feature on (see
  "Unreleased features" below), as an invitation to send text. Until then the page doesn't link to `/contribute`.
- **`GET /api/credits`** (public, cached a minute): the same lists as JSON. `GET /api/credits?release=0.8.0` gives
  `{ok, release, lines, names}`: the community lines that shipped in that release (`status = 'shipped'`,
  `shipped_in` set by `lore.contrib mark-shipped`) and the shown finders. `scripts/post-release.sh` reads it for the
  announcement draft's "Thanks to this release's contributors: ..." line (Mike posts it; nothing posts automatically).
  If the site can't be reached, the draft goes without that line and says why; the step never fails over it.
- **Profile badges:** `/u/<handle>` shows small badges under the character for the account's accepted work:
  **Narrator** (a released voice in `voices.json` with `"owner"` = the account), **Translator** (accepted or pulled
  edits) and **Contributed N lines** (accepted lines it found first). They link to the sections of `/contributors`
  and never carry the account's name; they show on the owner's own public profile even if they keep their name off
  `/contributors`.
- Every query survives missing tables (`contrib_lines` is made by the first upload): no rows, no section, no badge.
- Tests: `site/tests/credits.test.mjs` (lines sent through the real `POST /api/contribute`, plus rows set to each
  status; checks `/contributors` against `/api/contribute/contributors`).

## Forever text progress (LOR-238)

`/contribute/progress` (`functions/contribute/progress.js`, page in `lib/progress.js`, counters in
`public/js/contribute-progress.js`) shows how much of what's new in WoW Forever we have: "Forever's new content: N
quests captured, M narrated" (of the Forever-only quests we know of), a bar per zone (text captured, narrated drawn
over it), live counters and a **Wanted** list of Forever quests and NPCs we know exist but have no text for, grouped by
zone (lowest level first) and by level within each zone, with "pick it up in game and press Contribute". It leads with
Forever's own content and shows counts, never global percentages. Phone first.

- **Data:** `public/data/coverage.json`, written nightly by the ingest (`uv run python -m lore.contrib pull`, LOR-237):
  `{generated, forever_only: {quests_known, quests_with_text, narrated}, zones: [{zone, quests, with_text, narrated}],
  wanted: [{kind, id, name, zone, level}]}`. Read defensively (counts capped at their totals, names as plain text,
  unknown kinds as quests, at most 40 wanted per zone on the page). Without the file the page says the first count
  comes with the next nightly update, and still links to `/contribute`.
- **Live counters:** lines sent in, accepted, contributors and the last upload, from `GET /api/contribute/stats` in the
  browser, refreshed every five minutes while the tab is open. Without that API they stay hidden.
- **Unreleased:** noindex (meta tag and `X-Robots-Tag`) until the `contribute` feature is on, like `/contribute`, which
  links to it (and to `/contributors`); nothing else links to it. Its breadcrumb and buttons lead back to `/contribute`.
- Tests: `site/tests/progress.test.mjs` (fixture `site/tests/fixtures/coverage.json`).

## Unreleased features (the site flag)

`lib/features.js` holds the site's switches for features that wait for an add-on release:
`FEATURES = { contribute: false, zones: false, lore: true, companion: false, pictures: false }`. While a feature is off its pages still open by address (so previews and the
develop site can test them) but are noindex, and nothing players see links to them. **Turn one on by setting it to
`true` in the release that ships what it needs** (for `contribute`: the add-on release with the Contribute button,
LOR-234); the pages then drop noindex and get their links. Code reads it with `featureOn(env, "contribute")`. The
Pages variable `SITE_FEATURES` overrides the file without a code change (comma-separated; `contribute` turns it on,
`-contribute` off), e.g. on Preview to test the "on" state.

| Feature | Off | On |
| --- | --- | --- |
| `contribute` | `/contribute` and `/contribute/progress` are noindex; no Community menu link; `/contributors` doesn't link to `/contribute` | indexable; "Share Forever text" in the Community menu; `/contributors` invites text finders |
| `zones` | "Claim a zone" (LOR-231) hidden; `/voices/zones` noindex and unlinked | the zone box, Zone filter and "Zones narrated" show |
| `companion` | `/account` doesn't invite players to connect the companion (LOR-148); `/link`, updates and Connected apps still work | the profile section and an empty Connected apps say the companion can keep the profile up to date. On once Setup.exe ships the companion (LOR-132) |
| `pictures` | No "Picture book" on profiles, and `GET /api/profile/pictures?handle=` is a 404 for visitors; `/u/<handle>?pictures=1` (and `&pictures=1` on the API) shows it. Uploads, Remove, reports and the images work either way | every public profile with pictures shows its picture book (and its newest picture in link previews). On once Mike has seen it, with the companion's Picture book setting |
| `storyvoice` | No Listen on profiles and nothing is recorded | a written story is recorded in the male narrator the first time its page opens (needs the `FAL_KEY` secret and his embedding in R2), and Listen shows once every part is ready |

## Volunteer narrators

The "Make a voice" card on `/voices` leads to four pages under `public/voices/`:

| Page | What it is |
| --- | --- |
| `/voices/guide` | The narrator guide: clip list, reading, recording settings, file names, partial packs, rights, sending. It replaces the long `release/public/VOICE_PACKS.md`, which is now a short pointer here (the public repo still gets it). |
| `/voices/clips.csv` | The clip list: `voicepack clips` output (id, file name, suggested narrator, text, hash). **`scripts/release.sh` rebuilds it in its Stamp step** and commits it with the version bump, so it goes live with the site at the end of each release. To refresh it between releases: `cd pipeline && uv run python -m lore.voicepack clips --out ../site/public/voices/clips.csv`. Served as a download (`public/_headers`) and excluded from Functions in `_routes.json`. |
| `/voices/studio` | The upload page, the main way to send a voice (see "Upload page" below). |
| `/voices/lines.json` | The clip list as the upload page shows it: grouped like the add-on's Narrations tab, with the question, text, hash and pronunciation hints of each line in English and in every language that has a current translation of it. Written by `voicepack clips` next to `clips.csv` (so `scripts/release.sh` refreshes both). Excluded from Functions. |
| `/voices/submit` | The folder-link form (below), kept for people who'd rather share a folder. Sends the narrator to `/voices/thanks`. |
| `/voices/release` | The narrator release, a plain-language agreement with a version date (see "Changing the release" below). |
| `/voices/zones` | Who narrates which zone ("Claim a zone", below): `functions/voices/zones.js`, built on the server. Noindex and unlinked while the `zones` feature is off. |
| `/voices/lend`, `/voices/lend-terms` | "Lend your voice" and its terms (below). Not linked yet. |

**Submissions** post to `functions/api/voices.js`, which saves each one in the `loreforever` D1 database, table
`voice_submissions` (created on the first submission): credit line, email and/or Discord handle, pack name, a
Google Drive / Dropbox / OneDrive folder link (other links are turned away; there are no file uploads), which
clips, a note, the release version agreed to, the age box (18 or older; before release 2026-10-03 it allowed a
guardian to sign instead), the typed signature, country and time.
Same protections as feedback: a honeypot field, at most 5 submissions per sender per day (daily IP hash), and it
works without JavaScript (success goes to `/voices/thanks`, an error comes back as a small page of its own). They
show in the dashboard under Voice submissions (mark done, delete), or with the admin key:
`curl -s -H "Authorization: Bearer $FEEDBACK_KEY" https://loreforeverwow.com/api/voices`.

- **`VOICES_WEBHOOK`** (optional, Pages secret): a Discord webhook URL, in a private channel. Each submission is
  posted there with the credit, pack, clips, folder link and Discord handle; never the email address or the
  signature.
- **Changing the release:** edit `public/voices/release.html` and give it a new version date there, in
  `RELEASE_VERSION` in `lib/submissions.js`, and in the hidden `release` field and checkbox text of
  `public/voices/submit.html`. A form opened before the change is refused with a request to read the new version,
  and the upload page asks everyone to agree again on their next send. Each submission stores the version
  agreed to; git history keeps every version's text.

## Upload page (/voices/studio)

Contributors upload their recordings line by line and send the voice for review (LOR-95). Recording happens in their
own setup; the page only takes files. `public/voices/studio.html` + `studio.js` + `studio.css`, API in
`functions/api/studio/[action].js`, helpers in `lib/studio.js`.

- **Flow:** anyone can browse the lines, in any language with text (signed out, Upload / Send lead to sign-in) →
  sign in (the Lore Forever account) → upload: the first upload starts a voice named after the
  account in the language on show (a row in `voices` with a `locale`, status `draft`; at most 2 per account; rename
  it any time, or make one with "+ New voice") → **Send for review**, which asks for the narrator release the first
  time (D1 `studio_release`; uploading doesn't need it, since takes stay private until sent) and makes a
  `voice_submissions` row with the link `studio:<voice id>`, status `pending`, webhook as for the form. They can keep
  uploading and send again.
- **Line takes come from a recording app** (Mike, 2026-10-02: browser takes are low quality). People record in their
  own app; the page says how (Audacity, a decent mic, a quiet room, 44.1/48 kHz, MP3 or WAV) under each drop box.
  Recording in the browser came back on 2026-10-03 for one thing only: "Lend your voice" (below).
- **Claim a zone** (LOR-231): **off for now**, behind the `zones` feature in `lib/features.js` (`FEATURES.zones`; the
  Pages variable `SITE_FEATURES=zones` turns it on without a code change, `-zones` off). While it's off the upload page
  shows no zone box or Zone filter (`/voices/studio?zones=1` shows them anyway, for previews), `/voices/zones` opens by
  address but is noindex and unlinked, and voice profiles don't list zones; the claims API works either way. To turn it
  on for everyone: `zones: true` in `lib/features.js` (and a CHANGELOG line, since players see it then).
  (`public/voices/zone-claims.js` on the page, `public/voices/zone-list.js` shared with the
  server, API `functions/api/studio/zones/[action].js`, rules in `lib/claims.js`.) A box above the next line suggests a
  zone (starting zones and capitals first) and lists every zone with its lines and who has it. A zone is every story
  whose entry has that `zone` (lines.json `stories[].zone` and `zones`, written by `voicepack clips`): the zone's own
  story and the places and people in it, the same grouping the add-on's "zone" voice mode keeps together. One active
  claim per narrator, one active or done claim per zone and language (D1 unique indexes on `studio_claims`). A claim is
  done once the voice has a take of the current text of every line, and expires 14 days after it was made or after the
  newest upload in the zone; both are worked out from `studio_takes` whenever claims are read, so uploads need no
  change. The next-line box goes through the claimed zone first; "Show only this zone" filters the list (there's a
  Zone filter too). The credit typed when claiming (default: the account's name) is what the public list shows;
  `/voices/zones` and each voice's profile ("Zones narrated") show done zones. A partial pack plays wherever it has a
  line: `Voice.Refresh` ranks, per clip, only the voices with a current recording of it, so the rest falls through to
  the next voice in the list (the default narrator). Tests: `site/tests/zones.test.mjs`.
- **The quality bar** (`public/voices/quality.js`, run in `analyze()` for single files and zips alike, and so for
  the phone formats too): refused, with what to change, when the source rate is under 44.1 kHz, there's no sound
  above 10.5 kHz (phone calls, voice messages, MP3s under ~48 kbps), the noise floor is within 30 dB of the speech,
  over 0.1% of samples are clipped in runs, or it's under -32 LUFS; warned when the noise is within 40 dB. The
  guide's own settings (loudness, peaks, edge silence, length) are warnings in the same module. Our narration packs
  (24 kHz voices shipped as 64 kbps MP3: sound up to 11.5-13.5 kHz, -20 to -18 LUFS, up to 1.7 s of lead silence)
  must pass with no warning: `site/tests/quality.test.mjs` checks excerpts of them in `site/tests/fixtures/audio`
  (decoded with ffmpeg; skipped without it), next to phone, voice-note and 16 kHz files that must be refused.
- **The page:** a "Next line" box with the text to read, pronunciation hints and a target length (words / 2.5 per
  second), then every line grouped like the Narrations tab with a drop slot each (any file name). Filters: search,
  group, suggested voice, missing / needs a look / uploaded / text changed, and "Mine" picks per story (kept in the
  browser) that the Next box goes through first.
- **Upload many recordings at once** (LOR-121, `public/js/bulk-upload.js` + `bulk-core.js` + `unzip.js`, shared with
  the translation dashboard): drop a zip, a folder or files named as in `clips.csv`, or a test pack that comes back.
  The browser unzips (its own `DecompressionStream`, no library; at most 1,000 files, 1.5 GB unpacked, no entry
  expanding over 100:1, each entry stopped at its declared size and CRC-checked), runs the same checks and WAV/FLAC
  conversion as a single upload (`analyze()` in `studio.js`, passed in), and shows a preview before saving: new,
  replaced, unchanged (same text hash and CRC-32 as the stored take), unknown names (with "did you mean"), recorded
  against older text, failed checks. Saving PUTs each picked line through `/api/studio/take`, two at a time, with
  progress; a lost connection or a limit pauses it with **Resume**, and dropping the same files later shows what's
  saved as unchanged. Lua, TOC and other files are never kept or run: from a returned pack only `Clips.lua`'s
  `c["<line id>"] = "<hash>"` lines are read, as text, and sent as `X-Text-Hash`, which the server refuses (409)
  unless it is the line's current text, so a take of older text stays out.
- **Checks** run in the browser before upload, against the narrator guide: mono, 44.1/48 kHz (from the file header),
  loudness (BS.1770, the same as ffmpeg's ebur128 to 0.1 LU), peaks, silence at each end, and length against the
  text. They're warnings shown on the line; only a silent, unreadable or over-4-minute file is refused. The server
  refuses anything that isn't MP3 or Ogg Vorbis by its first bytes (`sniff()` in `lib/studio.js`), over 25 MB, or
  for a line without text in the voice's language.
- **WAV, FLAC, M4A, WebM, Opus and bare AAC become MP3 in the browser** (LOR-119; M4A and the rest because they're
  what phone, Windows and browser recorders save), so R2 only holds files the game plays: mono, 192 kbps,
  keeping 44.1 or 48 kHz (anything else becomes 44.1 kHz), in `public/voices/mp3.js` (`toMp3(buffer, rate)`, a
  module other pages can import). The encoder is lamejs 1.2.1, vendored unmodified at
  `public/voices/vendor/lame.min.js` (LGPL, loaded only when a file that needs converting is dropped). WebCodecs can't encode
  MP3, so it isn't used. The checks run on the original; after converting, the stereo and sample-rate warnings
  are dropped because the uploaded file meets them. Each upload also sends its CRC-32 (`X-CRC32`, kept in
  `studio_takes.crc32`) so the test pack can stream files without reading them on the server.
- **Test pack** (LOR-119): **Download my test pack** under "Hear it in game" lets a narrator hear their uploads in
  the add-on before sending. `GET /api/studio/pack?voice=<id>` (owner, or the admin key) streams a store-only zip
  (`lib/zip.js`) of `LoreForever_Voice_Test<Name>/` with the TOC, `Clips.lua` and `Audio/`. `<Name>` comes from
  the voice id like `lore.voicepack studio`'s pack name, so the folder never changes (re-download, unzip over it,
  `/reload`) and never collides with our packs or the voice's own published pack. The title is "<voice name>
  (test pack)" and the version `test-<date of the newest take>`. `lib/voicepack.js` ports `render_toc` and
  `render_clips` from `pipeline/lore/voicepack.py`; `site/tests/fixtures/` pins both sides to the same bytes, so
  change the Python first, rerun `uv run python tests/test_voicepack.py --write-fixtures`, then port it. Its
  `INTERFACE` must match `addon/LoreForever/LoreForever.toc` (a test checks).
  - **Which lines** (`public/voices/testpack.js`, shared by the page and the Function): takes recorded against the
    current text in the voice's language. A pack has one format, so if a voice has both MP3 and OGG takes, the
    format most of its lines use wins (MP3 on a tie) and the page lists the lines left out. Older WAV/FLAC takes
    from before the conversion count as left out too.
  - **Memory and CPU:** files go from R2 to the client one chunk at a time with their stored CRC in the header, so
    the Function holds one chunk and doesn't read the audio. An older upload without a CRC is checksummed on the
    way (a data descriptor after the file) and its CRC saved for the next download.
- **Tests:** `node --test 'site/tests/*.test.mjs'` (Node 22.5+; D1 on `node:sqlite`, R2 in memory) runs the test
  pack end to end through the Function, plus the zip writer against Python's `zipfile`. `bulk-upload.test.mjs` covers
  the zip reader's limits, the preview's sorting and both uploads (a 55-file voice zip, an edited kit) round-tripping
  through the test packs. `node site/tests/smoke-bulk-upload.mjs <preview URL>` (with `LF_SESSION`) does the same
  against a deployed site with 60 of the default voice's files and the site's own deDE kit;
  `site/tests/smoke-bulk-upload-browser.js` is the same test for a signed-in browser (paste it into the console),
  so no session cookie has to leave the browser.
  `site/tests/smoke-test-pack.sh <preview URL>` (with `LF_SESSION` set to a signed-in cookie) uploads two lines to a
  preview or `wrangler pages dev`, downloads the pack and checks it. `kits.test.mjs` covers the translator kits
  (Translations, below): upload, the linked kit, `?v=`, the preview redirect, the fallbacks and pruning.
- **Storage:** R2, bound as **`STUDIO`**: bucket `lore-forever-voices` for Production and `lore-forever-voices-preview`
  for Preview (like D1's `loreforever-preview`, so preview tests never touch real uploads; both created 2026-09-30),
  at `studio/<user id>/<voice id>/<file stem>.<ext>`, one file per line (a new upload replaces it; the translator kits
  share the bucket under `translate-kits/`, see Translations). D1
  `studio_takes` keeps each file's name, size, checks and the hash of the text it was recorded against: a line
  reworded later shows "text changed" and stays out of the pack until it's re-recorded. Limits: 400 uploads a day,
  60 a minute (`lib/ratelimit.js`, D1 `rate_limits`; the page waits out a 429's `retryAfter` and carries on) and
  1 GB per account. "Delete my account" deletes the files and rows; sent submissions stay, as the release says.
- **Turning a sent voice into a pack:**
  `cd pipeline && uv run python -m lore.voicepack studio <voice id>` (admin key from `.env`; `--site` for a
  preview) fetches the files through `GET /api/studio/export` and `/api/studio/audio` into `dist/studio/<voice id>/`,
  copying files that already meet the guide and converting the rest to mono 44.1 kHz (`--normalize` also
  loudness-normalizes). It prints the `voicepack build` command to run after listening. Then publish as usual
  (a `voices.json` entry with `"id": <voice id>` and `"owner": <user id>`).
- Without the `STUDIO` binding the page says uploads aren't switched on yet and points to the folder-link form.

## Lend your voice (/voices/lend, LOR-230)

A player reads our short script for about 2.5 minutes and we make a narrator voice from it with our own Qwen3 voice
clone, credited "voice by <their credit>". Never from game audio or anyone else's recordings (the competitors who
cloned Blizzard's actors got the worst backlash): only a donor's own reading of our script, which the render tooling
checks.

- **Hidden for now:** the page works at its address, but nothing links to it until the first lent voice has been made
  end to end on the GPU. Then set `LEND_VOICE = true` in `public/voices/studio.js` (a card on the upload page);
  `/voices/studio?lend=1` shows the card meanwhile.
- **The page** (`public/voices/lend.html` + `lend.js` + `lend.css`, phones first): sign in → a 6-second room check →
  the script (`public/voices/lend-script.json`: versions kept, each donation stores the one read) → **record in the
  browser** (MediaRecorder, mono, no echo cancelling, noise suppression or auto gain; the screen kept awake; a level
  meter; stops at 5 minutes) or upload a file → the studio's quality bar (`quality.js`, the same thresholds;
  `quality.test.mjs` checks it on a whole 2.5-minute reading), worded as fix-it hints (too quiet, noisy
  room, clipping, phone-call sound), and 1-5 minutes long → converted to MP3 (`mp3.js`, as for studio takes) → the
  terms → send. Afterwards the page is the donor's donation page: status, their recording, the test pack once it's
  ready, the credit, and **Withdraw my voice**.
- **The terms** (`public/voices/lend-terms.html`, `CONSENT_VERSION` 2026-10-04 in `lib/donate.js`; change both
  together): your own voice; used as a reference voice for AI speech synthesis (said plainly: legal consent, not
  marketing) in a free, non-commercial fan add-on; the narration given to players free; 18+ only; withdraw any time
  from the page, which deletes the sample and keeps it out of the next pack build, but copies players already
  downloaded can't be recalled. Stored like `studio_release`, in `donation_release`; each donation keeps the version
  and signature too.
- **API** (`functions/api/studio/donate/[action].js`, header lists every route): donor routes need the session and
  our Origin; `export`, `status` and `PUT pack` take the admin key (for `lore.donation`). One donation that isn't
  withdrawn per account; a new recording replaces it while it's still waiting (status `donated`), 10 sends a day.
  `VOICES_WEBHOOK` gets each donation and each withdrawal (never the email or the signature).
- **Storage:** R2 `STUDIO` at `studio/<user id>/_donation/<id>/sample.<ext>` and `.../pack.zip` (so Delete my account's
  sweep of `studio/<user id>/` removes them), D1 `voice_donations` (status donated → rendering → ready → published, or
  withdrawn) and `donation_release`, both in `lib/accounts.js` SETUP and USER_DATA.
- **Withdrawal** deletes the donation's R2 folder, sets status `withdrawn` and, for a published voice, deletes its
  `voices` row so its voices.json entry stops showing at once; the webhook says to remove the entry. The render
  tooling's next `sync` deletes the local copy. The row stays as the record of the agreement, the proof of the
  license (like a sent voice's narrator release in `voice_submissions`): the donation id, terms version, typed
  signature, age box, when they agreed (`consented`), sent and withdrew, the script version and the voice id it was
  published as. Everything else is cleared (`RECORD_ONLY` in `lib/donate.js`: the files' details, the test pack and the
  credit). **Delete my account** does the same to every donation of the account and also drops the link to it (owner
  `""`) and the per-account `donation_release` row, since each donation keeps its own copy of what was signed.
- **Making the voice** (Mike's machine; GPU job 8 in `~/lore-voice-renders/gpu-queue.md`):
  `bash experiments/voices/local/donation.sh <id>` runs `lore.donation sync` (downloads new samples to
  `~/lore-voice-renders/donations/<id>/`, deletes withdrawn ones), `donation_prep.py` (CPU: trim, -20 LUFS, Whisper;
  refuses a recording that doesn't read the script; `refpick.py` picks the best three 10-20 s references),
  `donation_render.py` (GPU, render_pack.py's text and chunking; the starter set first; stops for gpu-hold, WowB.exe
  or another runner's gpu-busy, exit 75, resumable; a job the GPU runner starts itself, `LORE_GPU_RUNNER_JOB=1`, never
  waits on gpu-busy, as with locale_guard.sh; `donation.sh --gpu-check` is a dry run), `pack_check.py --pack <dir> --cpu --trim donor`, one round of
  retakes, then `lore.donation pack <id> --upload` (a test pack, starter set first, under 90 MB, onto the donor's page:
  status ready), and the same again for the rest. Publishing is the usual manual flow: `lore.donation publish <id>
  --voice-id <id>` builds the full pack in `dist/`, sets status published (the `voices` row with the donor as owner)
  and prints the voices.json entry (`"donated": true` makes its pages say "voice by"). Its CREDITS never claim CC BY-SA:
  a lent voice is for Lore Forever's narration only.
- Tests: `site/tests/donate.test.mjs` (the lifecycle end to end), `pipeline/tests/test_donation.py` (sync, order, pack,
  the GPU rule, the reference picker, the script).

## Translations

`/translate` (`public/translate.html`) invites players to translate: how to help, one card per language (coverage,
reviewed or not, kit download, 👍), and a "report a bad translation" form. `functions/translate/index.js` fills the
cards in from `public/translate/languages.json` with the like counts, so they show without JavaScript.

| Page or file | What it is |
| --- | --- |
| `/translate/languages.json` | Coverage per language, written by `cd pipeline && uv run python -m lore.kit site`. Coverage is the share of the English text (by characters, interface and lore) that has text in that language; `reviewed` comes from `data/i18n/<locale>/pack.json`. |
| `/translate/kits/<locale>.zip` | Translator kits, built by the same command: one per language that has sources in `data/i18n/`, and `new.zip` (English only) for the rest, 5-10 MB each. **Not in git** (each rebuild used to add ~25 MB to its history): `lore.kit site` builds them into `dist/translate-kits/`, writes each one's SHA-256 into `languages.json` (`kitSha256`) and uploads them to R2 (see "Translator kits in R2" below). `functions/translate/kits/[name].js` serves the kit the deployment's own `languages.json` names, so production, previews and rollbacks each match their `/translate/data`. The zips are reproducible, so an unchanged kit keeps its hash and isn't uploaded again. Rerun after the English or a language changes (a release, a merged translation). |
| `/translate/submit` | The submission form: language, credit, contact, a Drive / Dropbox / OneDrive / GitHub link or pasted fixes, and the CC BY-SA agreement. Sends the translator to `/translate/thanks`. |
| `/translate#report` | Bad-translation reports: language, entry code or where it was seen, what's wrong, better wording. Links can prefill it: `/translate?lang=deDE&code=npc:hogger#report`. Lands on `/translate/reported` without JavaScript. |

**Storage** (same `loreforever` D1 database, tables created on first use): `translation_submissions`
(`functions/api/translations.js`, at most 10 per sender per day), `translation_reports`
(`functions/api/translations/report.js`, 20 per day) and `translation_likes` (`functions/api/translations/like.js`,
one per language per sender per day). Same protections as the other forms: honeypot, daily IP hash, works without
JavaScript. Submissions and reports show in the dashboard under Translations (mark done, delete), or with the admin
key at `GET /api/translations` and `GET /api/translations/report`.

**Translator kits in R2** (`lib/kits.js`): the `STUDIO` bucket, under `translate-kits/<name>/<sha256>.zip`.
`cd pipeline && uv run python -m lore.kit site` uploads the kits it builds through `PUT /api/translations/kits` on
loreforeverwow.com, with the admin key from `.env` (`ADMIN_KEY`, else `FEEDBACK_KEY`), skipping kits already there.
`--no-upload` builds without uploading; `uv run python -m lore.kit upload` uploads later what the checkout's
`languages.json` links to (it rebuilds a missing zip, and refuses one that doesn't come out with the hash
`languages.json` names). Kits go to production even from a PR branch: a kit is only served where a `languages.json`
links to it, so one from an unmerged branch is never offered. Each upload removes uploads of that kit beyond the newest
10, but never the one production links to. `GET /api/translations/kits` (admin key) lists them.

- **Previews** read the Preview bucket (`lore-forever-voices-preview`), which has no kits (the Preview environment
  doesn't take the production admin key, so nothing uploads there), and send each download on to
  `https://loreforeverwow.com/translate/kits/<name>.zip?v=<sha256>`, which serves that exact kit. `wrangler pages dev`
  does the same; to serve kits locally, run `cd site && npx wrangler pages dev public --r2 STUDIO --binding
  ADMIN_KEY=local`, then `ADMIN_KEY=local uv run python -m lore.kit upload --site http://localhost:8788`.
- **A missed upload** never breaks the link: loreforeverwow.com serves the kit its `languages.json` names if it has
  it, else the newest upload of that name, else a 503 asking to try again shortly. Fix it with `lore.kit upload` from a
  checkout of what's live.
- **`TRANSLATIONS_WEBHOOK`** (optional, Pages secret): a Discord webhook URL; each submission and report is posted
  there, never with the email address.
- **Changing the agreement:** edit the checkbox text in `public/translate/submit.html` and give it a new version
  date there (hidden `terms` field) and in `TERMS_VERSION` in `functions/api/translations.js`.
- **Turning a submission into a pack:** download the translator's files, then
  `cd pipeline && uv run python -m lore.kit check <locale> <files>` to see what they change, and
  `uv run python -m lore.kit build <locale> <files>` to import them into `data/i18n/<locale>/` and compile
  `addon/LoreForever_Lang_<locale>/`. Released languages are listed in `PACKS` or `RELEASE_PACKS` in
  `scripts/build-release.sh`. The main ZIP keeps English male narration; the other languages travel with their voice
  packs. Standalone translation assets remain available for the translator tools. A new language ships when Mike
  decides it is ready.
- **Importing a draft kit:** use `lore.kit check <locale> <files> --draft`, then `lore.kit build <locale> <files>
  --draft` (or `import --draft` without compiling). Imported lore stays `reviewed: false`, and UI strings are not
  added to `ui_checked.json`, so both remain in **Drafts to check**. Existing reviewed lore entries are left intact,
  including entries whose English has changed, and checked UI strings are preserved. The automated language check
  still runs; `--draft` does not apply to dashboard pulls. A draft-import marker keeps current lore drafts out of
  normal automatic translation catch-up runs; an explicit translation `--force` can replace them.
- **Automated check:** `check`, `build` and `pull` send every string that would change, with its English, through an
  automated language check (`pipeline/lore/kit_review.py`, its key from `.env`), which flags wrong meanings, the wrong
  language, spam and gibberish. Flagged strings are left out and listed with the reason (`--keep-flagged` takes them
  anyway, `--no-review` skips the check). It costs well under a cent per hundred strings; on 80 existing German
  drafts it flagged none. Nobody on our side needs to read the language.
- **Public copy** presents languages and coverage without quality labels or review disclaimers. Contributor checks remain internal bookkeeping for the translation editor.

### Translator accounts and the translation dashboard (LOR-96)

Translators sign in with the same Lore Forever account as narrators (Google, `lib/accounts.js`) and translate in the
browser; the kit and `/translate/submit` stay for people who'd rather work offline (submitting needs an account too).

| Page or file | What it is |
| --- | --- |
| `/translate/dashboard` | The editor (`public/translate/dashboard.html`, noindex). **Needs work** (the default) gathers, across every section and most-read first: **Not translated**, **Drafts to check** (text nobody has written or checked: entries without `reviewed`, UI strings not in `ui_checked.json`), **Reported by players** (open bad-translation reports, shown above the entry) and **English changed**; the counts come from `translate/data/<locale>/status.json`. **Looks right** on a line (or the whole entry) sends the current text back unchanged, which `lore.kit pull` counts as a person checking it (the entry gets `reviewed`, the UI string goes into `data/i18n/<locale>/ui_checked.json`). **Browse by section** shows everything with filters (to do, has text, my edits, all) and search. English on the left, your text on the right, saved about a second after you stop typing. Signed out, it links to `/account?next=/translate/dashboard`. Links: `?lang=deDE&cat=draft`, or `?lang=deDE&section=zones_01&q=npc:hogger` for Browse. |
| `/translate/data/` | The editor's text, written by `lore.kit site`: `en/index.json` (sections), `en/<section>.json` (entry names and `[id, English]` pairs, at most ~700 KB) and `en/entries.json` (every entry and its section, in Needs-work order), `<locale>/<section>.json` (`{id: text}` for the strings that have text) and `<locale>/status.json` (what still needs a person). Excluded from Functions. |
| `/translate/fp.json` | For test packs (LOR-119), written by `lore.kit site`: `{english, interface, version, languages: {locale: {name, ttsVoices}}, entries: {key: [fp, section]}}`, where fp is the English entry's `Lang.Fingerprint` and section the `en/<section>.json` holding its current English. Excluded from Functions. |
| `GET /api/translations/pack?locale=` | **Download my test pack** on the dashboard (and `/translate#in-game`): a zip of `LoreForever_LangTest_<locale>/` (same folder every time) with the signed-in translator's edits that are `new`/`accepted` (not withdrawn, rejected or pulled), latest per string. An edit whose saved English differs from today's (`en/<section>.json`) is stale and left out; headers `X-Strings-Included` / `X-Strings-Stale` give the counts. Built by `lib/langtest.js` (a TOC that lists only `Lang.xml`, which loads `UI.lua` + `Strings_N.lua`, so a re-download with more files works after a `/reload`; kind `lang-overlay`); the add-on lays it over the language pack, string by string, while each entry's fp matches (`addon/LoreForever/Lang.lua`). Tests: `node --test site/tests/langtest.test.mjs`, `pipeline/tests/test_langtest.py`, `pipeline/tests/lang_sim.py`. |
| `/translate/check.js` | The checks every edit must pass (`%` codes in order, no new `\|` codes, not under 30% or over 300% of the English's length give or take 20 characters, no blocklisted word, no control characters), used by the editor as you type and by the API on save. Same rules as `problem()` in `pipeline/lore/kit.py`: change both together. |
| `/translate/blocklist.js` | Slurs and hate terms per language (en, de, fr, es, pt) that no edit may contain: whole words, ignoring case and accents. An edit is checked against its language's list and the English one. `kit.py` reads the same file (its object is plain JSON), refuses such strings on import and pull, and leaves them out of a language pack it builds, with a warning. Its header says where the words come from. |
| `/account` | Gains "Your translations": the languages you translate (ticked boxes, saved at once) and what happened to your edits. |

**API:** `functions/api/translations/[action].js` (`like.js` and `report.js` beside it keep their own paths).
Signed in: `GET me`, `GET edits?locale=`, `GET reports?locale=`, `POST languages`, `POST save` (an empty text
withdraws your waiting edit; 5,000 edits per person per day), `POST import` (an edited kit dropped on **Upload your
edited kit**: up to 200 strings a call, each checked and saved like `save`, status `new`, same daily cap, 20 calls a
minute). The dashboard reads the kit in the browser (`public/js/bulk-core.js` `readKit`/`planKit`, JSON files only,
`reference/` skipped, a returned LangTest pack recognized and not read) and applies `kit.py apply_strings`' rule
before anything is sent: empty strings, strings equal to the current text or your waiting edit, and strings whose
English changed since the kit (or that the add-on no longer has) are left out and listed; `lore.kit pull` checks the
English again. Admin key: `GET review?status=&locale=&user=&q=&offset=&limit=` (a page of edits and the total),
`GET summary` (counts per language and translator), `POST decide` (by ids, or `{user, locale?}` for all of one
translator's), `GET export?locale=`, `POST pulled`. **Tables** (in `SETUP` of `lib/accounts.js`, deleted with the account):
`translator_languages` and `translation_edits` (status `new` when saved, `rejected` from `/admin`, `pulled` once imported).
`translation_submissions` gets a `user_id` column.

**Shipping edits.** There is no approval step: Mike doesn't speak these languages, and native-speaker review comes
from Discord (and bad-translation reports), not from a gate. The automatic checks, the account requirement and the daily
cap guard the form; `/admin/edits` lists every edit so spam or vandalism can be **Rejected** (and **Restored**):
one at a time, a page at a time, or all of one translator's at once.

1. `cd pipeline && ADMIN_KEY=... uv run python -m lore.kit pull deDE --dry-run` shows what the saved edits change;
   without `--dry-run` it imports them into `data/i18n/deDE/` (same checks as a kit: a string whose English changed
   since the edit is skipped and stays English, and the automated check above leaves out what it flags). Flagged edits
   are rejected on the site (the translator sees "wasn't used"; `/admin` can Restore one), the rest are marked
   pulled. `--build` compiles the pack too; `--site` pulls from a preview instead.
2. `uv run python -m lore.kit site` (it uploads the kits) and commit, so the dashboard and `/translate` show the new
   text.

**Nightly import.** `scripts/import-translations.sh` does both steps for every language and opens a PR whose
description lists each changed string (before → after), the translators, the language's likes and any open
bad-translation reports on the changed entries (`lore.kit community`; `DRY_RUN=1` reports only, `NO_PR=1` stops after
the commit). Unlike `pull`, it marks an edit `pulled` only once the edit is on `origin/main`, so an unmerged PR loses
nothing: the next run imports it again. Imported text is marked reviewed (`"reviewed": true`, `ui_checked.json`), and
`lore.i18n translate` never overwrites it; `translate --ui` only sends strings with no translation yet. The
`nightly-translation-catchup` routine runs it before the machine pass. Likes and reports don't gate anything.

Each language card on `/translate` credits the translators whose edits are in the language and who ticked "show my name" on their
account, in the order they started (never by how much they sent; LOR-239). Languages in the main download (`"included": true` in `public/translate/packs.json`) say
so on their card instead of offering the pack zip.

## Shared Forever text (/contribute, LOR-235/236)

Players share the quest, gossip and book text Forever showed them, so Lore Forever can tell those stories too. The
add-on keeps it (`addon/LoreForever/Capture.lua`, Options › Keep the quest text you see) and offers a small
Contribute button on windows whose text it lacks; the full contract (what's kept, the code, tables, statuses, API) is
**[CONTRIBUTE_API.md](CONTRIBUTE_API.md)**.

- **`/contribute`** (`public/contribute.html`, `public/contribute/page.js`): drop LoreForever.lua (read in the browser
  by `public/contribute/svparse.js`, a strict Lua-table reader; only the lines are sent), see what's new, optional
  name for the credits, Send; or arrive from a Contribute link (`#c=`, decoded by `public/contribute-code.js` and taken
  out of the address bar) and send that one line. No sign-in; signed in, the account gets the credit.
- **API:** `POST /api/contribute` (`functions/api/contribute.js`), `GET /api/contribute/stats|contributors|receipt|export`
  and `POST /api/contribute/shipped` (`functions/api/contribute/[action].js`), the receipt page `/contribute/r/<id>`
  (`functions/contribute/r/[id].js`). Logic and tables in `lib/contribute.js`.
- **Nobody reviews lines.** Two independent senders, or one sender and 48 hours, accept a line; spam is held; a
  different text for the same part is a conflict until one is confirmed. `/admin` › Shared text only rejects a
  sender's spam (and restores it).
- **What's kept:** the text, its quest/NPC/book, build, language, the race/class/gender of who saw it, an optional
  nickname; never the file, never the IP (a daily salted hash for rate limits, dropped from upload rows after 30 days).
- **Known text:** `public/contribute/known.json` (hashes of what the add-on ships and what the Forever client gave our
  harvest; `cd pipeline && uv run python -m lore.known_text`, also run by `scripts/rebuild-generated.sh`). A stale copy
  only means fewer lines count as known.
- **Unreleased until the add-on ships the button:** the page is noindex and out of the Community menu while the
  `contribute` feature is off (`lib/features.js`; `SITE_FEATURES=contribute` on Preview turns it on). Flip
  `FEATURES.contribute` to `true` in the release that ships Capture.lua.
- Tests: `node --test site/tests/contribute.test.mjs` (the parser against a realistic file and hostile ones, codes,
  statuses, rate limits, honeypot, receipt, export, admin); `pipeline/tests/contribute_sim.py` (the add-on side, and
  its codes and SavedVariables through the site's decoder and parser when Node is around).

## Lore pages (LOR-233)

`/lore` lists every narration we ship (filters, search, a player) and `/lore/<type>/<id>` is one page per entry,
built by Functions from `public/lore/data/` (generated by `pipeline/lore/site_lore.py`, which
`scripts/rebuild-generated.sh` runs). The recordings are in R2 under `narration/`, uploaded with
`scripts/upload-narration-r2.sh`. **Public since 2026-10-04:** the `lore` feature in `lib/features.js` is on, so the
pages are indexable, in the sitemap and linked from the header. Everything about it, including the address
scheme the add-on will link to, is in [LORE_PAGES.md](LORE_PAGES.md).

## Private dashboard

https://loreforeverwow.com/admin shows sign-up emails, feedback reports, voice submissions and site downloads in one
place: totals, email sign-ups and downloads per day for the last 30 days, the feedback list (mark reports done, delete
spam), voice submissions (folder link, clips, contact, signature and release version; mark done, delete), and the
email list (search, copy, CSV export, remove an address when someone asks to unsubscribe; people can also do it
themselves at `/unsubscribe`).

- **Profiles:** how many people signed up (accounts, i.e. Google sign-ins), how many made a player profile and how
  many made it public, new accounts today and in the last 7 and 30 days, and new accounts per day. `GET /api/admin`
  counts them in SQL (`signups`), so they aren't capped like the Contributors list. Days are UTC, like the charts.
- **Clip reports:** reports on recordings per clip and voice (how many people, why, which names), the latest reports,
  and "Reject all from this uploader" / Restore for spam (see "Clip reports" above). Nothing to approve.
- **Translation edits:** saved, pulled and rejected per language; the edits have their own page, **/admin/edits**
  (`public/admin/edits.html`, same key): totals, translators (most edits waiting first, with Reject all saved /
  Restore rejected), and the edits 100 at a time, filtered by status, language, translator and search, with Reject /
  Restore per edit or for the selected ones. The filters stay in the address, so `/admin` links to a language
  (`?locale=deDE`) and a contributor's edit count to their edits (`?status=all&user=<id>`).
- **Contributors:** every Google sign-in account (`users`) with its voices, translator languages, uploaded takes,
  translation edits and feedback count; search, filter by role, copy addresses, CSV export. /account promises these
  people are emailed only about their feedback and contributions, so they aren't a release-news list.

- **Sign in** with the admin key: `ADMIN_KEY` in the Pages project if it's set, otherwise `FEEDBACK_KEY` (the same
  value as `FEEDBACK_KEY` in the pipeline repo's `.env`). "Remember on this device" keeps it in that browser; otherwise
  it's forgotten when the tab closes. Sign out clears it.
- **What keeps it private:** `functions/api/admin.js` refuses every request without the key, and is off when no key
  is set. `GET /api/stats` and `GET /api/click` use the same check (`lib/auth.js`). The page itself holds no data, so it doesn't matter that anyone can load the empty shell, or that
  `lore-forever.pages.dev/admin` serves it too. Responses are `no-store` and the page is `noindex`.
- **Optional extra lock:** Cloudflare Access (Zero Trust > Access > Applications > Self-hosted, domain
  `loreforeverwow.com`, paths `admin*` and `api/admin*`, allow only your email) adds a login in front of the
  custom domain. The key check stays either way, since Access doesn't cover `*.pages.dev`.
- Feedback reports get a `status` column (`new` / `done`) the first time the dashboard loads.

## Cloudflare setup (Mike does this, about 10 minutes)

1. **Put the repo on GitHub or GitLab** (it can stay private). Cloudflare Pages deploys from there.
2. **Create the Pages project:** Cloudflare dashboard > Workers & Pages > Create > Pages > Connect to Git, pick
   the repo, then set:
   - Root directory: `site`
   - Build command: none
   - Build output directory: `public`
3. **Click counter database:** Workers & Pages > D1 > Create database, name it `loreforever`. Then in the
   Pages project: Settings > Bindings > Add > D1 database, variable name `DB`, pick `loreforever`. Redeploy.
   The table creates itself on the first click.
4. **Visits:** in the Pages project, Metrics > Web Analytics > Enable. It shows up after the next deploy.
5. **Domain:** in the Pages project, Custom domains > Set up a domain, enter your chosen subdomain of
   `mliu.io` (the site uses `loreforever` there). Cloudflare shows a CNAME record. Add it in Namecheap under
   Domain List > mliu.io > Advanced DNS (Host: the subdomain, Value: `<project>.pages.dev`). For a domain of
   its own, follow [DOMAIN.md](DOMAIN.md) instead.

## Discord redirect

`functions/discord.js` serves https://loreforeverwow.com/discord (listed in `public/_routes.json`; old addresses
301 to it through the middleware). It redirects to the Discord invite for the link's source and counts the click
in the same D1 database (table `discord_clicks`, created on the first click). Point every Discord link here, not
at a raw invite, so an invite can be swapped, or the site can move domains, by editing one file
(`lib/discord.js`).

| Link | Source | Invite (never expires) | Lands in |
| --- | --- | --- | --- |
| `/discord` or `/discord?src=site` | Sidebar, author card, sign-up box | discord.gg/PJm2w3kvEe | #welcome |
| `/discord?src=request` | "Request on Discord" button | discord.gg/NqkXPP96JD | #requests |
| `/discord?src=feedback` | After sending feedback | discord.gg/TMsxNwXTA5 | #help-and-bugs |
| `/discord?src=video` | Video descriptions | discord.gg/epUXUBmdtd | #lore-questions |
| `/discord?src=bio` | Social bios, link-in-bio | discord.gg/dqch9tfKGv | #announcements |
| `/discord?src=addon` | The add-on's `/lore help` | discord.gg/PJm2w3kvEe | #welcome |
| `/discord?src=voices` | Voices page, narrator guide, release, submission form, `VOICE_PACKS.md` | discord.gg/PJm2w3kvEe | #welcome |
| `/discord?src=translate` | Translate page, its forms, the translator kit README | discord.gg/PJm2w3kvEe | #welcome |

Each placement has its own invite so Discord's Server Settings > Invites shows joins per source; the click
counts here show interest before the join. A missing or unknown `src` uses the site invite. Link-preview bots
are redirected but not counted. discord.gg/fQWrAscHbu is the old invite, still valid for links already posted
(`release/public/VOICE_PACKS.md` used it until the narrator guide moved to `/voices/guide`).

- **Counts:** `GET /api/discord` (total, per source, and per day) and the `discordClicks` total in `/api/stats`,
  both with the admin key:
  `curl -s -H "Authorization: Bearer $FEEDBACK_KEY" https://loreforeverwow.com/api/discord`.
  Like `/api/click`, it's a rough signal, and anyone who knows the address could bump it.
- **Adding a source:** create a never-expiring invite in Discord (it reuses a link when settings match, so pick
  a different landing channel or reuse an existing code), add it to `INVITES` in `lib/discord.js`, and add a
  row above. Per-creator invites for outreach go in the same map.

## Preview locally

The page itself works from any static server, e.g. `python3 -m http.server -d site/public 8000`. The click
counter only runs on Cloudflare, or locally with `npx wrangler pages dev site/public` (needs Node.js).
