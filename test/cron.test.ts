import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { addSubscription, insertPosition, listPositions, setSetting } from '../src/lib/db'
import { runCron } from '../src/lib/cron'
import { getTrip, startTrip, type NewTrip } from '../src/lib/trips'
import { fakeSender, makeExplorer, makeOperator } from './helpers'

const base: NewTrip = {
  activity: 'hike', area: 'cederberg', route_text: null, companions_text: null, wearing_text: null,
  photo_key: null, shoe_photo_key: null, start_lat: null, start_lng: null, start_accuracy: null,
  return_by: 10_000, checklist: [], battery_at_start: null,
}
const GRACE = 30 * 60_000

async function setup() {
  const e = await makeExplorer({ name: 'Thandi' })
  const o = await makeOperator()
  await addSubscription(env.DB, e.user.id, { endpoint: 'https://push.test/e', p256dh: 'k', auth: 'a' })
  await addSubscription(env.DB, o.user.id, { endpoint: 'https://push.test/o', p256dh: 'k', auth: 'a' })
  const t = await startTrip(env.DB, e.user.id, base, 1000)
  return { e, o, t }
}

describe('runCron', () => {
  it('does nothing before return_by', async () => {
    await setup()
    const f = fakeSender()
    const r = await runCron(env, f.send, 9_999)
    expect(r.prompted).toBe(0)
    expect(f.sent).toHaveLength(0)
  })

  it('prompts the explorer once when overdue, and does not repeat', async () => {
    const { t } = await setup()
    const f = fakeSender()
    const r = await runCron(env, f.send, 10_000)
    expect(r.prompted).toBe(1)
    expect(f.sent).toHaveLength(1)
    expect(f.sent[0].endpoint).toBe('https://push.test/e')
    expect(f.sent[0].payload.tag).toBe('overdue')
    expect(f.sent[0].payload.requireInteraction).toBe(true)
    expect((await getTrip(env.DB, t.id))?.status).toBe('overdue')
    const r2 = await runCron(env, f.send, 10_060)
    expect(r2.prompted).toBe(0)
    expect(f.sent).toHaveLength(1)
  })

  it('alerts operators only after the grace period, once', async () => {
    const { t } = await setup()
    const f = fakeSender()
    await runCron(env, f.send, 10_000)
    let r = await runCron(env, f.send, 10_000 + GRACE - 1)
    expect(r.alerted).toBe(0)
    r = await runCron(env, f.send, 10_000 + GRACE)
    expect(r.alerted).toBe(1)
    const op = f.sent.find((s) => s.endpoint === 'https://push.test/o')
    expect(op?.payload.title).toBe('Overdue: Thandi')
    expect(op?.payload.body).toContain('Hike in Cederberg')
    expect(op?.payload.url).toBe(`/board/trips/${t.id}`)
    r = await runCron(env, f.send, 10_000 + GRACE + 60_000)
    expect(r.alerted).toBe(0)
    expect(f.sent.filter((s) => s.endpoint === 'https://push.test/o')).toHaveLength(1)
  })

  it('respects the grace_minutes setting', async () => {
    await setup()
    await setSetting(env.DB, 'grace_minutes', '5')
    const f = fakeSender()
    await runCron(env, f.send, 10_000)
    const r = await runCron(env, f.send, 10_000 + 5 * 60_000)
    expect(r.alerted).toBe(1)
  })

  it('keeps going when one push throws', async () => {
    const a = await setup()
    const b = await makeExplorer()
    await addSubscription(env.DB, b.user.id, { endpoint: 'https://push.test/b', p256dh: 'k', auth: 'a' })
    const tb = await startTrip(env.DB, b.user.id, base, 1000)
    const f = fakeSender()
    f.statusFor.set('https://push.test/e', 0)
    const r = await runCron(env, f.send, 10_000)
    expect(r.prompted).toBe(2)
    expect((await getTrip(env.DB, a.t.id))?.status).toBe('overdue')
    expect((await getTrip(env.DB, tb.id))?.status).toBe('overdue')
    expect(f.sent.map((s) => s.endpoint)).toEqual(['https://push.test/b'])
  })

  it('prunes positions older than 30 days', async () => {
    const { t } = await setup()
    const now = 40 * 24 * 60 * 60_000
    await insertPosition(env.DB, { trip_id: t.id, lat: 0, lng: 0, accuracy: null, battery: null, at: now - 31 * 24 * 60 * 60_000 })
    await insertPosition(env.DB, { trip_id: t.id, lat: 0, lng: 0, accuracy: null, battery: null, at: now - 1000 })
    const r = await runCron(env, fakeSender().send, now)
    expect(r.pruned).toBe(1)
    expect(await listPositions(env.DB, t.id)).toHaveLength(1)
  })
})
