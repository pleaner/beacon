import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import {
  addSubscription, deleteSubscription, deleteUser, getChecklist, getSetting, getUserByEmail,
  getUserById, getUserByTokenHash, insertPosition, lastPositionsByTrip, listPositions,
  listSubscriptionsForRoles, listSubscriptionsForUser, listUsers, prunePositions, setChecklist,
  setSetting, updateUser,
} from '../src/lib/db'
import { hashToken } from '../src/lib/auth'
import { makeAdmin, makeExplorer, makeOperator } from './helpers'

describe('users', () => {
  it('creates and finds by id, token hash, email', async () => {
    const { user, token } = await makeOperator()
    expect((await getUserById(env.DB, user.id))?.name).toBe('operator person')
    expect((await getUserByTokenHash(env.DB, await hashToken(token)))?.id).toBe(user.id)
    expect((await getUserByEmail(env.DB, user.email!))?.id).toBe(user.id)
    expect(await getUserByEmail(env.DB, 'nobody@x')).toBeNull()
  })

  it('updates, lists newest first, deletes', async () => {
    const a = await makeExplorer({ name: 'A' })
    await new Promise((r) => setTimeout(r, 3))
    const b = await makeExplorer({ name: 'B' })
    await updateUser(env.DB, a.user.id, { name: 'A2', consent_contact: 0 })
    expect((await getUserById(env.DB, a.user.id))?.name).toBe('A2')
    const names = (await listUsers(env.DB)).map((u) => u.name)
    expect(names.indexOf('B')).toBeLessThan(names.indexOf('A2'))
    await deleteUser(env.DB, b.user.id)
    expect(await getUserById(env.DB, b.user.id)).toBeNull()
  })
})

describe('settings and checklists', () => {
  it('reads seed and updates', async () => {
    expect(await getSetting(env.DB, 'grace_minutes', '99')).toBe('30')
    expect(await getSetting(env.DB, 'missing', '7')).toBe('7')
    await setSetting(env.DB, 'grace_minutes', '45')
    expect(await getSetting(env.DB, 'grace_minutes', '99')).toBe('45')
  })

  it('splits checklist lines and trims blanks', async () => {
    expect((await getChecklist(env.DB, 'hike'))[0]).toBe('Phone battery above 50%')
    await setChecklist(env.DB, 'hike', ['One', '', '  Two  '])
    expect(await getChecklist(env.DB, 'hike')).toEqual(['One', 'Two'])
    expect(await getChecklist(env.DB, 'unknown')).toEqual([])
  })
})

describe('subscriptions', () => {
  it('upserts by endpoint, lists by user and role, deletes', async () => {
    const e = await makeExplorer()
    const o = await makeOperator()
    const a = await makeAdmin()
    await addSubscription(env.DB, e.user.id, { endpoint: 'https://p/1', p256dh: 'k', auth: 'a' })
    await addSubscription(env.DB, e.user.id, { endpoint: 'https://p/1', p256dh: 'k2', auth: 'a2' })
    await addSubscription(env.DB, o.user.id, { endpoint: 'https://p/2', p256dh: 'k', auth: 'a' })
    await addSubscription(env.DB, a.user.id, { endpoint: 'https://p/3', p256dh: 'k', auth: 'a' })
    const mine = await listSubscriptionsForUser(env.DB, e.user.id)
    expect(mine).toHaveLength(1)
    expect(mine[0].p256dh).toBe('k2')
    const ops = await listSubscriptionsForRoles(env.DB, ['operator', 'admin'])
    expect(ops.map((s) => s.endpoint).sort()).toEqual(['https://p/2', 'https://p/3'])
    await deleteSubscription(env.DB, 'https://p/2')
    expect(await listSubscriptionsForRoles(env.DB, ['operator'])).toHaveLength(0)
  })
})

describe('positions', () => {
  it('inserts, lists newest first, finds last per trip, prunes', async () => {
    const { user } = await makeExplorer()
    const tripId = crypto.randomUUID()
    await env.DB.prepare(
      "INSERT INTO trips (id,user_id,activity,area,start_at,return_by,status,created_at) VALUES (?,?,?,?,?,?,?,?)",
    ).bind(tripId, user.id, 'hike', 'other', 1000, 5000, 'active', 1000).run()
    await insertPosition(env.DB, { trip_id: tripId, lat: -33.9, lng: 18.4, accuracy: 10, battery: 80, at: 1000 })
    await insertPosition(env.DB, { trip_id: tripId, lat: -33.8, lng: 18.5, accuracy: null, battery: null, at: 2000 })
    const list = await listPositions(env.DB, tripId)
    expect(list.map((p) => p.at)).toEqual([2000, 1000])
    const last = await lastPositionsByTrip(env.DB, [tripId, 'nope'])
    expect(last.get(tripId)?.lat).toBe(-33.8)
    expect(last.has('nope')).toBe(false)
    expect(await prunePositions(env.DB, 1500)).toBe(1)
    expect(await listPositions(env.DB, tripId)).toHaveLength(1)
  })
})
