import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { requireRole } from '../lib/middleware'
import { canSeePhoto } from '../lib/photos'
import { Layout } from '../views/layout'
import { ProfileForm } from '../views/explorer'

export const explorer = new Hono<AppEnv>()

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
    headers: { 'content-type': obj.httpMetadata?.contentType ?? 'image/jpeg', 'cache-control': 'private, max-age=86400' },
  })
})
