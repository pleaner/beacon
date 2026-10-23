-- On call: a roster that takes turns in fixed shifts, and a record of each overdue or help call.
CREATE TABLE oncall (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  sort INTEGER NOT NULL,
  available INTEGER NOT NULL DEFAULT 1
);

-- One call per overdue alert or help request. next_at is when it passes on if nobody answers; NULL once it has
-- stopped escalating (accepted, sent to everyone, closed, or waiting for the cron to raise it again).
CREATE TABLE calls (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('overdue','help')),
  started_at INTEGER NOT NULL,
  next_at INTEGER,
  everyone_at INTEGER,
  accepted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  accepted_at INTEGER,
  closed_at INTEGER
);
CREATE UNIQUE INDEX calls_open ON calls(trip_id, kind) WHERE closed_at IS NULL;

-- Everyone a call has reached. They keep it as it escalates, unless they rejected it.
CREATE TABLE call_targets (
  call_id TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alerted_at INTEGER NOT NULL,
  rejected_at INTEGER,
  PRIMARY KEY (call_id, user_id)
);

-- The call record. Chat messages are read from messages, not copied here.
CREATE TABLE call_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  detail TEXT
);
CREATE INDEX call_events_call ON call_events(call_id, id);

-- oncall_now is who was last told their shift began. syncShift updates it conditionally, so the row must exist.
INSERT OR IGNORE INTO settings (key, value) VALUES ('shift_hours', '8'), ('no_response_minutes', '2'), ('oncall_now', '');
