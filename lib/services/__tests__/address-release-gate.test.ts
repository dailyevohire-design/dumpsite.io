import { describe, it, expect, vi, beforeEach } from "vitest"

let mockConversationStateRow: { state: string | null } | null = null
const insertCalls: Array<{ table: string; row: any }> = []

vi.mock("../../supabase", () => ({
  createAdminSupabase: () => ({
    from: (table: string) => {
      if (table === "conversations") {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: any) => ({
              maybeSingle: async () => ({ data: mockConversationStateRow, error: null }),
            }),
          }),
        }
      }
      if (table === "brain_alerts") {
        return {
          insert: (row: any) => {
            insertCalls.push({ table, row })
            return Promise.resolve({ data: null, error: null })
          },
        }
      }
      throw new Error(`unmocked table: ${table}`)
    },
  }),
}))

import { assertAddressReleaseAllowed, AddressReleaseBlocked } from "../brain.service"

beforeEach(() => {
  mockConversationStateRow = null
  insertCalls.length = 0
})

describe("assertAddressReleaseAllowed", () => {
  it("resolves silently when current state matches one of expectedStates", async () => {
    mockConversationStateRow = { state: "APPROVAL_PENDING" }
    await expect(
      assertAddressReleaseAllowed("5125550100", ["APPROVAL_PENDING"], "unit-test", "order-1"),
    ).resolves.toBeUndefined()
    expect(insertCalls).toHaveLength(0)
  })

  it("resolves silently when current state matches any state in expectedStates", async () => {
    mockConversationStateRow = { state: "PHOTO_PENDING" }
    await expect(
      assertAddressReleaseAllowed("5125550100", ["APPROVAL_PENDING", "PHOTO_PENDING"], "unit-test", "order-1"),
    ).resolves.toBeUndefined()
    expect(insertCalls).toHaveLength(0)
  })

  it("throws AddressReleaseBlocked + writes brain_alerts when state does not match", async () => {
    mockConversationStateRow = { state: "DISCOVERY" }
    await expect(
      assertAddressReleaseAllowed("5125550100", ["APPROVAL_PENDING"], "unit-test", "order-1"),
    ).rejects.toBeInstanceOf(AddressReleaseBlocked)

    expect(insertCalls).toHaveLength(1)
    expect(insertCalls[0].table).toBe("brain_alerts")
    expect(insertCalls[0].row).toMatchObject({
      phone: "5125550100",
      alert_class: "ADDRESS_RELEASE_BLOCKED",
      source: "unit-test",
    })
    expect(insertCalls[0].row.error_message).toContain("DISCOVERY")
  })

  it("fail-safe: throws when conversation row is missing entirely", async () => {
    mockConversationStateRow = null
    await expect(
      assertAddressReleaseAllowed("5125550100", ["ACTIVE", "OTW_PENDING"], "unit-test", "order-9"),
    ).rejects.toBeInstanceOf(AddressReleaseBlocked)
    expect(insertCalls).toHaveLength(1)
    expect(insertCalls[0].row.error_message).toContain("null")
  })

  it("fail-safe: throws when state column is null on the row", async () => {
    mockConversationStateRow = { state: null }
    await expect(
      assertAddressReleaseAllowed("5125550100", ["ACTIVE"], "unit-test", null),
    ).rejects.toBeInstanceOf(AddressReleaseBlocked)
    expect(insertCalls).toHaveLength(1)
  })

  it("AddressReleaseBlocked carries the diagnostic fields", async () => {
    mockConversationStateRow = { state: "DISCOVERY" }
    try {
      await assertAddressReleaseAllowed("5125550100", ["APPROVAL_PENDING", "PHOTO_PENDING"], "admin_approve", "order-7")
      throw new Error("expected throw")
    } catch (err: any) {
      expect(err).toBeInstanceOf(AddressReleaseBlocked)
      expect(err.driverPhone).toBe("5125550100")
      expect(err.currentState).toBe("DISCOVERY")
      expect(err.expectedStates).toEqual(["APPROVAL_PENDING", "PHOTO_PENDING"])
      expect(err.callerName).toBe("admin_approve")
      expect(err.orderId).toBe("order-7")
      expect(err.name).toBe("AddressReleaseBlocked")
      expect(err.message).toContain("driver 5125550100")
      expect(err.message).toContain("state DISCOVERY")
    }
  })
})
