import type { Context } from 'hono'
import { Hono } from 'hono'
import { deleteCookie, setCookie } from 'hono/cookie'
import type { AppEnv } from '../env'
import { COOKIE_MAX_AGE, COOKIE_NAME, hashToken, newToken, signMagicLink, verifyMagicLink } from '../lib/auth'
import { getUserByEmail, getUserById, setUserTokenHash, updateUser } from '../lib/db'
import { sendMagicLink } from '../lib/email'
import { readBody, str } from '../lib/middleware'
import { Layout } from '../views/layout'
import { LinkSent, Login } from '../views/auth'

export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000
const isOps = (role: string) => role === 'operator' || role === 'admin'

export const auth = new Hono<AppEnv>()

auth.get('/login', (c) => {
  const user = c.var.user
  if (user && isOps(user.role)) return c.redirect('/board')
  return c.html(<Layout title="Sign in" user={null}><Login /></Layout>)
})

auth.post('/auth/link', async (c) => {
  const email = str(await readBody(c), 'email')?.toLowerCase()
  if (email) {
    const user = await getUserByEmail(c.env.DB, email)
    if (user && isOps(user.role)) {
      const token = await signMagicLink(c.env.SESSION_SECRET, user.id, Date.now() + MAGIC_LINK_TTL_MS)
      const url = `${c.env.APP_URL}/auth/verify?t=${token}`
      c.executionCtx.waitUntil(
        sendMagicLink(c.env, email, url).catch((e) => console.error('magic link email failed', String(e))),
      )
    }
  }
  return c.html(<Layout title="Check your email" user={null}><LinkSent /></Layout>)
})

async function finishVerify(c: Context<AppEnv>, token: string) {
  const userId = await verifyMagicLink(c.env.SESSION_SECRET, token, Date.now())
  const user = userId ? await getUserById(c.env.DB, userId) : null
  if (!user || !isOps(user.role)) {
    return c.html(<Layout title="Sign in" user={null}><Login error="That link has expired. Ask for a new one." /></Layout>, 400)
  }
  const session = newToken()
  await setUserTokenHash(c.env.DB, user.id, await hashToken(session))
  setCookie(c, COOKIE_NAME, session, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: COOKIE_MAX_AGE })
  return c.redirect('/board')
}

auth.get('/auth/verify', async (c) => finishVerify(c, c.req.query('t') ?? ''))

auth.post('/auth/verify', async (c) => {
  const link = str(await readBody(c), 'link') ?? ''
  let token = link
  try {
    const url = new URL(link)
    token = url.searchParams.get('t') ?? link
  } catch {
    // not a URL, treat the whole string as the token
  }
  return finishVerify(c, token)
})

auth.post('/logout', async (c) => {
  if (c.var.user) await updateUser(c.env.DB, c.var.user.id, { token_hash: null })
  deleteCookie(c, COOKIE_NAME, { path: '/' })
  return c.redirect('/login')
})
