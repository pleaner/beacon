import { buildPushPayload } from '@block65/webcrypto-web-push'
import { deleteSubscription, listSubscriptionsForRoles, listSubscriptionsForUser, type PushSub, type Role } from './db'

export interface PushPayload {
  title: string
  body: string
  url?: string
  tag?: string
  requireInteraction?: boolean
}

export type PushSender = (sub: PushSub, payload: PushPayload) => Promise<number>

export function webPushSender(env: Env): PushSender {
  const vapid = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY }
  return async (sub, payload) => {
    const built = await buildPushPayload(
      { data: payload, options: { ttl: 3600, urgency: 'high' } },
      { endpoint: sub.endpoint, expirationTime: null, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      vapid,
    )
    const res = await fetch(sub.endpoint, built)
    return res.status
  }
}

export async function pushToSubs(db: D1Database, send: PushSender, subs: PushSub[], payload: PushPayload) {
  let sent = 0
  let removed = 0
  for (const sub of subs) {
    try {
      const status = await send(sub, payload)
      if (status === 404 || status === 410) {
        await deleteSubscription(db, sub.endpoint)
        removed++
      } else if (status >= 200 && status < 300) {
        sent++
      } else {
        console.warn('push failed', sub.endpoint, status)
      }
    } catch (e) {
      console.warn('push threw', sub.endpoint, String(e))
    }
  }
  return { sent, removed }
}

export async function pushToUser(db: D1Database, send: PushSender, userId: string, payload: PushPayload) {
  return pushToSubs(db, send, await listSubscriptionsForUser(db, userId), payload)
}

export async function pushToRoles(db: D1Database, send: PushSender, roles: Role[], payload: PushPayload) {
  return pushToSubs(db, send, await listSubscriptionsForRoles(db, roles), payload)
}

let senderOverride: PushSender | null = null
export function setSenderForTests(s: PushSender | null) {
  senderOverride = s
}
export function getSender(env: Env): PushSender {
  return senderOverride ?? webPushSender(env)
}
