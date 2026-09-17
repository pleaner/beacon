import { describe, expect, it } from 'vitest'
import { hashToken, newToken, signMagicLink, verifyMagicLink } from '../src/lib/auth'

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

describe('magic links', () => {
  const secret = 's3cret'

  it('round-trips a user id', async () => {
    const token = await signMagicLink(secret, 'user-1', 2000)
    expect(await verifyMagicLink(secret, token, 1000)).toBe('user-1')
  })

  it('rejects after expiry', async () => {
    const token = await signMagicLink(secret, 'user-1', 2000)
    expect(await verifyMagicLink(secret, token, 2001)).toBeNull()
  })

  it('rejects a tampered payload', async () => {
    const token = await signMagicLink(secret, 'user-1', 2000)
    const [payload, sig] = token.split('.')
    const forged = btoa('user-2:2000').replace(/=+$/, '') + '.' + sig
    expect(await verifyMagicLink(secret, forged, 1000)).toBeNull()
    expect(payload).not.toBe('')
  })

  it('rejects the wrong secret', async () => {
    const token = await signMagicLink(secret, 'user-1', 2000)
    expect(await verifyMagicLink('other', token, 1000)).toBeNull()
  })

  it('rejects garbage', async () => {
    expect(await verifyMagicLink(secret, 'nope', 1000)).toBeNull()
    expect(await verifyMagicLink(secret, '', 1000)).toBeNull()
  })
})
