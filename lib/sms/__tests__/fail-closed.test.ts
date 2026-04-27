import { describe, it, expect, vi, beforeEach } from "vitest"
import { withFailClosed } from "../fail-closed"

// Track the side-effects withFailClosed performs.
const updateMock = vi.fn().mockResolvedValue({ data: null, error: null })
const insertMock = vi.fn().mockResolvedValue({ data: null, error: null })

vi.mock("../../supabase", () => ({
  createAdminSupabase: () => ({
    from: (table: string) => ({
      update: (patch: any) => ({ eq: (_col: string, _val: any) => updateMock(table, patch) }),
      insert: (row: any) => insertMock(table, row),
    }),
  }),
}))

beforeEach(() => {
  updateMock.mockClear()
  insertMock.mockClear()
  delete process.env.FAIL_CLOSED_ENABLED
})

const onError = async () => "fallback-response"

describe("withFailClosed", () => {
  it("returns fn result when fn succeeds (no pause, no alert)", async () => {
    const result = await withFailClosed(
      "5551234567",
      async () => "ok",
      { onError, source: "test" },
    )
    expect(result).toBe("ok")
    expect(updateMock).not.toHaveBeenCalled()
    expect(insertMock).not.toHaveBeenCalled()
  })

  it("on sanitize error: pauses, alerts, returns fallback", async () => {
    const result = await withFailClosed(
      "5551234567",
      async () => {
        const e: any = new Error("Outbound blocked: contains forbidden internal marker: [RESCUE")
        e.name = "OutboundSanitizationError"
        throw e
      },
      { onError, source: "test-sanitizer" },
    )
    expect(result).toBe("fallback-response")
    expect(updateMock).toHaveBeenCalledWith("customer_conversations", {
      mode: "HUMAN_ACTIVE",
      needs_human_review: true,
    })
    expect(insertMock).toHaveBeenCalledWith("brain_alerts", expect.objectContaining({
      phone: "5551234567",
      alert_class: "fail_closed_pause",
      source: "test-sanitizer",
    }))
  })

  it("on Twilio 5xx (thrown): pauses + alerts + fallback", async () => {
    const result = await withFailClosed(
      "5551234567",
      async () => { throw new Error("Twilio 503 Service Unavailable") },
      { onError, source: "twilio-fail" },
    )
    expect(result).toBe("fallback-response")
    expect(insertMock).toHaveBeenCalledTimes(1)
  })

  it("on DB throw inside fn: pauses + alerts + fallback", async () => {
    const result = await withFailClosed(
      "5551234567",
      async () => { throw new Error("connection terminated unexpectedly") },
      { onError, source: "db-fail" },
    )
    expect(result).toBe("fallback-response")
    expect(updateMock).toHaveBeenCalled()
    expect(insertMock).toHaveBeenCalled()
  })

  it("on brain throw with empty message: still records and falls back", async () => {
    const result = await withFailClosed(
      "5551234567",
      async () => { throw new Error("") },
      { onError, source: "brain" },
    )
    expect(result).toBe("fallback-response")
    expect(insertMock).toHaveBeenCalledWith("brain_alerts", expect.objectContaining({
      error_message: "",
      source: "brain",
    }))
  })

  it("FAIL_CLOSED_ENABLED=false bypasses the wrapper (errors propagate)", async () => {
    process.env.FAIL_CLOSED_ENABLED = "false"
    await expect(
      withFailClosed(
        "5551234567",
        async () => { throw new Error("would be caught") },
        { onError, source: "test" },
      ),
    ).rejects.toThrow("would be caught")
    expect(updateMock).not.toHaveBeenCalled()
    expect(insertMock).not.toHaveBeenCalled()
  })
})
