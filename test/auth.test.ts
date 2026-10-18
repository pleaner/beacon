import { describe, expect, it } from 'vitest'
import { hashToken, newToken } from '../src/lib/auth'

describe('tokens', () => {
  it('makes unique url-safe tokens', () => {
    const a = newToken()
    const b = newToken()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('hashes deterministically', async () => {
    expect(await hashToken('abc')).toBe(await hashToken('abc'))
    expect(await hashToken('abc')).toHaveLength(64)
    expect(await hashToken('abc')).not.toBe(await hashToken('abd'))
  })
})
