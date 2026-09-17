import { env } from 'cloudflare:workers'
import type { PushPayload, PushSender } from '../src/lib/push'
import { hashToken, newToken } from '../src/lib/auth'
import { createUser, type NewUser, type User } from '../src/lib/db'

async function make(role: User['role'], over: Partial<NewUser>) {
  const token = newToken()
  const user = await createUser(env.DB, {
    role,
    name: `${role} person`,
    phone: '+27820000000',
    email: role === 'explorer' ? null : `${role}-${token.slice(0, 6)}@sarza.test`,
    organisation: role === 'explorer' ? null : 'SARZA',
    emergency_name: 'Em',
    emergency_phone: '+27830000000',
    description: null,
    photo_key: null,
    consent_contact: 1,
    token_hash: await hashToken(token),
    ...over,
  })
  return { user, token }
}

export const makeExplorer = (over: Partial<NewUser> = {}) => make('explorer', over)
export const makeOperator = (over: Partial<NewUser> = {}) => make('operator', over)
export const makeAdmin = (over: Partial<NewUser> = {}) => make('admin', over)
export const cookieFor = (token: string) => `beacon=${token}`

export function fakeSender() {
  const sent: Array<{ endpoint: string; payload: PushPayload }> = []
  const statusFor = new Map<string, number>()
  const send: PushSender = async (sub, payload) => {
    const status = statusFor.get(sub.endpoint) ?? 201
    if (status === 0) throw new Error('network down')
    sent.push({ endpoint: sub.endpoint, payload })
    return status
  }
  return { send, sent, statusFor }
}
