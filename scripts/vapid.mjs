// Prints a VAPID key pair in the format @block65/webcrypto-web-push expects:
// public key = base64url of the raw 65-byte P-256 point, private key = the JWK "d" value.
const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))
const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey)
console.log('VAPID_PUBLIC_KEY=' + Buffer.from(pub).toString('base64url'))
console.log('VAPID_PRIVATE_KEY=' + jwk.d)
