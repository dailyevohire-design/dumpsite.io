/**
 * Fail-closed wrapper for Sarah's brain.
 *
 * On any error inside `fn`, the wrapper:
 *   - logs to brain_alerts (alert_class distinguishes brain vs post-send failure)
 *   - flips conversation to mode='HUMAN_ACTIVE' + needs_human_review=true
 *     ONLY IF the error happened BEFORE the wrapped fn signalled
 *     setSendCommitted(). Post-send-audit failures (the customer already
 *     received their message) skip the pause to avoid admin backlog.
 *   - returns the caller-supplied fallback via opts.onError
 *
 * Set FAIL_CLOSED_ENABLED=false in env to bypass entirely (instant kill switch).
 *
 * Anti-pattern this guards against:
 *
 *   try {
 *     await sendOutboundSMS(phone, sarahReply)   // succeeded, customer got it
 *     await persistConversation(...)              // throws
 *   } catch (e) {
 *     await sendOutboundSMS(phone, FALLBACK)     // customer now has 2 messages
 *   }
 *
 * Call sites set sendCommitted IMMEDIATELY after a successful customer-facing
 * send. If a later step throws, withFailClosed records it as
 * 'post_send_audit_failure' instead of pausing the conversation.
 */
import { createAdminSupabase } from "../supabase"

export interface FailClosedOptions<T> {
  /** Produces the fallback return value. Receives the error and the post-send flag. */
  onError: (err: Error, ctx: { sendCommitted: boolean }) => Promise<T>
  /** Caller-supplied label, e.g. "webhook", "rescue-stuck-sarah", "customer-followup". */
  source?: string
}

export async function withFailClosed<T>(
  phone: string,
  fn: (setSendCommitted: () => void) => Promise<T>,
  opts: FailClosedOptions<T>,
): Promise<T> {
  if (process.env.FAIL_CLOSED_ENABLED === "false") {
    return fn(() => {})
  }

  let sendCommitted = false
  const setSendCommitted = () => { sendCommitted = true }

  try {
    return await fn(setSendCommitted)
  } catch (err: any) {
    const e: Error = err instanceof Error ? err : new Error(String(err))
    const sb = createAdminSupabase()
    const alertClass = sendCommitted ? "post_send_audit_failure" : "brain_error"

    if (!sendCommitted) {
      // Pre-send failure → pause conversation. Customer hasn't received anything,
      // so an admin needs to take over before any further automated reply.
      try {
        await sb.from("customer_conversations").update({
          mode: "HUMAN_ACTIVE",
          needs_human_review: true,
        }).eq("phone", phone)
      } catch (pauseErr) {
        console.error("[fail-closed] failed to pause conversation:", pauseErr)
      }
    }
    // sendCommitted=true → skip the pause. Customer already got their message;
    // pausing for an audit-log write failure would create unnecessary admin backlog.

    try {
      await sb.from("brain_alerts").insert({
        phone,
        alert_class: alertClass,
        error_message: (e.message || "").slice(0, 1000),
        error_stack: (e.stack || "").slice(0, 4000),
        source: opts.source || null,
      })
    } catch (alertErr) {
      console.error("[fail-closed] failed to write brain_alert:", alertErr)
    }

    console.error(`[fail-closed] ${alertClass} for ${phone} (${opts.source || "unknown"}):`, e.message)

    return opts.onError(e, { sendCommitted })
  }
}
