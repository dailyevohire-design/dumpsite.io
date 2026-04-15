/**
 * Phase 12F — Enhanced validateResponse (Phase 5) tests.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create: vi.fn() } } }))
vi.mock("@/lib/services/routing.service", () => ({ findNearbyJobs: vi.fn(async () => []), atomicClaimJob: vi.fn() }))
vi.mock("@/lib/services/approval.service", () => ({
  downloadAndStorePhoto: vi.fn(), sendCustomerApprovalRequest: vi.fn(),
  sendAdminEscalation: vi.fn(), processAdminApproval: vi.fn(), processCustomerApproval: vi.fn(),
}))
vi.mock("twilio", () => ({ default: vi.fn(() => ({ messages: { create: vi.fn(async () => ({ sid: "SM" })) } })) }))

import { validateResponse } from "@/lib/services/brain.service"

describe("Phase 5A — corporate language filter", () => {
  it.each([
    "Certainly, I can help with that",
    "Absolutely I would be happy to assist",
    "Great question!",
    "Happy to help with your request",
    "Let me delve into that",
    "Rest assured",
    "I appreciate your patience",
    "Kindly provide the info",
    "Whilst we're at it",
  ])("'%s' → replaced with casual fallback", (input) => {
    const out = validateResponse(input, null, "DISCOVERY", "en")
    expect(out.toLowerCase()).toMatch(/copy that|dale pues/)
  })
})

describe("Phase 5B — emoji filter", () => {
  it("strips standard emoji", () => {
    expect(validateResponse("hey 👍 whats up", null, "DISCOVERY", "en")).not.toMatch(/[\u{1F300}-\u{1F9FF}]/u)
  })
  it("strips multiple emojis", () => {
    expect(validateResponse("🚛💪🎉 copy", null, "DISCOVERY", "en")).toBe("copy")
  })
  it("strips dingbats", () => {
    expect(validateResponse("✓ got it", null, "DISCOVERY", "en")).not.toMatch(/✓/)
  })
})

describe("Phase 5C — exclamation filter", () => {
  it("removes single !", () => {
    expect(validateResponse("yes!", null, "DISCOVERY", "en")).not.toContain("!")
  })
  it("removes multiple !", () => {
    expect(validateResponse("yes! sure!! def!!!", null, "DISCOVERY", "en")).not.toContain("!")
  })
})

describe("Phase 5D — duplicate word collapse", () => {
  it("'the the' → 'the'", () => {
    expect(validateResponse("the the truck", null, "DISCOVERY", "en")).toBe("the truck")
  })
  it("case-insensitive", () => {
    expect(validateResponse("What what you need", null, "DISCOVERY", "en")).toMatch(/^what you need$/i)
  })
})

describe("Phase 5E — markdown filter", () => {
  it("strips **bold**", () => {
    expect(validateResponse("**bold** here", null, "DISCOVERY", "en")).not.toContain("**")
  })
  it("strips *italic*", () => {
    expect(validateResponse("*italic* here", null, "DISCOVERY", "en")).not.toContain("*")
  })
  it("strips list markers", () => {
    const out = validateResponse("- item one", null, "DISCOVERY", "en")
    expect(out).not.toMatch(/^-/)
  })
})

describe("Phase 5F — contraction enforcement", () => {
  it.each([
    ["I am ready", /\bim\b/i],
    ["do not call", /\bdont\b/i],
    ["cannot do that", /\bcant\b/i],
    ["will not work", /\bwont\b/i],
    ["going to send", /\bgonna\b/i],
    ["want to help", /\bwanna\b/i],
    ["you all ready", /\byall\b/i],
  ])("'%s' → has %s", (input, regex) => {
    const out = validateResponse(input, null, "DISCOVERY", "en")
    expect(out).toMatch(regex)
  })
})

describe("Phase 5G — sentence case enforcement", () => {
  it("'Hey whats up' → 'hey whats up'", () => {
    expect(validateResponse("Hey whats up", null, "DISCOVERY", "en")).toBe("hey whats up")
  })
  it("preserves all-caps proper nouns (NRH, HEB)", () => {
    const out = validateResponse("NRH is close", null, "DISCOVERY", "en")
    expect(out.startsWith("NRH")).toBe(true)
  })
})

describe("Phase 5 integration — multiple filters stack", () => {
  it("emoji + ! + contraction + sentence case all apply", () => {
    const out = validateResponse("Hey! 👍 I am ready", null, "DISCOVERY", "en")
    // emoji stripped, ! stripped, contraction applied, first letter lowered
    expect(out).not.toContain("!")
    expect(out).not.toMatch(/[\u{1F300}-\u{1F9FF}]/u)
    expect(out).toMatch(/\bim\b/)
    expect(out[0]).toBe(out[0].toLowerCase())
  })
})
