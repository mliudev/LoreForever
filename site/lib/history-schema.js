// Separate immutable source identity from each connection's contiguous delivery positions.
// Existing v2 rows remain intact; the identity map chooses the first copy for paging/projection.
export const HISTORY_BASE_SETUP = [
  `CREATE TABLE IF NOT EXISTS history_receipts (
    user_id TEXT NOT NULL, character TEXT NOT NULL, stream TEXT NOT NULL, through INTEGER NOT NULL DEFAULT 0,
    tz INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, character, stream))`,
  `CREATE TABLE IF NOT EXISTS history_records (
    row_id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, character TEXT NOT NULL, stream TEXT NOT NULL,
    seq INTEGER NOT NULL, source_id TEXT NOT NULL, moment TEXT NOT NULL, hash TEXT NOT NULL, device_id TEXT NOT NULL,
    tz INTEGER NOT NULL DEFAULT 0,
    UNIQUE (user_id, character, stream, seq), UNIQUE (user_id, character, stream, source_id))`,
  `CREATE INDEX IF NOT EXISTS history_page ON history_records (user_id, character, row_id DESC)`,
  `CREATE TABLE IF NOT EXISTS history_tombstones (
    user_id TEXT NOT NULL, character TEXT NOT NULL, stream TEXT NOT NULL, PRIMARY KEY (user_id, character, stream))`,
  `CREATE TRIGGER IF NOT EXISTS history_deleted BEFORE INSERT ON history_receipts BEGIN
    SELECT CASE WHEN EXISTS (SELECT 1 FROM history_tombstones WHERE user_id = NEW.user_id
      AND character = NEW.character AND stream = NEW.stream) THEN RAISE(ABORT, 'history-deleted') END;
  END`,
  `CREATE TABLE IF NOT EXISTS history_schema (version INTEGER PRIMARY KEY)`,
];

// Apply this additive migration before enabling the capability. Ordinary cold requests only execute the
// deletion-safe base above and one version query, keeping them within D1 Free's per-request query quota.
export const HISTORY_SETUP = [
  ...HISTORY_BASE_SETUP,
  `CREATE TABLE IF NOT EXISTS history_sources (
    user_id TEXT NOT NULL, character TEXT NOT NULL, source_id TEXT NOT NULL, row_id INTEGER NOT NULL UNIQUE,
    hash TEXT NOT NULL, conflicted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, character, source_id))`,
  `CREATE TABLE IF NOT EXISTS history_positions (
    user_id TEXT NOT NULL, character TEXT NOT NULL, stream TEXT NOT NULL, seq INTEGER NOT NULL,
    source_id TEXT NOT NULL, hash TEXT NOT NULL,
    PRIMARY KEY (user_id, character, stream, seq), UNIQUE (user_id, character, stream, source_id))`,
  // Additive, repeatable migration: retain every old row, including conflicting legacy copies for recovery.
  // A conflicting legacy identity is blocked on upload rather than silently picking a payload to acknowledge.
  `INSERT OR IGNORE INTO history_sources (user_id, character, source_id, row_id, hash, conflicted)
    SELECT r.user_id, r.character, r.source_id, r.row_id, r.hash, x.conflicted FROM history_records r JOIN
      (SELECT user_id, character, source_id, MIN(row_id) AS row_id, COUNT(DISTINCT hash) > 1 AS conflicted
       FROM history_records WHERE NOT EXISTS (SELECT 1 FROM history_schema WHERE version = 3)
       GROUP BY user_id, character, source_id) x ON r.row_id = x.row_id`,
  `INSERT OR IGNORE INTO history_positions (user_id, character, stream, seq, source_id, hash)
    SELECT user_id, character, stream, seq, source_id, hash FROM history_records
    WHERE NOT EXISTS (SELECT 1 FROM history_schema WHERE version = 3)`,
  `DROP TRIGGER IF EXISTS history_validate`,
  `DROP TRIGGER IF EXISTS history_advance`,
  `CREATE TRIGGER IF NOT EXISTS history_source_insert AFTER INSERT ON history_records BEGIN
    INSERT INTO history_sources (user_id, character, source_id, row_id, hash)
      VALUES (NEW.user_id, NEW.character, NEW.source_id, NEW.row_id, NEW.hash);
  END`,
  // All deletion paths already remove history_records; the new identity/position rows follow in that transaction.
  `CREATE TRIGGER IF NOT EXISTS history_source_delete AFTER DELETE ON history_records BEGIN
    DELETE FROM history_positions WHERE user_id = OLD.user_id AND character = OLD.character AND source_id = OLD.source_id;
    DELETE FROM history_sources WHERE row_id = OLD.row_id;
  END`,
  // A view is a transient upload envelope: repeated connection streams do not store another copy of the moment.
  `CREATE VIEW IF NOT EXISTS history_uploads AS SELECT user_id, character, stream, seq, source_id, moment,
    hash, device_id, tz FROM history_records WHERE 0`,
  `CREATE TRIGGER IF NOT EXISTS history_upload_insert INSTEAD OF INSERT ON history_uploads BEGIN
    SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM devices d JOIN users u ON u.id = d.user_id
      JOIN profiles p ON p.user_id = u.id WHERE d.id = NEW.device_id AND u.id = NEW.user_id
      AND json_array(json_extract(p.data, '$.name'), json_extract(p.data, '$.realm')) = NEW.character)
      THEN RAISE(ABORT, 'history-authorization') END;
    SELECT CASE WHEN EXISTS (SELECT 1 FROM history_tombstones WHERE user_id = NEW.user_id
      AND character = NEW.character AND stream = NEW.stream) THEN RAISE(ABORT, 'history-deleted') END;
    SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM history_receipts WHERE user_id = NEW.user_id
      AND character = NEW.character AND stream = NEW.stream AND NEW.seq <= through + 1)
      THEN RAISE(ABORT, 'history-gap') END;
    SELECT CASE WHEN EXISTS (SELECT 1 FROM history_positions WHERE user_id = NEW.user_id
      AND character = NEW.character AND stream = NEW.stream AND
      ((seq = NEW.seq AND (source_id != NEW.source_id OR hash != NEW.hash)) OR
       (source_id = NEW.source_id AND (seq != NEW.seq OR hash != NEW.hash))))
      OR EXISTS (SELECT 1 FROM history_sources WHERE user_id = NEW.user_id AND character = NEW.character
        AND source_id = NEW.source_id AND (hash != NEW.hash OR conflicted != 0))
      THEN RAISE(ABORT, 'history-conflict') END;
    INSERT INTO history_records (user_id, character, stream, seq, source_id, moment, hash, device_id, tz)
      SELECT NEW.user_id, NEW.character, NEW.stream, NEW.seq, NEW.source_id, NEW.moment, NEW.hash, NEW.device_id, NEW.tz
      WHERE NOT EXISTS (SELECT 1 FROM history_sources WHERE user_id = NEW.user_id AND character = NEW.character
        AND source_id = NEW.source_id);
    INSERT INTO history_positions (user_id, character, stream, seq, source_id, hash)
      SELECT NEW.user_id, NEW.character, NEW.stream, NEW.seq, NEW.source_id, NEW.hash
      WHERE NOT EXISTS (SELECT 1 FROM history_positions WHERE user_id = NEW.user_id AND character = NEW.character
        AND stream = NEW.stream AND seq = NEW.seq);
    UPDATE history_receipts SET through = NEW.seq WHERE user_id = NEW.user_id AND character = NEW.character
      AND stream = NEW.stream AND through + 1 = NEW.seq;
  END`,
  // Publish readiness only after every migration statement and guard is installed.
  `INSERT OR IGNORE INTO history_schema (version) VALUES (3)`,
];
