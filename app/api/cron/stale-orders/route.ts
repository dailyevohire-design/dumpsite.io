import { NextResponse } from "next/server"
import { createAdminSupabase } from "@/lib/supabase"
import twilio from "twilio"

const tw = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
const FROM = process.env.TWILIO_FROM_NUMBER_2 || process.env.TWILIO_FROM_NUMBER || ""
const ADMIN = (process.env.ADMIN_PHONE || "7134439223").replace(/\D/g, "")

async function alertAdmin(msg: string) {
  try { await tw.messages.create({ body: msg, from: FROM, to: `+1${ADMIN}` }) } catch (e) { console.error("[alert]", e) }
}

export async function GET() {
  const sb = createAdminSupabase()
  const alerts: string[] = []

  // 1. DRIVER NO-SHOW — OTW for 45+ min with no load count
  //    A driver should arrive and dump within 30-40 min. 45 min = something is wrong.
  const fortyFiveMinAgo = new Date(Date.now() - 45 * 60 * 1000).toISOString()
  const { data: noShows } = await sb.from("conversations")
    .select("phone, active_order_id, updated_at")
    .eq("state", "OTW_PENDING")
    .lt("updated_at", fortyFiveMinAgo)

  for (const d of noShows || []) {
    const mins = Math.round((Date.now() - new Date(d.updated_at).getTime()) / 60000)
    alerts.push(`DRIVER NO-SHOW: ${d.phone} went OTW ${mins} min ago, no load count`)
    // Text the driver
    try {
      await tw.messages.create({
        body: "Hey just checking in, you make it to the site? Text me your load count when done",
        from: FROM, to: `+1${d.phone}`,
      })
      await sb.from("sms_logs").insert({ phone: d.phone, body: `[NO-SHOW CHECK ${mins}min]`, direction: "outbound", message_sid: `noshow_${Date.now()}` })
    } catch {}
  }

  // 2. STUCK DRIVER CONVERSATIONS — no update in 15+ min during active flow
  const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString()
  const { data: stuckDriver } = await sb.from("conversations")
    .select("phone, state, updated_at")
    .in("state", ["APPROVAL_PENDING", "PHOTO_PENDING"])
    .lt("updated_at", fifteenMinAgo)

  for (const c of stuckDriver || []) {
    const mins = Math.round((Date.now() - new Date(c.updated_at).getTime()) / 60000)
    alerts.push(`STUCK DRIVER: ${c.phone} in ${c.state} for ${mins} min`)
  }

  // 3. STUCK CUSTOMER CONVERSATIONS — no update in 15+ min during active flow
  const { data: stuckCust } = await sb.from("customer_conversations")
    .select("phone, customer_name, state, updated_at")
    .in("state", ["COLLECTING", "QUOTING", "ASKING_DIMENSIONS", "AWAITING_PAYMENT"])
    .lt("updated_at", fifteenMinAgo)

  for (const c of stuckCust || []) {
    const mins = Math.round((Date.now() - new Date(c.updated_at).getTime()) / 60000)
    // Only alert if customer sent last message (they're waiting on us)
    const { data: lastMsg } = await sb.from("customer_sms_logs")
      .select("direction").eq("phone", c.phone).order("created_at", { ascending: false }).limit(1)
    if (lastMsg?.[0]?.direction === "inbound") {
      alerts.push(`STUCK CUSTOMER: ${c.customer_name || c.phone} waiting ${mins} min in ${c.state}`)
    }
  }

  // 4. STALE ORDERS — dispatching 4+ hours, no driver interest
  const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()
  const { data: staleOrders } = await sb.from("dispatch_orders")
    .select("id, client_name, yards_needed, driver_pay_cents, cities(name), created_at")
    .eq("status", "dispatching")
    .lt("created_at", fourHoursAgo)

  for (const o of (staleOrders || []).slice(0, 5)) {
    const city = (o.cities as any)?.name || "unknown"
    const pay = o.driver_pay_cents ? `$${Math.round(o.driver_pay_cents / 100)}/load` : ""
    const hrs = Math.round((Date.now() - new Date(o.created_at).getTime()) / 3600000)
    alerts.push(`STALE ORDER ${hrs}h: ${city} ${o.yards_needed}yds ${pay} — no driver`)
  }

  // 5. EXPIRED RESERVATIONS — auto-release
  const { data: expiredRes } = await sb.from("site_reservations")
    .select("id").eq("status", "active").lt("expires_at", new Date().toISOString())
  for (const r of expiredRes || []) {
    await sb.from("site_reservations").update({ status: "released" }).eq("id", r.id)
  }
  if (expiredRes && expiredRes.length > 0) {
    alerts.push(`Released ${expiredRes.length} expired reservations`)
  }

  // Send alert immediately if anything found
  if (alerts.length > 0) {
    await alertAdmin(alerts.join("\n\n").slice(0, 1500))
  }

  return NextResponse.json({ alerts: alerts.length, details: alerts })
}
