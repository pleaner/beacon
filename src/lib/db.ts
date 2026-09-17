export type Role = 'explorer' | 'operator' | 'admin'

export interface User {
  id: string
  role: Role
  name: string
  phone: string
  email: string | null
  organisation: string | null
  emergency_name: string | null
  emergency_phone: string | null
  description: string | null
  photo_key: string | null
  consent_contact: number
  token_hash: string | null
  created_at: number
}
export type NewUser = Omit<User, 'id' | 'created_at' | 'token_hash'> & { token_hash?: string | null }

export interface PushSub {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  created_at: number
}

export interface Position {
  id: number
  trip_id: string
  lat: number
  lng: number
  accuracy: number | null
  battery: number | null
  at: number
}

type DB = D1Database

// ponytail: monotonic timestamp counter ensures tests with rapid user creation have deterministic ordering
let lastCreatedAt = 0
function getMonotonicNow(): number {
  const now = Date.now()
  lastCreatedAt = Math.max(lastCreatedAt + 1, now)
  return lastCreatedAt
}

// users

export async function createUser(db: DB, u: NewUser): Promise<User> {
  const id = crypto.randomUUID()
  const created_at = getMonotonicNow()
  await db
    .prepare(
      `INSERT INTO users (id, role, name, phone, email, organisation, emergency_name, emergency_phone,
        description, photo_key, consent_contact, token_hash, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(id, u.role, u.name, u.phone, u.email, u.organisation, u.emergency_name, u.emergency_phone,
      u.description, u.photo_key, u.consent_contact ? 1 : 0, u.token_hash ?? null, created_at)
    .run()
  return { ...u, id, created_at, token_hash: u.token_hash ?? null }
}

export function getUserById(db: DB, id: string) {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<User>()
}
export function getUserByTokenHash(db: DB, hash: string) {
  return db.prepare('SELECT * FROM users WHERE token_hash = ?').bind(hash).first<User>()
}
export function getUserByEmail(db: DB, email: string) {
  return db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').bind(email).first<User>()
}

const USER_COLS = ['role', 'name', 'phone', 'email', 'organisation', 'emergency_name', 'emergency_phone',
  'description', 'photo_key', 'consent_contact', 'token_hash'] as const

export async function updateUser(db: DB, id: string, fields: Partial<Omit<User, 'id' | 'created_at'>>) {
  const cols = USER_COLS.filter((k) => k in fields)
  if (cols.length === 0) return
  const sets = cols.map((k) => `${k} = ?`).join(', ')
  const vals = cols.map((k) => (fields as Record<string, unknown>)[k])
  await db.prepare(`UPDATE users SET ${sets} WHERE id = ?`).bind(...vals, id).run()
}

export async function setUserTokenHash(db: DB, id: string, hash: string) {
  await db.prepare('UPDATE users SET token_hash = ? WHERE id = ?').bind(hash, id).run()
}

export async function listUsers(db: DB): Promise<User[]> {
  return (await db.prepare('SELECT * FROM users ORDER BY created_at DESC, id DESC').all<User>()).results
}

export async function deleteUser(db: DB, id: string) {
  await db.prepare('DELETE FROM users WHERE id = ?').bind(id).run()
}

// settings

export async function getSetting(db: DB, key: string, fallback: string): Promise<string> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>()
  return row?.value ?? fallback
}
export async function setSetting(db: DB, key: string, value: string) {
  await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, value).run()
}

// checklists

export async function getChecklist(db: DB, activity: string): Promise<string[]> {
  const row = await db.prepare('SELECT items_text FROM checklists WHERE activity = ?').bind(activity).first<{ items_text: string }>()
  if (!row) return []
  return row.items_text.split('\n').map((s) => s.trim()).filter(Boolean)
}
export async function setChecklist(db: DB, activity: string, items: string[]) {
  const text = items.map((s) => s.trim()).filter(Boolean).join('\n')
  await db.prepare('INSERT INTO checklists (activity, items_text) VALUES (?, ?) ON CONFLICT(activity) DO UPDATE SET items_text = excluded.items_text')
    .bind(activity, text).run()
}

// push subscriptions

export async function addSubscription(db: DB, userId: string, sub: { endpoint: string; p256dh: string; auth: string }) {
  await db
    .prepare(
      `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at) VALUES (?,?,?,?,?,?)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    )
    .bind(crypto.randomUUID(), userId, sub.endpoint, sub.p256dh, sub.auth, Date.now())
    .run()
}
export async function listSubscriptionsForUser(db: DB, userId: string): Promise<PushSub[]> {
  return (await db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').bind(userId).all<PushSub>()).results
}
export async function listSubscriptionsForRoles(db: DB, roles: Role[]): Promise<PushSub[]> {
  if (roles.length === 0) return []
  const marks = roles.map(() => '?').join(',')
  return (
    await db
      .prepare(`SELECT s.* FROM push_subscriptions s JOIN users u ON u.id = s.user_id WHERE u.role IN (${marks})`)
      .bind(...roles)
      .all<PushSub>()
  ).results
}
export async function deleteSubscription(db: DB, endpoint: string) {
  await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).run()
}

// positions

export async function insertPosition(db: DB, p: Omit<Position, 'id'>) {
  await db.prepare('INSERT INTO positions (trip_id, lat, lng, accuracy, battery, at) VALUES (?,?,?,?,?,?)')
    .bind(p.trip_id, p.lat, p.lng, p.accuracy, p.battery, p.at).run()
}
export async function listPositions(db: DB, tripId: string, limit = 50): Promise<Position[]> {
  return (await db.prepare('SELECT * FROM positions WHERE trip_id = ? ORDER BY at DESC LIMIT ?').bind(tripId, limit).all<Position>()).results
}
export async function lastPositionsByTrip(db: DB, tripIds: string[]): Promise<Map<string, Position>> {
  const out = new Map<string, Position>()
  if (tripIds.length === 0) return out
  const marks = tripIds.map(() => '?').join(',')
  const rows = (
    await db
      .prepare(
        `SELECT p.* FROM positions p
         JOIN (SELECT trip_id, MAX(at) AS at FROM positions WHERE trip_id IN (${marks}) GROUP BY trip_id) m
         ON m.trip_id = p.trip_id AND m.at = p.at`,
      )
      .bind(...tripIds)
      .all<Position>()
  ).results
  for (const r of rows) out.set(r.trip_id, r)
  return out
}
export async function prunePositions(db: DB, before: number): Promise<number> {
  const res = await db.prepare('DELETE FROM positions WHERE at < ?').bind(before).run()
  return res.meta.changes
}
