import { applyD1Migrations, reset } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { afterEach } from 'vitest'

// The plugin does not isolate storage per test. Wipe every binding and re-apply
// migrations (which also restores seed rows) after each test.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
afterEach(async () => {
  await reset()
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})
