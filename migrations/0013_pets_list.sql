-- Each explorer's pets, managed under "My pets" and offered when planning a trip. Trips add to it; past trips
-- keep their own copy in companions, so removing a pet here changes nothing that already happened.
CREATE TABLE pets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  used_at INTEGER NOT NULL,
  UNIQUE (user_id, name_key)
);
INSERT OR IGNORE INTO pets (user_id, name, name_key, used_at)
  SELECT t.user_id, c.name, lower(trim(c.name)), MAX(t.created_at)
  FROM companions c JOIN trips t ON t.id = c.trip_id
  WHERE c.kind = 'pet' AND trim(c.name) != ''
  GROUP BY t.user_id, lower(trim(c.name));
