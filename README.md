# SARZA Beacon

File a trip plan before you go out. If you're not back by the time you said, the app asks if you're okay. If you don't answer, SARZA operators see it and get pushed. Slide for help at any time.

Spec: docs/superpowers/specs/2026-09-17-sarza-beacon-design.md

## Run locally

    npm install
    cp .dev.vars.example .dev.vars   # then fill in, see scripts/vapid.mjs
    npm run migrate:local
    npm run dev   # add -- --test-scheduled to hand-trigger the cron

Trigger the cron by hand in dev: `curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"`.

Magic links print in the dev console when RESEND_API_KEY is unset.

## Test

    npm test
    npm run typecheck

## Deploy

    npm run migrate:staging && npm run deploy:staging
    npm run migrate:prod && npm run deploy

Secrets per environment, set with `wrangler secret put NAME [--env staging]`: `SESSION_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `RESEND_API_KEY`. Production serves https://beacon.pleaner.com.

## First admin

There is no sign-up for admins. Insert a row by hand:

    npx wrangler d1 execute DB --remote --command "INSERT INTO users (id, role, name, phone, email, organisation, consent_contact, created_at) VALUES (lower(hex(randomblob(16))), 'admin', 'Jane Admin', '+27821234567', 'jane@sarza.org.za', 'SARZA', 1, unixepoch() * 1000)"

Add `--env staging` to target the staging database instead.

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

The screens follow the SARZA Beacon canvas: navy, red and yellow from the SARZA badge, Barlow Condensed headings over IBM Plex Sans.

- Profile is 4 steps and a new trip is 6 steps. Each flow is still one form and one POST; `public/app.js` shows one step at a time. Without JavaScript every step shows on one page.
- Trips no longer ask for an area. New trips store `area = 'other'`; the start point is named from GPS after the trip starts (`src/lib/places.ts`, OpenStreetMap Nominatim by default, set `GEOCODE_URL` to change or empty it to turn lookups off).
- Companions are their own table, one row per person with an optional phone.
- Phones are stored as E.164 (`+27821234567`). Forms send a country code and a national number.
- Operators get a slide-out menu. Admin tabs moved into it.

Migration `0002_design_refresh.sql` adds the new columns and the companions table. Run `npm run migrate:staging` / `npm run migrate:prod` before deploying.

## Known gaps

- The language choice is stored but the app is English only until translations exist.
- Nominatim's public service allows about one request a second and asks for a real contact in the user agent; move to a paid geocoder if trip volume grows.

- Email sends from noreply@mybestlife.live until pleaner.com is verified in Resend.
- No background location. Positions arrive only while the app is open.
- Explorer identity is a cookie. Clearing the browser means a new profile.
