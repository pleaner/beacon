import type { FC } from 'hono/jsx'
import { ACTIVITIES, type Activity } from '../lib/constants'
import type { User } from '../lib/db'

const TABS = ['users', 'checklists', 'broadcast', 'settings'] as const

export const AdminPage: FC<{
  tab: string; users: User[]; me: User; activity: Activity; items: string[]; grace: string; sent: string | null; saved: boolean; error?: string
}> = ({ tab, users, me, activity, items, grace, sent, saved, error }) => (
  <>
    <h1>Admin</h1>
    <p class="tabs">{TABS.map((t) => (t === tab ? <strong>{t}</strong> : <a href={`/admin?tab=${t}`}>{t}</a>))}</p>
    {error && <div class="banner red">{error}</div>}
    {saved && <div class="banner ok">Saved.</div>}
    {sent !== null && <div class="banner ok">Sent to {sent} phones.</div>}

    {tab === 'users' && (
      <>
        <form method="post" action="/admin/users">
          <h2>Add operator</h2>
          <label>Name</label><input name="name" required />
          <label>Email</label><input name="email" type="email" required />
          <label>Phone</label><input name="phone" type="tel" required />
          <label>Organisation</label><input name="organisation" required value="SARZA" />
          <label>Role</label>
          <select name="role"><option value="operator">operator</option><option value="admin">admin</option></select>
          <button class="btn" type="submit">Add</button>
        </form>
        <h2>All users</h2>
        <table>
          {users.map((u) => (
            <tr>
              <td>
                <strong>{u.name}</strong><br /><span class="muted">{u.phone} {u.email ?? ''}</span>
              </td>
              <td>
                {u.id === me.id ? (
                  <span class="muted">{u.role} (you)</span>
                ) : (
                  <>
                    <form method="post" action={`/admin/users/${u.id}`}>
                      <select name="role">
                        {(['explorer', 'operator', 'admin'] as const).map((r) => <option value={r} selected={u.role === r}>{r}</option>)}
                      </select>
                      <input name="organisation" value={u.organisation ?? ''} placeholder="organisation" />
                      <button class="btn quiet" type="submit">Save</button>
                    </form>
                    <form method="post" action={`/admin/users/${u.id}/delete`} onsubmit="return confirm('Delete this user and their trips?')">
                      <button class="btn red" type="submit">Delete</button>
                    </form>
                  </>
                )}
              </td>
            </tr>
          ))}
        </table>
      </>
    )}

    {tab === 'checklists' && (
      <form method="post" action="/admin/checklists">
        <label>Activity</label>
        <select name="activity" onchange="location.href='/admin?tab=checklists&activity='+this.value">
          {Object.entries(ACTIVITIES).map(([k, label]) => <option value={k} selected={k === activity}>{label}</option>)}
        </select>
        <label>Items, one per line</label>
        <textarea name="items_text" rows={10}>{items.join('\n')}</textarea>
        <button class="btn" type="submit">Save</button>
      </form>
    )}

    {tab === 'broadcast' && (
      <form method="post" action="/admin/broadcast" onsubmit="return confirm('Send this to every explorer?')">
        <p class="muted">Goes to every explorer who has enabled alerts. Use it for weather and fire warnings.</p>
        <label>Title</label><input name="title" required maxlength={60} />
        <label>Message</label><textarea name="body" required maxlength={200}></textarea>
        <button class="btn red" type="submit">Send to everyone</button>
      </form>
    )}

    {tab === 'settings' && (
      <form method="post" action="/admin/settings">
        <label>Grace period in minutes</label>
        <p class="muted">How long after the "are you okay?" prompt before operators are pushed.</p>
        <input name="grace_minutes" type="number" min={1} max={1440} value={grace} />
        <button class="btn" type="submit">Save</button>
      </form>
    )}
  </>
)
