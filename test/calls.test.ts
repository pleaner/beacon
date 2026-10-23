import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { addMessage, addSubscription } from '../src/lib/db'
import {
  acceptCall, callsForTrip, canAccept, canReject, closeCallsOfClosedTrips, escalate, findCallsToEscalate, getCall, noteOnCalls, raiseCall, rejectCall,
} from '../src/lib/calls'
import { addToRoster, slotStart } from '../src/lib/oncall'
import { markBack, startTrip, type NewTrip } from '../src/lib/trips'
import { fakeSender, makeExplorer, makeOperator } from './helpers'

const T = slotStart(300, 8) // first person on the roster is on shift
const MIN = 60_000
const base: NewTrip = {
  activity: 'hike', area: 'cederberg', route_text: null, companions_text: null, wearing_text: null, photo_key: null,
  shoe_photo_key: null, start_lat: null, start_lng: null, start_accuracy: null, return_by: T + 3_600_000, checklist: [], battery_at_start: null,
}

// Three operators on the roster, each with one device, plus an admin who isn't on the roster.
async function setup(devices = { a: true, b: true, c: true }) {
  const ids: Record<string, string> = {}
  for (const [k, name] of [['a', 'Ayanda'], ['b', 'Bongani'], ['c', 'Chloe']] as const) {
    const o = await makeOperator({ name })
    ids[k] = o.user.id
    await addToRoster(env.DB, o.user.id)
    if (devices[k]) await addSubscription(env.DB, o.user.id, { endpoint: `https://push.test/${k}`, p256dh: 'k', auth: 'x' })
  }
  const boss = await makeOperator({ name: 'Zanele' })
  await addSubscription(env.DB, boss.user.id, { endpoint: 'https://push.test/z', p256dh: 'k', auth: 'x' })
  const e = await makeExplorer({ name: 'Thandi' })
  const trip = await startTrip(env.DB, e.user.id, base, T)
  return { a: ids.a!, b: ids.b!, c: ids.c!, z: boss.user.id, explorer: e.user.id, trip }
}
const callOf = async (tripId: string) => (await callsForTrip(env.DB, tripId))[0]!
const ends = (f: ReturnType<typeof fakeSender>) => f.sent.map((s) => s.endpoint)

describe('raiseCall', () => {
  it('goes to the person on shift first and starts the record', async () => {
    const s = await setup()
    const f = fakeSender()
    const r = await raiseCall(env.DB, f.send, s.trip.id, 'help', T)
    expect(r).toEqual({ sent: 1, accepted: false })
    expect(ends(f)).toEqual(['https://push.test/a'])
    expect(f.sent[0].payload.title).toBe('HELP: Thandi')
    const c = await callOf(s.trip.id)
    expect(c.kind).toBe('help')
    expect(c.next_at).toBe(T + 2 * MIN)
    expect(c.lines.map((l) => l.text)).toEqual(['Call started: the explorer called for help.', 'Alert sent to Ayanda (1 device).'])
  })

  it('keeps one open call per trip and kind', async () => {
    const s = await setup()
    const f = fakeSender()
    await raiseCall(env.DB, f.send, s.trip.id, 'overdue', T)
    await raiseCall(env.DB, f.send, s.trip.id, 'overdue', T + 1000)
    expect(await callsForTrip(env.DB, s.trip.id)).toHaveLength(1)
    expect(ends(f)).toEqual(['https://push.test/a'])
  })

  it('no device: passes over someone with no device at once', async () => {
    const s = await setup({ a: false, b: true, c: true })
    const f = fakeSender()
    await raiseCall(env.DB, f.send, s.trip.id, 'overdue', T)
    expect(ends(f)).toEqual(['https://push.test/b'])
    const c = await callOf(s.trip.id)
    expect(c.lines.map((l) => l.text)).toContain('Ayanda has no device that gets alerts.')
    expect(c.targets.map((t) => t.user_id)).toEqual([s.a, s.b])
  })

  it('no one on the roster can receive: goes to every operator and admin', async () => {
    const s = await setup({ a: false, b: false, c: false })
    const f = fakeSender()
    const r = await raiseCall(env.DB, f.send, s.trip.id, 'help', T)
    expect(r.sent).toBe(1)
    expect(ends(f)).toEqual(['https://push.test/z'])
    const c = await callOf(s.trip.id)
    expect(c.everyone_at).toBe(T)
    expect(c.lines.at(-1)?.text).toBe('Nobody on the roster accepted. Sent to every operator and admin.')
  })

  it('nobody on call: goes to everyone at once and says so', async () => {
    const o = await makeOperator()
    await addSubscription(env.DB, o.user.id, { endpoint: 'https://push.test/o', p256dh: 'k', auth: 'x' })
    const e = await makeExplorer()
    const trip = await startTrip(env.DB, e.user.id, base, T)
    const f = fakeSender()
    await raiseCall(env.DB, f.send, trip.id, 'help', T)
    expect(ends(f)).toEqual(['https://push.test/o'])
    expect((await callOf(trip.id)).lines.at(-1)?.text).toBe('Nobody is on call. Sent to every operator and admin.')
  })

  it('leaves a call that reached no device waiting for the cron to raise it again', async () => {
    const e = await makeExplorer()
    const trip = await startTrip(env.DB, e.user.id, base, T)
    const r = await raiseCall(env.DB, fakeSender().send, trip.id, 'help', T)
    expect(r.sent).toBe(0)
    const c = await callOf(trip.id)
    expect(c.next_at).toBeNull()
    expect(c.everyone_at).toBeNull()
  })
})

describe('escalate', () => {
  it('adds the next person after the no-response time, and the first keeps the call', async () => {
    const s = await setup()
    const f = fakeSender()
    await raiseCall(env.DB, f.send, s.trip.id, 'overdue', T)
    expect(await findCallsToEscalate(env.DB, T + 2 * MIN - 1)).toHaveLength(0)
    const due = await findCallsToEscalate(env.DB, T + 2 * MIN)
    expect(due).toHaveLength(1)
    await escalate(env.DB, f.send, due[0]!, T + 2 * MIN)
    expect(ends(f)).toEqual(['https://push.test/a', 'https://push.test/b'])
    const c = await callOf(s.trip.id)
    expect(c.lines.map((l) => l.text)).toContain('No answer from Ayanda.')
    expect(canAccept(c, s.a)).toBe(true)
    expect(canReject(c, s.a)).toBe(true)
  })

  it('never writes "No answer from" for someone who had no device', async () => {
    const s = await setup({ a: false, b: false, c: false })
    const f = fakeSender()
    await raiseCall(env.DB, f.send, s.trip.id, 'overdue', T)
    await escalate(env.DB, f.send, (await getCall(env.DB, (await callOf(s.trip.id)).id))!, T + 2 * MIN)
    const texts = (await callOf(s.trip.id)).lines.map((l) => l.text)
    expect(texts).toContain('Ayanda has no device that gets alerts.')
    expect(texts.filter((t) => t.startsWith('No answer from'))).toEqual([])
  })

  it('goes to everyone once the roster runs out, then stops', async () => {
    const s = await setup()
    const f = fakeSender()
    await raiseCall(env.DB, f.send, s.trip.id, 'overdue', T)
    for (const at of [T + 2 * MIN, T + 4 * MIN, T + 6 * MIN]) {
      for (const call of await findCallsToEscalate(env.DB, at)) await escalate(env.DB, f.send, call, at)
    }
    // One turn each, then the fallback to every operator and admin, in whatever order the database lists them.
    expect(ends(f).slice(0, 3)).toEqual(['https://push.test/a', 'https://push.test/b', 'https://push.test/c'])
    expect(ends(f).slice(3).sort()).toEqual(['https://push.test/a', 'https://push.test/b', 'https://push.test/c', 'https://push.test/z'])
    expect(await findCallsToEscalate(env.DB, T + 60 * MIN)).toHaveLength(0)
  })
})

describe('accept and reject', () => {
  it('accept stops escalation, and the second accept is told it was taken', async () => {
    const s = await setup()
    const f = fakeSender()
    await raiseCall(env.DB, f.send, s.trip.id, 'help', T)
    const id = (await callOf(s.trip.id)).id
    expect(await acceptCall(env.DB, id, s.a, T + MIN)).toBe('accepted')
    expect(await acceptCall(env.DB, id, s.b, T + MIN)).toBe('taken')
    expect(await findCallsToEscalate(env.DB, T + 10 * MIN)).toHaveLength(0)
    const c = await callOf(s.trip.id)
    expect(c.accepted_name).toBe('Ayanda')
    expect(c.lines.at(-1)?.text).toBe('Ayanda accepted.')
  })

  it('accept race: exactly one of two simultaneous accepts wins', async () => {
    const s = await setup()
    await raiseCall(env.DB, fakeSender().send, s.trip.id, 'help', T)
    const id = (await callOf(s.trip.id)).id
    const results = await Promise.all([acceptCall(env.DB, id, s.a, T), acceptCall(env.DB, id, s.c, T)])
    expect(results.filter((r) => r === 'accepted')).toHaveLength(1)
    expect(results.filter((r) => r === 'taken')).toHaveLength(1)
  })

  it('lets someone the call hasn’t reached accept it', async () => {
    const s = await setup()
    await raiseCall(env.DB, fakeSender().send, s.trip.id, 'help', T)
    expect(await acceptCall(env.DB, (await callOf(s.trip.id)).id, s.z, T)).toBe('accepted')
  })

  it('reject passes it on at once, and the rejecter gets no more pushes and cannot accept', async () => {
    const s = await setup()
    const f = fakeSender()
    await raiseCall(env.DB, f.send, s.trip.id, 'help', T)
    const id = (await callOf(s.trip.id)).id
    expect(await rejectCall(env.DB, f.send, id, s.a, T + 1000)).toBe('rejected')
    expect(ends(f)).toEqual(['https://push.test/a', 'https://push.test/b'])
    expect(await acceptCall(env.DB, id, s.a, T + 2000)).toBe('rejected')
    // Run the roster out: the fallback to everyone skips Ayanda.
    for (const at of [T + 3 * MIN, T + 6 * MIN]) for (const call of await findCallsToEscalate(env.DB, at)) await escalate(env.DB, f.send, call, at)
    expect(ends(f).filter((e) => e === 'https://push.test/a')).toHaveLength(1)
    expect(ends(f)).toContain('https://push.test/z')
    const c = await callOf(s.trip.id)
    expect(canAccept(c, s.a)).toBe(false)
    expect(c.lines.map((l) => l.text)).toContain('Ayanda rejected.')
  })

  it('only someone the call reached can reject it', async () => {
    const s = await setup()
    await raiseCall(env.DB, fakeSender().send, s.trip.id, 'help', T)
    expect(await rejectCall(env.DB, fakeSender().send, (await callOf(s.trip.id)).id, s.c, T)).toBe('not_yours')
  })
})

describe('the record and closing', () => {
  it('noteOnCalls records explorer actions, and cancel help closes only the help call', async () => {
    const s = await setup()
    const f = fakeSender()
    await raiseCall(env.DB, f.send, s.trip.id, 'overdue', T)
    await noteOnCalls(env.DB, s.trip.id, T + 1000, 'help', s.explorer, null)
    await raiseCall(env.DB, f.send, s.trip.id, 'help', T + 1000)
    await noteOnCalls(env.DB, s.trip.id, T + 2000, 'help_cancelled', s.explorer, 'help')
    const [help, overdue] = await callsForTrip(env.DB, s.trip.id)
    expect(help!.kind).toBe('help')
    expect(help!.closed_at).toBe(T + 2000)
    expect(overdue!.closed_at).toBeNull()
    expect(overdue!.lines.map((l) => l.text)).toEqual(expect.arrayContaining(['Thandi called for help.', 'Thandi cancelled the call for help.']))
    expect(help!.lines.at(-1)?.text).toBe('Call closed.')
  })

  it('merges chat messages while the call is open, in time order, and keeps the record after it closes', async () => {
    // addMessage stamps Date.now(), and the Workers clock doesn't move during a test, so the call times sit around it.
    const s = await setup()
    const now = Date.now()
    await env.DB.prepare("INSERT INTO messages (trip_id, author_id, author_role, body, created_at) VALUES (?, ?, 'explorer', 'before the call', ?)")
      .bind(s.trip.id, s.explorer, now - 120_000).run()
    await raiseCall(env.DB, fakeSender().send, s.trip.id, 'help', now - 60_000)
    await addMessage(env.DB, s.trip.id, { id: s.explorer, role: 'explorer' }, 'my ankle')
    await noteOnCalls(env.DB, s.trip.id, now + 60_000, 'back', s.explorer, 'all')
    const c = await callOf(s.trip.id)
    const text = c.lines.map((l) => l.text)
    expect(text).toContain('Thandi: my ankle')
    expect(text).not.toContain('Thandi: before the call')
    expect(text.indexOf('Thandi: my ankle')).toBeLessThan(text.indexOf('Thandi is back safe.'))
    expect(c.closed_at).not.toBeNull()
  })

  it('closes calls left open on a closed trip', async () => {
    const s = await setup()
    await raiseCall(env.DB, fakeSender().send, s.trip.id, 'help', T)
    await markBack(env.DB, s.trip.id, T + 1000)
    expect(await closeCallsOfClosedTrips(env.DB, T + 2000)).toBe(1)
    expect((await getCall(env.DB, (await callOf(s.trip.id)).id))?.closed_at).toBe(T + 2000)
  })
})
