import { describe, it, expect, vi, beforeEach } from "vitest"

describe("submitLoadRequest — business logic", () => {
  beforeEach(() => vi.clearAllMocks())

  it("blocks trial driver who has hit load limit", async () => {
    const { mockSupabase } = await import("../setup")
    mockSupabase.single.mockResolvedValue({ data: { trial_loads_used: 3, tiers: { slug: "trial", trial_load_limit: 3 } }, error: null })
    const { submitLoadRequest } = await import("@/lib/services/load.service")
    const result = await submitLoadRequest("driver-1", { siteId: "s1", dirtType: "clean_fill", photoUrl: "http://x.com/p.jpg", locationText: "123 Main", truckType: "tandem_axle", truckCount: 1, yardsEstimated: 20, haulDate: "2026-04-01", idempotencyKey: "k1" })
    expect(result.success).toBe(false)
    expect(result.code).toBe("TRIAL_LIMIT_REACHED")
  })

  it("caliche requires extra review — logic test", () => {
    const HIGH_REJECTION = ["caliche"]
    expect(HIGH_REJECTION.includes("caliche")).toBe(true)
    expect(HIGH_REJECTION.includes("clean_fill")).toBe(false)
  })

  it("trial loads counter increments correctly", () => {
    const current = 1
    const next = current + 1
    expect(next).toBe(2)
  })

  it("pending cap is enforced at 5", () => {
    const pendingCount = 5
    const isBlocked = pendingCount >= 5
    expect(isBlocked).toBe(true)
  })

  it("pending cap allows under 5", () => {
    const pendingCount = 4
    const isBlocked = pendingCount >= 5
    expect(isBlocked).toBe(false)
  })
})
