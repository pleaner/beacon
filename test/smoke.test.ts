import { env, exports } from 'cloudflare:workers'
import { expect, it } from 'vitest'

it('serves health', async () => {
  const res = await exports.default.fetch('https://beacon.test/health')
  expect(res.status).toBe(200)
  expect(await res.text()).toBe('ok')
})

it('has migrated tables and seed data', async () => {
  const grace = await env.DB.prepare("SELECT value FROM settings WHERE key='grace_minutes'").first<{ value: string }>()
  expect(grace?.value).toBe('30')
  const lists = await env.DB.prepare('SELECT COUNT(*) AS n FROM checklists').first<{ n: number }>()
  expect(lists?.n).toBe(6)
})
