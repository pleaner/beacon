# SARZA Beacon, pilot design

Date: 2026-09-17
Status: draft for review

## What it is

A phone app for hikers, trail runners, climbers, paragliders, and mountain bikers in South Africa. Before you go out, you file a trip plan the way a pilot files a flight plan. If you are not back by the time you said, the app asks if you are okay. If you do not answer, SARZA (Search and Rescue South Africa) operators see it on a board and get a push notification. At any point during a trip you can slide a button to call for help.

The pilot is a PWA on Cloudflare. A native app comes later and will call the same JSON endpoints.

## Not in the pilot

Deferred, in rough order of how soon they will be asked for:

- Repeat last trip.
- Automatic message to the emergency contact when a trip goes red.
- WhatsApp alerts to operators.
- Weather forecast and any "should you be going" verdict. The admin broadcast push covers day-of warnings by hand.
- Google and Apple sign-in, and any identity that follows a person across phones.
- Background location. A PWA cannot do it.
- Map widget on the trip detail. Links to Google Maps instead.
- Route library or named routes.
- Operator notes on a trip, operator assignment, audit log.
- Trip history for explorers beyond the last trip.
- Organisations as a table.
- Offline queue beyond retrying recent positions.
- Donations, raffles, promotions, sponsor placements. The pilot only stores name, phone, email, and a consent tick.
- In-app messaging.
- Browser-driven end-to-end tests.

## Roles

Three roles on one `users` table.

- **explorer.** The person going out. No login. A cookie set when they save their profile is their identity.
- **operator.** A SARZA volunteer. Logs in with an email magic link. Sees the board.
- **admin.** An operator who also sees the admin screen.

Organisation is a required text field for operators and admins.

## Identity

**Explorers.** Saving the profile creates a `users` row and sets a long-lived, HttpOnly cookie holding a random 256-bit token. The server stores a SHA-256 hash of the token on the row. Lose the cookie and you fill in the profile again. Phone number is still required, so the contact list is complete either way.

**Operators and admins.** An admin adds them by name, email, and organisation. They enter their email on the login screen and receive a link containing an HMAC-signed token with a 15 minute expiry. Opening it sets the same kind of cookie. No token table.

Later sign-in providers attach a session to an existing user id, so nothing here has to change shape.

## Data

Six tables in D1. Photos in R2, referenced by key.

### users

| column | notes |
|---|---|
| id | uuid |
| role | explorer, operator, admin |
| name | required |
| phone | required |
| email | required for operator and admin |
| organisation | required for operator and admin |
| emergency_name | |
| emergency_phone | |
| description | free text. Height, build, hair, anything a searcher wants |
| photo_key | R2 key, profile photo |
| consent_contact | boolean. SARZA may contact me |
| token_hash | SHA-256 of the cookie token |
| created_at | |

### trips

| column | notes |
|---|---|
| id | uuid |
| user_id | |
| activity | hike, run, climb, paraglide, mtb, other |
| area | table_mountain, cape_peninsula, cederberg, overberg, drakensberg, other |
| route_text | free text |
| companions_text | free text |
| wearing_text | free text |
| photo_key | optional, photo of you today |
| shoe_photo_key | optional, sole of your shoe. Reusable from earlier trips |
| start_lat, start_lng, start_accuracy | GPS fix at start, nullable |
| start_at | |
| return_by | required |
| checklist_json | which items were ticked |
| battery_at_start | nullable, only Android reports it |
| status | active, overdue, help, closed |
| prompted_at | when the "are you okay?" push went out |
| operators_alerted_at | when the operator push went out |
| closed_at | |
| closed_reason | safe, cancelled, operator_closed |
| created_at | |

### positions

trip_id, lat, lng, accuracy, battery (nullable), at. Pruned after 30 days by the cron.

### checklists

activity (primary key), items_text. One item per line. Admin edits it.

### push_subscriptions

id, user_id, endpoint, p256dh, auth, created_at. Explorers and operators both live here. Deleted on a 404 or 410 from the push service.

### settings

key (primary key), value. One row to start, `grace_minutes`, default 30.

## Screens

Ten. Explorers see 1 to 6. Operators see 7 to 9. Admins also see 10.

1. **Profile.** First screen on install. All the `users` fields for an explorer. Saving sets the cookie, then shows one nudge to add to home screen and asks for notification permission. Without both, the alarm cannot reach them. Reachable from the menu to edit.
2. **Home.** No active trip: one "Plan a trip" button and a line about the last trip. Active trip: shows screen 4 instead.
3. **New trip.** Activity, area, route, companions, wearing, photo of you today, shoe photo (thumbnails of previous shoe photos to tap, or take a new one), return-by, and the checklist for the chosen activity as tick boxes. Battery shows if the phone reports it. Return-by is the only required field. The checklist does not block. "Start" takes a GPS fix and creates the trip.
4. **Active trip.** Return-by large. "I'm back" closes the trip. "Extend" opens a chooser: 30 minutes, 1, 2, 4 hours, or a new time. "I need help" is a slide-to-confirm. While this screen is open the client sends a position every two minutes.
5. **Overdue prompt.** The push notification opens screen 4 with a banner: "You're past your return time. Are you okay?" and the same three actions.
6. **Help.** Says SARZA has been alerted, stay where you are, and shows the emergency number as tap-to-call. Sends a position every 30 seconds while open. A "cancel, I'm fine" link for false alarms.
7. **Login.** Email box, "send me a link".
8. **Board.** Every open trip. Help first, then overdue, then active. Each row: name, activity, area, return-by, minutes since last position, last battery. Filter by area. Reloads every 30 seconds.
9. **Trip detail.** Profile and trip together, both photos, emergency contact as tap-to-call, positions as a list each with an "open in Google Maps" link, and a sentence in words about how old the last position is. One button, "close trip", with a reason.
10. **Admin.** Four tabs. Users: list, change role and organisation, delete, add operator. Checklists: pick activity, edit textarea, save. Broadcast: title and body, pushes to every explorer. Settings: grace period in minutes.

## Trip state machine

```
active ──return_by passes (cron)──▶ overdue
overdue ──extend──▶ active
active | overdue ──"I'm back"──▶ closed (safe)
active | overdue ──help slider──▶ help
help ──"cancel, I'm fine"──▶ closed (cancelled)
any open ──operator closes──▶ closed (operator_closed)
```

Help beats overdue. Nothing automatic leaves help. Closed is final.

## Cron, every minute

Two queries, both idempotent.

1. Trips with status `active` and `return_by` in the past and `prompted_at` null. For each: set status `overdue`, set `prompted_at`, push "are you okay?" to the explorer.
2. Trips with status `overdue`, `prompted_at` older than `grace_minutes`, `operators_alerted_at` null. For each: set `operators_alerted_at`, push to every operator.

Help trips push operators the moment the slider completes, from the request handler, not the cron.

Overdue trips show on the board at once, before the grace period. Operators are only pushed once it lapses.

Each trip is handled in its own try so one dead subscription does not stop the run. If a run fails, the next minute picks up where it left off.

The cron also deletes positions older than 30 days.

## Push

Web Push with VAPID keys held as Worker secrets. One Workers-compatible library for the payload encryption. Same path for explorers and operators.

The explorer prompt is sent with `requireInteraction` so it stays on screen. It cannot be louder than the phone's notification sound.

On iOS, push only works if the app was added to the home screen. This is the largest pilot risk. The profile screen nudge is the mitigation, and the home screen shows a persistent line if notifications are not enabled.

A 404 or 410 from the push service deletes that subscription.

## Location

Three moments, all while the app is on screen. Nothing runs in the background.

- One fix when the trip starts.
- One fix every two minutes on the active trip screen, with battery if the phone reports it.
- One fix on help, then every 30 seconds on the help screen.

If a send fails, the client keeps the last five positions in memory and sends them with the next attempt. If the trip start fails, the form stays filled in and says so.

## Errors

Every write is one D1 statement or one batch. No half-written trips.

The help slider fires the request and, on failure, retries every five seconds until it succeeds. Meanwhile the screen says "still trying to reach SARZA" with the emergency number as tap-to-call.

Failed requests elsewhere show one plain sentence and keep the form.

## Code layout

One Worker, one Hono app, one repo. No bundler for the client.

```
src/index.tsx          routes mounted, cron handler
src/routes/explorer.tsx  screens 1 to 6
src/routes/board.tsx     screens 8 and 9
src/routes/admin.tsx     screen 10
src/routes/auth.tsx      screen 7, magic link
src/routes/api.ts        JSON endpoints: start, extend, back, help, cancel, position, subscribe
src/views/               one JSX file per screen, shared layout with menu
src/lib/push.ts          send, prune dead subscriptions
src/lib/auth.ts          cookie token, magic link sign and verify
src/lib/db.ts            queries
src/lib/cron.ts          the two queries and the prune
public/manifest.json
public/sw.js             service worker, push display, notification click
public/app.js            geolocation, battery, push subscribe, slider, board refresh
public/app.css
migrations/              D1 SQL
wrangler.jsonc           D1, R2, cron, secrets
```

The JSON endpoints are what the future native app calls. The HTML screens call them too.

## Testing

Vitest with the Cloudflare Workers pool, so tests run against real D1 and real bindings locally.

- State machine and both cron queries: thorough. This is what finds people.
- Push: fake transport, assert on what would be sent and that dead subscriptions are removed.
- Auth: cookie set and read, magic link signs, verifies, expires, rejects tampering.
- Screens: one smoke test each that it renders for the right role and returns 403 for the wrong one.

PWA install and push are tested by hand on one iPhone and one Android before each release. There is no other way to test them.

## Deploy

`wrangler deploy`. A staging Worker and a production Worker with separate D1 and R2, both from the same config with environments.

## Open items to confirm during the build

- The SARZA emergency phone number shown on the help screen.
- The exact area list. Six to start.
- Whether the checklist seed content comes from SARZA or I draft it.
