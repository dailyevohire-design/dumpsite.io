/**
 * Strips internal state-tag prefixes from outbound SMS bodies.
 * Defense-in-depth — the [RESCUE STATE] runtime concatenations were
 * fixed in commit f676d9e, but this catches any future regression.
 */

const LEADING_TAG = /^\s*\[[A-Z][A-Z0-9_ ]*\]\s*/

const FORBIDDEN_PHRASES = [
  "[RESCUE",
  "[FOLLOW_UP",
  "[COLLECTING",
  "[STATE_",
  "[DEBUG",
  "[INTERNAL",
]

export class OutboundSanitizationError extends Error {
  constructor(public readonly original: string, reason: string) {
    super(`Outbound blocked: ${reason}`)
    this.name = "OutboundSanitizationError"
  }
}

export function sanitizeOutbound(body: string): string {
  if (!body || typeof body !== "string") {
    throw new OutboundSanitizationError(body as any, "empty or non-string body")
  }

  let cleaned = body
  while (LEADING_TAG.test(cleaned)) {
    cleaned = cleaned.replace(LEADING_TAG, "")
  }
  cleaned = cleaned.trim()

  for (const phrase of FORBIDDEN_PHRASES) {
    if (cleaned.includes(phrase)) {
      throw new OutboundSanitizationError(
        body,
        `contains forbidden internal marker: ${phrase}`,
      )
    }
  }

  if (cleaned.length === 0) {
    throw new OutboundSanitizationError(body, "message empty after sanitization")
  }

  return cleaned
}

export function sanitizeOutboundSafe(body: string, fallback: string): string {
  try {
    return sanitizeOutbound(body)
  } catch (e) {
    console.error("[sanitize-outbound] BLOCKED:", { body, error: (e as Error).message })
    return fallback
  }
}
