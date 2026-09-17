import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import {
  cancelHelp, extendTrip, findTripsToAlertOperators, findTripsToPrompt, getOpenTrip, getTrip,
  lastTripForUser, listOpenTrips, markBack, markOperatorsAlerted, markOverdue, operatorClose,
  previousShoePhotos, requestHelp, startTrip, TripOpenError, type NewTrip,
} from '../src/lib/trips'
import { makeExplorer } from './helpers'

const base: NewTrip = {
  activity: 'hike', area: 'table_mountain', route_text: 'Platteklip', companions_text: null,
  wearing_text: 'red jacket', photo_key: null, shoe_photo_key: null, start_lat: -33.96, start_lng: 18.41,
  start_accuracy: 12, return_by: 10_000, checklist: ['Water'], battery_at_start: 90,
}

async function trip(over: Partial<NewTrip> = {}, now = 1000) {
  const { user } = await makeExplorer()
  const t = await startTrip(env.DB, user.id, { ...base, ...over }, now)
  return { user, t }
}

describe('start and read', () => {
  it('starts an active trip and reads it back', async () => {
    const { user, t } = await trip()
    expect(t.status).toBe('active')
    expect(t.checklist_json).toBe('["Water"]')
    expect((await getTrip(env.DB, t.id))?.route_text).toBe('Platteklip')
    expect((await getOpenTrip(env.DB, user.id))?.id).toBe(t.id)
    expect((await lastTripForUser(env.DB, user.id))?.id).toBe(t.id)
  })

  it('refuses a second open trip for the same explorer', async () => {
    const { user } = await trip()
    await expect(startTrip(env.DB, user.id, base, 2000)).rejects.toBeInstanceOf(TripOpenError)
  })

  it('allows a new trip once the old one is closed', async () => {
    const { user, t } = await trip()
    await markBack(env.DB, t.id, 2000)
    const t2 = await startTrip(env.DB, user.id, base, 3000)
    expect(t2.id).not.toBe(t.id)
    expect((await getOpenTrip(env.DB, user.id))?.id).toBe(t2.id)
    expect((await lastTripForUser(env.DB, user.id))?.id).toBe(t2.id)
  })

  it('lists distinct previous shoe photos newest first', async () => {
    const { user, t } = await trip({ shoe_photo_key: 'shoe/a' })
    await markBack(env.DB, t.id, 2000)
    const t2 = await startTrip(env.DB, user.id, { ...base, shoe_photo_key: 'shoe/b' }, 3000)
    await markBack(env.DB, t2.id, 4000)
    await startTrip(env.DB, user.id, { ...base, shoe_photo_key: 'shoe/a' }, 5000)
    expect(await previousShoePhotos(env.DB, user.id)).toEqual(['shoe/a', 'shoe/b'])
  })
})

describe('transitions', () => {
  it('active -> overdue -> active by extend, resetting prompts', async () => {
    const { t } = await trip()
    expect(await markOverdue(env.DB, t.id, 10_001)).toBe(true)
    await markOperatorsAlerted(env.DB, t.id, 12_000)
    let cur = await getTrip(env.DB, t.id)
    expect(cur?.status).toBe('overdue')
    expect(cur?.prompted_at).toBe(10_001)
    expect(await extendTrip(env.DB, t.id, 20_000, 12_500)).toBe(true)
    cur = await getTrip(env.DB, t.id)
    expect(cur?.status).toBe('active')
    expect(cur?.return_by).toBe(20_000)
    expect(cur?.prompted_at).toBeNull()
    expect(cur?.operators_alerted_at).toBeNull()
  })

  it('extend rejects a time in the past', async () => {
    const { t } = await trip()
    expect(await extendTrip(env.DB, t.id, 900, 1000)).toBe(false)
  })

  it('markOverdue only applies to active trips past return_by', async () => {
    const { t } = await trip()
    expect(await markOverdue(env.DB, t.id, 9_999)).toBe(false)
    expect(await markOverdue(env.DB, t.id, 10_000)).toBe(true)
    expect(await markOverdue(env.DB, t.id, 10_000)).toBe(false)
  })

  it('back closes as safe from active and overdue, not from help', async () => {
    const a = await trip()
    expect(await markBack(env.DB, a.t.id, 2000)).toBe(true)
    expect((await getTrip(env.DB, a.t.id))?.closed_reason).toBe('safe')
    const b = await trip()
    await markOverdue(env.DB, b.t.id, 10_001)
    expect(await markBack(env.DB, b.t.id, 10_002)).toBe(true)
    const c = await trip()
    await requestHelp(env.DB, c.t.id, 2000)
    expect(await markBack(env.DB, c.t.id, 2001)).toBe(false)
  })

  it('help beats overdue and nothing automatic leaves it', async () => {
    const { t } = await trip()
    await markOverdue(env.DB, t.id, 10_001)
    expect(await requestHelp(env.DB, t.id, 10_002)).toBe(true)
    expect((await getTrip(env.DB, t.id))?.status).toBe('help')
    expect(await markOverdue(env.DB, t.id, 20_000)).toBe(false)
    expect(await extendTrip(env.DB, t.id, 30_000, 20_000)).toBe(false)
    expect(await requestHelp(env.DB, t.id, 10_003)).toBe(false)
  })

  it('cancelHelp only from help, closes as cancelled', async () => {
    const { t } = await trip()
    expect(await cancelHelp(env.DB, t.id, 2000)).toBe(false)
    await requestHelp(env.DB, t.id, 2000)
    expect(await cancelHelp(env.DB, t.id, 2001)).toBe(true)
    const cur = await getTrip(env.DB, t.id)
    expect(cur?.status).toBe('closed')
    expect(cur?.closed_reason).toBe('cancelled')
    expect(cur?.closed_at).toBe(2001)
  })

  it('operatorClose closes any open trip, and closed is final', async () => {
    const { t } = await trip()
    await requestHelp(env.DB, t.id, 2000)
    expect(await operatorClose(env.DB, t.id, 3000)).toBe(true)
    expect((await getTrip(env.DB, t.id))?.closed_reason).toBe('operator_closed')
    expect(await operatorClose(env.DB, t.id, 4000)).toBe(false)
    expect(await requestHelp(env.DB, t.id, 4000)).toBe(false)
    expect(await extendTrip(env.DB, t.id, 9_000_000, 4000)).toBe(false)
  })
})

describe('cron queries', () => {
  it('finds trips to prompt: active, past return_by, not yet prompted', async () => {
    const early = await trip({ return_by: 5000 })
    const late = await trip({ return_by: 50_000 })
    const done = await trip({ return_by: 5000 })
    await markOverdue(env.DB, done.t.id, 6000)
    const ids = (await findTripsToPrompt(env.DB, 6000)).map((t) => t.id)
    expect(ids).toContain(early.t.id)
    expect(ids).not.toContain(late.t.id)
    expect(ids).not.toContain(done.t.id)
  })

  it('finds trips to alert operators after the grace period', async () => {
    const grace = 30 * 60_000
    const a = await trip({ return_by: 5000 })
    await markOverdue(env.DB, a.t.id, 6000)
    const b = await trip({ return_by: 5000 })
    await markOverdue(env.DB, b.t.id, 6000)
    await markOperatorsAlerted(env.DB, b.t.id, 6000 + grace)
    const c = await trip({ return_by: 5000 })
    await markOverdue(env.DB, c.t.id, 6000 + grace)
    const ids = (await findTripsToAlertOperators(env.DB, 6000 + grace, grace)).map((t) => t.id)
    expect(ids).toContain(a.t.id)
    expect(ids).not.toContain(b.t.id)
    expect(ids).not.toContain(c.t.id)
  })
})

describe('board list', () => {
  it('orders help, overdue, active, then by return_by', async () => {
    const active2 = await trip({ return_by: 9000 })
    const active1 = await trip({ return_by: 8000 })
    const over = await trip({ return_by: 5000 })
    await markOverdue(env.DB, over.t.id, 6000)
    const help = await trip({ return_by: 9999 })
    await requestHelp(env.DB, help.t.id, 2000)
    const closed = await trip()
    await markBack(env.DB, closed.t.id, 2000)
    const rows = await listOpenTrips(env.DB)
    const ids = rows.map((r) => r.id)
    expect(ids).toEqual([help.t.id, over.t.id, active1.t.id, active2.t.id])
    expect(rows[0].user_name).toBe('explorer person')
  })
})
