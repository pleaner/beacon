import type { Context } from 'hono'
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { AppEnv } from '../env'
import { COOKIE_MAX_AGE, COOKIE_NAME, hashToken, newToken, signMagicLink, verifyMagicLink } from '../lib/auth'
import { consumeMagicLink, createUser, getUserByEmail, getUserById, getUserBySub, issueMagicLink, setUserTokenHash, updateUser, type User } from '../lib/db'
import { sendMagicLink } from '../lib/email'
import { readBody, str } from '../lib/middleware'
import { authorizeUrl, enabledProviders, exchangeCode, type Identity, type Provider } from '../lib/oauth'
import { ConfirmLink, LinkSent } from '../views/auth'
import { Layout } from '../views/layout'
import { Welcome } from '../views/explorer'

export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000
export const isOps = (role: string) => role === 'operator' || role === 'admin'

// A new explorer has no phone yet; the profile form asks for it before anything else.
export const needsProfile = (u: User) => u.role === 'explorer' && !u.phone

export const homeFor = (u: User) => (isOps(u.role) ? '/board' : needsProfile(u) ? '/profile' : '/')

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

// Sign-in by emailed link, for anyone who already has an account. New people sign up with Google or Apple.
// The page says the same thing whether or not the address is known.
auth.post('/auth/link', async (c) => {
  const email = str(await readBody(c), 'email')?.toLowerCase()
  if (email) {
    const user = await getUserByEmail(c.env.DB, email)
    const expiresAt = Date.now() + MAGIC_LINK_TTL_MS
    if (user && (await issueMagicLink(c.env.DB, user.id, expiresAt))) {
      const token = await signMagicLink(c.env.SESSION_SECRET, user.id, expiresAt)
      const url = `${c.env.APP_URL}/auth/verify?t=${token}`
      c.executionCtx.waitUntil(
        sendMagicLink(c.env, email, url).catch((e) => console.error('magic link email failed', String(e))),
      )
    }
  }
  return c.html(<Layout title="Check your email" user={null} variant="bare" bodyClass="navy"><LinkSent /></Layout>)
})

// The emailed link, or just its token. Null when it's expired or used.
async function redeemLink(env: Env, link: string) {
  let token = link
  try {
    token = new URL(link).searchParams.get('t') ?? link
  } catch {
    // not a URL, treat the whole string as the token
  }
  const signed = await verifyMagicLink(env.SESSION_SECRET, token, Date.now())
  const user = signed ? await getUserById(env.DB, signed.userId) : null
  if (!signed || !user || !(await consumeMagicLink(env.DB, user.id, signed.expiresAt))) return null
  return user
}

// A link works once, and email scanners open links to check them. Sign in only on the button press.
auth.get('/auth/verify', (c) =>
  c.html(<Layout title="Sign in" user={null} variant="bare" bodyClass="navy"><ConfirmLink token={c.req.query('t') ?? ''} /></Layout>),
)

auth.post('/auth/verify', async (c) => {
  const user = await redeemLink(c.env, str(await readBody(c), 'link') ?? '')
  return user ? signIn(c, user) : welcome(c, 'That link has expired or was already used. Ask for a new one.')
})

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
  return signIn(c, user)
}

async function signIn(c: Context<AppEnv>, user: User) {
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
