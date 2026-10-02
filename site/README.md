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

## Fill in before going live

**The page describes 0.2.0** (about 3,400 entries, narration, tooltips, primers). Only put it live once 0.2.0 is
the file on CurseForge and you've checked those features in game. Otherwise the page promises more than the
download does.

**Quotes must match the add-on.** The zone-card questions and the parchment sample answer are copied word for
word from `addon/LoreForever/Data`. Regenerating lore can reword them, so recheck them after each recompile
(last checked against the 3,422-entry build on 2026-09-27).

| What | Where |
| --- | --- |
| Download links and count | The main button, **Get it on CurseForge**, goes to https://www.curseforge.com/wow/addons/lore-forever. Under it, **Windows installer** and **zip** fetch the latest GitHub release (`mliudev/LoreForever`) through `/download/*`. No email step (removed in LOR-77). The count adds GitHub release downloads (public API) and CurseForge project `1715510` (`CURSEFORGE_PROJECT_ID` in the `<script>` at the bottom of `public/index.html`). The page shows "New release" until the count is above 0. |
| Author card and socials | The "Made by Mike" card in the header. Its bio is a placeholder for Mike to rewrite. Discord and Twitch (twitch.tv/jiuthaimike) are live there, in the sidebar and on the "Vote on Discord" button. Every Discord link goes through `/discord?src=...` (see "Discord redirect" below), never a raw invite. The LoreForeverWoW accounts (LOR-74) are listed in a comment in the card: move each one out of the comment once its account exists. |

## Screenshots and narration samples

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

- **Public download count:** CurseForge's own total, shown with a free shields.io badge. It counts every
  CurseForge download, including app installs that never touch this page. It needs the project ID above.
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
- **Emails:** the optional sign-up box at the bottom of the page saves straight into the same D1 database, table
  `subscribers` (email, source, created_at), through `functions/api/subscribe.js`. Its source is `landing-page`;
  rows with `download-popup` came from the email pop-up before downloads, removed in LOR-77.
  No confirmation email. To see them: Cloudflare dashboard > Storage & databases > D1 > `loreforever` > Console,
  then run `SELECT email, source, created_at FROM subscribers ORDER BY created_at DESC;`
  There's no public way to list them. When you email this list, include an unsubscribe link.
- **Visits:** Cloudflare Web Analytics, turned on in the dashboard on 2026-09-27 (no code, no cookies, no cookie banner). See it under the Pages project > Metrics.

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

## Voice list and likes

`/voices` puts the **list of voices** first: one compact row per voice (▶ sample, name and credit, tagline, 👍,
Download), with language filters (once there's more than one language) and Featured / Most liked sorting.
**Make a voice** is a small side card (below the list on phones). The rows come from
**`public/voices/voices.json`**: `functions/voices/index.js` reads it (through `env.ASSETS`) and renders `voiceRow()`
(`lib/voices.js`) per entry into the `<!-- voice-list -->` mark in `public/voices.html`, and the buttons into
`<!-- voice-filters -->`, with each voice's like count, so the list works without JavaScript (`public/voices/player.js`
adds play-in-place, filtering and sorting; Featured is voices.json order). The house narrators are ordinary entries, listed like any community
voice.

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
- **Locally**, a plain static server shows an empty list; use `npx wrangler pages dev site/public` to run the
  Functions.

## Voice profiles and contributor accounts

- **Profiles:** `/voices/<id>` (`functions/voices/[id].js`) is built from the same `voices.json` entry for every voice,
  house narrators included: name, bio, avatar, all samples, like button, download. Any other `/voices/<name>`
  falls through to the static page. `/voices/contributors` (`functions/voices/contributors.js`) groups the voices
  by who made them. Page templates are in `lib/voices.js`.
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

**Submissions** post to `functions/api/voices.js`, which saves each one in the `loreforever` D1 database, table
`voice_submissions` (created on the first submission): credit line, email and/or Discord handle, pack name, a
Google Drive / Dropbox / OneDrive folder link (other links are turned away; there are no file uploads), which
clips, a note, the release version agreed to, the 18+-or-guardian box, the typed signature, country and time.
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
  and the upload page asks everyone to agree again before their next upload. Each submission stores the version
  agreed to; git history keeps every version's text.

## Upload page (/voices/studio)

Contributors upload their recordings line by line and send the voice for review (LOR-95). Recording happens in their
own setup; the page only takes files. `public/voices/studio.html` + `studio.js` + `studio.css`, API in
`functions/api/studio/[action].js`, helpers in `lib/studio.js`.

- **Flow:** sign in (the Lore Forever account) → agree to the narrator release once (D1 `studio_release`) → name a
  voice and pick its language (a row in `voices` with a `locale`, status `draft`; at most 2 per account) → upload →
  **Send for review** (a `voice_submissions` row with the link `studio:<voice id>`, status `pending`, webhook as for
  the form). They can keep uploading and send again.
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
  refuses anything that isn't MP3 or OGG by its first bytes, over 25 MB, or for a line without text in the voice's
  language.
- **WAV and FLAC become MP3 in the browser** (LOR-119), so R2 only holds files the game plays: mono, 192 kbps,
  keeping 44.1 or 48 kHz (anything else becomes 44.1 kHz), in `public/voices/mp3.js` (`toMp3(buffer, rate)`, a
  module other pages can import). The encoder is lamejs 1.2.1, vendored unmodified at
  `public/voices/vendor/lame.min.js` (LGPL, loaded only when a WAV or FLAC is dropped). WebCodecs can't encode
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
  `addon/LoreForever_Lang_<locale>/`. Language packs stay out of `PACKS` in `scripts/build-release.sh` (so out of the
  players' download) until Mike decides a language ships.
- **Automated check:** `check`, `build` and `pull` send every string that would change, with its English, through an
  automated language check (`pipeline/lore/kit_review.py`, its key from `.env`), which flags wrong meanings, the wrong
  language, spam and gibberish. Flagged strings are left out and listed with the reason (`--keep-flagged` takes them
  anyway, `--no-review` skips the check). It costs well under a cent per hundred strings; on 80 existing German
  drafts it flagged none. Nobody on our side needs to read the language.
- **Public copy** never says how a language's first text was produced: it's a "draft" until native speakers review it.

### Translator accounts and the translation dashboard (LOR-96)

Translators sign in with the same Lore Forever account as narrators (Google, `lib/accounts.js`) and translate in the
browser; the kit and `/translate/submit` stay for people who'd rather work offline (submitting needs an account too).

| Page or file | What it is |
| --- | --- |
| `/translate/dashboard` | The editor (`public/translate/dashboard.html`, noindex). **Needs work** (the default) gathers, across every section and most-read first: **Not translated**, **Drafts to check** (text nobody has written or checked: entries without `reviewed`, UI strings not in `ui_checked.json`), **Reported by players** (open bad-translation reports, shown above the entry) and **English changed**; the counts come from `translate/data/<locale>/status.json`. **Looks right** on a line (or the whole entry) sends the current text back unchanged, which `lore.kit pull` counts as a person checking it (the entry gets `reviewed`, the UI string goes into `data/i18n/<locale>/ui_checked.json`). **Browse by section** shows everything with filters (to do, has text, my edits, all) and search. English on the left, your text on the right, saved about a second after you stop typing. Signed out, it links to `/account?next=/translate/dashboard`. Links: `?lang=deDE&cat=draft`, or `?lang=deDE&section=zones_01&q=npc:hogger` for Browse. |
| `/translate/data/` | The editor's text, written by `lore.kit site`: `en/index.json` (sections), `en/<section>.json` (entry names and `[id, English]` pairs, at most ~700 KB) and `en/entries.json` (every entry and its section, in Needs-work order), `<locale>/<section>.json` (`{id: text}` for the strings that have text) and `<locale>/status.json` (what still needs a person). Excluded from Functions. |
| `/translate/fp.json` | For test packs (LOR-119), written by `lore.kit site`: `{english, interface, version, languages: {locale: {name, ttsVoices}}, entries: {key: [fp, section]}}`, where fp is the English entry's `Lang.Fingerprint` and section the `en/<section>.json` holding its current English. Excluded from Functions. |
| `GET /api/translations/pack?locale=` | **Download my test pack** on the dashboard (and `/translate#in-game`): a zip of `LoreForever_LangTest_<locale>/` (same folder every time) with the signed-in translator's edits that are `new`/`accepted` (not withdrawn, rejected or pulled), latest per string. An edit whose saved English differs from today's (`en/<section>.json`) is stale and left out; headers `X-Strings-Included` / `X-Strings-Stale` give the counts. Built by `lib/langtest.js` (TOC + `UI.lua` + `Strings_N.lua`, kind `lang-overlay`); the add-on lays it over the language pack, string by string, while each entry's fp matches (`addon/LoreForever/Lang.lua`). Tests: `node --test site/tests/langtest.test.mjs`, `pipeline/tests/test_langtest.py`, `pipeline/tests/lang_sim.py`. |
| `/translate/check.js` | The checks every edit must pass (`%` codes in order, no new `\|` codes, length, control characters), used by the editor as you type and by the API on save. Same rules as `problem()` in `pipeline/lore/kit.py`: change both together. |
| `/account` | Gains "Your translations": the languages you translate (ticked boxes, saved at once) and what happened to your edits. |

**API:** `functions/api/translations/[action].js` (`like.js` and `report.js` beside it keep their own paths).
Signed in: `GET me`, `GET edits?locale=`, `GET reports?locale=`, `POST languages`, `POST save` (an empty text
withdraws your waiting edit; 5,000 edits per person per day), `POST import` (an edited kit dropped on **Upload your
edited kit**: up to 200 strings a call, each checked and saved like `save`, status `new`, same daily cap, 20 calls a
minute). The dashboard reads the kit in the browser (`public/js/bulk-core.js` `readKit`/`planKit`, JSON files only,
`reference/` skipped, a returned LangTest pack recognized and not read) and applies `kit.py apply_strings`' rule
before anything is sent: empty strings, strings equal to the current text or your waiting edit, and strings whose
English changed since the kit (or that the add-on no longer has) are left out and listed; `lore.kit pull` checks the
English again. Admin key: `GET review?status=&locale=`, `POST decide`,
`GET export?locale=`, `POST pulled`. **Tables** (in `SETUP` of `lib/accounts.js`, deleted with the account):
`translator_languages` and `translation_edits` (status `new` when saved, `rejected` from `/admin`, `pulled` once imported).
`translation_submissions` gets a `user_id` column.

**Shipping edits.** There is no approval step: Mike doesn't speak these languages, and native-speaker review comes
from Discord (and bad-translation reports), not from a gate. The automatic checks, the account requirement and the daily
cap guard the form; `/admin` → Translation edits lists recent edits so spam or vandalism can be **Rejected** (and
**Restored**).

1. `cd pipeline && ADMIN_KEY=... uv run python -m lore.kit pull deDE --dry-run` shows what the saved edits change;
   without `--dry-run` it imports them into `data/i18n/deDE/` (same checks as a kit: a string whose English changed
   since the edit is skipped and stays English, and the automated check above leaves out what it flags). Flagged edits
   are rejected on the site (the translator sees "wasn't used"; `/admin` can Restore one), the rest are marked
   pulled. `--build` compiles the pack too; `--site` pulls from a preview instead.
2. `uv run python -m lore.kit site` (it uploads the kits) and commit, so the dashboard and `/translate` show the new
   text.

Each language card on `/translate` credits the translators whose edits are in the language and who ticked "show my name" on their
account, most edits first. Language packs still stay out of `PACKS` until Mike decides a language ships.

## Private dashboard

https://loreforeverwow.com/admin shows sign-up emails, feedback reports, voice submissions and site downloads in one
place: totals, sign-ups and downloads per day for the last 30 days, the feedback list (mark reports done, delete
spam), voice submissions (folder link, clips, contact, signature and release version; mark done, delete), and the
email list (search, copy, CSV export, remove an address when someone asks to unsubscribe).

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
