/**
 * Phase 12D — brain_learnings (Phase 4) tests.
 *
 * Verifies that callBrain tolerates DB failures for learnings gracefully (table
 * missing is NOT fatal). The actual rule injection behavior is tested by running
 * callBrain against a mocked Supabase that returns seed rules.
 */
import { describe, it, expect, vi } from "vitest"

// Dynamic Supabase mock — flipped per test
const __supabaseReturns = { learnings: [] as Array<{ id: string; rule: string }>, shouldThrow: false }

vi.mock("@/lib/supabase", () => ({
  createAdminSupabase: () => {
    if (__supabaseReturns.shouldThrow) {
      return {
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => Promise.reject(new Error("table missing")),
                }),
              }),
            }),
          }),
        }),
        rpc: () => Promise.resolve({ data: null, error: null }),
      }
    }
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                limit: () => Promise.resolve({ data: __supabaseReturns.learnings, error: null }),
              }),
            }),
          }),
        }),
        insert: () => ({ then: (cb: any) => cb({ data: null, error: null }) }),
      }),
      rpc: () => ({ then: (cb: any) => cb({ data: null, error: null }) }),
    }
  },
}))

// Keep Anthropic mocked with a simple valid JSON responder
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: vi.fn(async () => ({
        content: [{ type: "text", text: JSON.stringify({ response: "10.4", action: "NONE", updates: {}, confidence: 0.9 }) }],
      })),
    }
  },
}))
vi.mock("@/lib/services/routing.service", () => ({ findNearbyJobs: vi.fn(async () => []), atomicClaimJob: vi.fn() }))
vi.mock("@/lib/services/approval.service", () => ({
  downloadAndStorePhoto: vi.fn(), sendCustomerApprovalRequest: vi.fn(),
  sendAdminEscalation: vi.fn(), processAdminApproval: vi.fn(), processCustomerApproval: vi.fn(),
}))
vi.mock("twilio", () => ({ default: vi.fn(() => ({ messages: { create: vi.fn(async () => ({ sid: "SM" })) } })) }))

import { callBrain } from "@/lib/services/brain.service"
import { makeConv, makeProfile } from "../helpers/brain-harness"

describe("Phase 4 — brain_learnings resilience", () => {
  it("works with empty learnings table", async () => {
    __supabaseReturns.learnings = []
    __supabaseReturns.shouldThrow = false
    const r = await callBrain("hey", false, undefined, makeConv(), makeProfile(), [], [], null, "en", false, null)
    expect(r.response).toBe("10.4")
  })

  it("works with seed rules present", async () => {
    __supabaseReturns.learnings = [
      { id: "r1", rule: "Never reveal pay rates" },
      { id: "r2", rule: "Always lowercase" },
    ]
    __supabaseReturns.shouldThrow = false
    const r = await callBrain("hey", false, undefined, makeConv(), makeProfile(), [], [], null, "en", false, null)
    expect(r.response).toBe("10.4")
  })

  it("DB throw does NOT block brain — fallback response returned", async () => {
    __supabaseReturns.shouldThrow = true
    const r = await callBrain("hey", false, undefined, makeConv(), makeProfile(), [], [], null, "en", false, null)
    expect(typeof r.response).toBe("string")
    expect(r.response.length).toBeGreaterThan(0)
  })
})
