# Dashboard report schema readiness

This is a deployment checklist, not evidence that a particular production table
is missing. The implementation has not inspected or changed production D1.

Run the statements in `migrations/dashboard-admin-preflight.sql` individually
against the product database. They select zero rows and make no changes. They
check the current columns of the 65 existing tables used by the reports,
including conditional Search Console cache and download fallback paths. Some
columns belong to the shared table's current schema rather than every query.
Record each missing table/column; initialize only that schema explicitly, then
rerun the affected statement and live report. Do not call legacy GETs as a way
to initialize schema: some send digests or backfill financial records.

The **only new table** is `dashboard_admin_actions`, created by the separate
`migrations/dashboard-admin.sql`. The preflight does not create this table.

## Existing setup owners

All paths below are under `site/`. These are the source definitions to consult
when preparing explicit DDL for missing schema. Setup functions can contain
data backfills as well as DDL: do not blindly run the whole function in a
deployment script or copy its data-changing statements into a migration.

| Report area | Existing tables | Schema source |
| --- | --- | --- |
| Main public feedback/forms | `subscribers`, `feedback`, `clicks`, `downloads`, `download_sources`, `site_counts`, `translation_submissions`, `translation_reports`, `voice_submissions` | `lib/subscribers.js`; `functions/api/feedback.js`, `click.js`, `translations.js`, `translations/report.js`; `functions/download/[file].js`; `lib/usage.js`, `lib/submissions.js`, `lib/reports.js`; feedback upgrades also in `functions/api/admin.js` |
| Main accounts/activity | `users`, `voices`, `translator_languages`, `translation_edits`, `studio_takes`, `excluded_accounts`, `profiles`, `usage_days`, `signin_days`, `devices`, `download_accounts` | `lib/accounts.js`; profile additions in `lib/profiles.js` |
| Main usage/check-ins | `companion_days`, `install_usage`, `usage_rollup` | `lib/checkins.js`, `lib/featureuse.js` |
| Main billing/trial and plans usage | `story_spend`, `answer_spend`, `answer_days`, `best_first`, `best_first_days`, `limit_hits`, `voice_days`, `entitlements`, `answer_user_spend`, `answer_packs`, `plan_log`, `promo_claims`, `billing_salt` | `lib/accounts.js`, `lib/billing.js`, `lib/plan-usage.js` |
| Main shared text | `contrib_lines`, `contrib_batches` | `lib/contribute.js` (owner actions also require `contrib_uploads`) |
| Store trends/CurseForge | `store_counts`, `store_files`, `cf_author_stats` | `lib/stores.js` |
| Costs | `cost_snapshots` | `migrations/cost-snapshots.sql`, `lib/costs.js` (do not replace an existing snapshot with sample data) |
| Creators | `referrals`, `creator_earnings`, `creators`, `share_codes`, `referral_rewards`, `creator_applications`, `creator_payouts`, `referral_settings`, `users` | `lib/referrals.js`, `lib/accounts.js`; referrals setup has separate data backfills |
| Retention | `plan_log`, `excluded_accounts`, `plan_cancellations`, `plan_payments_read`, `plan_payments`, `users`, `winback_notes`, `email_optouts` | `lib/billing.js`, `lib/cancellations.js`, `lib/winback.js`, `lib/email.js` (owner sends also use `email_sends`) |
| Sources | `source_events`, `source_links`; `cached_results` with Search Console enabled | `lib/sources.js`, `lib/accounts.js` |
| Voice work | `voice_status`, `voice_status_history` | `lib/voice-status.js` |
| Willo overview/queue/quality/answers | `friend_reports`, `profiles`, `answer_feedback`, `answer_log`, `forever_facts`, `usage_rollup` | `lib/accounts.js`, `lib/profiles.js`, `lib/answer-feedback.js`, `lib/answer-log.js`, `lib/forever-knowledge.js`, `lib/featureuse.js` |
| North star | `answer_days`, `excluded_accounts`, `answer_log`, `answer_log_salt` | `lib/accounts.js`, `lib/answer-log.js`; counted in `lib/north-star.js` |
| Translation summary/review | `translation_edits`, `users` | `lib/accounts.js` |
| Clip review | `clip_reports` | `lib/accounts.js` |
| Downloads | `downloads` when GitHub is unavailable | `functions/download/[file].js` |

## Columns especially likely to need an old-table upgrade

These additions used to be applied by shared setup paths. The preflight contains
their exact names along with each table's current baseline columns.

- `feedback`: `status`, `user_id`, `resolution`, `reason`, `resolved`, `fixed_in`.
- `translation_reports`: `user_id`, `resolution`, `reason`, `resolved`, `fixed_in`.
- `voice_submissions`: `user_id`, `voice_id`, `reason`.
- `translation_edits`: `reason`, `outcome`, `pulled_at`, `shipped_in`;
  `clip_reports`: `fixed_in`; `users`: `last_seen`, `welcomed_at`.
- `story_spend`: `voice_micro_usd`, `reserved_micro`.
- `profiles`: `story_at`, `story_basis`, `journey`, `card_sha`, `card_key`.
- `answer_user_spend`: `topup_micro`, `voice_micro`, `launch_micro`;
  `answer_packs`: `kind`; `best_first`: `tries`; `plan_log`: `source`;
  `entitlements`: `promo_champion_until`, `next_plan`, `next_plan_at`, `gap_from`.
- `contrib_lines`: `picked`, `pick_reason`.
- `store_counts`: `first`, `first_taken`.
- `answer_feedback`: `answer_ref`, `reasons`, `signals`, `source`, `topic`,
  `followup`, `class`, `gold_id`, `fixed_at`, `fixed_how`, `fixed_ref`, `told_at`.
- `answer_log`: `ref`, `signals`, `topic`, `ctx`, `say`, `plan`.
- Creator/referral additions include `creators.user_id/channel/connect_id/
  connect_ready/connect_country`, the attribution/counting fields on `referrals`,
  and the hold/reversal/payout fields on `creator_earnings`. Compare the full
  preflight with `lib/referrals.js`'s `MIGRATE` definitions.

## Data freshness is separate from schema

Empty snapshots remain explicit nulls. Retention payments not yet fetched remain
`paid:null` with `totals.unread`; this bridge does not fetch and persist them.
Subscription history, exclusions, snapshots and older usage rollups must continue
to be populated by their existing writers or separately authorized maintenance.
Creating an empty table does not restore missing history. After any schema repair,
compare representative live rows/counts with the legacy reports and their source
records before switching navigation.

No new maintenance environment variable is required. Keep existing bindings and
provider credentials intact. `ASSETS` is used for the shared-text known catalog;
Search Console retains its existing `GSC_SERVICE_ACCOUNT`/`GSC_SITE` setup;
downloads use existing GitHub/CurseForge credentials and public fallbacks.

## Maintenance when the old pages stop being opened

This is the repository call graph, not a claim about externally configured
routines. The migration adds no timers, maintenance actions, or Slack sends.

| Upkeep | Existing caller outside the migrated report reads | Migration consequence / explicit owner follow-up |
| --- | --- | --- |
| `activity.syncExclusions` imports `ANALYTICS_EXCLUDE` and the signed-in admin | **None found**; its only caller is legacy `functions/api/admin.js` GET | Existing exclusions remain. New config entries and newly identified admins will not synchronize just by opening the new dashboard. Its visible `exclude-account` / `count-account` owner controls still work. Reconcile configuration changes through a separately authorized owner operation; viewing is not that operation. |
| `billing.checkPlanLog` fills missing subscription history and unresolved coupon/comp status | **No independent sweep found**; callers are `billingReport` (legacy main GET) and `retentionReport` (legacy retention GET). `storeSubscription` still logs subscription changes from billing/webhook flows. | Ordinary subscription writes continue, but old missing records or `comp IS NULL` may remain unresolved without an explicit backfill. Check the existing `subscriptions.unchecked` indicator; arrange a separately authorized `checkPlanLog` batch if needed. Do not treat unchecked plans as verified revenue. |
| `cancellations.paidSoFar` fills historical invoice totals | `noteCancellation` calls it for a subscription when a new cancellation webhook arrives; `notePlanPayment` records future `invoice.paid` events | The backlog of older, still-active subscriptions was swept only by legacy retention GET (20 per load). It can remain unread after migration. `paid:null` / `totals.unread` remain visible. An explicit owner backfill is needed for that backlog; avoid replaying cancellation webhooks because those can post Slack messages. |
| `featureuse.rollupUsage` refreshes usage trends | `companion/checkin` calls `dailyUpkeep` once per UTC day with usage, retaining raw data and rebuilding the last eight prior days | This continues without admin visits. New report reads calculate yesterday/today directly, so current trends stay fresh without persisting. Older trends still depend on successful usage-bearing check-ins. No new routine is needed for the existing flow. |
| `plan-usage.planUsageReport` deletes `limit_hits` / `voice_days` older than 90 days | **No independent expiry caller found**; `recordLimit` and `recordVoice` only write current counters | New report date filters keep counts correct, but physical old rows can accumulate. Preserve the 90-day retention cleanup through a separately authorized owner maintenance operation; it is not performed by this migration. |
| `answer-log` expiry | `logAnswer` deletes expired rows; every `companion/checkin` also calls `sweepAnswerLog` | Continues without admin visits. New reports filter expiry even before a writer runs. |
| `answer-feedback` expiry | `logFeedback` purges with each feedback/signal write; the player's own `playerFeedback` view also purges | Continues on those existing paths. New dashboard views filter expired rows instead of deleting them. |
| Store/download snapshots | The public `functions/api/downloads.js` handler still calls `snapshotStores` for normal public callers | Homepage/public requests continue snapshot upkeep. The private downloads adapter deliberately does not. If the public route stops receiving traffic, snapshot freshness can lag; provider totals in the private adapter still read live. |
| Quiet feedback digest flush | `functions/api/feedback/forward.js` still calls `flushDigest`; feedback forwarding also processes accumulated bursts | Opening the private main report no longer flushes a quiet trailing burst. Existing forwarding behavior remains; no replacement Slack trigger is introduced. |

Do not use a legacy report load as a general maintenance command: it may also
write unrelated records or flush notifications. Keep any follow-up owner
workflow scoped to the particular backfill or cleanup and review its effects
before running it. Schema readiness alone does not prove these backlogs are empty.
