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
            GOOGLE_CLIENT_ID: 'google-web-client',
            GOOGLE_CLIENT_SECRET: 'google-secret',
            VAPID_PUBLIC_KEY: 'BBBB',
            VAPID_PRIVATE_KEY: 'cccc',
            // No place lookups in tests; tests that need one install a fake with setPlaceLookupForTests.
            GEOCODE_URL: '',
            MAP_TILES_URL: '',
          },
        },
      }),
    ],
    test: { setupFiles: ['./test/apply-migrations.ts'], exclude: ['**/node_modules/**', '.claude/**'] },
  }
})
