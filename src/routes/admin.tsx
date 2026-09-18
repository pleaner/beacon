import { Hono, type Context } from 'hono'
import type { AppEnv } from '../env'
import { ACTIVITIES, type Activity } from '../lib/constants'
import { createUser, deleteUser, getChecklist, getSetting, getUserByEmail, listUsers, setChecklist, setSetting, updateUser, type Role } from '../lib/db'
import { readBody, requireRole, str } from '../lib/middleware'
import { getSender, pushToRoles } from '../lib/push'
import { ADMIN_TABS, AdminPage, type AdminTab } from '../views/admin'
import { listOpenTrips } from '../lib/trips'
import { Layout } from '../views/layout'

export const admin = new Hono<AppEnv>()
admin.use('/admin', requireRole('admin'))
admin.use('/admin/*', requireRole('admin'))

async function render(c: Context<AppEnv>, over: { tab?: string; error?: string; status?: 200 | 400 } = {}) {
  const me = c.var.user!
  const rawTab = over.tab ?? c.req.query('tab') ?? 'users'
  const tab: AdminTab = rawTab in ADMIN_TABS ? (rawTab as AdminTab) : 'users'
  const activityQ = c.req.query('activity') ?? 'hike'
  const activity = (activityQ in ACTIVITIES ? activityQ : 'hike') as Activity
  const [users, items, grace, open] = await Promise.all([
    listUsers(c.env.DB), getChecklist(c.env.DB, activity), getSetting(c.env.DB, 'grace_minutes', '30'), listOpenTrips(c.env.DB),
  ])
  return c.html(
    <Layout title={ADMIN_TABS[tab]} user={me} current={tab} helpCount={open.filter((t) => t.status === 'help').length}>
      <AdminPage tab={tab} users={users} me={me} activity={activity} items={items} grace={grace} q={c.req.query('q') ?? ''}
        sent={c.req.query('sent') ?? null} saved={c.req.query('saved') === '1'} error={over.error} />
    </Layout>,
    over.status ?? 200,
  )
}

admin.get('/admin', (c) => render(c))

admin.post('/admin/users', async (c) => {
  const b = await readBody(c)
  const name = str(b, 'name'), email = str(b, 'email')?.toLowerCase(), phone = str(b, 'phone'), organisation = str(b, 'organisation')
  const role = str(b, 'role')
  if (!name || !email || !phone || !organisation || (role !== 'operator' && role !== 'admin')) {
    return render(c, { tab: 'users', error: 'Name, email, phone, organisation, and role are all required', status: 400 })
  }
  const existing = await getUserByEmail(c.env.DB, email)
  if (existing && (existing.role === 'operator' || existing.role === 'admin')) {
    return render(c, { tab: 'users', error: 'An operator with that email already exists', status: 400 })
  }
  await createUser(c.env.DB, {
    role, name, email, phone, organisation, emergency_name: null, emergency_phone: null, description: null, photo_key: null, consent_contact: 0,
  })
  return c.redirect('/admin?tab=users&saved=1', 303)
})

admin.post('/admin/users/:id', async (c) => {
  const b = await readBody(c)
  const role = str(b, 'role') as Role | null
  const organisation = str(b, 'organisation')
  if (!role || !['explorer', 'operator', 'admin'].includes(role)) return render(c, { tab: 'users', error: 'Bad role', status: 400 })
  if (c.req.param('id') === c.var.user!.id) return render(c, { tab: 'users', error: "You can't change your own role", status: 400 })
  if ((role === 'operator' || role === 'admin') && !organisation) {
    return render(c, { tab: 'users', error: 'Organisation is required for operators and admins', status: 400 })
  }
  await updateUser(c.env.DB, c.req.param('id'), { role, organisation })
  return c.redirect('/admin?tab=users&saved=1', 303)
})

admin.post('/admin/users/:id/delete', async (c) => {
  if (c.req.param('id') === c.var.user!.id) return render(c, { tab: 'users', error: "You can't delete yourself", status: 400 })
  await deleteUser(c.env.DB, c.req.param('id'))
  return c.redirect('/admin?tab=users', 303)
})

admin.post('/admin/checklists', async (c) => {
  const b = await readBody(c)
  const activity = str(b, 'activity')
  if (!activity || !(activity in ACTIVITIES)) return render(c, { tab: 'checklists', error: 'Bad activity', status: 400 })
  await setChecklist(c.env.DB, activity, (str(b, 'items_text') ?? '').split('\n'))
  return c.redirect(`/admin?tab=checklists&activity=${activity}&saved=1`, 303)
})

admin.post('/admin/broadcast', async (c) => {
  const b = await readBody(c)
  const title = str(b, 'title'), body = str(b, 'body')
  if (!title || !body) return render(c, { tab: 'broadcast', error: 'Title and message are required', status: 400 })
  const r = await pushToRoles(c.env.DB, getSender(c.env), ['explorer'], { title, body, url: '/', tag: 'broadcast' })
  return c.redirect(`/admin?tab=broadcast&sent=${r.sent}`, 303)
})

admin.post('/admin/settings', async (c) => {
  const b = await readBody(c)
  const n = Number(str(b, 'grace_minutes'))
  if (!Number.isInteger(n) || n < 1 || n > 1440) return render(c, { tab: 'settings', error: 'Grace period must be 1 to 1440 minutes', status: 400 })
  await setSetting(c.env.DB, 'grace_minutes', String(n))
  return c.redirect('/admin?tab=settings&saved=1', 303)
})
