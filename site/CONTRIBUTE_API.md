# Shared Forever text: the contract (P-LOR-9)

What the add-on keeps, how players share it, and what the site does with it. This is what was built for LOR-228,
LOR-234, LOR-235 and LOR-236; other slices (the companion's upload, LOR-240; the pipeline's pull, LOR-237; credits
and progress, LOR-238/239) code against it. Code: `addon/LoreForever/Capture.lua`, `site/public/contribute-code.js`,
`site/public/contribute/svparse.js`, `site/lib/contribute.js`, `site/functions/api/contribute.js` and
`site/functions/api/contribute/[action].js`. Changes from the first draft of this contract are marked **(changed)**.

## 1. What the add-on keeps (SavedVariables, LoreForeverDB)

Options › **Keep the quest text you see** (`settings.capture`, on by default) turns all of it off; what's there stays.
It stays on the player's PC until they share it.

| Table | What |
| --- | --- |
| `quests[questID]` | `{id, title, text, objectives, progress, completion, zone, known, starter, ender}` (unchanged; `starter`/`ender` are `Giver.Identify`'s `{kind = "npc" \| "object", id, name, sex, ctype, model, race, gender}`) |
| `texts.gossip[npcName][hash]` | gossip text (unchanged: **keyed by the NPC's name**, not its id **(changed)**) |
| `texts.npcs[npcName]` | `{id, sex, ctype}`: who that gossip NPC is, from its GUID **(new)** |
| `texts.books[title][page]` | book, letter and plaque pages (unchanged; a second plaque with the same title is `"<title> (<zone>)"`) |
| `texts.say[npcID][hash]` | `{text, kind = "say" \| "yell", name, sex?, ctype?, t}` from CHAT_MSG_MONSTER_SAY/YELL, NPCs known by GUID only; at most 12 lines per NPC and 1,500 in all; nothing said while you're in a fight outside a dungeon (barks); nothing naming someone in your group |
| `capture` | `{v = 1, build = "1.60.1.70205", locale = "enUS", version = "0.8.0", install, missing, by, sent, copied}` |

- `capture.install`: a random 16-hex id made once per install, so one player's uploads count as one sender.
- `capture.missing`: `{["quest:<id>"] = true, ["gossip:<npc name>"], ["book:<title>"], ["say:<npcID>"]}`: what Lore
  Forever ships no text for, worked out again at every login against that release's data (a quest is missing when it
  has no lore entry, or a part's words don't match the quest dialogue the add-on has, `ns.DB.questVoice`).
- `capture.by[lineKey] = "Human.WARRIOR.2"`: race file, class file and `UnitSex` of the character who saw that line.
- `capture.sent[lineKey] = true`: shared already. Options › **Mark all as sent** sets it for every line kept, and a
  file upload leaves those lines out. The text itself stays (Lore Forever and Mike's harvest still use it).
- `capture.copied[lineKey] = true`: that line's Contribute link was copied, so its button doesn't show again.
- Line keys: `quest:<id>#<part>` (part `title`, `detail`, `objectives`, `progress`, `complete`),
  `gossip:<npc name>#<hash>`, `book:<title>#<page>`, `say:<npcID>#<hash>`. Hashes are djb2, 8 hex digits.
- **Placeholders (changed):** text is stored with the character's name replaced by `$N` (as written, in capitals, and
  glued to a suffix like a dwarf's "-ama"), and their race and class (whole words, any case, a plural `s` kept:
  "Humans" -> `$Rs`) by `$R` and `$C`, as the game's own quest templates have them. Older add-ons wrote `<name>`; the
  site and `lore.harvest` read both (the harvest turns `$N/$C/$R` into `<name>/<class>/<race>`). **Titles** (a
  book's, a letter's: keys of `texts.books`, the journey's `seen.book` and its events) keep 0.7.0's form, the name only,
  as `<name>` (`Log.ScrubName`), so keys never change across versions or characters.
- **Upgrading from 0.7.0** needs no reset. Every new table is made when missing, the new settings get their
  defaults, and once (`capture.names = 1`) the stored quest, gossip and book text moves from `<name>` to `$N`, each
  gossip text re-keyed to the hash of its new words (`Capture.MigrateNames`). Race and class in old text stay written
  out (which character saw it is unknown); a book page seen again is matched placeholder-blind (`Capture.SameText`),
  so it isn't kept twice under "Title (Zone)".
- Size cap: 3,000 quest records and 4,000 gossip, book and say lines. Past that, quests whose text the add-on now
  ships go first, then lines already sent; if it's still full, new text isn't kept.

## 2. The Contribute button and code (LOR-234)

A 16px button (a note icon) at the top right of the quest window (beside its Lore and play buttons), the gossip
window, the book window (beside Read aloud) and the quest log's details, shown only for a page whose text Lore Forever
doesn't ship and whose line wasn't sent or copied before. Options › **Contribute buttons** turns them on: **off by default** in 0.8.0 until Mike has seen them (`/lf qa` exercises one either way, `Capture.TestButton`). No nagging: it
never asks per quest. Clicking opens a share window with the link selected for Ctrl+C.

```
LFC1~<addon version>.<locale>~<kind>~<id>~<part>~<speaker>~<player>~<text>~<checksum>
```

- kind `quest | gossip | book | say`; id: quest id, the NPC's id (gossip from the button always has it; `n:<name>`
  when it doesn't), or the book's title; part: `detail | progress | complete` from the quest window (`detail` from the
  quest log; `title` and `objectives` only come with a file), the page number, or the text's hash.
- speaker `<npc id>.<UnitSex>.<creature type>.<name>` (empty parts allowed, the name last so it may hold dots), or
  `o<object id>` for an object (a wanted poster); empty for books.
- player `<race file>.<class file>.<UnitSex>`, e.g. `Human.WARRIOR.2`.
- checksum: djb2 (mod 2^32, 8 hex digits) of the UTF-8 bytes of everything before the last `~`.
- In every field but the checksum, `%`, `~`, CR and LF are written `%25`, `%7E`, `%0D`, `%0A`.
- Link: `https://loreforeverwow.com/contribute#c=<code, percent-encoded>`; the fragment never reaches the server, and
  the page strips it from the address bar after reading it.
- **(changed)** A code over 8,000 characters (no real quest page comes close) gives the page's address instead, and
  the share window says the text is kept in LoreForever.lua: `/reload` and share the file there.
- Decoder: `site/public/contribute-code.js` (`decode`, `findCode`, `encode` for tests). The add-on's encoder is
  `Capture.Code`, with `Capture.Decode` for `/lore qa`; `pipeline/tests/contribute_sim.py` round-trips the add-on's
  codes through the site's decoder and writes `site/tests/fixtures/contribute/codes.json` (`--write-fixtures`).

## 3. D1 tables (created on first use, `lib/contribute.js` SETUP)

```
contrib_lines(id INTEGER PRIMARY KEY, kind, ref_id, part, locale, build, text, text_hash, status, uploads, uploaders,
  found_by_user TEXT, found_by_nick, first_seen INTEGER, updated_at INTEGER, shipped_in,
  lkey, speaker, player, mode, corrects, flagged INTEGER,           -- (new columns)
  UNIQUE(kind, ref_id, part, locale, text_hash))
contrib_uploads(id INTEGER PRIMARY KEY, line_id, upload_id, user_id TEXT, nick, ip_hash, source, created_at INTEGER,
  uploader, player, rejected INTEGER)                               -- (new columns)
contrib_batches(upload_id TEXT PRIMARY KEY, user_id TEXT, nick, ip_hash, source, n_new, n_known, created_at INTEGER,
  uploader, n_confirmed, n_invalid, version, build, locale, rejected)   -- (new columns)
```

- Times are unix seconds. **(changed)** `found_by_user` and `user_id` are TEXT: account ids are UUIDs.
- `text` is stored normalized: Unix line breaks, trimmed, `<name>/<class>/<race>` as `$N/$C/$R`. `text_hash` is SHA-256
  of that text with every run of white space as one space, first 16 hex digits (`textHash`; pipeline
  `lore.known_text.text_hash`, pinned on both sides by `site/tests/fixtures/contribute/hashes.json`).
- For gossip and say, **(changed)** `part` is the server's own `text_hash[:8]`, not the add-on's djb2: the text is its
  own part. `ref_id` for gossip and say is the NPC's id, or `n:<npc name>` (a bare name is accepted and prefixed).
- `lkey` = `kind|ref_id|part|locale`; `speaker` JSON `{id, name, sex, type}` or `{object}`; `player` the first
  sender's `Race.CLASS.sex`; `mode` `say|yell`; `corrects` the hash of the text Lore Forever already has for that part
  when this one differs; `flagged` 1 when it looks like spam.
- `uploader`: the sender's key: `u:<account id>` signed in, else `i:<install hash>` (from the add-on's
  `capture.install`, hashed in the browser), else `h:<day's IP hash>`. Upload rows and batches older than 30 days drop
  `ip_hash`, and an `h:` uploader becomes `x:<upload id>`. Raw files are never stored.
- **Independent senders (changed)** (`uploaders`, and what `verified` counts; `independentSenders`): two uploads are
  the same sender when they share the day's IP hash, or the uploader key (the same account or install), chained. So
  independence needs a different IP hash AND a different account or install: a file and a code upload from one PC on
  one day, or one install from two places, are one sender and can't verify their own line. An upload from an IP hash
  that already sent a line counts as `known` and isn't recorded again. Honest solo finders are covered by the 48-hour
  rule.
- "Delete my account" keeps the lines (community text) and unlinks them: `found_by_user` and `user_id` become NULL and
  `u:` uploaders become `x:<upload id>` (`forgetUser`).

### Statuses (LOR-236; no review queue)

| Status | When |
| --- | --- |
| `single` | one sender so far. **Accepted** once older than 48 hours: with few contributors, single-source is how anything ships |
| `verified` | two or more independent senders (a different IP hash and a different account or install, above), or it matches the Forever client's own text in our harvest |
| `conflict` | another text for the same part from a player of the same gender (gendered `$g` lines from a man and a woman don't conflict), or it differs from the Forever client's own text; kept side by side, accepted only once verified |
| `flagged` | looks like spam (a web address, a run of 15 of one character); never accepted on one sender |
| `rejected` | every sender of it was rejected from /admin (Restore brings it back) |
| `shipped` | in a release (`POST /api/contribute/shipped`) |

**Accepted** = `verified`, or `single` older than 48 hours (a flagged line has status `flagged`, so it never is). Lists
of who found what also count `shipped` (`lib/credits.js` uses the same rule). A line identical to text the add-on
already ships isn't stored at all and counts as known. What the add-on ships and what the Forever client gave us come
from `site/public/contribute/known.json` (`uv run python -m lore.known_text`, rewritten by
`scripts/rebuild-generated.sh`): `{v, counts, lines: {"quest:176#detail": [shipped hash, Forever hash]}}`, hashes only,
English only. Shipped = `data/quest_dialogue.json`; Forever = `data/harvest` (quests, gossip by `n:<name>`, books).
A line that differs only from shipped wiki or VMaNGOS text is Forever's own wording: `single`, with `corrects` set.

## 4. HTTP API

### POST /api/contribute

Public, no sign-in (a signed-in session adds credit). Browsers must send our Origin; the companion sends
`X-LF-Client: companion/<version>` and no Origin.

```
{lines: [{kind, ref_id, part, locale?, build?, text, speaker?, player?, mode?}], source: "file" | "code" | "companion",
 nick?, install?: "<sha256 hex of capture.install>", website: "", preview?: true, locale?, build?, version?}
```

- A line's `locale` falls back to the body's, then to `enUS`; `build` likewise. `speaker` may be `{id, name, sex,
  type}`, `{object}` or the add-on's own record `{kind, id, name, sex, ctype}`; unknown fields anywhere are ignored.
  `player` is optional, as `"Race.CLASS.sex"` or `{race, class, sex}`. Quest parts: `detail`, `objectives`,
  `progress`, `complete` and **(new)** `title`. A say line's `mode` may come as `say_kind`, or the line as
  `kind: "yell"` (stored as kind `say`, mode `yell`).
- Limits: 5,000 lines and 8 MB per request, text up to 4,000 characters (titles 200), at least one letter, no control
  characters. A line that fails any check is skipped and counted in `invalid`; the request fails (400) only when no
  line could be read. A code upload carries exactly one line.
- Rate limits per sender (day's IP hash, `lib/ratelimit.js perHour`): 10 file and 10 companion uploads an hour (a
  whole file is one), 60 codes, 30 previews; past it, 429 with `retryAfter` seconds.
- `website` is the honeypot: filled in, the reply looks like success and nothing is saved.
- `preview: true` counts without saving (the page's "N new, M already known").
- Reply: `{ok, upload_id, receipt: "/contribute/r/<upload_id>", new, known, confirmed, total, invalid}`: `new` lines
  nobody had; `confirmed` lines someone else had sent, now confirmed by this sender; `known` lines the add-on ships,
  already shipped, or sent before by this sender (the same uploader key, or the same IP hash today).

### GET /contribute/r/<upload_id>

The receipt page (noindex, no names, hashes or addresses): the upload's lines and their status now (New: accepted
after 48 hours / Accepted / Confirmed / Another version exists / Held / In Lore Forever 0.8.0). JSON at
`GET /api/contribute/receipt?id=<upload_id>`.

### GET /api/contribute/stats

Public, cached 5 minutes: `{lines, verified, accepted, shipped, contributors, last_upload, by_kind: {quest, gossip,
book, say}}` (rejected lines don't count; `contributors` = distinct senders).

### GET /api/contribute/contributors

Public, cached 5 minutes: `[{name, lines_accepted, first_found}]`, alphabetical (never a rank). Accepted or shipped
lines only, credited to whoever sent them first: an account's display name when it shows its name
(`users.show_public`), nothing for an account that doesn't (even with a nickname typed), else the nickname typed with
the upload; the same name in any case counts once; anonymous uploads aren't listed. `/contributors`'s Text finders
(`lib/credits.js`, LOR-239) are this same list (`contributors()`), plus each shown account's links, so the two always
agree. `GET /api/credits?release=0.8.0` gives the lines that shipped in one release and the finders to thank, by the
same rule, for the release announcement draft (`scripts/post-release.sh`).

### GET /api/contribute/export?since=<unix>&status=accepted

Admin key (`/api/admin`'s, `ADMIN_KEY` or else `FEEDBACK_KEY`: `Authorization: Bearer <key>` or `X-Admin-Key: <key>`;
sending both is fine, Bearer is checked when present). `status`: `accepted` (default), `all`, or one status. `since`:
only lines whose status changed, or that became accepted by age, after then. Reply: `{ok, now, lines: [...]}`; pass
`now` as the next `since`. Shipped lines aren't in `accepted`. Each line (what `lore.contrib`, LOR-237, reads):

| Field | What |
| --- | --- |
| `id, kind, ref_id, part, locale, build, text` | the line (`text` with `$N/$C/$R`) |
| `status, accepted` | its status, and whether it counts as accepted now |
| `uploads, uploaders, first_seen, updated_at, shipped_in, corrects, flagged` | bookkeeping (unix seconds) |
| `found_by` | a plain string, the name the finder shows (display name or nickname, as on /contributors), or null |
| `title` | quest lines only: the quest's title when someone sent one (a confirmed one first), else null |
| `player` | `"Race.CLASS.sex"` of the first sender (e.g. `"Dwarf.WARRIOR.3"`; sex is UnitSex: 2 male, 3 female), or null |
| `speaker` | `{id, name, sex, type}` (any may be missing) or `{object}`, or null |
| `mode`, `say_kind` | say lines: `"say"` or `"yell"` (`say_kind` is always set for say lines; null for others) |

### POST /api/contribute/shipped

Admin key: `{ids: [...], release: "0.8.0"}` -> those lines become `shipped` with `shipped_in` (a rejected line
stays rejected). Reply `{ok, shipped: <count>}`.

### /admin

"Shared text" panel: counts by status and accepted, the latest 100 uploads (who: account, nickname or anonymous
sender; source; new, confirmed, known; add-on version), each with **Reject all from this sender** (every line that
sender sent stops counting: a line nobody else sent becomes `rejected`, one someone else also sent stays) and
**Restore**. `POST /api/admin {action: "contrib-reject" | "contrib-restore", uploader}`.

## 5. The /contribute page

`public/contribute.html` + `public/contribute/page.js`, served by `functions/contribute/index.js`. A dropped
LoreForever.lua is read in the browser (`svparse.js`: a strict reader for what the game writes, never eval; refuses
function calls, operators, long strings, block comments, table keys; size, depth, value and string limits) and only
its lines are sent, 5,000 per request. The account's character names (`journey.chars`) are replaced with `$N` there
too. A `#c=` link shows the line field by field before Send. **Unreleased:** noindex (meta tag and `X-Robots-Tag`)
and out of the Community menu until the `contribute` feature is on (`lib/features.js`, `featureOn(env, "contribute")`;
the Pages variable `SITE_FEATURES=contribute` turns it on without a code change). The page opens by its address
regardless, so the add-on's links and previews work. `GET /api/auth/me` returns `features: {contribute}` for
`header.js`'s menu link.
