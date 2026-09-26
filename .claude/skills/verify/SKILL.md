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

Explorers have no login, only a cookie, so a fresh browser profile is a fresh explorer. Operators and admins need a magic link. Mint one without email:

    U="<user id from the users table>"
    E=$(node -e "console.log(Date.now()+900000)")
    wrangler d1 execute DB --local --command "UPDATE users SET magic_link_expires=$E WHERE id='$U'"
    SECRET=$(grep '^SESSION_SECRET=' .dev.vars | cut -d= -f2-)
    node -e "
    const c=require('crypto');const [s,u,e]=process.argv.slice(1);const b=x=>Buffer.from(x).toString('base64url');
    const p=b(u+':'+e);console.log('http://localhost:8787/auth/verify?t='+p+'.'+b(c.createHmac('sha256',s).update(p).digest()));
    " "$SECRET" "$U" "$E"

A link works once and only if its expiry matches `users.magic_link_expires`, so mint a new one each time. Opening the link shows a confirm page, and the sign-in happens when you press its button.

`.dev.vars` has a live `RESEND_API_KEY`, so `POST /auth/link` sends a real email. Mint the link instead.

## Drive

Explorer flow, all through clicks: `/profile` is 5 steps, then pick an activity on `/`, then `/trip/new` is 6 steps. Activity keys are hike, run, climb, paraglide, mtb, other.

Slide-to-confirm (help, cancel a draft trip) ignores taps. `dragOnly` in `public/app.js` wants a pointerdown starting under value 25 and a release past 90, so drive it with a real mouse drag:

    const box = await slider.boundingBox()
    await page.mouse.move(box.x + 4, box.y + box.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 20; i++) await page.mouse.move(box.x + 4 + (box.width - 8) * (i / 20), box.y + box.height / 2)
    await page.mouse.up()

Headless Chromium has no microphone, so the voice note recorder on the "Where are you going?" step never starts. Hand it a generated stream first, and the real MediaRecorder code runs:

    await page.evaluate(() => {
      navigator.mediaDevices.getUserMedia = async () => { const ac = new AudioContext(); const o = ac.createOscillator(); const d = ac.createMediaStreamDestination(); o.connect(d); o.start(); return d.stream }
    })

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
