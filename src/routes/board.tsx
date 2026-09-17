import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { getUserById, lastPositionsByTrip, listPositions } from '../lib/db'
import { requireRole } from '../lib/middleware'
import { getTrip, listOpenTrips } from '../lib/trips'
import { Board, TripDetail } from '../views/board'
import { Layout } from '../views/layout'

export const board = new Hono<AppEnv>()
board.use('/board/*', requireRole('operator', 'admin'))
board.use('/board', requireRole('operator', 'admin'))

board.get('/board', async (c) => {
  const area = c.req.query('area') || null
  const all = await listOpenTrips(c.env.DB)
  const trips = area ? all.filter((t) => t.area === area) : all
  const last = await lastPositionsByTrip(c.env.DB, trips.map((t) => t.id))
  const rows = trips.map((t) => ({ ...t, last: last.get(t.id) ?? null }))
  const attrs = { 'data-refresh': '30', 'data-vapid': c.env.VAPID_PUBLIC_KEY }
  return c.html(<Layout title="Board" user={c.var.user} bodyAttrs={attrs}><Board rows={rows} area={area} now={Date.now()} /></Layout>)
})

board.get('/board/trips/:id', async (c) => {
  const trip = await getTrip(c.env.DB, c.req.param('id'))
  if (!trip) return c.text('Not found', 404)
  const [user, positions] = await Promise.all([getUserById(c.env.DB, trip.user_id), listPositions(c.env.DB, trip.id, 50)])
  if (!user) return c.text('Not found', 404)
  return c.html(<Layout title={user.name} user={c.var.user}><TripDetail trip={trip} user={user} positions={positions} now={Date.now()} /></Layout>)
})
