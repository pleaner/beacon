import { Hono } from 'hono'
import type { AppEnv } from './env'
import { runCron } from './lib/cron'
import { loadUser } from './lib/middleware'
import { webPushSender } from './lib/push'
import { api } from './routes/api'
import { auth } from './routes/auth'
import { explorer } from './routes/explorer'

const app = new Hono<AppEnv>()
app.use(loadUser)

app.get('/health', (c) => c.text('ok'))
app.route('/api', api)
app.route('/', auth)
app.route('/', explorer)

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
    const r = await runCron(env, webPushSender(env), Date.now())
    console.log('cron', JSON.stringify(r))
  },
}
