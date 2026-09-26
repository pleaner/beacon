-- Fixes taken out of signal arrive late and in batches. Altitude comes from the phone's GPS,
-- received_at records when a fix reached the server, and the unique index lets a batch that
-- gets sent twice land once.
ALTER TABLE positions ADD COLUMN altitude REAL;
ALTER TABLE positions ADD COLUMN altitude_accuracy REAL;
ALTER TABLE positions ADD COLUMN received_at INTEGER;
DELETE FROM positions WHERE id NOT IN (SELECT MIN(id) FROM positions GROUP BY trip_id, at);
DROP INDEX positions_trip;
CREATE UNIQUE INDEX positions_trip ON positions(trip_id, at);
