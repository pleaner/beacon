// Sign in with Google or Apple. The web uses each provider's authorization code flow; the Android app gets a
// Google ID token from Credential Manager and sends it to /api/auth/google. Every ID token, from either route,
// is checked against the provider's published keys before anything trusts it.

export type Provider = 'google' | 'apple'

export interface Identity {
  provider: Provider
  sub: string
  email: string | null
  emailVerified: boolean
  name: string | null
}

const PROVIDERS = {
  google: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    keys: 'https://www.googleapis.com/oauth2/v3/certs',
    issuers: ['https://accounts.google.com', 'accounts.google.com'],
  },
  apple: {
    authorize: 'https://appleid.apple.com/auth/authorize',
    token: 'https://appleid.apple.com/auth/token',
    keys: 'https://appleid.apple.com/auth/keys',
    issuers: ['https://appleid.apple.com'],
  },
} as const

type OAuthEnv = Pick<Env, 'APP_URL' | 'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET' | 'APPLE_SERVICES_ID' | 'APPLE_TEAM_ID' | 'APPLE_KEY_ID' | 'APPLE_PRIVATE_KEY'>

// Which providers have their keys set. A provider without keys has no button.
export function enabledProviders(env: OAuthEnv): Provider[] {
  const out: Provider[] = []
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) out.push('google')
  if (env.APPLE_SERVICES_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY) out.push('apple')
  return out
}

const clientId = (env: OAuthEnv, p: Provider) => (p === 'google' ? env.GOOGLE_CLIENT_ID : env.APPLE_SERVICES_ID) ?? ''
const redirectUri = (env: OAuthEnv, p: Provider) => `${env.APP_URL}/auth/${p}/callback`

let http: typeof fetch = (input, init) => fetch(input, init)
export function setOAuthHttpForTests(fn: typeof fetch | null) {
  http = fn ?? ((input, init) => fetch(input, init))
  keyCache.clear()
}

export function authorizeUrl(env: OAuthEnv, p: Provider, state: string, nonce: string): string {
  const q = new URLSearchParams({
    client_id: clientId(env, p), redirect_uri: redirectUri(env, p), response_type: 'code', state, nonce,
    scope: p === 'google' ? 'openid email profile' : 'name email',
  })
  if (p === 'google') q.set('prompt', 'select_account')
  // Apple only returns the user's name and email by POSTing the callback.
  if (p === 'apple') q.set('response_mode', 'form_post')
  return `${PROVIDERS[p].authorize}?${q}`
}

// The callback's code, exchanged for the user's identity. Apple sends the name only on the very first sign-in,
// as JSON in the callback's `user` field, so it's passed through here.
export async function exchangeCode(env: OAuthEnv, p: Provider, code: string, nonce: string, appleUser?: string | null): Promise<Identity> {
  const secret = p === 'google' ? env.GOOGLE_CLIENT_SECRET ?? '' : await appleClientSecret(env)
  const res = await http(PROVIDERS[p].token, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId(env, p), client_secret: secret, redirect_uri: redirectUri(env, p) }),
  })
  if (!res.ok) throw new Error(`${p} token ${res.status}`)
  const { id_token } = (await res.json()) as { id_token?: string }
  if (!id_token) throw new Error(`${p} sent no ID token`)
  const id = await verifyIdToken(p, id_token, clientId(env, p), nonce)
  if (p === 'apple' && !id.name && appleUser) {
    try {
      const n = (JSON.parse(appleUser) as { name?: { firstName?: string; lastName?: string } }).name
      id.name = [n?.firstName, n?.lastName].filter(Boolean).join(' ') || null
    } catch {
      // a malformed user field only costs us the name
    }
  }
  return id
}

// The Android app's Google ID token. Its audience is the web client, which the app passes as serverClientId.
export function verifyGoogleToken(env: OAuthEnv, idToken: string): Promise<Identity> {
  return verifyIdToken('google', idToken, env.GOOGLE_CLIENT_ID ?? '')
}

export async function verifyIdToken(p: Provider, token: string, audience: string, nonce?: string): Promise<Identity> {
  const [h, b, s] = token.split('.')
  if (!h || !b || !s || !audience) throw new Error('Bad ID token')
  const header = JSON.parse(text(h)) as { kid?: string; alg?: string }
  if (header.alg !== 'RS256') throw new Error('Unexpected ID token algorithm')
  const key = await signingKey(p, header.kid ?? '')
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, bytes(s), new TextEncoder().encode(`${h}.${b}`))
  if (!ok) throw new Error('ID token signature does not match')
  const c = JSON.parse(text(b)) as Record<string, unknown>
  const issuers: readonly string[] = PROVIDERS[p].issuers
  if (!issuers.includes(String(c.iss))) throw new Error('ID token from the wrong issuer')
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud]
  if (!aud.includes(audience)) throw new Error('ID token for another app')
  if (typeof c.exp !== 'number' || c.exp * 1000 < Date.now() - 60_000) throw new Error('ID token expired')
  if (nonce !== undefined && c.nonce !== nonce) throw new Error('ID token nonce does not match')
  if (typeof c.sub !== 'string' || !c.sub) throw new Error('ID token has no subject')
  const email = typeof c.email === 'string' ? c.email.toLowerCase() : null
  // Apple sends email_verified as the string "true".
  return { provider: p, sub: c.sub, email, emailVerified: c.email_verified === true || c.email_verified === 'true', name: typeof c.name === 'string' ? c.name : null }
}

// Providers rotate their keys; a kid we haven't seen triggers one refetch.
const keyCache = new Map<string, { keys: Map<string, CryptoKey>; until: number }>()
async function signingKey(p: Provider, kid: string): Promise<CryptoKey> {
  let cached = keyCache.get(p)
  if (!cached || cached.until < Date.now() || !cached.keys.has(kid)) {
    const res = await http(PROVIDERS[p].keys)
    if (!res.ok) throw new Error(`${p} keys ${res.status}`)
    const { keys } = (await res.json()) as { keys: Array<JsonWebKey & { kid: string }> }
    const map = new Map<string, CryptoKey>()
    for (const k of keys) {
      if (k.kty !== 'RSA') continue
      map.set(k.kid, await crypto.subtle.importKey('jwk', { kty: 'RSA', n: k.n, e: k.e }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']))
    }
    cached = { keys: map, until: Date.now() + 60 * 60_000 }
    keyCache.set(p, cached)
  }
  const key = cached.keys.get(kid)
  if (!key) throw new Error('ID token signed with an unknown key')
  return key
}

// Apple wants a short-lived JWT, signed with the .p8 key from the developer account, as the client secret.
async function appleClientSecret(env: OAuthEnv): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const head = b64url(JSON.stringify({ alg: 'ES256', kid: env.APPLE_KEY_ID }))
  const claims = b64url(JSON.stringify({ iss: env.APPLE_TEAM_ID, iat: now, exp: now + 300, aud: 'https://appleid.apple.com', sub: env.APPLE_SERVICES_ID }))
  const der = Uint8Array.from(atob((env.APPLE_PRIVATE_KEY ?? '').replace(/-----[^-]+-----|\s/g, '')), (ch) => ch.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${head}.${claims}`))
  return `${head}.${claims}.${b64url(sig)}`
}

function b64url(v: string | ArrayBuffer): string {
  // Strings here are JSON of ASCII claims, so btoa takes them as they are.
  const s = typeof v === 'string' ? v : String.fromCharCode(...new Uint8Array(v))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function bytes(s: string): Uint8Array {
  return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0))
}
function text(s: string): string {
  return new TextDecoder().decode(bytes(s))
}
