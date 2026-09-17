import { Hono } from 'hono'
import { setCookie } from 'hono/cookie'
import type { AppEnv } from '../env'
import { COOKIE_MAX_AGE, COOKIE_NAME, hashToken, newToken } from '../lib/auth'
import { createUser, updateUser } from '../lib/db'
import { done, readBody, str, wantsJson } from '../lib/middleware'
import { savePhoto } from '../lib/photos'
import { Layout } from '../views/layout'
import { ProfileForm } from '../views/explorer'

export const api = new Hono<AppEnv>()

api.post('/profile', async (c) => {
  const user = c.var.user
  if (user && user.role !== 'explorer') return c.json({ error: 'Forbidden' }, 403)
  const body = await readBody(c)
  const name = str(body, 'name')
  const phone = str(body, 'phone')
  if (!name || !phone) {
    const error = 'Name and phone are required'
    return wantsJson(c) ? c.json({ error }, 400) : c.html(<Layout title="Profile" user={user}><ProfileForm user={user} error={error} /></Layout>, 400)
  }
  const fields = {
    name,
    phone,
    email: str(body, 'email'),
    emergency_name: str(body, 'emergency_name'),
    emergency_phone: str(body, 'emergency_phone'),
    description: str(body, 'description'),
    consent_contact: body.consent_contact ? 1 : 0,
  }
  if (user) {
    const photo_key = await savePhoto(c.env.PHOTOS, user.id, body.photo)
    await updateUser(c.env.DB, user.id, photo_key ? { ...fields, photo_key } : fields)
    return done(c, { id: user.id }, '/profile?saved=1')
  }
  const token = newToken()
  const created = await createUser(c.env.DB, {
    role: 'explorer', organisation: null, photo_key: null, ...fields, token_hash: await hashToken(token),
  })
  const photo_key = await savePhoto(c.env.PHOTOS, created.id, body.photo)
  if (photo_key) await updateUser(c.env.DB, created.id, { photo_key })
  setCookie(c, COOKIE_NAME, token, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: COOKIE_MAX_AGE })
  return done(c, { id: created.id }, '/?welcome=1')
})
