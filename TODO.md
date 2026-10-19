# To do

Native apps, in order. See `docs/native-plan.md`.

- [ ] Register Apple Developer and Google Play accounts to SARZA as an organisation (needs a D-U-N-S number).
- [x] Sign-in: Google Web OAuth client set on the worker; live since 2026-10-11.
- [ ] Sign-in: check each operator's email is a Google account (or change it under Admin), so they reach the board rather than a new explorer account.
- [ ] Sign-in: once the Apple account exists, make a Services ID and key and set the four `APPLE_*` secrets; the Apple button appears by itself. Sign in with Apple on Android comes after.
- [ ] Request the Critical Alerts entitlement from Apple.
- [x] Server: sign-in link that opens the app and returns a bearer token.
- [ ] Server: native push through APNs and FCM, one token per device. FCM is built; APNs comes with the iOS app.
- [x] Server: `siren` command in the position reply.
- [x] Server: JSON endpoints for the operator board and trip detail.
- [x] Android app, explorer side then operator side. See `android/README.md`.
- [ ] Android: create the Firebase project and set `FCM_SERVICE_ACCOUNT`, so phones get pushes when the app is closed.
- [ ] Android: make a release signing key, add its SHA-1 to an Android OAuth client in Google Cloud, and publish to Play internal testing.
- [ ] Android: run a real hike on a Samsung phone to check it keeps tracking with the screen off.
- [ ] Android: voice notes and photos in chat, and the brief and GPX for searchers, are web-only for now.
- [ ] iOS app, explorer side then operator side, with the Live Activity.
- [ ] Apple Watch: an emergency alert from the wrist, so an explorer can call for help without taking the phone out, and see "are you okay?" and help alerts on the watch.
- [ ] Fall detection, recording first, alerts after.
- [ ] Bring back the voice note on the trip plan. It was taken out on 2026-09-27; the `trips.voice_note_key` column is still there, and git history has the recorder with its buttons inside the route box.
- [ ] Internationalisation: show the app in the language the explorer picks in their profile (English, German, Dutch, French, Spanish, Italian, Portuguese, Mandarin).
- [ ] Referral plan: how explorers bring friends to Guardian, for example a personal link on the shared trip card, how we count who joined through whom, and whether a referral earns anything.
- [ ] Last: remove the explorer web app and PWA, and make the home page links to the app stores.

Help without signal.

- [ ] Ask SARZA for a number that receives texts, and who watches it. Set it under Admin, Settings; the "Send SARZA a text" button stays hidden until then.
- [ ] Ask SARZA how 112 calls in their area reach them, then decide whether the no-signal screen offers 112.
- [ ] Ask SARZA for their wording on moving to find signal versus staying put.
