/**
 * Outbound SMS validator. Runs synchronously inside lib/sms.ts sendSMSraw
 * to catch obviously-wrong messages before they reach Twilio.
 *
 * Block classes:
 *   BRACKET_PREFIX   — leading state-debug tag like [RESCUE PHOTO_PENDING]
 *   PERSONA_LEAK_EN  — "as an AI", "language model", etc.
 *   PERSONA_LEAK_ES  — Spanish persona leaks
 *   GARBAGE_OUTPUT   — "undefined", "NaN", "[object Object]", raw JSON
 *   UNRENDERED_TEMPLATE — ${var} or {{var}} that didn't get interpolated
 *   STACK_TRACE_LEAK — caught exception bleeding into outbound
 *   ERROR_PREFIX     — leading "TypeError:", "Error:", etc.
 *   EMPTY_BODY       — empty after trim
 *   OVERSIZE_BODY    — > MAX_LENGTH (code bug, not SMS-segment policing)
 *
 * Behavior:
 *   validateOutbound(body) returns { ok: true } or
 *   { ok: false, ruleName, redactedBody, fallback }.
 *   The caller substitutes `fallback` and ALSO logs the original via the
 *   notifyAdminThrottled wrapper so admin gets paged once per leak class.
 *
 * Fallback message recursion:
 *   The caller MUST pass the fallback back through validateOutbound
 *   exactly once. If the fallback itself fails, throw — this is paranoid
 *   loop prevention. A failing fallback means the validator code is broken
 *   and going silent is safer than infinite recursion.
 */

export const FALLBACK_MESSAGE = 'give me a sec'

export const BRACKET_ALLOWLIST = new Set([
  '[CONVERSATION RESET]',
])

type ValidationRule = {
  name: string
  pattern: RegExp
}

// Order matters — most specific first. ERROR_PREFIX, STACK_TRACE_LEAK, and
// UNRENDERED_TEMPLATE are anchored or have rigid structure; GARBAGE_OUTPUT
// is the broadest catch-all (any "undefined" anywhere) and goes last so an
// exception message containing "undefined" is classified as ERROR_PREFIX,
// not GARBAGE_OUTPUT.
const HARD_BLOCK_RULES: ValidationRule[] = [
  {
    name: 'ERROR_PREFIX',
    pattern: /^(Error|TypeError|RangeError|ReferenceError|SyntaxError):/i,
  },
  {
    name: 'STACK_TRACE_LEAK',
    pattern: /\bat [\w$.]+\s*\(.+\.(ts|tsx|js):\d+/,
  },
  {
    name: 'UNRENDERED_TEMPLATE',
    pattern: /\$\{[^}]*\}|\{\{[^}]*\}\}/,
  },
  {
    name: 'BRACKET_PREFIX',
    pattern: /^\s*\[[A-Z][A-Z0-9_ -]*\]/,
  },
  {
    name: 'PERSONA_LEAK_EN',
    pattern: /\b(as an? (ai|artificial intelligence|assistant|llm|language model)|i('m| am) (an? )?(ai|artificial intelligence|assistant|llm|language model|chatbot|bot)|i don'?t have (access to )?real[- ]time|my training (data|cutoff)|i was trained)\b/i,
  },
  {
    name: 'PERSONA_LEAK_ES',
    pattern: /\b(soy una? (ia|inteligencia artificial|asistente|bot|robot)|como (ia|inteligencia artificial|asistente|bot|robot)|no tengo acceso (en tiempo real|a información actual)|fui entrenad[oa])\b/i,
  },
  {
    name: 'GARBAGE_OUTPUT',
    pattern: /\b(undefined|NaN)\b|\[object Object\]|^\s*[{[]/,
  },
]

// Hard cap for "definitely a code bug." NOT SMS-segment-aware — real SMS
// length policing happens upstream at the brain/template layer.
const MAX_LENGTH = 1600

export type ValidationResult =
  | { ok: true }
  | {
      ok: false
      ruleName: string
      redactedBody: string
      fallback: string
    }

/**
 * Synchronous, pure. Safe to call on every outbound SMS.
 */
export function validateOutbound(body: unknown): ValidationResult {
  // Coerce defensively. validator runs at the absolute outbound boundary;
  // we don't trust callers to have stringified their input correctly.
  const str = typeof body === 'string' ? body : ''

  if (str.length === 0 || str.trim().length === 0) {
    return {
      ok: false,
      ruleName: 'EMPTY_BODY',
      redactedBody: '',
      fallback: FALLBACK_MESSAGE,
    }
  }

  if (str.length > MAX_LENGTH) {
    return {
      ok: false,
      ruleName: 'OVERSIZE_BODY',
      redactedBody: str.slice(0, 80),
      fallback: FALLBACK_MESSAGE,
    }
  }

  // Sentinel allowlist — checked before BRACKET_PREFIX so the internal
  // [CONVERSATION RESET] marker can pass through if it ever reaches here.
  // (In current code it never does; validator runs in sendSMSraw, sentinel
  // is written via insertSmsLog directly. Belt-and-suspenders only.)
  if (BRACKET_ALLOWLIST.has(str.trim())) {
    return { ok: true }
  }

  for (const rule of HARD_BLOCK_RULES) {
    if (rule.pattern.test(str)) {
      return {
        ok: false,
        ruleName: rule.name,
        redactedBody: str.slice(0, 80),
        fallback: FALLBACK_MESSAGE,
      }
    }
  }

  return { ok: true }
}

/**
 * Validate the fallback exactly once. If it fails, throw — never recurse.
 * Caller in sendSMSraw uses this to gate the substitution.
 */
export function assertFallbackValid(fallback: string): void {
  const result = validateOutbound(fallback)
  if (!result.ok) {
    throw new Error(
      `OUTBOUND_VALIDATOR_BROKEN: fallback message "${fallback}" failed validator (rule=${result.ruleName}). ` +
      `Validator itself has a bug. Refusing to send anything.`
    )
  }
}
