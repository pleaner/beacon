import { getSetting, type User } from './db'
import { pushToUser, type PushSender } from './push'

type DB = D1Database

// Shift lengths that divide a day, so every day's first shift starts at 06:00 South African time.
export const SHIFT_HOURS = [1, 2, 3, 4, 6, 8, 12, 24] as const
// 2026-01-01 06:00 in Johannesburg (UTC+2, no daylight saving). Slots are counted from here.
const ANCHOR = Date.UTC(2026, 0, 1, 4)
const HOUR = 3_600_000

export interface RosterEntry {
  user_id: string
  name: string
  sort: number
  available: number
  // Push subscriptions on file. Zero means alerts can't reach them; the page warns.
  devices: number
}

// Only operators and admins count, so someone made an explorer drops off without anyone editing the list.
export async function listRoster(db: DB): Promise<RosterEntry[]> {
  return (
    await db
      .prepare(
        `SELECT o.user_id, u.name, o.sort, o.available,
           (SELECT COUNT(*) FROM push_subscriptions s WHERE s.user_id = o.user_id) AS devices
         FROM oncall o JOIN users u ON u.id = o.user_id
         WHERE u.role IN ('operator','admin') ORDER BY o.sort, o.user_id`,
      )
      .all<RosterEntry>()
  ).results
}

export async function addToRoster(db: DB, userId: string): Promise<boolean> {
  const r = await db.prepare('INSERT OR IGNORE INTO oncall (user_id, sort) SELECT ?, COALESCE(MAX(sort), 0) + 1 FROM oncall').bind(userId).run()
  return r.meta.changes > 0
}

export async function removeFromRoster(db: DB, userId: string): Promise<boolean> {
  return (await db.prepare('DELETE FROM oncall WHERE user_id = ?').bind(userId).run()).meta.changes > 0
}

// Swaps with the neighbour above (-1) or below (1), then renumbers the whole list 1..n.
export async function moveInRoster(db: DB, userId: string, dir: -1 | 1): Promise<boolean> {
  const ids = (await listRoster(db)).map((r) => r.user_id)
  const i = ids.indexOf(userId)
  const j = i + dir
  if (i < 0 || j < 0 || j >= ids.length) return false
  ;[ids[i], ids[j]] = [ids[j]!, ids[i]!]
  const stmt = db.prepare('UPDATE oncall SET sort = ? WHERE user_id = ?')
  await db.batch(ids.map((id, n) => stmt.bind(n + 1, id)))
  return true
}

export async function setAvailable(db: DB, userId: string, available: boolean): Promise<boolean> {
  return (await db.prepare('UPDATE oncall SET available = ? WHERE user_id = ?').bind(available ? 1 : 0, userId).run()).meta.changes > 0
}

async function settings(db: DB) {
  const [h, m] = await Promise.all([getSetting(db, 'shift_hours', '8'), getSetting(db, 'no_response_minutes', '2')])
  const hours = Number(h)
  const minutes = Number(m)
  return {
    shiftHours: (SHIFT_HOURS as readonly number[]).includes(hours) ? hours : 8,
    noResponseMs: (Number.isInteger(minutes) && minutes > 0 ? minutes : 2) * 60_000,
  }
}

export const slotAt = (now: number, hours: number) => Math.floor((now - ANCHOR) / (hours * HOUR))
export const slotStart = (slot: number, hours: number) => ANCHOR + slot * hours * HOUR

// Slot n belongs to the nth person in the cycle. If they're unavailable, the next available person after them
// takes it, so skipping someone never moves anyone else's slots.
export function ownerOf(roster: RosterEntry[], slot: number): RosterEntry | null {
  const n = roster.length
  if (n === 0) return null
  const start = ((slot % n) + n) % n
  for (let i = 0; i < n; i++) {
    const r = roster[(start + i) % n]!
    if (r.available) return r
  }
  return null
}

// Who a call goes to, in turn: the person on shift, then on down the list and round, available people only.
export function escalationOrder(roster: RosterEntry[], firstId: string | null): RosterEntry[] {
  const avail = roster.filter((r) => r.available)
  const i = avail.findIndex((r) => r.user_id === firstId)
  return i < 0 ? avail : [...avail.slice(i), ...avail.slice(0, i)]
}

export interface Shift {
  onNow: RosterEntry | null
  // When someone else takes over; null when nobody else is available.
  until: number | null
  next: RosterEntry | null
  roster: RosterEntry[]
  shiftHours: number
  noResponseMs: number
}

export async function currentShift(db: DB, now: number): Promise<Shift> {
  const [roster, s] = await Promise.all([listRoster(db), settings(db)])
  const slot = slotAt(now, s.shiftHours)
  const onNow = ownerOf(roster, slot)
  let until: number | null = null
  let next: RosterEntry | null = null
  // Owners repeat every roster.length slots, so one cycle ahead is far enough to look.
  for (let k = 1; onNow && k <= roster.length; k++) {
    const o = ownerOf(roster, slot + k)
    if (o && o.user_id !== onNow.user_id) {
      until = slotStart(slot + k, s.shiftHours)
      next = o
      break
    }
  }
  return { onNow, until, next, roster, ...s }
}

export async function isOnCall(db: DB, userId: string, now: number): Promise<boolean> {
  return (await currentShift(db, now)).onNow?.user_id === userId
}

// Tells whoever has just gone on shift, by the clock or by a handover, and thanks whoever came off. The cron runs
// it every minute, and the roster routes run it straight after a change. Returns true when someone new went on.
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg' })

export async function syncShift(db: DB, send: PushSender, now: number): Promise<boolean> {
  const { onNow, until } = await currentShift(db, now)
  const id = onNow?.user_id ?? ''
  const prev = await getSetting(db, 'oncall_now', '')
  if (id === prev) return false
  // Conditional, so the cron and a roster change in the same moment don't both send it.
  const won = await db.prepare("UPDATE settings SET value = ? WHERE key = 'oncall_now' AND value = ?").bind(id, prev).run()
  if (won.meta.changes === 0) return false
  if (prev) {
    await pushToUser(db, send, prev, {
      title: 'Your shift has ended',
      body: 'Thank you for your service. Alerts now go to whoever is on call.',
      url: '/board/oncall',
      tag: 'oncall',
      kind: 'shift',
    })
  }
  if (!onNow) return false
  const ends = until == null ? 'It runs until someone else is available.' : `It ends at ${hhmm(until)}.`
  await pushToUser(db, send, onNow.user_id, {
    title: "You're on call",
    body: `Your shift has begun. ${ends} Overdue and help alerts come to you first.`,
    url: '/board/oncall',
    tag: 'oncall',
    kind: 'shift',
  })
  return true
}

const person = (r: RosterEntry | null) => (r ? { user_id: r.user_id, name: r.name } : null)

// Everything the On call page and the app's On call screen show.
export async function onCallState(db: DB, viewer: Pick<User, 'id' | 'role'>, now: number) {
  const s = await currentShift(db, now)
  const mine = s.roster.find((r) => r.user_id === viewer.id)
  const candidates = viewer.role === 'admin'
    ? (
        await db
          .prepare(`SELECT id AS user_id, name FROM users WHERE role IN ('operator','admin') AND id NOT IN (SELECT user_id FROM oncall) ORDER BY name`)
          .all<{ user_id: string; name: string }>()
      ).results
    : []
  return {
    on_now: person(s.onNow),
    until: s.until,
    next: person(s.next),
    shift_hours: s.shiftHours,
    no_response_minutes: s.noResponseMs / 60_000,
    roster: s.roster.map((r) => ({ user_id: r.user_id, name: r.name, available: !!r.available, devices: r.devices, on_now: r.user_id === s.onNow?.user_id })),
    me: { on_roster: !!mine, available: !!mine?.available, on_call: !!mine && s.onNow?.user_id === viewer.id },
    candidates,
  }
}
export type OnCallState = Awaited<ReturnType<typeof onCallState>>
