import { NextResponse } from "next/server"
import { createAdminSupabase } from "@/lib/supabase"

export async function GET() {
  const sb = createAdminSupabase()
  const now = Date.now()
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const since = todayStart.toISOString()
  const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString()
  const fourHoursAgo = new Date(now - 4 * 60 * 60 * 1000).toISOString()
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()

  const [
    { data: ordersToday },
    { data: ordersWeek },
    { data: activeDriverConvs },
    { data: activeCustConvs },
    { data: staleOrders },
    { data: unpaidCustomers },
    { data: pendingDriverPay },
    { data: stuckDrivers },
    { data: stuckCustomers },
    { data: noShows },
    { data: recentSms },
    { data: recentCustSms },
    { data: driverCount },
    { data: salesAgents },
    { data: agentOrders },
    { data: pendingActionsRaw },
  ] = await Promise.all([
    // Orders today
    sb.from("dispatch_orders").select("id, status, yards_needed, price_quoted_cents, driver_pay_cents, cities(name), created_at").gte("created_at", since),
    // Orders this week
    sb.from("dispatch_orders").select("id, status, yards_needed, price_quoted_cents, driver_pay_cents").gte("created_at", weekAgo),
    // Active driver conversations
    sb.from("conversations").select("phone, state, extracted_city, active_order_id, updated_at")
      .in("state", ["ACTIVE", "OTW_PENDING", "PHOTO_PENDING", "APPROVAL_PENDING", "JOB_PRESENTED", "ASKING_TRUCK", "ASKING_ADDRESS"])
      .order("updated_at", { ascending: false }).limit(20),
    // Active customer conversations — include agent + material + source for sales view
    sb.from("customer_conversations").select("phone, customer_name, state, delivery_city, yards_needed, total_price_cents, material_type, agent_id, source_number, updated_at")
      .in("state", ["COLLECTING", "QUOTING", "ASKING_DIMENSIONS", "ORDER_PLACED", "AWAITING_PAYMENT", "AWAITING_PRIORITY_PAYMENT", "FOLLOW_UP"])
      .order("updated_at", { ascending: false }).limit(50),
    // Stale orders (dispatching 4h+)
    sb.from("dispatch_orders").select("id, client_name, yards_needed, driver_pay_cents, cities(name), created_at")
      .eq("status", "dispatching").lt("created_at", fourHoursAgo),
    // Unpaid customer deliveries
    sb.from("customer_conversations").select("phone, customer_name, total_price_cents, updated_at")
      .eq("state", "AWAITING_PAYMENT"),
    // Pending driver payments
    sb.from("driver_payments").select("id, amount_cents, created_at, status").eq("status", "pending"),
    // Stuck driver convos (2h+ no update)
    sb.from("conversations").select("phone, state, updated_at")
      .in("state", ["ACTIVE", "OTW_PENDING", "PHOTO_PENDING", "APPROVAL_PENDING"]).lt("updated_at", twoHoursAgo),
    // Stuck customer convos (2h+ no update)
    sb.from("customer_conversations").select("phone, customer_name, state, updated_at")
      .in("state", ["COLLECTING", "QUOTING", "ASKING_DIMENSIONS", "AWAITING_PAYMENT"]).lt("updated_at", twoHoursAgo),
    // Driver no-shows (OTW 3h+)
    sb.from("conversations").select("phone, active_order_id, updated_at")
      .eq("state", "OTW_PENDING").lt("updated_at", new Date(now - 3 * 60 * 60 * 1000).toISOString()),
    // Recent driver SMS
    sb.from("sms_logs").select("phone, body, direction, created_at").order("created_at", { ascending: false }).limit(30),
    // Recent customer SMS
    sb.from("customer_sms_logs").select("phone, body, direction, created_at").order("created_at", { ascending: false }).limit(30),
    // Total active drivers
    sb.from("driver_profiles").select("id", { count: "exact", head: true }).eq("status", "active"),
    // Sales agents
    sb.from("sales_agents").select("id, name, twilio_number, commission_rate").eq("active", true),
    // Agent order stats — customer orders with agent attribution (today)
    sb.from("customer_conversations").select("agent_id, state, total_price_cents, payment_status")
      .not("agent_id", "is", null)
      .gte("updated_at", weekAgo),
    // Pending manual actions — every stuck-path the brain handed off to a human
    sb.from("customer_sms_logs").select("id, phone, body, message_sid, created_at")
      .eq("direction", "pending_action")
      .gte("created_at", new Date(now - 48 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: true }),
  ])

  // Calculate metrics
  const completed = ordersToday?.filter(o => o.status === "completed") || []
  const todayRevenue = completed.reduce((s, o) => s + ((o.price_quoted_cents || 0) / 100), 0)
  const todayDriverPay = completed.reduce((s, o) => s + ((o.driver_pay_cents || 0) / 100), 0)
  const todayYards = completed.reduce((s, o) => s + (o.yards_needed || 0), 0)
  const todayMargin = todayRevenue - todayDriverPay

  const weekCompleted = ordersWeek?.filter(o => o.status === "completed") || []
  const weekRevenue = weekCompleted.reduce((s, o) => s + ((o.price_quoted_cents || 0) / 100), 0)
  const weekYards = weekCompleted.reduce((s, o) => s + (o.yards_needed || 0), 0)

  const pendingPayTotal = (pendingDriverPay || []).reduce((s, p) => s + p.amount_cents / 100, 0)
  const unpaidCustTotal = (unpaidCustomers || []).reduce((s, c) => s + ((c.total_price_cents || 0) / 100), 0)

  // ── Pending manual actions (the never-stuck handoff queue) ──
  // Each row in customer_sms_logs with direction='pending_action' is a stuck
  // path the brain handed off to a human. Body format: "TYPE | message".
  // We enrich each one with the customer's current conversation state so the
  // dashboard can show name, phone, current state, last activity.
  const pendingActions: Array<{
    id: string
    phone: string
    type: string
    message: string
    created_at: string
    minutesOld: number
    customer_name: string | null
    state: string | null
    delivery_city: string | null
    yards_needed: number | null
    total_price_cents: number | null
  }> = []
  if (pendingActionsRaw && pendingActionsRaw.length > 0) {
    const phones = Array.from(new Set(pendingActionsRaw.map((r: any) => r.phone).filter((p: string) => p && p !== "system")))
    let convsByPhone: Record<string, any> = {}
    if (phones.length > 0) {
      const { data: convs } = await sb
        .from("customer_conversations")
        .select("phone, customer_name, state, delivery_city, yards_needed, total_price_cents")
        .in("phone", phones)
      for (const c of (convs || [])) convsByPhone[c.phone] = c
    }
    for (const r of pendingActionsRaw) {
      const [type, ...rest] = (r.body || "").split(" | ")
      const message = rest.join(" | ") || r.body || ""
      const conv = convsByPhone[r.phone] || {}
      pendingActions.push({
        id: r.id,
        phone: r.phone,
        type: type || "UNKNOWN",
        message,
        created_at: r.created_at,
        minutesOld: Math.round((now - new Date(r.created_at).getTime()) / 60000),
        customer_name: conv.customer_name || null,
        state: conv.state || null,
        delivery_city: conv.delivery_city || null,
        yards_needed: conv.yards_needed || null,
        total_price_cents: conv.total_price_cents || null,
      })
    }
  }

  // Build agent pipeline — leads, quoted $, orders per agent
  const agentMap: Record<string, { name: string; leads: number; quotedCents: number; orders: number; paidCents: number }> = {}
  for (const a of (salesAgents || [])) {
    agentMap[a.id] = { name: a.name, leads: 0, quotedCents: 0, orders: 0, paidCents: 0 }
  }
  for (const c of (activeCustConvs || [])) {
    if (c.agent_id && agentMap[c.agent_id]) {
      agentMap[c.agent_id].leads++
      if (c.total_price_cents) agentMap[c.agent_id].quotedCents += c.total_price_cents
      if (c.state === "ORDER_PLACED" || c.state === "AWAITING_PAYMENT" || c.state === "AWAITING_PRIORITY_PAYMENT") agentMap[c.agent_id].orders++
    }
  }
  for (const o of (agentOrders || [])) {
    if (o.agent_id && agentMap[o.agent_id] && o.payment_status === "paid") {
      agentMap[o.agent_id].paidCents += o.total_price_cents || 0
    }
  }
  const agentPipeline = Object.entries(agentMap).map(([id, v]) => ({ id, ...v }))
  // Count unassigned active customer convos
  const unassignedLeads = (activeCustConvs || []).filter((c: any) => !c.agent_id).length

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    revenue: {
      today: { orders: ordersToday?.length || 0, completed: completed.length, yards: todayYards, revenue: Math.round(todayRevenue), driverPay: Math.round(todayDriverPay), margin: Math.round(todayMargin) },
      week: { orders: ordersWeek?.length || 0, completed: weekCompleted.length, yards: weekYards, revenue: Math.round(weekRevenue) },
    },
    alerts: {
      staleOrders: staleOrders?.length || 0,
      unpaidCustomers: unpaidCustomers?.length || 0,
      unpaidCustomerTotal: Math.round(unpaidCustTotal),
      stuckDriverConvs: stuckDrivers?.length || 0,
      stuckCustomerConvs: stuckCustomers?.length || 0,
      driverNoShows: noShows?.length || 0,
      pendingDriverPayments: pendingDriverPay?.length || 0,
      pendingDriverPayTotal: Math.round(pendingPayTotal),
    },
    activeConversations: {
      drivers: activeDriverConvs || [],
      customers: activeCustConvs || [],
    },
    agentPipeline,
    unassignedLeads,
    salesAgents: (salesAgents || []).map((a: any) => ({ id: a.id, name: a.name })),
    staleOrders: staleOrders || [],
    unpaidCustomers: unpaidCustomers || [],
    stuckDrivers: stuckDrivers || [],
    stuckCustomers: stuckCustomers || [],
    noShows: noShows || [],
    recentSms: recentSms || [],
    recentCustSms: recentCustSms || [],
    driverCount: driverCount || 0,
    pendingActions,
  })
}
