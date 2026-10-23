import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { addSubscription, deleteUser, getSetting, setSetting, updateUser } from '../src/lib/db'
import {
  addToRoster, currentShift, escalationOrder, listRoster, moveInRoster, onCallState, removeFromRoster, setAvailable, slotAt, slotStart, syncShift,
} from '../src/lib/oncall'
import { fakeSender, makeExplorer, makeOperator } from './helpers'

// Slot 300 is a multiple of 3, so with three people it belongs to the first one on the list.
const T = slotStart(300, 8)
const H = 3_600_000

async function three() {
  const a = await makeOperator({ name: 'Ayanda' })
  const b = await makeOperator({ name: 'Bongani' })
  const c = await makeOperator({ name: 'Chloe' })
  for (const p of [a, b, c]) await addToRoster(env.DB, p.user.id)
  return { a: a.user.id, b: b.user.id, c: c.user.id }
}

describe('shift slots', () => {
  it('start at 06:00, 14:00 and 22:00 in Johannesburg', () => {
    const six = Date.UTC(2026, 5, 1, 4) // 06:00 SAST
    expect(slotAt(six, 8)).toBe(slotAt(six - 1, 8) + 1)
    expect(slotAt(six + 8 * H, 8)).toBe(slotAt(six, 8) + 1)
    expect(slotStart(slotAt(six + 5 * H, 8), 8)).toBe(six)
  })
})

describe('currentShift', () => {
  it('cycles through the roster in order', async () => {
    const { a, b, c } = await three()
    expect((await currentShift(env.DB, T)).onNow?.user_id).toBe(a)
    expect((await currentShift(env.DB, T + 8 * H)).onNow?.user_id).toBe(b)
    expect((await currentShift(env.DB, T + 16 * H)).onNow?.user_id).toBe(c)
    expect((await currentShift(env.DB, T + 24 * H)).onNow?.user_id).toBe(a)
    const s = await currentShift(env.DB, T + H)
    expect(s.until).toBe(T + 8 * H)
    expect(s.next?.user_id).toBe(b)
  })

  it('gives an unavailable person’s slot to the next available one and leaves the others where they were', async () => {
    const { a, b, c } = await three()
    await setAvailable(env.DB, b, false)
    expect((await currentShift(env.DB, T)).onNow?.user_id).toBe(a)
    expect((await currentShift(env.DB, T + 8 * H)).onNow?.user_id).toBe(c)
    expect((await currentShift(env.DB, T + 16 * H)).onNow?.user_id).toBe(c)
    const s = await currentShift(env.DB, T + H)
    expect(s.next?.user_id).toBe(c)
    expect(s.until).toBe(T + 8 * H)
  })

  it('hands the rest of the shift on when the person on shift goes unavailable', async () => {
    const { a, b } = await three()
    await setAvailable(env.DB, a, false)
    expect((await currentShift(env.DB, T + H)).onNow?.user_id).toBe(b)
  })

  it('has nobody on with an empty list or everyone unavailable', async () => {
    expect((await currentShift(env.DB, T)).onNow).toBeNull()
    const { a, b, c } = await three()
    for (const id of [a, b, c]) await setAvailable(env.DB, id, false)
    const s = await currentShift(env.DB, T)
    expect(s.onNow).toBeNull()
    expect(s.next).toBeNull()
  })

  it('junk shift_hours falls back to 8', async () => {
    await three()
    await setSetting(env.DB, 'shift_hours', 'banana')
    expect((await currentShift(env.DB, T)).shiftHours).toBe(8)
    await setSetting(env.DB, 'shift_hours', '5')
    expect((await currentShift(env.DB, T)).shiftHours).toBe(8)
  })
})

describe('roster', () => {
  it('adds once, moves, and removes', async () => {
    const { a, b, c } = await three()
    expect(await addToRoster(env.DB, a)).toBe(false)
    expect(await moveInRoster(env.DB, c, -1)).toBe(true)
    expect((await listRoster(env.DB)).map((r) => r.user_id)).toEqual([a, c, b])
    expect(await moveInRoster(env.DB, a, -1)).toBe(false)
    expect(await removeFromRoster(env.DB, c)).toBe(true)
    expect((await listRoster(env.DB)).map((r) => r.user_id)).toEqual([a, b])
  })

  it('role and delete: drops people who are no longer operators or admins', async () => {
    const { a, b, c } = await three()
    await updateUser(env.DB, b, { role: 'explorer' })
    await deleteUser(env.DB, c)
    expect((await listRoster(env.DB)).map((r) => r.user_id)).toEqual([a])
  })

  it('counts each person’s devices', async () => {
    const { a } = await three()
    await addSubscription(env.DB, a, { endpoint: 'https://push.test/a', p256dh: 'k', auth: 'x' })
    const r = await listRoster(env.DB)
    expect(r.find((x) => x.user_id === a)?.devices).toBe(1)
    expect(r.filter((x) => x.devices === 0)).toHaveLength(2)
  })
})

describe('escalationOrder', () => {
  it('starts with the person on shift, cycles, and skips the unavailable', async () => {
    const { a, b, c } = await three()
    await setAvailable(env.DB, a, false)
    const roster = await listRoster(env.DB)
    expect(escalationOrder(roster, c).map((r) => r.user_id)).toEqual([c, b])
    expect(escalationOrder(roster, null).map((r) => r.user_id)).toEqual([b, c])
  })
})

describe('syncShift', () => {
  it('tells the person going on shift once, and again on a handover', async () => {
    const { a, b } = await three()
    await addSubscription(env.DB, a, { endpoint: 'https://push.test/a', p256dh: 'k', auth: 'x' })
    await addSubscription(env.DB, b, { endpoint: 'https://push.test/b', p256dh: 'k', auth: 'x' })
    const f = fakeSender()
    expect(await syncShift(env.DB, f.send, T)).toBe(true)
    expect(await syncShift(env.DB, f.send, T + 60_000)).toBe(false)
    expect(f.sent.map((s) => s.endpoint)).toEqual(['https://push.test/a'])
    expect(f.sent[0].payload.kind).toBe('shift')
    expect(f.sent[0].payload.url).toBe('/board/oncall')
    await setAvailable(env.DB, a, false)
    expect(await syncShift(env.DB, f.send, T + 120_000)).toBe(true)
    expect(f.sent.map((s) => s.endpoint)).toEqual(['https://push.test/a', 'https://push.test/b'])
    expect(await getSetting(env.DB, 'oncall_now', '')).toBe(b)
  })

  it('pushes nothing when nobody is on call', async () => {
    const f = fakeSender()
    expect(await syncShift(env.DB, f.send, T)).toBe(false)
    expect(f.sent).toHaveLength(0)
  })
})

describe('onCallState', () => {
  it('describes the shift for the viewer, with add candidates for admins only', async () => {
    const { a } = await three()
    const spare = await makeOperator({ name: 'Dineo' })
    await makeExplorer()
    const asOp = await onCallState(env.DB, { id: a, role: 'operator' }, T)
    expect(asOp.on_now?.user_id).toBe(a)
    expect(asOp.me).toEqual({ on_roster: true, available: true, on_call: true })
    expect(asOp.candidates).toEqual([])
    expect(asOp.roster).toHaveLength(3)
    const asAdmin = await onCallState(env.DB, { id: spare.user.id, role: 'admin' }, T)
    expect(asAdmin.me.on_roster).toBe(false)
    expect(asAdmin.candidates.map((x) => x.name)).toEqual(['Dineo'])
  })
})
