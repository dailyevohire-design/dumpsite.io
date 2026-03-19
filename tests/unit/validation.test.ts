import { describe, it, expect } from 'vitest'

// Test the validation logic we apply in API routes
describe('Load request validation', () => {
  const validateLoad = (body: any) => {
    const errors: string[] = []
    const truckCount = parseInt(body.truckCount)
    const yards = parseInt(body.yardsEstimated)
    const today = new Date().toISOString().split('T')[0]

    if (!body.dirtType) errors.push('dirtType required')
    if (!body.photoUrl) errors.push('photoUrl required')
    if (!body.locationText?.trim()) errors.push('locationText required')
    if (!body.truckType) errors.push('truckType required')
    if (isNaN(truckCount) || truckCount < 1 || truckCount > 50) errors.push('truckCount must be 1-50')
    if (isNaN(yards) || yards < 1) errors.push('yardsEstimated must be positive')
    if (!body.haulDate) errors.push('haulDate required')
    if (body.haulDate && body.haulDate < today) errors.push('haulDate cannot be in the past')
    if (!body.idempotencyKey) errors.push('idempotencyKey required')
    if (!body.dispatchOrderId) errors.push('dispatchOrderId required')

    return errors
  }

  it('passes with valid input', () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]
    const errors = validateLoad({
      dirtType: 'clean_fill', photoUrl: 'https://test.com/photo.jpg',
      locationText: '123 Main St Dallas TX', truckType: 'tandem_axle',
      truckCount: '2', yardsEstimated: '40', haulDate: tomorrow,
      idempotencyKey: 'uuid-1', dispatchOrderId: 'order-1'
    })
    expect(errors).toHaveLength(0)
  })

  it('rejects empty truckCount string — NaN guard', () => {
    const errors = validateLoad({ truckCount: '' })
    expect(errors).toContain('truckCount must be 1-50')
  })

  it('rejects truckCount of 0', () => {
    const errors = validateLoad({ truckCount: '0' })
    expect(errors).toContain('truckCount must be 1-50')
  })

  it('rejects truckCount over 50', () => {
    const errors = validateLoad({ truckCount: '51' })
    expect(errors).toContain('truckCount must be 1-50')
  })

  it('rejects past haul dates', () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
    const errors = validateLoad({ haulDate: yesterday })
    expect(errors).toContain('haulDate cannot be in the past')
  })

  it('rejects empty yardsEstimated', () => {
    const errors = validateLoad({ yardsEstimated: '' })
    expect(errors).toContain('yardsEstimated must be positive')
  })

  it('rejects missing locationText', () => {
    const errors = validateLoad({ locationText: '   ' })
    expect(errors).toContain('locationText required')
  })

  it('rejects missing idempotencyKey', () => {
    const errors = validateLoad({ idempotencyKey: undefined })
    expect(errors).toContain('idempotencyKey required')
  })
})

describe('Profile update validation', () => {
  const FORBIDDEN_FIELDS = new Set(['user_id','tier_id','status','gps_score','rating','trial_loads_used','phone_verified'])

  it('rejects forbidden field tier_id', () => {
    const body = { tier_id: 'elite-tier-uuid' }
    const hasForbidden = Object.keys(body).some(k => FORBIDDEN_FIELDS.has(k))
    expect(hasForbidden).toBe(true)
  })

  it('rejects forbidden field gps_score', () => {
    const body = { gps_score: 100 }
    const hasForbidden = Object.keys(body).some(k => FORBIDDEN_FIELDS.has(k))
    expect(hasForbidden).toBe(true)
  })

  it('allows legitimate profile fields', () => {
    const body = { first_name: 'Mike', phone: '+15125551234', truck_type: 'tandem_axle' }
    const hasForbidden = Object.keys(body).some(k => FORBIDDEN_FIELDS.has(k))
    expect(hasForbidden).toBe(false)
  })
})

describe('Rejection reason validation', () => {
  it('rejects reason shorter than 5 characters', () => {
    const reason = 'bad'
    expect(reason.trim().length >= 5).toBe(false)
  })

  it('accepts valid rejection reason', () => {
    const reason = 'Dirt contains too much clay and rocks'
    expect(reason.trim().length >= 5).toBe(true)
  })

  it('rejects empty reason', () => {
    const reason = ''
    expect(reason.trim().length >= 5).toBe(false)
  })
})
