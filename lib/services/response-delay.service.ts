/**
 * Phase 2 — Human timing simulation for Jesse SMS replies.
 *
 * Based on Van der Linden 2006 (response-time distributions in conversation) and the
 * UCSD 69K-message SMS dataset. Produces log-normal delays that feel like a real
 * dispatcher, not an API.
 *
 * Gating: controlled by JESSE_HUMAN_TIMING env var in the webhook. This module is
 * pure — it only computes numbers and makes no external calls. Safe to import
 * anywhere.
 */

// ─────────────────────────────────────────────────────────────
// Box-Muller transform → standard-normal random sample
// ─────────────────────────────────────────────────────────────
function randomNormal(): number {
  // Avoid Math.log(0) → -Infinity
  const u1 = Math.max(Math.random(), 1e-10)
  const u2 = Math.random()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

// States Jesse resolves with reflex (short templates)
const SIMPLE_STATES = new Set([
  "ASKING_TRUCK",
  "ASKING_TRUCK_COUNT",
  "ASKING_ADDRESS",
  "PAYMENT_METHOD_PENDING",
  "PAYMENT_ACCOUNT_PENDING",
])

// States that require reading context + thinking (cost more mental load)
const COMPLEX_STATES = new Set([
  "JOB_PRESENTED",
  "ACTIVE",
  "PHOTO_PENDING",
  "APPROVAL_PENDING",
  "DISCOVERY",
  "OTW_PENDING",
  "CLOSED",
])

/**
 * Compute a human-feeling delay in milliseconds. Clamped to [3000, 25000].
 *
 * Components:
 *  - reading time: 48ms per incoming character
 *  - thinking time: exp(μ + σ·N) — log-normal
 *  - typing time: 180ms per outgoing character
 *  - distraction spike: 5% chance of +15-45s
 *  - ±20% jitter
 */
export function calculateHumanDelay(
  incomingLength: number,
  responseLength: number,
  state: string,
): number {
  const readingTime = incomingLength * 48
  const isSimple = SIMPLE_STATES.has(state)
  const mu = isSimple ? 3.2 : 3.8
  const sigma = isSimple ? 0.6 : 0.7
  const thinkingTime = Math.exp(mu + sigma * randomNormal())
  const typingTime = responseLength * 180
  const distraction = Math.random() < 0.05 ? 15000 + Math.random() * 30000 : 0

  let total = readingTime + thinkingTime + typingTime + distraction
  total *= 0.8 + Math.random() * 0.4 // ±20% jitter

  return Math.max(3000, Math.min(25000, Math.round(total)))
}

/**
 * Multiplier reflecting time-of-day dispatcher availability. Intended to be applied
 * AFTER calculateHumanDelay — but the final product is re-clamped at the caller.
 *
 *   21:00–05:59  — 3.0× (overnight, mostly asleep)
 *   06:00–06:59  — 1.5× (waking up)
 *   11:00–13:59  — 1.25× (lunch)
 *   17:00–17:59  — 1.3× (end-of-day fatigue)
 *   otherwise    — 1.0×
 */
export function getTimeOfDayMultiplier(now: Date = new Date()): number {
  const hour = now.getHours()
  if (hour >= 21 || hour < 6) return 3.0
  if (hour >= 6 && hour < 7) return 1.5
  if (hour >= 11 && hour <= 13) return 1.25
  if (hour >= 17 && hour < 18) return 1.3
  return 1.0
}

/**
 * 15% chance of splitting a long response into two naturally-paced messages.
 * Only splits if there's a clean break point (comma, 'and', 'but', em-dash,
 * sentence boundary) and both halves are ≥15 chars.
 */
export function shouldSplitMessage(response: string): { split: boolean; parts: string[] } {
  if (response.length < 40 || Math.random() > 0.15) return { split: false, parts: [response] }

  const breakPoints = [", ", " and ", " but ", " — ", ". "]
  for (const bp of breakPoints) {
    const idx = response.indexOf(bp)
    if (idx > 15 && idx < response.length - 15) {
      const first = response.slice(0, idx + (bp === ", " ? 1 : 0)).trim()
      const second = response.slice(idx + bp.length).trim()
      if (first.length >= 15 && second.length >= 15) {
        return { split: true, parts: [first, second] }
      }
    }
  }
  return { split: false, parts: [response] }
}

/**
 * Full delay pipeline: computes base delay, applies time-of-day multiplier, re-clamps.
 * Caller is expected to check `process.env.JESSE_HUMAN_TIMING === "1"` before using.
 */
export function computeFinalDelay(
  incomingLength: number,
  responseLength: number,
  state: string,
): number {
  const base = calculateHumanDelay(incomingLength, responseLength, state)
  const withTod = base * getTimeOfDayMultiplier()
  return Math.max(3000, Math.min(25000, Math.round(withTod)))
}
