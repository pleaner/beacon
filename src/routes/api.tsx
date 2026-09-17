import { Hono } from 'hono'
import { setCookie } from 'hono/cookie'
import type { AppEnv } from '../env'
import { COOKIE_MAX_AGE, COOKIE_NAME, hashToken, newToken } from '../lib/auth'
import { ACTIVITIES, AREAS, type Activity, type Area } from '../lib/constants'
import { createUser, getChecklist, updateUser } from '../lib/db'
import { done, readBody, requireApiRole, str, wantsJson } from '../lib/middleware'
import { savePhoto } from '../lib/photos'
import { parseReturnBy, previousShoePhotos, startTrip, TripOpenError } from '../lib/trips'
import { Layout } from '../views/layout'
import { NewTripForm, ProfileForm } from '../views/explorer'

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
    try {
      const photo_key = await savePhoto(c.env.PHOTOS, user.id, body.photo)
      await updateUser(c.env.DB, user.id, photo_key ? { ...fields, photo_key } : fields)
      return done(c, { id: user.id }, '/profile?saved=1')
    } catch (e) {
      const error = (e as Error).message
      return wantsJson(c) ? c.json({ error }, 400) : c.html(<Layout title="Profile" user={user}><ProfileForm user={user} error={error} /></Layout>, 400)
    }
  }
  const token = newToken()
  const created = await createUser(c.env.DB, {
    role: 'explorer', organisation: null, photo_key: null, ...fields, token_hash: await hashToken(token),
  })
  setCookie(c, COOKIE_NAME, token, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: COOKIE_MAX_AGE })
  try {
    const photo_key = await savePhoto(c.env.PHOTOS, created.id, body.photo)
    if (photo_key) await updateUser(c.env.DB, created.id, { photo_key })
    return done(c, { id: created.id }, '/?welcome=1')
  } catch (e) {
    const error = (e as Error).message
    return wantsJson(c) ? c.json({ error }, 400) : c.html(<Layout title="Profile" user={created}><ProfileForm user={created} error={error} /></Layout>, 400)
  }
})

api.post('/trips', requireApiRole('explorer'), async (c) => {
  const user = c.var.user!
  const body = await readBody(c)
  const now = Date.now()
  const activity = str(body, 'activity') as Activity | null
  const area = str(body, 'area') as Area | null
  const rawReturn = body.return_by as unknown
  const return_by = parseReturnBy(typeof rawReturn === 'number' ? rawReturn : str(body, 'return_by'), now)
  const fail = async (error: string, status: 400 | 409) => {
    if (wantsJson(c)) return c.json({ error }, status)
    const act = activity && activity in ACTIVITIES ? activity : 'hike'
    const [checklist, shoes] = await Promise.all([getChecklist(c.env.DB, act), previousShoePhotos(c.env.DB, user.id)])
    return c.html(<Layout title="New trip" user={user}><NewTripForm user={user} activity={act} checklist={checklist} shoes={shoes} error={error} /></Layout>, status)
  }
  if (!activity || !(activity in ACTIVITIES)) return fail('Pick an activity', 400)
  if (!area || !(area in AREAS)) return fail('Pick an area', 400)
  if (!return_by) return fail('"Back by" must be a time in the future', 400)

  const raw = body.checklist as unknown
  const checklist = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' && raw ? [raw] : []
  // ponytail: `num()` only reads strings; a JSON body carries these as real numbers, so read them directly here.
  const asNum = (key: string): number | null => {
    const v = (body as Record<string, unknown>)[key]
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
    return Number.isFinite(n) ? n : null
  }
  let photo_key: string | null
  let newShoe: string | null
  try {
    photo_key = await savePhoto(c.env.PHOTOS, user.id, body.photo)
    newShoe = await savePhoto(c.env.PHOTOS, user.id, body.shoe_photo)
  } catch (e) {
    return fail((e as Error).message, 400)
  }
  const reuse = str(body, 'shoe_photo_key')
  const shoe_photo_key = newShoe ?? (reuse && reuse.startsWith(`users/${user.id}/`) ? reuse : null)

  try {
    const trip = await startTrip(c.env.DB, user.id, {
      activity, area,
      route_text: str(body, 'route_text'), companions_text: str(body, 'companions_text'), wearing_text: str(body, 'wearing_text'),
      photo_key, shoe_photo_key,
      start_lat: asNum('start_lat'), start_lng: asNum('start_lng'), start_accuracy: asNum('start_accuracy'),
      return_by, checklist, battery_at_start: asNum('battery'),
    }, now)
    return done(c, { id: trip.id }, '/trip')
  } catch (e) {
    if (e instanceof TripOpenError) return fail(e.message, 409)
    throw e
  }
})
