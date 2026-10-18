export const COOKIE_NAME = 'beacon'
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 365

const enc = new TextEncoder()

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function newToken(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)))
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(token))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
