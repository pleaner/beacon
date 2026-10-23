import type { FC } from 'hono/jsx'
import { canAccept, canReject, formatTime, type CallView } from '../lib/calls'
import type { OnCallState } from '../lib/oncall'
import { Icon } from './icons'

const day = (ms: number) => new Date(ms).toLocaleDateString('en-ZA', { weekday: 'short', timeZone: 'Africa/Johannesburg' })
const at = (ms: number) => `${day(ms)} ${formatTime(ms)}`

export const OnCallPage: FC<{ s: OnCallState; admin: boolean; error?: string }> = ({ s, admin, error }) => (
  <main>
    <h1 class="display">On call</h1>
    {error && <div class="banner error" role="alert">{error}</div>}
    <section class="card">
      <h2>On call now</h2>
      {s.on_now ? (
        <p style="margin: 0;"><strong>{s.on_now.name}</strong>{s.until ? ` until ${at(s.until)}` : ', with nobody else available to take over'}</p>
      ) : (
        <p style="margin: 0;">Nobody is on call. Alerts go to every operator and admin.</p>
      )}
      {s.next && s.until && <p class="muted" style="margin: 0;">Next: {s.next.name} from {at(s.until)}</p>}
      <p class="muted" style="margin: 0; font-size: 14px;">
        Shifts of {s.shift_hours} {s.shift_hours === 1 ? 'hour' : 'hours'} from 06:00. An alert passes to the next person after {s.no_response_minutes} min with no answer.
      </p>
    </section>

    {s.me.on_roster && (
      <section class="card">
        <h2>You</h2>
        <p style="margin: 0;">{s.me.available ? "You're available. Alerts can come to you." : "You're unavailable. You're skipped until you switch back."}</p>
        <form method="post" action="/api/oncall/availability">
          <input type="hidden" name="available" value={s.me.available ? '0' : '1'} />
          <button class={s.me.available ? 'btn outline' : 'btn'} type="submit">{s.me.available ? 'Make me unavailable' : 'Make me available'}</button>
        </form>
      </section>
    )}

    <section class="card">
      <h2>Order · {s.roster.length}</h2>
      {s.roster.length === 0 && <p class="muted" style="margin: 0;">Nobody is on the list yet.</p>}
      <ul class="list">
        {s.roster.map((r, i) => (
          <li>
            <div class="who2 grow">
              <strong>{r.name}</strong>
              <small>
                {r.on_now ? 'On call now' : r.available ? 'Available' : 'Unavailable'}
                {r.devices === 0 && ' · No device gets alerts'}
              </small>
            </div>
            {admin && (
              <div class="row" style="gap: 6px;">
                {(['up', 'down'] as const).map((dir) => (
                  <form method="post" action="/api/oncall/move">
                    <input type="hidden" name="user_id" value={r.user_id} />
                    <input type="hidden" name="dir" value={dir} />
                    <button class="btn small outline" type="submit" disabled={dir === 'up' ? i === 0 : i === s.roster.length - 1} aria-label={`Move ${r.name} ${dir}`}>
                      {dir === 'up' ? '↑' : '↓'}
                    </button>
                  </form>
                ))}
                <form method="post" action="/api/oncall/availability">
                  <input type="hidden" name="user_id" value={r.user_id} />
                  <input type="hidden" name="available" value={r.available ? '0' : '1'} />
                  <button class="btn small outline" type="submit">{r.available ? 'Set unavailable' : 'Set available'}</button>
                </form>
                <form method="post" action="/api/oncall/remove" onsubmit="return confirm('Take them off the on-call list?')">
                  <input type="hidden" name="user_id" value={r.user_id} />
                  <button class="btn small outline" type="submit" aria-label={`Remove ${r.name}`}><Icon name="x" size={16} /></button>
                </form>
              </div>
            )}
          </li>
        ))}
      </ul>
      {admin && s.candidates.length > 0 && (
        <form method="post" action="/api/oncall/add" class="row" style="gap: 8px;">
          <select name="user_id" aria-label="Operator to add" class="grow">
            {s.candidates.map((u) => <option value={u.user_id}>{u.name}</option>)}
          </select>
          <button class="btn small" type="submit">Add</button>
        </form>
      )}
    </section>
  </main>
)

// One call on the trip page: where it stands, the viewer's buttons, and the record.
export const CallCard: FC<{ c: CallView; viewerId: string }> = ({ c, viewerId }) => (
  <section class="card">
    <h2>{c.kind === 'help' ? 'Help call' : 'Overdue call'}</h2>
    <p style="margin: 0;">
      {c.accepted_at
        ? `Accepted by ${c.accepted_name ?? 'someone'}, ${formatTime(c.accepted_at)}`
        : c.closed_at
          ? `Closed ${formatTime(c.closed_at)}. Nobody accepted.`
          : 'Open. Nobody has accepted yet.'}
    </p>
    {(canAccept(c, viewerId) || canReject(c, viewerId)) && (
      <div class="row" style="gap: 8px;">
        {canAccept(c, viewerId) && (
          <form method="post" action={`/api/board/calls/${c.id}/accept`} class="grow">
            <button class="btn" type="submit">Accept</button>
          </form>
        )}
        {canReject(c, viewerId) && (
          <form method="post" action={`/api/board/calls/${c.id}/reject`} class="grow" onsubmit="return confirm('Pass this call to the next person?')">
            <button class="btn outline" type="submit">Reject</button>
          </form>
        )}
      </div>
    )}
    <ol class="record">
      {c.lines.map((l) => <li><time>{formatTime(l.at)}</time><span>{l.text}</span></li>)}
    </ol>
  </section>
)
