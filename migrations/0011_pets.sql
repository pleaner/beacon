-- Pets ride along as companions: kind = 'pet', a name-and-breed line, never a phone.
ALTER TABLE companions ADD COLUMN kind TEXT NOT NULL DEFAULT 'person';
