import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import worker from '../src/index'
import { hashToken, signMagicLink } from '../src/lib/auth'
import { getUserByTokenHash } from '../src/lib/db'
import { lastMagicLinkForTests } from '../src/lib/email'
import { cookieFor, makeExplorer, makeOperator } from './helpers'

const BASE = 'https://beacon.test'
const form = (fields: Record<string, string>) => ({
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields), redirect: 'manual' as const,
})

describe('login flow', () => {
  it('renders the login form, and redirects a signed-in operator to the board', async () => {
    let res = await exports.default.fetch(`${BASE}/login`)
    expect(await res.text()).toContain('name="email"')
    const o = await makeOperator()
    res = await exports.default.fetch(`${BASE}/login`, { headers: { cookie: cookieFor(o.token) }, redirect: 'manual' })
    expect(res.headers.get('location')).toBe('/board')
  })

  it('emails a link for a known operator and the link signs them in', async () => {
    const o = await makeOperator({ email: 'ops@sarza.test' })
    let res = await exports.default.fetch(`${BASE}/auth/link`, form({ email: 'OPS@sarza.test' }))
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Check your email')
    const link = lastMagicLinkForTests()
    expect(link?.to).toBe('ops@sarza.test')
    expect(link?.url).toContain('/auth/verify?t=')
    res = await exports.default.fetch(link!.url, { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/board')
    const token = (res.headers.get('set-cookie') ?? '').match(/beacon=([^;]+)/)![1]
    expect((await getUserByTokenHash(env.DB, await hashToken(token)))?.id).toBe(o.user.id)
    expect(token).not.toBe(o.token)
  })

  it('says the same thing for an unknown email and sends nothing', async () => {
    const before = lastMagicLinkForTests()
    const res = await exports.default.fetch(`${BASE}/auth/link`, form({ email: 'nobody@sarza.test' }))
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Check your email')
    expect(lastMagicLinkForTests()).toBe(before)
  })

  it('does not send links to explorers', async () => {
    await makeExplorer({ email: 'hiker@sarza.test' })
    const before = lastMagicLinkForTests()
    await exports.default.fetch(`${BASE}/auth/link`, form({ email: 'hiker@sarza.test' }))
    expect(lastMagicLinkForTests()).toBe(before)
  })

  it('still returns the confirmation page when Resend errors', async () => {
    const o = await makeOperator({ email: 'flaky@sarza.test' })
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response('nope', { status: 500 })) as typeof fetch
    try {
      const testEnv = { ...env, RESEND_API_KEY: 'test-key' }
      const ctx = createExecutionContext()
      const res = await worker.fetch(new Request(`${BASE}/auth/link`, form({ email: o.user.email! })), testEnv, ctx)
      expect(res.status).toBe(200)
      expect(await res.text()).toContain('Check your email')
      await waitOnExecutionContext(ctx)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('rejects a bad link', async () => {
    const res = await exports.default.fetch(`${BASE}/auth/verify?t=nope`, { redirect: 'manual' })
    expect(res.status).toBe(400)
    expect(await res.text()).toContain('expired')
  })

  it('rejects a validly signed link for an explorer, and sets no cookie', async () => {
    const e = await makeExplorer()
    const token = await signMagicLink(env.SESSION_SECRET, e.user.id, Date.now() + 60_000)
    const res = await exports.default.fetch(`${BASE}/auth/verify?t=${token}`, { redirect: 'manual' })
    expect(res.status).toBe(400)
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('signs in from the pasted-link form (POST /auth/verify)', async () => {
    const o = await makeOperator({ email: 'paste@sarza.test' })
    await exports.default.fetch(`${BASE}/auth/link`, form({ email: 'paste@sarza.test' }))
    const link = lastMagicLinkForTests()!
    const res = await exports.default.fetch(`${BASE}/auth/verify`, form({ link: link.url }))
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/board')
    const token = (res.headers.get('set-cookie') ?? '').match(/beacon=([^;]+)/)![1]
    expect((await getUserByTokenHash(env.DB, await hashToken(token)))?.id).toBe(o.user.id)
  })

  it('rejects garbage pasted into the link form', async () => {
    const res = await exports.default.fetch(`${BASE}/auth/verify`, form({ link: 'not a link or token' }))
    expect(res.status).toBe(400)
  })

  it('logout clears the cookie', async () => {
    const o = await makeOperator()
    const res = await exports.default.fetch(`${BASE}/logout`, { method: 'POST', headers: { cookie: cookieFor(o.token) }, redirect: 'manual' })
    expect(res.headers.get('location')).toBe('/login')
    expect(res.headers.get('set-cookie')).toMatch(/beacon=;|Max-Age=0/)
  })

  it('logout revokes the token, so the old cookie no longer signs anyone in', async () => {
    const o = await makeOperator()
    await exports.default.fetch(`${BASE}/logout`, { method: 'POST', headers: { cookie: cookieFor(o.token) }, redirect: 'manual' })
    const res = await exports.default.fetch(`${BASE}/login`, { headers: { cookie: cookieFor(o.token) }, redirect: 'manual' })
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('name="email"')
  })
})
