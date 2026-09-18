import type { Context } from 'hono'
import { Hono } from 'hono'
import { setCookie } from 'hono/cookie'
import type { AppEnv } from '../env'
import { COOKIE_MAX_AGE, COOKIE_NAME, hashToken, newToken } from '../lib/auth'
import { ACTIVITIES, AREAS, GEAR, GENDERS, LANGUAGES, RELATIONS, type Activity, type Area } from '../lib/constants'
import { addSubscription, createUser, insertPositions, updateUser } from '../lib/db'
import { done, num, readBody, requireApiRole, str, wantsJson, type Body } from '../lib/middleware'
import { normalizePhone } from '../lib/phone'
import { getPlaceLookup } from '../lib/places'
import { savePhoto } from '../lib/photos'
import { getSender, helpPayload, pushToRoles } from '../lib/push'
import { cancelHelp, extendTrip, getTrip, markBack, markOperatorsAlerted, operatorClose, parseReturnBy, requestHelp, setStartPlace, startTrip, TripOpenError, type Trip } from '../lib/trips'
import { newTripPage, profilePage } from './explorer'

export const api = new Hono<AppEnv>()

async function ownTrip(c: Context<AppEnv>, id: string): Promise<Trip | null> {
  const trip = await getTrip(c.env.DB, id)
  return trip && trip.user_id === c.var.user!.id ? trip : null
}

function tripFail(c: Context<AppEnv>, error: string, status: 400 | 409) {
  if (wantsJson(c)) return c.json({ error }, status)
  return c.redirect('/trip?error=' + encodeURIComponent(error), 303)
}

// Profile fields beyond name and phone. Unknown or out-of-range values are stored as empty, not
// rejected: a bad height should never stop someone saving the rest of their profile.
function profileExtras(body: Body) {
  const int = (k: string, lo: number, hi: number) => {
    const n = num(body, k)
    return n !== null && Number.isInteger(n) && n >= lo && n <= hi ? n : null
  }
  const birthday = str(body, 'birthday')
  const pick = <T extends string>(k: string, allowed: readonly T[]) => {
    const v = str(body, k)
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : null
  }
  const all = {
    birthday: birthday && /^\d{4}-\d{2}-\d{2}$/.test(birthday) && Date.parse(birthday) < Date.now() ? birthday : null,
    gender: pick('gender', GENDERS),
    height_cm: int('height_cm', 50, 250),
    weight_kg: int('weight_kg', 10, 300),
    shoe_size: str(body, 'shoe_size')?.slice(0, 8) ?? null,
    language: pick('language', Object.keys(LANGUAGES)),
    emergency_relation: pick('emergency_relation', RELATIONS),
  }
  // Only touch what the client sent, so an older client never blanks fields it doesn't know about.
  return Object.fromEntries(Object.entries(all).filter(([k]) => k in body)) as Partial<typeof all>
}

api.post('/profile', async (c) => {
  const user = c.var.user
  if (user && user.role !== 'explorer') return c.json({ error: 'Forbidden' }, 403)
  const body = await readBody(c)
  const name = str(body, 'name')
  const phone = normalizePhone(str(body, 'phone'), str(body, 'phone_country'))
  const email = str(body, 'email')?.toLowerCase() ?? null
  const rest = {
    emergency_name: str(body, 'emergency_name'),
    emergency_phone: normalizePhone(str(body, 'emergency_phone'), str(body, 'emergency_phone_country')),
    consent_contact: body.consent_contact ? 1 : 0,
    ...profileExtras(body),
  }
  // On failure the form comes back filled in with what was sent, not blank.
  const draft = { ...rest, name: name ?? '', phone: phone ?? '', email }
  const failWith = (error: string, as: typeof user) =>
    wantsJson(c) ? c.json({ error }, 400) : c.html(profilePage(as, { error, vapid: c.env.VAPID_PUBLIC_KEY, draft }), 400)
  if (!name || !phone || !email) return failWith('Name, phone and email are required', user)
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return failWith('That email address looks wrong', user)
  const fields = {
    name,
    phone,
    email,
    ...rest,
    // The free-text description is no longer on the form; keep whatever is stored unless a client sends one.
    ...('description' in body ? { description: str(body, 'description') } : {}),
  }
  if (user) {
    try {
      const photo_key = await savePhoto(c.env.PHOTOS, user.id, body.photo)
      await updateUser(c.env.DB, user.id, photo_key ? { ...fields, photo_key } : fields)
      return done(c, { id: user.id }, '/profile?saved=1')
    } catch (e) {
      return failWith((e as Error).message, user)
    }
  }
  const token = newToken()
  const created = await createUser(c.env.DB, {
    role: 'explorer', organisation: null, photo_key: null, description: null, ...fields, token_hash: await hashToken(token),
  })
  setCookie(c, COOKIE_NAME, token, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: COOKIE_MAX_AGE })
  try {
    const photo_key = await savePhoto(c.env.PHOTOS, created.id, body.photo)
    if (photo_key) await updateUser(c.env.DB, created.id, { photo_key })
    return done(c, { id: created.id }, '/?welcome=1')
  } catch (e) {
    return failWith((e as Error).message, created)
  }
})

// Companions arrive as parallel form fields (companion_name, companion_phone, companion_phone_country)
// or as a JSON array of { name, phone }.
function readCompanions(body: Body): Array<{ name: string; phone: string | null }> {
  if (str(body, 'company') === 'alone') return []
  const raw = body.companions as unknown
  if (Array.isArray(raw)) {
    return raw
      .filter((x): x is { name: unknown; phone?: unknown } => !!x && typeof x === 'object')
      .map((x) => ({ name: String(x.name ?? '').trim(), phone: typeof x.phone === 'string' ? normalizePhone(x.phone) : null }))
      .filter((x) => x.name)
  }
  const list = (k: string) => {
    const v = body[k] as unknown
    return Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : '')) : typeof v === 'string' ? [v] : []
  }
  const names = list('companion_name')
  const phones = list('companion_phone')
  const codes = list('companion_phone_country')
  return names
    .map((n, i) => ({ name: n.trim().slice(0, 80), phone: normalizePhone(phones[i] ?? null, codes[i] ?? '27') }))
    .filter((x) => x.name)
}

api.post('/trips', requireApiRole('explorer'), async (c) => {
  const user = c.var.user!
  const body = await readBody(c)
  const now = Date.now()
  const activity = str(body, 'activity') as Activity | null
  const area = str(body, 'area') as Area | null
  const rawReturn = body.return_by as unknown
  const return_by = parseReturnBy(typeof rawReturn === 'number' ? rawReturn : str(body, 'return_by'), now)
  const fail = async (error: string, status: 400 | 409, errorAt: 'intro' | 'when' | 'photos' = 'photos') => {
    if (wantsJson(c)) return c.json({ error }, status)
    const act = activity && activity in ACTIVITIES ? activity : 'hike'
    const raw = body.checklist as unknown
    const draft = {
      destination_text: str(body, 'destination_text'),
      route_text: str(body, 'route_text'),
      return_by: str(body, 'return_by'),
      checklist: Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? [raw] : [],
      companions: readCompanions({ ...body, company: 'group' }),
      alone: str(body, 'company') === 'alone',
    }
    return c.html(await newTripPage(c.env, user, act, error, { errorAt, draft }), status)
  }
  if (!activity || !(activity in ACTIVITIES)) return fail('Pick an activity', 400, 'intro')
  if (area && !(area in AREAS)) return fail('Unknown area', 400, 'intro')
  if (!return_by) return fail('"Back by" must be a time in the future', 400, 'when')

  const raw = body.checklist as unknown
  const checklist = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' && raw ? [raw] : []
  let photo_key: string | null
  let newShoe: string | null
  let newGear: string | null = null
  try {
    photo_key = await savePhoto(c.env.PHOTOS, user.id, body.photo)
    newShoe = await savePhoto(c.env.PHOTOS, user.id, body.shoe_photo)
    if (GEAR[activity]) newGear = await savePhoto(c.env.PHOTOS, user.id, body.gear_photo)
  } catch (e) {
    return fail((e as Error).message, 400)
  }
  const own = (k: string | null) => (k && k.startsWith(`users/${user.id}/`) ? k : null)
  // A previous photo picked on the form wins; an upload counts when "new" is picked or no choice was sent.
  const shoe_photo_key = own(str(body, 'shoe_photo_key')) ?? newShoe
  const gear_photo_key = GEAR[activity] ? own(str(body, 'gear_photo_key')) ?? newGear : null

  try {
    const trip = await startTrip(c.env.DB, user.id, {
      activity, area: area ?? 'other', destination_text: str(body, 'destination_text'),
      route_text: str(body, 'route_text'), companions_text: str(body, 'companions_text'), wearing_text: str(body, 'wearing_text'),
      photo_key, shoe_photo_key, gear_photo_key, companions: readCompanions(body),
      start_lat: num(body, 'start_lat'), start_lng: num(body, 'start_lng'), start_accuracy: num(body, 'start_accuracy'),
      return_by, checklist, battery_at_start: num(body, 'battery'),
    }, now)
    // Name the start point after responding; a slow or failed lookup never holds up a trip.
    if (trip.start_lat != null && trip.start_lng != null) {
      const lookup = getPlaceLookup(c.env)
      const lat = trip.start_lat, lng = trip.start_lng
      c.executionCtx.waitUntil(
        lookup(lat, lng)
          .then((place) => (place ? setStartPlace(c.env.DB, trip.id, place) : undefined))
          .catch((e) => console.warn('place lookup failed', String(e))),
      )
    }
    return done(c, { id: trip.id }, '/trip')
  } catch (e) {
    if (e instanceof TripOpenError) return fail(e.message, 409, 'intro')
    throw e
  }
})

api.get('/place', requireApiRole('explorer'), async (c) => {
  const lat = Number(c.req.query('lat')), lng = Number(c.req.query('lng'))
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return c.json({ error: 'Bad coordinates' }, 400)
  try {
    return c.json({ place: await getPlaceLookup(c.env)(lat, lng) })
  } catch {
    return c.json({ place: null })
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
  if (!return_by) return tripFail(c, 'Pick a time in the future', 400)
  if (!(await extendTrip(c.env.DB, trip.id, return_by, now))) return tripFail(c, 'Trip cannot be extended', 409)
  return done(c, { return_by }, '/trip')
})

api.post('/trips/:id/back', requireApiRole('explorer'), async (c) => {
  const trip = await ownTrip(c, c.req.param('id'))
  if (!trip) return c.json({ error: 'Not found' }, 404)
  if (!(await markBack(c.env.DB, trip.id, Date.now()))) return tripFail(c, 'Trip is not open', 409)
  return done(c, { ok: true }, '/?back=1')
})

api.post('/trips/:id/help', requireApiRole('explorer'), async (c) => {
  const user = c.var.user!
  const trip = await ownTrip(c, c.req.param('id'))
  if (!trip) return c.json({ error: 'Not found' }, 404)
  if (trip.status === 'help') return done(c, { ok: true }, '/trip')
  if (!(await requestHelp(c.env.DB, trip.id, Date.now()))) return tripFail(c, 'Trip is not open', 409)
  const { sent } = await pushToRoles(c.env.DB, getSender(c.env), ['operator', 'admin'], helpPayload(user, trip))
  if (sent > 0) await markOperatorsAlerted(c.env.DB, trip.id, Date.now())
  else console.error('help request reached no operators', trip.id)
  return done(c, { ok: true }, '/trip')
})

api.post('/trips/:id/cancel', requireApiRole('explorer'), async (c) => {
  const trip = await ownTrip(c, c.req.param('id'))
  if (!trip) return c.json({ error: 'Not found' }, 404)
  if (!(await cancelHelp(c.env.DB, trip.id, Date.now()))) return tripFail(c, 'Trip is not in help', 409)
  return done(c, { ok: true }, '/?cancelled=1')
})

api.post('/trips/:id/positions', requireApiRole('explorer'), async (c) => {
  const trip = await ownTrip(c, c.req.param('id'))
  if (!trip) return c.json({ error: 'Not found' }, 404)
  if (trip.status === 'closed') return c.json({ error: 'Trip is closed' }, 409)
  const items = (await c.req.json().catch(() => null)) as unknown
  if (!Array.isArray(items) || items.length === 0 || items.length > 10) return c.json({ error: 'Send an array of 1 to 10 positions' }, 400)
  const now = Date.now()
  const oneHourAgo = now - 60 * 60_000
  const rows = []
  for (const p of items as Array<Record<string, unknown>>) {
    const lat = Number(p.lat)
    const lng = Number(p.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return c.json({ error: 'lat and lng must be numbers' }, 400)
    const at = Math.min(Number.isFinite(Number(p.at)) && p.at != null ? Number(p.at) : now, now)
    if (at < oneHourAgo) continue
    rows.push({
      trip_id: trip.id, lat, lng,
      accuracy: Number.isFinite(Number(p.accuracy)) && p.accuracy != null ? Number(p.accuracy) : null,
      battery: Number.isFinite(Number(p.battery)) && p.battery != null ? Math.round(Number(p.battery)) : null,
      at,
    })
  }
  await insertPositions(c.env.DB, rows)
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
