import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockSupabase } from '../setup'

// Hoist the Twilio stub so it's installed before customer-brain.service.ts
// evaluates `twilio(process.env.TWILIO_ACCOUNT_SID!, ...)` at module load.
const { mockMessagesCreate } = vi.hoisted(() => ({ mockMessagesCreate: vi.fn() }))

vi.mock('twilio', () => ({
  default: vi.fn(() => ({ messages: { create: mockMessagesCreate } })),
}))

import { sendSMSWithAgent } from '@/lib/services/customer-brain.service'

describe('sendSMSWithAgent', () => {
  const AGENT_ID = 'agent-uuid-xyz'
  const FROM = '+14692470556'

  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabase.insert = vi.fn().mockResolvedValue({ data: null, error: null })
  })

  it('synthetic test number short-circuits: no Twilio call, log row with agent_id, sent:true', async () => {
    const result = await sendSMSWithAgent('+15555550123', 'hello', 'sid-1', FROM, AGENT_ID)
    expect(result).toEqual({ sent: true, message_sid: 'synth_sid-1' })
    expect(mockMessagesCreate).not.toHaveBeenCalled()
    expect(mockSupabase.insert).toHaveBeenCalledWith(expect.objectContaining({
      phone: '5555550123',
      direction: 'outbound',
      message_sid: 'synth_sid-1',
      agent_id: AGENT_ID,
    }))
  })

  it('happy path: calls Twilio with fromNumber, logs outbound with message_sid + agent_id', async () => {
    mockMessagesCreate.mockResolvedValue({ sid: 'SMabc123' })
    const result = await sendSMSWithAgent('+12145550123', 'hello', 'sid-2', FROM, AGENT_ID)
    expect(result).toEqual({ sent: true, message_sid: 'SMabc123' })
    expect(mockMessagesCreate).toHaveBeenCalledWith({
      body: 'hello',
      from: FROM,
      to: '+12145550123',
    })
    expect(mockSupabase.insert).toHaveBeenCalledWith(expect.objectContaining({
      phone: '2145550123',
      direction: 'outbound',
      message_sid: 'SMabc123',
      agent_id: AGENT_ID,
    }))
  })

  it('Twilio throws: returns sent:false with error, logs error row with agent_id, never throws', async () => {
    mockMessagesCreate.mockRejectedValue(new Error('Invalid to phone'))
    const result = await sendSMSWithAgent('+12145550999', 'hello', 'sid-3', FROM, AGENT_ID)
    expect(result.sent).toBe(false)
    if (!result.sent) expect(result.error).toContain('Invalid to phone')
    expect(mockSupabase.insert).toHaveBeenCalledWith(expect.objectContaining({
      phone: '2145550999',
      direction: 'error',
      message_sid: null,
      agent_id: AGENT_ID,
    }))
  })
})
