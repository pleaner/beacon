-- An optional spoken note with the trip plan, stored in R2 next to the photos.
ALTER TABLE trips ADD COLUMN voice_note_key TEXT;
