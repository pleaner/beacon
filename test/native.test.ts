import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it } from 'vitest'
import worker from '../src/index'
import { listSubscriptionsForUser } from '../src/lib/db'
import { lastMagicLinkForTests } from '../src/lib/email'
import { setSenderForTests } from '../src/lib/push'
import { startTrip } from '../src/lib/trips'
import { cookieFor, fakeSender, makeExplorer, makeOperator } from './helpers'

const BASE = 'https://beacon.test'

async function call(path: string, init: RequestInit & { bearer?: string; cookie?: string } = {}) {
  const headers = new Headers(init.headers)
  if (init.bearer) headers.set('authorization', `Bearer ${init.bearer}`)
  if (init.cookie) headers.set('cookie', init.cookie)
  const ctx = createExecutionContext()
  const res = await worker.fetch(new Request(`${BASE}${path}`, { ...init, headers, redirect: 'manual' }), env, ctx)
  await waitOnExecutionContext(ctx)
  return res
}
const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

afterEach(() => setSenderForTests(null))

describe('native apps', () => {
  it('signs up an explorer, returns a bearer token, and serves /api/me with it', async () => {
    const res = await call('/api/profile', json({
      name: 'Anele', phone: '0821234567', phone_country: '27', email: 'anele@example.test',
      emergency_name: 'Sipho', emergency_phone: '0831234567', emergency_phone_country: '27', consent_contact: '1',
    }))
    expect(res.status).toBe(200)
    const { token } = (await res.json()) as { token: string }
    const me = (await (await call('/api/me', { bearer: token })).json()) as Record<string, any>
    expect(me.user.name).toBe('Anele')
    expect(me.user.token_hash).toBeUndefined()
    expect(me.trip).toBeNull()
    expect(me.checklists.hike.length).toBeGreaterThan(0)
    expect((await call('/api/me', { bearer: 'nope' })).status).toBe(401)
  })

  it('signs an operator into the app without signing their browser out, and signs the app out alone', async () => {
    const o = await makeOperator({ email: 'app-ops@sarza.test' })
    expect((await (await call('/auth/link', json({ email: 'app-ops@sarza.test' }))).json())).toEqual({ ok: true })
    const link = lastMagicLinkForTests()!.url
    const res = await call('/api/auth/verify', json({ link }))
    expect(res.status).toBe(200)
    const { token } = (await res.json()) as { token: string }
    expect((await call('/api/board', { bearer: token })).status).toBe(200)
    expect((await call('/board', { cookie: cookieFor(o.token) })).status).toBe(200)
    // the link works once
    expect((await call('/api/auth/verify', json({ link }))).status).toBe(400)
    await call('/api/logout', { bearer: token, method: 'POST' })
    expect((await call('/api/board', { bearer: token })).status).toBe(401)
    expect((await call('/board', { cookie: cookieFor(o.token) })).status).toBe(200)
  })

  it('starts a trip from a multipart form like the Android app sends', async () => {
    const e = await makeExplorer()
    const f = new FormData()
    const back = Date.now() + 3 * 3_600_000
    for (const [k, v] of Object.entries({ activity: 'hike', destination_text: 'Kasteelspoort', route_text: 'Up and back',
      start_lat: '-33.95', start_lng: '18.38', start_accuracy: '12', return_by: String(back), battery: '81' })) f.append(k, v)
    f.append('companion_name', 'Lwazi'); f.append('companion_phone', '0821112222'); f.append('companion_phone_country', '27')
    f.append('pet_name', 'Rex')
    f.append('checklist', 'Water'); f.append('checklist', 'Headlamp')
    f.append('photo', new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'me.jpg', { type: 'image/jpeg' }))
    const res = await call('/api/trips', { bearer: e.token, method: 'POST', body: f, headers: { accept: 'application/json' } })
    expect(res.status).toBe(200)
    const me = (await (await call('/api/me', { bearer: e.token })).json()) as Record<string, any>
    expect(me.trip.return_by).toBe(back)
    expect(JSON.parse(me.trip.checklist_json)).toEqual(['Water', 'Headlamp'])
    expect(me.trip.photo_key).toBeTruthy()
  })

  it('serves assetlinks only when a signing key is set', async () => {
    expect((await call('/.well-known/assetlinks.json')).status).toBe(404)
  })

  it('moves a phone to whichever account registered it last', async () => {
    const a = await makeExplorer()
    const b = await makeOperator()
    await call('/api/push/device', { bearer: a.token, ...json({ token: 'phone-1' }) })
    expect((await listSubscriptionsForUser(env.DB, a.user.id)).map((s) => s.endpoint)).toEqual(['fcm:phone-1'])
    await call('/api/push/device', { bearer: b.token, ...json({ token: 'phone-1' }) })
    expect(await listSubscriptionsForUser(env.DB, a.user.id)).toEqual([])
    expect((await listSubscriptionsForUser(env.DB, b.user.id)).map((s) => s.endpoint)).toEqual(['fcm:phone-1'])
  })

  it('sounds the siren by push and in the next position reply', async () => {
    const fake = fakeSender()
    setSenderForTests(fake.send)
    const e = await makeExplorer()
    const o = await makeOperator()
    await call('/api/push/device', { bearer: e.token, ...json({ token: 'explorer-phone' }) })
    const t = await startTrip(env.DB, e.user.id, {
      activity: 'hike', route_text: null, companions_text: null, wearing_text: null, photo_key: null, shoe_photo_key: null,
      start_lat: null, start_lng: null, start_accuracy: null, return_by: Date.now() + 3_600_000, checklist: [], battery_at_start: null,
    }, Date.now())
    expect((await call(`/api/board/trips/${t.id}/siren`, { bearer: o.token, ...json({}) })).status).toBe(200)
    expect(fake.sent.map((s) => [s.endpoint, s.payload.kind])).toEqual([['fcm:explorer-phone', 'siren']])
    const reply = (await (await call(`/api/trips/${t.id}/positions`, { bearer: e.token, ...json([{ lat: -33.9, lng: 18.4 }]) })).json()) as { siren_at: number }
    expect(reply.siren_at).toBeGreaterThan(0)
    const detail = (await (await call(`/api/board/trips/${t.id}`, { bearer: o.token })).json()) as Record<string, any>
    expect(detail.trip.siren_at).toBe(reply.siren_at)
    expect(detail.user.token_hash).toBeUndefined()
    expect((await call(`/api/board/trips/${t.id}/siren`, { bearer: e.token, ...json({}) })).status).toBe(403)
  })
})
