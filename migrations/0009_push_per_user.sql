-- One browser has one push endpoint, and a phone can be signed in as explorer and operator.
-- Key subscriptions on (user, endpoint) so each account keeps its own row. SQLite can't drop
-- an inline UNIQUE, so rebuild the table; the new unique index also covers lookups by user.
CREATE TABLE push_subscriptions_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, endpoint)
);
INSERT INTO push_subscriptions_new (id, user_id, endpoint, p256dh, auth, created_at)
  SELECT id, user_id, endpoint, p256dh, auth, created_at FROM push_subscriptions;
DROP TABLE push_subscriptions;
ALTER TABLE push_subscriptions_new RENAME TO push_subscriptions;
