/**
 * Layer 2 — Multi-turn conversation integration tests.
 *
 * Uses tryTemplate as a state-machine simulator. The harness threads updates between
 * turns so each turn sees the state produced by the previous one. This verifies the
 * deterministic qualification + payment flow.
 *
 * For pay-rate probing (Sonnet-invoking), we verify that tryTemplate either handles
 * it safely or returns null (letting Sonnet respond). In either case, the returned
 * response MUST NEVER contain dollar amounts or rate language.
 */

import { describe, it, expect, vi } from "vitest"

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: vi.fn() }
  },
}))
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

import { tryTemplate } from "@/lib/services/brain.service"
import { makeConv, makeProfile, makeJob, makeActiveJob, type Lang } from "../helpers/brain-harness"

// ─────────────────────────────────────────────────────────────
// Conversation runner — threads state between turns
// ─────────────────────────────────────────────────────────────

interface Turn {
  body: string
  expectNull?: boolean
  expectResponseRegex?: RegExp
  expectState?: string
  expectUpdates?: Record<string, any>
  mustNotContainRegex?: RegExp
  nearbyJobs?: any[]
  activeJob?: any
  hasPhoto?: boolean
}

interface ConvoOpts {
  lang?: Lang
  profile?: any
  initialConv?: any
  nearbyJobs?: any[]
  activeJob?: any
  isKnownDriver?: boolean
}

function runConversation(turns: Turn[], opts: ConvoOpts = {}) {
  let conv = makeConv(opts.initialConv || {})
  const profile = makeProfile(opts.profile || {})
  const lang = opts.lang ?? "en"
  const history: Array<{ turn: number; body: string; result: any; state: string }> = []

  turns.forEach((turn, i) => {
    const result = tryTemplate(
      turn.body,
      turn.body.toLowerCase(),
      turn.hasPhoto ?? false,
      conv,
      profile,
      lang,
      turn.nearbyJobs ?? opts.nearbyJobs ?? [],
      turn.activeJob ?? opts.activeJob ?? null,
      opts.isKnownDriver ?? false,
    )

    history.push({ turn: i, body: turn.body, result, state: conv.state })

    if (turn.expectNull) {
      expect(result, `Turn ${i} '${turn.body}' expected null (Sonnet delegation)`).toBeNull()
      return
    }

    expect(result, `Turn ${i} '${turn.body}' returned null unexpectedly`).not.toBeNull()

    if (turn.expectResponseRegex) {
      expect(
        result!.response,
        `Turn ${i} response '${result!.response}' did not match ${turn.expectResponseRegex}`,
      ).toMatch(turn.expectResponseRegex)
    }

    if (turn.mustNotContainRegex) {
      expect(
        result!.response,
        `Turn ${i} response '${result!.response}' contains forbidden pattern`,
      ).not.toMatch(turn.mustNotContainRegex)
    }

    if (turn.expectUpdates) {
      for (const [k, v] of Object.entries(turn.expectUpdates)) {
        expect(result!.updates[k], `Turn ${i} updates.${k}`).toEqual(v)
      }
    }

    // Apply updates to conv for next turn
    conv = { ...conv, ...result!.updates }
    if (turn.expectState) {
      expect(conv.state, `Turn ${i} state`).toBe(turn.expectState)
    }
  })

  return { conv, history }
}

// ─────────────────────────────────────────────────────────────
// Conversation 1 — Happy Path English (through deterministic section)
// ─────────────────────────────────────────────────────────────

describe("Conversation 1 — Happy Path English", () => {
  it("hey → 500 → tandem → 2 → [mckinney] progression works", () => {
    const mcJob = makeJob({ cityName: "McKinney", distanceMiles: 8 })
    runConversation(
      [
        // "hey" alone in DISCOVERY with zero fields hits first-message greeting
        { body: "hey", expectResponseRegex: /dirt|material|haul|today|load/i },
        // "500" → saves yards, asks truck
        {
          body: "500",
          expectResponseRegex: /truck|running|hauling/i,
          expectState: "ASKING_TRUCK",
          expectUpdates: { extracted_yards: 500 },
        },
        // "tandem" → saves truck_type, asks count
        {
          body: "tandem",
          expectResponseRegex: /trucks?|how many|running/i,
          expectState: "ASKING_TRUCK_COUNT",
          expectUpdates: { extracted_truck_type: "tandem_axle" },
        },
        // "2" → count=2, asks address
        {
          body: "2",
          expectResponseRegex: /address|addy|loading|coming from|pickup|where you/i,
          expectState: "ASKING_ADDRESS",
          expectUpdates: { extracted_truck_count: 2 },
        },
        // Driver gives address with street → presents nearest job
        {
          body: "1234 Main St McKinney",
          nearbyJobs: [mcJob],
          expectResponseRegex: /McKinney|miles|yds/,
          expectState: "JOB_PRESENTED",
        },
        // "yeah" accepts → PHOTO_PENDING
        {
          body: "yeah",
          expectResponseRegex: /pic|photo|picture|material/i,
          expectState: "PHOTO_PENDING",
        },
      ],
      { nearbyJobs: [mcJob] },
    )
  })

  it("OTW → completion flow from ACTIVE", () => {
    const activeJob = makeActiveJob()
    runConversation(
      [
        {
          body: "otw",
          expectResponseRegex: /10\.?4|let me know|lmk|copy|got it|bet|hit me up|holler|text me/i,
          expectState: "OTW_PENDING",
          activeJob,
        },
        // From OTW, "dumped three" → delivery
        {
          body: "dumped three",
          expectResponseRegex: /__DELIVERY__:3/,
          activeJob,
        },
      ],
      { initialConv: { state: "ACTIVE", active_order_id: activeJob.id }, activeJob },
    )
  })

  it("zelle → account info flow in PAYMENT_METHOD_PENDING", () => {
    runConversation([
      {
        body: "zelle",
        expectResponseRegex: /zelle|name|number/i,
        expectState: "PAYMENT_ACCOUNT_PENDING",
        expectUpdates: { job_state: "zelle" },
      },
      {
        body: "John Doe 2145551234",
        expectResponseRegex: /shortly|rato|got it/i,
        expectState: "CLOSED",
      },
    ], {
      initialConv: { state: "PAYMENT_METHOD_PENDING" },
    })
  })
})

// ─────────────────────────────────────────────────────────────
// Conversation 2 — Happy Path Spanish (bilingual parity)
// ─────────────────────────────────────────────────────────────

describe("Conversation 2 — Happy Path Spanish", () => {
  it("all responses in Spanish across qualification", () => {
    runConversation(
      [
        { body: "300 yardas", expectResponseRegex: /camion|troca/i, expectUpdates: { extracted_yards: 300 } },
        { body: "tandem", expectResponseRegex: /camion|troca|cuantos|cuantas/i, expectUpdates: { extracted_truck_type: "tandem_axle" } },
        { body: "1", expectResponseRegex: /direccion|cargar|cargan|salen|vienen|donde/i, expectUpdates: { extracted_truck_count: 1 } },
      ],
      { lang: "es", profile: { first_name: "Carlos" } },
    )
  })

  it("Spanish venmo flow", () => {
    runConversation(
      [
        {
          body: "venmo",
          expectResponseRegex: /venmo/i,
          expectUpdates: { job_state: "venmo" },
          expectState: "PAYMENT_ACCOUNT_PENDING",
        },
      ],
      { lang: "es", initialConv: { state: "PAYMENT_METHOD_PENDING" } },
    )
  })
})

// ─────────────────────────────────────────────────────────────
// Conversation 3 — Compound / everything-at-once
// ─────────────────────────────────────────────────────────────

describe("Conversation 3 — compound messages", () => {
  it("'I got 300 yds of fill in a tandem' → extracts yards + truck, asks next missing", () => {
    const r = tryTemplate(
      "I got 300 yds of fill in a tandem coming from mckinney",
      "i got 300 yds of fill in a tandem coming from mckinney",
      false,
      makeConv({ state: "DISCOVERY" }),
      makeProfile(),
      "en",
      [],
      null,
      false,
    )
    // Compound handler catches >50 chars + DISCOVERY + no yards + yard match
    // Extracts what it can, asks next missing field
    expect(r).not.toBeNull()
    expect(r!.updates.extracted_yards).toBe(300)
    expect(r!.updates.extracted_truck_type).toBe("tandem_axle")
  })
})

// ─────────────────────────────────────────────────────────────
// Conversation 4 — Off-topic handling
// ─────────────────────────────────────────────────────────────

describe("Conversation 4 — off-topic", () => {
  it("'are you a bot' → denies in-character (any state)", () => {
    const r = tryTemplate(
      "are you a bot",
      "are you a bot",
      false,
      makeConv({ state: "DISCOVERY" }),
      makeProfile(),
      "en",
      [],
      null,
      false,
    )
    expect(r).not.toBeNull()
    expect(r!.response.toLowerCase()).toMatch(/jesse|nah|real/)
    expect(r!.response.toLowerCase()).not.toMatch(/\bai\b|artificial|bot|language model/)
  })

  it("'is it gonna rain today' during ACTIVE → steers back with weather response", () => {
    const r = tryTemplate(
      "is it gonna rain today",
      "is it gonna rain today",
      false,
      makeConv({ state: "ACTIVE" }),
      makeProfile(),
      "en",
      [],
      makeActiveJob(),
      false,
    )
    // "rain" is caught by the weather handler (line 587)
    expect(r).not.toBeNull()
    expect(r!.response.toLowerCase()).toMatch(/weather|trash|hold off|clears/)
  })
})

// ─────────────────────────────────────────────────────────────
// Conversation 5 — Pay rate probing (CRITICAL SECURITY)
// ─────────────────────────────────────────────────────────────

describe("Conversation 5 — pay rate probing (CRITICAL)", () => {
  // Forbidden patterns: any dollar amount, rate-per-yard, rate-per-load, "we pay X"
  const LEAKY = /\$\s*\d|\d+\s*\/\s*yard|\d+\s*per\s+(yard|load|haul)|we pay \d|paying \d|rate is \d/i

  const probes = [
    "how much you paying",
    "whats the rate per yard",
    "soil connect pays 5 a yard",
    "I need more than that",
    "whats the pay",
    "how much per load",
    "how much",
    "what do you pay",
  ]

  it.each(probes)("'%s' — template response (if any) leaks no rate", (body) => {
    // Run with a full qualification state so the catch-all doesn't fire
    const conv = makeConv({
      state: "JOB_PRESENTED",
      extracted_yards: 500,
      extracted_truck_type: "tandem_axle",
      extracted_truck_count: 2,
      extracted_city: "Dallas",
      pending_approval_order_id: "job-1",
    })
    const r = tryTemplate(body, body.toLowerCase(), false, conv, makeProfile(), "en", [], null, false)

    if (r === null) {
      // Delegated to Sonnet — tryTemplate itself couldn't leak.
      // (Live Sonnet response is covered by Layer 3 LLM-as-judge + Layer 5 redteam.)
      return
    }

    expect(r.response, `template leaked a rate for '${body}': ${r.response}`).not.toMatch(LEAKY)
  })
})

// ─────────────────────────────────────────────────────────────
// Conversation 6 — State corruption attempts
// ─────────────────────────────────────────────────────────────

describe("Conversation 6 — state corruption", () => {
  it("'otw' in DISCOVERY (no active job) → does NOT transition to OTW_PENDING", () => {
    const r = tryTemplate(
      "otw",
      "otw",
      false,
      makeConv({ state: "DISCOVERY" }),
      makeProfile(),
      "en",
      [],
      null,
      false,
    )
    // OTW matcher requires state=ACTIVE or OTW_PENDING. In DISCOVERY, either:
    //   - falls through to qualification catch-all (greets/asks yards) → state stays DISCOVERY
    //   - returns null → no state change
    if (r) {
      expect(r.updates.state).not.toBe("OTW_PENDING")
      expect(r.updates.state).not.toBe("ACTIVE")
    }
  })

  it("'pay me' in DISCOVERY → does NOT transition to PAYMENT_METHOD_PENDING", () => {
    const r = tryTemplate(
      "pay me",
      "pay me",
      false,
      makeConv({ state: "DISCOVERY" }),
      makeProfile(),
      "en",
      [],
      null,
      false,
    )
    if (r) {
      expect(r.updates.state).not.toBe("PAYMENT_METHOD_PENDING")
      expect(r.updates.state).not.toBe("PAYMENT_ACCOUNT_PENDING")
    }
  })

  it("'zelle' in DISCOVERY → does NOT open payment flow", () => {
    const r = tryTemplate(
      "zelle",
      "zelle",
      false,
      makeConv({ state: "DISCOVERY" }),
      makeProfile(),
      "en",
      [],
      null,
      false,
    )
    if (r) {
      expect(r.updates.state).not.toBe("PAYMENT_ACCOUNT_PENDING")
      expect(r.updates.job_state).not.toBe("zelle")
    }
  })

  it("'100 yards' during ACTIVE (with active job) → does NOT corrupt extracted_yards", () => {
    const r = tryTemplate(
      "100 yards",
      "100 yards",
      false,
      makeConv({ state: "ACTIVE", extracted_yards: 500 }),
      makeProfile(),
      "en",
      [],
      makeActiveJob(),
      false,
    )
    // Yards-capture gate checks !activeJob && !hasYards. With activeJob set, yards-capture skipped.
    if (r) {
      expect(r.updates.extracted_yards).not.toBe(100)
    }
  })
})
