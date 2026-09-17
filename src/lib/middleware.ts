import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../env'
import { COOKIE_NAME, hashToken } from './auth'
import { getUserByTokenHash, type Role } from './db'

export const loadUser = createMiddleware<AppEnv>(async (c, next) => {
  const token = getCookie(c, COOKIE_NAME)
  c.set('user', token ? await getUserByTokenHash(c.env.DB, await hashToken(token)) : null)
  await next()
})

export function requireRole(...roles: Role[]) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = c.var.user
    if (!user) return c.redirect(roles.includes('explorer') ? '/profile' : '/login')
    if (!roles.includes(user.role)) return c.text('Forbidden', 403)
    await next()
  })
}

export function requireApiRole(...roles: Role[]) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = c.var.user
    if (!user) return c.json({ error: 'Not signed in' }, 401)
    if (!roles.includes(user.role)) return c.json({ error: 'Forbidden' }, 403)
    await next()
  })
}

export type Body = Record<string, string | File>

export async function readBody(c: Context): Promise<Body> {
  const ct = c.req.header('content-type') ?? ''
  if (ct.includes('application/json')) return (await c.req.json()) as Body
  return (await c.req.parseBody({ all: true })) as Body
}

export function wantsJson(c: Context): boolean {
  const ct = c.req.header('content-type') ?? ''
  const accept = c.req.header('accept') ?? ''
  return ct.includes('application/json') || accept.includes('application/json')
}

export function done(c: Context, data: object, redirectTo: string): Response {
  return wantsJson(c) ? c.json(data) : c.redirect(redirectTo, 303)
}

export function str(body: Body, key: string): string | null {
  const v = body[key]
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t
}

export function num(body: Body, key: string): number | null {
  const s = str(body, key)
  if (s === null) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
