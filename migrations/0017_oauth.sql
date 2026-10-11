-- Sign-in is Google or Apple only. Each account remembers the provider's stable user id, so a changed email
-- address still finds the same person. Magic links are gone; users.magic_link_expires is no longer read.
ALTER TABLE users ADD COLUMN google_sub TEXT;
ALTER TABLE users ADD COLUMN apple_sub TEXT;
CREATE UNIQUE INDEX users_google_sub ON users(google_sub);
CREATE UNIQUE INDEX users_apple_sub ON users(apple_sub);
