import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockSupabase } from '../setup'
import { findNearbyJobs, normalizeTruckClass, ACCESS_COLUMN } from '@/lib/services/routing.service'

// ---- Mock geocode via @/lib/supabase? No — geocode is internal. We stub fetch. ----

beforeEach(() => {
  vi.clearAllMocks()
  // Always resolve the geocode HTTP with a valid Dallas point so we reach the query path
  global.fetch = vi.fn().mockResolvedValue({
    json: async () => ({ status: 'OK', results: [{ geometry: { location: { lat: 32.7767, lng: -96.797 } }, types: ['street_address'], formatted_address: '100 Main St, Dallas, TX' }] }),
  }) as any
  process.env.GOOGLE_MAPS_API_KEY = 'test-key'
})

type Query = { filters: any[]; terminalData: any; terminalCount?: number }
type TableQueries = Record<string, Query[]>

function installRoutingMock(tables: TableQueries) {
  const eqCalls: Record<string, Array<[string, any]>> = {}
  const fromCounters: Record<string, number> = {}
  const inserts: Record<string, any[]> = {}

  mockSupabase.from.mockImplementation((table: string) => {
    fromCounters[table] = (fromCounters[table] || 0) + 1
    const queries = tables[table] || []
    const idx = fromCounters[table] - 1
    const q = queries[idx] || { filters: [], terminalData: [] }
    eqCalls[table] = eqCalls[table] || []

    const chain: any = {}
    const pass = ['select', 'update', 'delete', 'upsert', 'neq', 'in', 'gt', 'gte', 'lt', 'lte', 'ilike', 'order', 'limit', 'range', 'not']
    for (const k of pass) chain[k] = vi.fn().mockReturnValue(chain)
    chain.eq = vi.fn((col: string, val: any) => {
      eqCalls[table].push([col, val])
      return chain
    })
    chain.insert = vi.fn((payload: any) => {
      inserts[table] = inserts[table] || []
      inserts[table].push(payload)
      return chain
    })
    chain.single = vi.fn().mockResolvedValue({ data: null, error: null })
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    chain.then = (resolve: any, reject?: any) => {
      const error = (q as any).terminalError || null
      return Promise.resolve({ data: q.terminalData, error, count: q.terminalCount ?? (Array.isArray(q.terminalData) ? q.terminalData.length : 0) }).then(resolve, reject)
    }
    return chain
  })

  return { eqCalls, inserts, fromCounters }
}

function makeOrder(overrides: any = {}) {
  return {
    id: overrides.id || 'o-1',
    city_id: 'city-dallas',
    yards_needed: 30,
    driver_pay_cents: 3000,
    truck_type_needed: overrides.truck_type_needed ?? 'tandem_axle',
    status: 'dispatching',
    delivery_latitude: 32.7767,
    delivery_longitude: -96.797,
    client_phone: '+15550001111',
    client_name: 'Test Customer',
    client_address: '100 Main St, Dallas, TX',
    cities: { name: 'Dallas' },
    ...overrides,
  }
}

describe('normalizeTruckClass', () => {
  it('small set: tandem_axle, dump_truck, tandem', () => {
    expect(normalizeTruckClass('tandem_axle')).toBe('small')
    expect(normalizeTruckClass('dump_truck')).toBe('small')
    expect(normalizeTruckClass('tandem')).toBe('small')
  })
  it('big set: end_dump, 18_wheeler, eighteen_wheeler, semi', () => {
    expect(normalizeTruckClass('end_dump')).toBe('big')
    expect(normalizeTruckClass('18_wheeler')).toBe('big')
    expect(normalizeTruckClass('eighteen_wheeler')).toBe('big')
    expect(normalizeTruckClass('semi')).toBe('big')
  })
  it('unknown and null default to small', () => {
    expect(normalizeTruckClass('van')).toBe('small')
    expect(normalizeTruckClass('flying_saucer')).toBe('small')
    expect(normalizeTruckClass(null)).toBe('small')
    expect(normalizeTruckClass(undefined)).toBe('small')
    expect(normalizeTruckClass('')).toBe('small')
  })
})

describe('findNearbyJobs — CP2 access gate', () => {
  it('tandem driver → no access column filter applied to dispatch_orders query', async () => {
    const { eqCalls, fromCounters } = installRoutingMock({
      dispatch_orders: [
        { filters: [], terminalData: [makeOrder()] },
      ],
      site_reservations: [{ filters: [], terminalData: [] }],
      jesse_routing_log: [{ filters: [], terminalData: [] }],
    })
    const result = await findNearbyJobs('32.7767,-96.797', 'tandem_axle', 25)
    expect(result.length).toBeGreaterThan(0)
    const eqsOnDispatch = eqCalls.dispatch_orders || []
    expect(eqsOnDispatch.find(([c]) => c === ACCESS_COLUMN)).toBeUndefined()
  })

  it('dump_truck driver → no access column filter', async () => {
    const { eqCalls } = installRoutingMock({
      dispatch_orders: [{ filters: [], terminalData: [makeOrder()] }],
      site_reservations: [{ filters: [], terminalData: [] }],
      jesse_routing_log: [{ filters: [], terminalData: [] }],
    })
    await findNearbyJobs('32.7767,-96.797', 'dump_truck', 25)
    expect((eqCalls.dispatch_orders || []).find(([c]) => c === ACCESS_COLUMN)).toBeUndefined()
  })

  it('end_dump driver → access column filter eq true applied', async () => {
    const { eqCalls } = installRoutingMock({
      dispatch_orders: [
        { filters: [], terminalData: [makeOrder({ truck_type_needed: 'end_dump' })], terminalCount: 5 },
        { filters: [], terminalData: [], terminalCount: 5 }, // count query
      ],
      site_reservations: [{ filters: [], terminalData: [] }],
      jesse_routing_log: [{ filters: [], terminalData: [] }],
    })
    const result = await findNearbyJobs('32.7767,-96.797', 'end_dump', 25)
    expect(result.length).toBeGreaterThan(0)
    const gate = (eqCalls.dispatch_orders || []).find(([c]) => c === ACCESS_COLUMN)
    expect(gate).toEqual([ACCESS_COLUMN, true])
  })

  it('18_wheeler driver → access column filter eq true applied', async () => {
    const { eqCalls } = installRoutingMock({
      dispatch_orders: [
        { filters: [], terminalData: [makeOrder()], terminalCount: 3 },
        { filters: [], terminalData: [], terminalCount: 3 },
      ],
      site_reservations: [{ filters: [], terminalData: [] }],
      jesse_routing_log: [{ filters: [], terminalData: [] }],
    })
    await findNearbyJobs('32.7767,-96.797', '18_wheeler', 25)
    const gate = (eqCalls.dispatch_orders || []).find(([c]) => c === ACCESS_COLUMN)
    expect(gate).toEqual([ACCESS_COLUMN, true])
  })

  it('end_dump driver + no access=true orders → returns []', async () => {
    installRoutingMock({
      dispatch_orders: [
        { filters: [], terminalData: [], terminalCount: 10 },
        { filters: [], terminalData: [], terminalCount: 10 },
      ],
      site_reservations: [{ filters: [], terminalData: [] }],
      jesse_routing_log: [{ filters: [], terminalData: [] }],
    })
    const result = await findNearbyJobs('32.7767,-96.797', 'end_dump', 25)
    expect(result).toEqual([])
  })

  it('unknown truck_type (van) → treated as small, no access filter', async () => {
    const { eqCalls } = installRoutingMock({
      dispatch_orders: [{ filters: [], terminalData: [makeOrder()] }],
      site_reservations: [{ filters: [], terminalData: [] }],
      jesse_routing_log: [{ filters: [], terminalData: [] }],
    })
    await findNearbyJobs('32.7767,-96.797', 'van', 25)
    expect((eqCalls.dispatch_orders || []).find(([c]) => c === ACCESS_COLUMN)).toBeUndefined()
  })

  it('writes one jesse_routing_log row per call with normalized_class + access_column_used', async () => {
    const { inserts } = installRoutingMock({
      dispatch_orders: [
        { filters: [], terminalData: [makeOrder()], terminalCount: 5 },
        { filters: [], terminalData: [], terminalCount: 5 },
      ],
      site_reservations: [{ filters: [], terminalData: [] }],
      jesse_routing_log: [{ filters: [], terminalData: [] }],
    })
    await findNearbyJobs('32.7767,-96.797', 'end_dump', 25)
    const logRow = inserts.jesse_routing_log?.[0]
    expect(logRow).toBeDefined()
    expect(logRow.normalized_class).toBe('big')
    expect(logRow.access_column_used).toBe(ACCESS_COLUMN)
    expect(logRow.truck_type_input).toBe('end_dump')
    expect(typeof logRow.candidates_before_filter).toBe('number')
    expect(typeof logRow.candidates_after_filter).toBe('number')
  })

  it('falls back gracefully when access column is missing (migration not applied yet)', async () => {
    installRoutingMock({
      dispatch_orders: [
        { filters: [], terminalData: null, terminalError: { message: `column "${ACCESS_COLUMN}" does not exist` } } as any,
        { filters: [], terminalData: [makeOrder()] },
      ],
      site_reservations: [{ filters: [], terminalData: [] }],
      jesse_routing_log: [{ filters: [], terminalData: [] }],
    })
    const result = await findNearbyJobs('32.7767,-96.797', 'end_dump', 25)
    // Should fall back to unfiltered query and still return orders
    expect(result.length).toBeGreaterThan(0)
  })
})
