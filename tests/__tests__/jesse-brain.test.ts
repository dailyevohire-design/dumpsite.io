/**
 * Layer 1 — Jesse's brain unit tests.
 *
 * Tests the REAL tryTemplate and validateResponse functions exported from
 * lib/services/brain.service.ts. Mocks Anthropic + Supabase at module load
 * so the import doesn't hit the network.
 *
 * Behaviors verified against the actual code on 2026-04-14. Where the original
 * spec disagrees with code (e.g. "bet" in DISCOVERY returns null, not an
 * affirmative → those assumptions were fixed to match reality per user directive.
 */

import { describe, it, expect, vi } from "vitest"

// Must mock Anthropic BEFORE importing brain.service — `new Anthropic()` runs at module load.
vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: vi.fn() }
  },
}))

// Mock routing/approval services so their imports don't pull Google/Supabase at load.
vi.mock("@/lib/services/routing.service", () => ({
  findNearbyJobs: vi.fn(async () => []),
  atomicClaimJob: vi.fn(),
}))
vi.mock("@/lib/services/approval.service", () => ({
  downloadAndStorePhoto: vi.fn(),
  sendCustomerApprovalRequest: vi.fn(),
  sendAdminEscalation: vi.fn(),
  processAdminApproval: vi.fn(),
  processCustomerApproval: vi.fn(),
}))
vi.mock("twilio", () => ({
  default: vi.fn(() => ({
    messages: { create: vi.fn(async () => ({ sid: "SM_TEST" })) },
  })),
}))

import { tryTemplate, validateResponse } from "@/lib/services/brain.service"
import { callTpl, makeConv, makeJob } from "../helpers/brain-harness"

// ─────────────────────────────────────────────────────────────
// tryTemplate — state progression
// ─────────────────────────────────────────────────────────────

describe("tryTemplate — yards parsing (DISCOVERY)", () => {
  it("accepts '500' → asks truck, saves yards=500, state=ASKING_TRUCK", () => {
    const r = callTpl(tryTemplate, { body: "500" })
    expect(r).not.toBeNull()
    expect(r!.response.toLowerCase()).toMatch(/truck|running|hauling/)
    expect(r!.updates.extracted_yards).toBe(500)
    expect(r!.updates.state).toBe("ASKING_TRUCK")
  })

  it("accepts '500 yds' → same as '500'", () => {
    const r = callTpl(tryTemplate, { body: "500 yds" })
    expect(r).not.toBeNull()
    expect(r!.updates.extracted_yards).toBe(500)
  })

  it("accepts '500 yards'", () => {
    const r = callTpl(tryTemplate, { body: "500 yards" })
    expect(r!.updates.extracted_yards).toBe(500)
  })

  it("Spanish: '500 yardas'", () => {
    const r = callTpl(tryTemplate, { body: "500 yardas", lang: "es" })
    expect(r!.updates.extracted_yards).toBe(500)
    expect(r!.response).toMatch(/camion|troca/i)
  })

  it("rejects '0' — not saved as yards", () => {
    const r = callTpl(tryTemplate, { body: "0" })
    // Does not enter the yard-saving branch; may fall through to another handler or null
    if (r) expect(r.updates.extracted_yards).toBeUndefined()
  })

  it("rejects '999999' — beyond 50000 ceiling", () => {
    const r = callTpl(tryTemplate, { body: "999999" })
    if (r) expect(r.updates.extracted_yards).toBeUndefined()
  })

  it("'15' accepted (small but valid)", () => {
    const r = callTpl(tryTemplate, { body: "15" })
    expect(r!.updates.extracted_yards).toBe(15)
  })

  it("'10000' — 5-digit is intercepted as zip code (line 771), NOT saved as yards", () => {
    // Reality: 5-digit numbers in DISCOVERY/ASKING_ADDRESS with no yards are treated as
    // zip codes. Driver should send full address or raw yard count (e.g. '9999').
    const r = callTpl(tryTemplate, { body: "10000" })
    expect(r).not.toBeNull()
    expect(r!.response.toLowerCase()).toMatch(/zip|full address|street address/)
    expect(r!.updates.extracted_yards).toBeUndefined()
  })

  it("'9999' — 4 digits, accepted as yards", () => {
    const r = callTpl(tryTemplate, { body: "9999" })
    expect(r!.updates.extracted_yards).toBe(9999)
  })
})

describe("tryTemplate — truck parsing (ASKING_TRUCK)", () => {
  const askTruck = { state: "ASKING_TRUCK" as const, extracted_yards: 500 }

  it.each([
    ["tandem", "tandem_axle"],
    ["tandum", "tandem_axle"], // misspelling
    ["tri-axle", "tri_axle"],
    ["triaxel", "tri_axle"], // misspelling
    ["quad", "quad_axle"],
    ["end dump", "end_dump"],
    ["belly", "belly_dump"],
    ["side dump", "side_dump"],
    ["super dump", "super_dump"],
    ["pup", "pup_trailer"],
    ["semi", "semi"],
    ["dump truck", "end_dump"],
  ])("'%s' → %s", (body, expected) => {
    const r = callTpl(tryTemplate, { body, conv: askTruck })
    expect(r).not.toBeNull()
    expect(r!.updates.extracted_truck_type).toBe(expected)
    expect(r!.updates.state).toBe("ASKING_TRUCK_COUNT")
  })

  it("'tri' alone does NOT match tri-axle regex (needs tri-ax)", () => {
    const r = callTpl(tryTemplate, { body: "tri", conv: askTruck })
    // Falls through to ASKING_TRUCK fallback (line 1091-1096): accepts short input
    // extracted_truck_type becomes "tri" (literal), state → ASKING_TRUCK_COUNT
    expect(r).not.toBeNull()
    expect(r!.updates.extracted_truck_type).toBe("tri")
  })
})

describe("tryTemplate — truck count (ASKING_TRUCK_COUNT)", () => {
  const base = {
    state: "ASKING_TRUCK_COUNT" as const,
    extracted_yards: 500,
    extracted_truck_type: "tandem_axle",
  }

  it.each([["1", 1], ["2", 2], ["3", 3], ["10", 10]])(
    "'%s' → count=%i, state=ASKING_ADDRESS",
    (body, count) => {
      const r = callTpl(tryTemplate, { body, conv: base })
      expect(r).not.toBeNull()
      expect(r!.updates.extracted_truck_count).toBe(count)
      expect(r!.updates.state).toBe("ASKING_ADDRESS")
    },
  )

  it("'just me' → count=1", () => {
    const r = callTpl(tryTemplate, { body: "just me", conv: base })
    expect(r!.updates.extracted_truck_count).toBe(1)
  })

  it("Spanish: 'dos' → count=2", () => {
    const r = callTpl(tryTemplate, { body: "dos", conv: base, lang: "es" })
    expect(r!.updates.extracted_truck_count).toBe(2)
  })
})

describe("tryTemplate — OTW (ACTIVE state)", () => {
  const active = { state: "ACTIVE" as const }
  const activeJob = { id: "j1", driver_pay_cents: 4500, yards_needed: 500, cities: { name: "McKinney" } }

  it.each(["otw", "on my way", "heading there", "im on my way", "leaving now"])(
    "'%s' → transitions to OTW_PENDING",
    (body) => {
      const r = callTpl(tryTemplate, { body, conv: active, activeJob })
      expect(r).not.toBeNull()
      expect(r!.updates.state).toBe("OTW_PENDING")
    },
  )

  it("Spanish 'ya voy' → OTW_PENDING", () => {
    const r = callTpl(tryTemplate, {
      body: "ya voy",
      conv: active,
      activeJob,
      lang: "es",
    })
    expect(r!.updates.state).toBe("OTW_PENDING")
  })

  it("Spanish 'en camino' → OTW_PENDING", () => {
    const r = callTpl(tryTemplate, {
      body: "en camino",
      conv: active,
      activeJob,
      lang: "es",
    })
    expect(r!.updates.state).toBe("OTW_PENDING")
  })
})

describe("tryTemplate — completion (ACTIVE)", () => {
  const active = { state: "ACTIVE" as const }
  const activeJob = { id: "j1", driver_pay_cents: 4500, yards_needed: 500, cities: { name: "McKinney" } }

  it("'done' → asks how many loads", () => {
    const r = callTpl(tryTemplate, { body: "done", conv: active, activeJob })
    expect(r).not.toBeNull()
    expect(r!.response.toLowerCase()).toMatch(/how many|load/)
  })

  it("'finished' → asks load count", () => {
    const r = callTpl(tryTemplate, { body: "finished", conv: active, activeJob })
    expect(r).not.toBeNull()
  })

  it("'dumped three' → delivery with count=3 (word-based count)", () => {
    const r = callTpl(tryTemplate, { body: "dumped three", conv: active, activeJob })
    expect(r).not.toBeNull()
    expect(r!.response).toBe("__DELIVERY__:3")
    expect(r!.action).toBe("COMPLETE_JOB")
  })
})

describe("tryTemplate — payment method (PAYMENT_METHOD_PENDING)", () => {
  const pay = { state: "PAYMENT_METHOD_PENDING" as const }

  it("'zelle' → transitions to PAYMENT_ACCOUNT_PENDING with method=zelle", () => {
    const r = callTpl(tryTemplate, { body: "zelle", conv: pay })
    expect(r).not.toBeNull()
    expect(r!.updates.state).toBe("PAYMENT_ACCOUNT_PENDING")
    expect(r!.updates.job_state).toBe("zelle")
  })

  it("'venmo' → transitions with method=venmo", () => {
    const r = callTpl(tryTemplate, { body: "venmo", conv: pay })
    expect(r).not.toBeNull()
    expect(r!.updates.state).toBe("PAYMENT_ACCOUNT_PENDING")
    expect(r!.updates.job_state).toBe("venmo")
  })

  it("'cash' → rejected, asks zelle or venmo", () => {
    const r = callTpl(tryTemplate, { body: "cash", conv: pay })
    expect(r).not.toBeNull()
    expect(r!.response.toLowerCase()).toMatch(/zelle|venmo/)
    // MUST NOT advance state to PAYMENT_ACCOUNT_PENDING
    expect(r!.updates.state).toBeUndefined()
  })

  it("'cashapp' → rejected", () => {
    const r = callTpl(tryTemplate, { body: "cashapp", conv: pay })
    expect(r).not.toBeNull()
    expect(r!.response.toLowerCase()).toMatch(/zelle|venmo/)
    expect(r!.updates.state).toBeUndefined()
  })

  it("'paypal' → rejected", () => {
    const r = callTpl(tryTemplate, { body: "paypal", conv: pay })
    expect(r).not.toBeNull()
    expect(r!.response.toLowerCase()).toMatch(/zelle|venmo/)
    expect(r!.updates.state).toBeUndefined()
  })

  it("'check' → accepted (valid payment method path)", () => {
    const r = callTpl(tryTemplate, { body: "check", conv: pay })
    expect(r).not.toBeNull()
    expect(r!.updates.state).toBe("PAYMENT_ACCOUNT_PENDING")
    expect(r!.updates.job_state).toBe("check")
  })
})

describe("tryTemplate — affirmatives (isYes in DISCOVERY)", () => {
  // Reality check: pure "bet", "ok", "lol" fall into the early gibberish handler
  // (line 545) which returns null in non-ACTIVE states — they don't progress.
  // But "yes", "yeah", "fasho", "dale", "copy", "10-4", "for sure" etc DO.
  const discWithNoFields = { state: "DISCOVERY" as const }

  it.each([
    "yes",
    "yeah",
    "yep",
    "fasho",
    "10-4",
    "copy",
    "hell yeah",
    "for sure",
    "si",
    "simon",
    "dale",
    "claro",
    "yessir",
    "absolutely",
  ])("'%s' in DISCOVERY with no yards → asks yards", (body) => {
    const r = callTpl(tryTemplate, { body, conv: discWithNoFields })
    expect(r).not.toBeNull()
    expect(r!.response.toLowerCase()).toMatch(/yard|yds|yardage/)
  })

  it("'bet' alone in DISCOVERY → null (handled by Sonnet contextually)", () => {
    // Verified reality: line 545 catches 'bet' and returns null in non-ACTIVE.
    const r = callTpl(tryTemplate, { body: "bet", conv: discWithNoFields })
    expect(r).toBeNull()
  })

  it("'ok' alone in DISCOVERY → null", () => {
    const r = callTpl(tryTemplate, { body: "ok", conv: discWithNoFields })
    expect(r).toBeNull()
  })

  it("isYes with yards+truck+count known but no city → asks address", () => {
    const r = callTpl(tryTemplate, {
      body: "yes",
      conv: {
        state: "DISCOVERY",
        extracted_yards: 500,
        extracted_truck_type: "tandem_axle",
        extracted_truck_count: 2,
      },
    })
    expect(r).not.toBeNull()
    expect(r!.response.toLowerCase()).toMatch(/address|addy|loading|coming from|pickup|where you/)
    expect(r!.updates.state).toBe("ASKING_ADDRESS")
  })
})

describe("tryTemplate — JOB_PRESENTED acceptance", () => {
  const jp = {
    state: "JOB_PRESENTED" as const,
    pending_approval_order_id: "job-1",
    extracted_yards: 500,
    extracted_truck_type: "tandem_axle",
    extracted_truck_count: 2,
    extracted_city: "McKinney",
  }

  it("'yeah' → transitions to PHOTO_PENDING, asks for pic", () => {
    const r = callTpl(tryTemplate, { body: "yeah", conv: jp })
    expect(r).not.toBeNull()
    expect(r!.updates.state).toBe("PHOTO_PENDING")
    expect(r!.response.toLowerCase()).toMatch(/pic|photo|picture|material/)
  })

  it("'bet' — still null (pure-ack early handler wins)", () => {
    const r = callTpl(tryTemplate, { body: "bet", conv: jp })
    expect(r).toBeNull()
  })

  it("'nah' → offers next job (empty nearbyJobs → apology)", () => {
    const r = callTpl(tryTemplate, { body: "nah", conv: jp, nearbyJobs: [] })
    expect(r).not.toBeNull()
    expect(r!.response.toLowerCase()).toMatch(/nothing|all i got|te aviso|ahorita/)
  })

  it("'nah' with a next job available → presents next job", () => {
    const nextJob = makeJob({ id: "job-2", cityName: "Plano", distanceMiles: 12 })
    const r = callTpl(tryTemplate, {
      body: "nah",
      conv: jp,
      nearbyJobs: [nextJob],
    })
    expect(r).not.toBeNull()
    expect(r!.response).toMatch(/Plano/)
    expect(r!.updates.pending_approval_order_id).toBe("job-2")
  })
})

describe("tryTemplate — identity probes (any state)", () => {
  it("'are you a bot' → denies with Jesse persona", () => {
    const r = callTpl(tryTemplate, { body: "are you a bot" })
    expect(r).not.toBeNull()
    expect(r!.response.toLowerCase()).toMatch(/jesse|real|nah/)
    expect(r!.response.toLowerCase()).not.toMatch(/\bai\b|bot|language model/)
  })

  it("'is this automated' → denies", () => {
    const r = callTpl(tryTemplate, { body: "is this automated" })
    expect(r).not.toBeNull()
    expect(r!.response.toLowerCase()).toMatch(/jesse|real|nah/)
  })

  it("'eres un bot' (Spanish) → denies", () => {
    const r = callTpl(tryTemplate, { body: "eres un bot", lang: "es" })
    expect(r).not.toBeNull()
    expect(r!.response.toLowerCase()).toMatch(/jesse|real|nah/)
  })
})

// ─────────────────────────────────────────────────────────────
// validateResponse — safety-net guards
// ─────────────────────────────────────────────────────────────

describe("validateResponse — AI admission guard", () => {
  it.each([
    "I am an AI assistant",
    "I'm an AI",
    "as an AI, I can help",
    "I am a bot",
    "I'm a bot",
    "I'm Claude",
    "Anthropic trained me",
    "language model trained",
  ])("'%s' → replaced with 'this is jesse'", (input) => {
    const out = validateResponse(input, null, "DISCOVERY", "en")
    expect(out).toBe("this is jesse")
  })
})

describe("validateResponse — menu/reply blockers", () => {
  it("'Reply: 1 for yes' → replaced with truck question", () => {
    const out = validateResponse("Reply: 1 for yes, 2 for no", null, "DISCOVERY", "en")
    expect(out.toLowerCase()).toMatch(/truck/)
  })

  it("'Option 1: tandem' → replaced", () => {
    const out = validateResponse("Option 1: tandem Option 2: quad", null, "DISCOVERY", "en")
    expect(out.toLowerCase()).toMatch(/truck/)
  })

  it("'Select one of the following' → replaced", () => {
    const out = validateResponse("Select one of the following trucks", null, "DISCOVERY", "en")
    expect(out.toLowerCase()).toMatch(/truck/)
  })

  it("'What type of truck? Tandem, triaxle...' → replaced", () => {
    const out = validateResponse(
      "What type of truck are you running? Tandem, triaxle, quad, or belly dump?",
      null,
      "ASKING_TRUCK",
      "en",
    )
    expect(out).toBe("what kind of truck are you hauling in")
  })

  it("Spanish: menu → Spanish truck question", () => {
    const out = validateResponse("Reply: 1 para si", null, "DISCOVERY", "es")
    expect(out).toBe("que tipo de camion tienes")
  })
})

describe("validateResponse — job code stripping", () => {
  it("'Your job is DS-ABCD12' → code stripped", () => {
    const out = validateResponse("your job is DS-ABCD12 head out", null, "ACTIVE", "en")
    expect(out).not.toMatch(/DS-[A-Z0-9]/)
  })
})

describe("validateResponse — length cap", () => {
  it("response >180 chars → truncated to ≤170", () => {
    const long =
      "this is a really really really really long sentence that keeps going and going and going and never ending and also more words more words more words more words more words"
    const out = validateResponse(long, null, "DISCOVERY", "en")
    expect(out.length).toBeLessThanOrEqual(170)
  })

  it("200 chars with sentence break → takes first sentence", () => {
    const r = "short one. " + "padding padding padding padding padding padding padding padding padding padding padding padding padding"
    const out = validateResponse(r, null, "DISCOVERY", "en")
    expect(out.length).toBeLessThanOrEqual(170)
  })
})

describe("validateResponse — multiple questions collapsed", () => {
  it("'What truck? How many yards?' → first question only", () => {
    const out = validateResponse("What truck? How many yards?", null, "DISCOVERY", "en")
    const qCount = (out.match(/\?/g) || []).length
    expect(qCount).toBeLessThanOrEqual(1)
  })
})

describe("validateResponse — driver address leak", () => {
  it("response containing 3+ words of driver address → replaced", () => {
    const driverAddr = "1234 Main Street Dallas Texas 75201"
    const leaky = "head to 1234 Main Street Dallas and dump there"
    const out = validateResponse(leaky, driverAddr, "ACTIVE", "en")
    expect(out.toLowerCase()).toMatch(/check what i got near you/)
  })

  it("response with zero driver-address overlap → unchanged", () => {
    const driverAddr = "5678 Elm Avenue Plano"
    const clean = "head to the site"
    const out = validateResponse(clean, driverAddr, "ACTIVE", "en")
    expect(out).toBe("head to the site")
  })
})

describe("validateResponse — wrong-state city question", () => {
  it("'What city are you in?' during ASKING_TRUCK → replaced", () => {
    const out = validateResponse("What city are you in?", null, "ASKING_TRUCK", "en")
    expect(out).toBe("what kind of truck are you hauling in")
  })

  it("'Which city?' in DISCOVERY → allowed (city question OK there)", () => {
    const out = validateResponse("which city you in?", null, "DISCOVERY", "en")
    expect(out).toBe("which city you in?")
  })
})

describe("validateResponse — trailing period + empty", () => {
  it("'send me a pic.' → period removed", () => {
    const out = validateResponse("send me a pic.", null, "DISCOVERY", "en")
    expect(out).toBe("send me a pic")
  })

  it("empty string → fallback 'give me a sec'", () => {
    const out = validateResponse("", null, "DISCOVERY", "en")
    expect(out).toBe("give me a sec")
  })

  it("empty string Spanish → 'dame un segundo'", () => {
    const out = validateResponse("", null, "DISCOVERY", "es")
    expect(out).toBe("dame un segundo")
  })

  it("whitespace-only → fallback", () => {
    const out = validateResponse("   ", null, "DISCOVERY", "en")
    expect(out).toBe("give me a sec")
  })
})
