# Website picture timeline QA — 2026-10-08

Branch: `mike/site-picture-timeline-oct8`; base: `9ca5bde67`.
Owner issue: LOR-294. Release coordination: LOR-362.
Spec: `.specs/site-picture-timeline.md`.

## Acceptance evidence

| Requirement | Evidence |
| --- | --- |
| Exact shot ownership | `pictures.test.mjs`: exact opaque character plus event timestamp only; wrong character/time/kind, hidden and duplicate matches omitted |
| Legacy compatibility | Existing picture tests; migration preserves old row with null identity and no thumbnail join; metadata-only update preserves match |
| Access and feature controls | Existing/new server tests: public/private/owner/view-as-visitor, feature-off and opt-in query |
| Desktop enlargement | Actual Chromium DOM: hover and focus preview, viewport bounds, Escape dismissal, Enter/dialog, backdrop, arrows, close/focus restoration |
| Touch and narrow layout | Actual Chromium touch context at 320 x 740: tap/dialog, close, no horizontal overflow |
| Earlier moments and filters | Actual DOM: initially folded earlier thumbnail, expanded thumbnail, Places filter hides picture row while its day remains visible |
| Broken image | Missing R2 object: hide failed thumbnail, retain shot text, restore full-width row |
| Remove and fallback | Actual DOM: owner removal clears thumbnail while retaining event; JavaScript-disabled link still opens image |

## Commands and outcomes

- `/home/manwe/.nvm/versions/node/v24.15.0/bin/node --test site/tests/pictures.test.mjs site/tests/trails.test.mjs site/tests/journeydata.test.mjs site/tests/profile-cold.test.mjs site/tests/history.test.mjs site/tests/history-migration.test.mjs site/tests/profiles.test.mjs`: **89/89 pass**.
- All site tests: **400/407 pass**. The same seven download metadata/UI failures were independently reproduced on unchanged `origin/main` in a `git archive` fixture (26/33 in the four download suites). Their old release tags and pack totals are unrelated to picture changes.
- `scripts/check.sh --fast`: **64/66 passed initially**, with four slow checks skipped as documented by `--fast`. Two audio-dependent checks failed because this new lightweight worktree contained LFS pointers. After fetching recordings without source changes, `uv run python tests/test_load_order.py` passes and `uv run python tests/test_voicepack.py` passes **24/24**. Combined gate evidence: **66/66 passed**.
- `git diff --check`: pass.
- Fresh bounded read-only review: two important issues (filter display priority; preview reopening on dialog close) corrected, re-reviewed with **no remaining important findings**. Reviewer independently ran pictures/trails **30/30 pass** and reviewed final failed-image width polish.

Browser command:

```bash
PLAYWRIGHT_MODULE=/home/manwe/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs \
CHROMIUM_PATH=/home/manwe/.cache/puppeteer/chrome-headless-shell/linux-152.0.7977.54/chrome-headless-shell-linux64/chrome-headless-shell \
/home/manwe/.nvm/versions/node/v24.15.0/bin/node site/tests/smoke-picture-timeline-browser.mjs
```

Passes with no page script errors. Synthetic data goes through real Pages handlers, D1 and R2 doubles. Screenshots inspected: desktop, hover, dialog, mobile and mobile-dialog under `/tmp/lore-site-picture-timeline-qa`; copied to `C:/Users/Mike/.codex/artifacts/site-picture-timeline-oct8` for coordinator inspection. These demonstrate fixture behavior, not live player data.

## Limits and paired integration

The website accepts Herald's optional metadata contract: `character = SHA256(canonical journal key, UTF-8)` (lowercase 64 hex), `event_t = exact matched shot time`; synced/archive `shot` moments carry the same opaque character and event time. Raw account/source filesystem paths are never accepted as identity. Until Herald supplies this metadata, old uploads stay in the gallery. Paired live sync remains the coordinator's integration check against the companion PR.

No production publish, OAuth sign-in change, add-on change, merge or announcement was performed. Screenshots use the repository's existing image in explicitly synthetic events. Full non-fast gate and signed-in production-browser checks were not run for this site-only PR.
