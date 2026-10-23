import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it } from 'vitest'
import worker from '../src/index'
import { callsForTrip, raiseCall } from '../src/lib/calls'
import { addSubscription, getSetting } from '../src/lib/db'
import { addToRoster, listRoster } from '../src/lib/oncall'
import { setSenderForTests } from '../src/lib/push'
import { startTrip, type NewTrip } from '../src/lib/trips'
import { cookieFor, fakeSender, makeAdmin, makeExplorer, makeOperator } from './helpers'

afterEach(() => setSenderForTests(null))

async function call(path: string, init: RequestInit & { cookie?: string } = {}) {
  const headers = new Headers(init.headers)
  if (init.cookie) headers.set('cookie', init.cookie)
  const ctx = createExecutionContext()
  const res = await worker.fetch(new Request(`https://beacon.test${path}`, { ...init, headers, redirect: 'manual' }), env, ctx)
  await waitOnExecutionContext(ctx)
  return res
}
const post = (body: unknown, cookie: string) => ({ method: 'POST', cookie, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const form = (fields: Record<string, string>, cookie: string) => ({ method: 'POST', cookie, body: new URLSearchParams(fields) })
const base: NewTrip = {
  activity: 'hike', area: 'cederberg', route_text: null, companions_text: null, wearing_text: null, photo_key: null,
  shoe_photo_key: null, start_lat: null, start_lng: null, start_accuracy: null, return_by: 0, checklist: [], battery_at_start: null,
}

describe('/api/oncall', () => {
  it('is for operators and admins', async () => {
    const e = await makeExplorer()
    expect((await call('/api/oncall', { cookie: cookieFor(e.token) })).status).toBe(403)
    const o = await makeOperator()
    const res = await call('/api/oncall', { cookie: cookieFor(o.token) })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { me: { on_roster: boolean } }).me.on_roster).toBe(false)
  })

  it('lets you change your own availability, and only admins change someone else’s', async () => {
    setSenderForTests(fakeSender().send)
    const a = await makeOperator({ name: 'Ayanda' })
    const b = await makeOperator({ name: 'Bongani' })
    const boss = await makeAdmin()
    for (const p of [a, b]) await addToRoster(env.DB, p.user.id)
    expect((await call('/api/oncall/availability', post({ available: '0' }, cookieFor(a.token)))).status).toBe(200)
    expect((await listRoster(env.DB)).find((r) => r.user_id === a.user.id)?.available).toBe(0)
    expect((await call('/api/oncall/availability', post({ available: '0', user_id: b.user.id }, cookieFor(a.token)))).status).toBe(403)
    expect((await call('/api/oncall/availability', post({ available: '0', user_id: b.user.id }, cookieFor(boss.token)))).status).toBe(200)
    const web = await call('/api/oncall/availability', form({ available: '1' }, cookieFor(a.token)))
    expect(web.status).toBe(303)
    expect(web.headers.get('location')).toBe('/board/oncall')
  })

  it('lets admins add, move and remove, and refuses explorers', async () => {
    setSenderForTests(fakeSender().send)
    const boss = await makeAdmin()
    const a = await makeOperator({ name: 'Ayanda' })
    const b = await makeOperator({ name: 'Bongani' })
    const e = await makeExplorer()
    const bc = cookieFor(boss.token)
    expect((await call('/api/oncall/add', post({ user_id: a.user.id }, cookieFor(a.token)))).status).toBe(403)
    expect((await call('/api/oncall/add', post({ user_id: e.user.id }, bc))).status).toBe(400)
    await call('/api/oncall/add', post({ user_id: a.user.id }, bc))
    await call('/api/oncall/add', post({ user_id: b.user.id }, bc))
    await call('/api/oncall/move', post({ user_id: b.user.id, dir: 'up' }, bc))
    expect((await listRoster(env.DB)).map((r) => r.name)).toEqual(['Bongani', 'Ayanda'])
    await call('/api/oncall/remove', post({ user_id: b.user.id }, bc))
    expect((await listRoster(env.DB)).map((r) => r.name)).toEqual(['Ayanda'])
  })
})

describe('accept and reject', () => {
  async function helpCall() {
    const f = fakeSender()
    setSenderForTests(f.send)
    const a = await makeOperator({ name: 'Ayanda' })
    const b = await makeOperator({ name: 'Bongani' })
    for (const [p, k] of [[a, 'a'], [b, 'b']] as const) {
      await addToRoster(env.DB, p.user.id)
      await addSubscription(env.DB, p.user.id, { endpoint: `https://push.test/${k}`, p256dh: 'k', auth: 'x' })
    }
    const e = await makeExplorer()
    const trip = await startTrip(env.DB, e.user.id, { ...base, return_by: Date.now() + 3_600_000 }, Date.now())
    await raiseCall(env.DB, f.send, trip.id, 'help', Date.now())
    const c = (await callsForTrip(env.DB, trip.id))[0]!
    const reached = c.targets[0]!.user_id === a.user.id ? a : b
    const other = reached === a ? b : a
    return { trip, c, reached, other, f }
  }

  it('accept works once, and the second person is told someone got there first', async () => {
    const s = await helpCall()
    expect((await call(`/api/board/calls/${s.c.id}/accept`, post({}, cookieFor(s.other.token)))).status).toBe(200)
    const res = await call(`/api/board/calls/${s.c.id}/accept`, post({}, cookieFor(s.reached.token)))
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toBe('Someone else accepted this call first.')
    const web = await call(`/api/board/calls/${s.c.id}/accept`, form({}, cookieFor(s.reached.token)))
    expect(web.headers.get('location')).toContain(`/board/trips/${s.trip.id}?error=`)
  })

  it('reject passes it to the next person, and someone not reached can’t reject', async () => {
    const s = await helpCall()
    expect((await call(`/api/board/calls/${s.c.id}/reject`, post({}, cookieFor(s.other.token)))).status).toBe(409)
    const res = await call(`/api/board/calls/${s.c.id}/reject`, form({}, cookieFor(s.reached.token)))
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe(`/board/trips/${s.trip.id}`)
    expect(s.f.sent.map((x) => x.endpoint)).toHaveLength(2)
  })

  it('board trip JSON carries the calls with the viewer’s buttons', async () => {
    const s = await helpCall()
    const res = await call(`/api/board/trips/${s.trip.id}`, { cookie: cookieFor(s.reached.token), headers: { accept: 'application/json' } })
    const body = (await res.json()) as { calls: Array<{ can_accept: boolean; can_reject: boolean; lines: Array<{ text: string }> }> }
    expect(body.calls).toHaveLength(1)
    expect(body.calls[0]!.can_accept).toBe(true)
    expect(body.calls[0]!.can_reject).toBe(true)
    expect(body.calls[0]!.lines[0]!.text).toBe('Call started: the explorer called for help.')
  })
})

describe('settings save', () => {
  it('stores shift length and no-response time, and refuses bad values', async () => {
    const boss = await makeAdmin()
    const bc = cookieFor(boss.token)
    let res = await call('/admin/settings', form({ grace_minutes: '30', shift_hours: '5', no_response_minutes: '2' }, bc))
    expect(res.status).toBe(400)
    res = await call('/admin/settings', form({ grace_minutes: '30', shift_hours: '12', no_response_minutes: '0' }, bc))
    expect(res.status).toBe(400)
    res = await call('/admin/settings', form({ grace_minutes: '30', shift_hours: '12', no_response_minutes: '3' }, bc))
    expect(res.status).toBe(303)
    expect(await getSetting(env.DB, 'shift_hours', '')).toBe('12')
    expect(await getSetting(env.DB, 'no_response_minutes', '')).toBe('3')
    // A form without the new fields (an older page) leaves them alone.
    await call('/admin/settings', form({ grace_minutes: '20' }, bc))
    expect(await getSetting(env.DB, 'shift_hours', '')).toBe('12')
  })
})
