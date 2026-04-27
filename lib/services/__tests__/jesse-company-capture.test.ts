import { describe, it, expect, vi, beforeEach } from "vitest"

// Capture supabase calls — tests need to verify RPC args, saveConv state, and brain_alerts inserts.
const rpcCalls: Array<{ name: string; args: any }> = []
const conversationUpserts: Array<Record<string, any>> = []
const brainAlertInserts: Array<Record<string, any>> = []

vi.mock("../../supabase", () => ({
  createAdminSupabase: () => ({
    rpc: (name: string, args: any) => {
      rpcCalls.push({ name, args })
      // upsert_conversation is what saveConv uses internally — capture state for assertions
      if (name === "upsert_conversation") {
        conversationUpserts.push(args)
      }
      return Promise.resolve({ data: null, error: null })
    },
    from: (table: string) => {
      if (table === "brain_alerts") {
        return {
          insert: (row: any) => {
            brainAlertInserts.push(row)
            return Promise.resolve({ data: null, error: null })
          },
        }
      }
      throw new Error(`unmocked table: ${table}`)
    },
  }),
}))

import {
  parseCompanyResponse,
  handleGettingCompany,
  _resetCompanyRetryForTesting,
} from "../brain.service"

beforeEach(() => {
  rpcCalls.length = 0
  conversationUpserts.length = 0
  brainAlertInserts.length = 0
  _resetCompanyRetryForTesting()
})

const baseConv = { extracted_yards: null, extracted_city: null }

describe("parseCompanyResponse", () => {
  it.each([
    ["no"],
    ["just me"],
    ["independent"],
    ["owner op"],
    ["owner-op"],
    ["owner operator"],
    ["n/a"],
    ["nope"],
    ["skip"],
  ])("classifies %s as skip", (input) => {
    expect(parseCompanyResponse(input)).toEqual({ kind: "skip", value: null })
  })

  it("classifies a real company name as name", () => {
    expect(parseCompanyResponse("Acme Trucking")).toEqual({ kind: "name", value: "Acme Trucking" })
  })

  it("collapses surrounding and internal whitespace", () => {
    expect(parseCompanyResponse("  Acme   Trucking  ")).toEqual({ kind: "name", value: "Acme Trucking" })
  })

  it("caps length at 100 chars", () => {
    const longName = "A".repeat(200)
    const result = parseCompanyResponse(longName)
    expect(result.kind).toBe("name")
    expect(result.value!.length).toBe(100)
  })

  it("classifies empty input as gibberish", () => {
    expect(parseCompanyResponse("")).toEqual({ kind: "gibberish", value: null })
    expect(parseCompanyResponse("   ")).toEqual({ kind: "gibberish", value: null })
  })

  it("classifies single char or all-digits as gibberish", () => {
    expect(parseCompanyResponse("x")).toEqual({ kind: "gibberish", value: null })
    expect(parseCompanyResponse("12345")).toEqual({ kind: "gibberish", value: null })
    expect(parseCompanyResponse("---")).toEqual({ kind: "gibberish", value: null })
  })

  it("classifies Spanish skip yo as skip", () => {
    expect(parseCompanyResponse("yo")).toEqual({ kind: "skip", value: null })
  })

  it("classifies a Spanish company name as name", () => {
    expect(parseCompanyResponse("Camiones Hernandez")).toEqual({ kind: "name", value: "Camiones Hernandez" })
  })

  it("treats 1-3 word answers containing skip keywords as skip", () => {
    expect(parseCompanyResponse("I'm independent")).toEqual({ kind: "skip", value: null })
    expect(parseCompanyResponse("just myself")).toEqual({ kind: "skip", value: null })
  })
})

describe("handleGettingCompany", () => {
  const PHONE = "5125550199"

  it("on skip: writes NULL via RPC, advances to DISCOVERY, returns greeting", async () => {
    const reply = await handleGettingCompany(PHONE, "no", baseConv, "Mike", false, "en")
    expect(rpcCalls.find(c => c.name === "update_driver_company")).toEqual({
      name: "update_driver_company",
      args: { p_phone: PHONE, p_company_name: null },
    })
    expect(conversationUpserts).toHaveLength(1)
    expect(conversationUpserts[0].p_state).toBe("DISCOVERY")
    expect(reply).toContain("Mike got you")
    expect(brainAlertInserts).toHaveLength(0)
  })

  it("on real name: writes value via RPC, advances to DISCOVERY, returns greeting", async () => {
    const reply = await handleGettingCompany(PHONE, "Acme Trucking", baseConv, "Mike", false, "en")
    expect(rpcCalls.find(c => c.name === "update_driver_company")?.args).toEqual({
      p_phone: PHONE,
      p_company_name: "Acme Trucking",
    })
    expect(conversationUpserts[0].p_state).toBe("DISCOVERY")
    expect(reply).toContain("Mike got you")
  })

  it("on first gibberish: re-asks and stays in GETTING_COMPANY (no RPC, no advance)", async () => {
    const reply = await handleGettingCompany(PHONE, "?!", baseConv, "Mike", false, "en")
    expect(rpcCalls.find(c => c.name === "update_driver_company")).toBeUndefined()
    expect(conversationUpserts).toHaveLength(0)
    expect(brainAlertInserts).toHaveLength(0)
    expect(reply.toLowerCase()).toContain("what company")
  })

  it("on second gibberish: writes brain_alert, NULL via RPC, advances to DISCOVERY", async () => {
    await handleGettingCompany(PHONE, "?!", baseConv, "Mike", false, "en")
    const reply = await handleGettingCompany(PHONE, "????", baseConv, "Mike", false, "en")
    expect(brainAlertInserts).toHaveLength(1)
    expect(brainAlertInserts[0]).toMatchObject({
      phone: PHONE,
      alert_class: "COMPANY_CAPTURE_FAILED",
      source: "getting_company",
    })
    expect(rpcCalls.find(c => c.name === "update_driver_company")?.args).toEqual({
      p_phone: PHONE,
      p_company_name: null,
    })
    expect(conversationUpserts.at(-1)?.p_state).toBe("DISCOVERY")
    expect(reply).toContain("Mike got you")
  })

  it("Spanish skip yo: writes NULL, advances, returns Spanish greeting", async () => {
    const reply = await handleGettingCompany(PHONE, "yo", baseConv, "Miguel", false, "es")
    expect(rpcCalls.find(c => c.name === "update_driver_company")?.args).toEqual({
      p_phone: PHONE,
      p_company_name: null,
    })
    expect(conversationUpserts[0].p_state).toBe("DISCOVERY")
    expect(reply).toContain("Miguel te tengo")
    expect(reply).toContain("Tienes tierra hoy")
  })

  it("Spanish real company: captured, advances, returns Spanish greeting", async () => {
    const reply = await handleGettingCompany(PHONE, "Camiones Hernandez", baseConv, "Miguel", false, "es")
    expect(rpcCalls.find(c => c.name === "update_driver_company")?.args).toEqual({
      p_phone: PHONE,
      p_company_name: "Camiones Hernandez",
    })
    expect(conversationUpserts[0].p_state).toBe("DISCOVERY")
    expect(reply).toContain("Miguel te tengo")
  })

  it("greeting acknowledges yds/city if extracted earlier in flow", async () => {
    const reply = await handleGettingCompany(
      PHONE, "Acme Trucking",
      { extracted_yards: 200, extracted_city: "Dallas" },
      "Mike", false, "en",
    )
    expect(reply).toContain("200 yds")
    expect(reply).toContain("in Dallas")
  })

  it("after-hours greeting differs from in-hours greeting", async () => {
    const replyDay = await handleGettingCompany(PHONE, "no", baseConv, "Mike", false, "en")
    _resetCompanyRetryForTesting(PHONE)
    const replyNight = await handleGettingCompany(PHONE, "no", baseConv, "Mike", true, "en")
    expect(replyDay).toContain("You got dirt today")
    expect(replyNight).toContain("off for the night")
  })

  it("retry counter clears after a successful capture", async () => {
    await handleGettingCompany(PHONE, "?!", baseConv, "Mike", false, "en")
    await handleGettingCompany(PHONE, "Acme Trucking", baseConv, "Mike", false, "en")
    // After a real answer, retry state must be cleared so a future GETTING_COMPANY
    // session for this phone (e.g. after resetConv) doesn't inherit the count.
    rpcCalls.length = 0
    conversationUpserts.length = 0
    brainAlertInserts.length = 0
    const reply = await handleGettingCompany(PHONE, "?!", baseConv, "Mike", false, "en")
    // Should be treated as the FIRST gibberish, not the second — so no alert yet
    expect(brainAlertInserts).toHaveLength(0)
    expect(rpcCalls.find(c => c.name === "update_driver_company")).toBeUndefined()
    expect(reply.toLowerCase()).toContain("what company")
  })
})
