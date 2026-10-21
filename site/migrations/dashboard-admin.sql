-- Apply explicitly to the existing product D1 database before enabling the bridge.
-- Requests never create this table. Keep completed/unknown keys as retry tombstones;
-- deleting them can allow an old request to execute again.
CREATE TABLE IF NOT EXISTS dashboard_admin_actions (
  request_key TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  action TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  request_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending', 'completed', 'unknown')),
  started TEXT NOT NULL,
  finished TEXT,
  response_status INTEGER,
  response_type TEXT,
  response_body TEXT
);
CREATE INDEX IF NOT EXISTS dashboard_admin_actions_started ON dashboard_admin_actions(started);
