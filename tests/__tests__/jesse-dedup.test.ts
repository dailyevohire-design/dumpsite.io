/**
 * Phase 12A — Anti-repetition (Phase 1) tests.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create: vi.fn() } } }))
vi.mock("@/lib/services/routing.service", () => ({ findNearbyJobs: vi.fn(async () => []), atomicClaimJob: vi.fn() }))
vi.mock("@/lib/services/approval.service", () => ({
  downloadAndStorePhoto: vi.fn(), sendCustomerApprovalRequest: vi.fn(),
  sendAdminEscalation: vi.fn(), processAdminApproval: vi.fn(), processCustomerApproval: vi.fn(),
}))
vi.mock("twilio", () => ({ default: vi.fn(() => ({ messages: { create: vi.fn(async () => ({ sid: "SM" })) } })) }))

import { similarity, isTooSimilar, pickNoRepeat, tryTemplate } from "@/lib/services/brain.service"
import { makeConv, makeProfile } from "../helpers/brain-harness"

describe("similarity()", () => {
  it("identical strings → 1.0", () => expect(similarity("hello", "hello")).toBe(1))
  it("totally different → low", () => expect(similarity("abc", "xyz")).toBeLessThan(0.5))
  it("case insensitive", () => expect(similarity("HELLO", "hello")).toBe(1))
  it("empty strings handled", () => expect(similarity("", "")).toBe(1))
})

describe("isTooSimilar()", () => {
  it("true when history has near-duplicate", () => {
    const history = [{ role: "assistant", content: "how many yards you got" }]
    expect(isTooSimilar("how many yards you got today", history, 0.7)).toBe(true)
  })
  it("false when no priors", () => {
    expect(isTooSimilar("anything", [], 0.7)).toBe(false)
  })
  it("only compares against assistant role", () => {
    const history = [{ role: "user", content: "how many yards you got" }]
    expect(isTooSimilar("how many yards you got", history, 0.7)).toBe(false)
  })
})

describe("pickNoRepeat()", () => {
  it("avoids options present in recent history", () => {
    const options = ["A", "B", "C"]
    const history = [{ role: "assistant", content: "A" }, { role: "assistant", content: "B" }]
    const picks = new Set<string>()
    for (let i = 0; i < 20; i++) picks.add(pickNoRepeat(options, history))
    expect(picks.has("C")).toBe(true)
    // "A" and "B" should NOT appear since they're in history
    expect(picks.has("A")).toBe(false)
    expect(picks.has("B")).toBe(false)
  })
  it("falls back to full pool when all used", () => {
    const options = ["X"]
    const history = [{ role: "assistant", content: "X" }]
    expect(pickNoRepeat(options, history)).toBe("X")
  })
  it("empty options → empty string", () => expect(pickNoRepeat([], [])).toBe(""))
})

describe("Expanded pick() arrays — no duplicate questions", () => {
  // Collect 50 responses for the 'yards' question path; verify we get multiple unique phrasings
  it("yards question produces ≥3 unique phrasings across 50 runs", () => {
    const responses = new Set<string>()
    for (let i = 0; i < 50; i++) {
      const r = tryTemplate(
        "yes",
        "yes",
        false,
        makeConv({ state: "DISCOVERY" }),
        makeProfile(),
        "en",
        [],
        null,
        false,
      )
      if (r) responses.add(r.response)
    }
    expect(responses.size).toBeGreaterThanOrEqual(3)
  })

  it("Spanish yards question also produces multiple phrasings", () => {
    const responses = new Set<string>()
    for (let i = 0; i < 50; i++) {
      const r = tryTemplate(
        "si",
        "si",
        false,
        makeConv({ state: "DISCOVERY" }),
        makeProfile(),
        "es",
        [],
        null,
        false,
      )
      if (r) responses.add(r.response)
    }
    expect(responses.size).toBeGreaterThanOrEqual(3)
  })

  it("truck question produces ≥3 unique phrasings", () => {
    const responses = new Set<string>()
    for (let i = 0; i < 50; i++) {
      const r = tryTemplate("500", "500", false, makeConv({ state: "DISCOVERY" }), makeProfile(), "en", [], null, false)
      if (r) responses.add(r.response)
    }
    expect(responses.size).toBeGreaterThanOrEqual(3)
  })

  it("address question produces ≥3 unique phrasings", () => {
    const responses = new Set<string>()
    for (let i = 0; i < 50; i++) {
      const r = tryTemplate(
        "2",
        "2",
        false,
        makeConv({
          state: "ASKING_TRUCK_COUNT",
          extracted_yards: 500,
          extracted_truck_type: "tandem_axle",
        }),
        makeProfile(),
        "en",
        [],
        null,
        false,
      )
      if (r) responses.add(r.response)
    }
    expect(responses.size).toBeGreaterThanOrEqual(3)
  })
})
