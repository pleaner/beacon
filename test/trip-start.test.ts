import { env, exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { getOpenTrip, parseReturnBy, startTrip, type NewTrip } from '../src/lib/trips'
import { cookieFor, makeExplorer } from './helpers'

const BASE = 'https://beacon.test'
const json = (cookie: string, body: object) => ({
  method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body),
})

describe('parseReturnBy', () => {
  it('accepts epoch ms in the future', () => {
    expect(parseReturnBy(5000, 1000)).toBe(5000)
    expect(parseReturnBy(500, 1000)).toBeNull()
  })
  it('parses a datetime-local string as South African time', () => {
    // 2026-09-17T17:00 SAST is 15:00 UTC
    expect(parseReturnBy('2026-09-17T17:00', 0)).toBe(Date.UTC(2026, 8, 17, 15, 0))
    expect(parseReturnBy('garbage', 0)).toBeNull()
    expect(parseReturnBy(null, 0)).toBeNull()
  })
})

describe('GET /', () => {
  it('redirects anonymous to /profile', async () => {
    const res = await exports.default.fetch(`${BASE}/`, { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/profile')
  })

  it('shows plan button when no open trip', async () => {
    const e = await makeExplorer()
    const res = await exports.default.fetch(`${BASE}/`, { headers: { cookie: cookieFor(e.token) } })
    const html = await res.text()
    expect(html).toContain('Plan a trip')
    expect(html).toContain('href="/trip/new?activity=hike"')
  })

  it('redirects to /trip when a trip is open', async () => {
    const e = await makeExplorer()
    const t: NewTrip = {
      activity: 'hike', area: 'other', route_text: null, companions_text: null, wearing_text: null, photo_key: null,
      shoe_photo_key: null, start_lat: null, start_lng: null, start_accuracy: null, return_by: Date.now() + 3_600_000,
      checklist: [], battery_at_start: null,
    }
    await startTrip(env.DB, e.user.id, t, Date.now())
    const res = await exports.default.fetch(`${BASE}/`, { headers: { cookie: cookieFor(e.token) }, redirect: 'manual' })
    expect(res.headers.get('location')).toBe('/trip')
  })
})

describe('GET /trip/new', () => {
  it('renders the checklist for the activity and previous shoe photos', async () => {
    const e = await makeExplorer()
    await env.DB.prepare(
      "INSERT INTO trips (id,user_id,activity,area,start_at,return_by,status,closed_reason,shoe_photo_key,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    ).bind('old', e.user.id, 'hike', 'other', 1, 2, 'closed', 'safe', `users/${e.user.id}/shoe.jpg`, 1).run()
    const res = await exports.default.fetch(`${BASE}/trip/new?activity=paraglide`, { headers: { cookie: cookieFor(e.token) } })
    const html = await res.text()
    expect(html).toContain('Reserve repacked within 6 months')
    expect(html).toContain('name="return_by"')
    expect(html).toContain(`value="users/${e.user.id}/shoe.jpg"`)
    expect(html).toContain('name="start_lat"')
  })
})

describe('POST /api/trips', () => {
  it('starts a trip from json', async () => {
    const e = await makeExplorer()
    const return_by = Date.now() + 2 * 3_600_000
    const res = await exports.default.fetch(`${BASE}/api/trips`, json(cookieFor(e.token), {
      activity: 'hike', area: 'table_mountain', route_text: 'Platteklip', return_by, checklist: ['Water', 'Torch'],
      start_lat: -33.95, start_lng: 18.4, start_accuracy: 8, battery: 77,
    }))
    expect(res.status).toBe(200)
    const trip = await getOpenTrip(env.DB, e.user.id)
    expect(trip?.route_text).toBe('Platteklip')
    expect(trip?.return_by).toBe(return_by)
    expect(trip?.checklist_json).toBe('["Water","Torch"]')
    expect(trip?.battery_at_start).toBe(77)
    expect(trip?.start_lat).toBeCloseTo(-33.95)
  })

  it('starts a trip from a multipart form with a new shoe photo', async () => {
    const e = await makeExplorer()
    const fd = new FormData()
    fd.append('activity', 'mtb')
    fd.append('area', 'overberg')
    fd.append('return_by', '2099-01-01T10:00')
    fd.append('checklist', 'Helmet')
    fd.append('checklist', 'Water')
    fd.append('shoe_photo', new File([new Uint8Array([1])], 'sole.png', { type: 'image/png' }))
    const res = await exports.default.fetch(`${BASE}/api/trips`, { method: 'POST', headers: { cookie: cookieFor(e.token) }, body: fd, redirect: 'manual' })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/trip')
    const trip = await getOpenTrip(env.DB, e.user.id)
    expect(trip?.checklist_json).toBe('["Helmet","Water"]')
    expect(trip?.shoe_photo_key).toMatch(/\.png$/)
  })

  it('reuses a previous shoe photo key', async () => {
    const e = await makeExplorer()
    const res = await exports.default.fetch(`${BASE}/api/trips`, json(cookieFor(e.token), {
      activity: 'hike', area: 'other', return_by: Date.now() + 3_600_000, shoe_photo_key: `users/${e.user.id}/old.jpg`,
    }))
    expect(res.status).toBe(200)
    expect((await getOpenTrip(env.DB, e.user.id))?.shoe_photo_key).toBe(`users/${e.user.id}/old.jpg`)
  })

  it('rejects a bad activity, past return time, and a second open trip', async () => {
    const e = await makeExplorer()
    let res = await exports.default.fetch(`${BASE}/api/trips`, json(cookieFor(e.token), { activity: 'swim', area: 'other', return_by: Date.now() + 1000 }))
    expect(res.status).toBe(400)
    res = await exports.default.fetch(`${BASE}/api/trips`, json(cookieFor(e.token), { activity: 'hike', area: 'other', return_by: Date.now() - 1000 }))
    expect(res.status).toBe(400)
    res = await exports.default.fetch(`${BASE}/api/trips`, json(cookieFor(e.token), { activity: 'hike', area: 'other', return_by: Date.now() + 1000 }))
    expect(res.status).toBe(200)
    res = await exports.default.fetch(`${BASE}/api/trips`, json(cookieFor(e.token), { activity: 'hike', area: 'other', return_by: Date.now() + 1000 }))
    expect(res.status).toBe(409)
  })

  it('requires an explorer', async () => {
    const res = await exports.default.fetch(`${BASE}/api/trips`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(res.status).toBe(401)
  })

  it('rejects an unsupported shoe photo type before starting a trip', async () => {
    const e = await makeExplorer()
    const fd = new FormData()
    fd.append('activity', 'hike')
    fd.append('area', 'other')
    fd.append('return_by', '2099-01-01T10:00')
    fd.append('shoe_photo', new File([new Uint8Array([1])], 'sole.html', { type: 'text/html' }))
    const res = await exports.default.fetch(`${BASE}/api/trips`, { method: 'POST', headers: { cookie: cookieFor(e.token) }, body: fd })
    expect(res.status).toBe(400)
    expect(await getOpenTrip(env.DB, e.user.id)).toBeNull()
  })
})
