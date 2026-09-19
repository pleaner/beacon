import { env, exports } from 'cloudflare:workers'
import { afterEach, describe, expect, it } from 'vitest'
import { addSubscription, getChecklist, getSetting, getUserByEmail, getUserById } from '../src/lib/db'
import { setSenderForTests } from '../src/lib/push'
import { cookieFor, fakeSender, makeAdmin, makeExplorer, makeOperator } from './helpers'

const BASE = 'https://beacon.test'
const form = (cookie: string, fields: Record<string, string>) => ({
  method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields), redirect: 'manual' as const,
})

afterEach(() => setSenderForTests(null))

describe('access', () => {
  it('admin only', async () => {
    const o = await makeOperator()
    let res = await exports.default.fetch(`${BASE}/admin`, { headers: { cookie: cookieFor(o.token) } })
    expect(res.status).toBe(403)
    res = await exports.default.fetch(`${BASE}/admin`, { redirect: 'manual' })
    expect(res.headers.get('location')).toBe('/login')
    const a = await makeAdmin()
    res = await exports.default.fetch(`${BASE}/admin`, { headers: { cookie: cookieFor(a.token) } })
    expect(res.status).toBe(200)
  })
})

describe('users tab', () => {
  it('lists users and adds an operator', async () => {
    const a = await makeAdmin()
    await makeExplorer({ name: 'Listed Explorer' })
    let html = await (await exports.default.fetch(`${BASE}/admin?tab=users`, { headers: { cookie: cookieFor(a.token) } })).text()
    expect(html).toContain('Listed Explorer')
    const res = await exports.default.fetch(`${BASE}/admin/users`, form(cookieFor(a.token), {
      name: 'New Op', email: 'newop@sarza.test', phone: '+27820001111', organisation: 'SARZA', role: 'operator',
    }))
    expect(res.status).toBe(303)
    const u = await getUserByEmail(env.DB, 'newop@sarza.test')
    expect(u?.role).toBe('operator')
    expect(u?.organisation).toBe('SARZA')
    expect(u?.token_hash).toBeNull()
  })

  it('searches across name, email and phone, and links each row to the profile', async () => {
    const a = await makeAdmin()
    const e = await makeExplorer({ name: 'Thandi Mokoena', email: 'thandi@example.test', phone: '+27820007777' })
    await makeExplorer({ name: 'Someone Else', email: 'else@example.test', phone: '+27820001234' })
    const get = async (q: string) =>
      (await exports.default.fetch(`${BASE}/admin?tab=users&q=${encodeURIComponent(q)}`, { headers: { cookie: cookieFor(a.token) } })).text()
    for (const q of ['thandi mok', 'THANDI@EXAMPLE', '820007777']) {
      const html = await get(q)
      expect(html).toContain(`/admin/users/${e.user.id}`)
      expect(html).not.toContain('Someone Else')
    }
  })

  it('opens a user profile', async () => {
    const a = await makeAdmin()
    const e = await makeExplorer({ name: 'Thandi Mokoena', emergency_name: 'Sipho', emergency_phone: '+27820009999' })
    const res = await exports.default.fetch(`${BASE}/admin/users/${e.user.id}`, { headers: { cookie: cookieFor(a.token) } })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Thandi Mokoena')
    expect(html).toContain('Sipho')
    expect(await (await exports.default.fetch(`${BASE}/admin/users/nope`, { headers: { cookie: cookieFor(a.token) } })).status).toBe(404)
  })

  it('requires every field for a new operator', async () => {
    const a = await makeAdmin()
    const res = await exports.default.fetch(`${BASE}/admin/users`, form(cookieFor(a.token), { name: 'X', email: 'x@sarza.test', role: 'operator' }))
    expect(res.status).toBe(400)
  })

  it('changes role and organisation, deletes, but not self', async () => {
    const a = await makeAdmin()
    const o = await makeOperator()
    let res = await exports.default.fetch(`${BASE}/admin/users/${o.user.id}`, form(cookieFor(a.token), { role: 'admin', organisation: 'WSAR' }))
    expect(res.status).toBe(303)
    const u = await getUserById(env.DB, o.user.id)
    expect(u?.role).toBe('admin')
    expect(u?.organisation).toBe('WSAR')
    res = await exports.default.fetch(`${BASE}/admin/users/${o.user.id}/delete`, form(cookieFor(a.token), {}))
    expect(res.status).toBe(303)
    expect(await getUserById(env.DB, o.user.id)).toBeNull()
    res = await exports.default.fetch(`${BASE}/admin/users/${a.user.id}/delete`, form(cookieFor(a.token), {}))
    expect(res.status).toBe(400)
    expect(await getUserById(env.DB, a.user.id)).not.toBeNull()
  })

  it('requires organisation when promoting to operator or admin', async () => {
    const a = await makeAdmin()
    const o = await makeOperator()
    const res = await exports.default.fetch(`${BASE}/admin/users/${o.user.id}`, form(cookieFor(a.token), { role: 'operator', organisation: '' }))
    expect(res.status).toBe(400)
    expect((await getUserById(env.DB, o.user.id))?.role).toBe('operator')
  })

  it('refuses to let an admin change their own role', async () => {
    const a = await makeAdmin()
    const res = await exports.default.fetch(`${BASE}/admin/users/${a.user.id}`, form(cookieFor(a.token), { role: 'explorer', organisation: 'SARZA' }))
    expect(res.status).toBe(400)
    expect((await getUserById(env.DB, a.user.id))?.role).toBe('admin')
  })

  it('refuses to add an operator whose email already belongs to an operator', async () => {
    const a = await makeAdmin()
    const o = await makeOperator({ email: 'dup@sarza.test' })
    const res = await exports.default.fetch(`${BASE}/admin/users`, form(cookieFor(a.token), {
      name: 'Second Op', email: 'dup@sarza.test', phone: '+27820002222', organisation: 'SARZA', role: 'operator',
    }))
    expect(res.status).toBe(400)
    const rows = await env.DB.prepare('SELECT COUNT(*) AS c FROM users WHERE email = ?').bind('dup@sarza.test').first<{ c: number }>()
    expect(rows?.c).toBe(1)
    expect((await getUserByEmail(env.DB, 'dup@sarza.test'))?.id).toBe(o.user.id)
  })
})

describe('checklists tab', () => {
  it('shows and saves items per activity', async () => {
    const a = await makeAdmin()
    let html = await (await exports.default.fetch(`${BASE}/admin?tab=checklists&activity=climb`, { headers: { cookie: cookieFor(a.token) } })).text()
    expect(html).toContain('Rack and rope checked')
    const res = await exports.default.fetch(`${BASE}/admin/checklists`, form(cookieFor(a.token), { activity: 'climb', items_text: 'Helmet\n\nRope\n' }))
    expect(res.headers.get('location')).toBe('/admin?tab=checklists&activity=climb&saved=1')
    expect(await getChecklist(env.DB, 'climb')).toEqual(['Helmet', 'Rope'])
  })
})

describe('broadcast tab', () => {
  it('pushes every explorer and reports the count', async () => {
    const a = await makeAdmin()
    const e1 = await makeExplorer()
    const e2 = await makeExplorer()
    const o = await makeOperator()
    await addSubscription(env.DB, e1.user.id, { endpoint: 'https://push.test/1', p256dh: 'k', auth: 'a' })
    await addSubscription(env.DB, e2.user.id, { endpoint: 'https://push.test/2', p256dh: 'k', auth: 'a' })
    await addSubscription(env.DB, o.user.id, { endpoint: 'https://push.test/o', p256dh: 'k', auth: 'a' })
    const f = fakeSender()
    setSenderForTests(f.send)
    const res = await exports.default.fetch(`${BASE}/admin/broadcast`, form(cookieFor(a.token), { title: 'Berg wind today', body: 'Fire danger extreme. Reconsider.' }))
    expect(res.headers.get('location')).toBe('/admin?tab=broadcast&sent=2')
    expect(f.sent.map((s) => s.endpoint).sort()).toEqual(['https://push.test/1', 'https://push.test/2'])
    expect(f.sent[0].payload.tag).toBe('broadcast')
  })
})

describe('settings tab', () => {
  it('saves grace_minutes within bounds', async () => {
    const a = await makeAdmin()
    let res = await exports.default.fetch(`${BASE}/admin/settings`, form(cookieFor(a.token), { grace_minutes: '45' }))
    expect(res.headers.get('location')).toBe('/admin?tab=settings&saved=1')
    expect(await getSetting(env.DB, 'grace_minutes', '0')).toBe('45')
    res = await exports.default.fetch(`${BASE}/admin/settings`, form(cookieFor(a.token), { grace_minutes: '0' }))
    expect(res.status).toBe(400)
    res = await exports.default.fetch(`${BASE}/admin/settings`, form(cookieFor(a.token), { grace_minutes: 'abc' }))
    expect(res.status).toBe(400)
    expect(await getSetting(env.DB, 'grace_minutes', '0')).toBe('45')
  })
})
