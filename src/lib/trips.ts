import type { Activity, Area } from './constants'

export type TripStatus = 'active' | 'overdue' | 'help' | 'closed'
export type ClosedReason = 'safe' | 'cancelled' | 'operator_closed'

export interface Trip {
  id: string
  user_id: string
  activity: Activity
  area: Area
  route_text: string | null
  companions_text: string | null
  wearing_text: string | null
  photo_key: string | null
  shoe_photo_key: string | null
  start_lat: number | null
  start_lng: number | null
  start_accuracy: number | null
  start_at: number
  return_by: number
  checklist_json: string
  battery_at_start: number | null
  status: TripStatus
  prompted_at: number | null
  operators_alerted_at: number | null
  closed_at: number | null
  closed_reason: ClosedReason | null
  created_at: number
}

export interface NewTrip {
  activity: Activity
  area: Area
  route_text: string | null
  companions_text: string | null
  wearing_text: string | null
  photo_key: string | null
  shoe_photo_key: string | null
  start_lat: number | null
  start_lng: number | null
  start_accuracy: number | null
  return_by: number
  checklist: string[]
  battery_at_start: number | null
}

export type OpenTripRow = Trip & { user_name: string; user_phone: string }

export class TripOpenError extends Error {
  constructor() {
    super('You already have an open trip')
  }
}

type DB = D1Database

export async function startTrip(db: DB, userId: string, t: NewTrip, now: number): Promise<Trip> {
  const id = crypto.randomUUID()
  try {
    await db
      .prepare(
        `INSERT INTO trips (id, user_id, activity, area, route_text, companions_text, wearing_text, photo_key,
          shoe_photo_key, start_lat, start_lng, start_accuracy, start_at, return_by, checklist_json,
          battery_at_start, status, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?)`,
      )
      .bind(id, userId, t.activity, t.area, t.route_text, t.companions_text, t.wearing_text, t.photo_key,
        t.shoe_photo_key, t.start_lat, t.start_lng, t.start_accuracy, now, t.return_by,
        JSON.stringify(t.checklist), t.battery_at_start, now)
      .run()
  } catch (e) {
    if (String(e).includes('UNIQUE')) throw new TripOpenError()
    throw e
  }
  return (await getTrip(db, id))!
}

export function getTrip(db: DB, id: string) {
  return db.prepare('SELECT * FROM trips WHERE id = ?').bind(id).first<Trip>()
}
export function getOpenTrip(db: DB, userId: string) {
  return db.prepare("SELECT * FROM trips WHERE user_id = ? AND status != 'closed'").bind(userId).first<Trip>()
}
export function lastTripForUser(db: DB, userId: string) {
  return db.prepare('SELECT * FROM trips WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').bind(userId).first<Trip>()
}
export async function previousShoePhotos(db: DB, userId: string): Promise<string[]> {
  const rows = (
    await db
      .prepare(
        `SELECT shoe_photo_key AS k, MAX(created_at) AS latest FROM trips
         WHERE user_id = ? AND shoe_photo_key IS NOT NULL GROUP BY shoe_photo_key ORDER BY latest DESC LIMIT 5`,
      )
      .bind(userId)
      .all<{ k: string }>()
  ).results
  return rows.map((r) => r.k)
}

// transitions. Each returns true only when a row changed.

async function changed(stmt: D1PreparedStatement): Promise<boolean> {
  return (await stmt.run()).meta.changes > 0
}

export function extendTrip(db: DB, id: string, newReturnBy: number, now: number) {
  if (newReturnBy <= now) return Promise.resolve(false)
  return changed(
    db
      .prepare(
        `UPDATE trips SET status = 'active', return_by = ?, prompted_at = NULL, operators_alerted_at = NULL
         WHERE id = ? AND status IN ('active','overdue')`,
      )
      .bind(newReturnBy, id),
  )
}
export function markBack(db: DB, id: string, now: number) {
  return changed(
    db.prepare(`UPDATE trips SET status = 'closed', closed_at = ?, closed_reason = 'safe' WHERE id = ? AND status IN ('active','overdue')`).bind(now, id),
  )
}
export function requestHelp(db: DB, id: string, _now: number) {
  return changed(db.prepare(`UPDATE trips SET status = 'help' WHERE id = ? AND status IN ('active','overdue')`).bind(id))
}
export function cancelHelp(db: DB, id: string, now: number) {
  return changed(
    db.prepare(`UPDATE trips SET status = 'closed', closed_at = ?, closed_reason = 'cancelled' WHERE id = ? AND status = 'help'`).bind(now, id),
  )
}
export function operatorClose(db: DB, id: string, now: number) {
  return changed(
    db.prepare(`UPDATE trips SET status = 'closed', closed_at = ?, closed_reason = 'operator_closed' WHERE id = ? AND status != 'closed'`).bind(now, id),
  )
}
export function markOverdue(db: DB, id: string, now: number) {
  return changed(
    db
      .prepare(`UPDATE trips SET status = 'overdue', prompted_at = ? WHERE id = ? AND status = 'active' AND return_by <= ? AND prompted_at IS NULL`)
      .bind(now, id, now),
  )
}
export function markOperatorsAlerted(db: DB, id: string, now: number) {
  return changed(db.prepare(`UPDATE trips SET operators_alerted_at = ? WHERE id = ? AND status = 'overdue' AND operators_alerted_at IS NULL`).bind(now, id))
}

// cron queries

export async function findTripsToPrompt(db: DB, now: number): Promise<Trip[]> {
  return (await db.prepare(`SELECT * FROM trips WHERE status = 'active' AND return_by <= ? AND prompted_at IS NULL`).bind(now).all<Trip>()).results
}
export async function findTripsToAlertOperators(db: DB, now: number, graceMs: number): Promise<Trip[]> {
  return (
    await db
      .prepare(`SELECT * FROM trips WHERE status = 'overdue' AND prompted_at <= ? AND operators_alerted_at IS NULL`)
      .bind(now - graceMs)
      .all<Trip>()
  ).results
}

// board

export async function listOpenTrips(db: DB): Promise<OpenTripRow[]> {
  return (
    await db
      .prepare(
        `SELECT t.*, u.name AS user_name, u.phone AS user_phone FROM trips t JOIN users u ON u.id = t.user_id
         WHERE t.status != 'closed'
         ORDER BY CASE t.status WHEN 'help' THEN 0 WHEN 'overdue' THEN 1 ELSE 2 END, t.return_by ASC`,
      )
      .all<OpenTripRow>()
  ).results
}

// new trip form

export const SA_OFFSET_MS = 2 * 60 * 60 * 1000

export function parseReturnBy(value: string | number | null | undefined, now: number): number | null {
  let ms: number
  if (typeof value === 'number') ms = value
  else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
    const [d, t] = value.split('T')
    const [y, mo, da] = d.split('-').map(Number)
    const [h, mi] = t.split(':').map(Number)
    ms = Date.UTC(y, mo - 1, da, h, mi) - SA_OFFSET_MS
  } else return null
  if (!Number.isFinite(ms) || ms <= now) return null
  return ms
}

export function toLocalInput(ms: number): string {
  return new Date(ms + SA_OFFSET_MS).toISOString().slice(0, 16)
}
