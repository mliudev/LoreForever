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
| Download link and count | The Download button fetches the latest GitHub release zip (`mliudev/LoreForever`). The count adds GitHub release downloads (public API) and CurseForge project `1715510` (`CURSEFORGE_PROJECT_ID` in the `<script>` at the bottom of `public/index.html`). The page shows "New release" until the count is above 0. |
| Twitch and Discord links | Set: twitch.tv/jiuthaimike and discord.gg/fQWrAscHbu (sidebar and the "Vote on Discord" button) |

The download button goes to https://www.curseforge.com/wow/addons/lore-forever, which won't work until the
CurseForge project is created.

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

**Narration samples** (`public/audio/`) are copies of three clips from `addon/LoreForever/Audio`
(`zone_stormwind`, `zone_zephras`, `zone_durotar`). The "Read along" text is exactly what each clip reads
(`lore.narrate.script`). If the clips are regenerated, copy them over again and update the text.

## Counters and visits

- **Public download count:** CurseForge's own total, shown with a free shields.io badge. It counts every
  CurseForge download, including app installs that never touch this page. It needs the project ID above.
- **Clicks from this page:** each click on Download adds one to a per-day tally in a free D1 database.
  See the numbers at https://loreforeverwow.com/api/click (D1 database `loreforever`, bound as `DB`). It's a rough traffic signal, not a unique-people count,
  and anyone who knows the address could bump it.
- **Site downloads:** the Download buttons go to `/download/installer` and `/download/zip`
  (`functions/download/[file].js`), which count each download per day in the D1 table `downloads`, then
  redirect to the latest GitHub release. Link-preview bots aren't counted. This is the number for "is the
  site the download source?". `https://loreforeverwow.com/api/stats` shows site downloads, sign-ups and
  clicks (counts only, no addresses).
- **Emails:** both sign-up forms (the Download pop-up and the "Get new features" box) save straight into the
  same D1 database, table `subscribers` (email, source, created_at), through `functions/api/subscribe.js`.
  No confirmation email. To see them: Cloudflare dashboard > Storage & databases > D1 > `loreforever` > Console,
  then run `SELECT email, source, created_at FROM subscribers ORDER BY created_at DESC;`
  There's no public way to list them. When you email this list, include an unsubscribe link.
- **Visits:** Cloudflare Web Analytics, turned on in the dashboard on 2026-09-27 (no code, no cookies, no cookie banner). See it under the Pages project > Metrics.

## Feedback form

`public/feedback.html` (served at https://loreforeverwow.com/feedback) posts to `functions/api/feedback.js`,
which saves each report in the same `loreforever` D1 database (table `feedback`, created on the first report).
Linked from the landing page's sidebar, footer and Known limits tab, the public README and the CurseForge listing.

- **Fields:** kind (lore / bug / idea / review), optional 1-5 stars, message, optional entry code, email, name, and
  "OK to quote me". Only quote players on the site if they ticked that box.
- **Prefill links:** `/feedback?code=LF-westfall_moonbrook-3&kind=lore` fills in the code and kind. The in-game
  "report this answer" box (step 3 of the plan) should point here.
- **Spam:** a hidden honeypot field, and at most 10 reports per sender per day (keyed on a daily hash of the IP; the
  IP itself isn't stored). Cloudflare Turnstile is optional, see below.
- **Works without JavaScript:** a plain form post is sent back to `/feedback?sent=1` or `?error=...`.

**Set up in the Pages project** (Settings > Variables and Secrets, as encrypted secrets, then redeploy):

| Name | What it does |
| --- | --- |
| `FEEDBACK_KEY` | Any long random string. Needed to read reports; without it, reading is off. |
| `FEEDBACK_WEBHOOK` | Optional. A Discord webhook URL (Channel settings > Integrations > Webhooks, in a private channel). Each report is posted there as it comes in, without the email address. |
| `TURNSTILE_SECRET` | Optional, only if spam shows up. Create a Turnstile widget (Cloudflare dashboard > Turnstile, domain `loreforeverwow.com`), put its secret here and its site key in `TURNSTILE_SITE_KEY` at the top of the `<script>` in `public/feedback.html`. Set both or neither: a secret without the site key turns every report away. |

**Reading reports:**

```bash
curl -s -H "Authorization: Bearer $FEEDBACK_KEY" https://loreforeverwow.com/api/feedback
curl -s -H "Authorization: Bearer $FEEDBACK_KEY" "https://loreforeverwow.com/api/feedback?since=42"   # only newer than id 42
```

Or in the Cloudflare dashboard: D1 > `loreforever` > Console, `SELECT * FROM feedback ORDER BY id DESC`.

## Private dashboard

https://loreforeverwow.com/admin shows sign-up emails, feedback reports and site downloads in one place:
totals, sign-ups and downloads per day for the last 30 days, the feedback list (mark reports done, delete spam),
and the email list (search, copy, CSV export, remove an address when someone asks to unsubscribe).

- **Sign in** with the admin key: `ADMIN_KEY` in the Pages project if it's set, otherwise `FEEDBACK_KEY` (the same
  value as `FEEDBACK_KEY` in the pipeline repo's `.env`). "Remember on this device" keeps it in that browser; otherwise
  it's forgotten when the tab closes. Sign out clears it.
- **What keeps it private:** `functions/api/admin.js` refuses every request without the key, and is off when no key
  is set. The page itself holds no data, so it doesn't matter that anyone can load the empty shell, or that
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

## Preview locally

The page itself works from any static server, e.g. `python3 -m http.server -d site/public 8000`. The click
counter only runs on Cloudflare, or locally with `npx wrangler pages dev site/public` (needs Node.js).
