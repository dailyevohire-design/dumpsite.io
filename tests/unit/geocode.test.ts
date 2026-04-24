import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockSupabase } from '../setup'
import { geocode } from '@/lib/geo/geocode'

describe('geocode (extracted to lib/geo/geocode.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: geocode_cache miss, upsert resolves
    mockSupabase.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    mockSupabase.upsert = vi.fn().mockResolvedValue({ data: null, error: null })
    process.env.GOOGLE_MAPS_API_KEY = 'test-key'
  })

  it('Google Maps happy path returns {lat,lng,city}', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({
        status: 'OK',
        results: [{
          geometry: { location: { lat: 32.7767, lng: -96.797 } },
          address_components: [{ types: ['locality'], long_name: 'Dallas' }],
        }],
      }),
    }) as any

    const result = await geocode('100 Main St Dallas TX')
    expect(result).toEqual({ lat: 32.7767, lng: -96.797, city: 'Dallas' })
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('Google Maps throws → falls back to Nominatim', async () => {
    let call = 0
    global.fetch = vi.fn().mockImplementation(async () => {
      call++
      if (call === 1) throw new Error('Google upstream down')
      return { json: async () => ([{ lat: '39.7392', lon: '-104.9903', display_name: 'Denver, CO, USA' }]) }
    }) as any

    const result = await geocode('Denver CO')
    expect(result).toEqual({ lat: 39.7392, lng: -104.9903, city: 'Denver' })
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('Google ZERO_RESULTS → falls back to Nominatim', async () => {
    let call = 0
    global.fetch = vi.fn().mockImplementation(async () => {
      call++
      if (call === 1) return { json: async () => ({ status: 'ZERO_RESULTS', results: [] }) }
      return { json: async () => ([{ lat: '30.27', lon: '-97.74', display_name: 'Austin, TX, USA' }]) }
    }) as any

    const result = await geocode('Austin')
    expect(result?.city).toBe('Austin')
  })

  it('both providers fail → returns null (never throws)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network')) as any
    const result = await geocode('Nowhere ZZ')
    expect(result).toBeNull()
  })

  it('no GOOGLE_MAPS_API_KEY → tries Nominatim only', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ([{ lat: '40.0', lon: '-75.0', display_name: 'Philadelphia, PA, USA' }]),
    }) as any
    const result = await geocode('Philadelphia')
    expect(result?.city).toBe('Philadelphia')
    expect(global.fetch).toHaveBeenCalledTimes(1) // skipped Google entirely
  })
})
