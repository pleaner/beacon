import { exports } from 'cloudflare:workers'
import { afterEach, describe, expect, it } from 'vitest'
import { COUNTRY_CODES } from '../src/lib/constants'
import { formatPhone, normalizePhone, splitPhone } from '../src/lib/phone'
import { placeFromReply, setPlaceLookupForTests } from '../src/lib/places'
import { cookieFor, makeExplorer } from './helpers'

describe('normalizePhone', () => {
  it('builds E.164 from a country code and a national number', () => {
    expect(normalizePhone('082 555 0147', '27')).toBe('+27825550147')
    expect(normalizePhone('825550147', '27')).toBe('+27825550147')
    expect(normalizePhone('07700 900123', '44')).toBe('+447700900123')
  })
  it('keeps full international numbers', () => {
    expect(normalizePhone('+27 82 555 0147', '44')).toBe('+27825550147')
    expect(normalizePhone('0027825550147')).toBe('+27825550147')
    expect(normalizePhone('27825550147', '27')).toBe('+27825550147')
  })
  it('returns null for nothing', () => {
    expect(normalizePhone(null)).toBeNull()
    expect(normalizePhone('  ')).toBeNull()
    expect(normalizePhone('abc')).toBeNull()
  })
})

describe('splitPhone and formatPhone', () => {
  it('round-trips a stored number into the form', () => {
    expect(splitPhone('+27825550147', COUNTRY_CODES)).toEqual({ country: '27', national: '825550147' })
    expect(splitPhone('+447700900123', COUNTRY_CODES)).toEqual({ country: '44', national: '7700900123' })
    expect(splitPhone(null, COUNTRY_CODES)).toEqual({ country: '27', national: '' })
  })
  it('groups South African numbers', () => {
    expect(formatPhone('+27825550147')).toBe('+27 82 555 0147')
    expect(formatPhone('+447700900123')).toBe('+447700900123')
  })
})

describe('placeFromReply', () => {
  it('prefers a named spot and adds the town', () => {
    expect(placeFromReply({ name: 'Kloof Nek', address: { city: 'Cape Town' } })).toBe('Kloof Nek, Cape Town')
    expect(placeFromReply({ address: { road: 'Tafelberg Road', suburb: 'Gardens' } })).toBe('Tafelberg Road, Gardens')
    expect(placeFromReply({ address: { town: 'Clanwilliam' } })).toBe('Clanwilliam')
    expect(placeFromReply({})).toBeNull()
  })
})

describe('GET /api/place', () => {
  afterEach(() => setPlaceLookupForTests(null))
  it('answers explorers with a place name, and checks coordinates', async () => {
    setPlaceLookupForTests(async () => 'Kloof Nek, Cape Town')
    const e = await makeExplorer()
    let res = await exports.default.fetch('https://beacon.test/api/place?lat=-33.95&lng=18.4', { headers: { cookie: cookieFor(e.token) } })
    expect(await res.json()).toEqual({ place: 'Kloof Nek, Cape Town' })
    res = await exports.default.fetch('https://beacon.test/api/place?lat=abc&lng=18.4', { headers: { cookie: cookieFor(e.token) } })
    expect(res.status).toBe(400)
    res = await exports.default.fetch('https://beacon.test/api/place?lat=1&lng=1')
    expect(res.status).toBe(401)
  })
})
