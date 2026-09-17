# SARZA Beacon

File a trip plan before you go out. If you're not back by the time you said, the app asks if you're okay. If you don't answer, SARZA operators see it and get pushed. Slide for help at any time.

Spec: docs/superpowers/specs/2026-09-17-sarza-beacon-design.md

## Run locally

    npm install
    cp .dev.vars.example .dev.vars   # then fill in, see scripts/vapid.mjs
    npm run migrate:local
    npm run dev

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

There is no sign-up for admins. Insert a row by hand with `wrangler d1 execute DB [--env staging] --remote`, role `admin`, with an email. See the plan, Task 14.

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

## Known gaps

- Email sends from noreply@mybestlife.live until pleaner.com is verified in Resend.
- No background location. Positions arrive only while the app is open.
- Explorer identity is a cookie. Clearing the browser means a new profile.
