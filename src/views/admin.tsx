import type { FC } from 'hono/jsx'
import { ACTIVITIES, type Activity } from '../lib/constants'
import type { User } from '../lib/db'
import { formatPhone } from '../lib/phone'
import { Icon } from './icons'

export const ADMIN_TABS = { users: 'Users', checklists: 'Checklists', broadcast: 'Broadcast', settings: 'Settings' } as const
export type AdminTab = keyof typeof ADMIN_TABS

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('')

export const AdminPage: FC<{
  tab: AdminTab; users: User[]; me: User; activity: Activity; items: string[]; grace: string; sent: string | null; saved: boolean; error?: string; q?: string
}> = ({ tab, users, me, activity, items, grace, sent, saved, error, q = '' }) => {
  const needle = q.toLowerCase()
  const shown = needle ? users.filter((u) => [u.name, u.email, u.phone].some((v) => v?.toLowerCase().includes(needle))) : users
  return (
    <main>
      <div class="stack" style="gap: 4px;">
        <span class="muted" style="font-size: 13px;">Admin</span>
        <h1 class="display">{ADMIN_TABS[tab]}</h1>
      </div>
      {error && <div class="banner error" role="alert">{error}</div>}
      {saved && <div class="banner ok" role="status">Saved.</div>}
      {sent !== null && <div class="banner ok" role="status">Sent to {sent} phones.</div>}

      {tab === 'users' && (
        <>
          <form method="get" action="/admin" class="search" role="search">
            <input type="hidden" name="tab" value="users" />
            <label class="sr" for="u-q">Search users</label>
            <Icon name="search" size={18} />
            <input id="u-q" type="search" name="q" value={q} placeholder="Search name, email or phone" />
          </form>
          <section class="card">
            <div class="card-head">
              <h2>All users · {shown.length}</h2>
              <a class="btn-sm" href="#add"><Icon name="plus" size={16} stroke={2.4} />Add</a>
            </div>
            <ul class="list">
              {shown.map((u) => (
                <li style="flex-direction: column; align-items: stretch; gap: 8px;">
                  <div class="row" style="gap: 12px;">
                    <span class="avatar soft" style="width: 36px; height: 36px;">{initials(u.name)}</span>
                    <div class="who2">
                      <strong>{u.name}{u.id === me.id ? ' (you)' : ''}</strong>
                      <small>{[formatPhone(u.phone), u.email, u.organisation].filter(Boolean).join(' · ')}</small>
                    </div>
                    <span class="badge">{u.role}</span>
                  </div>
                  {u.id !== me.id && (
                    <details>
                      <summary class="muted" style="font-size: 13px; cursor: pointer; padding-left: 48px; min-height: 32px;">Edit</summary>
                      <div class="user-edit">
                        <form method="post" action={`/admin/users/${u.id}`} class="row" style="flex-wrap: wrap; gap: 8px; width: 100%;">
                          <label class="sr" for={`r-${u.id}`}>Role</label>
                          <select id={`r-${u.id}`} name="role">
                            {(['explorer', 'operator', 'admin'] as const).map((r) => <option value={r} selected={u.role === r}>{r}</option>)}
                          </select>
                          <label class="sr" for={`o-${u.id}`}>Organisation</label>
                          <input id={`o-${u.id}`} name="organisation" value={u.organisation ?? ''} placeholder="Organisation" />
                          <button class="btn-sm outline" type="submit">Save</button>
                        </form>
                        <form method="post" action={`/admin/users/${u.id}/delete`} onsubmit="return confirm('Delete this user and their trips?')">
                          <button class="btn-sm danger" type="submit">Delete</button>
                        </form>
                      </div>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          </section>
          <section class="card" id="add">
            <h2>Add operator</h2>
            <form method="post" action="/admin/users" class="stack" style="gap: 14px;">
              <div class="field"><label for="a-name">Name</label><input id="a-name" name="name" required /></div>
              <div class="field"><label for="a-email">Email</label><input id="a-email" name="email" type="email" required /></div>
              <div class="field"><label for="a-phone">Phone</label><input id="a-phone" name="phone" type="tel" required /></div>
              <div class="field"><label for="a-org">Organisation</label><input id="a-org" name="organisation" required value="SARZA" /></div>
              <div class="field">
                <label for="a-role">Role</label>
                <select id="a-role" name="role"><option value="operator">operator</option><option value="admin">admin</option></select>
              </div>
              <button class="btn" type="submit">Add operator</button>
            </form>
          </section>
        </>
      )}

      {tab === 'checklists' && (
        <section class="card">
          <form method="post" action="/admin/checklists" class="stack" style="gap: 14px;">
            <div class="field">
              <label for="c-act">Activity</label>
              <select id="c-act" name="activity" onchange="location.href='/admin?tab=checklists&activity='+this.value">
                {Object.entries(ACTIVITIES).map(([k, label]) => <option value={k} selected={k === activity}>{label}</option>)}
              </select>
            </div>
            <div class="field">
              <label for="c-items">Items, one per line</label>
              <textarea id="c-items" name="items_text" rows={10}>{items.join('\n')}</textarea>
            </div>
            <button class="btn" type="submit">Save</button>
          </form>
        </section>
      )}

      {tab === 'broadcast' && (
        <section class="card">
          <p class="muted" style="margin: 0;">Goes to every explorer who has enabled alerts. Use it for weather and fire warnings.</p>
          <form method="post" action="/admin/broadcast" onsubmit="return confirm('Send this to every explorer?')" class="stack" style="gap: 14px;">
            <div class="field"><label for="b-title">Title</label><input id="b-title" name="title" required maxlength={60} /></div>
            <div class="field"><label for="b-body">Message</label><textarea id="b-body" name="body" required maxlength={200}></textarea></div>
            <button class="btn red" type="submit">Send to everyone</button>
          </form>
        </section>
      )}

      {tab === 'settings' && (
        <section class="card">
          <form method="post" action="/admin/settings" class="stack" style="gap: 14px;">
            <div class="field">
              <label for="s-grace">Grace period in minutes</label>
              <p class="muted" style="margin: 0; font-size: 14px;">How long after the "are you okay?" prompt before operators are pushed.</p>
              <input id="s-grace" name="grace_minutes" type="number" min={1} max={1440} value={grace} />
            </div>
            <button class="btn" type="submit">Save</button>
          </form>
        </section>
      )}
    </main>
  )
}
