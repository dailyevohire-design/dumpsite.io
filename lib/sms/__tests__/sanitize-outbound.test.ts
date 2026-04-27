import { describe, it, expect } from "vitest"
import { sanitizeOutbound, sanitizeOutboundSafe, OutboundSanitizationError } from "../sanitize-outbound"

describe("sanitizeOutbound", () => {
  it("strips leading [RESCUE COLLECTING]", () => {
    expect(sanitizeOutbound("[RESCUE COLLECTING] Still happy to get you a quote!"))
      .toBe("Still happy to get you a quote!")
  })

  it("strips leading [RESCUE FOLLOW_UP]", () => {
    expect(sanitizeOutbound("[RESCUE FOLLOW_UP] Did you get a chance?"))
      .toBe("Did you get a chance?")
  })

  it("passes clean text untouched", () => {
    const m = "Christy, 20 yards of fill dirt to Garland runs $240"
    expect(sanitizeOutbound(m)).toBe(m)
  })

  it("throws on body that still contains forbidden marker mid-text", () => {
    expect(() => sanitizeOutbound("hey [RESCUE inside text"))
      .toThrowError(OutboundSanitizationError)
  })

  it("safe variant returns fallback on bad input", () => {
    expect(sanitizeOutboundSafe("[RESCUE inside", "thanks, we will follow up"))
      .toBe("thanks, we will follow up")
  })
})
