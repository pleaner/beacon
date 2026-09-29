import { env, exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { insertPosition } from '../src/lib/db'
import { getTrip, markOverdue, requestHelp, setStartPlace, startTrip, type NewTrip } from '../src/lib/trips'
import { ago } from '../src/views/board'
import { cookieFor, makeAdmin, makeExplorer, makeOperator } from './helpers'

const BASE = 'https://beacon.test'
const base: NewTrip = {
  activity: 'run', area: 'table_mountain', route_text: 'Contour path', companions_text: 'alone', wearing_text: 'yellow shirt',
  photo_key: null, shoe_photo_key: null, start_lat: -33.96, start_lng: 18.41, start_accuracy: 5, return_by: 0, checklist: ['Water'], battery_at_start: 88,
}

describe('ago', () => {
  it('formats durations', () => {
    expect(ago(1000, 1000 + 30_000)).toBe('just now')
    expect(ago(1000, 1000 + 5 * 60_000)).toBe('5 min ago')
    expect(ago(1000, 1000 + 125 * 60_000)).toBe('2 h 5 min ago')
    expect(ago(1000, 1000 + 3 * 24 * 3_600_000)).toBe('3 days ago')
  })
})

describe('GET /board', () => {
  it('requires an operator', async () => {
    let res = await exports.default.fetch(`${BASE}/board`, { redirect: 'manual' })
    expect(res.headers.get('location')).toBe('/login')
    const e = await makeExplorer()
    res = await exports.default.fetch(`${BASE}/board`, { headers: { cookie: cookieFor(e.token) } })
    expect(res.status).toBe(403)
  })

  it('lists open trips in priority order with last position age and battery', async () => {
    const o = await makeOperator()
    const a = await makeExplorer({ name: 'Ayanda' })
    const b = await makeExplorer({ name: 'Bongani' })
    const ta = await startTrip(env.DB, a.user.id, { ...base, return_by: Date.now() + 3_600_000 }, Date.now())
    const tb = await startTrip(env.DB, b.user.id, { ...base, return_by: Date.now() - 1000 }, Date.now() - 2000)
    await markOverdue(env.DB, tb.id, Date.now())
    await insertPosition(env.DB, { trip_id: ta.id, lat: -33.9, lng: 18.4, accuracy: 4, battery: 41, at: Date.now() - 7 * 60_000 })
    const html = await (await exports.default.fetch(`${BASE}/board`, { headers: { cookie: cookieFor(o.token) } })).text()
    expect(html.indexOf('Bongani')).toBeLessThan(html.indexOf('Ayanda'))
    expect(html).toContain('7 min ago')
    expect(html).toContain('41%')
    expect(html).toContain('data-refresh="30"')
    expect(html).toContain(`href="/board/trips/${ta.id}"`)
    expect(html).toContain('class="pill overdue"')
  })

  it('filters by status and searches by name or place', async () => {
    const o = await makeOperator()
    const a = await makeExplorer({ name: 'Cederberg Person' })
    const ta = await startTrip(env.DB, a.user.id, { ...base, return_by: Date.now() + 1000 }, Date.now())
    await setStartPlace(env.DB, ta.id, 'Algeria campsite, Cederberg')
    const b = await makeExplorer({ name: 'Table Person' })
    const tb = await startTrip(env.DB, b.user.id, { ...base, return_by: Date.now() + 1000 }, Date.now())
    await requestHelp(env.DB, tb.id, Date.now())
    const get = async (qs: string) => (await exports.default.fetch(`${BASE}/board${qs}`, { headers: { cookie: cookieFor(o.token) } })).text()
    let html = await get('?status=help')
    expect(html).toContain('Table Person')
    expect(html).not.toContain('Cederberg Person')
    html = await get('?q=algeria')
    expect(html).toContain('Cederberg Person')
    expect(html).toContain('Hike from Algeria campsite, Cederberg'.replace('Hike', 'Trail run'))
    expect(html).not.toContain('Table Person')
    html = await get('')
    expect(html).toContain('Help 1')
    expect(html).toContain('<span class="count-badge">1</span>')
  })
})

describe('GET /board/trips/:id', () => {
  it('shows profile, trip, positions with map links, and a close button', async () => {
    const o = await makeAdmin()
    const e = await makeExplorer({ name: 'Dineo', emergency_phone: '+27831112222', description: 'tall, red hair' })
    const t = await startTrip(env.DB, e.user.id, { ...base, return_by: Date.now() + 1000 }, Date.now())
    await insertPosition(env.DB, { trip_id: t.id, lat: -33.9123, lng: 18.4567, accuracy: 4, battery: 41, at: Date.now() - 60_000 })
    await insertPosition(env.DB, { trip_id: t.id, lat: -33.95, lng: 18.43, accuracy: 9, battery: 50, altitude: 1062.6, at: Date.now() - 2 * 60 * 60_000 })
    const html = await (await exports.default.fetch(`${BASE}/board/trips/${t.id}`, { headers: { cookie: cookieFor(o.token) } })).text()
    expect(html).toContain('Dineo')
    expect(html).toContain('tel:+27831112222')
    expect(html).toContain('tall, red hair')
    expect(html).toContain('yellow shirt')
    expect(html).toContain('https://www.google.com/maps?q=-33.9123,18.4567')
    expect(html).toContain('Last position 1 min ago')
    expect(html).toContain('2 h 0 min ago · ±9 m · 1063 m up · 50% · arrived just now')
    expect(html).toContain(`action="/api/board/trips/${t.id}/close"`)
    expect(html).toContain('88%')
    expect(html).toContain('Water')
  })

  it('shows companions, the destination, profile facts and the emergency relationship', async () => {
    const o = await makeOperator()
    const e = await makeExplorer({
      name: 'Sipho Dlamini', emergency_name: 'Lindiwe', emergency_relation: 'Brother or sister', birthday: '1990-01-01',
      gender: 'Male', height_cm: 182, weight_kg: 74, shoe_size: '9', language: 'de',
      allergies: 'Penicillin', medication: 'Insulin', blood_type: 'AB+',
    })
    const t = await startTrip(env.DB, e.user.id, {
      ...base, activity: 'mtb', destination_text: 'Constantiaberg mast', return_by: Date.now() + 1000,
      companions: [{ name: 'Themba Nkosi', phone: '+27725550114' }, { name: 'Ayesha', phone: null }],
    }, Date.now())
    const html = await (await exports.default.fetch(`${BASE}/board/trips/${t.id}`, { headers: { cookie: cookieFor(o.token) } })).text()
    expect(html).toContain('Constantiaberg mast')
    expect(html).toContain('With them · 2')
    expect(html).toContain('tel:+27725550114')
    expect(html).toContain('No number given')
    expect(html).toContain('German')
    expect(html).toContain('182 cm')
    expect(html).toContain('UK 9')
    expect(html).toContain('(brother or sister)')
    expect(html).toContain('No bike photo')
    expect(html).toContain('<dt>Blood type</dt><dd>AB+</dd>')
    expect(html).toContain('<dt>Allergies</dt><dd>Penicillin</dd>')
    expect(html).toContain('<dt>Medication</dt><dd>Insulin</dd>')
    expect(html).not.toContain('<dt>Conditions</dt>')
  })

  it('404s for a missing trip', async () => {
    const o = await makeOperator()
    const res = await exports.default.fetch(`${BASE}/board/trips/nope`, { headers: { cookie: cookieFor(o.token) } })
    expect(res.status).toBe(404)
  })
})

describe('GET /board/trips/:id/brief', () => {
  it('refuses the signed-out and explorers', async () => {
    const e = await makeExplorer()
    const t = await startTrip(env.DB, e.user.id, { ...base, return_by: Date.now() + 1000 }, Date.now())
    let res = await exports.default.fetch(`${BASE}/board/trips/${t.id}/brief`, { redirect: 'manual' })
    expect(res.headers.get('location')).toBe('/login')
    res = await exports.default.fetch(`${BASE}/board/trips/${t.id}/brief`, { headers: { cookie: cookieFor(e.token) } })
    expect(res.status).toBe(403)
  })

  it('prints the trip facts and positions, linked from the trip view', async () => {
    const o = await makeOperator()
    const e = await makeExplorer({ name: 'Nomsa Brief', phone: '+27821234567', emergency_name: 'Pieter' })
    const t = await startTrip(env.DB, e.user.id, { ...base, photo_key: 'p/body.jpg', return_by: Date.now() + 1000 }, Date.now())
    await setStartPlace(env.DB, t.id, 'Kirstenbosch gate')
    await insertPosition(env.DB, { trip_id: t.id, lat: -33.9876, lng: 18.4321, accuracy: 7, battery: 33, altitude: 812.4, at: Date.now() - 60_000 })
    const get = (path: string) => exports.default.fetch(`${BASE}${path}`, { headers: { cookie: cookieFor(o.token) } }).then((r) => r.text())
    expect(await get(`/board/trips/${t.id}`)).toContain(`href="/board/trips/${t.id}/brief"`)
    const html = await get(`/board/trips/${t.id}/brief`)
    for (const s of ['Nomsa Brief', '+27 82 123 4567', 'Pieter', 'Trail run', 'Contour path', 'Kirstenbosch gate', '-33.96000, 18.41000',
      'yellow shirt', 'src="/photos/p/body.jpg"', '-33.98760, 18.43210', '812 m', '33%', 'onclick="window.print()"']) {
      expect(html).toContain(s)
    }
    expect(html).not.toContain('class="ops-bar"')
  })
})

describe('GET /board/trips/:id/gpx', () => {
  it('refuses the signed-out and explorers', async () => {
    const e = await makeExplorer()
    const t = await startTrip(env.DB, e.user.id, { ...base, return_by: Date.now() + 1000 }, Date.now())
    let res = await exports.default.fetch(`${BASE}/board/trips/${t.id}/gpx`, { redirect: 'manual' })
    expect(res.headers.get('location')).toBe('/login')
    res = await exports.default.fetch(`${BASE}/board/trips/${t.id}/gpx`, { headers: { cookie: cookieFor(e.token) } })
    expect(res.status).toBe(403)
  })

  it('downloads the start as a waypoint and positions as a track, oldest first, escaped', async () => {
    const o = await makeOperator()
    const e = await makeExplorer({ name: 'Tom & <Jerry>' })
    const t = await startTrip(env.DB, e.user.id, { ...base, return_by: Date.now() + 1000 }, Date.UTC(2026, 8, 20, 6, 0))
    await insertPosition(env.DB, { trip_id: t.id, lat: -33.95, lng: 18.42, accuracy: 5, battery: 80, altitude: 1062.5, at: Date.UTC(2026, 8, 20, 7, 0) })
    await insertPosition(env.DB, { trip_id: t.id, lat: -33.94, lng: 18.43, accuracy: 5, battery: 70, at: Date.UTC(2026, 8, 20, 8, 0) })
    const res = await exports.default.fetch(`${BASE}/board/trips/${t.id}/gpx`, { headers: { cookie: cookieFor(o.token) } })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/gpx+xml')
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename=".+\.gpx"$/)
    const gpx = await res.text()
    expect(gpx).toContain('<wpt lat="-33.96" lon="18.41"><time>2026-09-20T06:00:00.000Z</time>')
    expect(gpx).toContain('Tom &#38; &#60;Jerry&#62;')
    expect(gpx).not.toContain('<Jerry>')
    const a = '<trkpt lat="-33.95" lon="18.42"><ele>1062.5</ele><time>2026-09-20T07:00:00.000Z</time></trkpt>'
    const b = '<trkpt lat="-33.94" lon="18.43"><time>2026-09-20T08:00:00.000Z</time></trkpt>'
    expect(gpx.indexOf(a)).toBeGreaterThan(gpx.indexOf('<trkseg>'))
    expect(gpx.indexOf(b)).toBeGreaterThan(gpx.indexOf(a))
    const trip = await (await exports.default.fetch(`${BASE}/board/trips/${t.id}`, { headers: { cookie: cookieFor(o.token) } })).text()
    expect(trip).toContain(`href="/board/trips/${t.id}/gpx"`)
  })
})

describe('POST /api/board/trips/:id/close', () => {
  it('closes any open trip as operator_closed', async () => {
    const o = await makeOperator()
    const e = await makeExplorer()
    const t = await startTrip(env.DB, e.user.id, { ...base, return_by: Date.now() + 1000 }, Date.now())
    await requestHelp(env.DB, t.id, Date.now())
    let res = await exports.default.fetch(`${BASE}/api/board/trips/${t.id}/close`, { method: 'POST', headers: { cookie: cookieFor(o.token) }, redirect: 'manual' })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/board')
    expect((await getTrip(env.DB, t.id))!.closed_reason).toBe('operator_closed')
    res = await exports.default.fetch(`${BASE}/api/board/trips/${t.id}/close`, { method: 'POST', headers: { cookie: cookieFor(o.token), accept: 'application/json' } })
    expect(res.status).toBe(409)
    res = await exports.default.fetch(`${BASE}/api/board/trips/${t.id}/close`, { method: 'POST', headers: { cookie: cookieFor(e.token) } })
    expect(res.status).toBe(403)
  })
})

describe('admin changes a trip status', () => {
  const set = (id: string, cookie: string, status: string) =>
    exports.default.fetch(`${BASE}/api/admin/trips/${id}/status`, {
      method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ status }),
    })

  it('moves a trip through every state, with the timestamps each state expects', async () => {
    const a = cookieFor((await makeAdmin()).token)
    const e = await makeExplorer()
    const t = await startTrip(env.DB, e.user.id, { ...base, return_by: Date.now() + 3_600_000 }, Date.now())

    let res = await set(t.id, a, 'overdue')
    expect(res.headers.get('location')).toBe(`/board/trips/${t.id}?saved=1`)
    let now = (await getTrip(env.DB, t.id))!
    expect([now.status, now.prompted_at != null]).toEqual(['overdue', true])

    await set(t.id, a, 'help')
    now = (await getTrip(env.DB, t.id))!
    expect([now.status, now.help_alerted_at]).toEqual(['help', null])

    await set(t.id, a, 'closed')
    now = (await getTrip(env.DB, t.id))!
    expect([now.status, now.closed_reason, now.closed_at != null]).toEqual(['closed', 'operator_closed', true])

    await set(t.id, a, 'active')
    now = (await getTrip(env.DB, t.id))!
    expect([now.status, now.closed_at, now.closed_reason, now.prompted_at]).toEqual(['active', null, null, null])

    expect((await set(t.id, a, 'lost')).status).toBe(400)
  })

  it('will not reopen a trip while the explorer has another open one, and is for admins only', async () => {
    const a = cookieFor((await makeAdmin()).token)
    const o = cookieFor((await makeOperator()).token)
    const e = await makeExplorer()
    const old = await startTrip(env.DB, e.user.id, { ...base, return_by: Date.now() + 3_600_000 }, Date.now())
    await set(old.id, a, 'closed')
    await startTrip(env.DB, e.user.id, { ...base, return_by: Date.now() + 3_600_000 }, Date.now())

    const res = await set(old.id, a, 'active')
    expect(res.headers.get('location')).toContain(`/board/trips/${old.id}?error=`)
    expect((await getTrip(env.DB, old.id))!.status).toBe('closed')

    expect((await set(old.id, o, 'active')).status).toBe(403)
    const page = (cookie: string) => exports.default.fetch(`${BASE}/board/trips/${old.id}`, { headers: { cookie } }).then((r) => r.text())
    expect(await page(a)).toContain('Trip status')
    expect(await page(o)).not.toContain('Trip status')
  })
})
