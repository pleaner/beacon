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

// Signing in with Google or Apple creates the account with no phone; the profile form fills in the rest.
async function newcomer() {
  const e = await makeExplorer({ name: 'New', phone: '', email: null })
  return { ...e, cookie: cookieFor(e.token) }
}

describe('GET /profile', () => {
  it('sends anyone signed out to sign in', async () => {
    const res = await exports.default.fetch(`${BASE}/profile`, { redirect: 'manual' })
    expect(res.headers.get('location')).toBe('/login')
  })

  it('renders the form for a newcomer', async () => {
    const { cookie } = await newcomer()
    const html = await (await exports.default.fetch(`${BASE}/profile`, { headers: { cookie } })).text()
    expect(html).toContain('name="name"')
    expect(html).toContain('name="consent_contact"')
    expect(html).toContain('name="allergies"')
    expect(html).toContain('name="blood_type"')
    expect(html).toContain('name="medical_aid_number"')
    expect(html).toContain('Finish')
  })

  it('picks the browser language for a new profile', async () => {
    const { cookie } = await newcomer()
    const html = await (await exports.default.fetch(`${BASE}/profile`, { headers: { cookie, 'accept-language': 'af-ZA, de-DE;q=0.8, en;q=0.5' } })).text()
    expect(html).toMatch(/<option value="de" selected/)
    expect(html).not.toContain('Prefer not to say')
  })

  it('renders a filled form for an explorer, and for an operator too', async () => {
    const e = await makeExplorer({ name: 'Naledi' })
    let res = await exports.default.fetch(`${BASE}/profile`, { headers: { cookie: cookieFor(e.token) } })
    expect(await res.text()).toContain('value="Naledi"')
    const o = await makeOperator()
    res = await exports.default.fetch(`${BASE}/profile`, { headers: { cookie: cookieFor(o.token) } })
    expect(res.status).toBe(200)
  })
})

describe('POST /api/profile', () => {
  const asJson = (cookie: string, body: unknown) => ({ method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) })

  it('refuses anyone signed out: no account is made here any more', async () => {
    let res = await exports.default.fetch(`${BASE}/api/profile`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'X', phone: '0821112222', email: 'x@example.com' }) })
    expect(res.status).toBe(401)
    res = await exports.default.fetch(`${BASE}/api/profile`, { method: 'POST', body: form({ name: 'X' }), redirect: 'manual' })
    expect(res.headers.get('location')).toBe('/login')
  })

  it("fills in a newcomer's profile, stores the photo, and goes on to the welcome tips", async () => {
    const n = await newcomer()
    const photo = new File([new Uint8Array([1, 2, 3])], 'me.jpg', { type: 'image/jpeg' })
    const res = await exports.default.fetch(`${BASE}/api/profile`, {
      method: 'POST', headers: { cookie: n.cookie },
      body: form({ name: 'Sipho', phone: '+27821234567', email: 'sipho@example.com', emergency_name: 'Mom', emergency_phone: '+27829999999', consent_contact: 'on', photo }),
      redirect: 'manual',
    })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/?welcome=1')
    expect(res.headers.get('set-cookie')).toBeNull()
    const user = (await getUserByTokenHash(env.DB, await hashToken(n.token)))!
    expect(user).toMatchObject({ id: n.user.id, name: 'Sipho', role: 'explorer', consent_contact: 1, phone: '+27821234567' })
    expect(user.photo_key).toMatch(new RegExp(`^users/${user.id}/.+\\.jpg$`))
    expect((await env.PHOTOS.get(user.photo_key!))?.httpMetadata?.contentType).toBe('image/jpeg')
  })

  it('accepts json and answers json', async () => {
    const n = await newcomer()
    const res = await exports.default.fetch(`${BASE}/api/profile`, asJson(n.cookie, { name: 'Lerato', phone: '0821112222', email: 'lerato@example.com' }))
    expect(res.status).toBe(200)
    expect((await res.json<{ id: string }>()).id).toBe(n.user.id)
  })

  it('rejects a missing email', async () => {
    const n = await newcomer()
    const res = await exports.default.fetch(`${BASE}/api/profile`, asJson(n.cookie, { name: 'X', phone: '0821112222' }))
    expect(res.status).toBe(400)
    expect((await res.json<{ error: string }>()).error).toContain('email')
  })

  it('stores the profile details and normalises phone numbers', async () => {
    const n = await newcomer()
    const res = await exports.default.fetch(`${BASE}/api/profile`, {
      method: 'POST', headers: { cookie: n.cookie },
      body: form({
        name: 'Thandi Mokoena', phone: '082 555 0147', phone_country: '27', email: 'Thandi@Example.com',
        birthday: '1992-03-12', gender: 'Female', language: 'de', height_cm: '168', weight_kg: '61', shoe_size: '6.5',
        emergency_name: 'Lindiwe', emergency_relation: 'Brother or sister', emergency_phone: '7700 900123', emergency_phone_country: '44',
        allergies: 'Bee stings', conditions: 'Asthma', medication: 'Ventolin, carries an EpiPen', blood_type: 'O-',
        medical_aid: 'Discovery Health', medical_aid_plan: 'Classic Saver', medical_aid_number: '123456789 02',
      }),
      redirect: 'manual',
    })
    expect(res.status).toBe(303)
    const u = (await getUserByTokenHash(env.DB, await hashToken(n.token)))!
    expect(u.phone).toBe('+27825550147')
    expect(u.email).toBe('thandi@example.com')
    expect(u.emergency_phone).toBe('+447700900123')
    expect(u).toMatchObject({ birthday: '1992-03-12', gender: 'Female', language: 'de', height_cm: 168, weight_kg: 61, shoe_size: '6.5', emergency_relation: 'Brother or sister' })
    expect(u).toMatchObject({ allergies: 'Bee stings', conditions: 'Asthma', medication: 'Ventolin, carries an EpiPen', blood_type: 'O-' })
    expect(u).toMatchObject({ medical_aid: 'Discovery Health', medical_aid_plan: 'Classic Saver', medical_aid_number: '123456789 02' })
  })

  it('drops out-of-range or unknown profile details instead of failing', async () => {
    const n = await newcomer()
    const res = await exports.default.fetch(`${BASE}/api/profile`, asJson(n.cookie, {
      name: 'Q', phone: '+27820000001', email: 'q@example.com', height_cm: 900, gender: 'robot', birthday: '2999-01-01', language: 'xx', blood_type: 'Z+',
    }))
    expect(res.status).toBe(200)
    const u = await env.DB.prepare('SELECT height_cm, gender, birthday, language, blood_type FROM users WHERE id = ?').bind(n.user.id).first()
    expect(u).toEqual({ height_cm: null, gender: null, birthday: null, language: null, blood_type: null })
  })

  it('keeps what was typed when a save fails', async () => {
    const n = await newcomer()
    const res = await exports.default.fetch(`${BASE}/api/profile`, {
      method: 'POST', headers: { cookie: n.cookie }, body: form({ name: 'Nomsa', phone: '0821234567', email: 'not-an-email', height_cm: '160' }),
    })
    expect(res.status).toBe(400)
    const html = await res.text()
    expect(html).toContain('value="Nomsa"')
    expect(html).toContain('value="821234567"')
    expect(html).toContain('value="160"')
    expect(html).toContain('That email address looks wrong')
  })

  it('leaves profile details alone when a client does not send them', async () => {
    const e = await makeExplorer({ height_cm: 180, gender: 'Male' })
    const res = await exports.default.fetch(`${BASE}/api/profile`, asJson(cookieFor(e.token), { name: 'Renamed', phone: '+27820000000', email: 'r@example.com' }))
    expect(res.status).toBe(200)
    const u = (await getUserByTokenHash(env.DB, await hashToken(e.token)))!
    expect(u).toMatchObject({ name: 'Renamed', height_cm: 180, gender: 'Male' })
  })

  it('rejects a missing name or phone', async () => {
    const n = await newcomer()
    const res = await exports.default.fetch(`${BASE}/api/profile`, asJson(n.cookie, { name: 'X' }))
    expect(res.status).toBe(400)
    expect((await res.json<{ error: string }>()).error).toContain('phone')
  })

  it('rejects an oversized photo and saves nothing', async () => {
    const n = await newcomer()
    const photo = new File([new Uint8Array(9 * 1024 * 1024)], 'me.jpg', { type: 'image/jpeg' })
    const res = await exports.default.fetch(`${BASE}/api/profile`, {
      method: 'POST', headers: { cookie: n.cookie }, body: form({ name: 'Big', phone: '+27821111111', email: 'big@example.com', photo }),
    })
    expect(res.status).toBe(400)
    const user = (await getUserByTokenHash(env.DB, await hashToken(n.token)))!
    expect(user.photo_key).toBeNull()
    expect(user.phone).toBe('')
  })

  it('rejects a non-image photo and writes nothing to R2', async () => {
    const n = await newcomer()
    const photo = new File([new Uint8Array([1, 2, 3])], 'x.html', { type: 'text/html' })
    const res = await exports.default.fetch(`${BASE}/api/profile`, {
      method: 'POST', headers: { cookie: n.cookie }, body: form({ name: 'Hax', phone: '+27822222222', email: 'hax@example.com', photo }),
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
      body: form({ name: 'New', phone: '+27820000000', email: 'new@example.com' }),
      redirect: 'manual',
    })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/?saved=1')
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

  it('sends anyone signed out to sign in', async () => {
    const res = await exports.default.fetch(`${BASE}/photos/users/x/y.jpg`, { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/login')
  })
})
