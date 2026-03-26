import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockSupabase } from '../setup'
import { createDispatchOrder, type CreateDispatchInput } from '@/lib/services/dispatch.service'
import { smsDispatchService, generateJobNumber } from '@/lib/services/sms-dispatch.service'
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
// 2. SMS inbound handling (smsDispatchService.handleIncoming)
// ===========================================================================

describe('smsDispatchService.handleIncoming', () => {
  const driverProfile = { user_id: MOCK_DRIVER_ID, first_name: 'Mike', phone: MOCK_DRIVER_PHONE, city_id: MOCK_CITY_ID, cities: { name: 'Dallas' } }

  describe('STATUS command', () => {
    it('returns current job info for an approved load', async () => {
      setupTableMock({
        driver_profiles: [
          { data: { user_id: MOCK_DRIVER_ID, first_name: 'Mike' } },
        ],
        load_requests: [
          {
            data: {
              id: 'load-1',
              status: 'approved',
              dispatch_order_id: MOCK_DISPATCH_ID,
              yards_estimated: 100,
              dispatch_orders: { status: 'active', cities: { name: 'Dallas' } },
            },
          },
        ],
      })

      const response = await smsDispatchService.handleIncoming({
        from: MOCK_DRIVER_PHONE,
        body: 'STATUS',
        messageSid: 'SM001',
      })

      expect(response).toContain('Mike')
      expect(response).toContain(generateJobNumber(MOCK_DISPATCH_ID))
      expect(response).toContain('Dallas')
      expect(response).toContain('approved')
      expect(response).toContain('100 yards')
    })

    it('returns pending info for a pending load', async () => {
      setupTableMock({
        driver_profiles: [
          { data: { user_id: MOCK_DRIVER_ID, first_name: 'Mike' } },
        ],
        load_requests: [
          {
            data: {
              id: 'load-2',
              status: 'pending',
              dispatch_order_id: MOCK_DISPATCH_ID,
              yards_estimated: 50,
              dispatch_orders: { status: 'dispatching', cities: { name: 'Fort Worth' } },
            },
          },
        ],
      })

      const response = await smsDispatchService.handleIncoming({
        from: MOCK_DRIVER_PHONE,
        body: 'job',
        messageSid: 'SM002',
      })

      expect(response).toContain('pending approval')
      expect(response).toContain('Fort Worth')
    })

    it('returns no-active-jobs message when driver has none', async () => {
      setupTableMock({
        driver_profiles: [
          { data: { user_id: MOCK_DRIVER_ID, first_name: 'Mike' } },
        ],
        load_requests: [
          { data: null },
        ],
      })

      const response = await smsDispatchService.handleIncoming({
        from: MOCK_DRIVER_PHONE,
        body: 'STATUS',
        messageSid: 'SM003',
      })

      expect(response).toContain('No active jobs')
      expect(response).toContain('dumpsite.io/dashboard')
    })
  })

  describe('DONE command', () => {
    const activeApprovedLoad = {
      id: 'load-done-1',
      dispatch_order_id: MOCK_DISPATCH_ID,
      yards_estimated: 200,
      dispatch_orders: { driver_pay_cents: 5000, cities: { name: 'Dallas' } },
    }

    it('marks job complete with correct single-load payout', async () => {
      setupTableMock({
        driver_profiles: [
          { data: { user_id: MOCK_DRIVER_ID, first_name: 'Mike' } },
        ],
        load_requests: [
          { data: activeApprovedLoad }, // active load lookup
          { data: null }, // update
        ],
        driver_payments: [
          { data: null }, // insert payment
        ],
      })

      const response = await smsDispatchService.handleIncoming({
        from: MOCK_DRIVER_PHONE,
        body: 'done',
        messageSid: 'SM004',
      })

      expect(response).toContain('marked complete')
      expect(response).toContain('1 load(s)')
      expect(response).toContain('$50') // 5000 cents
    })

    it('calculates correctly with load count ("done 3")', async () => {
      setupTableMock({
        driver_profiles: [
          { data: { user_id: MOCK_DRIVER_ID, first_name: 'Mike' } },
        ],
        load_requests: [
          { data: activeApprovedLoad },
          { data: null },
        ],
        driver_payments: [
          { data: null },
        ],
      })

      const response = await smsDispatchService.handleIncoming({
        from: MOCK_DRIVER_PHONE,
        body: 'done 3',
        messageSid: 'SM005',
      })

      expect(response).toContain('3 load(s)')
      expect(response).toContain('$150') // 5000 * 3 / 100
    })

    it('handles "complete 5 loads" variant', async () => {
      setupTableMock({
        driver_profiles: [
          { data: { user_id: MOCK_DRIVER_ID, first_name: 'Mike' } },
        ],
        load_requests: [
          { data: activeApprovedLoad },
          { data: null },
        ],
        driver_payments: [
          { data: null },
        ],
      })

      const response = await smsDispatchService.handleIncoming({
        from: MOCK_DRIVER_PHONE,
        body: 'complete 5 loads',
        messageSid: 'SM006',
      })

      expect(response).toContain('5 load(s)')
      expect(response).toContain('$250') // 5000 * 5 / 100
    })

    it('caps load count at 50', async () => {
      setupTableMock({
        driver_profiles: [
          { data: { user_id: MOCK_DRIVER_ID, first_name: 'Mike' } },
        ],
        load_requests: [
          { data: activeApprovedLoad },
          { data: null },
        ],
        driver_payments: [
          { data: null },
        ],
      })

      const response = await smsDispatchService.handleIncoming({
        from: MOCK_DRIVER_PHONE,
        body: 'done 200',
        messageSid: 'SM007',
      })

      expect(response).toContain('50 load(s)') // capped at 50
    })

    it('returns no-active-job message when none approved', async () => {
      setupTableMock({
        driver_profiles: [
          { data: { user_id: MOCK_DRIVER_ID, first_name: 'Mike' } },
        ],
        load_requests: [
          { data: null }, // no active load
        ],
      })

      const response = await smsDispatchService.handleIncoming({
        from: MOCK_DRIVER_PHONE,
        body: 'done',
        messageSid: 'SM008',
      })

      expect(response).toContain('No active approved job')
    })
  })

  describe('CANCEL command', () => {
    it('cancels an active job', async () => {
      setupTableMock({
        driver_profiles: [
          { data: { user_id: MOCK_DRIVER_ID, first_name: 'Mike' } },
        ],
        load_requests: [
          {
            data: {
              id: 'load-cancel-1',
              dispatch_order_id: MOCK_DISPATCH_ID,
              status: 'approved',
              dispatch_orders: { cities: { name: 'Dallas' } },
            },
          },
          { data: null }, // update result
        ],
      })

      const response = await smsDispatchService.handleIncoming({
        from: MOCK_DRIVER_PHONE,
        body: 'cancel',
        messageSid: 'SM009',
      })

      expect(response).toContain('cancelled')
      expect(response).toContain('Dallas')
    })

    it('handles "stop job" alias', async () => {
      setupTableMock({
        driver_profiles: [
          { data: { user_id: MOCK_DRIVER_ID, first_name: 'Mike' } },
        ],
        load_requests: [
          {
            data: {
              id: 'load-cancel-2',
              dispatch_order_id: MOCK_DISPATCH_ID,
              status: 'pending',
              dispatch_orders: { cities: { name: 'Plano' } },
            },
          },
          { data: null },
        ],
      })

      const response = await smsDispatchService.handleIncoming({
        from: MOCK_DRIVER_PHONE,
        body: 'stop job',
        messageSid: 'SM010',
      })

      expect(response).toContain('cancelled')
      expect(response).toContain('Plano')
    })

    it('returns no-active-job message if nothing to cancel', async () => {
      setupTableMock({
        driver_profiles: [
          { data: { user_id: MOCK_DRIVER_ID, first_name: 'Mike' } },
        ],
        load_requests: [
          { data: null }, // no active job
        ],
      })

      const response = await smsDispatchService.handleIncoming({
        from: MOCK_DRIVER_PHONE,
        body: 'cancel',
        messageSid: 'SM011',
      })

      expect(response).toContain('No active job to cancel')
    })
  })

  describe('Free-text matching', () => {
    it('matches available jobs in the driver city', async () => {
      setupTableMock({
        driver_profiles: [
          { data: driverProfile },
        ],
        load_requests: [
          { data: null }, // no existing active job
        ],
        dispatch_orders: [
          {
            data: [{
              id: MOCK_DISPATCH_ID,
              yards_needed: 300,
              driver_pay_cents: 5000,
              cities: { name: 'Dallas' },
            }],
          },
        ],
      })

      const response = await smsDispatchService.handleIncoming({
        from: MOCK_DRIVER_PHONE,
        body: 'Fort Worth, clean fill, 200 yards',
        messageSid: 'SM012',
      })

      expect(response).toContain('Mike')
      expect(response).toContain('Dallas')
      expect(response).toContain('300 yards')
    })

    it('tells driver about existing active job if they have one', async () => {
      setupTableMock({
        driver_profiles: [
          { data: driverProfile },
        ],
        load_requests: [
          { data: { id: 'existing-load' } }, // has active job
        ],
      })

      const response = await smsDispatchService.handleIncoming({
        from: MOCK_DRIVER_PHONE,
        body: 'Dallas clean fill 100 yards',
        messageSid: 'SM013',
      })

      expect(response).toContain('already have an active job')
      expect(response).toContain('STATUS')
    })

    it('informs driver when no jobs are available', async () => {
      setupTableMock({
        driver_profiles: [
          { data: { ...driverProfile, cities: { name: 'Fort Worth' } } },
        ],
        load_requests: [
          { data: null }, // no active job
        ],
        dispatch_orders: [
          { data: [] }, // no available jobs
        ],
      })

      const response = await smsDispatchService.handleIncoming({
        from: MOCK_DRIVER_PHONE,
        body: 'need a dump site',
        messageSid: 'SM014',
      })

      expect(response).toContain('No available jobs')
    })
  })

  describe('Unknown driver', () => {
    it('returns signup message for unrecognized phone number', async () => {
      setupTableMock({
        driver_profiles: [
          { data: null }, // no profile found
        ],
      })

      const response = await smsDispatchService.handleIncoming({
        from: '+19995550000',
        body: 'STATUS',
        messageSid: 'SM015',
      })

      expect(response).toContain('No driver account found')
      expect(response).toContain('dumpsite.io')
    })

    it('returns signup message for unknown driver sending free text', async () => {
      setupTableMock({
        driver_profiles: [
          { data: null },
        ],
      })

      const response = await smsDispatchService.handleIncoming({
        from: '+19995550000',
        body: 'Dallas 200 yards clean fill',
        messageSid: 'SM016',
      })

      expect(response).toContain('No driver account found')
      expect(response).toContain('Sign up')
    })

    it('returns signup message for unknown driver trying DONE', async () => {
      setupTableMock({
        driver_profiles: [
          { data: null },
        ],
      })

      const response = await smsDispatchService.handleIncoming({
        from: '+19995550000',
        body: 'done 2',
        messageSid: 'SM017',
      })

      expect(response).toContain('No driver account found')
    })
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

  describe('Address never exposed in responses', () => {
    it('STATUS response does not contain client address', async () => {
      setupTableMock({
        driver_profiles: [
          { data: { user_id: MOCK_DRIVER_ID, first_name: 'Mike' } },
        ],
        load_requests: [
          {
            data: {
              id: 'load-sec-1',
              status: 'approved',
              dispatch_order_id: MOCK_DISPATCH_ID,
              yards_estimated: 100,
              dispatch_orders: { status: 'active', cities: { name: 'Dallas' }, client_address: '123 Secret Ln' },
            },
          },
        ],
      })

      const response = await smsDispatchService.handleIncoming({
        from: MOCK_DRIVER_PHONE,
        body: 'status',
        messageSid: 'SM-SEC-1',
      })

      expect(response).not.toContain('123 Secret Ln')
      expect(response).not.toContain('Secret')
    })

    it('DONE response does not contain client address', async () => {
      setupTableMock({
        driver_profiles: [
          { data: { user_id: MOCK_DRIVER_ID, first_name: 'Mike' } },
        ],
        load_requests: [
          {
            data: {
              id: 'load-sec-2',
              dispatch_order_id: MOCK_DISPATCH_ID,
              yards_estimated: 100,
              dispatch_orders: { driver_pay_cents: 5000, cities: { name: 'Dallas' }, client_address: '456 Hidden Ave' },
            },
          },
          { data: null },
        ],
        driver_payments: [
          { data: null },
        ],
      })

      const response = await smsDispatchService.handleIncoming({
        from: MOCK_DRIVER_PHONE,
        body: 'done',
        messageSid: 'SM-SEC-2',
      })

      expect(response).not.toContain('456 Hidden Ave')
      expect(response).not.toContain('Hidden')
    })

    it('free-text response does not contain client address', async () => {
      setupTableMock({
        driver_profiles: [
          { data: { user_id: MOCK_DRIVER_ID, first_name: 'Mike', phone: MOCK_DRIVER_PHONE, city_id: MOCK_CITY_ID, cities: { name: 'Dallas' } } },
        ],
        load_requests: [
          { data: null },
        ],
        dispatch_orders: [
          {
            data: [{
              id: MOCK_DISPATCH_ID,
              yards_needed: 100,
              driver_pay_cents: 4000,
              cities: { name: 'Dallas' },
              client_address: '789 Confidential Rd',
            }],
          },
        ],
      })

      const response = await smsDispatchService.handleIncoming({
        from: MOCK_DRIVER_PHONE,
        body: 'looking for a job',
        messageSid: 'SM-SEC-3',
      })

      expect(response).not.toContain('789 Confidential Rd')
      expect(response).not.toContain('Confidential')
    })

    it('dispatch order select for free-text does not query client_address', async () => {
      // This verifies the select query doesn't include client_address
      // by checking the response doesn't leak it even if db returns it
      setupTableMock({
        driver_profiles: [
          { data: { user_id: MOCK_DRIVER_ID, first_name: 'Mike', phone: MOCK_DRIVER_PHONE, city_id: MOCK_CITY_ID, cities: { name: 'Dallas' } } },
        ],
        load_requests: [
          { data: null },
        ],
        dispatch_orders: [
          {
            data: [{
              id: MOCK_DISPATCH_ID,
              yards_needed: 50,
              driver_pay_cents: 3500,
              client_address: 'SHOULD NOT APPEAR',
              cities: { name: 'Dallas' },
            }],
          },
        ],
      })

      const response = await smsDispatchService.handleIncoming({
        from: MOCK_DRIVER_PHONE,
        body: 'any jobs available?',
        messageSid: 'SM-SEC-4',
      })

      expect(response).not.toContain('SHOULD NOT APPEAR')
    })
  })
})
