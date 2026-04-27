import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabase } from "@/lib/supabase"
import { notifyAdminThrottled } from "@/lib/alerts/notify-admin-throttled"
import twilio from "twilio"

// ─────────────────────────────────────────────────────────
// PENDING SMS RETRY CRON — runs every 5 minutes
// The customer webhook drops a "pending_send" row in customer_sms_logs
// before invoking after() to send the reply. On success the marker is
// deleted. If after() crashes (Vercel function killed, Twilio outage,
// etc.) the marker stays and the customer gets nothing.
// This cron picks up any pending_send markers older than 3 minutes,
// resends them, deletes the marker on success, and alerts admin if
// the resend also fails.
// ─────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization")
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const sb = createAdminSupabase()
  const cutoff = new Date(Date.now() - 3 * 60 * 1000).toISOString()
  const { data: pending, error } = await sb
    .from("customer_sms_logs")
    .select("id, phone, body, message_sid, created_at")
    .eq("direction", "pending_send")
    .lt("created_at", cutoff)
    .limit(50)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!pending || pending.length === 0) {
    return NextResponse.json({ ok: true, retried: 0 })
  }

  const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
  const adminFrom = process.env.TWILIO_FROM_NUMBER_2 || process.env.TWILIO_FROM_NUMBER || ""
  const results: { phone: string; ok: boolean; error?: string }[] = []

  for (const row of pending) {
    // Find the agent number for this customer to preserve attribution.
    // A phone can now have multiple conversation rows (one per agent) — pick
    // the most recently updated. .limit(1) avoids maybeSingle() throwing on
    // multi-row results.
    const { data: convs } = await sb
      .from("customer_conversations")
      .select("source_number")
      .eq("phone", row.phone)
      .order("updated_at", { ascending: false })
      .limit(1)
    const fromNumber = convs?.[0]?.source_number
      ? `+1${convs[0].source_number}`
      : (process.env.CUSTOMER_TWILIO_NUMBER || adminFrom)

    try {
      const msg = await client.messages.create({
        from: fromNumber,
        to: `+1${row.phone}`,
        body: row.body,
      })
      // Insert outbound FIRST so we never lose the log if delete succeeds but insert fails
      await sb.from("customer_sms_logs").insert({
        phone: row.phone, body: row.body, direction: "outbound",
        message_sid: msg.sid || `retry_${Date.now()}`,
      })
      await sb.from("customer_sms_logs").delete().eq("id", row.id)
      results.push({ phone: row.phone, ok: true })
    } catch (e) {
      const errMsg = (e as any)?.message || "unknown"
      results.push({ phone: row.phone, ok: false, error: errMsg })
      // Alert admin — message has been pending for 3+ minutes AND retry failed.
      // Per-customer-phone dedup so two simultaneous failures of the same recipient
      // collapse, but failures across different customers each surface.
      try {
        await notifyAdminThrottled(
          "cron_retry_pending",
          `+1${row.phone.replace(/\D/g, "").slice(-10)}`,
          `RETRY FAILED for ${row.phone}: ${errMsg}. Reply lost: ${row.body.slice(0, 120)}`,
          { source: "cron:retry-pending-sms" },
        )
      } catch {}
    }
  }

  return NextResponse.json({ ok: true, retried: results.length, results })
}
