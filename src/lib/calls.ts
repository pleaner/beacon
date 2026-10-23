import { getSetting, getUserById, listMessages, listSubscriptionsForRoles } from './db'
import { currentShift, escalationOrder } from './oncall'
import { helpPayload, pushToSubs, pushToUser, type PushPayload, type PushSender } from './push'
import { getTrip, tripLine } from './trips'

type DB = D1Database

export type CallKind = 'overdue' | 'help'
export interface Call {
  id: string
  trip_id: string
  kind: CallKind
  started_at: number
  next_at: number | null
  everyone_at: number | null
  accepted_by: string | null
  accepted_at: number | null
  closed_at: number | null
}
export interface CallTarget {
  user_id: string
  name: string | null
  alerted_at: number
  rejected_at: number | null
}
export type CallEvent =
  | 'started' | 'alerted' | 'no_device' | 'no_response' | 'rejected' | 'accepted' | 'everyone'
  | 'extended' | 'help' | 'help_cancelled' | 'back' | 'siren' | 'closed_trip' | 'admin_status' | 'closed'

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg' })
}

async function addEvent(db: DB, callId: string, at: number, kind: CallEvent, userId: string | null = null, detail: string | null = null) {
  await db.prepare('INSERT INTO call_events (call_id, at, kind, user_id, detail) VALUES (?,?,?,?,?)').bind(callId, at, kind, userId, detail).run()
}

export function getCall(db: DB, id: string) {
  return db.prepare('SELECT * FROM calls WHERE id = ?').bind(id).first<Call>()
}
async function listOpenCalls(db: DB, tripId: string): Promise<Call[]> {
  return (await db.prepare('SELECT * FROM calls WHERE trip_id = ? AND closed_at IS NULL').bind(tripId).all<Call>()).results
}
async function listTargets(db: DB, callId: string): Promise<CallTarget[]> {
  return (
    await db
      .prepare(
        `SELECT t.user_id, u.name, t.alerted_at, t.rejected_at FROM call_targets t LEFT JOIN users u ON u.id = t.user_id
         WHERE t.call_id = ? ORDER BY t.alerted_at, t.rowid`,
      )
      .bind(callId)
      .all<CallTarget>()
  ).results
}
async function stillOpen(db: DB, id: string): Promise<boolean> {
  const c = await getCall(db, id)
  return !!c && c.closed_at == null && c.accepted_at == null
}

// What an operator's phone shows for this call. Null when the trip or explorer is gone.
async function callPayload(db: DB, call: Call): Promise<PushPayload | null> {
  const trip = await getTrip(db, call.trip_id)
  const user = trip && (await getUserById(db, trip.user_id))
  if (!trip || !user) return null
  if (call.kind === 'help') return helpPayload(user, trip)
  const grace = await getSetting(db, 'grace_minutes', '30')
  return {
    title: `Overdue: ${user.name}`,
    body: `${tripLine(trip)}, due ${formatTime(trip.return_by)}. No answer for ${grace} min.`,
    url: `/board/trips/${trip.id}`,
    tag: `trip-${trip.id}`,
    kind: 'overdue',
  }
}

// Starts the trip's call of this kind, or finds the one already open, and sends it on.
export async function raiseCall(db: DB, send: PushSender, tripId: string, kind: CallKind, now: number) {
  const id = crypto.randomUUID()
  const ins = await db
    .prepare('INSERT OR IGNORE INTO calls (id, trip_id, kind, started_at, next_at) VALUES (?,?,?,?,?)')
    .bind(id, tripId, kind, now, now)
    .run()
  if (ins.meta.changes > 0) await addEvent(db, id, now, 'started', null, kind)
  const call = await db.prepare('SELECT * FROM calls WHERE trip_id = ? AND kind = ? AND closed_at IS NULL').bind(tripId, kind).first<Call>()
  if (!call) return { sent: 0, accepted: false }
  // An open call that is already waiting on someone's answer, or has gone to everyone, isn't sent on again here.
  const waiting = ins.meta.changes === 0 && (call.next_at != null || call.everyone_at != null)
  return { sent: waiting ? 0 : await advance(db, send, call, now), accepted: call.accepted_at != null }
}

// Sends the call to the next person in turn who hasn't had it. Someone with no working device is passed over in
// the same run. When the turns run out, or nobody is on call, it goes to every operator and admin who hasn't
// rejected it. Returns how many devices it reached.
export async function advance(db: DB, send: PushSender, call: Call, now: number): Promise<number> {
  if (call.closed_at != null || call.accepted_at != null || call.everyone_at != null) return 0
  const payload = await callPayload(db, call)
  if (!payload) return 0
  const { roster, onNow, noResponseMs } = await currentShift(db, now)
  const targets = await listTargets(db, call.id)
  const had = new Set(targets.map((t) => t.user_id))
  for (const r of escalationOrder(roster, onNow?.user_id ?? null)) {
    if (had.has(r.user_id)) continue
    if (!(await stillOpen(db, call.id))) return 0
    // Claim them before pushing, so two runs at once never alert the same person twice.
    const claimed = await db
      .prepare('INSERT OR IGNORE INTO call_targets (call_id, user_id, alerted_at) VALUES (?,?,?)')
      .bind(call.id, r.user_id, now)
      .run()
    if (claimed.meta.changes === 0) continue
    const { sent } = await pushToUser(db, send, r.user_id, payload)
    await addEvent(db, call.id, now, sent > 0 ? 'alerted' : 'no_device', r.user_id, String(sent))
    if (sent > 0) {
      await db.prepare('UPDATE calls SET next_at = ? WHERE id = ? AND accepted_at IS NULL AND closed_at IS NULL').bind(now + noResponseMs, call.id).run()
      return sent
    }
  }
  if (!(await stillOpen(db, call.id))) return 0
  const rejected = new Set((await listTargets(db, call.id)).filter((t) => t.rejected_at != null).map((t) => t.user_id))
  const subs = (await listSubscriptionsForRoles(db, ['operator', 'admin'])).filter((s) => !rejected.has(s.user_id))
  const { sent } = await pushToSubs(db, send, subs, payload)
  if (sent > 0) {
    await db.prepare('UPDATE calls SET everyone_at = ?, next_at = NULL WHERE id = ? AND everyone_at IS NULL').bind(now, call.id).run()
    await addEvent(db, call.id, now, 'everyone', null, roster.some((r) => r.available) ? 'end_of_roster' : 'nobody_on_call')
  } else {
    // Nobody got it. The trip stays unalerted, so the cron raises this call again next minute.
    await db.prepare('UPDATE calls SET next_at = NULL WHERE id = ?').bind(call.id).run()
    console.error('call reached no one', call.id)
  }
  return sent
}

export async function findCallsToEscalate(db: DB, now: number): Promise<Call[]> {
  return (
    await db
      .prepare('SELECT * FROM calls WHERE closed_at IS NULL AND accepted_at IS NULL AND everyone_at IS NULL AND next_at <= ?')
      .bind(now)
      .all<Call>()
  ).results
}

// The no-response time ran out: say who didn't answer, then pass it on.
export async function escalate(db: DB, send: PushSender, call: Call, now: number): Promise<number> {
  const alerted = new Set(
    (await db.prepare(`SELECT user_id FROM call_events WHERE call_id = ? AND kind = 'alerted'`).bind(call.id).all<{ user_id: string }>()).results.map((e) => e.user_id),
  )
  // Only someone who was actually alerted can have not answered; a no-device target was passed over.
  const last = (await listTargets(db, call.id)).filter((t) => t.rejected_at == null && alerted.has(t.user_id)).at(-1)
  if (last) await addEvent(db, call.id, now, 'no_response', last.user_id)
  return advance(db, send, call, now)
}

export async function acceptCall(db: DB, callId: string, userId: string, now: number): Promise<'accepted' | 'taken' | 'rejected' | 'closed'> {
  // One statement, so the first accept wins however close the second one is.
  const r = await db
    .prepare(
      `UPDATE calls SET accepted_by = ?1, accepted_at = ?2, next_at = NULL
       WHERE id = ?3 AND accepted_at IS NULL AND closed_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM call_targets WHERE call_id = ?3 AND user_id = ?1 AND rejected_at IS NOT NULL)`,
    )
    .bind(userId, now, callId)
    .run()
  if (r.meta.changes > 0) {
    await addEvent(db, callId, now, 'accepted', userId)
    return 'accepted'
  }
  const call = await getCall(db, callId)
  return !call || call.closed_at != null ? 'closed' : call.accepted_at != null ? 'taken' : 'rejected'
}

export async function rejectCall(db: DB, send: PushSender, callId: string, userId: string, now: number): Promise<'rejected' | 'not_yours' | 'closed'> {
  const call = await getCall(db, callId)
  if (!call || call.closed_at != null || call.accepted_at != null) return 'closed'
  const r = await db
    .prepare('UPDATE call_targets SET rejected_at = ? WHERE call_id = ? AND user_id = ? AND rejected_at IS NULL')
    .bind(now, callId, userId)
    .run()
  if (r.meta.changes === 0) return 'not_yours'
  await addEvent(db, callId, now, 'rejected', userId)
  await advance(db, send, call, now)
  return 'rejected'
}

async function closeCall(db: DB, id: string, now: number) {
  const r = await db.prepare('UPDATE calls SET closed_at = ?, next_at = NULL WHERE id = ? AND closed_at IS NULL').bind(now, id).run()
  if (r.meta.changes > 0) await addEvent(db, id, now, 'closed')
}

// Puts what just happened on the trip onto each open call's record. `close` says which calls it ends.
export async function noteOnCalls(
  db: DB, tripId: string, now: number, kind: CallEvent, userId: string | null, close: 'all' | CallKind | null, detail: string | null = null,
) {
  for (const call of await listOpenCalls(db, tripId)) {
    // A help call's own start already says the explorer called for help.
    if (kind === 'help' && call.kind === 'help') continue
    await addEvent(db, call.id, now, kind, userId, detail)
    if (close === 'all' || close === call.kind) await closeCall(db, call.id, now)
  }
}

// A safety net for any path that ends a trip without closing its calls.
export async function closeCallsOfClosedTrips(db: DB, now: number): Promise<number> {
  const rows = (
    await db.prepare("SELECT c.id FROM calls c JOIN trips t ON t.id = c.trip_id WHERE c.closed_at IS NULL AND t.status = 'closed'").all<{ id: string }>()
  ).results
  for (const r of rows) await closeCall(db, r.id, now)
  return rows.length
}

type EventRow = { call_id: string; at: number; kind: CallEvent; detail: string | null; name: string | null }

function describe(e: EventRow): string {
  const who = e.name ?? 'Someone'
  switch (e.kind) {
    case 'started': return e.detail === 'help' ? 'Call started: the explorer called for help.' : 'Call started: overdue, and no answer to "Are you okay?".'
    case 'alerted': return `Alert sent to ${who} (${e.detail} ${e.detail === '1' ? 'device' : 'devices'}).`
    case 'no_device': return `${who} has no device that gets alerts.`
    case 'no_response': return `No answer from ${who}.`
    case 'rejected': return `${who} rejected.`
    case 'accepted': return `${who} accepted.`
    case 'everyone': return e.detail === 'nobody_on_call'
      ? 'Nobody is on call. Sent to every operator and admin.'
      : 'Nobody on the roster accepted. Sent to every operator and admin.'
    case 'extended': return `${who} added time.`
    case 'help': return `${who} called for help.`
    case 'help_cancelled': return `${who} cancelled the call for help.`
    case 'back': return `${who} is back safe.`
    case 'siren': return `${who} sounded the siren.`
    case 'closed_trip': return `${who} closed the trip.`
    case 'admin_status': return `${who} set the trip to ${e.detail}.`
    case 'closed': return 'Call closed.'
  }
}

export interface CallView extends Call {
  accepted_name: string | null
  targets: CallTarget[]
  lines: Array<{ at: number; text: string }>
}

// Every call on the trip, newest first, each with its record in time order. Kept after the trip ends.
export async function callsForTrip(db: DB, tripId: string): Promise<CallView[]> {
  const calls = (await db.prepare('SELECT * FROM calls WHERE trip_id = ? ORDER BY started_at DESC, rowid DESC').bind(tripId).all<Call>()).results
  if (calls.length === 0) return []
  const [messages, events] = await Promise.all([
    listMessages(db, tripId),
    db
      .prepare(
        `SELECT e.call_id, e.at, e.kind, e.detail, u.name FROM call_events e LEFT JOIN users u ON u.id = e.user_id
         WHERE e.call_id IN (SELECT id FROM calls WHERE trip_id = ?) ORDER BY e.id`,
      )
      .bind(tripId)
      .all<EventRow>(),
  ])
  return Promise.all(
    calls.map(async (c) => {
      const targets = await listTargets(db, c.id)
      const said = messages
        .filter((m) => m.created_at >= c.started_at && (c.closed_at == null || m.created_at <= c.closed_at))
        .map((m) => ({ at: m.created_at, text: `${m.author_name}: ${m.body || (m.media_type?.startsWith('audio/') ? 'Voice note' : 'Photo')}` }))
      const lines = [...events.results.filter((e) => e.call_id === c.id).map((e) => ({ at: e.at, text: describe(e) })), ...said]
        .sort((a, b) => a.at - b.at)
      const accepted_name = c.accepted_by ? ((await getUserById(db, c.accepted_by))?.name ?? null) : null
      return { ...c, accepted_name, targets, lines }
    }),
  )
}

export const canAccept = (c: CallView, userId: string) =>
  c.closed_at == null && c.accepted_at == null && !c.targets.some((t) => t.user_id === userId && t.rejected_at != null)
export const canReject = (c: CallView, userId: string) =>
  c.closed_at == null && c.accepted_at == null && c.targets.some((t) => t.user_id === userId && t.rejected_at == null)

// The calls as the Android app gets them: the lines are ready to show, and the viewer's buttons are decided here.
export const callsJson = (views: CallView[], userId: string) =>
  views.map((c) => ({
    id: c.id, kind: c.kind, started_at: c.started_at, closed_at: c.closed_at, everyone_at: c.everyone_at,
    accepted_name: c.accepted_name, accepted_at: c.accepted_at,
    can_accept: canAccept(c, userId), can_reject: canReject(c, userId), lines: c.lines,
  }))
