import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { getUserById, lastPositionsByTrip, listMessages, listPositions } from '../lib/db'
import { requireRole } from '../lib/middleware'
import { getTrip, listCompanions, listOpenTrips, tripLine, tripPlace } from '../lib/trips'
import { Board, Brief, STATUSES, TripDetail } from '../views/board'
import { Layout } from '../views/layout'

export const board = new Hono<AppEnv>()
board.use('/board/*', requireRole('operator', 'admin'))
board.use('/board', requireRole('operator', 'admin'))

board.get('/board', async (c) => {
  const s = c.req.query('status')
  const status = (STATUSES as readonly string[]).includes(s ?? '') ? (s as (typeof STATUSES)[number]) : null
  const q = (c.req.query('q') ?? '').trim().slice(0, 80)
  const all = await listOpenTrips(c.env.DB)
  const counts: Record<string, number> = {}
  for (const t of all) counts[t.status] = (counts[t.status] ?? 0) + 1
  const needle = q.toLowerCase()
  const trips = all.filter(
    (t) =>
      (!status || t.status === status) &&
      (!needle || [t.user_name, tripPlace(t), t.destination_text, t.route_text].some((v) => v?.toLowerCase().includes(needle))),
  )
  const last = await lastPositionsByTrip(c.env.DB, trips.map((t) => t.id))
  const rows = trips.map((t) => ({ ...t, last: last.get(t.id) ?? null }))
  const attrs = { 'data-refresh': '30', 'data-vapid': c.env.VAPID_PUBLIC_KEY }
  return c.html(
    <Layout title="Board" user={c.var.user} bodyAttrs={attrs} current="board" helpCount={counts.help}>
      <Board rows={rows} counts={counts} status={status} q={q} now={Date.now()} />
    </Layout>,
  )
})

board.get('/board/trips/:id', async (c) => {
  const trip = await getTrip(c.env.DB, c.req.param('id'))
  if (!trip) return c.text('Not found', 404)
  const [user, positions, companions, messages] = await Promise.all([
    getUserById(c.env.DB, trip.user_id), listPositions(c.env.DB, trip.id, 50), listCompanions(c.env.DB, trip.id), listMessages(c.env.DB, trip.id),
  ])
  if (!user) return c.text('Not found', 404)
  return c.html(
    <Layout title="Trip" user={c.var.user} current="board">
      <TripDetail trip={trip} user={user} positions={positions} companions={companions} messages={messages} now={Date.now()} />
    </Layout>,
  )
})

board.get('/board/trips/:id/brief', async (c) => {
  const trip = await getTrip(c.env.DB, c.req.param('id'))
  if (!trip) return c.text('Not found', 404)
  const [user, positions, companions] = await Promise.all([
    getUserById(c.env.DB, trip.user_id), listPositions(c.env.DB, trip.id, 50), listCompanions(c.env.DB, trip.id),
  ])
  if (!user) return c.text('Not found', 404)
  return c.html(
    <Layout title={`Brief ${user.name}`} user={c.var.user} variant="bare">
      <Brief trip={trip} user={user} positions={positions} companions={companions} now={Date.now()} />
    </Layout>,
  )
})

const xml = (s: string) => s.replace(/[<>&'"]/g, (ch) => `&#${ch.charCodeAt(0)};`)
const iso = (ms: number) => new Date(ms).toISOString()

// GPX 1.1 for CalTopo: the start point as a waypoint, the recorded positions as one track, oldest first.
board.get('/board/trips/:id/gpx', async (c) => {
  const trip = await getTrip(c.env.DB, c.req.param('id'))
  if (!trip) return c.text('Not found', 404)
  // ponytail: 5000 fixes is days of tracking; the cron prunes old positions anyway.
  const [user, positions] = await Promise.all([getUserById(c.env.DB, trip.user_id), listPositions(c.env.DB, trip.id, 5000)])
  if (!user) return c.text('Not found', 404)
  const name = xml(`${user.name} · ${tripLine(trip)}`)
  const wpt = trip.start_lat != null && trip.start_lng != null
    ? `<wpt lat="${trip.start_lat}" lon="${trip.start_lng}"><time>${iso(trip.start_at)}</time><name>${xml(`Start ${tripPlace(trip) ?? ''}`.trim())}</name></wpt>\n`
    : ''
  const pts = positions.reverse().map((p) =>
    `<trkpt lat="${p.lat}" lon="${p.lng}">${p.altitude != null ? `<ele>${p.altitude}</ele>` : ''}<time>${iso(p.at)}</time></trkpt>\n`).join('')
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Guardian by SARZA" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><name>${name}</name><time>${iso(Date.now())}</time></metadata>
${wpt}<trk><name>${name}</name><trkseg>
${pts}</trkseg></trk>
</gpx>
`
  return c.body(body, 200, {
    'content-type': 'application/gpx+xml',
    'content-disposition': `attachment; filename="trip-${trip.id.slice(0, 8)}.gpx"`,
  })
})
