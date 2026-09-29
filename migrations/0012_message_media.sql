-- A chat message can carry one photo or voice note, stored in the photos bucket. body is '' when there's no text.
ALTER TABLE messages ADD COLUMN media_key TEXT;
ALTER TABLE messages ADD COLUMN media_type TEXT;
