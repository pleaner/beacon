import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import worker from '../src/index'
import { hashToken } from '../src/lib/auth'
import { getUserById, getUserByTokenHash } from '../src/lib/db'
import { cookieFor, makeExplorer, makeOperator } from './helpers'
import { fakeProviders } from './fake-oauth'

const BASE = 'https://beacon.test'
let fake: Awaited<ReturnType<typeof fakeProviders>>
beforeEach(async () => { fake = await fakeProviders() })
afterEach(() => fake.restore())

// Starts a sign-in the way a browser does, and returns what the callback needs.
async function begin(provider: 'google' | 'apple', e: Env = env) {
  const ctx = createExecutionContext()
  const res = await worker.fetch(new Request(`${BASE}/auth/${provider}`, { redirect: 'manual' }), e, ctx)
  await waitOnExecutionContext(ctx)
  expect(res.status).toBe(302)
  const stateCookie = (res.headers.get('set-cookie') ?? '').match(/oauth=([^;]+)/)![1]
  const [, state, nonce] = stateCookie.split('.')
  return { location: res.headers.get('location')!, state, nonce, cookie: `oauth=${stateCookie}` }
}

async function googleCallback(q: string, cookie: string) {
  return exports.default.fetch(`${BASE}/auth/google/callback?${q}`, { headers: { cookie }, redirect: 'manual' })
}
const sessionFrom = (res: Response) => (res.headers.get('set-cookie') ?? '').match(/beacon=([^;]+)/)?.[1]

describe('sign in with Google on the web', () => {
  it('shows the Google button, no Apple button without its keys, and sends a signed-in operator to the board', async () => {
    let res = await exports.default.fetch(`${BASE}/login`)
    const html = await res.text()
    expect(html).toContain('href="/auth/google"')
    expect(html).not.toContain('href="/auth/apple"')
    expect(html).not.toContain('name="email"')
    expect((await exports.default.fetch(`${BASE}/auth/apple`)).status).toBe(404)
    const o = await makeOperator()
    res = await exports.default.fetch(`${BASE}/login`, { headers: { cookie: cookieFor(o.token) }, redirect: 'manual' })
    expect(res.headers.get('location')).toBe('/board')
  })

  it('sends a new person to Google, then makes them an explorer and asks for their profile', async () => {
    const s = await begin('google')
    const url = new URL(s.location)
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('client_id')).toBe('google-web-client')
    expect(url.searchParams.get('state')).toBe(s.state)
    expect(url.searchParams.get('nonce')).toBe(s.nonce)
    expect(url.searchParams.get('redirect_uri')).toBe(`${env.APP_URL}/auth/google/callback`)
    fake.next(await fake.idToken('google', { sub: 'g-new', email: 'Ayanda@Example.com', name: 'Ayanda Zulu', nonce: s.nonce }))
    const res = await googleCallback(`code=abc&state=${s.state}`, s.cookie)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/profile')
    expect(fake.tokenRequests.at(-1)?.get('code')).toBe('abc')
    expect(fake.tokenRequests.at(-1)?.get('client_secret')).toBe('google-secret')
    const user = (await getUserByTokenHash(env.DB, await hashToken(sessionFrom(res)!)))!
    expect(user).toMatchObject({ role: 'explorer', name: 'Ayanda Zulu', email: 'ayanda@example.com', phone: '', google_sub: 'g-new' })
    // Home sends them back to finish the profile until it has a phone number.
    const home = await exports.default.fetch(`${BASE}/`, { headers: { cookie: cookieFor(sessionFrom(res)!) }, redirect: 'manual' })
    expect(home.headers.get('location')).toBe('/profile')
  })

  it('finds an operator by their verified email, links the account, and recognises it later by Google id alone', async () => {
    const o = await makeOperator({ email: 'ops@sarza.test' })
    let s = await begin('google')
    fake.next(await fake.idToken('google', { sub: 'g-ops', email: 'OPS@sarza.test', nonce: s.nonce }))
    let res = await googleCallback(`code=c1&state=${s.state}`, s.cookie)
    expect(res.headers.get('location')).toBe('/board')
    expect((await getUserByTokenHash(env.DB, await hashToken(sessionFrom(res)!)))?.id).toBe(o.user.id)
    expect((await getUserById(env.DB, o.user.id))?.google_sub).toBe('g-ops')
    // A changed Google email still reaches the same account.
    s = await begin('google')
    fake.next(await fake.idToken('google', { sub: 'g-ops', email: 'renamed@sarza.test', nonce: s.nonce }))
    res = await googleCallback(`code=c2&state=${s.state}`, s.cookie)
    expect((await getUserByTokenHash(env.DB, await hashToken(sessionFrom(res)!)))?.id).toBe(o.user.id)
  })

  it('brings back an existing explorer by email, keeping their profile', async () => {
    const e = await makeExplorer({ name: 'Thandi', email: 'thandi@example.com' })
    const s = await begin('google')
    fake.next(await fake.idToken('google', { sub: 'g-thandi', email: 'thandi@example.com', nonce: s.nonce }))
    const res = await googleCallback(`code=c&state=${s.state}`, s.cookie)
    expect(res.headers.get('location')).toBe('/')
    expect((await getUserByTokenHash(env.DB, await hashToken(sessionFrom(res)!)))).toMatchObject({ id: e.user.id, name: 'Thandi' })
  })

  it('never links an unverified email to an existing account', async () => {
    const o = await makeOperator({ email: 'boss@sarza.test' })
    const s = await begin('google')
    fake.next(await fake.idToken('google', { sub: 'g-sneaky', email: 'boss@sarza.test', email_verified: false, nonce: s.nonce }))
    const res = await googleCallback(`code=c&state=${s.state}`, s.cookie)
    expect(res.headers.get('location')).toBe('/profile')
    const user = (await getUserByTokenHash(env.DB, await hashToken(sessionFrom(res)!)))!
    expect(user.id).not.toBe(o.user.id)
    expect(user.role).toBe('explorer')
  })

  it('refuses a callback without the matching state cookie, a wrong nonce, or a forged token', async () => {
    let s = await begin('google')
    fake.next(await fake.idToken('google', { sub: 'g-x', email: 'x@example.com', nonce: s.nonce }))
    let res = await googleCallback(`code=c&state=${s.state}`, '')
    expect(res.status).toBe(400)
    expect(sessionFrom(res)).toBeUndefined()
    res = await googleCallback(`code=c&state=not-it`, s.cookie)
    expect(res.status).toBe(400)

    s = await begin('google')
    fake.next(await fake.idToken('google', { sub: 'g-x', email: 'x@example.com', nonce: 'replayed' }))
    res = await googleCallback(`code=c&state=${s.state}`, s.cookie)
    expect(res.status).toBe(400)
    expect(sessionFrom(res)).toBeUndefined()

    s = await begin('google')
    fake.next(await fake.idToken('google', { sub: 'g-x', email: 'x@example.com', nonce: s.nonce }, await fake.otherKey()))
    res = await googleCallback(`code=c&state=${s.state}`, s.cookie)
    expect(res.status).toBe(400)
    expect(await res.text()).toContain("couldn&#39;t sign you in")
  })

  it('shows the buttons again, without an error, when the person cancels at Google', async () => {
    const s = await begin('google')
    const res = await googleCallback(`error=access_denied&state=${s.state}`, s.cookie)
    expect(res.status).toBe(200)
    expect(await res.text()).not.toContain('role="alert"')
  })
})

describe('sign in with Apple on the web', () => {
  it('shows the button once its keys are set, signs the client secret, and takes the name from the first sign-in', async () => {
    const ec = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
    const pkcs8 = btoa(String.fromCharCode(...new Uint8Array((await crypto.subtle.exportKey('pkcs8', ec.privateKey)) as ArrayBuffer)))
    const apple = {
      ...env, APPLE_SERVICES_ID: 'za.org.sarza.guardian.web', APPLE_TEAM_ID: 'TEAM123', APPLE_KEY_ID: 'KEY123',
      APPLE_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----\n${pkcs8}\n-----END PRIVATE KEY-----`,
    }
    const ctx = createExecutionContext()
    const login = await worker.fetch(new Request(`${BASE}/login`), apple, ctx)
    expect(await login.text()).toContain('href="/auth/apple"')

    const s = await begin('apple', apple)
    expect(new URL(s.location).searchParams.get('response_mode')).toBe('form_post')
    fake.next(await fake.idToken('apple', { sub: 'a-1', email: 'relay@privaterelay.appleid.com', email_verified: 'true', nonce: s.nonce }))
    const body = new URLSearchParams({ code: 'apple-code', state: s.state, user: JSON.stringify({ name: { firstName: 'Lwazi', lastName: 'Ndlovu' } }) })
    const res = await worker.fetch(new Request(`${BASE}/auth/apple/callback`, {
      method: 'POST', body, headers: { cookie: s.cookie, 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual',
    }), apple, ctx)
    await waitOnExecutionContext(ctx)
    expect(res.headers.get('location')).toBe('/profile')
    const secret = fake.tokenRequests.at(-1)!.get('client_secret')!
    const [head, claims] = secret.split('.').slice(0, 2).map((p) => JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/'))))
    expect(head).toMatchObject({ alg: 'ES256', kid: 'KEY123' })
    expect(claims).toMatchObject({ iss: 'TEAM123', sub: 'za.org.sarza.guardian.web', aud: 'https://appleid.apple.com' })
    const user = (await getUserByTokenHash(env.DB, await hashToken(sessionFrom(res)!)))!
    expect(user).toMatchObject({ name: 'Lwazi Ndlovu', apple_sub: 'a-1', role: 'explorer' })
  })
})

describe('logout', () => {
  it('clears the cookie and revokes the token, for operators and explorers alike', async () => {
    for (const p of [await makeOperator(), await makeExplorer()]) {
      const res = await exports.default.fetch(`${BASE}/logout`, { method: 'POST', headers: { cookie: cookieFor(p.token) }, redirect: 'manual' })
      expect(res.headers.get('location')).toBe('/login')
      expect(res.headers.get('set-cookie')).toMatch(/beacon=;|Max-Age=0/)
      const again = await exports.default.fetch(`${BASE}/login`, { headers: { cookie: cookieFor(p.token) }, redirect: 'manual' })
      expect(again.status).toBe(200)
    }
  })
})
