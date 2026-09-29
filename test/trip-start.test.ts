import { env, exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { getOpenTrip, getTrip, listCompanions, listPets, markBack, parseReturnBy, startTrip, tripLine, type NewTrip } from '../src/lib/trips'
import { setPlaceLookupForTests } from '../src/lib/places'
import { afterEach } from 'vitest'
import { cookieFor, makeAdmin, makeExplorer, makeOperator } from './helpers'

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
  it('welcomes an anonymous visitor instead of dropping them in the profile form', async () => {
    const res = await exports.default.fetch(`${BASE}/`, { redirect: 'manual' })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('<h1 class="display">Guardian</h1>')
    expect(html).toContain('File a plan before you head out')
    expect(html).toContain('href="/profile"')
    expect(html).toContain('href="/login"')
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

  it('gives an operator the explorer home with a Board item in the menu', async () => {
    const o = await makeOperator()
    const res = await exports.default.fetch(`${BASE}/`, { headers: { cookie: cookieFor(o.token) }, redirect: 'manual' })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('class="appbar"')
    expect(html).toContain('href="/board"')
    expect(html).toContain('href="/profile"')
  })

  it('gives an admin the same, and an explorer no Board item', async () => {
    const a = await makeAdmin()
    let res = await exports.default.fetch(`${BASE}/`, { headers: { cookie: cookieFor(a.token) }, redirect: 'manual' })
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('href="/board"')
    const e = await makeExplorer()
    res = await exports.default.fetch(`${BASE}/`, { headers: { cookie: cookieFor(e.token) }, redirect: 'manual' })
    const html = await res.text()
    expect(html).toContain('href="/profile"')
    expect(html).not.toContain('href="/board"')
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

  it('remembers pets from trips in "My pets", once each, and lets the explorer edit the list', async () => {
    const e = await makeExplorer()
    const other = await makeExplorer()
    const cookie = cookieFor(e.token)
    const t: NewTrip = {
      activity: 'hike', area: 'other', route_text: null, companions_text: null, wearing_text: null, photo_key: null,
      shoe_photo_key: null, start_lat: null, start_lng: null, start_accuracy: null, return_by: Date.now() + 3_600_000,
      checklist: [], battery_at_start: null,
    }
    const first = await startTrip(env.DB, e.user.id, { ...t, companions: [{ name: 'Rex, black Labrador', phone: null, kind: 'pet' }, { name: 'Thandi', phone: '+27821234567', kind: 'person' }] }, 1)
    await markBack(env.DB, first.id, 2)
    await startTrip(env.DB, e.user.id, { ...t, companions: [{ name: 'Milo, beagle', phone: null, kind: 'pet' }, { name: 'rex, black labrador', phone: null, kind: 'pet' }] }, 3)
    await startTrip(env.DB, other.user.id, { ...t, companions: [{ name: 'Not yours', phone: null, kind: 'pet' }] }, 4)
    expect((await listPets(env.DB, e.user.id)).sort()).toEqual(['Milo, beagle', 'rex, black labrador'])

    const page = await (await exports.default.fetch(`${BASE}/pets`, { headers: { cookie } })).text()
    expect(page).toContain('value="Milo, beagle"')
    const fd = new FormData()
    for (const n of ['Milo, beagle', ' ', 'Bella, collie', 'milo, BEAGLE']) fd.append('pet_name', n)
    const res = await exports.default.fetch(`${BASE}/api/pets`, { method: 'POST', headers: { cookie }, body: fd, redirect: 'manual' })
    expect(res.headers.get('location')).toBe('/pets?saved=1')
    expect(await listPets(env.DB, e.user.id)).toEqual(['milo, BEAGLE', 'Bella, collie'])
    // past trips keep their pets
    expect((await listCompanions(env.DB, first.id)).map((c) => c.name)).toContain('Rex, black Labrador')
  })
})

afterEach(() => setPlaceLookupForTests(null))

// Every trip needs a destination, a route and a GPS fix; fill any the test leaves out.
const WHERE = { destination_text: 'Maclear Beacon', route_text: 'Platteklip up', start_lat: -33.95, start_lng: 18.4 }
const where = (fd: FormData) => { for (const [k, v] of Object.entries(WHERE)) if (!fd.has(k)) fd.append(k, String(v)); return fd }

describe('POST /api/trips', () => {
  it('asks what an "Other" trip is, and names it that way', async () => {
    const e = await makeExplorer()
    const post = (body: object) => exports.default.fetch(`${BASE}/api/trips`, json(cookieFor(e.token), { activity: 'other', return_by: Date.now() + 3_600_000, ...WHERE, ...body }))
    expect((await post({})).status).toBe(400)
    expect((await post({ activity_text: 'Kayaking' })).status).toBe(200)
    const trip = (await getOpenTrip(env.DB, e.user.id))!
    expect(trip.activity_text).toBe('Kayaking')
    expect(tripLine({ ...trip, start_place: 'Kalk Bay' })).toBe('Kayaking from Kalk Bay')
  })

  it('keeps pets, even on a solo trip, and never gives them a phone', async () => {
    const e = await makeExplorer()
    const fd = new FormData()
    fd.append('activity', 'hike'); fd.append('return_by', '2099-01-01T10:00'); fd.append('company', 'alone')
    fd.append('companion_name', 'Ghost'); fd.append('pet_name', 'Rex, black Labrador'); fd.append('pet_name', '')
    const res = await exports.default.fetch(`${BASE}/api/trips`, { method: 'POST', headers: { cookie: cookieFor(e.token) }, body: where(fd), redirect: 'manual' })
    expect(res.status).toBe(303)
    const trip = (await getOpenTrip(env.DB, e.user.id))!
    expect((await listCompanions(env.DB, trip.id)).map((c) => [c.name, c.phone, c.kind])).toEqual([['Rex, black Labrador', null, 'pet']])
  })

  it('needs a destination, a route and a GPS fix', async () => {
    const e = await makeExplorer()
    const post = (body: object) => exports.default.fetch(`${BASE}/api/trips`, json(cookieFor(e.token), { activity: 'hike', return_by: Date.now() + 3_600_000, ...WHERE, ...body }))
    expect((await post({ destination_text: '' })).status).toBe(400)
    expect((await post({ route_text: null })).status).toBe(400)
    expect((await post({ start_lat: null })).status).toBe(400)
    expect(await getOpenTrip(env.DB, e.user.id)).toBeNull()

    const fd = new FormData()
    fd.append('activity', 'hike'); fd.append('return_by', '2099-01-01T10:00'); fd.append('destination_text', 'Lion\'s Head')
    const html = await (await exports.default.fetch(`${BASE}/api/trips`, { method: 'POST', headers: { cookie: cookieFor(e.token) }, body: fd })).text()
    // the message sits on the "Where are you going?" step
    expect(html.indexOf('your route')).toBeGreaterThan(html.indexOf('Where are you going?'))
    expect(html.indexOf('your route')).toBeLessThan(html.indexOf('When will you be back?'))
  })

  it('starts without an area, with a destination and companions from a form', async () => {
    const e = await makeExplorer()
    const fd = new FormData()
    fd.append('activity', 'paraglide')
    fd.append('return_by', '2099-01-01T10:00')
    fd.append('destination_text', 'Clifton landing')
    fd.append('company', 'group')
    for (const [n, p, cc] of [['Themba', '072 555 0114', '27'], ['', '', '27'], ['Sam', '', '44']]) {
      fd.append('companion_name', n); fd.append('companion_phone', p); fd.append('companion_phone_country', cc)
    }
    fd.append('gear_photo', new File([new Uint8Array([1])], 'wing.jpg', { type: 'image/jpeg' }))
    const res = await exports.default.fetch(`${BASE}/api/trips`, { method: 'POST', headers: { cookie: cookieFor(e.token) }, body: where(fd), redirect: 'manual' })
    expect(res.status).toBe(303)
    const trip = (await getOpenTrip(env.DB, e.user.id))!
    expect(trip.area).toBe('other')
    expect(trip.destination_text).toBe('Clifton landing')
    expect(trip.gear_photo_key).toMatch(new RegExp(`^users/${e.user.id}/.+\\.jpg$`))
    const people = await listCompanions(env.DB, trip.id)
    expect(people.map((p) => [p.name, p.phone])).toEqual([['Themba', '+27725550114'], ['Sam', null]])
  })

  it('ignores companions when going alone, and gear photos for activities without gear', async () => {
    const e = await makeExplorer()
    const res = await exports.default.fetch(`${BASE}/api/trips`, json(cookieFor(e.token), { ...WHERE,
      activity: 'hike', return_by: Date.now() + 3_600_000, company: 'alone', companions: [{ name: 'Ghost' }],
      gear_photo_key: `users/${e.user.id}/bike.jpg`,
    }))
    expect(res.status).toBe(200)
    const trip = (await getOpenTrip(env.DB, e.user.id))!
    expect(await listCompanions(env.DB, trip.id)).toEqual([])
    expect(trip.gear_photo_key).toBeNull()
  })

  it('comes back filled in, on the right step, when the start fails', async () => {
    const e = await makeExplorer()
    const fd = new FormData()
    fd.append('activity', 'hike')
    fd.append('return_by', '2000-01-01T10:00')
    fd.append('destination_text', 'Maclear Beacon')
    fd.append('route_text', 'Platteklip up')
    fd.append('checklist', 'Space blanket')
    fd.append('company', 'group')
    fd.append('companion_name', 'Zola'); fd.append('companion_phone', '0725550000'); fd.append('companion_phone_country', '27')
    const res = await exports.default.fetch(`${BASE}/api/trips`, { method: 'POST', headers: { cookie: cookieFor(e.token) }, body: where(fd) })
    expect(res.status).toBe(400)
    const html = await res.text()
    expect(html).toContain('value="Maclear Beacon"')
    expect(html).toContain('>Platteklip up</textarea>')
    expect(html).toContain('value="Zola"')
    expect(html).toContain('value="725550000"')
    expect(html).toMatch(/value="Space blanket" id="c\d+" checked/)
    // the message sits on the "When will you be back?" step
    const when = html.indexOf('When will you be back?')
    expect(html.indexOf('must be a time in the future')).toBeGreaterThan(when)
    expect(html.indexOf('must be a time in the future')).toBeLessThan(html.indexOf('Before you go'))
  })

  it('names the start point after the trip starts', async () => {
    setPlaceLookupForTests(async (lat, lng) => (lat < -33 && lng > 18 ? 'Kloof Nek, Cape Town' : null))
    const e = await makeExplorer()
    const res = await exports.default.fetch(`${BASE}/api/trips`, json(cookieFor(e.token), { ...WHERE,
      activity: 'hike', return_by: Date.now() + 3_600_000, start_lat: -33.95, start_lng: 18.4,
    }))
    const { id } = await res.json<{ id: string }>()
    for (let i = 0; i < 20 && !(await getTrip(env.DB, id))?.start_place; i++) await new Promise((r) => setTimeout(r, 10))
    expect((await getTrip(env.DB, id))?.start_place).toBe('Kloof Nek, Cape Town')
  })

  it('starts a trip from json', async () => {
    const e = await makeExplorer()
    const return_by = Date.now() + 2 * 3_600_000
    const res = await exports.default.fetch(`${BASE}/api/trips`, json(cookieFor(e.token), { ...WHERE,
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
    const res = await exports.default.fetch(`${BASE}/api/trips`, { method: 'POST', headers: { cookie: cookieFor(e.token) }, body: where(fd), redirect: 'manual' })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/trip')
    const trip = await getOpenTrip(env.DB, e.user.id)
    expect(trip?.checklist_json).toBe('["Helmet","Water"]')
    expect(trip?.shoe_photo_key).toMatch(/\.png$/)
  })

  it('reuses a previous shoe photo key', async () => {
    const e = await makeExplorer()
    const res = await exports.default.fetch(`${BASE}/api/trips`, json(cookieFor(e.token), { ...WHERE,
      activity: 'hike', area: 'other', return_by: Date.now() + 3_600_000, shoe_photo_key: `users/${e.user.id}/old.jpg`,
    }))
    expect(res.status).toBe(200)
    expect((await getOpenTrip(env.DB, e.user.id))?.shoe_photo_key).toBe(`users/${e.user.id}/old.jpg`)
  })

  it('rejects a bad activity, past return time, and a second open trip', async () => {
    const e = await makeExplorer()
    let res = await exports.default.fetch(`${BASE}/api/trips`, json(cookieFor(e.token), { ...WHERE, activity: 'swim', area: 'other', return_by: Date.now() + 1000 }))
    expect(res.status).toBe(400)
    res = await exports.default.fetch(`${BASE}/api/trips`, json(cookieFor(e.token), { ...WHERE, activity: 'hike', area: 'other', return_by: Date.now() - 1000 }))
    expect(res.status).toBe(400)
    res = await exports.default.fetch(`${BASE}/api/trips`, json(cookieFor(e.token), { ...WHERE, activity: 'hike', area: 'other', return_by: Date.now() + 1000 }))
    expect(res.status).toBe(200)
    res = await exports.default.fetch(`${BASE}/api/trips`, json(cookieFor(e.token), { ...WHERE, activity: 'hike', area: 'other', return_by: Date.now() + 1000 }))
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
    const res = await exports.default.fetch(`${BASE}/api/trips`, { method: 'POST', headers: { cookie: cookieFor(e.token) }, body: where(fd) })
    expect(res.status).toBe(400)
    expect(await getOpenTrip(env.DB, e.user.id)).toBeNull()
  })
})
