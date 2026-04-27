/**
 * Fail-closed wrapper for Sarah's brain.
 * On any error inside `fn`, atomically pauses the AI for that phone
 * (mode='HUMAN_ACTIVE', needs_human_review=true), logs to brain_alerts,
 * and produces a safe fallback response via the caller-supplied `onError`.
 *
 * Set FAIL_CLOSED_ENABLED=false in env to bypass (instant kill switch).
 */
import { createAdminSupabase } from "../supabase"

export interface FailClosedOptions<T> {
  /** Produces the fallback return value when fn throws (or sanitizer blocks). */
  onError: (err: Error) => Promise<T>
  /** Caller can label the alert (e.g. "webhook", "rescue-cron", "followup-cron"). */
  source?: string
}

export async function withFailClosed<T>(
  phone: string,
  fn: () => Promise<T>,
  opts: FailClosedOptions<T>,
): Promise<T> {
  if (process.env.FAIL_CLOSED_ENABLED === "false") {
    return fn()
  }
  try {
    return await fn()
  } catch (err: any) {
    const e: Error = err instanceof Error ? err : new Error(String(err))
    const sb = createAdminSupabase()

    try {
      await sb.from("customer_conversations").update({
        mode: "HUMAN_ACTIVE",
        needs_human_review: true,
      }).eq("phone", phone)
    } catch (pauseErr) {
      console.error("[fail-closed] failed to pause conversation:", pauseErr)
    }

    try {
      await sb.from("brain_alerts").insert({
        phone,
        alert_class: "fail_closed_pause",
        error_message: (e.message || "").slice(0, 1000),
        error_stack: (e.stack || "").slice(0, 4000),
        source: opts.source || null,
      })
    } catch (alertErr) {
      console.error("[fail-closed] failed to write brain_alert:", alertErr)
    }

    console.error(`[fail-closed] paused ${phone} (${opts.source || "unknown"}):`, e.message)

    return opts.onError(e)
  }
}
