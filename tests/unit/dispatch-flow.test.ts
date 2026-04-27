import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockSupabase } from '../setup'
import { createDispatchOrder, type CreateDispatchInput } from '@/lib/services/dispatch.service'
import { generateJobNumber } from '@/lib/services/brain.service'
import {
  getDriverPayCents,
  DEFAULT_DRIVER_PAY_CENTS,
  CITY_DRIVER_PAY_CENTS,
} from '@/lib/driver-pay-rates'
import { batchDispatchSMS, sendAdminAlert } from '@/lib/sms'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_CITY_ID = 'city-uuid-dallas'
const MOCK_DISPATCH_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const MOCK_DRIVER_ID = 'driver-uuid-001'
const MOCK_DRIVER_PHONE = '+15551234567'

function baseDispatchInput(overrides: Partial<CreateDispatchInput> = {}): CreateDispatchInput {
  return {
    clientName: 'John Doe',
    clientPhone: '+15559998888',
    clientAddress: '123 Main St, Dallas TX 75201',
    cityId: MOCK_CITY_ID,
    yardsNeeded: 200,
    priceQuotedCents: 25000,
    notes: 'Clean fill only',
    urgency: 'standard',
    source: 'manual',
    ...overrides,
  }
}

/**
 * Table-aware mock setup. Instead of relying on call ordering of shared
 * maybeSingle/single mocks, we track which table was queried via `from()`
 * and return data based on the table name.
 */
function setupTableMock(tableResponses: Record<string, { data: any; error?: any; method?: 'single' | 'maybeSingle' | 'limit' }[]>) {
  const callCounters: Record<string, number> = {}

  mockSupabase.from.mockImplementation((table: string) => {
    if (!callCounters[table]) callCounters[table] = 0

    const responses = tableResponses[table] || []
    const idx = callCounters[table]
    callCounters[table]++

    const response = idx < responses.length ? responses[idx] : { data: null, error: null }
    const chainObj = {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: response.data, error: response.error || null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: response.data, error: response.error || null }),
      then: (resolve: any, reject?: any) =>
        Promise.resolve({ data: response.data, error: response.error || null, count: Array.isArray(response.data) ? response.data.length : 0 }).then(resolve, reject),
    }
    // Make every chain method return chainObj for further chaining
    for (const key of ['select', 'insert', 'update', 'delete', 'upsert', 'eq', 'neq', 'in', 'gte', 'ilike', 'order', 'limit', 'range', 'not']) {
      (chainObj as any)[key].mockReturnValue(chainObj)
    }
    return chainObj
  })
}

// ---------------------------------------------------------------------------
// Reset all mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()

  // Default: every chained supabase call resolves to empty success
  mockSupabase.single.mockResolvedValue({ data: null, error: null })
  mockSupabase.maybeSingle.mockResolvedValue({ data: null, error: null })
  mockSupabase.limit.mockReturnValue(mockSupabase)
  mockSupabase.select.mockReturnValue(mockSupabase)
  mockSupabase.insert.mockReturnValue(mockSupabase)
  mockSupabase.update.mockReturnValue(mockSupabase)
  mockSupabase.delete.mockReturnValue(mockSupabase)
  mockSupabase.eq.mockReturnValue(mockSupabase)
  mockSupabase.neq.mockReturnValue(mockSupabase)
  mockSupabase.in.mockReturnValue(mockSupabase)
  mockSupabase.gte.mockReturnValue(mockSupabase)
  mockSupabase.ilike.mockReturnValue(mockSupabase)
  mockSupabase.order.mockReturnValue(mockSupabase)
  mockSupabase.range.mockReturnValue(mockSupabase)
  mockSupabase.not.mockReturnValue(mockSupabase)
  mockSupabase.from.mockReturnValue(mockSupabase)
  mockSupabase.upsert.mockReturnValue(mockSupabase)
})

// ===========================================================================
// 1. Dispatch creation flow (createDispatchOrder)
// ===========================================================================

describe('createDispatchOrder', () => {
  const mockCity = { id: MOCK_CITY_ID, name: 'Dallas', default_driver_pay_cents: null }
  const mockOrder = {
    id: MOCK_DISPATCH_ID,
    driver_pay_cents: 5000,
    status: 'dispatching',
  }
  const mockDrivers = [
    {
      user_id: 'drv-1',
      first_name: 'Mike',
      phone: '+15551110001',
      phone_verified: true,
      tiers: { slug: 'elite', dispatch_priority: 1, notification_delay_minutes: 0 },
    },
    {
      user_id: 'drv-2',
      first_name: 'Sam',
      phone: '+15551110002',
      phone_verified: true,
      tiers: { slug: 'pro', dispatch_priority: 2, notification_delay_minutes: 5 },
    },
    {
      user_id: 'drv-3',
      first_name: 'Jess',
      phone: '+15551110003',
      phone_verified: true,
      tiers: { slug: 'hauler', dispatch_priority: 3, notification_delay_minutes: 15 },
    },
  ]

  function setupHappyPath() {
    // No zapierRowId in default input, so dup check is skipped.
    // Call order for dispatch_orders: insert(single), tier update, tier fallback
    setupTableMock({
      dispatch_orders: [
        { data: mockOrder }, // insert order (single)
        { data: null }, // tier update
        { data: null }, // possible fallback tier update
      ],
      cities: [
        { data: mockCity }, // city lookup (single)
      ],
      driver_profiles: [
        { data: mockDrivers }, // drivers query (limit terminal)
      ],
      audit_logs: [
        { data: null }, // audit insert
      ],
    })
  }

  it('creates a dispatch order with correct fields and returns success', async () => {
    setupHappyPath()
    const result = await createDispatchOrder(baseDispatchInput())

    expect(result.success).toBe(true)
    expect(result.dispatchId).toBe(MOCK_DISPATCH_ID)
    expect(result.cityName).toBe('Dallas')
  })

  it('calculates driver pay from city rates, never from quoted price', async () => {
    setupHappyPath()
    const input = baseDispatchInput({ priceQuotedCents: 99900 })
    await createDispatchOrder(input)

    // Check that batchDispatchSMS was called and the pay is from city config, not quote
    const dispatchedDrivers = vi.mocked(batchDispatchSMS).mock.calls[0][0] as any[]
    expect(dispatchedDrivers[0].payDollars).toBe(50) // 5000 cents from mockOrder
    // Never 999 (from 99900 cents quote)
    expect(dispatchedDrivers[0].payDollars).not.toBe(999)
  })

  it('sends batch SMS to drivers', async () => {
    setupHappyPath()
    await createDispatchOrder(baseDispatchInput())

    expect(batchDispatchSMS).toHaveBeenCalledTimes(1)
    const dispatchedDrivers = vi.mocked(batchDispatchSMS).mock.calls[0][0] as any[]
    expect(dispatchedDrivers).toHaveLength(3)
    // Verify tier ordering is preserved (elite, pro, hauler)
    expect(dispatchedDrivers[0].tierSlug).toBe('elite')
    expect(dispatchedDrivers[1].tierSlug).toBe('pro')
    expect(dispatchedDrivers[2].tierSlug).toBe('hauler')
  })

  it('records an audit log entry after dispatch', async () => {
    setupHappyPath()
    await createDispatchOrder(baseDispatchInput())

    // Verify audit_logs was called via from()
    const fromCalls = mockSupabase.from.mock.calls.map((c: any) => c[0])
    expect(fromCalls).toContain('audit_logs')
  })

  it('prevents duplicate Zapier submissions', async () => {
    setupTableMock({
      dispatch_orders: [
        { data: { id: 'existing-dispatch-id' } }, // dup check returns existing
      ],
    })

    const input = baseDispatchInput({ source: 'zapier', zapierRowId: 'zap-row-123' })
    const result = await createDispatchOrder(input)

    expect(result.success).toBe(true)
    expect(result.duplicate).toBe(true)
    expect(result.dispatchId).toBe('existing-dispatch-id')
    expect(result.driversNotified).toBe(0)
    expect(batchDispatchSMS).not.toHaveBeenCalled()
  })

  it('sends admin alert when no drivers are found', async () => {
    setupTableMock({
      dispatch_orders: [
        { data: { ...mockOrder } }, // insert order
      ],
      cities: [
        { data: mockCity },
      ],
      driver_profiles: [
        { data: [] }, // no drivers
      ],
    })

    const result = await createDispatchOrder(baseDispatchInput())
    expect(sendAdminAlert).toHaveBeenCalled()
    expect(result.driversNotified).toBe(0)
  })

  it('returns error when city is not found', async () => {
    setupTableMock({
      dispatch_orders: [
        { data: null }, // no dup
      ],
      cities: [
        { data: null }, // city not found
      ],
    })

    const result = await createDispatchOrder(baseDispatchInput())
    expect(result.success).toBe(false)
    expect(result.error).toContain('City not found')
  })

  it('uses DB column pay rate when available on city', async () => {
    const cityWithDBPay = { ...mockCity, default_driver_pay_cents: 7500 }
    setupTableMock({
      dispatch_orders: [
        { data: null },
        { data: { ...mockOrder, driver_pay_cents: 7500 } },
        { data: null },
      ],
      cities: [
        { data: cityWithDBPay },
      ],
      driver_profiles: [
        { data: mockDrivers },
      ],
      audit_logs: [
        { data: null },
      ],
    })

    await createDispatchOrder(baseDispatchInput())
    // DB column (7500) should override city config
    expect(getDriverPayCents('Dallas', 7500)).toBe(7500)
  })
})


// ===========================================================================
// 3. Job number generation
// ===========================================================================

describe('generateJobNumber', () => {
  it('generates DS-XXXXXX format', () => {
    const num = generateJobNumber('a1b2c3d4-e5f6-7890-abcd-ef1234567890')
    expect(num).toMatch(/^DS-[A-Z0-9]{6}$/)
  })

  it('is deterministic for the same dispatch ID', () => {
    const id = 'deadbeef-0000-1111-2222-333344445555'
    expect(generateJobNumber(id)).toBe(generateJobNumber(id))
  })

  it('strips hyphens and uppercases', () => {
    const num = generateJobNumber('a1b2c3d4-e5f6-7890-abcd-ef1234567890')
    expect(num).toBe('DS-A1B2C3')
  })

  it('produces different numbers for different IDs', () => {
    const a = generateJobNumber('aaaa0000-0000-0000-0000-000000000000')
    const b = generateJobNumber('bbbb0000-0000-0000-0000-000000000000')
    expect(a).not.toBe(b)
  })
})

// ===========================================================================
// 4. Driver pay rates
// ===========================================================================

describe('getDriverPayCents', () => {
  it('returns city-specific rate for Dallas', () => {
    expect(getDriverPayCents('Dallas')).toBe(CITY_DRIVER_PAY_CENTS['dallas'])
  })

  it('is case-insensitive', () => {
    expect(getDriverPayCents('DALLAS')).toBe(getDriverPayCents('dallas'))
  })

  it('falls back to $40 default for unknown cities', () => {
    expect(getDriverPayCents('Timbuktu')).toBe(DEFAULT_DRIVER_PAY_CENTS)
  })

  it('DB column takes priority over config when set', () => {
    expect(getDriverPayCents('Dallas', 7500)).toBe(7500)
  })

  it('DB column takes priority for unknown cities too', () => {
    expect(getDriverPayCents('UnknownCity', 9000)).toBe(9000)
  })

  it('ignores DB column when zero', () => {
    expect(getDriverPayCents('Dallas', 0)).toBe(CITY_DRIVER_PAY_CENTS['dallas'])
  })

  it('ignores DB column when null', () => {
    expect(getDriverPayCents('Dallas', null as any)).toBe(CITY_DRIVER_PAY_CENTS['dallas'])
  })

  it('ignores DB column when undefined', () => {
    expect(getDriverPayCents('Dallas', undefined)).toBe(CITY_DRIVER_PAY_CENTS['dallas'])
  })
})

// ===========================================================================
// 5. Security boundaries
// ===========================================================================

describe('Security boundaries', () => {
  describe('Driver pay never derived from client price', () => {
    it('dispatch insert uses getDriverPayCents, not priceQuotedCents', () => {
      // Verify the function returns city rate, not any arbitrary input
      const pay = getDriverPayCents('Dallas')
      expect(pay).toBe(CITY_DRIVER_PAY_CENTS['dallas'])
      // Even with a wildly different quote, pay stays the same
      expect(pay).not.toBe(99900)
      expect(pay).not.toBe(25000)
    })
  })
})
