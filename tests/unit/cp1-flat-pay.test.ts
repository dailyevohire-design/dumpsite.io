import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockSupabase } from '../setup'
import { createDispatchOrder, type CreateDispatchInput } from '@/lib/services/dispatch.service'

const CITY_ID = 'city-uuid-dallas'
const ORDER_ID = 'order-uuid-cp1'

function baseInput(overrides: Partial<CreateDispatchInput> = {}): CreateDispatchInput {
  return {
    clientName: 'CP1 Test',
    clientPhone: '+15559998888',
    clientAddress: '123 Main St, Dallas TX 75201',
    cityId: CITY_ID,
    yardsNeeded: 30,
    priceQuotedCents: 25000,
    urgency: 'standard',
    source: 'manual',
    ...overrides,
  }
}

type Capture = { inserts: Record<string, any[]> }

function installCapturingMock(): Capture {
  const capture: Capture = { inserts: {} }
  const callCounters: Record<string, number> = {}
  const cityRow = { id: CITY_ID, name: 'Dallas', default_driver_pay_cents: null }

  mockSupabase.from.mockImplementation((table: string) => {
    callCounters[table] = (callCounters[table] || 0) + 1
    const chain: any = {}
    const passthrough = ['select', 'update', 'delete', 'upsert', 'eq', 'neq', 'in', 'gte', 'ilike', 'order', 'limit', 'range', 'not']
    for (const k of passthrough) chain[k] = vi.fn().mockReturnValue(chain)
    chain.insert = vi.fn((payload: any) => {
      capture.inserts[table] = capture.inserts[table] || []
      capture.inserts[table].push(payload)
      return chain
    })
    // cities lookup returns the Dallas row; dispatch_orders insert returns the new order
    chain.single = vi.fn().mockResolvedValue(
      table === 'cities'
        ? { data: cityRow, error: null }
        : table === 'dispatch_orders' && callCounters[table] === 1
          ? { data: { id: ORDER_ID, driver_pay_cents: 3000, status: 'dispatching' }, error: null }
          : { data: null, error: null }
    )
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    // Terminal awaits (e.g., .limit() on driver_profiles) land here
    const terminalData = table === 'driver_profiles'
      ? [{ user_id: 'drv-1', first_name: 'Mike', phone: '+15551110001', phone_verified: true, tiers: { slug: 'elite', dispatch_priority: 1, notification_delay_minutes: 0 } }]
      : []
    chain.then = (resolve: any, reject?: any) =>
      Promise.resolve({ data: terminalData, error: null, count: terminalData.length }).then(resolve, reject)
    return chain
  })
  return capture
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.FEATURE_FLAT_DRIVER_PAY
})

describe('CP1 — flat driver pay by truck type', () => {
  it('tandem_axle → $30 (3000 cents) when flag default', async () => {
    const cap = installCapturingMock()
    await createDispatchOrder(baseInput({ truckTypeNeeded: 'tandem_axle' }))
    expect(cap.inserts.dispatch_orders?.[0].driver_pay_cents).toBe(3000)
  })

  it('dump_truck → $30 (3000 cents)', async () => {
    const cap = installCapturingMock()
    await createDispatchOrder(baseInput({ truckTypeNeeded: 'dump_truck' }))
    expect(cap.inserts.dispatch_orders?.[0].driver_pay_cents).toBe(3000)
  })

  it('end_dump → $50 (5000 cents)', async () => {
    const cap = installCapturingMock()
    await createDispatchOrder(baseInput({ truckTypeNeeded: 'end_dump' }))
    expect(cap.inserts.dispatch_orders?.[0].driver_pay_cents).toBe(5000)
  })

  it('18_wheeler → $50 (5000 cents)', async () => {
    const cap = installCapturingMock()
    await createDispatchOrder(baseInput({ truckTypeNeeded: '18_wheeler' }))
    expect(cap.inserts.dispatch_orders?.[0].driver_pay_cents).toBe(5000)
  })

  it('unknown truck type → falls back to city rate (Dallas=5000)', async () => {
    const cap = installCapturingMock()
    await createDispatchOrder(baseInput({ truckTypeNeeded: 'flying_saucer' }))
    expect(cap.inserts.dispatch_orders?.[0].driver_pay_cents).toBe(5000)
    expect(cap.inserts.audit_logs?.find(r => r.action === 'dispatch.flat_pay_applied')).toBeUndefined()
  })

  it('null truck type → falls back to city rate, no flat-pay audit row', async () => {
    const cap = installCapturingMock()
    await createDispatchOrder(baseInput({ truckTypeNeeded: undefined }))
    expect(cap.inserts.dispatch_orders?.[0].driver_pay_cents).toBe(5000)
    expect(cap.inserts.audit_logs?.find(r => r.action === 'dispatch.flat_pay_applied')).toBeUndefined()
  })

  it('FEATURE_FLAT_DRIVER_PAY=false → falls back to city rate even with tandem', async () => {
    process.env.FEATURE_FLAT_DRIVER_PAY = 'false'
    const cap = installCapturingMock()
    await createDispatchOrder(baseInput({ truckTypeNeeded: 'tandem_axle' }))
    expect(cap.inserts.dispatch_orders?.[0].driver_pay_cents).toBe(5000)
    expect(cap.inserts.audit_logs?.find(r => r.action === 'dispatch.flat_pay_applied')).toBeUndefined()
  })

  it('priceQuotedCents never leaks into driver_pay_cents', async () => {
    const cap = installCapturingMock()
    await createDispatchOrder(baseInput({ truckTypeNeeded: 'tandem_axle', priceQuotedCents: 99900 }))
    expect(cap.inserts.dispatch_orders?.[0].driver_pay_cents).toBe(3000)
    expect(cap.inserts.dispatch_orders?.[0].driver_pay_cents).not.toBe(99900)
  })

  it('writes BOTH audit_logs rows: dispatch_order.created AND dispatch.flat_pay_applied', async () => {
    const cap = installCapturingMock()
    await createDispatchOrder(baseInput({ truckTypeNeeded: 'end_dump' }))
    const actions = (cap.inserts.audit_logs || []).map(r => r.action)
    expect(actions).toContain('dispatch_order.created')
    expect(actions).toContain('dispatch.flat_pay_applied')
  })

  it('flat-pay audit row carries correct metadata shape', async () => {
    const cap = installCapturingMock()
    await createDispatchOrder(baseInput({ truckTypeNeeded: 'end_dump' }))
    const row = (cap.inserts.audit_logs || []).find(r => r.action === 'dispatch.flat_pay_applied')
    expect(row).toBeDefined()
    expect(row.entity_type).toBe('dispatch_order')
    expect(row.entity_id).toBe(ORDER_ID)
    expect(row.metadata.reason).toBe('flat_launch_v1')
    expect(row.metadata.truck_type_needed).toBe('end_dump')
    expect(row.metadata.driver_pay_cents).toBe(5000)
    expect(row.metadata.flag_enabled).toBe(true)
    expect(row.metadata.overridden_value_cents).toBe(5000) // Dallas default
  })
})
