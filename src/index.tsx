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
app.use(loadUser)

app.get('/health', (c) => c.text('ok'))
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
