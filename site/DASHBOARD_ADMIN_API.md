# Private dashboard product bridge

`/api/dashboard-admin/[endpoint]` is a server-to-server JSON bridge. The separate
dashboard authenticates viewers and owners with Cloudflare Access; this product
site accepts only dedicated credentials. It does not replace the old APIs.

## Deploying

1. Apply **`site/migrations/dashboard-admin.sql`** explicitly to the existing
   product D1 database (`35c4f1b2-3099-4e55-b850-a8f5f15270e7`). It creates only
   `dashboard_admin_actions` and its timestamp index. Do not run it against the
   separate dashboard database. No request applies this migration.
2. Set distinct, strong Pages secrets `DASHBOARD_READ_KEY` and
   `DASHBOARD_WRITE_KEY` on `lore-forever`. Set `DASHBOARD_OWNER_EMAILS` to the
   comma-separated owner emails (default `mike.liu.dev@gmail.com`). Do not add
   viewers to this list. Preserve existing production bindings and variables.
3. Configure the dashboard gateway's server-only `PRODUCT_ADMIN_READ_KEY` and
   `PRODUCT_ADMIN_WRITE_KEY` to match. Never include these in browser bundles,
   URLs, HTML, local storage, logs or API responses.
4. Deploy product code before switching the dashboard gateway to this bridge.
   Enable writes only after the migration is confirmed. Production is `site-live`;
   this implementation does not deploy or provision secrets.

No additional new schema or maintenance credential is required. The pre-existing
product tables must already be deployed. Missing tables/columns return 503, never
a successful empty report. See `DASHBOARD_ADMIN_SCHEMA.md` and the zero-row
`migrations/dashboard-admin-preflight.sql` for existing schema readiness checks.
Read-only local/preproduction verification can run
`node --test site/tests/dashboard-admin.test.mjs` (SQLite and fake providers only).

## Protocol

- GET and HEAD use `Authorization: Bearer <DASHBOARD_READ_KEY>`.
- POST uses the write key, `Content-Type: application/json`,
  `X-Dashboard-Actor: <owner email>`, and `Idempotency-Key` matching
  `[A-Za-z0-9_.:-]{8,128}`. Bodies are bounded to 64 KiB. The owner email is checked
  against the allowlist even after successful key authentication.
- Credentials are not interchangeable. Requests carrying `Origin` are refused;
  the gateway makes a fresh server request. Cookies and old admin keys do not
  grant bridge access. No redirects or generic forwarding are supported.
- Responses preserve the legacy JSON fields and action errors, with
  `Cache-Control: private, no-store`, `Vary: Authorization`, and `X-Robots-Tag`.
  Reads add `X-Source-Fetched-At`. HEAD executes the same read but omits the body.
  Snapshot timestamps in the legacy JSON remain the source freshness indicators.
- Unknown names return 404, unsupported methods 405, wrong key 401, wrong actor
  403, invalid query/body fields 400, and oversized input 413. Missing config or
  database/schema failures return 503. Do not retry a mutation automatically.

## Reads and allowed query fields

| Endpoint | Query fields |
| --- | --- |
| `main`, `costs`, `creators`, `curseforge`, `voice-status`, `translation-summary`, `downloads` | None |
| `plans-usage` | `days=14\|30` |
| `retention` | `paid=0\|1` |
| `sources` | `from`, `to` (real YYYY-MM-DD, at most 366 days); `by=landing`; `search=0\|1` |
| `willo` | None for overview; `answers=1` with `since`, `after`, `limit<=1000`; `queue=1` with `status`, `since`, `after`, `limit<=500`; or `quality=1` with `days<=14` |
| `translation-review` | `status`, `locale`, `user`, `q` (300 chars), `offset`, `limit<=2000` |
| `clip-export` | `status`, `since` (numeric id) |

Unknown and duplicate fields are refused. The exact status and field allowlists
live in `lib/dashboard-admin-contract.js`.

Every report uses a `first-primary` D1 session and a read-only database wrapper.
Only SELECT/CTE reads are allowed, including inside batches. A swallowed query
failure still fails the entire report rather than fabricating zero metrics.
This is a private capability, not a client-supplied environment/query flag.

| Area | What the bridge does instead of legacy read-time side effects |
| --- | --- |
| Main | Skips schema upgrades, Slack digest flushing, sign-in recording and exclusion synchronization. Reads persisted exclusions. |
| Main feature trend | Combines stored older rollups with a SELECT calculation of yesterday/today. Does not persist rollups. |
| Costs, creators, CurseForge, voices, translations, clips | Skips setup/DDL and reads existing product records/snapshots. |
| Plans/usage, Willo | Skips expiry deletes; filters expired feedback and related logs out of reports. |
| Retention/billing | Skips historical subscription/payment backfills and their persistence. Unread payments remain `paid:null` with `totals.unread`; no invented paid amount. |
| Sources/Search Console | Allows Google read-only analytics/token requests on a cache miss, without persisting the resulting cache. Existing cache entries may be read. |
| Downloads | Uses provider reads and the existing site-count fallback; never writes snapshots or edge cache. If either total source fails, `total:null` (individual known counts and source labels remain). |

The product's existing writers/routines still own expiry, exclusions and billing
backfills. Moving a dashboard view does not schedule maintenance or grant it to
viewers. If a legacy read was the only trigger for a historical backfill, perform
that maintenance separately; this bridge will not run it. No report sends email,
Slack, payouts, or provider mutations. Explicit guards also prohibit email and
Stripe mutations if a shared helper is accidentally called from a report.

## Visible owner controls

POST endpoints remain the gateway's original eight names. Only these named
actions are accepted; each has an explicit field schema before handler dispatch:

- `main`: feedback/voice/translation status and deletion controls,
  `contrib-reject`, `contrib-restore`, `contrib-pick`, `exclude-account`,
  `count-account`, `delete-subscriber`.
- `creators`: `save`, `approve`, `decline`, `retire`, `restore`, `pay`,
  `stripe-payouts` (including its existing Connect probe).
- `retention`: `preview`, `write` (see below).
- `sources`: `link`, `retire`, `restore`.
- `willo`: `feedback-status`, `friend-report-done`, `fact-add`, `fact-remove`,
  `queue-fixed`.
- `translation-decide`: `ids` or `user`, optional locale/reasons, and status
  `new` or `rejected`; no `action` field.
- `clip-resolve`: ids/status; `clip-reject`: uploader/optional restore;
  neither uses an `action` field.

Bulk billing/pay-day, coupons, email tests, automated triage/rehashing,
release/import/build/snapshot uploads and other script operations are excluded.

Creator `pay` requires `expected_cents`, the exact integer USD cents the owner
reviewed from `payoutList.due[].due`, alongside `code`, `method` and optional
`note`. The server compares it with the total claimed from the ledger before
any transfer or manual-payment record is completed. A changed total releases
the earnings claim and returns 409; refresh and review again, then use a new
request key. Legacy payout callers retain their existing behavior.

### Review retention email before sending

POST `retention` with `{action:"preview", id, subject, text}` returns
`{ok:true, draft:{to,from,replyTo,subject,text}}`. The draft has the actual
recipient, substituted name, normalized subject/body and appended unsubscribe
footer. Show these exact fields to the owner before a separate Send action.
Preview requires the owner headers above but performs only primary reads: it
does not claim an idempotency key or write an audit row.

Send `{action:"write", id, subject, text, reviewed:draft}` with a new stable
idempotency key for that Send action. The server reconstructs the draft from the
current cancellation/account and compares every reviewed field exactly. A
changed recipient, name, message or footer returns 409 without sending. There
is no arbitrary-recipient input. Editing the draft means previewing it again.

## Durable action audit and retries

Before any mutation, the bridge inserts a unique request key with actor,
endpoint/action, canonical request hash, **exact original JSON** (including
untrimmed input notes and the reviewed email), UTC start time and `pending` state.
It records the response status/content type/body and completion time afterward.

- Same key and request after completion: replay the saved response with
  `Idempotency-Replayed: true`; never call the handler again.
- Same key with another actor, endpoint or body: 409 `idempotency_conflict`.
- Pending/unknown key: 409 `action_outcome_unknown`, never re-execute.
- Handler exception, ambiguous provider result, or failed completion recording:
  502 `action_outcome_unknown`; keep the claim even if marking it unknown fails.
  Ambiguous email/Stripe transfer attempts also retain their product send/payout
  claims, protecting against a new request key as well. A retained email claim
  still marked `sending` makes a fresh-key request unknown too; it is never
  reported as a successfully completed duplicate.

There is deliberately no expiry/lease takeover for request claims. Reconcile
pending/unknown rows against product records and provider receipts before any
manual recovery. Do not fix a timeout by issuing a new key or deleting an audit
row. Do not automatically purge this table: old keys are retry tombstones. It
contains private owner inputs and responses; treat it as product admin data.

Other legacy API callers do not gain these audit/approval rules implicitly and
retain their existing behavior. Keep the old admin secret owner-only.
