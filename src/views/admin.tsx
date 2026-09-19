import type { FC } from 'hono/jsx'
import { ACTIVITIES, type Activity } from '../lib/constants'
import type { User } from '../lib/db'
import { formatPhone } from '../lib/phone'
import { EmergencyCard, PersonCard } from './board'
import { Icon } from './icons'

export const ADMIN_TABS = { users: 'Users', checklists: 'Checklists', broadcast: 'Broadcast', settings: 'Settings' } as const
export type AdminTab = keyof typeof ADMIN_TABS

const Banners: FC<{ error?: string; saved?: boolean; sent?: string | null }> = ({ error, saved, sent }) => (
  <>
    {error && <div class="banner error" role="alert">{error}</div>}
    {saved && <div class="banner ok" role="status">Saved.</div>}
    {sent != null && <div class="banner ok" role="status">Sent to {sent} phones.</div>}
  </>
)

export const AdminPage: FC<{
  tab: AdminTab; users: User[]; me: User; activity: Activity; items: string[]; grace: string; sent: string | null; saved: boolean; error?: string; q?: string
}> = ({ tab, users, me, activity, items, grace, sent, saved, error, q = '' }) => {
  const needle = q.trim().toLowerCase()
  const shown = needle ? users.filter((u) => [u.name, u.email, u.phone].some((v) => v?.toLowerCase().includes(needle))) : users
  return (
    <main>
      <div class="stack" style="gap: 4px;">
        <span class="muted" style="font-size: 13px;">Admin</span>
        <h1 class="display">{ADMIN_TABS[tab]}</h1>
      </div>
      <Banners error={error} saved={saved} sent={sent} />

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
            <div class="table-wrap">
              <table class="utable">
                <thead>
                  <tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th></tr>
                </thead>
                <tbody>
                  {shown.map((u) => (
                    <tr>
                      <td><a href={`/admin/users/${u.id}`}>{u.name}{u.id === me.id ? ' (you)' : ''}</a></td>
                      <td>{u.email ?? '-'}</td>
                      <td>{formatPhone(u.phone) || '-'}</td>
                      <td>{u.role}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {shown.length === 0 && <p class="muted" style="margin: 0;">No users match.</p>}
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

export const AdminUserPage: FC<{ user: User; me: User; now: number; saved: boolean; error?: string }> = ({ user, me, now, saved, error }) => (
  <main>
    <a href="/admin?tab=users" class="row" style="height: 44px; font-weight: 600; text-decoration: none; font-size: 14px; align-self: flex-start;"><Icon name="back" size={18} />Users</a>
    <div class="stack" style="gap: 8px;">
      <span><span class="badge">{user.role}</span></span>
      <h1 class="display">{user.name}{user.id === me.id ? ' (you)' : ''}</h1>
      <p class="muted" style="margin: 0;">{[formatPhone(user.phone), user.email, user.organisation].filter(Boolean).join(' · ')}</p>
    </div>
    <Banners error={error} saved={saved} />
    <a class="btn outline" href={`tel:${user.phone}`}><Icon name="phone" />Phone {formatPhone(user.phone)}</a>

    <PersonCard user={user} now={now} />
    <EmergencyCard user={user} />

    <section class="card">
      <h2>Role</h2>
      {user.id === me.id ? (
        <p class="muted" style="margin: 0;">You can't change your own role or delete yourself.</p>
      ) : (
        <div class="user-edit" style="padding-left: 0;">
          <form method="post" action={`/admin/users/${user.id}`} class="row" style="flex-wrap: wrap; gap: 8px; width: 100%;">
            <label class="sr" for="r-role">Role</label>
            <select id="r-role" name="role">
              {(['explorer', 'operator', 'admin'] as const).map((r) => <option value={r} selected={user.role === r}>{r}</option>)}
            </select>
            <label class="sr" for="r-org">Organisation</label>
            <input id="r-org" name="organisation" value={user.organisation ?? ''} placeholder="Organisation" />
            <button class="btn-sm outline" type="submit">Save</button>
          </form>
          <form method="post" action={`/admin/users/${user.id}/delete`} onsubmit="return confirm('Delete this user and their trips?')">
            <button class="btn-sm danger" type="submit">Delete</button>
          </form>
        </div>
      )}
    </section>
  </main>
)
