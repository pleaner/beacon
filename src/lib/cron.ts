import { getSetting, getUserById, prunePositions } from './db'
import { helpPayload, pushToRoles, pushToUser, type PushSender } from './push'
import { findHelpTripsToAlert, findTripsToAlertOperators, findTripsToPrompt, markOperatorsAlerted, markOverdue, tripLine } from './trips'

export const POSITION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg' })
}

export async function runCron(env: Env, send: PushSender, now: number) {
  const db = env.DB
  const graceMinutes = Number(await getSetting(db, 'grace_minutes', '30'))
  const graceMs = graceMinutes * 60_000
  let prompted = 0
  let alerted = 0
  let helpAlerted = 0

  for (const trip of await findTripsToPrompt(db, now)) {
    try {
      if (!(await markOverdue(db, trip.id, now))) continue
      prompted++
      await pushToUser(db, send, trip.user_id, {
        title: 'Are you okay?',
        body: "You're past your return time. Let us know you're safe, or add more time.",
        url: '/',
        tag: 'overdue',
        requireInteraction: true,
      })
    } catch (e) {
      console.error('prompt failed', trip.id, String(e))
    }
  }

  for (const trip of await findTripsToAlertOperators(db, now, graceMs)) {
    try {
      if (!(await markOperatorsAlerted(db, trip.id, now))) continue
      alerted++
      const user = await getUserById(db, trip.user_id)
      await pushToRoles(db, send, ['operator', 'admin'], {
        title: `Overdue: ${user?.name ?? 'unknown'}`,
        body: `${tripLine(trip)}, due ${formatTime(trip.return_by)}. No answer for ${graceMinutes} min.`,
        url: `/board/trips/${trip.id}`,
        tag: `trip-${trip.id}`,
      })
    } catch (e) {
      console.error('operator alert failed', trip.id, String(e))
    }
  }

  for (const trip of await findHelpTripsToAlert(db)) {
    try {
      const user = await getUserById(db, trip.user_id)
      const { sent } = await pushToRoles(db, send, ['operator', 'admin'], helpPayload({ name: user?.name ?? 'unknown' }, trip))
      if (sent > 0) {
        await markOperatorsAlerted(db, trip.id, now)
        helpAlerted++
      }
    } catch (e) {
      console.error('help alert failed', trip.id, String(e))
    }
  }

  const pruned = await prunePositions(db, now - POSITION_RETENTION_MS)
  return { prompted, alerted, helpAlerted, pruned }
}
