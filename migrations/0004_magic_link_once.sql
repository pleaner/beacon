-- Expiry of the one magic link an operator may use right now. Signing in clears it, so a
-- link works once; asking for a new link replaces it, so only the latest one works.
ALTER TABLE users ADD COLUMN magic_link_expires INTEGER;
