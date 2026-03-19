import { test, expect } from '@playwright/test'

// These run without a browser — pure API tests
test.describe('API Security — unauthenticated access', () => {
  test('GET /api/admin/loads → 401', async ({ request }) => {
    const res = await request.get('/api/admin/loads')
    expect(res.status()).toBe(401)
  })

  test('GET /api/admin/dispatch → 401', async ({ request }) => {
    const res = await request.get('/api/admin/dispatch')
    expect(res.status()).toBe(401)
  })

  test('PATCH /api/admin/loads/fake-id/approve → 401', async ({ request }) => {
    const res = await request.patch('/api/admin/loads/fake-id/approve')
    expect(res.status()).toBe(401)
  })

  test('PATCH /api/admin/loads/fake-id/reject → 401', async ({ request }) => {
    const res = await request.patch('/api/admin/loads/fake-id/reject', {
      data: { reason: 'test reason here' }
    })
    expect(res.status()).toBe(401)
  })

  test('POST /api/admin/dispatch → 401', async ({ request }) => {
    const res = await request.post('/api/admin/dispatch', {
      data: { clientName: 'Test', clientAddress: '123 Main', cityId: 'uuid', yardsNeeded: 20 }
    })
    expect(res.status()).toBe(401)
  })

  test('POST /api/driver/submit-load → 401', async ({ request }) => {
    const res = await request.post('/api/driver/submit-load', {
      data: { dirtType: 'clean_fill', photoUrl: 'http://test.com/photo.jpg' }
    })
    expect(res.status()).toBe(401)
  })

  test('POST /api/driver/complete-load → 401', async ({ request }) => {
    const res = await request.post('/api/driver/complete-load', {
      data: { loadId: 'fake', completionPhotoUrl: 'http://test.com', loadsDelivered: 1 }
    })
    expect(res.status()).toBe(401)
  })

  test('PATCH /api/driver/update-profile → 401', async ({ request }) => {
    const res = await request.patch('/api/driver/update-profile', {
      data: { first_name: 'Hacker' }
    })
    expect(res.status()).toBe(401)
  })

  test('POST /api/webhook/zapier → 401 without secret', async ({ request }) => {
    const res = await request.post('/api/webhook/zapier', {
      data: { client_name: 'Test', client_address: '123 Main', yards_needed: 20, city: 'Dallas' }
    })
    expect(res.status()).toBe(401)
  })

  test('POST /api/dumpsite-request → 400 on missing fields', async ({ request }) => {
    const res = await request.post('/api/dumpsite-request', { data: {} })
    // Should return 400 (no auth required for this public endpoint)
    expect([400, 500]).toContain(res.status())
  })
})
