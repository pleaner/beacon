import type { Context } from 'hono'
import { Hono } from 'hono'
import { setCookie } from 'hono/cookie'
import type { AppEnv } from '../env'
import { COOKIE_MAX_AGE, COOKIE_NAME, hashToken, newToken } from '../lib/auth'
import { ACTIVITIES, AREAS, type Activity, type Area } from '../lib/constants'
import { addSubscription, createUser, getChecklist, insertPosition, updateUser } from '../lib/db'
import { done, num, readBody, requireApiRole, str, wantsJson } from '../lib/middleware'
import { savePhoto } from '../lib/photos'
import { getSender, pushToRoles } from '../lib/push'
import { cancelHelp, extendTrip, getTrip, markBack, operatorClose, parseReturnBy, previousShoePhotos, requestHelp, startTrip, TripOpenError, type Trip } from '../lib/trips'
import { Layout } from '../views/layout'
import { NewTripForm, ProfileForm } from '../views/explorer'

export const api = new Hono<AppEnv>()

async function ownTrip(c: Context<AppEnv>, id: string): Promise<Trip | null> {
  const trip = await getTrip(c.env.DB, id)
  return trip && trip.user_id === c.var.user!.id ? trip : null
}

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
      start_lat: num(body, 'start_lat'), start_lng: num(body, 'start_lng'), start_accuracy: num(body, 'start_accuracy'),
      return_by, checklist, battery_at_start: num(body, 'battery'),
    }, now)
    return done(c, { id: trip.id }, '/trip')
  } catch (e) {
    if (e instanceof TripOpenError) return fail(e.message, 409)
    throw e
  }
})

api.post('/trips/:id/extend', requireApiRole('explorer'), async (c) => {
  const trip = await ownTrip(c, c.req.param('id'))
  if (!trip) return c.json({ error: 'Not found' }, 404)
  const body = await readBody(c)
  const now = Date.now()
  const raw = body.return_by as unknown
  let return_by: number | null
  if (typeof raw === 'number' || str(body, 'return_by')) return_by = parseReturnBy(typeof raw === 'number' ? raw : str(body, 'return_by'), now)
  else {
    const minutes = num(body, 'minutes')
    return_by = minutes && minutes > 0 ? now + minutes * 60_000 : null
  }
  if (!return_by) return c.json({ error: 'Pick a time in the future' }, 400)
  if (!(await extendTrip(c.env.DB, trip.id, return_by, now))) return c.json({ error: 'Trip cannot be extended' }, 409)
  return done(c, { return_by }, '/trip')
})

api.post('/trips/:id/back', requireApiRole('explorer'), async (c) => {
  const trip = await ownTrip(c, c.req.param('id'))
  if (!trip) return c.json({ error: 'Not found' }, 404)
  if (!(await markBack(c.env.DB, trip.id, Date.now()))) return c.json({ error: 'Trip is not open' }, 409)
  return done(c, { ok: true }, '/?back=1')
})

api.post('/trips/:id/help', requireApiRole('explorer'), async (c) => {
  const user = c.var.user!
  const trip = await ownTrip(c, c.req.param('id'))
  if (!trip) return c.json({ error: 'Not found' }, 404)
  if (trip.status === 'help') return done(c, { ok: true }, '/trip')
  if (!(await requestHelp(c.env.DB, trip.id, Date.now()))) return c.json({ error: 'Trip is not open' }, 409)
  await pushToRoles(c.env.DB, getSender(c.env), ['operator', 'admin'], {
    title: `HELP: ${user.name}`,
    body: `${ACTIVITIES[trip.activity]} in ${AREAS[trip.area]}. Tap for details.`,
    url: `/board/trips/${trip.id}`,
    tag: `trip-${trip.id}`,
    requireInteraction: true,
  })
  return done(c, { ok: true }, '/trip')
})

api.post('/trips/:id/cancel', requireApiRole('explorer'), async (c) => {
  const trip = await ownTrip(c, c.req.param('id'))
  if (!trip) return c.json({ error: 'Not found' }, 404)
  if (!(await cancelHelp(c.env.DB, trip.id, Date.now()))) return c.json({ error: 'Trip is not in help' }, 409)
  return done(c, { ok: true }, '/?cancelled=1')
})

api.post('/trips/:id/positions', requireApiRole('explorer'), async (c) => {
  const trip = await ownTrip(c, c.req.param('id'))
  if (!trip) return c.json({ error: 'Not found' }, 404)
  if (trip.status === 'closed') return c.json({ error: 'Trip is closed' }, 409)
  const items = (await c.req.json().catch(() => null)) as unknown
  if (!Array.isArray(items) || items.length === 0 || items.length > 10) return c.json({ error: 'Send an array of 1 to 10 positions' }, 400)
  const now = Date.now()
  const rows = []
  for (const p of items as Array<Record<string, unknown>>) {
    const lat = Number(p.lat)
    const lng = Number(p.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return c.json({ error: 'lat and lng must be numbers' }, 400)
    rows.push({
      trip_id: trip.id, lat, lng,
      accuracy: Number.isFinite(Number(p.accuracy)) && p.accuracy != null ? Number(p.accuracy) : null,
      battery: Number.isFinite(Number(p.battery)) && p.battery != null ? Math.round(Number(p.battery)) : null,
      at: Number.isFinite(Number(p.at)) && p.at != null ? Number(p.at) : now,
    })
  }
  for (const r of rows) await insertPosition(c.env.DB, r)
  return c.json({ ok: true, saved: rows.length })
})

api.post('/board/trips/:id/close', requireApiRole('operator', 'admin'), async (c) => {
  if (!(await operatorClose(c.env.DB, c.req.param('id'), Date.now()))) return c.json({ error: 'Trip is already closed' }, 409)
  return done(c, { ok: true }, '/board')
})

api.post('/push/subscribe', requireApiRole('explorer', 'operator', 'admin'), async (c) => {
  const b = (await c.req.json().catch(() => null)) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null
  const endpoint = typeof b?.endpoint === 'string' && b.endpoint.startsWith('https://') ? b.endpoint : null
  const p256dh = typeof b?.keys?.p256dh === 'string' ? b.keys.p256dh : null
  const auth = typeof b?.keys?.auth === 'string' ? b.keys.auth : null
  if (!endpoint || !p256dh || !auth) return c.json({ error: 'Bad subscription' }, 400)
  await addSubscription(c.env.DB, c.var.user!.id, { endpoint, p256dh, auth })
  return c.json({ ok: true })
})
