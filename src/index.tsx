import { Hono } from 'hono'
import type { AppEnv } from './env'
import { runCron } from './lib/cron'
import { loadUser } from './lib/middleware'
import { webPushSender } from './lib/push'
import { admin } from './routes/admin'
import { api } from './routes/api'
import { auth } from './routes/auth'
import { board } from './routes/board'
import { explorer } from './routes/explorer'

const app = new Hono<AppEnv>()
// The app was SARZA Beacon at beacon.pleaner.com. Send old links to the new domain.
// ponytail: static files in public/ are served before the worker, so only app routes redirect.
app.use(async (c, next) => {
  const url = new URL(c.req.url)
  if (url.hostname !== 'beacon.pleaner.com') return next()
  return c.redirect(c.env.APP_URL + url.pathname + url.search, 301)
})
app.use(loadUser)

app.get('/health', (c) => c.text('ok'))
// Lets the Android app open the emailed sign-in link. ANDROID_CERT_SHA256: the signing key fingerprints, comma-separated.
app.get('/.well-known/assetlinks.json', (c) => {
  const fingerprints = (c.env.ANDROID_CERT_SHA256 ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (fingerprints.length === 0) return c.notFound()
  return c.json([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: 'za.org.sarza.guardian', sha256_cert_fingerprints: fingerprints },
  }])
})
app.route('/api', api)
app.route('/', auth)
app.route('/', board)
app.route('/', explorer)
app.route('/', admin)

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
    const r = await runCron(env, webPushSender(env), Date.now())
    console.log('cron', JSON.stringify(r))
  },
}
