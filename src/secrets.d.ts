// wrangler types generates two separate Env declarations: the global `Env` (what app code imports)
// and `Cloudflare.Env` (what cloudflare:test's `env` is typed as). The global one already extends
// Cloudflare.Env here, so secrets only need declaring once, on Cloudflare.Env.
declare namespace Cloudflare {
  interface Env {
    SESSION_SECRET: string
    VAPID_PUBLIC_KEY: string
    VAPID_PRIVATE_KEY: string
    RESEND_API_KEY: string
  }
}

interface Env extends Cloudflare.Env {}
