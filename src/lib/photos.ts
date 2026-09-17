import type { User } from './db'

const MAX_BYTES = 8 * 1024 * 1024

export async function savePhoto(bucket: R2Bucket, userId: string, file: File | string | undefined): Promise<string | null> {
  if (!file || typeof file === 'string' || file.size === 0) return null
  if (file.size > MAX_BYTES) throw new Error('Photo too large')
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const key = `users/${userId}/${crypto.randomUUID()}.${ext}`
  await bucket.put(key, file.stream(), { httpMetadata: { contentType: file.type || 'image/jpeg' } })
  return key
}

export function canSeePhoto(user: User, key: string): boolean {
  if (user.role === 'operator' || user.role === 'admin') return true
  return key.startsWith(`users/${user.id}/`)
}
