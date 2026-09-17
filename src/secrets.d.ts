// wrangler types generates two separate Env declarations (global `Env` and `Cloudflare.Env`) that
// are structurally compared, not merged with each other. Augment both so app code (which uses the
// global `Env`) and cloudflare:test's `env` (typed `Cloudflare.Env`) stay assignable to each other.
interface Env {
  SESSION_SECRET: string
  VAPID_PUBLIC_KEY: string
  VAPID_PRIVATE_KEY: string
  RESEND_API_KEY: string
}

declare namespace Cloudflare {
  interface Env {
    SESSION_SECRET: string
    VAPID_PUBLIC_KEY: string
    VAPID_PRIVATE_KEY: string
    RESEND_API_KEY: string
  }
}
