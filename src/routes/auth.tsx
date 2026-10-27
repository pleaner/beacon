import type { Context } from 'hono'
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { AppEnv } from '../env'
import { COOKIE_MAX_AGE, COOKIE_NAME, hashToken, newToken } from '../lib/auth'
import { createUser, getUserByEmail, getUserBySub, setUserTokenHash, updateUser, type User } from '../lib/db'
import { readBody, str } from '../lib/middleware'
import { authorizeUrl, enabledProviders, exchangeCode, type Identity, type Provider } from '../lib/oauth'
import { Layout } from '../views/layout'
import { Welcome } from '../views/explorer'

export const isOps = (role: string) => role === 'operator' || role === 'admin'

// Signing in makes the account with no phone, and an explorer promoted to operator may still have none.
// Nobody gets past the profile form until they give a number.
export const needsProfile = (u: User) => !u.phone

export const homeFor = (u: User) => (needsProfile(u) ? '/profile' : isOps(u.role) ? '/board' : '/')

// The account for a Google or Apple identity: the one already linked to it, else the one with the same verified
// email (operators are added by email, and explorers gave theirs in the profile), else a new explorer.
export async function userFor(db: D1Database, id: Identity): Promise<User> {
  const col = id.provider === 'google' ? 'google_sub' : 'apple_sub'
  const linked = await getUserBySub(db, id.provider, id.sub)
  if (linked) return linked
  if (id.email && id.emailVerified) {
    const byEmail = await getUserByEmail(db, id.email)
    if (byEmail && !byEmail[col]) {
      await updateUser(db, byEmail.id, { [col]: id.sub })
      return { ...byEmail, [col]: id.sub }
    }
  }
  const created = await createUser(db, {
    role: 'explorer', name: id.name ?? id.email?.split('@')[0] ?? 'Explorer', phone: '', email: id.email, organisation: null,
    emergency_name: null, emergency_phone: null, description: null, photo_key: null, consent_contact: 0,
  })
  await updateUser(db, created.id, { [col]: id.sub })
  return { ...created, [col]: id.sub }
}

export const auth = new Hono<AppEnv>()

const welcome = (c: Context<AppEnv>, error?: string) =>
  c.html(<Layout title="Sign in" user={null} variant="bare" bodyClass="navy"><Welcome providers={enabledProviders(c.env)} error={error} /></Layout>, error ? 400 : 200)

auth.get('/login', (c) => (c.var.user ? c.redirect(homeFor(c.var.user)) : welcome(c)))

// The state and nonce ride in a short-lived cookie. SameSite=None because Apple POSTs the callback from its own site.
const STATE_COOKIE = 'oauth'
const isProvider = (p: string): p is Provider => p === 'google' || p === 'apple'

auth.get('/auth/:provider', (c) => {
  const p = c.req.param('provider')
  if (!isProvider(p) || !enabledProviders(c.env).includes(p)) return c.notFound()
  const state = newToken()
  const nonce = newToken()
  setCookie(c, STATE_COOKIE, `${p}.${state}.${nonce}`, { httpOnly: true, secure: true, sameSite: 'None', path: '/auth', maxAge: 600 })
  return c.redirect(authorizeUrl(c.env, p, state, nonce))
})

async function finish(c: Context<AppEnv>, p: Provider, q: { code?: string | null; state?: string | null; error?: string | null; user?: string | null }) {
  const [cp, state, nonce] = (getCookie(c, STATE_COOKIE) ?? '').split('.')
  deleteCookie(c, STATE_COOKIE, { path: '/auth', secure: true, sameSite: 'None' })
  // Closing the provider's window, or "Cancel", comes back as an error: just show the buttons again.
  if (q.error) return welcome(c)
  if (cp !== p || !state || !nonce || q.state !== state || !q.code) return welcome(c, 'That sign-in took too long or was opened in another browser. Try again.')
  let user: User
  try {
    user = await userFor(c.env.DB, await exchangeCode(c.env, p, q.code, nonce, q.user))
  } catch (e) {
    console.error('sign-in failed', p, String(e))
    return welcome(c, "We couldn't sign you in. Try again.")
  }
  const session = newToken()
  await setUserTokenHash(c.env.DB, user.id, await hashToken(session))
  setCookie(c, COOKIE_NAME, session, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: COOKIE_MAX_AGE })
  return c.redirect(homeFor(user))
}

auth.get('/auth/google/callback', (c) =>
  finish(c, 'google', { code: c.req.query('code'), state: c.req.query('state'), error: c.req.query('error') }))

auth.post('/auth/apple/callback', async (c) => {
  const b = await readBody(c)
  return finish(c, 'apple', { code: str(b, 'code'), state: str(b, 'state'), error: str(b, 'error'), user: str(b, 'user') })
})

auth.post('/logout', async (c) => {
  const user = c.var.user
  if (user) await updateUser(c.env.DB, user.id, { token_hash: null })
  deleteCookie(c, COOKIE_NAME, { path: '/' })
  return c.redirect('/login')
})
