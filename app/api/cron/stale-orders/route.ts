import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabase } from "@/lib/supabase"
import { insertSmsLog } from "@/lib/sms"
import twilio from "twilio"


const tw = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
const FROM = process.env.TWILIO_FROM_NUMBER_2 || process.env.TWILIO_FROM_NUMBER || ""
const ADMIN = (process.env.ADMIN_PHONE || "7134439223").replace(/\D/g, "")
const ADMIN_2 = (process.env.ADMIN_PHONE_2 || "").replace(/\D/g, "")

async function alertAdmin(msg: string) {
  if (process.env.PAUSE_ADMIN_SMS === "true") { console.log(`[SMS PAUSED] Stale alert: ${msg.slice(0, 80)}`); return }
  try { await tw.messages.create({ body: msg, from: FROM, to: `+1${ADMIN}` }) } catch (e) { console.error("[alert]", e) }
  if (ADMIN_2) { try { await tw.messages.create({ body: msg, from: FROM, to: `+1${ADMIN_2}` }) } catch (e) { console.error("[alert admin2]", e) } }
}

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return new Response("CRON_SECRET not configured", { status: 500 })
  }
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 })
  }
  // Kill switch — set PAUSE_STALE_ALERTS=true in Vercel env to silence all alerts
  if (process.env.PAUSE_STALE_ALERTS === "true") {
    return NextResponse.json({ paused: true, alerts: 0 })
  }

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
      const body = "Hey just checking in, you make it to the site? Text me your load count when done"
      await tw.messages.create({ body, from: FROM, to: `+1${d.phone}` })
      await insertSmsLog(sb, "sms_logs", { phone: d.phone, body, direction: "outbound", message_sid: `noshow_${Date.now()}` })
    } catch {}
  }

  // 1b. APPROVAL_PENDING REAPER — approval_sent_at older than 2h, reset and notify driver
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  const { data: staleApprovals } = await sb.from("conversations")
    .select("phone, approval_sent_at, pending_approval_order_id")
    .eq("state", "APPROVAL_PENDING")
    .lt("approval_sent_at", twoHoursAgo)
  for (const c of staleApprovals || []) {
    try {
      await sb.from("conversations").update({
        state: "DISCOVERY", pending_approval_order_id: null, reservation_id: null,
        approval_sent_at: null, voice_call_made: null,
      }).eq("phone", c.phone)
      const body = "that one didn't pan out, lmk if you got more dirt today"
      await tw.messages.create({ body, from: FROM, to: `+1${c.phone}` })
      await insertSmsLog(sb, "sms_logs", { phone: c.phone, body, direction: "outbound", message_sid: `reaper_${Date.now()}` })
      alerts.push(`APPROVAL REAPED: ${c.phone} APPROVAL_PENDING > 2h, reset to DISCOVERY`)
    } catch (e) { console.error("[approval reaper]", e) }
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

  // 2b. STUCK DISCOVERY — driver sent last message, we acked or said nothing useful, no progress in 10+ min
  // This catches the "in dallas → 10.4 → silence" failure mode.
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const { data: stuckDiscovery } = await sb.from("conversations")
    .select("phone, state, updated_at")
    .in("state", ["DISCOVERY", "ASKING_TRUCK", "ASKING_TRUCK_COUNT", "GETTING_NAME"])
    .lt("updated_at", tenMinAgo)

  for (const c of stuckDiscovery || []) {
    // Only fire if driver sent the last message — they're waiting on us
    const { data: lastMsg } = await sb.from("sms_logs")
      .select("direction").eq("phone", c.phone).order("created_at", { ascending: false }).limit(1)
    if (lastMsg?.[0]?.direction !== "inbound") continue

    const mins = Math.round((Date.now() - new Date(c.updated_at).getTime()) / 60000)
    alerts.push(`STRANDED DRIVER: ${c.phone} stuck in ${c.state} ${mins}m, last msg was theirs`)

    // Auto re-prompt with a forward-progress question
    const reprompt = c.state === "ASKING_TRUCK"
      ? "what kind of truck you running bro"
      : c.state === "ASKING_TRUCK_COUNT"
      ? "how many trucks you got running today"
      : "whats your loading address, i can see what i got close"
    try {
      await tw.messages.create({ body: reprompt, from: FROM, to: `+1${c.phone}` })
      await insertSmsLog(sb, "sms_logs", { phone: c.phone, body: reprompt, direction: "outbound", message_sid: `stranded_${Date.now()}` })
      await sb.from("conversations").update({ updated_at: new Date().toISOString() }).eq("phone", c.phone)
    } catch (e) { console.error("[stranded reprompt]", e) }
  }

  // 2c. STUCK PAYMENT — driver went dark during payment collection
  const twentyMinAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString()
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString()
  const { data: stuckPayment } = await sb.from("conversations")
    .select("phone, state, updated_at")
    .in("state", ["PAYMENT_METHOD_PENDING", "PAYMENT_ACCOUNT_PENDING"])
    .lt("updated_at", twentyMinAgo)

  for (const c of stuckPayment || []) {
    const mins = Math.round((Date.now() - new Date(c.updated_at).getTime()) / 60000)
    // Only nudge if driver sent last message (they're waiting) or it's been 20+ min since we asked
    try {
      const reprompt = c.state === "PAYMENT_ACCOUNT_PENDING"
        ? "still need your payment info to close this out, whats your zelle or venmo"
        : "how you want it, zelle or venmo"
      await tw.messages.create({ body: reprompt, from: FROM, to: `+1${c.phone}` })
      await insertSmsLog(sb, "sms_logs", { phone: c.phone, body: reprompt, direction: "outbound", message_sid: `payreprompt_${Date.now()}` })
      await sb.from("conversations").update({ updated_at: new Date().toISOString() }).eq("phone", c.phone)
      alerts.push(`STUCK PAYMENT: ${c.phone} in ${c.state} for ${mins} min, re-prompted`)
    } catch (e) { console.error("[payment reprompt]", e) }

    // Escalate to admin after 30 min
    if (new Date(c.updated_at) < new Date(thirtyMinAgo)) {
      alerts.push(`PAYMENT ESCALATION: ${c.phone} stuck in ${c.state} for ${mins} min`)
    }
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
