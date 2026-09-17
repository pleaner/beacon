import { Hono } from 'hono'
import type { AppEnv } from './env'

const app = new Hono<AppEnv>()

app.get('/health', (c) => c.text('ok'))

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, _env: Env, _ctx: ExecutionContext) {
    // filled in at Task 5
  },
}
