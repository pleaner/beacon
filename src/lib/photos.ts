import type { User } from './db'

const MAX_BYTES = 8 * 1024 * 1024

const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
}

export async function savePhoto(bucket: R2Bucket, userId: string, file: File | string | undefined): Promise<string | null> {
  if (!file || typeof file === 'string' || file.size === 0) return null
  if (file.size > MAX_BYTES) throw new Error('Photo too large')
  const ext = ALLOWED_TYPES[file.type]
  if (!ext) throw new Error('Photo must be a JPEG, PNG, WebP, or HEIC image')
  const key = `users/${userId}/${crypto.randomUUID()}.${ext}`
  await bucket.put(key, file.stream(), { httpMetadata: { contentType: file.type } })
  return key
}

export function canSeePhoto(user: User, key: string): boolean {
  if (user.role === 'operator' || user.role === 'admin') return true
  return key.startsWith(`users/${user.id}/`)
}

// A photo or voice note in a trip's chat. Kept under the trip, and served only through the trip's chat route.
// MediaRecorder gives audio/webm on Chrome and audio/mp4 on Safari, often with a ";codecs=" suffix.
const MAX_VOICE_BYTES = 2 * 1024 * 1024
export async function saveMessageMedia(bucket: R2Bucket, tripId: string, file: File | string | undefined): Promise<{ key: string; type: string } | null> {
  if (!file || typeof file === 'string' || file.size === 0) return null
  const type = file.type.split(';')[0]!.trim().toLowerCase()
  let ext: string | undefined = ALLOWED_TYPES[type]
  if (ext) {
    if (file.size > MAX_BYTES) throw new Error('Photo too large')
  } else {
    ext = /^audio\/([a-z0-9.+-]+)$/.exec(type)?.[1]
    if (!ext) throw new Error('Send a photo or a voice note')
    if (file.size > MAX_VOICE_BYTES) throw new Error('Voice note too long')
  }
  const key = `trips/${tripId}/${crypto.randomUUID()}.${ext}`
  await bucket.put(key, file.stream(), { httpMetadata: { contentType: type } })
  return { key, type }
}
