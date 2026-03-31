import { NextResponse } from "next/server"
import { createAdminSupabase } from "@/lib/supabase"
import { requireAdmin } from "@/lib/admin-auth"

export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const sb = createAdminSupabase()
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const since1h = new Date(Date.now() - 60 * 60 * 1000).toISOString()

  const [
    { data: activeConvs },
    { data: recentMsgs },
    { data: orderStats },
    { data: recentPayments },
    { data: smsLog },
  ] = await Promise.all([
    sb.from("conversations")
      .select("phone, state, extracted_city, extracted_truck_type, extracted_yards, updated_at, photo_public_url, pending_approval_order_id, active_order_id")
      .in("state", ["DISCOVERY", "ASKING_TRUCK", "PHOTO_PENDING", "APPROVAL_PENDING", "ACTIVE", "OTW_PENDING", "PAYMENT_METHOD_PENDING", "PAYMENT_ACCOUNT_PENDING", "AWAITING_CUSTOMER_CONFIRM", "GETTING_NAME"])
      .order("updated_at", { ascending: false }),
    sb.from("sms_logs")
      .select("phone, body, direction, created_at")
      .gte("created_at", since1h)
      .order("created_at", { ascending: false })
      .limit(50),
    sb.from("dispatch_orders")
      .select("status, yards_needed, driver_pay_cents, cities(name)")
      .gte("created_at", since24h),
    sb.from("driver_payments")
      .select("amount_cents, status, created_at, driver_phone")
      .gte("created_at", since24h)
      .order("created_at", { ascending: false }),
    sb.from("sms_logs")
      .select("phone, body, direction, created_at")
      .order("created_at", { ascending: false })
      .limit(100),
  ])

  const statusCounts: Record<string, number> = {}
  let totalYards = 0
  let totalRevenue = 0
  for (const o of orderStats || []) {
    statusCounts[o.status] = (statusCounts[o.status] || 0) + 1
    if (o.status === "active" || o.status === "completed") totalYards += o.yards_needed || 0
    if (o.status === "completed") totalRevenue += (o.driver_pay_cents || 0) / 100
  }

  const pendingPay = (recentPayments || []).filter(p => p.status === "pending").reduce((s, p) => s + p.amount_cents / 100, 0)
  const paidOut = (recentPayments || []).filter(p => p.status === "paid").reduce((s, p) => s + p.amount_cents / 100, 0)

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    activeConversations: activeConvs || [],
    liveMessages: smsLog || [],
    orderStats: { statusCounts, totalYards, totalRevenue },
    payments: { pending: pendingPay, paid: paidOut, records: recentPayments || [] },
  })
}
