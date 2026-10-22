# LOR-714 verification — October 20, 2026

## Initial audit (October 20, before owner setup)

- `GUIDE_EDITORS` in Production already includes Patrick's known site email and Mike's
  existing accounts. Preview has no `GUIDE_EDITORS` setting. No entries were changed.
- Existing editor provides creation, editing, live preview, pictures, revisions,
  deletion and explicit publishing without a code deployment. Guides navigation is
  already merged in #1398; this change does not rebuild it or the CMS.
- Cloudflare Production uses `site-live`; shared Preview builds only `main`,
  `develop`, `preview`. Preview has service secrets, so it is unsuitable for unreviewed
  contributor code even though its D1/R2 resources differ from Production.
- GitHub requires a PR for main but currently requires zero approvals. No site-live
  protection or separate contributor Pages project was found. No access/rules changed.
- The dashboard's viewer role remains unchanged. Direct database verification of the
  live member record was denied by the read credential; role behavior was tested locally.

## Implemented checks

- **826 site tests passed**, Node 24.15.0, using
  `node --test --test-reporter=dot site/tests/*.test.mjs` on the integrated change.
- **19 existing dashboard checks passed**: product API and dashboard server tests.
  Viewers can read allowed reports/exports; every mutation is rejected before an
  upstream call. A new Guides check verifies an editor cookie grants no legacy admin
  read/write access. Real handlers use SQLite fixtures and in-memory R2; no live writes.
- **Browser flow passed** in headless Chromium with synthetic editor/ordinary accounts:
  new draft default, rendered preview, valid PNG upload, save, reload, history and
  version restore, noneditor and anonymous denial, explicit publication, public
  article/list/image, and no page errors. This verifies the editor, not Google's live
  OAuth screen or Patrick's browser.
- The preview builder compiled the actual Worker. The resulting site was served in
  local Wrangler with no service bindings. The homepage, Guides list and existing
  public article rendered. **22 GET/HEAD probes** covered source paths, encoded
  slashes/letters, duplicate slashes and traversal through an excluded static prefix.
  No source was exposed. Some unknown aliases return Pages' default homepage (200);
  the source files are absent, so those responses contain no article/index data.
- All ten original Markdown files and their index moved byte-for-byte outside public
  assets. `guides-index.mjs --check` verifies the index and generated Worker source map.
- Independent review found the raw-source alias bypass and a multipart preview build
  issue. Both were fixed; focused follow-up found no remaining Important/Critical issues.
- Workflow YAML parsed, shell/JavaScript syntax and Git whitespace checks passed.

## Original delivery boundaries (October 20)

The code is prepared for review, not deployed. The preview deploy helper's real
`--check-only --pr 714` returned HTTP 404 for the absent isolated project and made no
deployment. The owner setup in [GUIDES.md](../GUIDES.md) is required for a hosted preview
and enforced review/promotion controls. Existing account capabilities and live content
were preserved. GA work is separate; shared documentation changes may need merging.

The broader `scripts/check.sh --fast` gate passed: 111 checks, with four standard fast-mode skips. The final site suite was also run separately after the source relocation.

## Owner setup follow-up — October 21

Mike authorized completing setup and publishing. The isolated Cloudflare project
has been created and the helper's real readiness check passes: no secrets, custom
variables, storage, service bindings, custom domains or Git integration.
Initial owner-only branch/update controls were removed by DevOps under Mike's
newer October 21 instruction to remove merge blockers. Normal PR review remains
the working process; no mandatory approval/check or branch creation/update lock
is claimed. Deletion and force-push protections remain.
Patrick retains repository membership for reading/forking and his existing editor
access. His dashboard role was not changed. Ordinary private-fork workflows remain
disabled; the hosted preview runs from the trusted base workflow with read-only
permissions. Current privileged manual jobs also check both original/rerun actor.
Historical workflow runs retain GitHub's historical permissions behavior.

The original article files remain unchanged. The refreshed base includes the already
live analytics changes; their guide test fixture now uses the private source bundle.
Final publication and live verification are recorded in the chat/PR after the merge.
