---
name: verify
description: Build, launch and drive SARZA Beacon to observe a change at its real surface (the explorer PWA and the operator board).
---

# Verifying Beacon

Beacon is a Hono worker on Cloudflare. The surface is the browser: the explorer PWA and the operator board.

## Launch

    npm install
    npm run migrate:local
    npx wrangler dev --test-scheduled > /tmp/dev.log 2>&1 &

`--test-scheduled` is required or `/__scheduled` returns 404. Wait for `Ready on http://localhost:8787` in the log. Wrangler hot-reloads on edit, so a source change needs no restart.

## Sign in

Everyone signs in with Google or Apple, which a headless browser can't do. Make a session by hand instead: give a user a token hash and set the matching cookie.

    T=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")
    H=$(node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" "$T")
    wrangler d1 execute DB --local --command "UPDATE users SET token_hash='$H' WHERE id='<user id>'"

Then in Playwright, `context.addCookies([{ name: 'beacon', value: T, domain: 'localhost', path: '/' }])`. For a brand-new explorer, insert a user with `phone=''` first: an empty phone is how the app knows to send them to the profile form.

## Drive

Explorer flow, all through clicks: `/profile` is 5 steps (it needs a signed-in user), then pick an activity on `/`, then `/trip/new` is 6 steps. Activity keys are hike, run, climb, paraglide, mtb, other.

Slide-to-confirm (help, cancel a draft trip) ignores taps. `dragOnly` in `public/app.js` wants a pointerdown starting under value 25 and a release past 90, so drive it with a real mouse drag:

    const box = await slider.boundingBox()
    await page.mouse.move(box.x + 4, box.y + box.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 20; i++) await page.mouse.move(box.x + 4 + (box.width - 8) * (i / 20), box.y + box.height / 2)
    await page.mouse.up()

The step buttons animate, so wait about 700 ms after each Next before reading the step.

Playwright MCP only writes inside the repo, so screenshots go to `.playwright-mcp/` (untracked).

## Reach a state

Trip states are driven by the cron, not by waiting. Backdate the row, then fire it:

    # overdue
    wrangler d1 execute DB --local --command "UPDATE trips SET return_by=(unixepoch()-3600)*1000 WHERE id='<id>'"
    curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"

    # operators alerted: age prompted_at past the 30 min grace, then fire again
    wrangler d1 execute DB --local --command "UPDATE trips SET prompted_at=(unixepoch()-1900)*1000 WHERE id='<id>'"

The cron prints its counts to the dev log as `cron {"prompted":n,"alerted":n,...}`.

## Clean up

    wrangler d1 execute DB --local --command "DELETE FROM trips WHERE user_id IN (SELECT id FROM users WHERE email='<test email>'); DELETE FROM users WHERE email='<test email>'"
