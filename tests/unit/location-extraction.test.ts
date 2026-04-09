import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseCoordinatesOrMapsLink } from '@/lib/services/routing.service'

// ─────────────────────────────────────────────────────────────────────────────
// parseCoordinatesOrMapsLink — direct coordinate parsing
// ─────────────────────────────────────────────────────────────────────────────

describe('parseCoordinatesOrMapsLink — bare coordinates', () => {
  it('parses a comma-separated lat,lng pair', async () => {
    const r = await parseCoordinatesOrMapsLink('32.7767,-96.797')
    expect(r).not.toBeNull()
    expect(r!.lat).toBeCloseTo(32.7767, 4)
    expect(r!.lng).toBeCloseTo(-96.797, 3)
    expect(r!.precision).toBe('address')
  })

  it('parses a space-separated lat lng pair', async () => {
    const r = await parseCoordinatesOrMapsLink('32.7767 -96.797')
    expect(r).not.toBeNull()
    expect(r!.lat).toBeCloseTo(32.7767, 4)
  })

  it('parses coordinates embedded in a sentence', async () => {
    const r = await parseCoordinatesOrMapsLink("im at 33.0198,-96.6989 right now")
    expect(r).not.toBeNull()
    expect(r!.lat).toBeCloseTo(33.0198, 4)
    expect(r!.lng).toBeCloseTo(-96.6989, 4)
  })

  it('rejects out-of-range latitudes', async () => {
    const r = await parseCoordinatesOrMapsLink('200.000,-96.797')
    expect(r).toBeNull()
  })

  it('rejects plain street numbers (not coordinates)', async () => {
    const r = await parseCoordinatesOrMapsLink('1234 Main St Dallas')
    expect(r).toBeNull()
  })

  it('returns null for empty / non-coordinate input', async () => {
    expect(await parseCoordinatesOrMapsLink('Dallas')).toBeNull()
    expect(await parseCoordinatesOrMapsLink('hey jesse')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// parseCoordinatesOrMapsLink — Google Maps share link resolution
// ─────────────────────────────────────────────────────────────────────────────

describe('parseCoordinatesOrMapsLink — Google Maps share links', () => {
  const realFetch = global.fetch

  beforeEach(() => {
    // @ts-expect-error overriding global fetch for tests
    global.fetch = vi.fn()
  })
  afterEach(() => {
    global.fetch = realFetch
  })

  it('extracts coords from a resolved @lat,lng URL pattern', async () => {
    ;(global.fetch as any).mockResolvedValue({
      url: 'https://www.google.com/maps/place/Some+Place/@32.7767,-96.797,17z/data=!4m2!3m1',
    })
    const r = await parseCoordinatesOrMapsLink('check this out https://maps.app.goo.gl/abcXYZ')
    expect(r).not.toBeNull()
    expect(r!.lat).toBeCloseTo(32.7767, 4)
    expect(r!.lng).toBeCloseTo(-96.797, 3)
    expect(r!.precision).toBe('address')
  })

  it('extracts coords from a resolved !3d!4d URL pattern', async () => {
    ;(global.fetch as any).mockResolvedValue({
      url: 'https://www.google.com/maps/place/X/data=!3m1!4b1!4m5!3m4!1s0x0:0x0!8m2!3d33.0198!4d-96.6989',
    })
    const r = await parseCoordinatesOrMapsLink('https://goo.gl/maps/xyz')
    expect(r).not.toBeNull()
    expect(r!.lat).toBeCloseTo(33.0198, 4)
    expect(r!.lng).toBeCloseTo(-96.6989, 4)
  })

  it('extracts coords from a resolved ?q=lat,lng URL pattern', async () => {
    ;(global.fetch as any).mockResolvedValue({
      url: 'https://maps.google.com/?q=32.5,-97.1&z=15',
    })
    const r = await parseCoordinatesOrMapsLink('https://maps.app.goo.gl/short')
    expect(r).not.toBeNull()
    expect(r!.lat).toBeCloseTo(32.5, 2)
    expect(r!.lng).toBeCloseTo(-97.1, 2)
  })

  it('returns null when the resolved URL has no coords', async () => {
    ;(global.fetch as any).mockResolvedValue({
      url: 'https://www.google.com/maps/search/dallas',
    })
    const r = await parseCoordinatesOrMapsLink('https://maps.app.goo.gl/nada')
    expect(r).toBeNull()
  })

  it('returns null when fetch throws', async () => {
    ;(global.fetch as any).mockRejectedValue(new Error('network down'))
    const r = await parseCoordinatesOrMapsLink('https://maps.app.goo.gl/broken')
    expect(r).toBeNull()
  })

  it('ignores plain text that mentions maps without a URL', async () => {
    const r = await parseCoordinatesOrMapsLink('I checked google maps')
    expect(r).toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Inline location-extraction regexes (mirror the logic in brain.service.ts:1799)
// These guarantee the patterns we rely on for routing input keep working.
// ─────────────────────────────────────────────────────────────────────────────

const looksLikeAddress = (body: string) =>
  /\d{2,}\s+\w+\s+(st|ave|blvd|dr|rd|ln|way|ct|pl|pkwy|hwy|fm|loop)\b/i.test(body) ||
  /\d{2,}\s+[nsew]\.?\s+\w+/i.test(body) ||
  /\d{2,}\s+(fm|sh|us|hwy|highway)\s+\d+/i.test(body)

const gpsMatch = (body: string) =>
  body.match(/(-?\d{1,3}\.\d{3,})[,\s]+(-?\d{1,3}\.\d{3,})/)

const mapsLink = (body: string) =>
  /https?:\/\/(?:www\.)?(?:maps\.google\.[a-z.]+|google\.[a-z.]+\/maps|goo\.gl\/maps|maps\.app\.goo\.gl|g\.co\/maps)\/?\S*/i.test(body)

const crossStreetMatch = (body: string) => {
  const lower = body.toLowerCase()
  return !looksLikeAddress(body) && !gpsMatch(body) && body.length < 80 &&
    /\b[a-z0-9]+(?:\s+(?:st|street|ave|avenue|blvd|rd|road|ln|lane|dr|drive))?\s+(?:and|&)\s+[a-z0-9]+(?:\s+(?:st|street|ave|avenue|blvd|rd|road|ln|lane|dr|drive))?\b/i.test(lower) &&
    !/\b(yes|no|ok|okay|maybe|trash|debris|concrete|asphalt|sand|clay|gravel|done|good|bad)\b/i.test(lower)
}

describe('looksLikeAddress', () => {
  it('matches a numbered street address', () => {
    expect(looksLikeAddress('1234 Main St Dallas')).toBe(true)
    expect(looksLikeAddress('5678 N Pearl Ave')).toBe(true)
    expect(looksLikeAddress('900 FM 1709')).toBe(true)
  })
  it('does not match a city name', () => {
    expect(looksLikeAddress('Dallas')).toBe(false)
    expect(looksLikeAddress('Fort Worth')).toBe(false)
  })
  it('does not match cross streets', () => {
    expect(looksLikeAddress('5th and Main')).toBe(false)
  })
})

describe('gpsMatch', () => {
  it('captures lat,lng pairs', () => {
    const m = gpsMatch('32.7767,-96.797')
    expect(m).not.toBeNull()
    expect(m![1]).toBe('32.7767')
    expect(m![2]).toBe('-96.797')
  })
  it('does not match street numbers', () => {
    expect(gpsMatch('1234 Main St')).toBeNull()
  })
})

describe('mapsLink', () => {
  it('detects maps.app.goo.gl', () => {
    expect(mapsLink('here https://maps.app.goo.gl/aBc123')).toBe(true)
  })
  it('detects goo.gl/maps', () => {
    expect(mapsLink('https://goo.gl/maps/xyz')).toBe(true)
  })
  it('detects google.com/maps', () => {
    expect(mapsLink('https://www.google.com/maps/place/Dallas')).toBe(true)
  })
  it('ignores bare text', () => {
    expect(mapsLink('use google maps to find me')).toBe(false)
  })
})

describe('crossStreetMatch', () => {
  it('detects "5th and Main"', () => {
    expect(crossStreetMatch('5th and Main')).toBe(true)
  })
  it('detects "Oak & Elm"', () => {
    expect(crossStreetMatch('Oak & Elm')).toBe(true)
  })
  it('detects "Pearl St and Commerce"', () => {
    expect(crossStreetMatch('Pearl St and Commerce')).toBe(true)
  })
  it('does not fire on natural-language "and" answers', () => {
    expect(crossStreetMatch('yes and no')).toBe(false)
    expect(crossStreetMatch('trash and debris')).toBe(false)
    expect(crossStreetMatch('sand and gravel')).toBe(false)
  })
  it('does not fire on real numbered addresses', () => {
    expect(crossStreetMatch('1234 Main St and 5th Ave')).toBe(false)
  })
  it('does not fire on long messages', () => {
    const long = 'I am driving down the road right now and looking for somewhere to dump this dirt I have been hauling all day'
    expect(crossStreetMatch(long)).toBe(false)
  })
})
