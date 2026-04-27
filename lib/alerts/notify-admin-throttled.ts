import twilio from "twilio"
import { createAdminSupabase } from "@/lib/supabase"

// Lazy init — module-scope construction breaks Next.js build when env vars
// resolve at request time (Vercel preview / production).
let _tw: ReturnType<typeof twilio> | null = null
function getTwilio() {
  if (!_tw) {
    _tw = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
  }
  return _tw
}

function normalizeE164(raw: string | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (trimmed.startsWith("+")) return trimmed
  const digits = trimmed.replace(/\D/g, "")
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
  console.error(`[notifyAdminThrottled] cannot normalize phone: ${raw}`)
  return null
}

function getAdminPhones(): string[] {
  return [
    normalizeE164(process.env.ADMIN_PHONE),
    normalizeE164(process.env.ADMIN_PHONE_2),
  ].filter((p): p is string => p !== null)
}

function getFrom(): string {
  return process.env.TWILIO_FROM_NUMBER_2 || process.env.TWILIO_FROM_NUMBER || ""
}

export type NotifyOpts = {
  cooldownMinutes?: number
  source?: string
  bypassCooldown?: boolean
}

export type NotifyResult = {
  sent: boolean
  reason: "cooled_down" | "sent" | "send_failed" | "bypassed" | "paused" | "missing_args"
}

export async function notifyAdminThrottled(
  alertClass: string,
  phone: string,
  body: string,
  opts: NotifyOpts = {}
): Promise<NotifyResult> {
  if (!alertClass || !phone) {
    console.error("[notifyAdminThrottled] missing alertClass or phone", { alertClass, phone })
    return { sent: false, reason: "missing_args" }
  }

  if (process.env.PAUSE_ADMIN_SMS === "true") {
    console.log(`[SMS PAUSED] [${alertClass}] ${body.slice(0, 80)}`)
    return { sent: false, reason: "paused" }
  }

  const sb = createAdminSupabase()
  const truncated = body.slice(0, 500)

  if (!opts.bypassCooldown) {
    const { data: shouldSend, error } = await sb.rpc("should_notify_admin", {
      p_alert_class: alertClass,
      p_phone: phone,
      p_cooldown_minutes: opts.cooldownMinutes ?? 60,
      p_message: truncated,
      p_source: opts.source ?? null,
    })
    if (error) {
      // RPC failure should not silence alerts. Log + send anyway (open).
      console.error("[notifyAdminThrottled] should_notify_admin RPC error, sending anyway:", error.message)
    } else if (shouldSend === false) {
      return { sent: false, reason: "cooled_down" }
    }
  } else {
    // Bypass: still record in brain_alerts for audit, but don't gate on it.
    const { error: insertErr } = await sb.from("brain_alerts").insert({
      phone,
      alert_class: alertClass,
      source: opts.source ?? null,
      error_message: truncated,
      last_notified_at: new Date().toISOString(),
    })
    if (insertErr) {
      console.error("[notifyAdminThrottled] bypass insert failed:", insertErr.message)
    }
  }

  const adminPhones = getAdminPhones()
  if (adminPhones.length === 0) {
    console.error("[notifyAdminThrottled] no ADMIN_PHONE configured")
    return { sent: false, reason: "send_failed" }
  }

  const from = getFrom()
  if (!from) {
    console.error("[notifyAdminThrottled] no TWILIO_FROM_NUMBER configured")
    return { sent: false, reason: "send_failed" }
  }

  const tw = getTwilio()
  let anySent = false
  for (const adminPhone of adminPhones) {
    try {
      await tw.messages.create({
        to: adminPhone,
        from,
        body: `[${alertClass}] ${body}`.slice(0, 1500),
      })
      anySent = true
    } catch (e) {
      console.error(`[notifyAdminThrottled] twilio send failed to ${adminPhone}:`, (e as Error)?.message)
    }
  }

  return {
    sent: anySent,
    reason: anySent ? (opts.bypassCooldown ? "bypassed" : "sent") : "send_failed",
  }
}
