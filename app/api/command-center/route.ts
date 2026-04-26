import { NextResponse } from "next/server"
import { createAdminSupabase } from "@/lib/supabase"
import { requireAdmin } from "@/lib/admin-auth"

export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const sb = createAdminSupabase()
  const now = Date.now()
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const since = todayStart.toISOString()
  const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString()
  const fourHoursAgo = new Date(now - 4 * 60 * 60 * 1000).toISOString()
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString()

  // ═══════════════════════════════════════════════════════
  // PARALLEL QUERY BATCH 1 — core data
  // ═══════════════════════════════════════════════════════
  let ordersToday: any[] | null = null
  let ordersWeek: any[] | null = null
  let ordersMonth: any[] | null = null
  let activeDriverConvs: any[] | null = null
  let activeCustConvs: any[] | null = null
  let staleOrders: any[] | null = null
  let unpaidCustomers: any[] | null = null
  let pendingDriverPay: any[] | null = null
  let stuckDrivers: any[] | null = null
  let stuckCustomers: any[] | null = null
  let noShows: any[] | null = null
  let recentSms: any[] | null = null
  let recentCustSms: any[] | null = null
  let driverCount: any[] | null = null
  let salesAgents: any[] | null = null
  let pendingActionsRaw: any[] | null = null
  let allCustConvs: any[] | null = null
  let completedOrdersMonth: any[] | null = null
  let brainCrashes: any[] | null = null
  let dailyOrders: any[] | null = null
  let mapPinsRaw: any[] | null = null
  let driverCountRaw = 0

  try {
  const results = await Promise.allSettled([
    // Orders today
    sb.from("dispatch_orders").select("id, status, yards_needed, price_quoted_cents, driver_pay_cents, cities(name), created_at, agent_id, source_number").gte("created_at", since),
    // Orders this week
    sb.from("dispatch_orders").select("id, status, yards_needed, price_quoted_cents, driver_pay_cents, created_at, agent_id").gte("created_at", weekAgo),
    // Orders this month (for trends)
    sb.from("dispatch_orders").select("id, status, yards_needed, price_quoted_cents, driver_pay_cents, created_at, agent_id").gte("created_at", thirtyDaysAgo),
    // Active driver conversations
    sb.from("conversations").select("phone, state, extracted_city, extracted_truck_type, active_order_id, needs_human_review, updated_at")
      .in("state", ["ACTIVE", "OTW_PENDING", "PHOTO_PENDING", "APPROVAL_PENDING", "JOB_PRESENTED", "ASKING_TRUCK", "ASKING_ADDRESS"])
      .order("updated_at", { ascending: false }).limit(20),
    // ALL customer conversations in the last 30 days — no state filter.
    // The dashboard is the source of truth for "what's happening with customers",
    // so we never hide a conversation based on state. DELIVERED/CANCELED/CLOSED
    // conversations still need to be visible with full context.
    sb.from("customer_conversations").select("phone, customer_name, state, delivery_city, delivery_address, yards_needed, total_price_cents, material_type, agent_id, source_number, payment_status, order_type, priority_total_cents, dispatch_order_id, needs_human_review, created_at, updated_at")
      .gte("created_at", thirtyDaysAgo)
      .order("updated_at", { ascending: false }).limit(500),
    // Stale orders (dispatching 4h+)
    sb.from("dispatch_orders").select("id, client_name, yards_needed, driver_pay_cents, price_quoted_cents, cities(name), created_at")
      .eq("status", "dispatching").lt("created_at", fourHoursAgo),
    // Unpaid customer deliveries
    sb.from("customer_conversations").select("phone, customer_name, total_price_cents, agent_id, updated_at")
      .eq("state", "AWAITING_PAYMENT"),
    // Pending driver payments
    sb.from("driver_payments").select("id, amount_cents, created_at, status").eq("status", "pending"),
    // Stuck driver convos (2h+ no update)
    sb.from("conversations").select("phone, state, updated_at")
      .in("state", ["ACTIVE", "OTW_PENDING", "PHOTO_PENDING", "APPROVAL_PENDING"]).lt("updated_at", twoHoursAgo),
    // Stuck customer convos (2h+ no update)
    sb.from("customer_conversations").select("phone, customer_name, state, agent_id, total_price_cents, updated_at")
      .in("state", ["COLLECTING", "QUOTING", "ASKING_DIMENSIONS", "AWAITING_PAYMENT"]).lt("updated_at", twoHoursAgo),
    // Driver no-shows (OTW 3h+)
    sb.from("conversations").select("phone, active_order_id, updated_at")
      .eq("state", "OTW_PENDING").lt("updated_at", new Date(now - 3 * 60 * 60 * 1000).toISOString()),
    // Recent driver SMS
    sb.from("sms_logs").select("phone, body, direction, created_at").order("created_at", { ascending: false }).limit(30),
    // Customer SMS — load enough to cover all active conversations (not just 30 globally)
    sb.from("customer_sms_logs").select("phone, body, direction, created_at").order("created_at", { ascending: false }).limit(500),
    // Total active drivers
    sb.from("driver_profiles").select("id", { count: "exact", head: true }).eq("status", "active"),
    // Sales agents
    sb.from("sales_agents").select("id, name, twilio_number, commission_rate").eq("active", true),
    // Pending manual actions
    sb.from("customer_sms_logs").select("id, phone, body, message_sid, created_at")
      .eq("direction", "pending_action")
      .gte("created_at", new Date(now - 48 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: true }),
    // [REMOVED] Query 16 was a duplicate of query 4 — use activeCustConvs for funnel + pipeline
    // Completed dispatch orders this month (for agent revenue tracking)
    sb.from("dispatch_orders").select("id, status, price_quoted_cents, driver_pay_cents, agent_id, cities(name), created_at")
      .eq("status", "completed").gte("created_at", thirtyDaysAgo),
    // Brain crashes (stuck loops, Sonnet failures) — last 7 days
    sb.from("customer_sms_logs").select("id, phone, body, created_at")
      .eq("direction", "pending_action")
      .like("body", "BRAIN_CRASH%")
      .gte("created_at", weekAgo),
    // Daily order counts for sparkline (last 14 days)
    sb.from("dispatch_orders").select("id, status, price_quoted_cents, driver_pay_cents, created_at")
      .gte("created_at", new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString()),
    // Map pins — all customer conversations with coordinates (30 days)
    sb.from("customer_conversations").select("phone, customer_name, state, delivery_city, delivery_lat, delivery_lng, yards_needed, total_price_cents, material_type, delivery_address, dispatch_order_id, agent_id, updated_at")
      .not("delivery_lat", "is", null).not("delivery_lng", "is", null)
      .gte("created_at", thirtyDaysAgo),
  ])

  // Extract data from allSettled — each result is either {status:'fulfilled', value} or {status:'rejected', reason}
  // A fulfilled Supabase query returns {data, error} — use .data if fulfilled, null otherwise
  const safe = (i: number) => results[i].status === "fulfilled" ? (results[i] as any).value?.data : null
  ordersToday = safe(0)
  ordersWeek = safe(1)
  ordersMonth = safe(2)
  activeDriverConvs = safe(3)
  activeCustConvs = safe(4)
  staleOrders = safe(5)
  unpaidCustomers = safe(6)
  pendingDriverPay = safe(7)
  stuckDrivers = safe(8)
  stuckCustomers = safe(9)
  noShows = safe(10)
  recentSms = safe(11)
  recentCustSms = safe(12)
  driverCount = safe(13)
  salesAgents = safe(14)
  pendingActionsRaw = safe(15)
  // Query 16 removed — use activeCustConvs (query 4) for funnel + pipeline
  allCustConvs = activeCustConvs
  completedOrdersMonth = safe(16)
  brainCrashes = safe(17)
  dailyOrders = safe(18)
  mapPinsRaw = safe(19)
  // Special case: query 13 uses head:true so count is in .count not .data
  driverCountRaw = results[13].status === "fulfilled"
    ? (results[13] as any).value?.count ?? 0
    : 0
  // Log any failed queries (non-fatal — partial data is better than no data)
  results.forEach((r, i) => {
    if (r.status === "rejected") console.error(`[command-center] query ${i} failed:`, r.reason)
  })
  } catch (err) {
    console.error("Command center query batch failed:", err)
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      error: "Partial failure — one or more queries failed",
      revenue: null,
      financial: null,
      funnel: null,
      stateFunnel: {},
      alerts: null,
      activeConversations: null,
      agentPipeline: null,
      unassignedLeads: null,
      salesAgents: null,
      cityIntel: null,
      dailyTrend: null,
      brainHealth: null,
      mapPins: null,
      staleOrders: null,
      unpaidCustomers: null,
      stuckDrivers: null,
      stuckCustomers: null,
      noShows: null,
      recentSms: null,
      recentCustSms: null,
      driverCount: null,
      pendingActions: null,
    }, { status: 207 })
  }

  // ═══════════════════════════════════════════════════════
  // REVENUE CALCULATIONS
  // ═══════════════════════════════════════════════════════
  const completed = ordersToday?.filter(o => o.status === "completed") || []
  const todayRevenue = completed.reduce((s, o) => s + ((o.price_quoted_cents || 0) / 100), 0)
  const todayDriverPay = completed.reduce((s, o) => s + ((o.driver_pay_cents || 0) / 100), 0)
  const todayYards = completed.reduce((s, o) => s + (o.yards_needed || 0), 0)
  const todayMargin = todayRevenue - todayDriverPay

  const weekCompleted = ordersWeek?.filter(o => o.status === "completed") || []
  const weekRevenue = weekCompleted.reduce((s, o) => s + ((o.price_quoted_cents || 0) / 100), 0)
  const weekDriverPay = weekCompleted.reduce((s, o) => s + ((o.driver_pay_cents || 0) / 100), 0)
  const weekYards = weekCompleted.reduce((s, o) => s + (o.yards_needed || 0), 0)
  const weekMargin = weekRevenue - weekDriverPay

  const monthCompleted = completedOrdersMonth || []
  const monthRevenue = monthCompleted.reduce((s: number, o: any) => s + ((o.price_quoted_cents || 0) / 100), 0)
  const monthDriverPay = monthCompleted.reduce((s: number, o: any) => s + ((o.driver_pay_cents || 0) / 100), 0)

  const pendingPayTotal = (pendingDriverPay || []).reduce((s, p) => s + p.amount_cents / 100, 0)
  const unpaidCustTotal = (unpaidCustomers || []).reduce((s, c) => s + ((c.total_price_cents || 0) / 100), 0)

  // ═══════════════════════════════════════════════════════
  // CONVERSION FUNNEL (30-day)
  // ═══════════════════════════════════════════════════════
  const allConvs = allCustConvs || []
  const funnelTotal = allConvs.length
  const funnelQuoted = allConvs.filter((c: any) => c.total_price_cents && c.total_price_cents > 0).length
  const funnelOrdered = allConvs.filter((c: any) => c.dispatch_order_id).length
  const funnelDelivered = allConvs.filter((c: any) => c.state === "DELIVERED" || c.state === "AWAITING_PAYMENT").length
  const funnelPaid = allConvs.filter((c: any) => c.payment_status === "paid" || c.payment_status === "confirming").length
  // Include ORDER_PLACED + completed dispatch orders as "ordered"
  const funnelOrderedAlt = allConvs.filter((c: any) =>
    ["ORDER_PLACED", "AWAITING_PAYMENT", "AWAITING_PRIORITY_PAYMENT", "DELIVERED"].includes(c.state) || c.dispatch_order_id
  ).length

  // ═══════════════════════════════════════════════════════
  // STATE-BASED FUNNEL (FIX 4) — direct state → count mapping
  // ═══════════════════════════════════════════════════════
  const stateFunnel: Record<string, number> = {}
  for (const c of allConvs) {
    const st = (c as any).state || "UNKNOWN"
    stateFunnel[st] = (stateFunnel[st] || 0) + 1
  }

  // ═══════════════════════════════════════════════════════
  // AGENT PIPELINE — Quoted $ → Ordered $ → Completed $
  // ═══════════════════════════════════════════════════════
  type AgentPipeline = {
    name: string
    commissionRate: number
    // Counts
    totalLeads: number
    activeLeads: number
    quotedCount: number
    orderedCount: number
    completedCount: number
    paidCount: number
    // Dollars
    quotedCents: number
    orderedCents: number
    completedCents: number
    paidCents: number
    // Derived
    closeRate: number
    avgDealCents: number
    commissionCents: number
  }
  const agentMap: Record<string, AgentPipeline> = {}
  for (const a of (salesAgents || [])) {
    agentMap[a.id] = {
      name: a.name,
      commissionRate: a.commission_rate || 0.10,
      totalLeads: 0, activeLeads: 0,
      quotedCount: 0, orderedCount: 0, completedCount: 0, paidCount: 0,
      quotedCents: 0, orderedCents: 0, completedCents: 0, paidCents: 0,
      closeRate: 0, avgDealCents: 0, commissionCents: 0,
    }
  }

  // Process ALL customer conversations (30-day) for pipeline
  for (const c of allConvs) {
    const aid = (c as any).agent_id
    if (!aid || !agentMap[aid]) continue
    const a = agentMap[aid]
    a.totalLeads++

    const price = (c as any).total_price_cents || 0
    const isActive = ["COLLECTING", "QUOTING", "ASKING_DIMENSIONS", "FOLLOW_UP"].includes((c as any).state)
    const isOrdered = ["ORDER_PLACED", "AWAITING_PAYMENT", "AWAITING_PRIORITY_PAYMENT"].includes((c as any).state)
    const isDelivered = (c as any).state === "DELIVERED" || (c as any).state === "AWAITING_PAYMENT"
    const isPaid = (c as any).payment_status === "paid" || (c as any).payment_status === "confirming"

    if (isActive) a.activeLeads++
    if (price > 0) { a.quotedCount++; a.quotedCents += price }
    if ((c as any).dispatch_order_id || isOrdered) { a.orderedCount++; a.orderedCents += price }
    if (isPaid) { a.paidCount++; a.paidCents += price }
  }

  // Add completed dispatch orders revenue per agent
  for (const o of monthCompleted) {
    const aid = (o as any).agent_id
    if (!aid || !agentMap[aid]) continue
    agentMap[aid].completedCount++
    agentMap[aid].completedCents += (o as any).price_quoted_cents || 0
  }

  // Calculate derived metrics
  for (const a of Object.values(agentMap)) {
    a.closeRate = a.totalLeads > 0 ? Math.round((a.orderedCount / a.totalLeads) * 100) : 0
    a.avgDealCents = a.orderedCount > 0 ? Math.round(a.orderedCents / a.orderedCount) : 0
    a.commissionCents = Math.round(a.paidCents * a.commissionRate)
  }

  const agentPipeline = Object.entries(agentMap).map(([id, v]) => ({ id, ...v }))
  const unassignedLeads = (activeCustConvs || []).filter((c: any) => !c.agent_id).length

  // ═══════════════════════════════════════════════════════
  // CITY INTELLIGENCE
  // ═══════════════════════════════════════════════════════
  const cityMap: Record<string, { orders: number; completed: number; revenue: number; driverPay: number; yards: number; dispatching: number }> = {}
  for (const o of (ordersMonth || [])) {
    const cityName = (o as any).cities?.name || "Unknown"
    if (!cityMap[cityName]) cityMap[cityName] = { orders: 0, completed: 0, revenue: 0, driverPay: 0, yards: 0, dispatching: 0 }
    cityMap[cityName].orders++
    cityMap[cityName].yards += (o as any).yards_needed || 0
    if ((o as any).status === "completed") {
      cityMap[cityName].completed++
      cityMap[cityName].revenue += ((o as any).price_quoted_cents || 0) / 100
      cityMap[cityName].driverPay += ((o as any).driver_pay_cents || 0) / 100
    }
    if ((o as any).status === "dispatching") cityMap[cityName].dispatching++
  }
  const cityIntel = Object.entries(cityMap)
    .map(([name, v]) => ({ name, ...v, margin: Math.round(v.revenue - v.driverPay), marginPct: v.revenue > 0 ? Math.round(((v.revenue - v.driverPay) / v.revenue) * 100) : 0 }))
    .sort((a, b) => b.revenue - a.revenue)

  // ═══════════════════════════════════════════════════════
  // DAILY SPARKLINE (last 14 days)
  // ═══════════════════════════════════════════════════════
  const dailyMap: Record<string, { orders: number; completed: number; revenue: number; margin: number }> = {}
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now - i * 24 * 60 * 60 * 1000)
    const key = d.toISOString().slice(0, 10)
    dailyMap[key] = { orders: 0, completed: 0, revenue: 0, margin: 0 }
  }
  for (const o of (dailyOrders || [])) {
    const key = new Date((o as any).created_at).toISOString().slice(0, 10)
    if (!dailyMap[key]) continue
    dailyMap[key].orders++
    if ((o as any).status === "completed") {
      dailyMap[key].completed++
      const rev = ((o as any).price_quoted_cents || 0) / 100
      const pay = ((o as any).driver_pay_cents || 0) / 100
      dailyMap[key].revenue += rev
      dailyMap[key].margin += rev - pay
    }
  }
  const dailyTrend = Object.entries(dailyMap).map(([date, v]) => ({ date, ...v }))

  // ═══════════════════════════════════════════════════════
  // BRAIN HEALTH
  // ═══════════════════════════════════════════════════════
  const brainCrashCount = brainCrashes?.length || 0
  // Count pending actions by type
  const actionTypeCounts: Record<string, number> = {}
  for (const r of (pendingActionsRaw || [])) {
    const type = ((r as any).body || "").split(" | ")[0] || "UNKNOWN"
    actionTypeCounts[type] = (actionTypeCounts[type] || 0) + 1
  }

  // ═══════════════════════════════════════════════════════
  // FINANCIAL SUMMARY
  // ═══════════════════════════════════════════════════════
  // Outstanding = orders confirmed but not yet paid
  const outstandingCents = allConvs
    .filter((c: any) => ["ORDER_PLACED", "AWAITING_PAYMENT"].includes(c.state) && c.total_price_cents)
    .reduce((s: number, c: any) => s + (c.total_price_cents || 0), 0)
  // Collected = paid orders this month
  const collectedCents = allConvs
    .filter((c: any) => c.payment_status === "paid" || c.payment_status === "confirming")
    .reduce((s: number, c: any) => s + (c.total_price_cents || 0), 0)
  // Pipeline = quoted but not yet ordered
  const pipelineCents = allConvs
    .filter((c: any) => ["QUOTING", "FOLLOW_UP"].includes(c.state) && c.total_price_cents)
    .reduce((s: number, c: any) => s + (c.total_price_cents || 0), 0)

  // ═══════════════════════════════════════════════════════
  // PENDING ACTIONS (enriched) — wrapped in own try/catch so
  // enrichment failure doesn't nuke the entire response
  // ═══════════════════════════════════════════════════════
  let pendingActions: Array<{
    id: string; phone: string; type: string; message: string
    created_at: string; minutesOld: number
    customer_name: string | null; state: string | null
    delivery_city: string | null; yards_needed: number | null
    total_price_cents: number | null
  }> = []
  try {
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
        const [type, ...rest] = ((r as any).body || "").split(" | ")
        const message = rest.join(" | ") || (r as any).body || ""
        const conv = convsByPhone[(r as any).phone] || {}
        pendingActions.push({
          id: (r as any).id, phone: (r as any).phone, type: type || "UNKNOWN", message,
          created_at: (r as any).created_at,
          minutesOld: Math.round((now - new Date((r as any).created_at).getTime()) / 60000),
          customer_name: conv.customer_name || null, state: conv.state || null,
          delivery_city: conv.delivery_city || null, yards_needed: conv.yards_needed || null,
          total_price_cents: conv.total_price_cents || null,
        })
      }
    }
  } catch (enrichErr) {
    console.error("[command-center] pending actions enrichment failed:", enrichErr)
    // Fall back to raw pending actions without enrichment — non-fatal
    pendingActions = (pendingActionsRaw || []).map((r: any) => {
      const [type, ...rest] = ((r as any).body || "").split(" | ")
      return {
        id: r.id, phone: r.phone, type: type || "UNKNOWN",
        message: rest.join(" | ") || r.body || "",
        created_at: r.created_at,
        minutesOld: Math.round((now - new Date(r.created_at).getTime()) / 60000),
        customer_name: null, state: null, delivery_city: null,
        yards_needed: null, total_price_cents: null,
      }
    })
  }

  // ═══════════════════════════════════════════════════════
  // RESPONSE
  // ═══════════════════════════════════════════════════════
  return NextResponse.json({
    timestamp: new Date().toISOString(),

    // Executive KPIs
    revenue: {
      today: { orders: ordersToday?.length || 0, completed: completed.length, yards: todayYards, revenue: Math.round(todayRevenue), driverPay: Math.round(todayDriverPay), margin: Math.round(todayMargin) },
      week: { orders: ordersWeek?.length || 0, completed: weekCompleted.length, yards: weekYards, revenue: Math.round(weekRevenue), driverPay: Math.round(weekDriverPay), margin: Math.round(weekMargin) },
      month: { orders: ordersMonth?.length || 0, completed: monthCompleted.length, revenue: Math.round(monthRevenue), driverPay: Math.round(monthDriverPay), margin: Math.round(monthRevenue - monthDriverPay) },
    },

    // Financial summary
    financial: {
      pipelineCents,
      outstandingCents,
      collectedCents,
      unpaidCustomerCents: Math.round(unpaidCustTotal * 100),
      pendingDriverPayCents: Math.round(pendingPayTotal * 100),
    },

    // Conversion funnel (30-day) — legacy derived funnel
    funnel: {
      leads: funnelTotal,
      quoted: funnelQuoted,
      ordered: funnelOrderedAlt,
      delivered: funnelDelivered,
      paid: funnelPaid,
    },

    // State-based funnel — direct conversation_state → count
    stateFunnel,

    // Alerts
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

    // Conversations
    activeConversations: {
      drivers: activeDriverConvs || [],
      customers: activeCustConvs || [],
    },

    // Agent pipeline (the $ tracking)
    agentPipeline,
    unassignedLeads,
    salesAgents: (salesAgents || []).map((a: any) => ({ id: a.id, name: a.name })),

    // City intelligence
    cityIntel,

    // Daily trend (sparkline data)
    dailyTrend,

    // Brain health
    brainHealth: {
      crashesThisWeek: brainCrashCount,
      pendingActionsByType: actionTypeCounts,
      totalPendingActions: pendingActions.length,
    },

    // Map pins for order visualization
    mapPins: (mapPinsRaw || []).map((p: any) => {
      const agent = (salesAgents || []).find((a: any) => a.id === p.agent_id)
      return {
        lat: p.delivery_lat, lng: p.delivery_lng,
        name: p.customer_name, phone: p.phone,
        city: p.delivery_city, address: p.delivery_address,
        state: p.state, yards: p.yards_needed,
        totalCents: p.total_price_cents,
        material: p.material_type,
        hasOrder: !!p.dispatch_order_id,
        agentName: agent?.name || "Unassigned",
        updated: p.updated_at,
      }
    }),

    // Lists
    staleOrders: staleOrders || [],
    unpaidCustomers: unpaidCustomers || [],
    stuckDrivers: stuckDrivers || [],
    stuckCustomers: stuckCustomers || [],
    noShows: noShows || [],
    recentSms: recentSms || [],
    recentCustSms: recentCustSms || [],
    driverCount: driverCountRaw,
    pendingActions,
  })
}
