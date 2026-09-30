-- The native apps sign in with a bearer token of their own, so an operator signing in on the phone
-- keeps their desk browser signed in. Explorers created by the app use token_hash like the web.
ALTER TABLE users ADD COLUMN app_token_hash TEXT;
CREATE UNIQUE INDEX users_app_token ON users(app_token_hash);

-- When an operator last asked the explorer's phone to sound its siren. The app plays it once per new value.
ALTER TABLE trips ADD COLUMN siren_at INTEGER;
