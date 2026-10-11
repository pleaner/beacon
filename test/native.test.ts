import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import worker from '../src/index'
import { listSubscriptionsForUser } from '../src/lib/db'
import { setSenderForTests } from '../src/lib/push'
import { startTrip } from '../src/lib/trips'
import { cookieFor, fakeSender, makeExplorer, makeOperator } from './helpers'
import { fakeProviders } from './fake-oauth'

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

let fake: Awaited<ReturnType<typeof fakeProviders>>
beforeEach(async () => { fake = await fakeProviders() })
afterEach(() => { setSenderForTests(null); fake.restore() })

describe('native apps', () => {
  it('signs a new explorer in with a Google ID token, then the profile and /api/me work with the bearer', async () => {
    const res = await call('/api/auth/google', json({ id_token: await fake.idToken('google', { sub: 'g-anele', email: 'anele@example.test', name: 'Anele' }) }))
    expect(res.status).toBe(200)
    const { token, user, needs_profile } = (await res.json()) as { token: string; user: Record<string, unknown>; needs_profile: boolean }
    expect(needs_profile).toBe(true)
    expect(user.token_hash).toBeUndefined()
    expect(user.app_token_hash).toBeUndefined()
    const saved = await call('/api/profile', { bearer: token, ...json({
      name: 'Anele', phone: '0821234567', phone_country: '27', email: 'anele@example.test',
      emergency_name: 'Sipho', emergency_phone: '0831234567', emergency_phone_country: '27', consent_contact: '1',
    }) })
    expect(saved.status).toBe(200)
    const me = (await (await call('/api/me', { bearer: token })).json()) as Record<string, any>
    expect(me.user).toMatchObject({ name: 'Anele', phone: '+27821234567' })
    expect(me.trip).toBeNull()
    expect(me.checklists.hike.length).toBeGreaterThan(0)
    expect((await call('/api/me', { bearer: 'nope' })).status).toBe(401)
    // Signing in again finds the same account, now with a profile.
    const again = (await (await call('/api/auth/google', json({ id_token: await fake.idToken('google', { sub: 'g-anele', email: 'anele@example.test' }) }))).json()) as { user: { id: string }; needs_profile: boolean }
    expect(again).toMatchObject({ user: { id: me.user.id }, needs_profile: false })
  })

  it('refuses a Google token for another app, an expired one, or one signed with an unknown key', async () => {
    for (const id_token of [
      await fake.idToken('google', { sub: 'g-1', aud: 'someone-elses-app' }),
      await fake.idToken('google', { sub: 'g-1', exp: Math.floor(Date.now() / 1000) - 3600 }),
      await fake.idToken('google', { sub: 'g-1' }, await fake.otherKey()),
      'not.a.token',
    ]) {
      const res = await call('/api/auth/google', json({ id_token }))
      expect(res.status).toBe(400)
      expect(await res.json()).toHaveProperty('error')
    }
    expect((await call('/api/auth/google', json({}))).status).toBe(400)
  })

  it('signs an operator into the app without signing their browser out, and signs the app out alone', async () => {
    const o = await makeOperator({ email: 'app-ops@sarza.test' })
    const res = await call('/api/auth/google', json({ id_token: await fake.idToken('google', { sub: 'g-app-ops', email: 'app-ops@sarza.test' }) }))
    expect(res.status).toBe(200)
    const { token, needs_profile } = (await res.json()) as { token: string; needs_profile: boolean }
    expect(needs_profile).toBe(false)
    expect((await call('/api/board', { bearer: token })).status).toBe(200)
    expect((await call('/board', { cookie: cookieFor(o.token) })).status).toBe(200)
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
