# Guardian for Android

Kotlin and Jetpack Compose. One app for explorers and operators; the account's role picks the screens. It talks to the
worker's JSON API with a bearer token.

## Build

Needs JDK 17 and the Android SDK (`brew install openjdk@17 && brew install --cask android-commandlinetools`, then
`sdkmanager "platforms;android-35" "build-tools;35.0.0" "platform-tools"`). Put `sdk.dir=<sdk path>` in `local.properties`.

    export JAVA_HOME=/opt/homebrew/opt/openjdk@17
    ./gradlew assembleDebug                                          # talks to guardian.pleaner.com
    ./gradlew installDebug -PguardianUrl=http://10.0.2.2:8787        # emulator against `wrangler dev --ip 0.0.0.0`

## What runs where

- `TripService`: foreground location service for the length of a trip. A fix every 2 minutes (30 s after a call for
  help), queued on the phone until there is signal. Rings "Are you okay?" at the return time without needing signal,
  and plays the siren when a position reply carries a newer `siren_at`.
- `Alarm`: the siren, on the alarm stream at full volume. Silent mode doesn't mute it and Do Not Disturb lets alarms
  through by default. Stops on Stop, on opening the app, or after three minutes.
- `Push`: Firebase messages. Data-only, so the app decides how loud each one is.

## Before release

- Push: create a Firebase project with an Android app `za.org.sarza.guardian`. Put its app id, API key, project id
  and sender id in `~/.gradle/gradle.properties` (see `gradle.properties` for the names), and the service account JSON
  in the worker: `wrangler secret put FCM_SERVICE_ACCOUNT`. Without these, the app works but gets no pushes.
- Sign-in links: set `ANDROID_CERT_SHA256` on the worker to the release key's SHA-256 fingerprint, so Android
  opens `https://guardian.pleaner.com/auth/verify` links in the app. Until then operators paste the link.
- Play Console declarations: foreground location service, and the battery optimisation exemption.
