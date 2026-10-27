# Guides and site contributions (LOR-414, LOR-714)

## Patrick: write articles on the site

Open **https://loreforeverwow.com/guides/edit** and sign in with your existing
editor account. No repository change or deployment is needed for an article.

1. Choose **New article**, or open an existing title. Write on the left and preview
   the actual article layout on the right. Add picture, drop, and paste all work.
2. Leave **Status: Draft** while writing. Save keeps it private to signed-in editors.
   Its site link also requires an editor account; it is absent from Guides and search.
3. Choose **Published** and save when you intentionally want the article public.
   Existing editorial publishing permission is unchanged; nothing publishes a draft
   automatically. Publishing from the editor takes effect without a site release.
4. Earlier versions lists saved copies. Load one, check it, then Save to restore it.
   Delete hides an article and retains its history.

The existing `GUIDE_EDITORS` site setting is the narrow editorial allowlist. It uses
site sign-in and gives access to Guides only. It does not grant dashboard owner
access, player/billing/security admin writes, deployment rights, or keys. Patrick's
separate private dashboard membership remains **viewer**. Do not change it to owner.

Draft pages return a private, non-cached response only to editors. Raw Markdown and
the file index are bundled into the Worker from outside the public assets directory;
the old `/guides/articles/` paths are unavailable over HTTP, including encoded aliases;
editors read articles through the authenticated editor API. Uploaded pictures have
random public URLs, including before an article is published: do not upload private
material. Existing public article and picture URLs continue working.

Articles are D1 rows (`guides` and `guide_revisions`); pictures use the existing R2
`guides/img/` prefix. An editor copy overrides a Git file with the same slug, so edit
it in the editor after its first save. Deletion keeps that file hidden as well.

## Patrick: change layout through a PR

Use a fork branch and open a PR to `mliudev/lore-forever:main`. Include what changed,
which pages to inspect, and screenshots when useful. Keep article writing in the
editor. The existing Guides navigation is already live; no further navigation work
is needed for this issue.

On a contributor's PR (anyone but the owner), the **Site preview** check runs site tests and builds a Pages bundle on a disposable
GitHub-hosted runner with a read-only token, no stored checkout credentials, and no
production secrets. Download its `site-preview-pr-<number>-<head SHA>` artifact. It
contains `public/` (including the compiled Worker), `commit.txt` (the tested merge
commit), and `README.txt`. Neither this check nor the older `guides-publish.sh`
compatibility command merges or publishes anything.

The preview is for public page/layout review. It has no live article database,
accounts, payments, uploads, or private player data. It cannot fully test signed-in
flows. Mike may test those on shared develop **after reviewing the code**.

A merged PR is **merged**, not **live**. `main` goes to a shared Pages preview;
`site-live` controls the public site. Mike reviews the code and preview, then promotes
an exact reviewed commit. Ask for the live URL/status in the PR rather than assuming
a merge means the website changed.

## Contribution access (configured October 21, 2026)

Patrick's existing site editor and dashboard viewer membership are unchanged. The
personal GitHub repository cannot grant a read-only collaborator role, so his
membership remains write. Use a fork and the normal PR review process for code.
At Mike's October 21 direction, GitHub has no mandatory approval/check gate or
branch creation/update lock. Deletion and force-push protections remain. Code
review and exact-commit promotion are the team's working process, not an enforced
read-only contributor boundary.

Ordinary private-fork workflows stay disabled: a fork must not be able to request
an owner Mac or production credentials. The **Site preview** workflow instead
runs from the trusted base definition (`pull_request_target`) on a disposable
GitHub-hosted runner with read-only permissions. Only the code being tested comes
from the PR. It receives no production secrets or data. Do not enable ordinary
fork workflows or send fork write tokens/secrets.

Current manual workflows also check the original and rerun actor against the
owner. GitHub still reports Patrick's membership as write; historical workflows
can retain their old dispatch/rerun behavior. The isolated fork-preview path
provides no deployment credentials, but it does not revoke an existing GitHub
collaborator's write permissions. The separate dashboard role remains viewer.

The isolated **Direct Upload** Pages project is
`lore-forever-contributor-preview`, production branch `preview-only`. Both
environments have no custom variables, secrets, databases, storage, service bindings,
custom domains or Git integration. They use compatibility date `2026-10-01` and
`nodejs_compat`. Keep it empty of service bindings. The existing live project's
branch filters and production credentials remain unchanged. The isolated project
intentionally cannot sign in; use it for public layout and code previews.

## Mike: review and publish

Use a trusted checkout of the helper scripts, never scripts or config taken from the
unreviewed artifact. Download the artifact for the exact PR head shown in GitHub,
check its run/head and `commit.txt`, then extract to an empty directory. With your
local Cloudflare credentials in the environment (never in GitHub or the artifact):

```bash
# Read-only readiness check; refuses an unsafe/missing target project.
node scripts/deploy-site-preview.mjs --check-only --pr 123
# Deploys this bundle only to the isolated preview project, on pr-<number>.
node scripts/deploy-site-preview.mjs --pr 123 /absolute/path/to/extracted-artifact
```

The helper checks both target environments and deploys with bundling disabled from
an empty working directory. It never runs article/code tests with your credentials.
Open the returned preview URL, review the diff, and approve the exact head before
merging. Run the normal merge gate only after review; it executes repository code
on an owner machine. Unreviewed contributor code must not run on those machines.
The Mac workflow's trusted base definition admits only owner-authored, owner-triggered
PR checks; contributor checks run in the hosted preview job. Owner dispatch is for
reviewed code only. Keep the repository rules and private-fork workflow settings above.

For a site-only publication, inspect everything between the current `site-live`
and the chosen merge commit; this also publishes any earlier merged site changes.
After checking that exact commit's preview, promote that commit (not a moving main):

```bash
scripts/ship-site.sh <full-reviewed-merge-commit-SHA>
```

The script refuses a non-fast-forward (never force-push past it), waits for the matching Cloudflare
Production build and checks the public site serves it. It is live when it prints "site live: <sha>".
A full add-on release still follows the existing release workflow.

## Optional Git-authored articles

Existing Markdown sources remain supported at `site/content/guides/articles/<slug>.md`.
Use lowercase dash-separated slugs and frontmatter: `title`, `description` (under 170
characters), `date` (YYYY-MM-DD), `kind` (`lore` or `tutorial`), and `draft: true` while
writing. Optional fields: `author` and `updated`. Run `node scripts/guides-index.mjs`
and commit the updated `index.json` and `site/lib/guide-files.js` bundle. Git-authored articles follow reviewed code PRs;
they no longer merge or publish automatically. After an editor save, the D1 copy wins.

The lore rules still apply: WoW Forever after Warcraft III and before The Burning
Crusade, no later-expansion spoilers, and no AI wording in player-facing copy.
