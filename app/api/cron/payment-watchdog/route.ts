import { NextResponse } from "next/server"
import { createAdminSupabase } from "@/lib/supabase"
import twilio from "twilio"

const tw = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
const CUSTOMER_FROM = process.env.CUSTOMER_TWILIO_NUMBER || ""
const ADMIN_FROM = process.env.TWILIO_FROM_NUMBER_2 || process.env.TWILIO_FROM_NUMBER || ""
const ADMIN = (process.env.ADMIN_PHONE || "7134439223").replace(/\D/g, "")
const ADMIN_2 = (process.env.ADMIN_PHONE_2 || "").replace(/\D/g, "")

async function alertAdmin(msg: string) {
  try { await tw.messages.create({ body: msg, from: ADMIN_FROM, to: `+1${ADMIN}` }) } catch (e) { console.error("[pw-alert]", e) }
  if (ADMIN_2) { try { await tw.messages.create({ body: msg, from: ADMIN_FROM, to: `+1${ADMIN_2}` }) } catch (e) { console.error("[pw-alert admin2]", e) } }
}

export async function GET() {
  const sb = createAdminSupabase()
  const now = Date.now()
  let actions = 0

  // ── UNPAID CUSTOMER DELIVERIES ──
  const { data: unpaid } = await sb.from("customer_conversations")
    .select("phone, customer_name, total_price_cents, payment_method, updated_at")
    .eq("state", "AWAITING_PAYMENT")

  for (const c of unpaid || []) {
    const hoursWaiting = (now - new Date(c.updated_at).getTime()) / (1000 * 60 * 60)
    const name = (c.customer_name || "").split(/\s+/)[0] || "there"
    const total = c.total_price_cents ? `$${Math.round(c.total_price_cents / 100)}` : ""

    // Check last outbound to avoid spamming — only send if we haven't messaged in the window
    const { data: lastOut } = await sb.from("customer_sms_logs")
      .select("body, created_at").eq("phone", c.phone).eq("direction", "outbound")
      .order("created_at", { ascending: false }).limit(1)
    const lastOutHoursAgo = lastOut?.[0] ? (now - new Date(lastOut[0].created_at).getTime()) / (1000 * 60 * 60) : 999
    const alreadySentRecently = lastOutHoursAgo < 1 // Don't double-text within 1 hour

    try {
      if (hoursWaiting >= 1 && hoursWaiting < 2 && !alreadySentRecently) {
        // 1 hour — first nudge + notify admin
        if (CUSTOMER_FROM) {
          await tw.messages.create({
            body: `Hey ${name}, just following up on the ${total} for your delivery. We accept Venmo, Zelle, or online invoice. Which works best for you`,
            from: CUSTOMER_FROM, to: `+1${c.phone}`,
          })
          await sb.from("customer_sms_logs").insert({ phone: c.phone, body: `[PAYMENT 1h] First follow-up`, direction: "outbound", message_sid: `pw1h_${Date.now()}` })
        }
        await alertAdmin(`UNPAID 1h: ${c.customer_name} (${c.phone}) owes ${total}`)
        actions++
      } else if (hoursWaiting >= 4 && hoursWaiting < 5 && lastOutHoursAgo >= 2) {
        // 4 hours — second nudge
        if (CUSTOMER_FROM) {
          await tw.messages.create({
            body: `${name}, checking in on the payment for your dirt delivery. ${total} via Venmo, Zelle, or we can send an invoice. Let me know`,
            from: CUSTOMER_FROM, to: `+1${c.phone}`,
          })
          await sb.from("customer_sms_logs").insert({ phone: c.phone, body: `[PAYMENT 4h] Second follow-up`, direction: "outbound", message_sid: `pw4h_${Date.now()}` })
        }
        actions++
      } else if (hoursWaiting >= 24 && hoursWaiting < 25 && lastOutHoursAgo >= 4) {
        // 24 hours — final text + admin escalation
        if (CUSTOMER_FROM) {
          await tw.messages.create({
            body: `${name}, last follow-up on the ${total} delivery payment. Let me know how you'd like to handle it`,
            from: CUSTOMER_FROM, to: `+1${c.phone}`,
          })
          await sb.from("customer_sms_logs").insert({ phone: c.phone, body: `[PAYMENT 24h] Final follow-up`, direction: "outbound", message_sid: `pw24h_${Date.now()}` })
        }
        await alertAdmin(`UNPAID 24h — NEEDS MANUAL COLLECTION: ${c.customer_name} (${c.phone}) owes ${total}`)
        actions++
      } else if (hoursWaiting >= 48) {
        // 48h+ — close it out, admin handles manually
        await sb.from("customer_conversations").update({ state: "CLOSED" }).eq("phone", c.phone)
        await alertAdmin(`UNPAID CLOSED 48h+: ${c.customer_name} (${c.phone}) ${total}. Manual collection needed.`)
        actions++
      }
    } catch (e) { console.error("[payment-watchdog]", e) }
  }

  // ── STALE DRIVER PAYMENTS — pending same day (8h+) ──
  const eightHoursAgo = new Date(now - 8 * 60 * 60 * 1000).toISOString()
  const { data: staleDriverPay } = await sb.from("driver_payments")
    .select("id, amount_cents, created_at, driver_id")
    .eq("status", "pending")
    .lt("created_at", eightHoursAgo)

  if (staleDriverPay && staleDriverPay.length > 0) {
    const total = staleDriverPay.reduce((s, p) => s + p.amount_cents / 100, 0)
    await alertAdmin(`${staleDriverPay.length} driver payments pending 8h+, total $${Math.round(total)}. Process now.`)
    actions++
  }

  return NextResponse.json({ checked: (unpaid?.length || 0), actions })
}
