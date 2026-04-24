import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockSupabase } from '../setup'
import { resolveReusableDispatchOrderId } from '@/lib/services/customer-brain.service'

describe('resolveReusableDispatchOrderId (QUOTING guard)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when dispatch_order_id is null', async () => {
    const result = await resolveReusableDispatchOrderId(null)
    expect(result).toBeNull()
    // No DB call should be made
    expect(mockSupabase.from).not.toHaveBeenCalled()
  })

  it('returns null when dispatch_order_id is undefined', async () => {
    const result = await resolveReusableDispatchOrderId(undefined)
    expect(result).toBeNull()
    expect(mockSupabase.from).not.toHaveBeenCalled()
  })

  it("reuses when referenced order exists with status='dispatching' (manual-entry happy path)", async () => {
    mockSupabase.maybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'order-abc', status: 'dispatching' },
      error: null,
    })
    const result = await resolveReusableDispatchOrderId('order-abc')
    expect(result).toBe('order-abc')
    expect(mockSupabase.from).toHaveBeenCalledWith('dispatch_orders')
    expect(mockSupabase.eq).toHaveBeenCalledWith('id', 'order-abc')
  })

  it("returns null when referenced order has status='completed' (fall through to createDispatchOrder)", async () => {
    mockSupabase.maybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'order-xyz', status: 'completed' },
      error: null,
    })
    const result = await resolveReusableDispatchOrderId('order-xyz')
    expect(result).toBeNull()
  })

  it("returns null when referenced order has status='cancelled'", async () => {
    mockSupabase.maybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'order-xyz', status: 'cancelled' },
      error: null,
    })
    const result = await resolveReusableDispatchOrderId('order-xyz')
    expect(result).toBeNull()
  })

  it('returns null when referenced order is missing (stale pointer)', async () => {
    mockSupabase.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const result = await resolveReusableDispatchOrderId('order-missing')
    expect(result).toBeNull()
  })
})
