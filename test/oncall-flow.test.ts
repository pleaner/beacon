import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it } from 'vitest'
import worker from '../src/index'
import { callsForTrip } from '../src/lib/calls'
import { runCron } from '../src/lib/cron'
import { addSubscription } from '../src/lib/db'
import { addToRoster } from '../src/lib/oncall'
import { setSenderForTests } from '../src/lib/push'
import { markOverdue, startTrip, type NewTrip } from '../src/lib/trips'
import { cookieFor, fakeSender, makeExplorer, makeOperator } from './helpers'

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
const base: NewTrip = {
  activity: 'hike', area: 'cederberg', route_text: null, companions_text: null, wearing_text: null, photo_key: null,
  shoe_photo_key: null, start_lat: null, start_lng: null, start_accuracy: null, return_by: 0, checklist: [], battery_at_start: null,
}
const MIN = 60_000

// Two operators on the roster, each with a device. Whoever the real clock puts on shift goes first.
async function setup() {
  const a = await makeOperator({ name: 'Ayanda' })
  const b = await makeOperator({ name: 'Bongani' })
  for (const [o, k] of [[a, 'a'], [b, 'b']] as const) {
    await addToRoster(env.DB, o.user.id)
    await addSubscription(env.DB, o.user.id, { endpoint: `https://push.test/${k}`, p256dh: 'k', auth: 'x' })
  }
  const e = await makeExplorer({ name: 'Thandi' })
  const trip = await startTrip(env.DB, e.user.id, { ...base, return_by: Date.now() + 3_600_000 }, Date.now())
  const f = fakeSender()
  setSenderForTests(f.send)
  return { a, b, e, trip, f, ec: cookieFor(e.token) }
}
// Pushes to the two operators, leaving out the cron's shift-start push.
const opEnds = (f: ReturnType<typeof fakeSender>) =>
  f.sent.filter((s) => s.payload.kind !== 'shift').map((s) => s.endpoint).filter((x) => x === 'https://push.test/a' || x === 'https://push.test/b')

describe('help through the on-call roster', () => {
  it('reaches one person, then the next after the no-response time', async () => {
    const s = await setup()
    expect((await call(`/api/trips/${s.trip.id}/help`, post({}, s.ec))).status).toBe(200)
    expect(opEnds(s.f)).toHaveLength(1)
    const later = Date.now() + 2 * MIN
    const r = await runCron(env, s.f.send, later)
    expect(r.escalated).toBe(1)
    expect(opEnds(s.f).sort()).toEqual(['https://push.test/a', 'https://push.test/b'])
  })

  it('back safe stops escalation', async () => {
    const s = await setup()
    await call(`/api/trips/${s.trip.id}/help`, post({}, s.ec))
    await call(`/api/trips/${s.trip.id}/cancel`, post({}, s.ec))
    await call(`/api/trips/${s.trip.id}/back`, post({}, s.ec))
    const before = s.f.sent.length
    await runCron(env, s.f.send, Date.now() + 5 * MIN)
    expect(s.f.sent.slice(before).filter((x) => x.payload.kind === 'help' || x.payload.kind === 'overdue')).toHaveLength(0)
    const [c] = await callsForTrip(env.DB, s.trip.id)
    expect(c!.closed_at).not.toBeNull()
    expect(c!.lines.map((l) => l.text)).toEqual(expect.arrayContaining(['Thandi cancelled the call for help.', 'Call closed.']))
  })

  it('extending closes an open overdue call', async () => {
    const s = await setup()
    await env.DB.prepare('UPDATE trips SET return_by = ? WHERE id = ?').bind(Date.now() - MIN, s.trip.id).run()
    await markOverdue(env.DB, s.trip.id, Date.now())
    await env.DB.prepare('UPDATE trips SET prompted_at = ? WHERE id = ?').bind(Date.now() - 31 * MIN, s.trip.id).run()
    expect((await runCron(env, s.f.send, Date.now())).alerted).toBe(1)
    await call(`/api/trips/${s.trip.id}/extend`, post({ minutes: 60 }, s.ec))
    const [c] = await callsForTrip(env.DB, s.trip.id)
    expect(c!.kind).toBe('overdue')
    expect(c!.closed_at).not.toBeNull()
    expect(c!.lines.map((l) => l.text)).toContain('Thandi added time.')
  })

  it('an overdue call that reached no device is raised again next run', async () => {
    const e = await makeExplorer({ name: 'Zola' })
    const trip = await startTrip(env.DB, e.user.id, { ...base, return_by: Date.now() + 3_600_000 }, Date.now())
    await env.DB.prepare('UPDATE trips SET return_by = ? WHERE id = ?').bind(Date.now() - MIN, trip.id).run()
    await markOverdue(env.DB, trip.id, Date.now())
    await env.DB.prepare('UPDATE trips SET prompted_at = ? WHERE id = ?').bind(Date.now() - 31 * MIN, trip.id).run()
    const f = fakeSender()
    setSenderForTests(f.send)
    expect((await runCron(env, f.send, Date.now())).alerted).toBe(0)
    const op = await makeOperator({ name: 'Late' })
    await addSubscription(env.DB, op.user.id, { endpoint: 'https://push.test/late', p256dh: 'k', auth: 'x' })
    expect((await runCron(env, f.send, Date.now() + MIN)).alerted).toBe(1)
    expect(f.sent.some((x) => x.endpoint === 'https://push.test/late' && x.payload.kind === 'overdue')).toBe(true)
  })
})

describe('chat during a call', () => {
  it('falls back to every operator when an open call has no targets yet', async () => {
    const s = await setup()
    await env.DB.prepare('INSERT INTO calls (id, trip_id, kind, started_at, next_at) VALUES (?,?,?,?,?)').bind('c-empty', s.trip.id, 'help', Date.now(), Date.now()).run()
    await call(`/api/trips/${s.trip.id}/messages`, post({ body: 'anyone there' }, s.ec))
    expect(opEnds(s.f).sort()).toEqual(['https://push.test/a', 'https://push.test/b'])
  })

  // The accept endpoint arrives in Task 4; drop the skip there.
  it.skip('goes to the people the call reached, then only to the person who accepted', async () => {
    const s = await setup()
    await call(`/api/trips/${s.trip.id}/help`, post({}, s.ec))
    const first = opEnds(s.f)[0]!
    const firstCookie = cookieFor(first.endsWith('/a') ? s.a.token : s.b.token)
    s.f.sent.length = 0
    await call(`/api/trips/${s.trip.id}/messages`, post({ body: 'twisted ankle' }, s.ec))
    expect(opEnds(s.f)).toEqual([first])
    const [c] = await callsForTrip(env.DB, s.trip.id)
    expect((await call(`/api/board/calls/${c!.id}/accept`, post({}, firstCookie))).status).toBe(200)
    s.f.sent.length = 0
    await call(`/api/trips/${s.trip.id}/messages`, post({ body: 'cold now' }, s.ec))
    expect(opEnds(s.f)).toEqual([first])
  })
})

describe('operator actions', () => {
  it('records the siren and closing the trip, and closing ends the call', async () => {
    const s = await setup()
    await call(`/api/trips/${s.trip.id}/help`, post({}, s.ec))
    const oc = cookieFor(s.a.token)
    await call(`/api/board/trips/${s.trip.id}/siren`, post({}, oc))
    await call(`/api/board/trips/${s.trip.id}/close`, post({}, oc))
    const [c] = await callsForTrip(env.DB, s.trip.id)
    expect(c!.lines.map((l) => l.text)).toEqual(expect.arrayContaining(['Ayanda sounded the siren.', 'Ayanda closed the trip.', 'Call closed.']))
  })
})

describe('cron shift sync', () => {
  it('tells the person on shift', async () => {
    const s = await setup()
    const r = await runCron(env, s.f.send, Date.now())
    expect(r.shiftChanged).toBe(true)
    expect(s.f.sent.filter((x) => x.payload.kind === 'shift')).toHaveLength(1)
  })
})
