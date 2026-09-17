CREATE TABLE users (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('explorer','operator','admin')),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  organisation TEXT,
  emergency_name TEXT,
  emergency_phone TEXT,
  description TEXT,
  photo_key TEXT,
  consent_contact INTEGER NOT NULL DEFAULT 0,
  token_hash TEXT UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE INDEX users_email ON users(email);

CREATE TABLE trips (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity TEXT NOT NULL,
  area TEXT NOT NULL,
  route_text TEXT,
  companions_text TEXT,
  wearing_text TEXT,
  photo_key TEXT,
  shoe_photo_key TEXT,
  start_lat REAL,
  start_lng REAL,
  start_accuracy REAL,
  start_at INTEGER NOT NULL,
  return_by INTEGER NOT NULL,
  checklist_json TEXT NOT NULL DEFAULT '[]',
  battery_at_start INTEGER,
  status TEXT NOT NULL CHECK (status IN ('active','overdue','help','closed')),
  prompted_at INTEGER,
  operators_alerted_at INTEGER,
  closed_at INTEGER,
  closed_reason TEXT CHECK (closed_reason IN ('safe','cancelled','operator_closed')),
  created_at INTEGER NOT NULL
);
CREATE INDEX trips_status ON trips(status);
CREATE INDEX trips_user ON trips(user_id, created_at);
-- one open trip per explorer, enforced by the database
CREATE UNIQUE INDEX trips_one_open ON trips(user_id) WHERE status != 'closed';

CREATE TABLE positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  accuracy REAL,
  battery INTEGER,
  at INTEGER NOT NULL
);
CREATE INDEX positions_trip ON positions(trip_id, at);

CREATE TABLE checklists (
  activity TEXT PRIMARY KEY,
  items_text TEXT NOT NULL
);

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX push_user ON push_subscriptions(user_id);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES ('grace_minutes', '30');

INSERT INTO checklists (activity, items_text) VALUES
('hike', 'Phone battery above 50%
At least 2 litres of water
Warm layer and rain shell
Headtorch
Told someone your plan
Map or offline route on phone'),
('run', 'Phone battery above 50%
Water or hydration pack
Wind layer
Headtorch if finishing after 4pm
Told someone your plan'),
('climb', 'Phone battery above 50%
Rack and rope checked
Helmet
Headtorch
Water and food
Partner has this trip too'),
('paraglide', 'Phone battery above 50%
Reserve repacked within 6 months
Radio charged and on the club frequency
Wind and forecast checked
Told someone your plan'),
('mtb', 'Phone battery above 50%
Helmet
Tube, pump, multitool
Water
Lights if finishing after 4pm
Told someone your plan'),
('other', 'Phone battery above 50%
Water
Warm layer
Headtorch
Told someone your plan');
