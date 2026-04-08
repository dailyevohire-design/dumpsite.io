import { NextResponse } from "next/server"
import { createAdminSupabase } from "@/lib/supabase"
import twilio from "twilio"

const tw = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
const FROM = process.env.TWILIO_FROM_NUMBER_2 || process.env.TWILIO_FROM_NUMBER || ""
const ADMIN = process.env.ADMIN_PHONE || "7134439223"
const ADMIN_2 = (process.env.ADMIN_PHONE_2 || "").replace(/\D/g, "")

if (!process.env.CRON_SECRET) throw new Error("CRON_SECRET env var must be set")

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 })
  }
  const sb = createAdminSupabase()
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const since = todayStart.toISOString()

  // Orders today
  const { data: orders } = await sb.from("dispatch_orders")
    .select("id, status, yards_needed, price_quoted_cents, driver_pay_cents, cities(name)")
    .gte("created_at", since)

  const totalOrders = orders?.length || 0
  const completed = orders?.filter(o => o.status === "completed") || []
  const dispatching = orders?.filter(o => o.status === "dispatching") || []
  const active = orders?.filter(o => o.status === "active") || []

  let totalYards = 0, totalRevenue = 0, totalDriverPay = 0
  for (const o of completed) {
    totalYards += o.yards_needed || 0
    totalRevenue += (o.price_quoted_cents || 0) / 100
    totalDriverPay += (o.driver_pay_cents || 0) / 100
  }
  const margin = totalRevenue - totalDriverPay

  // Pending payments
  const { data: pendingPay } = await sb.from("driver_payments")
    .select("amount_cents").eq("status", "pending")
  const pendingTotal = (pendingPay || []).reduce((s, p) => s + p.amount_cents / 100, 0)

  // Stuck conversations (driver side — no outbound in 2+ hrs while in active state)
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  const { count: stuckDriverConvs } = await sb.from("conversations")
    .select("id", { count: "exact", head: true })
    .in("state", ["ACTIVE", "OTW_PENDING", "PHOTO_PENDING", "APPROVAL_PENDING", "JOB_PRESENTED"])
    .lt("updated_at", twoHoursAgo)

  // Stuck customer conversations
  const { count: stuckCustConvs } = await sb.from("customer_conversations")
    .select("id", { count: "exact", head: true })
    .in("state", ["COLLECTING", "QUOTING", "ASKING_DIMENSIONS", "AWAITING_PAYMENT"])
    .lt("updated_at", twoHoursAgo)

  // Unpaid customer deliveries
  const { count: unpaidCustomers } = await sb.from("customer_conversations")
    .select("id", { count: "exact", head: true })
    .eq("state", "AWAITING_PAYMENT")

  // Customer orders today
  const { count: custOrdersToday } = await sb.from("customer_conversations")
    .select("id", { count: "exact", head: true })
    .eq("state", "ORDER_PLACED")
    .gte("updated_at", since)

  const msg = [
    `Daily Summary:`,
    `Orders: ${totalOrders} (${completed.length} done, ${active.length} active, ${dispatching.length} dispatching)`,
    `Delivered: ${totalYards} yds | Revenue: $${Math.round(totalRevenue)} | Driver pay: $${Math.round(totalDriverPay)} | Margin: $${Math.round(margin)}`,
    `Pending driver payments: $${Math.round(pendingTotal)}`,
    `Customer orders today: ${custOrdersToday || 0}`,
    `Unpaid customer deliveries: ${unpaidCustomers || 0}`,
    (stuckDriverConvs || 0) > 0 ? `⚠ ${stuckDriverConvs} stuck driver convos` : "",
    (stuckCustConvs || 0) > 0 ? `⚠ ${stuckCustConvs} stuck customer convos` : "",
  ].filter(Boolean).join("\n")

  if (process.env.PAUSE_ADMIN_SMS === "true") {
    console.log(`[SMS PAUSED] Daily summary: ${msg.slice(0, 80)}`)
    return NextResponse.json({ sent: false, paused: true, summary: msg })
  }
  try {
    await tw.messages.create({ body: msg, from: FROM, to: `+1${ADMIN.replace(/\D/g, "")}` })
  } catch (e) { console.error("[daily-summary]", e) }
  if (ADMIN_2) { try { await tw.messages.create({ body: msg, from: FROM, to: `+1${ADMIN_2}` }) } catch (e) { console.error("[daily-summary admin2]", e) } }

  return NextResponse.json({ sent: true, summary: msg })
}
