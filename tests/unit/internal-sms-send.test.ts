import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockSupabase } from '../setup'

const { mockSendSMSWithAgent } = vi.hoisted(() => ({
  mockSendSMSWithAgent: vi.fn(),
}))

// The route imports sendSMSWithAgent from customer-brain.service. We stub the
// whole module to avoid pulling Sarah's full dependency graph into the test.
vi.mock('@/lib/services/customer-brain.service', () => ({
  sendSMSWithAgent: mockSendSMSWithAgent,
  // Re-export symbols the route file doesn't need but the bundler may touch
}))

import { POST, GET, PUT, DELETE, PATCH } from '@/app/api/internal/sms/send/route'
import { NextRequest } from 'next/server'

const TOKEN = 'test-internal-token-abc123'
const AGENT_ID = '11111111-1111-4111-a111-111111111111'

function mkPost(headers: Record<string, string>, body: any): NextRequest {
  return new NextRequest('http://test.local/api/internal/sms/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

describe('/api/internal/sms/send', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.INTERNAL_SERVICE_TOKEN = TOKEN
  })

  it('non-POST methods return 405', async () => {
    expect((await GET()).status).toBe(405)
    expect((await PUT()).status).toBe(405)
    expect((await DELETE()).status).toBe(405)
    expect((await PATCH()).status).toBe(405)
  })

  it('no Authorization header → 401', async () => {
    const req = mkPost({}, {
      to_e164: '+12145550123', body: 'hi', agent_id: AGENT_ID, purpose: 'manual_order_confirmation',
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
    expect(mockSendSMSWithAgent).not.toHaveBeenCalled()
  })

  it('wrong Bearer token → 401 (timing-safe compare handles different lengths)', async () => {
    const req = mkPost({ authorization: 'Bearer WRONG-SHORTER' }, {
      to_e164: '+12145550123', body: 'hi', agent_id: AGENT_ID, purpose: 'manual_order_confirmation',
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('wrong Bearer token of same length → 401', async () => {
    const sameLength = 'x'.repeat(TOKEN.length)
    const req = mkPost({ authorization: `Bearer ${sameLength}` }, {
      to_e164: '+12145550123', body: 'hi', agent_id: AGENT_ID, purpose: 'manual_order_confirmation',
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('malformed to_e164 → 400 invalid_body', async () => {
    const req = mkPost({ authorization: `Bearer ${TOKEN}` }, {
      to_e164: '2145550123', body: 'hi', agent_id: AGENT_ID, purpose: 'manual_order_confirmation',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_body')
  })

  it('invalid agent_id (not in sales_agents) → 400 invalid_agent', async () => {
    mockSupabase.maybeSingle = vi.fn().mockResolvedValueOnce({ data: null, error: null })
    const req = mkPost({ authorization: `Bearer ${TOKEN}` }, {
      to_e164: '+12145550123', body: 'hi', agent_id: AGENT_ID, purpose: 'manual_order_confirmation',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_agent')
    expect(mockSendSMSWithAgent).not.toHaveBeenCalled()
  })

  it('opt-out short-circuit: returns 200 {sent:false,error:"opted_out"}, no Twilio', async () => {
    mockSupabase.maybeSingle = vi.fn()
      .mockResolvedValueOnce({ data: { id: AGENT_ID, twilio_number: '4692470556' }, error: null })
      .mockResolvedValueOnce({ data: { opted_out: true }, error: null })
    const req = mkPost({ authorization: `Bearer ${TOKEN}` }, {
      to_e164: '+12145550123', body: 'hi', agent_id: AGENT_ID, purpose: 'manual_order_confirmation',
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ sent: false, error: 'opted_out' })
    expect(mockSendSMSWithAgent).not.toHaveBeenCalled()
  })

  it('happy path: calls sendSMSWithAgent with server-resolved fromNumber, returns 200 sent:true', async () => {
    mockSupabase.maybeSingle = vi.fn()
      .mockResolvedValueOnce({ data: { id: AGENT_ID, twilio_number: '4692470556' }, error: null })
      .mockResolvedValueOnce({ data: { opted_out: false }, error: null })
    mockSendSMSWithAgent.mockResolvedValue({ sent: true, message_sid: 'SMtest' })
    const req = mkPost({ authorization: `Bearer ${TOKEN}` }, {
      to_e164: '+12145550123', body: 'hi', agent_id: AGENT_ID, purpose: 'manual_order_confirmation',
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ sent: true, message_sid: 'SMtest' })
    expect(mockSendSMSWithAgent).toHaveBeenCalledWith(
      '+12145550123',
      'hi',
      expect.stringMatching(/^manual_order_confirmation_\d+$/),
      '+14692470556',
      AGENT_ID,
    )
  })

  it('client-supplied fromNumber is ignored — server always uses agent.twilio_number', async () => {
    mockSupabase.maybeSingle = vi.fn()
      .mockResolvedValueOnce({ data: { id: AGENT_ID, twilio_number: '4692470556' }, error: null })
      .mockResolvedValueOnce({ data: { opted_out: false }, error: null })
    mockSendSMSWithAgent.mockResolvedValue({ sent: true, message_sid: 'SMtest' })
    // Pass an extra fromNumber field — body schema strips it, route never uses it
    const req = mkPost({ authorization: `Bearer ${TOKEN}` }, {
      to_e164: '+12145550123', body: 'hi', agent_id: AGENT_ID, purpose: 'manual_order_confirmation',
      fromNumber: '+19999999999',
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const callArgs = mockSendSMSWithAgent.mock.calls[0]
    expect(callArgs[3]).toBe('+14692470556') // server-resolved, not client-supplied
  })

  it('sendSMSWithAgent returns sent:false (Twilio down) → route returns 200 with error surfaced', async () => {
    mockSupabase.maybeSingle = vi.fn()
      .mockResolvedValueOnce({ data: { id: AGENT_ID, twilio_number: '4692470556' }, error: null })
      .mockResolvedValueOnce({ data: { opted_out: false }, error: null })
    mockSendSMSWithAgent.mockResolvedValue({ sent: false, error: 'Twilio 503' })
    const req = mkPost({ authorization: `Bearer ${TOKEN}` }, {
      to_e164: '+12145550123', body: 'hi', agent_id: AGENT_ID, purpose: 'manual_order_confirmation',
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ sent: false, error: 'Twilio 503' })
  })

  it('unexpected throw inside handler → 500 with generic error, no stack leak', async () => {
    mockSupabase.maybeSingle = vi.fn().mockImplementation(() => { throw new Error('boom') })
    const req = mkPost({ authorization: `Bearer ${TOKEN}` }, {
      to_e164: '+12145550123', body: 'hi', agent_id: AGENT_ID, purpose: 'manual_order_confirmation',
    })
    const res = await POST(req)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ sent: false, error: 'internal_error' })
    expect(JSON.stringify(body)).not.toContain('boom')
  })
})
