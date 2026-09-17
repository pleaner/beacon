export const COOKIE_NAME = 'beacon'
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 365

const enc = new TextEncoder()

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(s: string): Uint8Array | null {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
    return Uint8Array.from(bin, (ch) => ch.charCodeAt(0))
  } catch {
    return null
  }
}

export function newToken(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)))
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(token))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function signMagicLink(secret: string, userId: string, expiresAt: number): Promise<string> {
  const payload = b64url(enc.encode(`${userId}:${expiresAt}`))
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(payload))
  return `${payload}.${b64url(new Uint8Array(sig))}`
}

export async function verifyMagicLink(secret: string, token: string, now: number): Promise<string | null> {
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return null
  const sigBytes = fromB64url(sig)
  const payloadBytes = fromB64url(payload)
  if (!sigBytes || !payloadBytes) return null
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), sigBytes, enc.encode(payload))
  if (!ok) return null
  const text = new TextDecoder().decode(payloadBytes)
  const idx = text.lastIndexOf(':')
  if (idx < 1) return null
  const userId = text.slice(0, idx)
  const expiresAt = Number(text.slice(idx + 1))
  if (!Number.isFinite(expiresAt) || now > expiresAt) return null
  return userId
}
