// Turns the GPS start point into a place name operators recognise ("Kloof Nek, Cape Town").
// Uses a Nominatim-compatible reverse geocoder (OpenStreetMap by default). Set GEOCODE_URL to ''
// to turn lookups off; trips then show coordinates only.

export type PlaceLookup = (lat: number, lng: number) => Promise<string | null>

interface NominatimReply {
  name?: string
  address?: Record<string, string>
}

export function nominatimLookup(env: Env): PlaceLookup {
  return async (lat, lng) => {
    const base = env.GEOCODE_URL
    if (!base) return null
    const url = `${base}?format=jsonv2&zoom=16&addressdetails=1&lat=${lat.toFixed(5)}&lon=${lng.toFixed(5)}`
    const res = await fetch(url, { headers: { 'user-agent': `SARZA Beacon (${env.APP_URL})`, 'accept-language': 'en' } })
    if (!res.ok) return null
    return placeFromReply((await res.json()) as NominatimReply)
  }
}

export function placeFromReply(r: NominatimReply): string | null {
  const a = r.address ?? {}
  const spot = r.name || a.tourism || a.leisure || a.natural || a.amenity || a.road || a.hamlet || null
  const town = a.city || a.town || a.village || a.suburb || a.municipality || a.county || null
  const parts = [spot, town].filter((p, i, all): p is string => !!p && all.indexOf(p) === i)
  return parts.length ? parts.join(', ').slice(0, 120) : null
}

let lookupOverride: PlaceLookup | null = null
export function setPlaceLookupForTests(f: PlaceLookup | null) {
  lookupOverride = f
}
export function getPlaceLookup(env: Env): PlaceLookup {
  return lookupOverride ?? nominatimLookup(env)
}
