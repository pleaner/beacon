// wrangler types generates two separate Env declarations: the global `Env` (what app code imports)
// and `Cloudflare.Env` (what cloudflare:test's `env` is typed as). The global one already extends
// Cloudflare.Env here, so secrets only need declaring once, on Cloudflare.Env.
declare namespace Cloudflare {
  interface Env {
    // Signs the emailed sign-in links.
    SESSION_SECRET: string
    // Unset: sign-in links go to the log instead of email.
    RESEND_API_KEY?: string
    VAPID_PUBLIC_KEY: string
    VAPID_PRIVATE_KEY: string
    // Firebase service account JSON for the Android app's push. Unset: phones get no push.
    FCM_SERVICE_ACCOUNT?: string
    // Sign in with Google: the web OAuth client. The Android app sends ID tokens for this same client ID.
    GOOGLE_CLIENT_ID?: string
    GOOGLE_CLIENT_SECRET?: string
    // Sign in with Apple: the Services ID, the team, and the .p8 key from the Apple Developer account.
    // Until all four are set there is no Apple button.
    APPLE_SERVICES_ID?: string
    APPLE_TEAM_ID?: string
    APPLE_KEY_ID?: string
    APPLE_PRIVATE_KEY?: string
  }
}

interface Env extends Cloudflare.Env {}
