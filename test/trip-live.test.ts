import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it } from 'vitest'
import worker from '../src/index'
import { addSubscription, insertPositions, listPositions, listSubscriptionsForUser } from '../src/lib/db'
import { setSenderForTests } from '../src/lib/push'
import { fitMap } from '../src/lib/map'
import { getTrip, markOverdue, routeSummary, startTrip, type NewTrip } from '../src/lib/trips'
import { cookieFor, fakeSender, makeExplorer, makeOperator } from './helpers'

const BASE = 'https://beacon.test'

async function call(path: string, init: RequestInit & { cookie?: string } = {}) {
  const headers = new Headers(init.headers)
  if (init.cookie) headers.set('cookie', init.cookie)
  const ctx = createExecutionContext()
  const res = await worker.fetch(new Request(`${BASE}${path}`, { ...init, headers, redirect: 'manual' }), env, ctx)
  await waitOnExecutionContext(ctx)
  return res
}
const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

const base: NewTrip = {
  activity: 'hike', area: 'cape_peninsula', route_text: null, companions_text: null, wearing_text: null, photo_key: null,
  shoe_photo_key: null, start_lat: null, start_lng: null, start_accuracy: null, return_by: 0, checklist: [], battery_at_start: null,
}
async function live(returnIn = 3_600_000) {
  const e = await makeExplorer({ name: 'Anele' })
  const t = await startTrip(env.DB, e.user.id, { ...base, return_by: Date.now() + returnIn }, Date.now())
  return { e, t, cookie: cookieFor(e.token) }
}

afterEach(() => setSenderForTests(null))

describe('GET /trip', () => {
  it('redirects home without an open trip', async () => {
    const e = await makeExplorer()
    const res = await call('/trip', { cookie: cookieFor(e.token) })
    expect(res.headers.get('location')).toBe('/')
  })

  it('renders the active screen with the three actions', async () => {
    const { t, cookie } = await live()
    const res = await call('/trip', { cookie })
    const html = await res.text()
    expect(html).toContain(`data-trip-id="${t.id}"`)
    expect(html).toContain('data-trip-status="active"')
    expect(html).toContain(`action="/api/trips/${t.id}/back"`)
    expect(html).toContain(`action="/api/trips/${t.id}/extend"`)
    expect(html).toContain('data-help-slider')
    expect(html).not.toContain('Are you okay?')
  })

  it('shows the overdue banner', async () => {
    const { t, cookie } = await live(-1000)
    await markOverdue(env.DB, t.id, Date.now())
    const html = await (await call('/trip', { cookie })).text()
    expect(html).toContain('Are you okay?')
    expect(html).toContain('data-trip-status="overdue"')
  })

  it('shows the help screen when in help', async () => {
    const { t, cookie } = await live()
    await call(`/api/trips/${t.id}/help`, { cookie, ...json({}) })
    const html = await (await call('/trip', { cookie })).text()
    expect(html).toContain('SARZA has been alerted')
    expect(html).toContain('tel:+27219370300')
    expect(html).toContain(`action="/api/trips/${t.id}/cancel"`)
    expect(html).toContain('data-trip-status="help"')
  })

  it('renders an error passed on the query string in a red banner', async () => {
    const { cookie } = await live()
    const html = await (await call('/trip?error=Pick%20a%20time', { cookie })).text()
    expect(html).toContain('<div class="banner error" role="alert">Pick a time</div>')
  })
})

describe('extend and back', () => {
  it('extends by minutes from now', async () => {
    const { t, cookie } = await live()
    const before = Date.now()
    const res = await call(`/api/trips/${t.id}/extend`, { cookie, ...json({ minutes: 120 }) })
    expect(res.status).toBe(200)
    const cur = await getTrip(env.DB, t.id)
    expect(cur!.return_by).toBeGreaterThanOrEqual(before + 120 * 60_000)
    expect(cur!.status).toBe('active')
  })

  it('extends to a chosen time via form and redirects', async () => {
    const { t, cookie } = await live()
    const res = await call(`/api/trips/${t.id}/extend`, {
      cookie, method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ return_by: '2099-06-01T09:30' }),
    })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/trip')
    expect((await getTrip(env.DB, t.id))!.return_by).toBe(Date.UTC(2099, 5, 1, 7, 30))
  })

  it('rejects a past time and someone else\'s trip', async () => {
    const { t, cookie } = await live()
    let res = await call(`/api/trips/${t.id}/extend`, { cookie, ...json({ return_by: 1000 }) })
    expect(res.status).toBe(400)
    const other = await makeExplorer()
    res = await call(`/api/trips/${t.id}/extend`, { cookie: cookieFor(other.token), ...json({ minutes: 60 }) })
    expect(res.status).toBe(404)
  })

  it('extends by minutes via a form (the select path the view uses) and redirects', async () => {
    const { t, cookie } = await live()
    const before = (await getTrip(env.DB, t.id))!.return_by
    const res = await call(`/api/trips/${t.id}/extend`, {
      cookie, method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ minutes: '60' }),
    })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/trip')
    expect((await getTrip(env.DB, t.id))!.return_by).toBeGreaterThan(before)
  })

  it('a form-encoded extend with a past time redirects to /trip with the error on the query string', async () => {
    const { t, cookie } = await live()
    const res = await call(`/api/trips/${t.id}/extend`, {
      cookie, method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ return_by: '2000-01-01T09:30' }),
    })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/trip?error=Pick%20a%20time%20in%20the%20future')
  })

  it('back closes as safe', async () => {
    const { t, cookie } = await live()
    const res = await call(`/api/trips/${t.id}/back`, { cookie, method: 'POST' })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe(`/trips/${t.id}/done`)
    expect((await getTrip(env.DB, t.id))!.closed_reason).toBe('safe')
    const again = await call(`/api/trips/${t.id}/back`, { cookie, ...json({}) })
    expect(again.status).toBe(409)
  })
})

describe('help and cancel', () => {
  it('moves to help and pushes operators immediately, once', async () => {
    const { t, cookie } = await live()
    const o = await makeOperator()
    await addSubscription(env.DB, o.user.id, { endpoint: 'https://push.test/o', p256dh: 'k', auth: 'a' })
    const f = fakeSender()
    setSenderForTests(f.send)
    let res = await call(`/api/trips/${t.id}/help`, { cookie, ...json({}) })
    expect(res.status).toBe(200)
    expect((await getTrip(env.DB, t.id))!.status).toBe('help')
    expect(f.sent).toHaveLength(1)
    expect(f.sent[0].payload.title).toBe('HELP: Anele')
    expect(f.sent[0].payload.url).toBe(`/board/trips/${t.id}`)
    expect(f.sent[0].payload.requireInteraction).toBe(true)
    res = await call(`/api/trips/${t.id}/help`, { cookie, ...json({}) })
    expect(res.status).toBe(200)
    expect(f.sent).toHaveLength(1)
  })

  it('marks operators alerted once the push reaches a subscribed operator', async () => {
    const { t, cookie } = await live()
    const o = await makeOperator()
    await addSubscription(env.DB, o.user.id, { endpoint: 'https://push.test/alerted', p256dh: 'k', auth: 'a' })
    setSenderForTests(fakeSender().send)
    const res = await call(`/api/trips/${t.id}/help`, { cookie, ...json({}) })
    expect(res.status).toBe(200)
    expect((await getTrip(env.DB, t.id))!.help_alerted_at).not.toBeNull()
  })

  it('cancel goes back to the trip and leaves it open', async () => {
    const { t, cookie } = await live()
    setSenderForTests(fakeSender().send)
    await call(`/api/trips/${t.id}/help`, { cookie, ...json({}) })
    const res = await call(`/api/trips/${t.id}/cancel`, { cookie, method: 'POST' })
    expect(res.headers.get('location')).toBe('/trip')
    const cur = await getTrip(env.DB, t.id)!
    expect(cur!.status).toBe('active')
    expect(cur!.closed_at).toBeNull()
  })
})

describe('positions', () => {
  it('stores a batch for the owner of an open trip', async () => {
    const { t, cookie } = await live()
    const recent = Date.now() - 30_000
    const res = await call(`/api/trips/${t.id}/positions`, { cookie, ...json([
      { lat: -34.1, lng: 18.4, accuracy: 5, battery: 60, at: recent },
      { lat: -34.2, lng: 18.5 },
    ]) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, saved: 2 })
    const list = await listPositions(env.DB, t.id)
    expect(list).toHaveLength(2)
    expect(list[1].battery).toBe(60)
    expect(list[0].at).toBeGreaterThan(recent)
  })

  it('clamps a future timestamp to now and drops fixes from before the trip', async () => {
    const { t, cookie } = await live()
    const now = Date.now()
    const res = await call(`/api/trips/${t.id}/positions`, { cookie, ...json([
      { lat: -34.1, lng: 18.4, at: now + 60_000 },
      { lat: -34.2, lng: 18.5, at: t.created_at - 60 * 60_000 },
    ]) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, saved: 1 })
    const list = await listPositions(env.DB, t.id)
    expect(list).toHaveLength(1)
    expect(list[0].at).toBeLessThan(now + 60_000)
  })

  it('takes a late backlog with altitude, marks when it arrived, and stores a resent batch once', async () => {
    const { t, cookie } = await live()
    await env.DB.prepare('UPDATE trips SET created_at = ? WHERE id = ?').bind(Date.now() - 4 * 60 * 60_000, t.id).run()
    const threeHoursAgo = Date.now() - 3 * 60 * 60_000
    const backlog = [
      { lat: -34.1, lng: 18.4, altitude: 1085.4, altitude_accuracy: 12, battery: 55, at: threeHoursAgo },
      { lat: -34.2, lng: 18.5, altitude: null, at: threeHoursAgo + 120_000 },
    ]
    let res = await call(`/api/trips/${t.id}/positions`, { cookie, ...json(backlog) })
    expect(await res.json()).toEqual({ ok: true, saved: 2 })
    res = await call(`/api/trips/${t.id}/positions`, { cookie, ...json(backlog) })
    expect(await res.json()).toEqual({ ok: true, saved: 0 })
    const list = await listPositions(env.DB, t.id)
    expect(list).toHaveLength(2)
    expect(list[1]).toMatchObject({ altitude: 1085.4, altitude_accuracy: 12, battery: 55, at: threeHoursAgo })
    expect(list[0].altitude).toBeNull()
    expect(list[1].received_at! - list[1].at).toBeGreaterThan(2 * 60 * 60_000)
  })

  it('rejects bad payloads, closed trips, and other users', async () => {
    const { t, cookie } = await live()
    let res = await call(`/api/trips/${t.id}/positions`, { cookie, ...json({ lat: 1 }) })
    expect(res.status).toBe(400)
    res = await call(`/api/trips/${t.id}/positions`, { cookie, ...json([{ lat: 'x', lng: 1 }]) })
    expect(res.status).toBe(400)
    const other = await makeExplorer()
    res = await call(`/api/trips/${t.id}/positions`, { cookie: cookieFor(other.token), ...json([{ lat: 1, lng: 1 }]) })
    expect(res.status).toBe(404)
    await call(`/api/trips/${t.id}/back`, { cookie, method: 'POST' })
    res = await call(`/api/trips/${t.id}/positions`, { cookie, ...json([{ lat: 1, lng: 1 }]) })
    expect(res.status).toBe(409)
  })
})

describe('push subscribe', () => {
  it('stores a browser subscription for any signed-in user', async () => {
    const e = await makeExplorer()
    const res = await call('/api/push/subscribe', { cookie: cookieFor(e.token), ...json({ endpoint: 'https://push.test/x', keys: { p256dh: 'p', auth: 'a' } }) })
    expect(res.status).toBe(200)
    const subs = await listSubscriptionsForUser(env.DB, e.user.id)
    expect(subs[0].endpoint).toBe('https://push.test/x')
    const bad = await call('/api/push/subscribe', { cookie: cookieFor(e.token), ...json({ endpoint: 'x' }) })
    expect(bad.status).toBe(400)
    const anon = await call('/api/push/subscribe', json({ endpoint: 'https://push.test/x', keys: { p256dh: 'p', auth: 'a' } }))
    expect(anon.status).toBe(401)
  })
})

describe('end of trip', () => {
  it('shows the route card to the explorer once the trip is closed', async () => {
    const { t, cookie } = await live()
    const at = Date.now() - 60_000
    await insertPositions(env.DB, [
      { trip_id: t.id, lat: -33.95, lng: 18.41, accuracy: 5, battery: 90, altitude: 100, at: at - 20_000 },
      { trip_id: t.id, lat: -33.96, lng: 18.42, accuracy: 5, battery: 89, altitude: 180, at: at - 10_000 },
      { trip_id: t.id, lat: -33.97, lng: 18.41, accuracy: 5, battery: 88, altitude: 150, at },
    ])
    expect((await call(`/trips/${t.id}/done`, { cookie })).headers.get('location')).toBe('/')
    await call(`/api/trips/${t.id}/back`, { cookie, method: 'POST' })
    const html = await (await call(`/trips/${t.id}/done`, { cookie })).text()
    expect(html).toContain('HIKE COMPLETE')
    expect(html).toMatch(/<image href="data:image\/png;base64,[^"]+" x="110" y="50"/)
    expect(html).toContain('>BY SARZA<')
    expect(html).toContain('id="trip-card"')
    expect(html).toContain('<polyline')
    expect(html).toContain('80 m')
    expect(html).toContain('data-share-card')
    const other = await makeExplorer()
    expect((await call(`/trips/${t.id}/done`, { cookie: cookieFor(other.token) })).headers.get('location')).toBe('/')
  })

  it('fits every point of the track inside the map box, with tiles covering the box', () => {
    const tracks = [
      [{ lat: -33.9447, lng: 18.3978 }, { lat: -33.9352, lng: 18.389 }, { lat: -33.94, lng: 18.38 }], // Lion's Head
      [{ lat: -33.95, lng: 18.2 }, { lat: -33.96, lng: 18.9 }], // 65 km east-west
      [{ lat: -32.5, lng: 19.1 }, { lat: -34.2, lng: 19.12 }], // 190 km north-south
      [{ lat: -33.95, lng: 18.41 }, { lat: -33.9501, lng: 18.4101 }], // barely moved
    ]
    for (const track of tracks) {
      const fit = fitMap(track, 0, 300, 1080, 1060)
      for (const [x, y] of track.map(fit.project)) {
        expect(x).toBeGreaterThanOrEqual(70); expect(x).toBeLessThanOrEqual(1010)
        expect(y).toBeGreaterThanOrEqual(370); expect(y).toBeLessThanOrEqual(1290)
      }
      expect(Math.min(...fit.tiles.map((t) => t.left))).toBeLessThanOrEqual(0)
      expect(Math.max(...fit.tiles.map((t) => t.left)) + 512).toBeGreaterThanOrEqual(1080)
      expect(Math.min(...fit.tiles.map((t) => t.top))).toBeLessThanOrEqual(300)
      expect(Math.max(...fit.tiles.map((t) => t.top)) + 512).toBeGreaterThanOrEqual(1360)
    }
  })

  it('sums distance and ignores altitude wobble under 5 m', () => {
    const s = routeSummary([
      { lat: 0, lng: 0, altitude: 100 }, { lat: 0, lng: 0.01, altitude: 103 }, { lat: 0, lng: 0.02, altitude: 99 },
      { lat: 0, lng: 0.03, altitude: 120 }, { lat: 0, lng: 0.04, altitude: 110 }, { lat: 0, lng: 0.05, altitude: 130 },
    ])
    expect(Math.round(s.distance / 100) * 100).toBe(5600)
    expect(s.climb).toBe(41)
  })
})
