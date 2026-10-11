# Guardian by SARZA

Formerly SARZA Beacon. Only the user-facing name changed. The repo, worker names, databases and session cookie still say beacon.

File a trip plan before you go out. If you're not back by the time you said, the app asks if you're okay. If you don't answer, SARZA operators see it and get pushed. Slide for help at any time.

Spec: docs/superpowers/specs/2026-09-17-sarza-beacon-design.md

## Run locally

    npm install
    cp .dev.vars.example .dev.vars   # then fill in, see scripts/vapid.mjs
    npm run migrate:local
    npm run dev   # add -- --test-scheduled to hand-trigger the cron

Trigger the cron by hand in dev: `curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"`.

Everyone signs in with Google, or Apple once its keys are set. Without `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.dev.vars` there are no sign-in buttons; `.claude/skills/verify/SKILL.md` shows how to make a session by hand.

## Test

    npm test
    npm run typecheck

## Deploy

    npm run migrate:prod && npm run deploy

Run the migration before the deploy. Local dev uses `npm run migrate:local` and `npm run dev`. Secrets, set with `wrangler secret put NAME`: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and for Apple `APPLE_SERVICES_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (the .p8 file's contents). Deploy only once the Google pair is set: with neither provider set, nobody can sign in.

Google: a Web OAuth client in Google Cloud with the redirect URI `https://guardian.pleaner.com/auth/google/callback`. Apple: a Services ID with the return URL `https://guardian.pleaner.com/auth/apple/callback`, and a Sign in with Apple key. Production serves https://guardian.pleaner.com.

## First admin

There is no sign-up for admins. Insert a row by hand:

    npx wrangler d1 execute DB --remote --command "INSERT INTO users (id, role, name, phone, email, organisation, consent_contact, created_at) VALUES (lower(hex(randomblob(16))), 'admin', 'Jane Admin', '+27821234567', 'jane@sarza.org.za', 'SARZA', 1, unixepoch() * 1000)"

## Device checks

| Check | iPhone | Android |
|---|---|---|
| Install to home screen | | |
| Enable alerts | | |
| Start trip has GPS fix | | |
| Overdue notification arrives locked | | |
| Extend clears banner | | |
| Help pushes operator | | |
| Operator maps link correct | | |
| Broadcast arrives | | |
| Grace period timing | | |

Not yet run. Needs a physical iPhone and Android device; see the plan, Task 14, Step 5, for the script.

## Design refresh (September 2026)

The screens follow the Guardian by SARZA canvas: navy, red and yellow from the SARZA badge, Barlow Condensed headings over IBM Plex Sans.

- Profile is 5 steps and a new trip is 6 steps. Each flow is still one form and one POST; `public/app.js` shows one step at a time. Without JavaScript every step shows on one page.
- Trips no longer ask for an area. New trips store `area = 'other'`; the start point is named from GPS after the trip starts (`src/lib/places.ts`, OpenStreetMap Nominatim by default, set `GEOCODE_URL` to change or empty it to turn lookups off).
- Companions are their own table, one row per person with an optional phone.
- Phones are stored as E.164 (`+27821234567`). Forms send a country code and a national number.
- Operators get a slide-out menu. Admin tabs moved into it.

Migration `0002_design_refresh.sql` adds the new columns and the companions table. Run `npm run migrate:prod` before deploying.

## Known gaps

- The language choice is stored but the app is English only until translations exist.
- Nominatim's public service allows about one request a second and asks for a real contact in the user agent; move to a paid geocoder if trip volume grows.

- No background location. Positions arrive only while the app is open.
- Accounts are matched by the Google or Apple account id, then by verified email. An Apple user who hides their email gets a new account rather than their old one.
