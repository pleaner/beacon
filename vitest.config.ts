import path from 'node:path'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'))
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            SESSION_SECRET: 'test-secret',
            VAPID_PUBLIC_KEY: 'BBBB',
            VAPID_PRIVATE_KEY: 'cccc',
            // No place lookups in tests; tests that need one install a fake with setPlaceLookupForTests.
            GEOCODE_URL: '',
            // RESEND_API_KEY is left unset on purpose: without it the email helper logs instead of calling Resend.
          },
        },
      }),
    ],
    test: { setupFiles: ['./test/apply-migrations.ts'] },
  }
})
