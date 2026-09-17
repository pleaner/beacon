import { Hono } from 'hono'
import type { AppEnv } from './env'
import { runCron } from './lib/cron'
import { webPushSender } from './lib/push'

const app = new Hono<AppEnv>()

app.get('/health', (c) => c.text('ok'))

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
    const r = await runCron(env, webPushSender(env), Date.now())
    console.log('cron', JSON.stringify(r))
  },
}
