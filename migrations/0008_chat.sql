-- Chat between an explorer and the operators, one thread per trip. Deleting an operator keeps
-- their messages; the thread then names them "SARZA".
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  author_role TEXT NOT NULL CHECK (author_role IN ('explorer','operator')),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX messages_trip ON messages(trip_id, id);
