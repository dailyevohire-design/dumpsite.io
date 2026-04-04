import { NextResponse } from "next/server"
import { createAdminSupabase } from "@/lib/supabase"
import twilio from "twilio"

const tw = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
const FROM = process.env.TWILIO_FROM_NUMBER_2 || process.env.TWILIO_FROM_NUMBER || ""
const ADMIN = (process.env.ADMIN_PHONE || "7134439223").replace(/\D/g, "")

export async function GET() {
  const sb = createAdminSupabase()
  const alerts: string[] = []

  // 1. Orders stuck in "dispatching" for 4+ hours — no driver picked up
  const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()
  const { data: staleOrders } = await sb.from("dispatch_orders")
    .select("id, client_name, client_address, yards_needed, driver_pay_cents, cities(name), created_at")
    .eq("status", "dispatching")
    .lt("created_at", fourHoursAgo)

  if (staleOrders && staleOrders.length > 0) {
    for (const o of staleOrders.slice(0, 5)) {
      const city = (o.cities as any)?.name || "unknown"
      const pay = o.driver_pay_cents ? `$${Math.round(o.driver_pay_cents / 100)}/load` : ""
      alerts.push(`STALE ORDER 4h+: ${city} ${o.yards_needed}yds ${pay} — no driver. Consider raising pay.`)
    }
    if (staleOrders.length > 5) alerts.push(`...and ${staleOrders.length - 5} more stale orders`)
  }

  // 2. Driver no-shows — OTW for 3+ hours with no completion
  const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
  const { data: noShows } = await sb.from("conversations")
    .select("phone, active_order_id, updated_at")
    .eq("state", "OTW_PENDING")
    .lt("updated_at", threeHoursAgo)

  if (noShows && noShows.length > 0) {
    for (const d of noShows) {
      alerts.push(`DRIVER NO-SHOW: ${d.phone} went OTW 3h+ ago, no completion. Order: ${d.active_order_id}`)
      // Text the driver
      try {
        await tw.messages.create({
          body: "Hey just checking in, did you make it to the site? Text me your load count when done",
          from: FROM, to: `+1${d.phone}`,
        })
      } catch {}
    }
  }

  // 3. Stuck driver conversations — active state, no message in 2+ hours
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  const { data: stuckDriver } = await sb.from("conversations")
    .select("phone, state, updated_at")
    .in("state", ["APPROVAL_PENDING", "PHOTO_PENDING"])
    .lt("updated_at", twoHoursAgo)

  if (stuckDriver && stuckDriver.length > 0) {
    for (const c of stuckDriver.slice(0, 3)) {
      alerts.push(`STUCK DRIVER: ${c.phone} in ${c.state} for 2h+`)
    }
  }

  // 4. Stuck customer conversations
  const { data: stuckCust } = await sb.from("customer_conversations")
    .select("phone, customer_name, state, updated_at")
    .in("state", ["COLLECTING", "QUOTING", "ASKING_DIMENSIONS"])
    .lt("updated_at", twoHoursAgo)

  if (stuckCust && stuckCust.length > 0) {
    for (const c of stuckCust.slice(0, 3)) {
      alerts.push(`STUCK CUSTOMER: ${c.customer_name || c.phone} in ${c.state} for 2h+`)
    }
  }

  // 5. Expired reservations still marked active
  const { data: expiredRes } = await sb.from("site_reservations")
    .select("id, order_id, driver_phone")
    .eq("status", "active")
    .lt("expires_at", new Date().toISOString())

  if (expiredRes && expiredRes.length > 0) {
    // Auto-release them
    for (const r of expiredRes) {
      await sb.from("site_reservations").update({ status: "released" }).eq("id", r.id)
    }
    alerts.push(`Released ${expiredRes.length} expired reservations`)
  }

  // Send consolidated alert if anything found
  if (alerts.length > 0) {
    const msg = alerts.join("\n\n")
    try {
      await tw.messages.create({ body: msg.slice(0, 1500), from: FROM, to: `+1${ADMIN}` })
    } catch (e) { console.error("[stale-orders]", e) }
  }

  return NextResponse.json({ alerts: alerts.length, details: alerts })
}
