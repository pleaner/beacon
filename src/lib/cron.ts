import { closeCallsOfClosedTrips, escalate, findCallsToEscalate, raiseCall } from './calls'
import { getSetting, prunePositions } from './db'
import { syncShift } from './oncall'
import { pushToUser, type PushSender } from './push'
import { findHelpTripsToAlert, findTripsToAlertOperators, findTripsToPrompt, markHelpAlerted, markOperatorsAlerted, markOverdue } from './trips'

export const POSITION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export async function runCron(env: Env, send: PushSender, now: number) {
  const db = env.DB
  const graceMs = Number(await getSetting(db, 'grace_minutes', '30')) * 60_000
  let prompted = 0
  let alerted = 0
  let helpAlerted = 0
  let escalated = 0

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
        kind: 'prompt',
      })
    } catch (e) {
      console.error('prompt failed', trip.id, String(e))
    }
  }

  // Overdue and help alerts are calls: they go to the person on shift first and escalate from there.
  // The trip is marked only once a push lands, so a call that reached no one is raised again next minute.
  for (const trip of await findTripsToAlertOperators(db, now, graceMs)) {
    try {
      const r = await raiseCall(db, send, trip.id, 'overdue', now)
      if ((r.sent > 0 || r.accepted) && (await markOperatorsAlerted(db, trip.id, now))) alerted++
    } catch (e) {
      console.error('operator alert failed', trip.id, String(e))
    }
  }

  for (const trip of await findHelpTripsToAlert(db)) {
    try {
      const r = await raiseCall(db, send, trip.id, 'help', now)
      if ((r.sent > 0 || r.accepted) && (await markHelpAlerted(db, trip.id, now))) helpAlerted++
    } catch (e) {
      console.error('help alert failed', trip.id, String(e))
    }
  }

  for (const call of await findCallsToEscalate(db, now)) {
    try {
      await escalate(db, send, call, now)
      escalated++
    } catch (e) {
      console.error('escalation failed', call.id, String(e))
    }
  }

  const callsClosed = await closeCallsOfClosedTrips(db, now)
  const shiftChanged = await syncShift(db, send, now).catch((e) => {
    console.error('shift sync failed', String(e))
    return false
  })
  const pruned = await prunePositions(db, now - POSITION_RETENTION_MS)
  return { prompted, alerted, helpAlerted, escalated, callsClosed, shiftChanged, pruned }
}
