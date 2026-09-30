import type { Context } from 'hono'
import { Hono } from 'hono'
import { setCookie } from 'hono/cookie'
import type { AppEnv } from '../env'
import { COOKIE_MAX_AGE, COOKIE_NAME, hashToken, newToken } from '../lib/auth'
import { ACTIVITIES, AREAS, BLOOD_TYPES, GEAR, GENDERS, LANGUAGES, RELATIONS, type Activity, type Area } from '../lib/constants'
import { addMessage, addSubscription, createUser, deleteSubscription, getChecklist, getMessageMedia, getSetting, getUserById, insertPositions, lastPositionsByTrip, listMessages, listPositions, MAX_MESSAGE, SIGNALS, updateUser, type User } from '../lib/db'
import { done, num, readBody, requireApiRole, str, wantsJson, type Body } from '../lib/middleware'
import { normalizePhone } from '../lib/phone'
import { getPlaceLookup } from '../lib/places'
import { saveMessageMedia, savePhoto } from '../lib/photos'
import { FCM_PREFIX, getSender, helpPayload, pushToRoles, pushToUser } from '../lib/push'
import { adminSetStatus, ADMIN_STATUSES, cancelHelp, extendTrip, getOpenTrip, getTrip, listCompanions, listOpenTrips, listPets, soundSiren, tripLine, tripPlace, markBack, markHelpAlerted, operatorClose, parseReturnBy, requestHelp, setPets, setStartPlace, startTrip, TripOpenError, type Trip } from '../lib/trips'
import { newTripPage, profilePage } from './explorer'
import { redeemLink } from './auth'

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
    allergies: str(body, 'allergies'),
    conditions: str(body, 'conditions'),
    medication: str(body, 'medication'),
    blood_type: pick('blood_type', BLOOD_TYPES),
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
      return done(c, { id: user.id }, '/?saved=1')
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
    return done(c, { id: created.id, token }, '/?welcome=1')
  } catch (e) {
    return failWith((e as Error).message, created)
  }
})

const readChecklist = (raw: unknown) =>
  (Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' && raw ? [raw] : []).slice(0, 50).map((s) => s.slice(0, 200))

// Companions arrive as parallel form fields (companion_name, companion_phone, companion_phone_country)
// or as a JSON array of { name, phone }.
// Pets come as pet_name fields or { name, kind: 'pet' }, and count even when going "alone".
type CompanionIn = { name: string; phone: string | null; kind: 'person' | 'pet' }
function readCompanions(body: Body): CompanionIn[] {
  const alone = str(body, 'company') === 'alone'
  const raw = body.companions as unknown
  let all: CompanionIn[]
  if (Array.isArray(raw)) {
    all = raw
      .filter((x): x is { name: unknown; phone?: unknown; kind?: unknown } => !!x && typeof x === 'object')
      .map((x) => x.kind === 'pet'
        ? { name: String(x.name ?? '').trim().slice(0, 80), phone: null, kind: 'pet' as const }
        : { name: String(x.name ?? '').trim().slice(0, 80), phone: typeof x.phone === 'string' ? normalizePhone(x.phone) : null, kind: 'person' as const })
  } else {
    const list = (k: string) => {
      const v = body[k] as unknown
      return Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : '')) : typeof v === 'string' ? [v] : []
    }
    const phones = list('companion_phone')
    const codes = list('companion_phone_country')
    all = [
      ...list('companion_name').map((n, i) => ({ name: n.trim().slice(0, 80), phone: normalizePhone(phones[i] ?? null, codes[i] ?? '27'), kind: 'person' as const })),
      ...list('pet_name').map((n) => ({ name: n.trim().slice(0, 80), phone: null, kind: 'pet' as const })),
    ]
  }
  return all.filter((x) => x.name && !(alone && x.kind === 'person'))
}

api.post('/trips', requireApiRole('explorer', 'operator', 'admin'), async (c) => {
  const user = c.var.user!
  const body = await readBody(c)
  const now = Date.now()
  const activity = str(body, 'activity') as Activity | null
  const area = str(body, 'area') as Area | null
  const rawReturn = body.return_by as unknown
  const return_by = parseReturnBy(typeof rawReturn === 'number' ? rawReturn : str(body, 'return_by'), now)
  const fail = async (error: string, status: 400 | 409, errorAt: 'intro' | 'where' | 'when' | 'photos' = 'photos') => {
    if (wantsJson(c)) return c.json({ error }, status)
    const act = activity && activity in ACTIVITIES ? activity : 'hike'
    const raw = body.checklist as unknown
    const draft = {
      destination_text: str(body, 'destination_text'),
      activity_text: str(body, 'activity_text'),
      route_text: str(body, 'route_text'),
      return_by: str(body, 'return_by'),
      checklist: readChecklist(raw),
      companions: readCompanions({ ...body, company: 'group' }),
      alone: str(body, 'company') === 'alone',
    }
    return c.html(await newTripPage(c.env, user, act, error, { errorAt, draft }), status)
  }
  if (!activity || !(activity in ACTIVITIES)) return fail('Pick an activity', 400, 'intro')
  if (area && !(area in AREAS)) return fail('Unknown area', 400, 'intro')
  const activity_text = str(body, 'activity_text')?.slice(0, 60) ?? null
  if (activity === 'other' && !activity_text) return fail('Tell us what you\'re doing', 400, 'where')
  if (!str(body, 'destination_text') || !str(body, 'route_text')) return fail('Tell us where you\'re headed and your route', 400, 'where')
  if (num(body, 'start_lat') == null || num(body, 'start_lng') == null) return fail('We need your location. Turn on location for this site and try again.', 400, 'where')
  if (!return_by) return fail('"Back by" must be a time in the future', 400, 'when')

  const raw = body.checklist as unknown
  const checklist = readChecklist(raw)
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
      activity, area: area ?? 'other', activity_text, destination_text: str(body, 'destination_text'),
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

api.get('/place', requireApiRole('explorer', 'operator', 'admin'), async (c) => {
  const lat = Number(c.req.query('lat')), lng = Number(c.req.query('lng'))
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return c.json({ error: 'Bad coordinates' }, 400)
  try {
    return c.json({ place: await getPlaceLookup(c.env)(lat, lng) })
  } catch {
    return c.json({ place: null })
  }
})

api.post('/trips/:id/extend', requireApiRole('explorer', 'operator', 'admin'), async (c) => {
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
  if (!(await extendTrip(c.env.DB, trip.id, return_by, now))) return tripFail(c, "We couldn't add time. Your trip may have ended already.", 409)
  return done(c, { return_by }, '/trip')
})

api.post('/trips/:id/back', requireApiRole('explorer', 'operator', 'admin'), async (c) => {
  const trip = await ownTrip(c, c.req.param('id'))
  if (!trip) return c.json({ error: 'Not found' }, 404)
  if (!(await markBack(c.env.DB, trip.id, Date.now()))) return tripFail(c, 'That trip has already ended.', 409)
  return done(c, { ok: true }, `/trips/${trip.id}/done`)
})

// "My pets": the form sends the whole list, which replaces what's saved.
api.post('/pets', requireApiRole('explorer', 'operator', 'admin'), async (c) => {
  const b = await readBody(c)
  const raw = (b as Record<string, unknown>).pet_name ?? (b as Record<string, unknown>).pets
  const names = (Array.isArray(raw) ? raw : raw == null ? [] : [raw]).filter((n): n is string => typeof n === 'string')
  await setPets(c.env.DB, c.var.user!.id, names, Date.now())
  return done(c, { pets: await listPets(c.env.DB, c.var.user!.id) }, '/pets?saved=1')
})

api.post('/trips/:id/help', requireApiRole('explorer', 'operator', 'admin'), async (c) => {
  const user = c.var.user!
  const trip = await ownTrip(c, c.req.param('id'))
  if (!trip) return c.json({ error: 'Not found' }, 404)
  if (trip.status === 'help') return done(c, { ok: true }, '/trip')
  if (!(await requestHelp(c.env.DB, trip.id, Date.now()))) return tripFail(c, 'That trip has already ended. Phone SARZA if you need help.', 409)
  const { sent } = await pushToRoles(c.env.DB, getSender(c.env), ['operator', 'admin'], helpPayload(user, trip))
  if (sent > 0) await markHelpAlerted(c.env.DB, trip.id, Date.now())
  else console.error('help request reached no operators', trip.id)
  return done(c, { ok: true }, '/trip')
})

api.post('/trips/:id/cancel', requireApiRole('explorer', 'operator', 'admin'), async (c) => {
  const trip = await ownTrip(c, c.req.param('id'))
  if (!trip) return c.json({ error: 'Not found' }, 404)
  if (!(await cancelHelp(c.env.DB, trip.id))) return tripFail(c, "You've already cancelled that call for help.", 409)
  return done(c, { ok: true }, '/trip')
})

api.post('/trips/:id/positions', requireApiRole('explorer', 'operator', 'admin'), async (c) => {
  const trip = await ownTrip(c, c.req.param('id'))
  if (!trip) return c.json({ error: 'Not found' }, 404)
  if (trip.status === 'closed') return c.json({ error: 'Trip is closed' }, 409)
  const items = (await c.req.json().catch(() => null)) as unknown
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) return c.json({ error: 'Send an array of 1 to 50 positions' }, 400)
  const now = Date.now()
  // ponytail: 10 minutes of slack for a phone clock that runs behind the server's
  const since = trip.created_at - 10 * 60_000
  const opt = (v: unknown) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null)
  const rows = []
  for (const p of items as Array<Record<string, unknown>>) {
    const lat = Number(p.lat)
    const lng = Number(p.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return c.json({ error: 'lat and lng must be numbers' }, 400)
    const at = Math.min(opt(p.at) ?? now, now)
    if (at < since) continue
    const battery = opt(p.battery)
    rows.push({
      trip_id: trip.id, lat, lng, at,
      accuracy: opt(p.accuracy),
      battery: battery == null ? null : Math.round(battery),
      altitude: opt(p.altitude),
      altitude_accuracy: opt(p.altitude_accuracy),
      signal: (SIGNALS as readonly unknown[]).includes(p.signal) ? (p.signal as string) : null,
    })
  }
  const saved = await insertPositions(c.env.DB, rows)
  return c.json({ ok: true, saved, status: trip.status, return_by: trip.return_by, siren_at: trip.siren_at })
})

// Chat: an explorer sees only their own trip's thread, operators and admins any trip's.
async function chatTrip(c: Context<AppEnv>): Promise<Trip | null> {
  const trip = await getTrip(c.env.DB, c.req.param('id')!)
  return trip && (c.var.user!.role !== 'explorer' || trip.user_id === c.var.user!.id) ? trip : null
}

api.get('/trips/:id/messages/:mid/media', requireApiRole('explorer', 'operator', 'admin'), async (c) => {
  const trip = await chatTrip(c)
  const row = trip && (await getMessageMedia(c.env.DB, trip.id, Number(c.req.param('mid'))))
  const obj = row && (await c.env.PHOTOS.get(row.media_key))
  if (!obj) return c.text('Not found', 404)
  return new Response(obj.body, {
    headers: { 'content-type': row.media_type, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' },
  })
})

api.get('/trips/:id/messages', requireApiRole('explorer', 'operator', 'admin'), async (c) => {
  const trip = await chatTrip(c)
  if (!trip) return c.json({ error: 'Not found' }, 404)
  return c.json({ messages: await listMessages(c.env.DB, trip.id) })
})

api.post('/trips/:id/messages', requireApiRole('explorer', 'operator', 'admin'), async (c) => {
  const user = c.var.user!
  const trip = await chatTrip(c)
  if (!trip) return c.json({ error: 'Not found' }, 404)
  if (trip.status === 'closed') return c.json({ error: 'Trip is closed' }, 409)
  const b = await readBody(c)
  const text = typeof b.body === 'string' ? b.body.trim() : ''
  if (text.length > MAX_MESSAGE) return c.json({ error: `Write up to ${MAX_MESSAGE} characters` }, 400)
  let media: { key: string; type: string } | null = null
  try {
    media = await saveMessageMedia(c.env.PHOTOS, trip.id, b.media)
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400)
  }
  if (!text && !media) return c.json({ error: `Write 1 to ${MAX_MESSAGE} characters` }, 400)
  await addMessage(c.env.DB, trip.id, user, text, media ?? undefined)
  const said = text || (media!.type.startsWith('audio/') ? 'Voice note' : 'Photo')
  const short = said.length > 120 ? said.slice(0, 119) + '…' : said
  const tag = `chat-${trip.id}`
  const send = getSender(c.env)
  c.executionCtx.waitUntil(
    (user.role === 'explorer'
      ? pushToRoles(c.env.DB, send, ['operator', 'admin'], { title: `Message from ${user.name}`, body: short, url: `/board/trips/${trip.id}`, tag, kind: 'message' })
      : pushToUser(c.env.DB, send, trip.user_id, { title: `SARZA: ${user.name}`, body: short, url: '/trip', tag, kind: 'message' })
    ).then((r) => { if (!r.sent) console.warn('message notification reached no one', trip.id, user.role === 'explorer' ? 'to operators' : 'to explorer') }),
  )
  return done(c, { messages: await listMessages(c.env.DB, trip.id) }, user.role === 'explorer' ? '/trip' : `/board/trips/${trip.id}`)
})

api.post('/board/trips/:id/close', requireApiRole('operator', 'admin'), async (c) => {
  if (!(await operatorClose(c.env.DB, c.req.param('id'), Date.now()))) return c.json({ error: 'Trip is already closed' }, 409)
  return done(c, { ok: true }, '/board')
})

api.post('/admin/trips/:id/status', requireApiRole('admin'), async (c) => {
  const id = c.req.param('id')
  const status = str(await readBody(c), 'status')
  const back = `/board/trips/${id}`
  if (!(ADMIN_STATUSES as readonly (string | null)[]).includes(status)) return c.json({ error: 'Pick active, overdue, help or closed' }, 400)
  try {
    if (!(await adminSetStatus(c.env.DB, id, status as (typeof ADMIN_STATUSES)[number], Date.now()))) return c.json({ error: 'Not found' }, 404)
  } catch (e) {
    if (!(e instanceof TripOpenError)) throw e
    const error = 'This explorer already has another open trip. Close that one first.'
    return wantsJson(c) ? c.json({ error }, 409) : c.redirect(`${back}?error=${encodeURIComponent(error)}`, 303)
  }
  return done(c, { ok: true }, `${back}?saved=1`)
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

// ---------- native apps ----------

// A user as the apps see them: no token hashes.
function publicUser(user: User) {
  const { token_hash: _t, app_token_hash: _a, magic_link_expires: _m, ...rest } = user as User & { magic_link_expires?: number | null }
  return rest
}

// Everything the explorer screens need in one call, so the app can keep a copy for when there's no signal.
api.get('/me', requireApiRole('explorer', 'operator', 'admin'), async (c) => {
  const user = c.var.user!
  const [trip, pets, grace, sms, checklists] = await Promise.all([
    getOpenTrip(c.env.DB, user.id), listPets(c.env.DB, user.id), getSetting(c.env.DB, 'grace_minutes', '30'),
    getSetting(c.env.DB, 'sms_number', ''),
    Promise.all(Object.keys(ACTIVITIES).map(async (a) => [a, await getChecklist(c.env.DB, a)] as const)),
  ])
  return c.json({
    user: publicUser(user), trip, pets, grace_minutes: Number(grace), emergency_phone: c.env.EMERGENCY_PHONE,
    sms_number: sms || null, checklists: Object.fromEntries(checklists), activities: ACTIVITIES,
  })
})

// The app's half of the magic link: the operator taps the emailed link, the app opens and sends it here.
api.post('/auth/verify', async (c) => {
  const user = await redeemLink(c.env, str(await readBody(c), 'link') ?? '')
  if (!user) return c.json({ error: 'That link has expired or was already used. Ask for a new one.' }, 400)
  const token = newToken()
  await updateUser(c.env.DB, user.id, { app_token_hash: await hashToken(token) })
  return c.json({ token, user: publicUser(user) })
})

api.post('/logout', requireApiRole('explorer', 'operator', 'admin'), async (c) => {
  const user = c.var.user!
  const bearer = c.req.header('authorization')?.match(/^Bearer (.+)$/)?.[1] ?? ''
  const hash = await hashToken(bearer)
  await updateUser(c.env.DB, user.id, user.app_token_hash === hash ? { app_token_hash: null } : { token_hash: null })
  return c.json({ ok: true })
})

// A phone's FCM token. One phone gets one account's pushes: signing in as someone else moves it.
api.post('/push/device', requireApiRole('explorer', 'operator', 'admin'), async (c) => {
  const token = str(await readBody(c), 'token')
  if (!token || token.length > 4096) return c.json({ error: 'Bad token' }, 400)
  const endpoint = FCM_PREFIX + token
  await deleteSubscription(c.env.DB, endpoint)
  await addSubscription(c.env.DB, c.var.user!.id, { endpoint, p256dh: '', auth: '' })
  return c.json({ ok: true })
})

api.get('/board', requireApiRole('operator', 'admin'), async (c) => {
  const trips = await listOpenTrips(c.env.DB)
  const last = await lastPositionsByTrip(c.env.DB, trips.map((t) => t.id))
  return c.json({ trips: trips.map((t) => ({ ...t, place: tripPlace(t), line: tripLine(t), last: last.get(t.id) ?? null })) })
})

api.get('/board/trips/:id', requireApiRole('operator', 'admin'), async (c) => {
  const trip = await getTrip(c.env.DB, c.req.param('id'))
  const user = trip && (await getUserById(c.env.DB, trip.user_id))
  if (!trip || !user) return c.json({ error: 'Not found' }, 404)
  const [positions, companions, messages] = await Promise.all([
    listPositions(c.env.DB, trip.id, 50), listCompanions(c.env.DB, trip.id), listMessages(c.env.DB, trip.id),
  ])
  return c.json({ trip: { ...trip, place: tripPlace(trip), line: tripLine(trip) }, user: publicUser(user), positions, companions, messages })
})

// Sound the explorer's siren: pushed now, and repeated in the reply to the phone's next position upload.
api.post('/board/trips/:id/siren', requireApiRole('operator', 'admin'), async (c) => {
  const trip = await getTrip(c.env.DB, c.req.param('id'))
  if (!trip || !(await soundSiren(c.env.DB, trip.id, Date.now()))) return c.json({ error: 'Trip is closed' }, 409)
  const send = getSender(c.env)
  c.executionCtx.waitUntil(pushToUser(c.env.DB, send, trip.user_id, {
    title: 'SARZA is looking for you', body: 'Your phone is sounding so searchers can find you.', url: '/trip', tag: 'siren', kind: 'siren',
  }))
  return done(c, { ok: true }, `/board/trips/${trip.id}`)
})
