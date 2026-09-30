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
  app_token_hash?: string | null
  created_at: number
  birthday: string | null
  gender: string | null
  height_cm: number | null
  weight_kg: number | null
  shoe_size: string | null
  language: string | null
  emergency_relation: string | null
  allergies: string | null
  conditions: string | null
  medication: string | null
  blood_type: string | null
}
type ProfileExtra = 'birthday' | 'gender' | 'height_cm' | 'weight_kg' | 'shoe_size' | 'language' | 'emergency_relation'
  | 'allergies' | 'conditions' | 'medication' | 'blood_type'
export type NewUser = Omit<User, 'id' | 'created_at' | 'token_hash' | ProfileExtra> &
  Partial<Pick<User, ProfileExtra>> & { token_hash?: string | null }

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
  altitude: number | null
  altitude_accuracy: number | null
  signal: string | null
  at: number
  received_at: number | null
}
export type NewPosition = Omit<Position, 'id' | 'altitude' | 'altitude_accuracy' | 'signal' | 'received_at'> &
  Partial<Pick<Position, 'altitude' | 'altitude_accuracy' | 'signal'>>

export const SIGNALS = ['none', 'slow-2g', '2g', '3g', '4g', 'online'] as const
// For operators: "No signal", "4G", "Weak", or "Signal" when the phone didn't say which kind.
export function signalLabel(s: string | null): string | null {
  if (!s) return null
  return s === 'none' ? 'No signal' : s === 'online' ? 'Signal' : s === 'slow-2g' ? 'Weak' : s.toUpperCase()
}

type DB = D1Database

// users

export async function createUser(db: DB, u: NewUser): Promise<User> {
  const id = crypto.randomUUID()
  const created_at = Date.now()
  await db
    .prepare(
      `INSERT INTO users (id, role, name, phone, email, organisation, emergency_name, emergency_phone,
        description, photo_key, consent_contact, token_hash, created_at,
        birthday, gender, height_cm, weight_kg, shoe_size, language, emergency_relation,
        allergies, conditions, medication, blood_type)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(id, u.role, u.name, u.phone, u.email, u.organisation, u.emergency_name, u.emergency_phone,
      u.description, u.photo_key, u.consent_contact ? 1 : 0, u.token_hash ?? null, created_at,
      u.birthday ?? null, u.gender ?? null, u.height_cm ?? null, u.weight_kg ?? null, u.shoe_size ?? null,
      u.language ?? null, u.emergency_relation ?? null,
      u.allergies ?? null, u.conditions ?? null, u.medication ?? null, u.blood_type ?? null)
    .run()
  return {
    birthday: null, gender: null, height_cm: null, weight_kg: null, shoe_size: null, language: null, emergency_relation: null,
    allergies: null, conditions: null, medication: null, blood_type: null,
    ...u, id, created_at, token_hash: u.token_hash ?? null,
  }
}

export function getUserById(db: DB, id: string) {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<User>()
}
// The web session cookie and the app's bearer token are separate, so each can sign out alone.
export function getUserByTokenHash(db: DB, hash: string) {
  return db.prepare('SELECT * FROM users WHERE token_hash = ?1 OR app_token_hash = ?1').bind(hash).first<User>()
}
export function getUserByEmail(db: DB, email: string) {
  return db
    .prepare(
      `SELECT * FROM users WHERE email = ? COLLATE NOCASE
       ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'operator' THEN 1 ELSE 2 END, created_at DESC`,
    )
    .bind(email)
    .first<User>()
}

const USER_COLS = ['role', 'name', 'phone', 'email', 'organisation', 'emergency_name', 'emergency_phone',
  'description', 'photo_key', 'consent_contact', 'token_hash', 'app_token_hash', 'birthday', 'gender', 'height_cm', 'weight_kg',
  'shoe_size', 'language', 'emergency_relation', 'allergies', 'conditions', 'medication', 'blood_type'] as const

export async function updateUser(db: DB, id: string, fields: Partial<Omit<User, 'id' | 'created_at'>>) {
  const cols = USER_COLS.filter((k) => k in fields)
  if (cols.length === 0) return
  const sets = cols.map((k) => `${k} = ?`).join(', ')
  const vals = cols.map((k) => (fields as Record<string, unknown>)[k])
  await db.prepare(`UPDATE users SET ${sets} WHERE id = ?`).bind(...vals, id).run()
}

// Issue at most one link a minute per user. Returns false while the last one is under a minute old.
export async function issueMagicLink(db: DB, id: string, expiresAt: number) {
  // Every link has the same TTL, so "previous link issued over a minute ago" is "previous expiry a minute before this one".
  const r = await db
    .prepare('UPDATE users SET magic_link_expires = ? WHERE id = ? AND (magic_link_expires IS NULL OR magic_link_expires <= ?)')
    .bind(expiresAt, id, expiresAt - 60_000)
    .run()
  return r.meta.changes > 0
}
export async function consumeMagicLink(db: DB, id: string, expiresAt: number) {
  const r = await db.prepare('UPDATE users SET magic_link_expires = NULL WHERE id = ? AND magic_link_expires = ?').bind(id, expiresAt).run()
  return r.meta.changes > 0
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
       ON CONFLICT(user_id, endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`,
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

const INSERT_POSITION =
  'INSERT OR IGNORE INTO positions (trip_id, lat, lng, accuracy, battery, altitude, altitude_accuracy, signal, at, received_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
const bindPosition = (stmt: D1PreparedStatement, p: NewPosition, now: number) =>
  stmt.bind(p.trip_id, p.lat, p.lng, p.accuracy, p.battery, p.altitude ?? null, p.altitude_accuracy ?? null, p.signal ?? null, p.at, now)

export async function insertPosition(db: DB, p: NewPosition) {
  await bindPosition(db.prepare(INSERT_POSITION), p, Date.now()).run()
}
// Returns how many rows were new; a fix already stored for that trip and moment is skipped.
export async function insertPositions(db: DB, rows: NewPosition[]): Promise<number> {
  if (rows.length === 0) return 0
  const stmt = db.prepare(INSERT_POSITION)
  const now = Date.now()
  const res = await db.batch(rows.map((p) => bindPosition(stmt, p, now)))
  return res.reduce((n, r) => n + r.meta.changes, 0)
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

// messages

export interface Message {
  id: number
  author_role: 'explorer' | 'operator'
  author_name: string
  body: string
  // 'image/…' or 'audio/…' when the message carries a photo or voice note
  media_type: string | null
  created_at: number
}
export const MAX_MESSAGE = 1000

export async function addMessage(db: DB, tripId: string, author: Pick<User, 'id' | 'role'>, body: string, media?: { key: string; type: string }) {
  await db
    .prepare('INSERT INTO messages (trip_id, author_id, author_role, body, media_key, media_type, created_at) VALUES (?,?,?,?,?,?,?)')
    .bind(tripId, author.id, author.role === 'explorer' ? 'explorer' : 'operator', body, media?.key ?? null, media?.type ?? null, Date.now())
    .run()
}
export function getMessageMedia(db: DB, tripId: string, id: number) {
  return db.prepare('SELECT media_key, media_type FROM messages WHERE trip_id = ? AND id = ? AND media_key IS NOT NULL').bind(tripId, id).first<{ media_key: string; media_type: string }>()
}
// ponytail: every poll sends the newest 200 in full; send only newer ids if threads get long
export async function listMessages(db: DB, tripId: string): Promise<Message[]> {
  const sql = `SELECT * FROM (
    SELECT m.id, m.author_role, COALESCE(u.name, 'SARZA') AS author_name, m.body, m.media_type, m.created_at
    FROM messages m LEFT JOIN users u ON u.id = m.author_id WHERE m.trip_id = ? ORDER BY m.id DESC LIMIT 200
  ) ORDER BY id`
  return (await db.prepare(sql).bind(tripId).all<Message>()).results
}
