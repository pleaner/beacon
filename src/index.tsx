import { Hono } from 'hono'
import type { AppEnv } from './env'
import { runCron } from './lib/cron'
import { loadUser } from './lib/middleware'
import { webPushSender } from './lib/push'
import { Layout } from './views/layout'

const app = new Hono<AppEnv>()
app.use(loadUser)

app.get('/health', (c) => c.text('ok'))
app.get('/', (c) => c.html(<Layout title="Home" user={c.var.user}><p>Coming in Task 9.</p></Layout>))

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
    const r = await runCron(env, webPushSender(env), Date.now())
    console.log('cron', JSON.stringify(r))
  },
}
