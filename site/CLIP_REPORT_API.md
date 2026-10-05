# Clip reports API (LOR-232)

Players report a recording that's wrong: a name said wrong, the wrong voice, cut off. Any page can send one; the add-on
does it through a link to `/clip-report`. No sign-in, no review: the pipeline (`uv run python -m lore.clipreports pull`)
queues a clip for re-recording once it has reports from **2+ people, or 1 from a signed-in player**, and a name's sound
goes into the pronunciation lexicon once 2+ people (or 1 signed in) give it. `/admin` only rejects spam.

Code: `functions/api/clip-report.js` (send), `functions/api/clip-report/[action].js` (the rest), `lib/clipreports.js`
(logic), `public/clip-report-code.js` (the add-on's code and the shared field rules, browser and server),
`public/clip-report.html` (the page). Tests: `site/tests/clip-report.test.mjs`.

## A report

| Field | What | Rules |
| --- | --- | --- |
| `clip` | Clip id, optionally with the hash of the text its recording read (the first 6 hex of the SHA-1 of the whitespace-collapsed text, `lore.clips.clip_hash`): `zone:stormwind#faq3@1a2b3c` | `type:slug`, optional `#faqN` or `#detail`/`#progress`/`#complete`; hash 6 hex |
| `hash` | The hash, if not in `clip` | optional |
| `voice` | The voice: the site's voices.json id (`male-narrator`, `female-narrator`) or a voice pack's folder name (`LoreForever_Voice_Default_Alliance`, or without `LoreForever_Voice_`) | stored as its narrator's pack (below) |
| `reason` | `name` (a name is said wrong), `voice` (wrong voice or gender), `cut` (cut off, garbled or words missing), `quality` (noise, echo, too quiet), `stage` (reads out a stage direction), `text` (words don't match the text), `other` | required |
| `name` | The name that's said wrong | `reason: "name"` only; ≤ 60 characters |
| `say_as` | How it should sound (`tel-DRASS-il`) | `reason: "name"` only; ≤ 80 characters |
| `note` | Anything else | ≤ 300 characters |
| `locale` | The text's language, when it isn't English (`deDE`) | optional |
| `source` | `site` (default), `addon` or `companion` | optional |
| `website` | Honeypot: leave it empty | a filled one is "saved" and dropped |

Longer text is cut to the cap, not refused. Report text is private: only its count is public.

**Voices group by narrator.** The add-on names the pack whose file played (a lands or quest dialogue pack included);
the site names the voices.json voice. Both are saved as the narrator's own pack, so one recording reported from
both places counts once per person and adds up:

| Sent | Saved as |
| --- | --- |
| `male-narrator`, `Default`, `Default_Alliance`, `Default_Horde`, `Default_Quests` | `LoreForever_Voice_Default` |
| `female-narrator`, `Female`, `Female_Alliance`, `Female_Horde`, `Female_Quests` | `LoreForever_Voice_Female` |
| `Female_Quests_deDE` (a narrator reading a language pack) | `LoreForever_Voice_Female_deDE` |
| `QuestGivers`, a community voice (`Ashen`) | as sent, with the `LoreForever_Voice_` prefix |

The clip id and hash are the same everywhere: the id the add-on and `data/clips*.json` use, and `@` plus the hash
of the text the recording read. The add-on's link (below) keeps the exact pack in its code; the API folds it on save.

## Endpoints

### `POST /api/clip-report`
Public. JSON (a plain form post works too):

```json
{"clip": "npc:edwin-vancleef@abcdef", "voice": "male-narrator", "reason": "cut", "note": "stops mid-sentence"}
```

or the add-on's code, with the page's edits to the free text winning over the code's:

```json
{"code": "LCR1~0.8.0.enUS~Default~zone:stormwind#faq3@1a2b3c~name~Teldrassil~tel-DRASS-il~~e659ea", "say_as": "tel-DRASS-il"}
```

Answer: `{"ok": true, "id": 12, "open": 2, "signedIn": false}` (`open`: that clip's open reports in that voice), or
`{"ok": false, "error": "..."}` with 400 (bad field; the error is for the player), 429 (more than 30 new reports from
one sender today) or 503 (no database).

- **One open report per person, clip and voice:** sending again updates it (reason, text, hash). After the clip is
  recorded again, a new report is a new one. A person is the signed-in account, else the day's hash of the IP.
- **Signed in counts for more**, but only from our own pages (the `Origin` must be the site's); a cross-site post
  is anonymous.

### `GET /api/clip-report/counts`
Public, cached 5 minutes. Open reports per clip, never their text.

- `?clips=a,b,c` (or `?clip=`; up to 90 ids, an `@hash` on one is ignored) to ask about some clips only, and
  `?voice=male-narrator` (any name the table above takes) for one voice. Without `clips`, every clip with an open
  report.
- `{"ok": true, "counts": {"zone:stormwind#faq3": 3}}` (clips with none are left out); with `?by=voice`:
  `{"counts": {"zone:stormwind#faq3": {"LoreForever_Voice_Default": 2, "LoreForever_Voice_Female": 1}}}`.

### Admin (`Authorization: Bearer <ADMIN_KEY or FEEDBACK_KEY>`, the key `/api/admin` takes)
- `GET /api/clip-report/export?status=open|done|kept|rejected|all&since=<id>`: every field, newest first, up to
  5,000: `{ok, reports: [{id, created, updated, clip, hash, voice, reason, name, say_as, note, version, locale,
  source, uploader, signed_in, country, status, resolved}]}`. `uploader` is `u:<user id>` or `ip:<day's hash>`.
- `POST /api/clip-report/resolve` `{ids: [...], status: "done" | "kept" | "open"}`: done = recorded again (or the
  text changed), kept = nothing to change (a name Mike picked by ear). Rejected reports stay rejected.
- `POST /api/clip-report/reject` `{uploader, restore?: true}`: rejects every open report from one uploader (spam), or
  restores them. `/admin` → Clip reports has the button.

## Statuses
`open` → `done` (the pipeline recorded it again, or the clip's text changed so the reported recording is stale),
`kept` (nothing to change), or `rejected` (spam, from /admin). Table `clip_reports` is created in `lib/accounts.js`
`SETUP`; "Delete my account" removes a user's reports.

## The add-on's link
`https://loreforeverwow.com/clip-report#c=<code, URL-encoded>`. The report is in the fragment, so it never reaches a
server log; the page reads it, takes it out of the address bar, shows it and sends it with one click. The code,
written by `Log.ClipReportCode` (`addon/LoreForever/Log.lua`), fields split by `~`:

```
LCR1 ~ add-on version.locale ~ voice pack (without LoreForever_Voice_) ~ clip id@hash ~ reason ~ name ~ say_as ~ note ~ checksum
```

`name`, `say_as` and `note` are percent-encoded (`%`, `~` and control characters). The checksum is 6 hex digits:
djb2 (`h = h * 33 + byte`, from 5381, kept to 32 bits) of the UTF-8 bytes of everything before the last `~`, modulo
2^24, so a copy that lost its end is caught. `decodeClipReport(text)` finds the code in the link, the bare code or a
message around either, and `encodeClipReport(fields)` builds one. `site/tests/fixtures/clip-report-codes.json` pins
both sides: `pipeline/tests/wow_sim.py` checks the add-on writes exactly those codes and links.

## A report button on another page
Post the plain fields; the narration's `clip` with its hash and the `voice` that played it are enough:

```js
await fetch("/api/clip-report", { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ clip: id + "@" + hash, voice: "male-narrator", reason, note, source: "site" }) });
```

Show the count with `GET /api/clip-report/counts?clips=<ids>`. `REASONS` in `public/clip-report-code.js` has the
labels the add-on uses; `describeClip(id)` turns an id into words.

## Pipeline
`pipeline/lore/clipreports.py`: `pull` writes `data/narration-rerender.json` (clip, voice, locale, reasons, names,
report ids; `fixes` for reports a new take can't fix; `other` for voices we don't render) and merges name sounds into
`data/pronunciation.json` (or `data/i18n/<locale>/pronunciation.json`), marking every recording that says the name;
`list --voice male` prints the ids to render; `done --voice male <ids>` takes them out and resolves their reports.
`experiments/voices/local/render_pack.py --rerender data/narration-rerender.json` renders them again.
