import type { FC } from 'hono/jsx'
import { LANGUAGES } from '../lib/constants'
import type { Position, User } from '../lib/db'
import { formatPhone } from '../lib/phone'
import { tripLine, tripPlace, type Companion, type OpenTripRow, type Trip } from '../lib/trips'
import { Icon, type IconName } from './icons'

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
  new Date(ms).toLocaleString('en-ZA', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Johannesburg' })

const ICON: Record<string, IconName> = { hike: 'hike', run: 'run', climb: 'climb', paraglide: 'paraglide', mtb: 'mtb', other: 'other' }

export type BoardRow = OpenTripRow & { last: Position | null }
export const STATUSES = ['help', 'overdue', 'active'] as const
type Filter = (typeof STATUSES)[number] | null

export const Board: FC<{ rows: BoardRow[]; counts: Record<string, number>; status: Filter; q: string; now: number }> = ({ rows, counts, status, q, now }) => {
  const total = STATUSES.reduce((n, s) => n + (counts[s] ?? 0), 0)
  const href = (s: Filter) => {
    const p = new URLSearchParams()
    if (s) p.set('status', s)
    if (q) p.set('q', q)
    const qs = p.toString()
    return qs ? `/board?${qs}` : '/board'
  }
  return (
    <main>
      <div class="row" style="justify-content: space-between; align-items: baseline;">
        <h1 class="display">Open trips</h1>
        <span class="muted" style="font-size: 13px;">Refreshes every 30 s</span>
      </div>
      <div id="alerts-off" class="banner warn" hidden>
        <Icon name="bell" />
        <div class="stack" style="gap: 10px;">
          <span>Notifications are off on this phone, so you won't hear about help calls.</span>
          <button class="btn small" type="button" data-enable-push>Enable alerts</button>
        </div>
      </div>
      <nav class="tabs" aria-label="Filter by status">
        <a href={href(null)} aria-current={status === null ? 'page' : undefined}>All {total}</a>
        <a href={href('help')} aria-current={status === 'help' ? 'page' : undefined}>Help {counts.help ?? 0}</a>
        <a href={href('overdue')} aria-current={status === 'overdue' ? 'page' : undefined}>Overdue {counts.overdue ?? 0}</a>
        <a href={href('active')} aria-current={status === 'active' ? 'page' : undefined}>Active {counts.active ?? 0}</a>
      </nav>
      <form method="get" action="/board" class="search" role="search">
        {status && <input type="hidden" name="status" value={status} />}
        <label class="sr" for="b-q">Search trips</label>
        <Icon name="search" size={18} />
        <input id="b-q" type="search" name="q" value={q} placeholder="Search name or place" />
      </form>
      {rows.length === 0 && <p class="lead">{q || status ? 'No trips match.' : 'Nobody out right now.'}</p>}
      {STATUSES.map((s) => {
        const group = rows.filter((r) => r.status === s)
        if (group.length === 0) return null
        return (
          <section class="stack" style="gap: 8px;">
            <h2 class="group-title">{s} · {group.length}</h2>
            {group.map((r) => <TripRow r={r} now={now} />)}
          </section>
        )
      })}
    </main>
  )
}

const TripRow: FC<{ r: BoardRow; now: number }> = ({ r, now }) => (
  <a class={`trip-row ${r.status}`} href={`/board/trips/${r.id}`}>
    <div class="l1">
      <span class={`pill ${r.status}`}>{r.status}</span>
      <strong>{r.user_name}</strong>
      <Icon name="chev" size={18} />
    </div>
    <div class="l2"><Icon name={ICON[r.activity] ?? 'other'} size={18} /><span>{tripLine(r)}</span></div>
    <div class="l3">
      <Icon name="flag" size={16} />
      <span>{r.destination_text ? `${r.destination_text} · ` : ''}back by <strong style="color: var(--ink); font-weight: 600;">{fmt(r.return_by)}</strong></span>
    </div>
    <div class="l4">
      <span class="meta"><Icon name="pin" size={15} />{r.last ? `Last position ${ago(r.last.at, now)}` : 'No position yet'}</span>
      <span class="meta"><Icon name={r.companion_count ? 'users' : 'user'} size={15} />{r.companion_count ? `+${r.companion_count}` : 'Alone'}</span>
      {r.last?.battery != null && <span class="meta"><Icon name="battery" size={15} />{r.last.battery}%</span>}
    </div>
  </a>
)

export function age(birthday: string | null, now: number): number | null {
  if (!birthday) return null
  const b = new Date(birthday + 'T00:00:00Z')
  if (isNaN(b.getTime())) return null
  const n = new Date(now)
  let a = n.getUTCFullYear() - b.getUTCFullYear()
  if (n.getUTCMonth() < b.getUTCMonth() || (n.getUTCMonth() === b.getUTCMonth() && n.getUTCDate() < b.getUTCDate())) a--
  return a
}

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('')

export const PersonCard: FC<{ user: User; now: number }> = ({ user, now }) => {
  const years = age(user.birthday, now)
  const facts: Array<[string, string]> = []
  if (years != null) facts.push(['Age', String(years)])
  if (user.gender) facts.push(['Gender', user.gender])
  if (user.language) facts.push(['Language', LANGUAGES[user.language as keyof typeof LANGUAGES] ?? user.language])
  if (user.height_cm) facts.push(['Height', `${user.height_cm} cm`])
  if (user.weight_kg) facts.push(['Weight', `${user.weight_kg} kg`])
  if (user.shoe_size) facts.push(['Shoe', `UK ${user.shoe_size}`])
  return (
    <section class="card">
      <h2>Person</h2>
      <div class="row" style="gap: 14px;">
        {user.photo_key
          ? <a href={`/photos/${user.photo_key}`}><img src={`/photos/${user.photo_key}`} alt="Profile picture" style="width: 64px; height: 64px; border-radius: 32px; object-fit: cover;" /></a>
          : <span class="avatar soft" style="width: 64px; height: 64px; border-radius: 32px;"><Icon name="user" size={28} /></span>}
        <div class="who2"><strong>{user.name}</strong><small class="muted">{user.email ?? ''}</small></div>
      </div>
      {facts.length > 0 && <dl class="facts">{facts.map(([k, v]) => <div><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
      {user.description && <p style="margin: 0;">{user.description}</p>}
    </section>
  )
}

export const EmergencyCard: FC<{ user: User }> = ({ user }) => (
  <section class="card">
    <h2>Emergency contact</h2>
    {user.emergency_name || user.emergency_phone ? (
      <ul class="list">
        <li>
          <span class="avatar soft">{initials(user.emergency_name ?? '?')}</span>
          <div class="who2">
            <strong>{user.emergency_name ?? 'Not named'}</strong>
            <small>{[user.emergency_relation, formatPhone(user.emergency_phone)].filter(Boolean).join(' · ')}</small>
          </div>
          {user.emergency_phone && <a class="outline-btn" href={`tel:${user.emergency_phone}`} aria-label={`Phone ${user.emergency_name ?? 'emergency contact'}`}><Icon name="phone" size={20} /></a>}
        </li>
      </ul>
    ) : <p class="muted" style="margin: 0;">None given.</p>}
  </section>
)

const PositionRow: FC<{ p: Position; now: number }> = ({ p, now }) => (
  <li>
    <div class="who2">
      <span class="pos">{p.lat.toFixed(5)}, {p.lng.toFixed(5)}</span>
      <small>{ago(p.at, now)}{p.accuracy != null ? ` · ±${Math.round(p.accuracy)} m` : ''}{p.battery != null ? ` · ${p.battery}%` : ''}</small>
    </div>
    <a href={mapsUrl(p.lat, p.lng)} class="row" style="min-height: 44px; font-size: 14px; font-weight: 600; gap: 4px;">Map<Icon name="ext" size={15} /></a>
  </li>
)

export const TripDetail: FC<{ trip: Trip; user: User; positions: Position[]; companions: Companion[]; now: number }> = ({ trip, user, positions, companions, now }) => {
  const last = positions[0]
  const checklist = JSON.parse(trip.checklist_json) as string[]
  const first = user.name.split(' ')[0]
  const place = tripPlace(trip)
  const photo = (key: string | null, label: string, icon: IconName, cls?: string) =>
    key ? (
      <a class={cls} href={`/photos/${key}`}><img src={`/photos/${key}`} alt={label} /></a>
    ) : (
      <div class={cls ? `ph ${cls}` : 'ph'}><Icon name={icon} size={26} />No {label.toLowerCase()}</div>
    )
  return (
    <main>
      <a href="/board" class="row" style="height: 44px; font-weight: 600; text-decoration: none; font-size: 14px; align-self: flex-start;"><Icon name="back" size={18} />Board</a>
      <div class="stack" style="gap: 8px;">
        <span><span class={`pill ${trip.status}`}>{trip.status}</span></span>
        <h1 class="display">{user.name}</h1>
        <p class="row" style="margin: 0;"><Icon name={ICON[trip.activity] ?? 'other'} size={18} />{tripLine(trip)} · back by {fmt(trip.return_by)}</p>
      </div>
      <div class="stack" style="gap: 8px;">
        <a class="btn red" href={`tel:${user.phone}`}><Icon name="phone" />Phone {first} {formatPhone(user.phone)}</a>
        {user.emergency_phone && (
          <a class="btn outline" href={`tel:${user.emergency_phone}`}>
            <Icon name="phone" />Phone {user.emergency_name ?? 'emergency contact'}{user.emergency_relation ? ` (${user.emergency_relation.toLowerCase()})` : ''} {formatPhone(user.emergency_phone)}
          </a>
        )}
      </div>
      <div class="banner warn">
        <span><strong>{last ? `Last position ${ago(last.at, now)}.` : 'No position received.'}</strong> Positions only arrive while their app is open on screen. Silence means the phone is locked, flat, or out of signal.</span>
      </div>

      <section class="card">
        <h2>Last position</h2>
        {positions.length === 0 ? <p class="muted" style="margin: 0;">None yet.</p> : (
          <>
            <ul class="list"><PositionRow p={positions[0]!} now={now} /></ul>
            {positions.length > 1 && (
              <details class="more">
                <summary>{positions.length - 1} earlier {positions.length === 2 ? 'position' : 'positions'}</summary>
                <ul class="list">{positions.slice(1).map((p) => <PositionRow p={p} now={now} />)}</ul>
              </details>
            )}
          </>
        )}
      </section>

      <section class="card">
        <h2>Plan</h2>
        <dl class="kv">
          <div><dt>Started</dt><dd>{fmt(trip.start_at)}{trip.start_lat != null && trip.start_lng != null && <> at <a href={mapsUrl(trip.start_lat, trip.start_lng)}>{place ?? 'start point'}</a></>}</dd></div>
          {trip.destination_text && <div><dt>Headed to</dt><dd>{trip.destination_text}</dd></div>}
          <div><dt>Route</dt><dd>{trip.route_text ?? '-'}</dd></div>
          <div><dt>Back by</dt><dd>{fmt(trip.return_by)}</dd></div>
          {trip.wearing_text && <div><dt>Wearing</dt><dd>{trip.wearing_text}</dd></div>}
          <div><dt>Battery at start</dt><dd>{trip.battery_at_start != null ? `${trip.battery_at_start}%` : 'unknown'}</dd></div>
          <div><dt>Checklist</dt><dd>{checklist.length ? checklist.join(', ') : 'nothing ticked'}</dd></div>
        </dl>
      </section>

      <section class="card">
        <h2>With them · {companions.length}</h2>
        {companions.length === 0 ? (
          <p class="muted" style="margin: 0;">{trip.companions_text ?? 'Alone'}</p>
        ) : (
          <ul class="list">
            {companions.map((p) => (
              <li>
                <span class="avatar soft">{initials(p.name)}</span>
                <div class="who2"><strong>{p.name}</strong><small>{p.phone ? formatPhone(p.phone) : 'No number given'}</small></div>
                {p.phone && <a class="outline-btn" href={`tel:${p.phone}`} aria-label={`Phone ${p.name}`}><Icon name="phone" size={20} /></a>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section class="card">
        <h2>Photos</h2>
        <div class="photos">
          {photo(trip.photo_key, 'Full-body photo', 'body', 'tall')}
          {trip.activity === 'paraglide' || trip.activity === 'mtb'
            ? photo(trip.gear_photo_key, trip.activity === 'paraglide' ? 'Wing photo' : 'Bike photo', ICON[trip.activity]!)
            : null}
          {photo(trip.shoe_photo_key, 'Shoe sole photo', 'shoe')}
        </div>
      </section>

      <PersonCard user={user} now={now} />
      <EmergencyCard user={user} />

      {trip.status !== 'closed' && (
        <section class="card">
          <h2>Close trip</h2>
          <p class="muted" style="margin: 0; font-size: 14px;">Only close once you know {first} is safe or the search is handed over.</p>
          <form method="post" action={`/api/board/trips/${trip.id}/close`} onsubmit="return confirm('Close this trip?')">
            <button class="btn" type="submit">Close trip</button>
          </form>
        </section>
      )}
    </main>
  )
}

