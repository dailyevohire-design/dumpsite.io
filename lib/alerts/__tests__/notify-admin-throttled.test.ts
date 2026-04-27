import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Twilio mock — capture every send so each test can assert call counts ──
const sendMock = vi.fn().mockResolvedValue({ sid: "SMtest123" })
vi.mock("twilio", () => ({
  default: () => ({
    messages: { create: (args: unknown) => sendMock(args) },
  }),
}))

// ── Supabase mock — capture rpc + insert calls and let each test override
//    the rpc return so we can simulate cooled_down / send paths.            ──
const rpcMock = vi.fn()
const insertMock = vi.fn().mockResolvedValue({ error: null })

vi.mock("../../supabase", () => ({
  createAdminSupabase: () => ({
    rpc: (name: string, args: unknown) => rpcMock(name, args),
    from: (_table: string) => {
      void _table
      return { insert: (row: unknown) => insertMock(row) }
    },
  }),
}))

// notifyAdminThrottled is imported lazily inside each test after env is set.
async function loadFn() {
  const mod = await import("../notify-admin-throttled")
  return mod.notifyAdminThrottled
}

beforeEach(() => {
  vi.resetModules()
  sendMock.mockClear()
  rpcMock.mockReset()
  insertMock.mockClear()
  process.env.ADMIN_PHONE = "+13037040845"
  process.env.ADMIN_PHONE_2 = ""
  process.env.TWILIO_ACCOUNT_SID = "ACtest"
  process.env.TWILIO_AUTH_TOKEN = "secret"
  process.env.TWILIO_FROM_NUMBER_2 = "+18005551212"
  delete process.env.PAUSE_ADMIN_SMS
})

describe("notifyAdminThrottled", () => {
  it("first call within fresh (class, phone) → sent=true and Twilio fires", async () => {
    rpcMock.mockResolvedValueOnce({ data: true, error: null })
    const notifyAdminThrottled = await loadFn()
    const res = await notifyAdminThrottled("brain_error", "+15551234567", "Test alert", { source: "test" })
    expect(res.sent).toBe(true)
    expect(res.reason).toBe("sent")
    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      to: "+13037040845",
      body: expect.stringContaining("[brain_error] Test alert"),
    }))
  })

  it("second call with same (class, phone) → cooled_down, no Twilio send", async () => {
    rpcMock.mockResolvedValueOnce({ data: false, error: null })
    const notifyAdminThrottled = await loadFn()
    const res = await notifyAdminThrottled("brain_error", "+15551234567", "Repeat alert")
    expect(res.sent).toBe(false)
    expect(res.reason).toBe("cooled_down")
    expect(sendMock).not.toHaveBeenCalled()
  })

  it("same class, different phone → still sends (per-pair, not per-class)", async () => {
    rpcMock.mockResolvedValueOnce({ data: true, error: null })
    const notifyAdminThrottled = await loadFn()
    const res = await notifyAdminThrottled("brain_error", "+15559999999", "Different customer")
    expect(res.sent).toBe(true)
    expect(sendMock).toHaveBeenCalledTimes(1)
    // RPC was invoked with the new phone, not the cooled-down one
    expect(rpcMock).toHaveBeenCalledWith("should_notify_admin", expect.objectContaining({
      p_phone: "+15559999999",
    }))
  })

  it("bypassCooldown=true skips RPC, inserts audit row, always sends", async () => {
    const notifyAdminThrottled = await loadFn()
    const res = await notifyAdminThrottled("cron_daily_summary", "system", "Digest body", {
      bypassCooldown: true,
      source: "cron:daily-summary",
    })
    expect(res.sent).toBe(true)
    expect(res.reason).toBe("bypassed")
    expect(rpcMock).not.toHaveBeenCalled()
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
      alert_class: "cron_daily_summary",
      phone: "system",
      source: "cron:daily-summary",
    }))
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it("cooldownMinutes override is forwarded to the RPC", async () => {
    rpcMock.mockResolvedValueOnce({ data: true, error: null })
    const notifyAdminThrottled = await loadFn()
    await notifyAdminThrottled("cron_sms_healthcheck", "system", "Healthcheck", {
      cooldownMinutes: 240,
    })
    expect(rpcMock).toHaveBeenCalledWith("should_notify_admin", expect.objectContaining({
      p_alert_class: "cron_sms_healthcheck",
      p_cooldown_minutes: 240,
    }))
  })

  it("PAUSE_ADMIN_SMS=true short-circuits, no RPC, no Twilio", async () => {
    process.env.PAUSE_ADMIN_SMS = "true"
    const notifyAdminThrottled = await loadFn()
    const res = await notifyAdminThrottled("brain_error", "+15551234567", "Paused")
    expect(res.sent).toBe(false)
    expect(res.reason).toBe("paused")
    expect(rpcMock).not.toHaveBeenCalled()
    expect(sendMock).not.toHaveBeenCalled()
  })

  it("missing alertClass or phone → missing_args, no side effects", async () => {
    const notifyAdminThrottled = await loadFn()
    const res1 = await notifyAdminThrottled("", "+15551234567", "no class")
    const res2 = await notifyAdminThrottled("brain_error", "", "no phone")
    expect(res1.reason).toBe("missing_args")
    expect(res2.reason).toBe("missing_args")
    expect(rpcMock).not.toHaveBeenCalled()
    expect(sendMock).not.toHaveBeenCalled()
  })
})
