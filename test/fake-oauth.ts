import { setOAuthHttpForTests, type Provider } from '../src/lib/oauth'

const ISS = { google: 'https://accounts.google.com', apple: 'https://appleid.apple.com' }
const b64url = (b: ArrayBuffer | string) =>
  btoa(typeof b === 'string' ? b : String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

// Stands in for Google's and Apple's key and token endpoints. Tests sign ID tokens with a key made here, and the
// token endpoint hands back whichever ID token the test queued with `next`.
export async function fakeProviders() {
  const keys = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'],
  )) as CryptoKeyPair
  const jwk = (await crypto.subtle.exportKey('jwk', keys.publicKey)) as JsonWebKey
  const tokenRequests: URLSearchParams[] = []
  let queued: string | null = null

  async function idToken(p: Provider, claims: Record<string, unknown>, signer: CryptoKey = keys.privateKey) {
    const head = b64url(JSON.stringify({ alg: 'RS256', kid: 'test-key' }))
    const body = b64url(JSON.stringify({
      iss: ISS[p], aud: p === 'google' ? 'google-web-client' : 'za.org.sarza.guardian.web', exp: Math.floor(Date.now() / 1000) + 600,
      email_verified: true, ...claims,
    }))
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signer, new TextEncoder().encode(`${head}.${body}`))
    return `${head}.${body}.${b64url(sig)}`
  }

  setOAuthHttpForTests(async (input, init) => {
    const url = String(input)
    if (url.endsWith('/oauth2/v3/certs') || url.endsWith('/auth/keys')) {
      return Response.json({ keys: [{ ...jwk, kid: 'test-key', alg: 'RS256', use: 'sig' }] })
    }
    if (url.endsWith('/token')) {
      tokenRequests.push(new URLSearchParams(String(init?.body ?? '')))
      return queued ? Response.json({ id_token: queued }) : new Response('{"error":"invalid_grant"}', { status: 400 })
    }
    return new Response('not faked', { status: 500 })
  })

  return {
    idToken,
    tokenRequests,
    next: (token: string | null) => { queued = token },
    // A second key the providers never published, for forged tokens.
    otherKey: async () => ((await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'],
    )) as CryptoKeyPair).privateKey,
    restore: () => setOAuthHttpForTests(null),
  }
}
