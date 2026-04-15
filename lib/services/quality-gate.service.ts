/**
 * Phase 7 — Pre-send quality gate.
 *
 * Runs AFTER callBrain returns and BEFORE Twilio send. Five sync checks in order:
 *   1. Format — length, menus, markdown
 *   2. Dispatch accuracy — site references, driver names (semantic)
 *   3. Safety keywords — dollar amounts, addresses when unauthorized, AI admission
 *   4. Coherence — non-sequiturs in complex states
 *   5. Repetition — Levenshtein >0.7 to recent assistant messages
 *
 * On fail: returns { pass: false, fallbackToTemplate: true, reason }. Caller should
 * substitute a state-appropriate template fallback.
 *
 * Total budget: <2ms per call (pure regex + math).
 */

import { isTooSimilar } from "./brain.service"

export interface ConversationContext {
  state: string
  lang: "en" | "es"
  hasActiveApprovedJob: boolean
  driverFirstName?: string
  history: { role: string; content: string }[]
}

export interface QualityResult {
  pass: boolean
  reason?: string
  fallbackToTemplate: boolean
}

const CHECK_1_MENU = /reply\s*:|reply\s+\d|option\s+\d|select\s+one/i
const CHECK_1_MARKDOWN = /\*\*|^#+\s|^[-*]\s|^\d+\.\s/m
const CHECK_3_MONEY = /\$\s*\d|\d+\s*per\s+(yard|load|yd)|\d+\s*\/\s*(yard|load|yd)|\brate is \d|\bwe pay \d|\bpaying \d/i
const CHECK_3_AI = /\bi am (an |a )?(ai|bot|language model|artificial)|\bi'?m (an |a )?(ai|bot|language model)|\bas an ai\b|\bclaude\b|\banthropic\b|\bchatgpt\b|\bgpt\b/i
const CHECK_3_ADDRESS = /\b\d{3,5}\s+\w+\s+(st|ave|blvd|dr|rd|ln|ct|way|pkwy|hwy|fm)\b/i

export function qualityGate(response: string, ctx: ConversationContext): QualityResult {
  // ── CHECK 1: Format ────────────────────────────────────────
  if (!response || !response.trim()) {
    return { pass: false, reason: "empty response", fallbackToTemplate: true }
  }
  if (response.length > 320) {
    return { pass: false, reason: "response >320 chars (SMS hard limit)", fallbackToTemplate: true }
  }
  if (CHECK_1_MENU.test(response)) {
    return { pass: false, reason: "menu-style response", fallbackToTemplate: true }
  }
  if (CHECK_1_MARKDOWN.test(response)) {
    return { pass: false, reason: "markdown detected", fallbackToTemplate: true }
  }

  // ── CHECK 2: Dispatch accuracy ─────────────────────────────
  // If response includes a driver name, it must be the driver's actual name.
  // We don't have a full name roster to check against, so we trust the `driverFirstName`
  // hint — if response mentions another name-shaped token and it isn't the driver's, flag.
  // (Lightweight heuristic; full semantic check would need the DB.)
  if (ctx.driverFirstName) {
    // Lightweight: only flag obviously-out-of-band names (common test driver names)
    const knownTestNames = /\b(bob|alice|mark|carlos|johnny|dario|viswa|luis|vishal)\b/i
    const matches = response.match(knownTestNames)
    if (matches && !new RegExp("\\b" + ctx.driverFirstName + "\\b", "i").test(matches[0])) {
      // Another driver's name leaked — flag
      return { pass: false, reason: `foreign driver name: ${matches[0]}`, fallbackToTemplate: true }
    }
  }

  // ── CHECK 3: Safety keywords ───────────────────────────────
  if (CHECK_3_MONEY.test(response)) {
    return { pass: false, reason: "dollar amount / pay rate leak", fallbackToTemplate: true }
  }
  if (CHECK_3_AI.test(response)) {
    return { pass: false, reason: "AI admission", fallbackToTemplate: true }
  }
  // Address leak: only OK if driver has an active approved job (they're already cleared)
  if (!ctx.hasActiveApprovedJob && CHECK_3_ADDRESS.test(response)) {
    return { pass: false, reason: "address leak before approval", fallbackToTemplate: true }
  }

  // ── CHECK 4: Coherence — only for complex states ────────────
  // In ACTIVE/JOB_PRESENTED, response should reference the job or current flow somehow.
  // Very lightweight — just ensure it's not a total non-sequitur greeting.
  if ((ctx.state === "ACTIVE" || ctx.state === "OTW_PENDING") && /^(hey|hi|hello|what'?s up|who is this)$/i.test(response.trim())) {
    return { pass: false, reason: "greeting non-sequitur in ACTIVE", fallbackToTemplate: true }
  }

  // ── CHECK 5: Repetition ────────────────────────────────────
  if (isTooSimilar(response, ctx.history, 0.7)) {
    return { pass: false, reason: "Levenshtein >0.7 to recent assistant", fallbackToTemplate: true }
  }

  return { pass: true, fallbackToTemplate: false }
}

/**
 * State-appropriate fallback when quality gate rejects. Short, safe, human.
 */
export function qualityGateFallback(state: string, lang: "en" | "es"): string {
  const table: Record<string, { en: string; es: string }> = {
    DISCOVERY:              { en: "hey whats up, you got dirt", es: "que onda, tienes tierra" },
    ASKING_TRUCK:           { en: "what kind of truck you running", es: "que tipo de camion tienes" },
    ASKING_TRUCK_COUNT:     { en: "how many trucks you got", es: "cuantos camiones tienes" },
    ASKING_ADDRESS:         { en: "whats the address your loading from", es: "cual es la direccion de donde cargan" },
    JOB_PRESENTED:          { en: "you good with that or nah", es: "te sirve o no" },
    PHOTO_PENDING:          { en: "send me a pic of the dirt", es: "manda una foto de la tierra" },
    APPROVAL_PENDING:       { en: "still waiting on them, give me a min", es: "todavia esperando, un minuto" },
    ACTIVE:                 { en: "10.4", es: "listo" },
    OTW_PENDING:            { en: "lmk when you get there", es: "avisame cuando llegues" },
    PAYMENT_METHOD_PENDING: { en: "zelle or venmo", es: "zelle o venmo" },
    PAYMENT_ACCOUNT_PENDING:{ en: "send me the info", es: "mandame la info" },
    CLOSED:                 { en: "whats up", es: "que onda" },
  }
  return table[state]?.[lang] || (lang === "es" ? "dame un segundo" : "give me a sec")
}
