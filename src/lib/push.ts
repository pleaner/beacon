import { buildPushPayload, type PushMessage } from '@block65/webcrypto-web-push'
import { deleteSubscription, listSubscriptionsForRoles, listSubscriptionsForUser, type PushSub, type Role, type User } from './db'
import { tripLine, type Trip } from './trips'

export interface PushPayload {
  title: string
  body: string
  url?: string
  tag?: string
  requireInteraction?: boolean
  // What the native app does with it: 'prompt' and 'siren' ring on the explorer's phone, 'help' and 'overdue' ring on
  // an operator's. Anything else is an ordinary notification.
  kind?: 'prompt' | 'siren' | 'help' | 'overdue' | 'message'
}

export type PushSender = (sub: PushSub, payload: PushPayload) => Promise<number>

// Phones running the native app are stored as subscriptions with an 'fcm:<token>' endpoint and no keys.
export const FCM_PREFIX = 'fcm:'

export function webPushSender(env: Env): PushSender {
  const vapid = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY }
  return async (sub, payload) => {
    if (sub.endpoint.startsWith(FCM_PREFIX)) return fcmSend(env, sub.endpoint.slice(FCM_PREFIX.length), payload)
    const built = await buildPushPayload(
      // PushPayload's optional fields make it structurally incompatible with the library's strict
      // Jsonifiable index signature; the shape is plain JSON, so assert it rather than loosen the type.
      { data: payload as unknown as PushMessage['data'], options: { ttl: 3600, urgency: 'high' } },
      { endpoint: sub.endpoint, expirationTime: null, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      vapid,
    )
    const res = await fetch(sub.endpoint, built)
    return res.status
  }
}

// FCM HTTP v1. Data-only and high priority, so the app wakes even when closed and decides how loud to be.
async function fcmSend(env: Env, token: string, payload: PushPayload): Promise<number> {
  if (!env.FCM_SERVICE_ACCOUNT) return 503
  const account = JSON.parse(env.FCM_SERVICE_ACCOUNT) as { project_id: string; client_email: string; private_key: string }
  const data = Object.fromEntries(Object.entries(payload).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]))
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await googleToken(account)}`, 'content-type': 'application/json' },
    body: JSON.stringify({ message: { token, data, android: { priority: 'high', ttl: '3600s' } } }),
  })
  if (!res.ok) console.warn('fcm', res.status, await res.text())
  return res.status
}

// ponytail: one cached access token per isolate; Google's tokens last an hour.
let cachedToken: { value: string; until: number } | null = null
async function googleToken(account: { client_email: string; private_key: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (cachedToken && cachedToken.until > now + 60) return cachedToken.value
  const b64url = (b: ArrayBuffer | string) =>
    btoa(typeof b === 'string' ? b : String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(JSON.stringify({
    iss: account.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }))
  const der = Uint8Array.from(atob(account.private_key.replace(/-----[^-]+-----|\s/g, '')), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${claims}`))
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claims}.${b64url(sig)}` }),
  })
  if (!res.ok) throw new Error(`google token ${res.status}`)
  const j = (await res.json()) as { access_token: string; expires_in: number }
  cachedToken = { value: j.access_token, until: now + j.expires_in }
  return j.access_token
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

export function helpPayload(user: Pick<User, 'name'>, trip: Trip): PushPayload {
  return {
    title: `HELP: ${user.name}`,
    body: `${tripLine(trip)}. Tap for details.`,
    url: `/board/trips/${trip.id}`,
    tag: `trip-${trip.id}`,
    requireInteraction: true,
    kind: 'help',
  }
}

let senderOverride: PushSender | null = null
export function setSenderForTests(s: PushSender | null) {
  senderOverride = s
}
export function getSender(env: Env): PushSender {
  return senderOverride ?? webPushSender(env)
}
