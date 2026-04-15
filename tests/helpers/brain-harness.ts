/**
 * Test harness for Jesse's brain.
 *
 * Provides factory helpers to construct the inputs that tryTemplate, validateResponse,
 * and callBrain need. Matches the ACTUAL signatures in lib/services/brain.service.ts
 * (verified against file on 2026-04-14).
 *
 * Signatures:
 *   tryTemplate(body, lower, hasPhoto, conv, profile, lang, nearbyJobs, activeJob, isKnownDriver)
 *     → { response, updates, action } | null
 *   validateResponse(r, driverAddr, state, lang) → string
 *   callBrain(body, hasPhoto, photoUrl, conv, profile, history, nearbyJobs, activeJob, lang, isKnownDriver, savedPayment)
 *     → Promise<BrainOutput>
 */

export type Lang = "en" | "es"

export type JesseState =
  | "DISCOVERY"
  | "GETTING_NAME"
  | "ASKING_TRUCK"
  | "ASKING_TRUCK_COUNT"
  | "ASKING_ADDRESS"
  | "JOB_PRESENTED"
  | "PHOTO_PENDING"
  | "APPROVAL_PENDING"
  | "ACTIVE"
  | "OTW_PENDING"
  | "PAYMENT_METHOD_PENDING"
  | "PAYMENT_ACCOUNT_PENDING"
  | "CLOSED"

export interface ConvOverrides {
  state?: JesseState
  extracted_yards?: number | null
  extracted_truck_type?: string | null
  extracted_truck_count?: number | null
  extracted_city?: string | null
  extracted_material?: string | null
  photo_public_url?: string | null
  pending_approval_order_id?: string | null
  active_order_id?: string | null
  job_state?: string | null
  phone?: string
}

export function makeConv(overrides: ConvOverrides = {}): any {
  return {
    state: "DISCOVERY",
    extracted_yards: null,
    extracted_truck_type: null,
    extracted_truck_count: null,
    extracted_city: null,
    extracted_material: null,
    photo_public_url: null,
    pending_approval_order_id: null,
    active_order_id: null,
    job_state: null,
    phone: "+15555550001",
    ...overrides,
  }
}

export function makeProfile(overrides: Partial<{ first_name: string; user_id: string; preferred_language: Lang }> = {}): any {
  return {
    first_name: "Mark",
    user_id: "driver-test-1",
    preferred_language: "en",
    ...overrides,
  }
}

export interface JobOverrides {
  id?: string
  cityName?: string
  distanceMiles?: number
  yardsNeeded?: number
  driverPayCents?: number
  truckTypeNeeded?: string
}

export function makeJob(overrides: JobOverrides = {}): any {
  return {
    id: "job-abc123",
    cityName: "McKinney",
    distanceMiles: 8,
    yardsNeeded: 500,
    driverPayCents: 4500,
    truckTypeNeeded: "tandem_axle",
    ...overrides,
  }
}

export function makeActiveJob(overrides: Partial<{ id: string; driver_pay_cents: number; yards_needed: number; cities: { name: string } }> = {}): any {
  return {
    id: "active-job-1",
    driver_pay_cents: 4500,
    yards_needed: 500,
    cities: { name: "McKinney" },
    ...overrides,
  }
}

/** Call tryTemplate with defaults — supply only the fields that matter. */
export function callTpl(
  tryTemplate: any,
  opts: {
    body: string
    conv?: ConvOverrides
    profile?: Parameters<typeof makeProfile>[0]
    lang?: Lang
    nearbyJobs?: any[]
    activeJob?: any
    isKnownDriver?: boolean
    hasPhoto?: boolean
  },
) {
  const conv = makeConv(opts.conv)
  const profile = makeProfile(opts.profile)
  return tryTemplate(
    opts.body,
    opts.body.toLowerCase(),
    opts.hasPhoto ?? false,
    conv,
    profile,
    opts.lang ?? "en",
    opts.nearbyJobs ?? [],
    opts.activeJob ?? null,
    opts.isKnownDriver ?? false,
  )
}
