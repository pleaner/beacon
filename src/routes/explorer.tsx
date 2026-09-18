import { Hono } from 'hono'
import type { AppEnv } from '../env'
import type { User } from '../lib/db'
import { ACTIVITIES, type Activity } from '../lib/constants'
import { getChecklist, getSetting } from '../lib/db'
import { requireRole } from '../lib/middleware'
import { canSeePhoto } from '../lib/photos'
import { getOpenTrip, lastTripForUser, previousGearPhotos, previousShoePhotos } from '../lib/trips'
import { Layout } from '../views/layout'
import { ActiveTrip, Home, HelpScreen, NewTripForm, ProfileForm, Welcome, type TripDraft } from '../views/explorer'

export const explorer = new Hono<AppEnv>()

explorer.get('/', async (c) => {
  const user = c.var.user
  if (!user) return c.html(<Layout title="Welcome" user={null} variant="bare" bodyClass="navy"><Welcome /></Layout>)
  if (user.role === 'operator' || user.role === 'admin') return c.redirect('/board')
  if (await getOpenTrip(c.env.DB, user.id)) return c.redirect('/trip')
  const last = await lastTripForUser(c.env.DB, user.id)
  const notice = c.req.query('back') === '1' ? "Welcome back. We've closed your trip." : undefined
  return c.html(
    <Layout title="Home" user={user} bodyAttrs={{ 'data-vapid': c.env.VAPID_PUBLIC_KEY }}>
      <Home user={user} last={last} welcome={c.req.query('welcome') === '1'} notice={notice} />
    </Layout>,
  )
})

explorer.get('/trip', requireRole('explorer'), async (c) => {
  const user = c.var.user!
  const trip = await getOpenTrip(c.env.DB, user.id)
  if (!trip) return c.redirect('/')
  const error = c.req.query('error')
  const attrs = { 'data-trip-id': trip.id, 'data-trip-status': trip.status, 'data-vapid': c.env.VAPID_PUBLIC_KEY, 'data-emergency': c.env.EMERGENCY_PHONE }
  if (trip.status === 'help') {
    return c.html(
      <Layout title="Help is coming" user={user} bodyAttrs={attrs} variant="bare" bodyClass="red">
        <HelpScreen trip={trip} emergency={c.env.EMERGENCY_PHONE} error={error} />
      </Layout>,
    )
  }
  return c.html(<Layout title="Your trip" user={user} bodyAttrs={attrs}><ActiveTrip trip={trip} error={error} /></Layout>)
})

explorer.get('/trip/new', requireRole('explorer'), async (c) => {
  const user = c.var.user!
  if (await getOpenTrip(c.env.DB, user.id)) return c.redirect('/trip')
  const activity = (c.req.query('activity') ?? 'hike') as Activity
  if (!(activity in ACTIVITIES)) return c.redirect('/')
  return c.html(await newTripPage(c.env, user, activity))
})

export async function newTripPage(env: Env, user: User, activity: Activity, error?: string, opts: { errorAt?: 'intro' | 'when' | 'photos'; draft?: TripDraft } = {}) {
  const [checklist, shoes, gear, grace] = await Promise.all([
    getChecklist(env.DB, activity), previousShoePhotos(env.DB, user.id), previousGearPhotos(env.DB, user.id, activity),
    getSetting(env.DB, 'grace_minutes', '30'),
  ])
  return (
    <Layout title="New trip" user={user} variant="bare" bodyClass="plain">
      <NewTripForm user={user} activity={activity} checklist={checklist} shoes={shoes} gear={gear} graceMinutes={Number(grace)} error={error} errorAt={opts.errorAt} draft={opts.draft} />
    </Layout>
  )
}

export function profilePage(user: User | null, opts: { error?: string; saved?: boolean; vapid?: string; draft?: Partial<User> } = {}) {
  return (
    <Layout title="Profile" user={user} variant="bare" bodyClass="plain" bodyAttrs={{ 'data-vapid': opts.vapid ?? '' }}>
      <ProfileForm user={user} error={opts.error} saved={opts.saved} draft={opts.draft} />
    </Layout>
  )
}

explorer.get('/profile', async (c) => {
  const user = c.var.user
  if (user && user.role !== 'explorer') return c.text('Forbidden', 403)
  const page = profilePage(user, { saved: c.req.query('saved') === '1', vapid: c.env.VAPID_PUBLIC_KEY })
  return c.html(page)
})

explorer.get('/photos/*', requireRole('explorer', 'operator', 'admin'), async (c) => {
  const key = c.req.path.slice('/photos/'.length)
  if (!canSeePhoto(c.var.user!, key)) return c.text('Forbidden', 403)
  const obj = await c.env.PHOTOS.get(key)
  if (!obj) return c.text('Not found', 404)
  return new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType ?? 'image/jpeg',
      'cache-control': 'private, max-age=86400',
      'x-content-type-options': 'nosniff',
    },
  })
})
