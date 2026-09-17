import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { ACTIVITIES, type Activity } from '../lib/constants'
import { getChecklist } from '../lib/db'
import { requireRole } from '../lib/middleware'
import { canSeePhoto } from '../lib/photos'
import { getOpenTrip, lastTripForUser, previousShoePhotos } from '../lib/trips'
import { Layout } from '../views/layout'
import { ActiveTrip, Home, HelpScreen, NewTripForm, ProfileForm } from '../views/explorer'

export const explorer = new Hono<AppEnv>()

explorer.get('/', requireRole('explorer'), async (c) => {
  const user = c.var.user!
  if (await getOpenTrip(c.env.DB, user.id)) return c.redirect('/trip')
  const last = await lastTripForUser(c.env.DB, user.id)
  return c.html(
    <Layout title="Home" user={user} bodyAttrs={{ 'data-vapid': c.env.VAPID_PUBLIC_KEY }}>
      <Home user={user} last={last} welcome={c.req.query('welcome') === '1'} />
    </Layout>,
  )
})

explorer.get('/trip', requireRole('explorer'), async (c) => {
  const user = c.var.user!
  const trip = await getOpenTrip(c.env.DB, user.id)
  if (!trip) return c.redirect('/')
  const attrs = { 'data-trip-id': trip.id, 'data-trip-status': trip.status, 'data-vapid': c.env.VAPID_PUBLIC_KEY, 'data-emergency': c.env.EMERGENCY_PHONE }
  const inner = trip.status === 'help' ? <HelpScreen trip={trip} emergency={c.env.EMERGENCY_PHONE} /> : <ActiveTrip trip={trip} />
  return c.html(<Layout title="Your trip" user={user} bodyAttrs={attrs}>{inner}</Layout>)
})

explorer.get('/trip/new', requireRole('explorer'), async (c) => {
  const user = c.var.user!
  if (await getOpenTrip(c.env.DB, user.id)) return c.redirect('/trip')
  const activity = (c.req.query('activity') ?? 'hike') as Activity
  if (!(activity in ACTIVITIES)) return c.redirect('/')
  const [checklist, shoes] = await Promise.all([getChecklist(c.env.DB, activity), previousShoePhotos(c.env.DB, user.id)])
  return c.html(<Layout title="New trip" user={user}><NewTripForm user={user} activity={activity} checklist={checklist} shoes={shoes} /></Layout>)
})

explorer.get('/profile', async (c) => {
  const user = c.var.user
  if (user && user.role !== 'explorer') return c.text('Forbidden', 403)
  return c.html(<Layout title="Profile" user={user}><ProfileForm user={user} saved={c.req.query('saved') === '1'} /></Layout>)
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
