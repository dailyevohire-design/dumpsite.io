/**
 * Phase 12E — Quality gate (Phase 7) tests.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create: vi.fn() } } }))
vi.mock("@/lib/services/routing.service", () => ({ findNearbyJobs: vi.fn(async () => []), atomicClaimJob: vi.fn() }))
vi.mock("@/lib/services/approval.service", () => ({
  downloadAndStorePhoto: vi.fn(), sendCustomerApprovalRequest: vi.fn(),
  sendAdminEscalation: vi.fn(), processAdminApproval: vi.fn(), processCustomerApproval: vi.fn(),
}))
vi.mock("twilio", () => ({ default: vi.fn(() => ({ messages: { create: vi.fn(async () => ({ sid: "SM" })) } })) }))

import { qualityGate, qualityGateFallback } from "@/lib/services/quality-gate.service"

const baseCtx = {
  state: "DISCOVERY",
  lang: "en" as const,
  hasActiveApprovedJob: false,
  history: [],
}

describe("qualityGate — PASS cases", () => {
  it("simple clean response passes", () => {
    expect(qualityGate("how many yards you got", baseCtx).pass).toBe(true)
  })
  it("Spanish clean response passes", () => {
    expect(qualityGate("cuantas yardas tienes", { ...baseCtx, lang: "es" }).pass).toBe(true)
  })
})

describe("qualityGate — FAIL cases", () => {
  it("empty response rejected", () => {
    const r = qualityGate("", baseCtx)
    expect(r.pass).toBe(false)
    expect(r.fallbackToTemplate).toBe(true)
  })

  it(">320 char response rejected", () => {
    const long = "x".repeat(350)
    expect(qualityGate(long, baseCtx).pass).toBe(false)
  })

  it("'Reply: 1 for yes' rejected as menu", () => {
    expect(qualityGate("Reply: 1 for yes", baseCtx).reason).toMatch(/menu/)
  })

  it("markdown rejected", () => {
    expect(qualityGate("**bold text** is here", baseCtx).pass).toBe(false)
  })

  it("dollar amount rejected", () => {
    expect(qualityGate("we pay $45 per load", baseCtx).reason).toMatch(/pay rate|dollar/i)
  })

  it("'per yard' rate rejected", () => {
    expect(qualityGate("5 per yard", baseCtx).pass).toBe(false)
  })

  it("AI admission rejected", () => {
    expect(qualityGate("I am an AI assistant", baseCtx).reason).toMatch(/AI admission/)
  })

  it("'claude' rejected", () => {
    expect(qualityGate("sorry, claude here", baseCtx).pass).toBe(false)
  })

  it("address leak without active job rejected", () => {
    expect(qualityGate("head to 1234 Main St Dallas", baseCtx).reason).toMatch(/address leak/)
  })

  it("address OK if driver has active approved job", () => {
    const r = qualityGate("head to 1234 Main St Dallas", { ...baseCtx, hasActiveApprovedJob: true })
    expect(r.pass).toBe(true)
  })

  it("greeting non-sequitur in ACTIVE rejected", () => {
    const r = qualityGate("hey", { ...baseCtx, state: "ACTIVE" })
    expect(r.pass).toBe(false)
  })

  it("repetition rejected when history has near-match", () => {
    const r = qualityGate("how many yards you got", {
      ...baseCtx,
      history: [{ role: "assistant", content: "how many yards you got today" }],
    })
    expect(r.pass).toBe(false)
    expect(r.reason).toMatch(/repetition|Levenshtein/i)
  })
})

describe("qualityGateFallback() — state-appropriate", () => {
  it.each([
    ["DISCOVERY", "en", /dirt|whats up/],
    ["ASKING_TRUCK", "en", /truck/],
    ["ASKING_TRUCK_COUNT", "en", /trucks/],
    ["ASKING_ADDRESS", "en", /address/],
    ["PAYMENT_METHOD_PENDING", "en", /zelle|venmo/],
    ["ACTIVE", "en", /10\.4/],
    ["DISCOVERY", "es", /tierra|onda/],
    ["ASKING_TRUCK", "es", /camion/],
  ])("%s/%s → matches %s", (state, lang, regex) => {
    expect(qualityGateFallback(state, lang as "en" | "es")).toMatch(regex)
  })

  it("unknown state → generic fallback", () => {
    expect(qualityGateFallback("NEVER_HEARD_OF_IT", "en")).toBe("give me a sec")
  })
})
