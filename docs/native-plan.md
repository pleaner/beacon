# Native apps

Guardian gets one native app per platform, Swift for iOS and Kotlin for Android. Each app serves both explorers and operators, and the account's role decides which screens show. Admin stays on the web.

## What the apps need

**Background location.** On Android a foreground service of type `location` runs for the length of the trip. It starts while the app is on screen, so "while using" permission is enough and the app never asks for `ACCESS_BACKGROUND_LOCATION`. The app asks to be left out of battery optimisation, because Samsung and Xiaomi kill services anyway. On iOS the app uses the location background mode with `CLBackgroundActivitySession`. If the user swipes the app away, iOS stops updates. Positions queue on the phone and send when there is signal.

**Trip icon while the app is closed.** On Android this is the foreground service's ongoing notification, with time left and buttons for "I'm OK", "Extend" and "Help". On iOS it is a Live Activity on the lock screen and Dynamic Island, built as a small SwiftUI widget extension. iOS ends a Live Activity after 8 hours, so the server restarts it by push on longer trips.

**Fall detection.** During a trip the app is awake, so it can read the accelerometer. A fall is free fall below about 0.5 g, then an impact above about 3 g, then about 30 seconds lying still. That starts a loud local countdown, and help goes out only if nobody cancels. Phones in backpacks get dropped, so it ships opt-in, with thresholds the server can tune. The first version only records, so real hikes set the thresholds before it raises alerts.

**Loud alerts and a remote siren on silent.** On iOS, Critical Alerts ignore the silent switch and Do Not Disturb. They need an entitlement from Apple, and each sound lasts at most 30 seconds. During a trip the reply to each position upload can also carry a `siren` command, and the app plays it with the `.playback` audio session, which ignores the silent switch. On Android the app plays on the alarm stream at full volume. A notification channel that bypasses Do Not Disturb needs the user to grant notification-policy access. Full-screen alerts on Android 14 need a Play declaration.

**Operators.** The board, the trip detail, messages and closing a trip move into the app. Overdue and help alerts arrive as Critical Alerts on iOS and alarm-channel notifications on Android. The brief and GPX stay server-rendered, and the app opens or shares them.

## Server changes

- Sign-in. The magic link opens the app through a Universal Link on iOS and an App Link on Android. The app exchanges it for a session token and sends that as a bearer header.
- Native push. The server stores APNs and FCM tokens per device and sends through both with signed JWTs. Each device has its own token, which fixes the web-push bug where a phone could only get alerts for one account.
- The position reply carries pending commands, starting with `siren`.
- JSON endpoints for the operator board and trip detail. The explorer endpoints in `src/routes/api.tsx` already exist.

## Order

1. Start the slow paperwork. That means Apple Developer and Google Play accounts registered to SARZA as an organisation, which needs a D-U-N-S number, and then the Critical Alerts entitlement request. An organisation Play account skips the 12-tester, 14-day closed test that new personal accounts must run.
2. Server changes.
3. Android app, explorer side then operator side.
4. iOS app, the same way. Critical Alerts go in once Apple approves them.
5. Fall detection, recording first, alerts after.
6. Last, remove the explorer web app and the PWA. The home page becomes links to the App Store and Google Play. The operator board stays on the web as a desk fallback, and admin stays on the web.

## Risk

If Apple refuses Critical Alerts, iOS cannot promise a loud sound on silent while the app is closed. The siren then only works while a trip keeps the app awake.
