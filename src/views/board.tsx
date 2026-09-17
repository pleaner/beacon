import type { FC } from 'hono/jsx'
import { ACTIVITIES, AREAS } from '../lib/constants'
import type { Position, User } from '../lib/db'
import type { OpenTripRow, Trip } from '../lib/trips'

export function ago(from: number, now: number): string {
  const mins = Math.floor((now - from) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} h ${mins % 60} min ago`
  return `${Math.floor(hours / 24)} days ago`
}

export const mapsUrl = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat},${lng}`

const fmt = (ms: number) =>
  new Date(ms).toLocaleString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg' })

export const Board: FC<{ rows: Array<OpenTripRow & { last: Position | null }>; area: string | null; now: number }> = ({ rows, area, now }) => (
  <>
    <h1>Open trips</h1>
    <div id="alerts-off" class="banner warn" hidden>
      Notifications are off on this phone. <button class="btn quiet" type="button" data-enable-push>Enable alerts</button>
    </div>
    <form method="get" action="/board">
      <select name="area" onchange="this.form.submit()">
        <option value="">All areas</option>
        {Object.entries(AREAS).map(([k, label]) => <option value={k} selected={area === k}>{label}</option>)}
      </select>
    </form>
    {rows.length === 0 && <p class="muted">Nobody out right now.</p>}
    <ul class="list">
      {rows.map((r) => (
        <li>
          <a href={`/board/trips/${r.id}`}>
            <span class={`pill ${r.status}`}>{r.status}</span> <strong>{r.user_name}</strong>
            <br />
            {ACTIVITIES[r.activity]} in {AREAS[r.area]}. Back by {fmt(r.return_by)}.
            <br />
            <span class="muted">
              {r.last ? `Last position ${ago(r.last.at, now)}` : 'No position yet'}
              {r.last?.battery != null ? `, battery ${r.last.battery}%` : ''}
            </span>
          </a>
        </li>
      ))}
    </ul>
    <p class="muted">Refreshes every 30 seconds.</p>
  </>
)

export const TripDetail: FC<{ trip: Trip; user: User; positions: Position[]; now: number }> = ({ trip, user, positions, now }) => {
  const last = positions[0]
  const checklist = JSON.parse(trip.checklist_json) as string[]
  return (
    <>
      <p><a href="/board">← Board</a></p>
      <h1><span class={`pill ${trip.status}`}>{trip.status}</span> {user.name}</h1>
      <p>
        <a class="btn" href={`tel:${user.phone}`}>Phone {user.name.split(' ')[0]} {user.phone}</a>
        {user.emergency_phone && (
          <a class="btn quiet" href={`tel:${user.emergency_phone}`}>Phone {user.emergency_name ?? 'emergency contact'} {user.emergency_phone}</a>
        )}
      </p>
      <div class="banner warn">
        {last ? `Last position ${ago(last.at, now)}. ` : 'No position received. '}
        Positions only arrive while their app is open on screen. Silence means the phone is locked, flat, or out of signal.
      </div>
      <h2>Trip</h2>
      <table>
        <tr><th>Activity</th><td>{ACTIVITIES[trip.activity]} in {AREAS[trip.area]}</td></tr>
        <tr><th>Started</th><td>{fmt(trip.start_at)}{trip.start_lat != null && trip.start_lng != null && <> at <a href={mapsUrl(trip.start_lat, trip.start_lng)}>start point</a></>}</td></tr>
        <tr><th>Back by</th><td>{fmt(trip.return_by)}</td></tr>
        <tr><th>Route</th><td>{trip.route_text ?? '-'}</td></tr>
        <tr><th>With</th><td>{trip.companions_text ?? '-'}</td></tr>
        <tr><th>Wearing</th><td>{trip.wearing_text ?? '-'}</td></tr>
        <tr><th>Battery at start</th><td>{trip.battery_at_start != null ? `${trip.battery_at_start}%` : 'unknown'}</td></tr>
        <tr><th>Checklist ticked</th><td>{checklist.length ? checklist.join(', ') : 'nothing'}</td></tr>
      </table>
      <div class="thumbs">
        {trip.photo_key && <a href={`/photos/${trip.photo_key}`}><img src={`/photos/${trip.photo_key}`} alt="Today" /></a>}
        {trip.shoe_photo_key && <a href={`/photos/${trip.shoe_photo_key}`}><img src={`/photos/${trip.shoe_photo_key}`} alt="Shoe" /></a>}
      </div>
      <h2>Person</h2>
      {user.photo_key && <img class="photo" src={`/photos/${user.photo_key}`} alt="" width="160" />}
      <table>
        <tr><th>Description</th><td>{user.description ?? '-'}</td></tr>
        <tr><th>Email</th><td>{user.email ?? '-'}</td></tr>
        <tr><th>Emergency contact</th><td>{user.emergency_name ?? '-'} {user.emergency_phone ?? ''}</td></tr>
      </table>
      <h2>Positions</h2>
      {positions.length === 0 && <p class="muted">None yet.</p>}
      <ul class="list">
        {positions.map((p) => (
          <li>
            <a href={mapsUrl(p.lat, p.lng)}>{p.lat.toFixed(5)}, {p.lng.toFixed(5)}</a>
            <span class="muted"> {ago(p.at, now)}{p.accuracy != null ? `, ±${Math.round(p.accuracy)} m` : ''}{p.battery != null ? `, ${p.battery}%` : ''}</span>
          </li>
        ))}
      </ul>
      {trip.status !== 'closed' && (
        <form method="post" action={`/api/board/trips/${trip.id}/close`} onsubmit="return confirm('Close this trip?')">
          <button class="btn" type="submit">Close trip</button>
        </form>
      )}
    </>
  )
}
