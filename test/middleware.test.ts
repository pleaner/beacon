import { env } from 'cloudflare:workers'
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import type { AppEnv } from '../src/env'
import { done, loadUser, num, readBody, requireApiRole, requireRole, str, type Body } from '../src/lib/middleware'
import { cookieFor, makeExplorer, makeOperator } from './helpers'

function testApp() {
  const app = new Hono<AppEnv>()
  app.use(loadUser)
  app.get('/e', requireRole('explorer'), (c) => c.text(`hi ${c.var.user!.name}`))
  app.get('/o', requireRole('operator', 'admin'), (c) => c.text('board'))
  app.get('/api/e', requireApiRole('explorer'), (c) => c.json({ ok: true }))
  app.post('/echo', async (c) => {
    const b = await readBody(c)
    return done(c, { name: str(b, 'name') }, '/after')
  })
  return app
}

describe('requireRole', () => {
  it('redirects anonymous explorers to /profile and operators to /login', async () => {
    const app = testApp()
    let res = await app.request('/e', {}, env)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/profile')
    res = await app.request('/o', {}, env)
    expect(res.headers.get('location')).toBe('/login')
  })

  it('lets the right role in and 403s the wrong one', async () => {
    const app = testApp()
    const e = await makeExplorer({ name: 'Zola' })
    const o = await makeOperator()
    let res = await app.request('/e', { headers: { cookie: cookieFor(e.token) } }, env)
    expect(await res.text()).toBe('hi Zola')
    res = await app.request('/o', { headers: { cookie: cookieFor(e.token) } }, env)
    expect(res.status).toBe(403)
    res = await app.request('/o', { headers: { cookie: cookieFor(o.token) } }, env)
    expect(res.status).toBe(200)
  })

  it('ignores an unknown cookie', async () => {
    const app = testApp()
    const res = await app.request('/e', { headers: { cookie: 'beacon=garbage' } }, env)
    expect(res.status).toBe(302)
  })
})

describe('requireApiRole', () => {
  it('returns 401 json for anonymous and 403 for wrong role', async () => {
    const app = testApp()
    let res = await app.request('/api/e', {}, env)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Not signed in' })
    const o = await makeOperator()
    res = await app.request('/api/e', { headers: { cookie: cookieFor(o.token) } }, env)
    expect(res.status).toBe(403)
  })
})

describe('readBody and done', () => {
  it('reads json and answers json', async () => {
    const app = testApp()
    const res = await app.request('/echo', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '  Ann ' }),
    }, env)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ name: 'Ann' })
  })

  it('reads a form and redirects', async () => {
    const app = testApp()
    const fd = new URLSearchParams({ name: '' })
    const res = await app.request('/echo', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: fd,
    }, env)
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/after')
  })
})

describe('num', () => {
  it('reads a JSON number or a numeric string, and rejects everything else', () => {
    const body = { n: 12.5, s: '7', bad: 'abc', nan: NaN } as unknown as Body
    expect(num(body, 'n')).toBe(12.5)
    expect(num(body, 's')).toBe(7)
    expect(num(body, 'bad')).toBeNull()
    expect(num(body, 'missing')).toBeNull()
    expect(num(body, 'nan')).toBeNull()
  })
})
