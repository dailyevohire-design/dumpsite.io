import { NextResponse } from "next/server"
import { createAdminSupabase } from "@/lib/supabase"
import twilio from "twilio"

const tw = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
const CUSTOMER_FROM = process.env.CUSTOMER_TWILIO_NUMBER || ""
const ADMIN_FROM = process.env.TWILIO_FROM_NUMBER_2 || process.env.TWILIO_FROM_NUMBER || ""
const ADMIN = (process.env.ADMIN_PHONE || "7134439223").replace(/\D/g, "")

export async function GET() {
  const sb = createAdminSupabase()
  const now = Date.now()
  let actions = 0

  // Find customers in AWAITING_PAYMENT — check how long they've been there
  const { data: unpaid } = await sb.from("customer_conversations")
    .select("phone, customer_name, total_price_cents, payment_method, updated_at")
    .eq("state", "AWAITING_PAYMENT")

  for (const c of unpaid || []) {
    const hoursWaiting = (now - new Date(c.updated_at).getTime()) / (1000 * 60 * 60)
    const name = (c.customer_name || "").split(/\s+/)[0] || "there"
    const total = c.total_price_cents ? `$${Math.round(c.total_price_cents / 100)}` : ""

    try {
      if (hoursWaiting >= 72) {
        // 72h+ — final notice to customer + escalate to admin
        await tw.messages.create({
          body: `Hey ${name}, just following up one last time on the ${total} payment for your dirt delivery. We accept Venmo, Zelle, or online invoice. Let me know which works and I'll send the details`,
          from: CUSTOMER_FROM, to: `+1${c.phone}`,
        })
        await sb.from("customer_sms_logs").insert({ phone: c.phone, body: `[PAYMENT WATCHDOG 72h] Final follow-up sent`, direction: "outbound", message_sid: `pw72_${Date.now()}` })
        await tw.messages.create({
          body: `UNPAID 72h+: ${c.customer_name} (${c.phone}) owes ${total}. Needs manual collection.`,
          from: ADMIN_FROM, to: `+1${ADMIN}`,
        })
        // Move to CLOSED to stop further auto-follow-ups
        await sb.from("customer_conversations").update({ state: "CLOSED" }).eq("phone", c.phone)
        actions++
      } else if (hoursWaiting >= 48 && hoursWaiting < 50) {
        // 48h — second nudge
        await tw.messages.create({
          body: `${name}, checking in on the payment for your delivery. ${total} via Venmo, Zelle, or we can send an invoice. Which works best`,
          from: CUSTOMER_FROM, to: `+1${c.phone}`,
        })
        await sb.from("customer_sms_logs").insert({ phone: c.phone, body: `[PAYMENT WATCHDOG 48h] Follow-up sent`, direction: "outbound", message_sid: `pw48_${Date.now()}` })
        actions++
      } else if (hoursWaiting >= 24 && hoursWaiting < 26) {
        // 24h — first reminder
        await tw.messages.create({
          body: `Hey ${name}, just a reminder on the ${total} for your dirt delivery. Venmo, Zelle, or online invoice, whichever is easiest. Just text me back`,
          from: CUSTOMER_FROM, to: `+1${c.phone}`,
        })
        await sb.from("customer_sms_logs").insert({ phone: c.phone, body: `[PAYMENT WATCHDOG 24h] Follow-up sent`, direction: "outbound", message_sid: `pw24_${Date.now()}` })
        actions++
      }
    } catch (e) { console.error("[payment-watchdog]", e) }
  }

  // Also check driver payments pending for 48h+
  const twoDaysAgo = new Date(now - 48 * 60 * 60 * 1000).toISOString()
  const { data: staleDriverPay } = await sb.from("driver_payments")
    .select("id, driver_id, amount_cents, created_at")
    .eq("status", "pending")
    .lt("created_at", twoDaysAgo)

  if (staleDriverPay && staleDriverPay.length > 0) {
    const total = staleDriverPay.reduce((s, p) => s + p.amount_cents / 100, 0)
    try {
      await tw.messages.create({
        body: `${staleDriverPay.length} driver payments pending 48h+, total $${Math.round(total)}. Process ASAP.`,
        from: ADMIN_FROM, to: `+1${ADMIN}`,
      })
    } catch {}
    actions++
  }

  return NextResponse.json({ checked: (unpaid?.length || 0), actions })
}
