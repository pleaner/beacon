# On call

## Why

Today every overdue alert and every help call pushes to all operators and admins at once. Nobody owns a call, and nobody can tell afterwards who saw it, who picked it up, or when. On call puts one person on shift at a time, hands each alert to them first, passes it down the roster when they don't answer or say no, and keeps a full record of each call.

## Goals

- A roster of on-call people that cycles through fixed-length shifts.
- Each person can mark themselves available or unavailable. Unavailable people are skipped, and if the person on shift goes unavailable, the next available person takes over at once.
- Alerts go to the person on shift first and escalate in roster order when nobody responds.
- Accept takes the call. Reject passes it on at once.
- A full record of each call, from the moment it starts.
- The person going on shift is told, and sees an on-call icon in the top bar while on shift.
- All of it on the web app and in the Android app.

## Non-goals

- Shift swaps, calendars, or planning shifts by date.
- SMS, WhatsApp or phone-call escalation. Push only, as today.
- Exact-second escalation timing.

## Anti-goals

- An alert that reaches nobody. Every path that can't find an on-call person falls back to today's behaviour: push to all operators and admins.
- Extra machinery. Sean has asked for this app to stay thin. One-minute cron timing is fine (Sean confirmed a 2-minute wait running to about 3 is acceptable).

## Decided by Sean

- **Roster.** A list of on-call people. Each gets a shift of fixed length, default 8 hours, then the next person goes on, cycling through the list.
- **Availability.** People mark themselves available or unavailable. When the person on shift goes unavailable, the next person goes on shift.
- **Settings.** Shift length is a setting. Non-response time is a setting, default 2 minutes.
- **Escalation.** Alerts escalate in roster order. If the current person doesn't respond within the non-response time, the next person gets it.
- **Accept and Reject.** The words are "Accept" and "Reject". Reject passes the call to the next person immediately.
- **The call record.** A full record of everything that happens on the call: when it started, each alert and escalation, every accept and reject, every chat message with its time, and any other activity on the call as it goes along.
- **Shift start.** The person going on shift gets a notification that their shift has begun, and an icon in their top bar shows they are on shift.
- **Android.** Everything above is in the Android app too, not only the web.
- **Admin area on Android.** The Android app learns the admin role and gets an admin area with three sections: Users, Calls, and On call. The On call section is the full page, with adding, removing and reordering people, and the two settings.
- **Calls, including past ones.** The admin area (web and Android) has a Calls section listing every call, open and closed, newest first. Each opens its full record.
- **Changes to on call are announced.** Every operator and admin gets a push when the on-call setup changes.

## My calls (Sean can overturn these)

- **The admin role already exists.** Users already carry an `admin` role, and the web already has an admin area (Users, Checklists, Broadcast, Settings in the operator menu). On the web, Calls and On call join that menu for admins. On Android the admin role and area are new; until now Android has treated admins as operators.
- **What counts as an on-call change.** Someone added, removed or reordered; someone going available or unavailable; a handover caused by that; either setting changing. Each sends one push to all operators and admins saying what changed and who is on shift now. The regular clock handover every 8 hours does not; that only sends the shift-start push to the person going on.
- **What operators see.** Operators (web and Android) get an On call page in their menu: who is on now and until when, who is next, the list with availability, and their own switch. The admin area's On call section is the same page with the admin controls added. Calls stay admin-only; operators see a call's record on its trip page.
- **Who manages the list.** Admins add, remove and reorder people. Any operator or admin on the list can change their own availability. Admins can also change anyone's availability, for someone who forgot.
- **Where the settings live.** Shift length and non-response time sit on the On call page for admins, not on the general Settings tab, so everything about on call is in one place.
- **Shift times.** Shifts are anchored to 06:00 Africa/Johannesburg. With 8 hours that's 06:00, 14:00, 22:00. Slot n of the day belongs to the next available person in the cycle. A mid-shift handover (someone goes unavailable) gives the rest of the current slot to the next available person and leaves later slots where they were. The builder picks how to compute the cycle so it stays stable when someone is skipped.
- **Additive escalation.** People who were already alerted for a call keep it. Escalation adds the next person, it does not take the call away from the earlier ones. Someone who rejected is the exception: they get no more pushes for that call and can't accept it afterwards.
- **End of the roster.** When every available person has rejected or timed out, the call goes to all operators and admins, as today, and the record says so.
- **Nobody on call.** Empty list, or everyone unavailable: alerts go to all operators and admins at once, as today.
- **Who can accept.** Any operator or admin, even one the call hasn't reached yet, except someone who rejected it. Once accepted, escalation stops and no one else gets a push. The trip page shows "Accepted by <name>, <time>". There is no hand-back after accepting.
- **What a call is.** Each overdue alert and each help call is its own call with its own record. If an explorer goes overdue and then slides for help, that's two calls. A call starts when its first alert goes out and closes when the trip ends.
- **What goes on the record.** The call starting. Each push sent, to whom. Each escalation and why (no response, rejected). Accept and reject. Chat messages on the trip while the call is open. Explorer actions while the call is open: extend, help, cancel help, back safe. Operator actions while the call is open: siren, close trip. The fall back to everyone. The call closing. Individual GPS fixes stay off the record because the map already shows them.
- **What stops a call.** Accept stops escalation. So does the explorer showing they're fine: extending the trip, cancelling help, or marking themselves back. Any of those closes the call. If the same trip goes overdue again later, or the explorer slides for help again, that's a new call.
- **A push that reaches no device.** If the push to the next person lands on none of their devices (no web push turned on, or FCM not set up), escalation moves past them at once instead of waiting out the timer, and the record says so. Being on shift doesn't require a working device; the page shows a warning beside anyone with none.
- **Chat during a call.** Before anyone accepts, the explorer's chat messages push to everyone the call has reached. After an accept, they push only to the person who accepted. With no open call, chat pushes go to all operators and admins as today.
- **Where Accept and Reject are.** On the trip page only. The alert opens the trip page. No action buttons on the notification itself.
- **Where the record shows.** On the trip page of the board (web and Android), in time order, and in the admin Calls section, kept after the trip ends.
- **Not recorded.** Roster changes and availability changes are not on any call record.
- **Shift-start push.** Sent when a person goes on shift, whether by the clock or by a handover. Uses the existing push path (web push, and FCM on Android once configured).

## Constraints

- Hono on Cloudflare Workers, D1, the existing one-minute cron (`src/lib/cron.ts`). No new Cloudflare products.
- Settings live in the existing `settings` key/value table (`getSetting`/`setSetting` in `src/lib/db.ts`).
- Pushes go through `src/lib/push.ts`. Today overdue and help alerts use `pushToRoles(['operator','admin'])`; on call replaces that with targeted pushes plus the fallback.
- Trip chat is the existing `messages` table. Its entries can be read into the record rather than copied, builder's choice.
- Android is Kotlin and Compose (`android/`), talking to the worker's JSON API with a bearer token. It has native Board and BoardTrip screens already. FCM is not configured in production yet (`FCM_SERVICE_ACCOUNT` unset), so Android pushes, including shift-start and call alerts, only arrive once Firebase is set up. The screens work without it.
- Tests run in vitest with the Workers pool (`npm test`). New logic (shift calculation, escalation, accept/reject races) needs tests.
- Accept and Reject can race between two people and with the cron. The first accept wins; the builder enforces it in the database.

## Left to the builder

- Table design for the roster, availability, calls and the call record.
- How the current on-shift person is computed and how "went on shift" is detected for the shift-start push.
- How the record merges stored events with chat messages.
- The exact look of the On call page, the Calls list, the record, and the top-bar icon, within the existing design (navy, yellow buttons, the icon set in `src/views/icons.tsx` and `android/.../Icons.kt`).
- API shape for the Android app.
