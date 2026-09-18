-- Profile details searchers asked for, split out of the free-text description.
ALTER TABLE users ADD COLUMN birthday TEXT;          -- YYYY-MM-DD
ALTER TABLE users ADD COLUMN gender TEXT;
ALTER TABLE users ADD COLUMN height_cm INTEGER;
ALTER TABLE users ADD COLUMN weight_kg INTEGER;
ALTER TABLE users ADD COLUMN shoe_size TEXT;         -- UK sizing, free text so "8.5" works
ALTER TABLE users ADD COLUMN language TEXT;          -- preferred language code, e.g. en, af, zu
ALTER TABLE users ADD COLUMN emergency_relation TEXT;

-- Trips no longer ask for an area. The column stays NOT NULL for old rows and
-- new trips store 'other'; the place name comes from the GPS start point instead.
ALTER TABLE trips ADD COLUMN destination_text TEXT;  -- "Headed to"
ALTER TABLE trips ADD COLUMN start_place TEXT;       -- reverse-geocoded start point
ALTER TABLE trips ADD COLUMN gear_photo_key TEXT;    -- paraglider wing or bike

CREATE TABLE companions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX companions_trip ON companions(trip_id, sort);
