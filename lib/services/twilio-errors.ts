// Twilio error classifier for outbound SMS sends.
//
// Background: when we reply to a customer, we send FROM the same Twilio
// number they texted (the sales agent's number). If Twilio rejects that
// FROM, we used to silently fall back to the default CUSTOMER_FROM number
// — but that breaks multi-agent attribution and confuses the customer
// about which agent they're talking to. Now we only fall back on TRANSIENT
// errors. Permanent errors (number not owned, A2P unregistered, in a
// messaging service, etc.) must be fixed in Twilio before we send anything.

export type TwilioErrorClass =
  | "permanent_from_invalid"   // The FROM number itself is the problem — never fall back
  | "permanent_to_blocked"     // The TO number is blocked/STOP'd — falling back won't help
  | "permanent_other"          // Other permanent error — fall back is unsafe
  | "transient"                // Worth retrying or falling back

export interface ClassifiedError {
  code: number
  class: TwilioErrorClass
  hint: string
}

// Source: https://www.twilio.com/docs/api/errors
// We classify conservatively — when in doubt, treat as permanent to surface
// the issue rather than silently send from the wrong number.
const ERROR_TABLE: Record<number, { class: TwilioErrorClass; hint: string }> = {
  // ── FROM-number config errors (DO NOT fall back) ──────────────────
  21606: { class: "permanent_from_invalid", hint: "FROM number is not a valid SMS-capable inbound number for your account. Check Twilio console — number must be owned by this account and have SMS capability enabled." },
  21659: { class: "permanent_from_invalid", hint: "FROM number is in a Messaging Service. Twilio requires sending with MessagingServiceSid instead of From=. Either remove the number from the messaging service, or update sendViaTwilioAPI to support MessagingServiceSid." },
  21212: { class: "permanent_from_invalid", hint: "Invalid 'From' phone number format." },
  21217: { class: "permanent_from_invalid", hint: "FROM phone number is not formatted correctly (E.164 expected)." },
  21605: { class: "permanent_from_invalid", hint: "Maximum body length exceeded — but if seen on a new agent number, also verify the number is provisioned." },

  // ── A2P 10DLC / regulatory (permanent until operator fixes) ───────
  30007: { class: "permanent_from_invalid", hint: "A2P 10DLC: this US long-code is not registered to a campaign. Register it in Twilio console → Messaging → Regulatory Compliance, or assign it to a registered campaign." },
  30032: { class: "permanent_from_invalid", hint: "Toll-free number not yet verified. Submit toll-free verification in Twilio console." },
  30034: { class: "permanent_from_invalid", hint: "US A2P 10DLC: message blocked because the sender is unregistered." },
  30038: { class: "permanent_from_invalid", hint: "Sender unverified — campaign or brand not approved." },

  // ── Geo permissions (permanent until enabled in console) ──────────
  21408: { class: "permanent_from_invalid", hint: "Permission to send to that region not enabled. Twilio console → Messaging → Settings → Geo Permissions." },

  // ── TO number issues (fallback won't help — still permanent) ──────
  21610: { class: "permanent_to_blocked", hint: "Recipient has replied STOP. They have unsubscribed from this sender. They must reply START to opt back in." },
  21614: { class: "permanent_to_blocked", hint: "TO number is not a valid mobile number." },
  21211: { class: "permanent_to_blocked", hint: "Invalid 'To' phone number." },

  // ── Transient (safe to retry, then fall back to default) ──────────
  20429: { class: "transient", hint: "Rate limited — retry after backoff." },
  20500: { class: "transient", hint: "Twilio internal server error — retry." },
  20503: { class: "transient", hint: "Twilio service unavailable — retry." },
  30001: { class: "transient", hint: "Queue overflow — retry." },
  30002: { class: "transient", hint: "Account suspended — NOT actually transient, but Twilio reports as send-time. Surface to admin." },
}

export function classifyTwilioError(errorCode: number | string | null | undefined): ClassifiedError {
  const code = typeof errorCode === "string" ? parseInt(errorCode, 10) : (errorCode || 0)
  const entry = ERROR_TABLE[code]
  if (entry) return { code, class: entry.class, hint: entry.hint }
  // Unknown code — treat as permanent_other so we don't silently send from
  // the wrong number. Better to alert and pause than to lie about identity.
  return {
    code,
    class: "permanent_other",
    hint: `Unknown Twilio error code ${code}. Treating as permanent to be safe — check Twilio docs and add to ERROR_TABLE in lib/services/twilio-errors.ts.`,
  }
}

// Should we attempt the same FROM number again before giving up?
export function isRetryable(c: ClassifiedError): boolean {
  return c.class === "transient"
}

// Should we fall back to the default CUSTOMER_FROM number after retries fail?
// Only true for transient errors — permanent errors must surface to the operator.
export function shouldFallBackToDefault(c: ClassifiedError): boolean {
  return c.class === "transient"
}
