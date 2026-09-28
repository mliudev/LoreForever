# Lore Forever landing page

**Live:** https://loreforever.mliu.io (Cloudflare Pages project `lore-forever`, also at https://lore-forever.pages.dev). Every push to `main` on github.com/mliudev/lore-forever redeploys it.

One static page (`public/`) plus one small Cloudflare Pages Function (`functions/api/click.js`) that counts
download-button clicks. Hosted on Cloudflare Pages (free).

## Fill in before going live

**The page describes 0.2.0** (about 3,400 entries, narration, tooltips, primers). Only put it live once 0.2.0 is
the file on CurseForge and you've checked those features in game. Otherwise the page promises more than the
download does.

**Quotes must match the add-on.** The zone-card questions and the parchment sample answer are copied word for
word from `addon/LoreForever/Data`. Regenerating lore can reword them, so recheck them after each recompile
(last checked against the 3,422-entry build on 2026-09-27).

| What | Where |
| --- | --- |
| CurseForge project ID (for the public download count) | Set to `1715510` (`CURSEFORGE_PROJECT_ID` in the `<script>` at the bottom of `public/index.html`). The page shows "New release" until the count is above 0. |
| Buttondown username (the "Get new features" sign-up) | Set to `mikeliudev` (`BUTTONDOWN_USERNAME` in the same `<script>`). If it is ever emptied, the form shows "Sign-ups open soon" and can't be submitted. Sign-ups are tagged `landing-page`. In Buttondown, keep double opt-in (confirmation email) on. |
| Twitch and Discord links | `data-todo="twitch"` / `data-todo="discord"` in `public/index.html` (Discord is in two places: the sidebar and the "Levels 30 to 60" card) |

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
  See the numbers at https://loreforever.mliu.io/api/click (D1 database `loreforever`, bound as `DB`). It's a rough traffic signal, not a unique-people count,
  and anyone who knows the address could bump it.
- **Visits:** Cloudflare Web Analytics, turned on in the dashboard on 2026-09-27 (no code, no cookies, no cookie banner). See it under the Pages project > Metrics.

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
   `mliu.io` (e.g. `loreforever.mliu.io`). Cloudflare shows a CNAME record. Add it in Namecheap under
   Domain List > mliu.io > Advanced DNS (Host: the subdomain, Value: `<project>.pages.dev`).

## Preview locally

The page itself works from any static server, e.g. `python3 -m http.server -d site/public 8000`. The click
counter only runs on Cloudflare, or locally with `npx wrangler pages dev site/public` (needs Node.js).
