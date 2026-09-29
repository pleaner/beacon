// A static map for the end-of-trip card: fit the track into a box in Web Mercator, then fetch the tiles
// behind it and inline them as data URIs, so the card stays one self-contained SVG the browser can turn into a PNG.

// ponytail: tiles drawn at 2x (512 px) so map labels stay readable when the card is shown phone-sized.
const TILE = 512

export interface MapFit {
  z: number
  project: (p: { lat: number; lng: number }) => [number, number]
  tiles: Array<{ z: number; x: number; y: number; left: number; top: number }>
}

const worldX = (lng: number, z: number) => ((lng + 180) / 360) * TILE * 2 ** z
const worldY = (lat: number, z: number) => {
  const s = Math.sin((lat * Math.PI) / 180)
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * 2 ** z
}

// The box is (x, y, w, h) on the card. Picks the closest zoom that still fits the track with `pad` to spare.
export function fitMap(points: Array<{ lat: number; lng: number }>, x: number, y: number, w: number, h: number, pad = 70): MapFit {
  const lats = points.map((p) => p.lat)
  const lngs = points.map((p) => p.lng)
  const [s, n, west, east] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)]
  let z = 16
  while (z > 2 && (worldX(east, z) - worldX(west, z) > w - 2 * pad || worldY(s, z) - worldY(n, z) > h - 2 * pad)) z--
  const ox = (worldX(west, z) + worldX(east, z)) / 2 - w / 2
  const oy = (worldY(n, z) + worldY(s, z)) / 2 - h / 2
  const tiles: MapFit['tiles'] = []
  const count = 2 ** z
  for (let ty = Math.floor(oy / TILE); ty <= Math.floor((oy + h - 1) / TILE); ty++) {
    if (ty < 0 || ty >= count) continue
    for (let tx = Math.floor(ox / TILE); tx <= Math.floor((ox + w - 1) / TILE); tx++) {
      tiles.push({ z, x: ((tx % count) + count) % count, y: ty, left: x + tx * TILE - ox, top: y + ty * TILE - oy })
    }
  }
  return { z, tiles, project: (p) => [x + worldX(p.lng, z) - ox, y + worldY(p.lat, z) - oy] }
}

// Fetches each tile once; Cloudflare's cache keeps them for a month. A tile that fails is left out.
export async function tileImages(env: Pick<Env, 'MAP_TILES_URL' | 'APP_URL'>, fit: MapFit): Promise<Array<{ href: string; left: number; top: number }>> {
  const base = env.MAP_TILES_URL
  if (!base) return []
  const out = await Promise.all(fit.tiles.map(async (t) => {
    try {
      const url = base.replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y))
      const res = await fetch(url, {
        headers: { 'user-agent': `Guardian by SARZA (${env.APP_URL})` },
        cf: { cacheTtl: 30 * 86_400, cacheEverything: true },
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) return null
      const type = res.headers.get('content-type') ?? 'image/png'
      return { href: `data:${type};base64,${base64(new Uint8Array(await res.arrayBuffer()))}`, left: t.left, top: t.top }
    } catch {
      return null
    }
  }))
  return out.filter((t) => t !== null)
}

// A file from public/ as a data URI, for images drawn into the card (the SARZA logo). Null when it can't be read.
export async function assetImage(env: Pick<Env, 'ASSETS'>, path: string): Promise<string | null> {
  try {
    const res = await env.ASSETS.fetch(new Request(`https://assets${path}`))
    if (!res.ok) return null
    return `data:${res.headers.get('content-type') ?? 'image/png'};base64,${base64(new Uint8Array(await res.arrayBuffer()))}`
  } catch {
    return null
  }
}

function base64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
