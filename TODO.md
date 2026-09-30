# To do

Native apps, in order. See `docs/native-plan.md`.

- [ ] Register Apple Developer and Google Play accounts to SARZA as an organisation (needs a D-U-N-S number).
- [ ] Request the Critical Alerts entitlement from Apple.
- [x] Server: sign-in link that opens the app and returns a bearer token.
- [ ] Server: native push through APNs and FCM, one token per device. FCM is built; APNs comes with the iOS app.
- [x] Server: `siren` command in the position reply.
- [x] Server: JSON endpoints for the operator board and trip detail.
- [x] Android app, explorer side then operator side. See `android/README.md`.
- [ ] Android: create the Firebase project and set `FCM_SERVICE_ACCOUNT`, so phones get pushes when the app is closed.
- [ ] Android: make a release signing key, set `ANDROID_CERT_SHA256` on the worker, and publish to Play internal testing.
- [ ] Android: run a real hike on a Samsung phone to check it keeps tracking with the screen off.
- [ ] Android: explorer photos in the profile, voice notes and photos in chat, and trip photos on the operator screen are web-only for now.
- [ ] Android: Sign in with Google. Use Credential Manager on the phone, and have the server check the ID token's signature against Google's keys. A web version was built and dropped on 2026-09-30, and nothing from it was merged.
- [ ] iOS app, explorer side then operator side, with the Live Activity.
- [ ] Fall detection, recording first, alerts after.
- [ ] Bring back the voice note on the trip plan. It was taken out on 2026-09-27; the `trips.voice_note_key` column is still there, and git history has the recorder with its buttons inside the route box.
- [ ] Internationalisation: show the app in the language the explorer picks in their profile (English, German, Dutch, French, Spanish, Italian, Portuguese, Mandarin).
- [ ] Referral plan: how explorers bring friends to Guardian, for example a personal link on the shared trip card, how we count who joined through whom, and whether a referral earns anything.
- [ ] Last: remove the explorer web app and PWA, and make the home page links to the app stores.

Help without signal.

- [ ] Ask SARZA for a number that receives texts, and who watches it. Set it under Admin, Settings; the "Send SARZA a text" button stays hidden until then.
- [ ] Ask SARZA how 112 calls in their area reach them, then decide whether the no-signal screen offers 112.
- [ ] Ask SARZA for their wording on moving to find signal versus staying put.
