# Saved public journey history (LOR-323)

The feature is off by default. Apply `site/migrations/history-v3.sql` through the site's normal D1 migration
process before setting `HISTORY_ARCHIVE_ENABLED=true` (or `1`). The flag and completed schema version together
enable capability negotiation, upload, owner/public pagination and profile links. A flag set before migration
leaves the feature hidden. It does not change the add-on or companion gates. No deployment or environment change
is part of this implementation. Synthetic fixtures explicitly call `setupHistory(env)` to prepare the same schema.
Ordinary cold requests create only deletion-safe tables and check the schema version once per DB; they never
run the full backfill. History upload also skips unrelated profile-column migration attempts to fit D1 Free quotas.

`GET /api/device/status` includes `historyVersion: 2` only when enabled. Existing device bearer authentication
applies to `POST /api/profile/history`:

```json
{"v":2,"name":"Aelric","realm":"Forever","history":{"v":2,"stream":"public-stream","first":1,"tz":0,"records":[{"seq":1,"id":"source:1","moment":{"t":1759400000,"k":"qt","id":123,"n":"A quest","z":"Westfall"}}]}}
```

The whole UTF-8 request is limited to 64 KiB and 250 records. A batch must contain consecutive positive safe
integer sequences. Names and moments use the existing v1 public sanitizer; killer names are removed. Chat,
questions, raw game text, party, coordinates and screenshots are never stored. Unknown envelope versions or
invalid public moments fail without a receipt. Only the owner's currently displayed character is accepted.

A successful response is `{ok:true, stream, through}`. Source identity is immutable across connections within
one owner and character. Relinking may restart a public outbox stream: identical original source IDs advance
its own contiguous receipt without copying the logical moments. Each stream separately records its sequence
positions; known source IDs never fill a gap. Equal replay is a no-op. Gaps, conflicting sequence/source
IDs (including changed payloads in another stream) and deleted streams return 409. Invalid schema returns 400; body size 413; revoked device 401; the per-owner
120/minute limit returns 429 with `Retry-After`. D1 batch commits records, receipt and the bounded 2,000-moment
profile projection together. One ordered `json_each` insert into a transient upload view keeps query/parameter counts bounded; triggers
recheck the live device, owner and displayed character inside the transaction. A late conflict rolls back the
whole batch. Existing snapshot and paste APIs keep their behavior and do not delete these archive tables.

The bounded profile projection preserves each record's original UTC timestamp and captured offset. Timeline
and map days use that per-record offset, with the envelope offset as a fallback for older snapshots. Later DST
or connection-offset changes therefore do not move earlier moments to another day. The envelope offset keeps
its existing picture-date behavior. Profile-column preparation checks existing columns once per DB and alters
only missing columns, so ordinary history-OFF cold sync still fits the D1 Free query quota.

Schema migration is additive and repeatable. Existing v2 record rows and receipts remain intact. A source
identity map points paging, projection and export to the earliest logical copy, while the stream-position
ledger preserves every old delivery position. Preexisting source IDs with different hashes are flagged;
uploads using them return a conflict without advancing a receipt. All original conflicting rows remain
available for recovery. Profile/account deletion also removes source identities and positions transactionally.

`GET /api/profile/history?limit=250&before=<cursor>` uses the owner's ordinary sign-in cookie and returns:

```json
{"ok":true,"v":2,"name":"Aelric","realm":"Forever","records":[{"stream":"public-stream","seq":1,"id":"source:1","moment":{"t":1759400000,"k":"qt","id":123},"tz":0}],"next":null}
```

Records are newest committed first. Limit is 1–250. The opaque cursor is scoped to the character and row boundary;
every query additionally scopes to the owner. New arrivals do not shift subsequent pages. With `handle=<handle>`,
visitors can read only a public displayed profile. They receive sanctioned moments with `day` replacing the exact
timestamp, without source IDs/stream/sequence. Privacy is checked again on each request; all responses use no-store.

Owner `?export=1` downloads one versioned JSON page including `next`. The profile's **Download saved history**
link uses `public/js/history-export.js` to follow bounded authenticated pages and download one complete versioned
JSON file. This works beyond D1's per-invocation query quota; it never runs hundreds of queries in one Worker.
Auth, character or cursor failures stop the full download rather than producing a misleading partial file.
Without JavaScript the link explicitly says **Download history page**. No credentials are included.

`/u/<handle>?history=1&before=<cursor>` renders older pages using existing timeline styles and controls, with links
to older/newest moments and the ordinary profile. It checks existing public/private rules before reading history.
Picture dates, profile summaries and story budgets retain their existing behavior.

Profile deletion transactionally tombstones known streams, removes archive/receipt rows and revokes all devices.
The transaction checks prevent an already authenticated stale request from committing after deletion/revocation
or character switch. Relinking must use a fresh public outbox stream; known deleted streams remain rejected.
Account deletion removes history, receipts and tombstones with the account. Character switches preserve private
archive namespaces; switching back exposes the owner's preserved sanctioned history again.

Validation: `node --test site/tests/*.test.mjs`. The history tests use real node:sqlite with transactional serialized
D1 batch semantics, including a 10,250-row archive/export and a browser exporter fixture of 100,001 records over
401 independent pages. `node site/tests/smoke-history-browser.mjs` serves a synthetic local public fixture on port
8765 for browser/mobile QA; it never contacts production or uses real account data.
