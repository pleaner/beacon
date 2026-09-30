import type { Context } from 'hono'
import { Hono } from 'hono'
import { deleteCookie, setCookie } from 'hono/cookie'
import type { AppEnv } from '../env'
import { COOKIE_MAX_AGE, COOKIE_NAME, hashToken, newToken, signMagicLink, verifyMagicLink } from '../lib/auth'
import { consumeMagicLink, getUserByEmail, getUserById, issueMagicLink, setUserTokenHash, updateUser } from '../lib/db'
import { sendMagicLink } from '../lib/email'
import { readBody, str, wantsJson } from '../lib/middleware'
import { Layout } from '../views/layout'
import { ConfirmLink, LinkSent, Login } from '../views/auth'

export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000
export const isOps = (role: string) => role === 'operator' || role === 'admin'

export const auth = new Hono<AppEnv>()

auth.get('/login', (c) => {
  const user = c.var.user
  if (user && isOps(user.role)) return c.redirect('/board')
  return c.html(<Layout title="Sign in" user={null} variant="bare" bodyClass="navy"><Login /></Layout>)
})

auth.post('/auth/link', async (c) => {
  const email = str(await readBody(c), 'email')?.toLowerCase()
  if (email) {
    const user = await getUserByEmail(c.env.DB, email)
    const expiresAt = Date.now() + MAGIC_LINK_TTL_MS
    if (user && isOps(user.role) && (await issueMagicLink(c.env.DB, user.id, expiresAt))) {
      const token = await signMagicLink(c.env.SESSION_SECRET, user.id, expiresAt)
      const url = `${c.env.APP_URL}/auth/verify?t=${token}`
      c.executionCtx.waitUntil(
        sendMagicLink(c.env, email, url).catch((e) => console.error('magic link email failed', String(e))),
      )
    }
  }
  if (wantsJson(c)) return c.json({ ok: true })
  return c.html(<Layout title="Check your email" user={null} variant="bare" bodyClass="navy"><LinkSent /></Layout>)
})

// The emailed link, or just its token. Null when it's expired, used, or not an operator's.
export async function redeemLink(env: Env, link: string) {
  let token = link
  try {
    token = new URL(link).searchParams.get('t') ?? link
  } catch {
    // not a URL, treat the whole string as the token
  }
  const signed = await verifyMagicLink(env.SESSION_SECRET, token, Date.now())
  const user = signed ? await getUserById(env.DB, signed.userId) : null
  if (!signed || !user || !isOps(user.role) || !(await consumeMagicLink(env.DB, user.id, signed.expiresAt))) return null
  return user
}

async function finishVerify(c: Context<AppEnv>, link: string) {
  const user = await redeemLink(c.env, link)
  if (!user) {
    return c.html(<Layout title="Sign in" user={null} variant="bare" bodyClass="navy"><Login error="That link has expired or was already used. Ask for a new one." /></Layout>, 400)
  }
  const session = newToken()
  await setUserTokenHash(c.env.DB, user.id, await hashToken(session))
  setCookie(c, COOKIE_NAME, session, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: COOKIE_MAX_AGE })
  return c.redirect('/board')
}

// A link works once, and email scanners open links to check them. Sign in only on the button press.
auth.get('/auth/verify', (c) =>
  c.html(<Layout title="Sign in" user={null} variant="bare" bodyClass="navy"><ConfirmLink token={c.req.query('t') ?? ''} /></Layout>),
)

auth.post('/auth/verify', async (c) => {
  return finishVerify(c, str(await readBody(c), 'link') ?? '')
})

auth.post('/logout', async (c) => {
  const user = c.var.user
  if (user) await updateUser(c.env.DB, user.id, { token_hash: null })
  deleteCookie(c, COOKIE_NAME, { path: '/' })
  return c.redirect(user && !isOps(user.role) ? '/' : '/login')
})
