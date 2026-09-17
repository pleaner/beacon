import { env, exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { getUserByTokenHash } from '../src/lib/db'
import { hashToken } from '../src/lib/auth'
import { cookieFor, makeExplorer, makeOperator } from './helpers'

const BASE = 'https://beacon.test'

function form(fields: Record<string, string | File>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  return fd
}

describe('GET /profile', () => {
  it('renders an empty form for anonymous', async () => {
    const res = await exports.default.fetch(`${BASE}/profile`)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('name="name"')
    expect(html).toContain('name="consent_contact"')
  })

  it('renders a filled form for an explorer and 403 for an operator', async () => {
    const e = await makeExplorer({ name: 'Naledi' })
    let res = await exports.default.fetch(`${BASE}/profile`, { headers: { cookie: cookieFor(e.token) } })
    expect(await res.text()).toContain('value="Naledi"')
    const o = await makeOperator()
    res = await exports.default.fetch(`${BASE}/profile`, { headers: { cookie: cookieFor(o.token) } })
    expect(res.status).toBe(403)
  })
})

describe('POST /api/profile', () => {
  it('creates an explorer, sets the cookie, stores the photo', async () => {
    const photo = new File([new Uint8Array([1, 2, 3])], 'me.jpg', { type: 'image/jpeg' })
    const res = await exports.default.fetch(`${BASE}/api/profile`, {
      method: 'POST',
      body: form({ name: 'Sipho', phone: '+27821234567', emergency_name: 'Mom', emergency_phone: '+27829999999', consent_contact: 'on', photo }),
      redirect: 'manual',
    })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/?welcome=1')
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('beacon=')
    expect(cookie).toContain('HttpOnly')
    const token = cookie.match(/beacon=([^;]+)/)![1]
    const user = await getUserByTokenHash(env.DB, await hashToken(token))
    expect(user?.name).toBe('Sipho')
    expect(user?.role).toBe('explorer')
    expect(user?.consent_contact).toBe(1)
    expect(user?.photo_key).toMatch(new RegExp(`^users/${user!.id}/.+\\.jpg$`))
    const obj = await env.PHOTOS.get(user!.photo_key!)
    expect(obj?.httpMetadata?.contentType).toBe('image/jpeg')
  })

  it('accepts json and answers json', async () => {
    const res = await exports.default.fetch(`${BASE}/api/profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Lerato', phone: '0821112222' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json<{ id: string }>()
    expect(body.id).toBeTruthy()
    expect(res.headers.get('set-cookie')).toContain('beacon=')
  })

  it('rejects a missing name or phone', async () => {
    const res = await exports.default.fetch(`${BASE}/api/profile`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'X' }),
    })
    expect(res.status).toBe(400)
    expect((await res.json<{ error: string }>()).error).toContain('phone')
  })

  it('rejects an oversized photo but still signs in the new explorer', async () => {
    const photo = new File([new Uint8Array(9 * 1024 * 1024)], 'me.jpg', { type: 'image/jpeg' })
    const res = await exports.default.fetch(`${BASE}/api/profile`, {
      method: 'POST',
      body: form({ name: 'Big', phone: '+27821111111', photo }),
    })
    expect(res.status).toBe(400)
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('beacon=')
    const token = cookie.match(/beacon=([^;]+)/)![1]
    const user = await getUserByTokenHash(env.DB, await hashToken(token))
    expect(user?.name).toBe('Big')
    expect(user?.photo_key).toBeNull()
  })

  it('rejects a non-image photo and writes nothing to R2', async () => {
    const photo = new File([new Uint8Array([1, 2, 3])], 'x.html', { type: 'text/html' })
    const res = await exports.default.fetch(`${BASE}/api/profile`, {
      method: 'POST',
      body: form({ name: 'Hax', phone: '+27822222222', photo }),
    })
    expect(res.status).toBe(400)
    const list = await env.PHOTOS.list()
    expect(list.objects.length).toBe(0)
  })

  it('updates an existing explorer without touching the cookie', async () => {
    const e = await makeExplorer({ name: 'Old' })
    const res = await exports.default.fetch(`${BASE}/api/profile`, {
      method: 'POST',
      headers: { cookie: cookieFor(e.token) },
      body: form({ name: 'New', phone: '+27820000000' }),
      redirect: 'manual',
    })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/profile?saved=1')
    expect(res.headers.get('set-cookie')).toBeNull()
    expect((await getUserByTokenHash(env.DB, await hashToken(e.token)))?.name).toBe('New')
  })
})

describe('GET /photos/*', () => {
  it('serves own photo, hides others, lets operators see all', async () => {
    const a = await makeExplorer()
    const b = await makeExplorer()
    const o = await makeOperator()
    const key = `users/${a.user.id}/x.jpg`
    await env.PHOTOS.put(key, new Uint8Array([9]), { httpMetadata: { contentType: 'image/jpeg' } })
    let res = await exports.default.fetch(`${BASE}/photos/${key}`, { headers: { cookie: cookieFor(a.token) } })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    res = await exports.default.fetch(`${BASE}/photos/${key}`, { headers: { cookie: cookieFor(b.token) } })
    expect(res.status).toBe(403)
    res = await exports.default.fetch(`${BASE}/photos/${key}`, { headers: { cookie: cookieFor(o.token) } })
    expect(res.status).toBe(200)
    res = await exports.default.fetch(`${BASE}/photos/users/${a.user.id}/missing.jpg`, { headers: { cookie: cookieFor(a.token) } })
    expect(res.status).toBe(404)
  })

  it('redirects anonymous to /profile', async () => {
    const res = await exports.default.fetch(`${BASE}/photos/users/x/y.jpg`, { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/profile')
  })
})
