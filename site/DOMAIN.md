# Moving the site to loreforeverwow.com

The site moves from `loreforever.mliu.io` to `loreforeverwow.com` (registered at Namecheap). Every old link keeps
working through a permanent (301) redirect.

What's in the repo:

- `functions/_middleware.js` redirects `loreforever.mliu.io`, `lore-forever.pages.dev` and `www.loreforeverwow.com`
  to `https://loreforeverwow.com`, keeping the path and query. It does nothing until the Pages project has a
  `CANONICAL_HOST` variable, so deploying it early is safe. Preview deployments are never redirected.
- Only pages are redirected (`/`, `/feedback`, `/download/*`). `/api/*` answers on every address, because scripts
  and routines call it with an `Authorization` header, which HTTP clients drop on a redirect to another host.
- `public/_routes.json` runs Functions only on `/`, `/feedback`, `/api/*` and `/download/*`. Images, audio,
  `install.ps1` and `/admin` stay plain files on every address: `irm https://loreforever.mliu.io/install.ps1 | iex`
  keeps working, and visits don't use up the free Functions quota.
- `scripts/set-site-host.sh <host>` swaps the address in `site/` and `release/` (already run for loreforeverwow.com).

What else depends on the address:

- **D1 data** (clicks, downloads, sign-ups, feedback) is bound to the Pages project, so every domain shares it.
- **Turnstile** (feedback spam check): off while `TURNSTILE_SITE_KEY` in `public/feedback.html` is empty. If it's
  on, add `loreforeverwow.com` to the widget's hostnames, or every report on the new domain is turned away.
- **Cloudflare Access** on `/admin` (optional): if you set it up, add `loreforeverwow.com` to the Access application.
- **Admin sign-in** is saved per address, so sign in again on `https://loreforeverwow.com/admin`.
- Not tied to the address: the Discord feedback webhook, the sign-up and click beacons (same-site, no CORS), the
  download redirects to GitHub, and the CurseForge and GitHub counts.

**Order matters:** nothing public may point at `loreforeverwow.com` until step 5 passes. Until then the domain shows
Namecheap's parking page, so any link to it would be broken.

## 1. Move the domain's DNS to Cloudflare

Pages can only serve a bare domain (no `www`) when the domain's DNS is on Cloudflare. The domain stays registered
at Namecheap.

1. Cloudflare dashboard > **Add a domain** > `loreforeverwow.com` > Free plan.
2. On the DNS review screen, **delete the Namecheap parking records**: the `A` record for `loreforeverwow.com`
   (`192.64.119.227`) and the `www` CNAME to `parkingpage.namecheap.com`. Otherwise they clash with step 2.
3. Cloudflare shows two nameservers. In Namecheap: Domain List > `loreforeverwow.com` > Manage > Nameservers >
   **Custom DNS**, enter both, and save.
4. Wait until Cloudflare says the domain is **Active** (usually under an hour; it emails you).

## 2. Attach the domain to the Pages project

1. Workers & Pages > `lore-forever` > **Custom domains** > **Set up a custom domain**.
2. Enter `loreforeverwow.com`, Continue, **Activate domain**. Cloudflare adds the DNS record itself.
3. Wait until the status shows **Active** (SSL is issued; usually a few minutes, sometimes up to an hour).
4. Repeat for `www.loreforeverwow.com`.
5. **Keep `loreforever.mliu.io` in the list, and keep its CNAME in Namecheap (mliu.io > Advanced DNS).** The redirect
   only works while the old address still reaches the project, so never remove either.

The new domain serves whatever is on `site-live`. Check that `https://loreforeverwow.com` shows the page and
`https://loreforeverwow.com/api/stats` shows the same totals as the old address.

## 3. Turn on the redirect

Pages project > **Settings** > **Variables and Secrets** > **Add**, environment **Production**: name
`CANONICAL_HOST`, type Text, value `loreforeverwow.com`. Save. Nothing changes yet, because variables only apply
to deployments made after they're saved.

## 4. Merge and publish

1. Merge the PR to `main`. That only makes a preview deploy. On the preview, check `/`, `/feedback`, a Download
   button and `/admin`.
2. Publish: `git fetch origin && git push origin origin/main:site-live`.

## 5. Check it

```bash
curl -sI https://loreforever.mliu.io/ | grep -iE '^(HTTP|location)'
curl -sI "https://loreforever.mliu.io/feedback?code=x" | grep -iE '^(HTTP|location)'
curl -sI https://loreforever.mliu.io/download/zip | grep -iE '^(HTTP|location)'
curl -sI https://lore-forever.pages.dev/ | grep -iE '^(HTTP|location)'
curl -sI https://www.loreforeverwow.com/ | grep -iE '^(HTTP|location)'
curl -sI https://loreforeverwow.com/ | grep -iE '^HTTP'
curl -sI https://loreforeverwow.com/download/zip | grep -iE '^(HTTP|location)'
curl -s  https://loreforever.mliu.io/api/stats
curl -sI https://loreforever.mliu.io/install.ps1 | grep -iE '^(HTTP|content-type)'
```

Expected:
- The first five return `301` with `location: https://loreforeverwow.com/...`, with the path and query kept.
- The new domain returns `200`, and its download returns `302` to GitHub.
- `/api/stats` on the old address still answers with JSON.
- `install.ps1` returns `200` with `text/plain`.

Then run `irm https://loreforeverwow.com/install.ps1 | iex` once in PowerShell, and send a test report from
`https://loreforeverwow.com/feedback`.

To undo the redirect: delete `CANONICAL_HOST` and retry the latest production deployment (Deployments > ... >
Retry deployment), or use Rollback on an earlier one.

## 6. Update links outside the repo (only after step 5)

- Public repo: `scripts/publish-public.sh`, then commit and push there (README website, `irm` and feedback links).
- The Windows installer's website link changes with the next release build.
- Scheduled routines in `~/.claude/scheduled-tasks`: `daily-site-feedback-fixes` (feedback and `/api/admin` URLs)
  and `daily-viral-reply-drafts` (the site link it may share). The old address keeps working for both, so this can
  wait.
- GitHub repo About > Website (`mliudev/LoreForever`).
- CurseForge project description (the site and feedback links at the bottom, per CurseForge rules).
- YouTube and Twitch descriptions and panels, the Discord server, social bios.
- Web Analytics: the Pages project's Metrics tab covers every custom domain. A day later, check that the new domain
  shows visits.
- Optional: in Google Search Console, add the new domain and use Settings > Change of address from the old one.

## 7. Email on the domain (optional)

Cloudflare dashboard > `loreforeverwow.com` > **Email** > **Email Routing** > Get started. Add
`hello@loreforeverwow.com`, forward it to your inbox, verify the inbox, and let Cloudflare add the MX and TXT
records. This only receives mail. To send as `hello@`, add it as a "Send mail as" address in your mail client
through an SMTP service.
