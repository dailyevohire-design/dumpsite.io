"use client"
import { useState, useEffect, useRef, useCallback } from "react"
import * as Sentry from "@sentry/nextjs"
import { createBrowserSupabase } from "@/lib/supabase"
import { formatPhone } from "@/lib/format-phone"

type ConvSource = "driver" | "customer"

// ═══════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════
interface CommandData {
  timestamp: string
  error?: string
  revenue: {
    today: { orders: number; completed: number; yards: number; revenue: number; driverPay: number; margin: number }
    week: { orders: number; completed: number; yards: number; revenue: number; driverPay: number; margin: number }
    month: { orders: number; completed: number; revenue: number; driverPay: number; margin: number }
  } | null
  financial: { pipelineCents: number; outstandingCents: number; collectedCents: number; unpaidCustomerCents: number; pendingDriverPayCents: number } | null
  funnel: { leads: number; quoted: number; ordered: number; delivered: number; paid: number } | null
  stateFunnel: Record<string, number> | null
  alerts: {
    staleOrders: number; unpaidCustomers: number; unpaidCustomerTotal: number
    stuckDriverConvs: number; stuckCustomerConvs: number; driverNoShows: number
    pendingDriverPayments: number; pendingDriverPayTotal: number
  } | null
  activeConversations: { drivers: any[]; customers: any[] } | null
  agentPipeline: AgentPipeline[] | null
  unassignedLeads: number | null
  salesAgents: { id: string; name: string }[] | null
  cityIntel: CityData[] | null
  dailyTrend: { date: string; orders: number; completed: number; revenue: number; margin: number }[] | null
  brainHealth: { crashesThisWeek: number; pendingActionsByType: Record<string, number>; totalPendingActions: number } | null
  staleOrders: any[] | null
  unpaidCustomers: any[] | null
  stuckDrivers: any[] | null
  stuckCustomers: any[] | null
  noShows: any[] | null
  recentSms: any[] | null
  recentCustSms: any[] | null
  driverCount: number | null
  pendingActions: PendingAction[] | null
  mapPins: MapPin[] | null
}

interface MapPin {
  lat: number; lng: number; name: string; phone: string
  city: string; address: string; state: string; yards: number
  totalCents: number; material: string; hasOrder: boolean; agentName: string; updated: string
}

interface AgentPipeline {
  id: string; name: string; commissionRate: number
  totalLeads: number; activeLeads: number; quotedCount: number; orderedCount: number; completedCount: number; paidCount: number
  quotedCents: number; orderedCents: number; completedCents: number; paidCents: number
  closeRate: number; avgDealCents: number; commissionCents: number
}

interface CityData {
  name: string; orders: number; completed: number; revenue: number; driverPay: number; yards: number; dispatching: number; margin: number; marginPct: number
}

interface PendingAction {
  id: string; phone: string; type: string; message: string; created_at: string; minutesOld: number
  customer_name: string | null; state: string | null; delivery_city: string | null
  yards_needed: number | null; total_price_cents: number | null
}

// ═══════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════
const fmt$ = (v: number) => "$" + v.toLocaleString("en-US", { maximumFractionDigits: 0 })
const fmtCents = (cents: number | null | undefined) => {
  if (!cents && cents !== 0) return "$0"
  return "$" + (cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })
}

const ago = (ts: string | null | undefined) => {
  if (!ts) return "unknown"
  const m = Math.round((Date.now() - new Date(ts).getTime()) / 60000)
  if (m < 1) return "now"
  if (m < 60) return m + "m ago"
  if (m < 1440) return Math.round(m / 60) + "h ago"
  return Math.round(m / 1440) + "d ago"
}

const STATE_LABELS: Record<string, string> = {
  NEW: "New Lead", COLLECTING: "Collecting", ASKING_DIMENSIONS: "Collecting",
  QUOTING: "Qualifying", FOLLOW_UP: "Follow Up", ORDER_PLACED: "Placed",
  AWAITING_PAYMENT: "Awaiting Pay", AWAITING_PRIORITY_PAYMENT: "Awaiting Pay",
  DELIVERED: "Complete", CLOSED: "Lost", OUT_OF_AREA: "Lost", CANCELED: "Lost",
}

const STATE_COLORS: Record<string, string> = {
  NEW: "bg-gray-600", COLLECTING: "bg-blue-600", ASKING_DIMENSIONS: "bg-blue-600",
  QUOTING: "bg-amber-600", FOLLOW_UP: "bg-yellow-600", ORDER_PLACED: "bg-emerald-600",
  AWAITING_PAYMENT: "bg-orange-600", AWAITING_PRIORITY_PAYMENT: "bg-orange-600",
  DELIVERED: "bg-green-600", CLOSED: "bg-gray-700", OUT_OF_AREA: "bg-gray-700", CANCELED: "bg-gray-700",
}

const DRIVER_STATE_LABELS: Record<string, string> = {
  DISCOVERY: "Discovery", GETTING_NAME: "Onboard",
  ASKING_TRUCK: "Truck", ASKING_ADDRESS: "Address",
  PHOTO_PENDING: "Photo", APPROVAL_PENDING: "Approval",
  JOB_PRESENTED: "Job Presented", ACTIVE: "Active",
  OTW_PENDING: "On The Way",
  PAYMENT_METHOD_PENDING: "Payment", PAYMENT_ACCOUNT_PENDING: "Pay Account",
  AWAITING_CUSTOMER_CONFIRM: "Confirm", CLOSED: "Closed",
}

const DRIVER_STATE_COLORS: Record<string, string> = {
  DISCOVERY: "bg-indigo-600", GETTING_NAME: "bg-blue-600",
  ASKING_TRUCK: "bg-purple-600", ASKING_ADDRESS: "bg-purple-600",
  PHOTO_PENDING: "bg-amber-600", APPROVAL_PENDING: "bg-red-600",
  JOB_PRESENTED: "bg-cyan-600", ACTIVE: "bg-emerald-600",
  OTW_PENDING: "bg-cyan-600",
  PAYMENT_METHOD_PENDING: "bg-orange-600", PAYMENT_ACCOUNT_PENDING: "bg-orange-600",
  AWAITING_CUSTOMER_CONFIRM: "bg-purple-600", CLOSED: "bg-gray-700",
}

const FUNNEL_STAGES = [
  { key: "NEW", label: "New Lead", states: ["NEW"] },
  { key: "COLLECTING", label: "Collecting Info", states: ["COLLECTING", "ASKING_DIMENSIONS"] },
  { key: "QUOTING", label: "Quoted", states: ["QUOTING"] },
  { key: "FOLLOW_UP", label: "Follow Up", states: ["FOLLOW_UP"] },
  { key: "ORDER_PLACED", label: "Order Placed", states: ["ORDER_PLACED", "AWAITING_PAYMENT", "AWAITING_PRIORITY_PAYMENT"] },
  { key: "DELIVERED", label: "Completed", states: ["DELIVERED"] },
  { key: "LOST", label: "Lost", states: ["CLOSED", "OUT_OF_AREA", "CANCELED"] },
]

// ═══════════════════════════════════════════════════════
// SKELETON COMPONENTS
// ═══════════════════════════════════════════════════════
function SkeletonCard() {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 animate-pulse">
      <div className="h-3 w-20 bg-gray-800 rounded mb-3" />
      <div className="h-7 w-24 bg-gray-800 rounded mb-2" />
      <div className="h-3 w-16 bg-gray-800 rounded" />
    </div>
  )
}

function SkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-12 bg-gray-800/50 rounded" />
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════
// PER-SECTION ERROR COMPONENT
// ═══════════════════════════════════════════════════════
function SectionError({ label, onRetry }: { label: string; onRetry: () => void }) {
  return (
    <div className="p-4 text-center">
      <div className="text-sm text-gray-300">{label} unavailable</div>
      <button onClick={onRetry} className="text-xs text-gray-400 hover:text-gray-400 mt-1">Tap to retry</button>
    </div>
  )
}

// ═══════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════
export default function CommandCenterPage() {
  const [data, setData] = useState<CommandData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null)
  const [selectedSource, setSelectedSource] = useState<ConvSource | null>(null)
  const [funnelFilter, setFunnelFilter] = useState<string[] | null>(null)
  const [convLoading, setConvLoading] = useState(false)
  const [convDetail, setConvDetail] = useState<{ sms: any[]; conv: any; source: ConvSource } | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const conversationRef = useRef<HTMLDivElement>(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/command-center", { credentials: "include" })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
      setError(null)
    } catch (e: any) {
      setError(e.message || "Failed to load dashboard")
    } finally {
      setLoading(false)
    }
  }, [])

  const loadConversation = useCallback(async (phone: string, source: ConvSource) => {
    setConvLoading(true)
    setConvDetail(null)
    Sentry.addBreadcrumb({
      category: "command-center.conversation",
      message: `loadConversation phone=${phone} source=${source}`,
      level: "info",
    })
    try {
      const res = await fetch(
        `/api/command-center/conversation?phone=${encodeURIComponent(phone)}&source=${source}`,
        { credentials: "include" }
      )
      if (!res.ok) {
        Sentry.captureMessage(`conversation viewer HTTP ${res.status}`, {
          level: "error",
          tags: { route: "admin/command-center", phone, source },
        })
      }
      const d = await res.json()
      setConvDetail(d)
    } catch (err) {
      console.error("[conv-viewer]", err)
      Sentry.captureException(err, { tags: { route: "admin/command-center", phone, source } })
    } finally {
      setConvLoading(false)
    }
  }, [])

  const selectConversation = useCallback((phone: string | null, source: ConvSource | null) => {
    setSelectedPhone(phone)
    setSelectedSource(source)
    if (phone && source) loadConversation(phone, source)
    else setConvDetail(null)
  }, [loadConversation])

  useEffect(() => {
    fetchData()
    intervalRef.current = setInterval(fetchData, 30000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [fetchData])

  // Supabase realtime subscriptions — customer side
  useEffect(() => {
    const sb = createBrowserSupabase()
    const channel = sb.channel("command-center-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "customer_conversations" }, () => {
        fetchData()
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "customer_sms_logs" }, () => {
        fetchData()
      })
      .subscribe()

    return () => { sb.removeChannel(channel) }
  }, [fetchData])

  // Supabase realtime subscriptions — driver side (independent channel)
  useEffect(() => {
    const sb = createBrowserSupabase()
    const channel = sb.channel("command-center-live-driver")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => {
        fetchData()
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "sms_logs" }, () => {
        fetchData()
      })
      .subscribe()

    return () => { sb.removeChannel(channel) }
  }, [fetchData])

  // Scroll to conversation viewer when selected
  useEffect(() => {
    if (selectedPhone && conversationRef.current) {
      conversationRef.current.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }, [selectedPhone])

  // ─── Derived data ───
  const customers = data?.activeConversations?.customers || []
  const drivers = data?.activeConversations?.drivers || []
  const filteredCustomers = funnelFilter
    ? customers.filter((c: any) => funnelFilter.includes(c.state))
    : customers

  // On-demand loaded SMS thread (from /api/command-center/conversation)
  const smsForSelected = convDetail?.sms || []
  const selectedConv = convDetail?.conv
    || (selectedPhone && selectedSource === "customer"
        ? customers.find((c: any) => c.phone === selectedPhone)
        : selectedPhone && selectedSource === "driver"
          ? drivers.find((d: any) => d.phone === selectedPhone)
          : null)

  // Funnel stage counts from stateFunnel API response (preferred) or fallback to customer array
  const funnelCounts: Record<string, number> = {}
  if (data?.stateFunnel) {
    const sf = data.stateFunnel
    for (const stage of FUNNEL_STAGES) {
      funnelCounts[stage.key] = stage.states.reduce((sum, s) => sum + (sf[s] || 0), 0)
    }
  } else {
    for (const stage of FUNNEL_STAGES) {
      funnelCounts[stage.key] = customers.filter((c: any) => stage.states.includes(c.state)).length
    }
  }

  // Pipeline value
  const pipelineCents = data?.financial?.pipelineCents || 0

  // Anomaly count from brain health
  const anomalyCount = data?.brainHealth?.crashesThisWeek || 0

  // Pending follow-ups: conversations in FOLLOW_UP state
  const pendingFollowUps = customers.filter((c: any) => c.state === "FOLLOW_UP").length

  // ─── Error state ───
  if (error && !data) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="text-red-400 text-lg font-semibold mb-2">Dashboard unavailable</div>
          <div className="text-gray-300 text-sm mb-4">{error}</div>
          <button
            onClick={() => { setLoading(true); setError(null); fetchData() }}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg transition-colors"
          >
            Tap to retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <div className="border-b border-gray-800 px-4 py-3 flex items-center justify-between sticky top-0 bg-gray-950/95 backdrop-blur z-10">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold tracking-tight">Command Center</h1>
          {data?.timestamp && (
            <span className="text-xs text-gray-300">Updated {ago(data.timestamp)}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {error && <span className="text-xs text-red-400">Refresh failed</span>}
          <div className={`w-2 h-2 rounded-full ${error ? "bg-red-500" : "bg-emerald-500"} ${!error ? "animate-pulse" : ""}`} />
        </div>
      </div>

      <div className="p-4 max-w-[1600px] mx-auto space-y-4">
        {/* ═══ ROW 1: KPI Cards ═══ */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
          ) : (
            <>
              <KPICard
                label="Revenue Today"
                value={data?.revenue ? fmt$(data.revenue.today.revenue) : "--"}
                sub={data?.revenue ? `Margin ${fmt$(data.revenue.today.margin)}` : undefined}
                color="text-emerald-400"
              />
              {data && !data.revenue && (
                <div className="col-span-1"><SectionError label="Revenue" onRetry={fetchData} /></div>
              )}
              <KPICard
                label="Active Conversations"
                value={String(customers.length)}
                sub={data?.funnel ? `${data.funnel.leads} total leads (30d)` : undefined}
                color="text-blue-400"
              />
              <KPICard
                label="Orders Today"
                value={data?.revenue ? String(data.revenue.today.orders) : "--"}
                sub={data?.revenue ? `${data.revenue.today.completed} completed` : undefined}
                color="text-amber-400"
              />
              <KPICard
                label="Pipeline Value"
                value={data?.financial ? fmtCents(pipelineCents) : "--"}
                sub={`${funnelCounts["QUOTING"] || 0} quoted conversations`}
                color="text-purple-400"
              />
              {data && !data.financial && (
                <div className="col-span-1"><SectionError label="Financial" onRetry={fetchData} /></div>
              )}
              <KPICard
                label="Anomalies"
                value={data?.brainHealth ? String(anomalyCount) : "--"}
                sub={data?.brainHealth ? `${data.brainHealth.totalPendingActions || 0} pending actions` : undefined}
                color={anomalyCount > 0 ? "text-red-400" : "text-gray-400"}
                alert={anomalyCount > 0}
              />
              {data && !data.brainHealth && (
                <div className="col-span-1"><SectionError label="Brain Health" onRetry={fetchData} /></div>
              )}
              <KPICard
                label="Pending Follow-ups"
                value={String(pendingFollowUps)}
                sub={pendingFollowUps > 5 ? "High volume" : "Normal"}
                color={pendingFollowUps > 5 ? "text-orange-400" : "text-gray-400"}
              />
            </>
          )}
        </div>

        {/* ═══ ROW 2: Driver + Customer Live Conversations ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Driver Conversations (Jesse) */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden flex flex-col" style={{ maxHeight: 480 }}>
            <div className="px-4 py-3 border-b border-gray-800">
              <h2 className="text-sm font-semibold text-gray-300">Driver Conversations</h2>
            </div>
            {loading ? (
              <div className="p-4"><SkeletonList rows={8} /></div>
            ) : data && !data.activeConversations ? (
              <SectionError label="Driver Conversations" onRetry={fetchData} />
            ) : drivers.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">No active driver conversations</div>
            ) : (
              <div className="overflow-y-auto flex-1 divide-y divide-gray-800/30">
                {drivers.map((d: any) => {
                  const lastMsg = (data?.recentSms || []).find((s: any) => s.phone === d.phone)
                  const isSelected = selectedPhone === d.phone && selectedSource === "driver"
                  return (
                    <button
                      key={d.phone}
                      onClick={() => selectConversation(isSelected ? null : d.phone, isSelected ? null : "driver")}
                      className={`w-full px-4 py-3 flex items-start gap-3 hover:bg-gray-800/40 transition-colors text-left ${isSelected ? "bg-gray-800/60 border-l-2 border-blue-500" : ""}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm font-medium text-gray-200 truncate">
                            {formatPhone(d.phone)}
                          </span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${DRIVER_STATE_COLORS[d.state] || "bg-gray-700"} text-white shrink-0`}>
                            {DRIVER_STATE_LABELS[d.state] || d.state}
                          </span>
                          {d.needs_human_review && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-900 text-red-300 shrink-0">REVIEW</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {d.extracted_city && (
                            <span className="text-[11px] text-gray-400 shrink-0">{d.extracted_city}</span>
                          )}
                          {d.extracted_truck_type && (
                            <span className="text-[11px] text-gray-400 shrink-0">{d.extracted_truck_type}</span>
                          )}
                          {lastMsg && (
                            <p className="text-xs text-gray-300 truncate">{lastMsg.body}</p>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[10px] text-gray-400">{ago(d.updated_at)}</div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Live Conversation Feed (Customer) */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden flex flex-col" style={{ maxHeight: 480 }}>
            <div className="px-4 py-3 border-b border-gray-800">
              <h2 className="text-sm font-semibold text-gray-300">
                Live Conversations
                {funnelFilter && <span className="text-gray-300 font-normal ml-2">(filtered)</span>}
              </h2>
            </div>
            {loading ? (
              <div className="p-4"><SkeletonList rows={8} /></div>
            ) : data && !data.activeConversations ? (
              <SectionError label="Conversations" onRetry={fetchData} />
            ) : filteredCustomers.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">No conversations match filter</div>
            ) : (
              <div className="overflow-y-auto flex-1 divide-y divide-gray-800/30">
                {filteredCustomers.map((c: any) => {
                  const lastMsg = (data?.recentCustSms || []).find((s: any) => s.phone === c.phone)
                  const isSelected = selectedPhone === c.phone && selectedSource === "customer"
                  return (
                    <button
                      key={c.phone}
                      onClick={() => selectConversation(isSelected ? null : c.phone, isSelected ? null : "customer")}
                      className={`w-full px-4 py-3 flex items-start gap-3 hover:bg-gray-800/40 transition-colors text-left ${isSelected ? "bg-gray-800/60 border-l-2 border-blue-500" : ""}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm font-medium text-gray-200 truncate">
                            {c.customer_name || formatPhone(c.phone)}
                          </span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${STATE_COLORS[c.state] || "bg-gray-700"} text-white shrink-0`}>
                            {STATE_LABELS[c.state] || c.state}
                          </span>
                          {c.needs_human_review && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-900 text-red-300 shrink-0">REVIEW</span>
                          )}
                        </div>
                        {lastMsg && (
                          <p className="text-xs text-gray-300 truncate">{lastMsg.body}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        {c.total_price_cents && c.total_price_cents > 0 && (
                          <div className="text-xs font-semibold text-emerald-400">{fmtCents(c.total_price_cents)}</div>
                        )}
                        <div className="text-[10px] text-gray-400">{ago(c.updated_at)}</div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* ═══ ROW 3: Conversation Viewer ═══ */}
        <div ref={conversationRef} className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          {!selectedPhone ? (
            <div className="px-4 py-8 text-center text-gray-400 text-sm">
              Select a conversation above to view the SMS thread
            </div>
          ) : (
            <>
              {/* Conversation Header */}
              <div className="px-4 py-3 border-b border-gray-800 flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="font-semibold text-gray-200">
                  {selectedSource === "driver"
                    ? formatPhone(selectedPhone)
                    : (selectedConv?.customer_name || formatPhone(selectedPhone))}
                </span>
                <span className="text-xs text-gray-300 font-mono">{formatPhone(selectedPhone)}</span>
                {selectedConv && selectedSource === "customer" && (
                  <>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${STATE_COLORS[selectedConv.state] || "bg-gray-700"} text-white`}>
                      {STATE_LABELS[selectedConv.state] || selectedConv.state}
                    </span>
                    {selectedConv.delivery_address && (
                      <span className="text-xs text-gray-300">{selectedConv.delivery_address}</span>
                    )}
                    {selectedConv.yards_needed && (
                      <span className="text-xs text-gray-400">{selectedConv.yards_needed} yards</span>
                    )}
                    {selectedConv.material_type && (
                      <span className="text-xs text-gray-400">{selectedConv.material_type}</span>
                    )}
                    {selectedConv.total_price_cents > 0 && (
                      <span className="text-xs font-semibold text-emerald-400">{fmtCents(selectedConv.total_price_cents)}</span>
                    )}
                  </>
                )}
                {selectedConv && selectedSource === "driver" && (
                  <>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${DRIVER_STATE_COLORS[selectedConv.state] || "bg-gray-700"} text-white`}>
                      {DRIVER_STATE_LABELS[selectedConv.state] || selectedConv.state}
                    </span>
                    {selectedConv.extracted_city && (
                      <span className="text-xs text-gray-300">{selectedConv.extracted_city}</span>
                    )}
                    {selectedConv.extracted_truck_type && (
                      <span className="text-xs text-gray-400">{selectedConv.extracted_truck_type}</span>
                    )}
                    {selectedConv.extracted_yards && (
                      <span className="text-xs text-gray-400">{selectedConv.extracted_yards} yards</span>
                    )}
                  </>
                )}
                <button
                  onClick={() => selectConversation(null, null)}
                  className="ml-auto text-xs text-gray-300 hover:text-gray-300"
                >
                  Close
                </button>
              </div>
              {/* SMS Thread */}
              <div className="p-4 space-y-2 max-h-96 overflow-y-auto">
                {convLoading ? (
                  <SkeletonList rows={4} />
                ) : smsForSelected.length === 0 ? (
                  <div className="text-center text-gray-400 text-sm py-4">No messages found for this number</div>
                ) : (
                  smsForSelected.map((msg: any, i: number) => {
                    const isCustomer = msg.direction === "inbound"
                    return (
                      <div key={i} className={`flex ${isCustomer ? "justify-start" : "justify-end"}`}>
                        <div className={`max-w-[80%] px-3 py-2 rounded-lg text-sm ${
                          isCustomer
                            ? "bg-gray-800 text-gray-200 rounded-bl-none"
                            : "bg-blue-600 text-white rounded-br-none"
                        }`}>
                          <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                          <div className={`text-[10px] mt-1 ${isCustomer ? "text-gray-300" : "text-blue-200"}`}>
                            {new Date(msg.created_at).toLocaleString("en-US", { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" })}
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
              {/* Admin Actions */}
              {selectedConv && (
                <div className="px-4 py-3 border-t border-gray-800 flex flex-wrap gap-2">
                  <button className="text-xs px-3 py-1.5 bg-emerald-900/50 text-emerald-300 rounded hover:bg-emerald-900/70 transition-colors">
                    Mark Resolved
                  </button>
                  <button className="text-xs px-3 py-1.5 bg-orange-900/50 text-orange-300 rounded hover:bg-orange-900/70 transition-colors">
                    Escalate
                  </button>
                  <button className="text-xs px-3 py-1.5 bg-gray-800 text-gray-300 rounded hover:bg-gray-700 transition-colors">
                    Override State
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* ═══ ROW: Sales Funnel ═══ */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-300">Sales Funnel</h2>
            {funnelFilter && (
              <button
                onClick={() => setFunnelFilter(null)}
                className="text-xs text-gray-300 hover:text-gray-300"
              >
                Clear filter
              </button>
            )}
          </div>
          {loading ? (
            <div className="p-4"><SkeletonList rows={8} /></div>
          ) : data && !data.stateFunnel && !data.activeConversations ? (
            <SectionError label="Funnel" onRetry={fetchData} />
          ) : (
            <div className="divide-y divide-gray-800/50">
              {FUNNEL_STAGES.map((stage, i) => {
                const count = funnelCounts[stage.key] || 0
                const prevCount = i > 0 ? (funnelCounts[FUNNEL_STAGES[i - 1].key] || 0) : 0
                const conversionPct = i > 0 && prevCount > 0
                  ? Math.round((count / prevCount) * 100)
                  : null
                const isActive = funnelFilter && JSON.stringify(funnelFilter) === JSON.stringify(stage.states)
                const maxCount = Math.max(...Object.values(funnelCounts), 1)
                const barWidth = Math.max((count / maxCount) * 100, 2)

                return (
                  <button
                    key={stage.key}
                    onClick={() => stage.states.length > 0 ? setFunnelFilter(isActive ? null : stage.states) : null}
                    className={`w-full px-4 py-2.5 flex items-center justify-between hover:bg-gray-800/50 transition-colors text-left ${isActive ? "bg-gray-800/70" : ""}`}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <span className="text-sm text-gray-300 w-24 shrink-0">{stage.label}</span>
                      <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-600/60 rounded-full transition-all"
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-3 ml-3">
                      <span className="text-sm font-mono font-semibold text-gray-200 w-8 text-right">{count}</span>
                      {conversionPct !== null && (
                        <span className="text-xs text-gray-300 w-10 text-right">{conversionPct}%</span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* ═══ ROW 4: Anomaly Monitor ═══ */}
        {(() => {
          const actions = data?.pendingActions || []
          const crashCount = actions.filter(a => a.type === "BRAIN_CRASH").length
          const manualQuoteCount = actions.filter(a => a.type === "MANUAL_QUOTE").length
          return (
            <div className="bg-gray-900 rounded-lg border border-gray-700/50 overflow-hidden">
              <div className="bg-gray-800 border-b border-gray-700 px-5 py-4 flex items-center gap-3">
                <h2 className="text-white text-lg font-bold">Anomaly Monitor</h2>
                {crashCount > 0 && (
                  <span className="bg-red-600 text-white font-bold px-3 py-1 rounded text-sm">
                    {crashCount} crash{crashCount !== 1 ? "es" : ""}
                  </span>
                )}
                {manualQuoteCount > 0 && (
                  <span className="bg-amber-500 text-white font-bold px-3 py-1 rounded text-sm">
                    {manualQuoteCount} manual quote{manualQuoteCount !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
              {loading ? (
                <div className="p-4"><SkeletonList rows={3} /></div>
              ) : data && !data.brainHealth ? (
                <SectionError label="Anomaly Monitor" onRetry={fetchData} />
              ) : actions.length === 0 ? (
                <div className="bg-gray-900 px-5 py-8 text-center">
                  <span className="text-emerald-400 text-lg">&#10003;</span>
                  <div className="text-gray-400 text-sm mt-1">No anomalies in the last 7 days</div>
                </div>
              ) : (
                <div>
                  {actions.map((a) => {
                    const typeBadge = a.type === "BRAIN_CRASH"
                      ? "bg-red-600 text-white"
                      : a.type === "MANUAL_QUOTE"
                        ? "bg-amber-500 text-black"
                        : "bg-blue-600 text-white"
                    const stateMatch = a.type === "BRAIN_CRASH" ? a.message.match(/\b([A-Z][A-Z_]{3,})\b/) : null
                    const extractedState = stateMatch ? stateMatch[1] : null
                    const truncatedMsg = a.message.length > 120 ? a.message.slice(0, 120) + "..." : a.message
                    return (
                      <div key={a.id} className="bg-gray-900 hover:bg-gray-800 transition border-b border-gray-800 px-5 py-4 flex items-center gap-3" style={{ minHeight: 64 }}>
                        <span className="text-gray-300 text-sm font-medium w-16 shrink-0">{ago(a.created_at)}</span>
                        <span className={`${typeBadge} font-bold text-xs px-3 py-1.5 rounded-md uppercase tracking-wide shrink-0`}>
                          {a.type.replace(/_/g, " ")}
                        </span>
                        <span className="text-white font-semibold text-sm w-20 shrink-0 truncate">{a.customer_name || a.phone}</span>
                        {extractedState && (
                          <span className="bg-gray-700 text-gray-200 text-xs px-2 py-1 rounded shrink-0">{extractedState}</span>
                        )}
                        <span className="text-gray-300 text-sm flex-1 leading-relaxed truncate" title={a.message}>{truncatedMsg}</span>
                        {a.type === "BRAIN_CRASH" && (
                          <button className="bg-red-900 hover:bg-red-700 text-red-300 hover:text-white text-xs px-3 py-1.5 rounded border border-red-700 hover:border-red-500 transition font-medium shrink-0">
                            Reset
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })()}

        {/* ═══ ROW 5: Jesse Driver Feed ═══ */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800">
            <h2 className="text-sm font-semibold text-gray-300">Driver Feed (Jesse)</h2>
          </div>
          {loading ? (
            <div className="p-4"><SkeletonList rows={5} /></div>
          ) : data && !data.activeConversations ? (
            <SectionError label="Driver Feed" onRetry={fetchData} />
          ) : (data?.activeConversations?.drivers || []).length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">No active driver conversations</div>
          ) : (
            <div className="divide-y divide-gray-800/30">
              {(data?.activeConversations?.drivers || []).slice(0, 10).map((d: any) => {
                const lastMsg = (data?.recentSms || []).find((s: any) => s.phone === d.phone)
                return (
                  <div key={d.phone} className="px-4 py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-medium text-gray-200">{d.phone}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-600 text-white font-medium">{d.state}</span>
                        {d.extracted_truck_type && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-300 font-medium">{d.extracted_truck_type}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {d.extracted_city && (
                          <span className="text-xs text-gray-300">{d.extracted_city}</span>
                        )}
                        {lastMsg && (
                          <span className="text-xs text-gray-400 truncate">{(lastMsg.body || "").slice(0, 50)}</span>
                        )}
                      </div>
                    </div>
                    <span className="text-[10px] text-gray-400 shrink-0">{ago(d.updated_at)}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ═══ ROW 6: System Health Bar ═══ */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3">
          {loading ? (
            <div className="flex gap-6 animate-pulse">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-4 w-32 bg-gray-800 rounded" />
              ))}
            </div>
          ) : data && !data.alerts ? (
            <SectionError label="System Health" onRetry={fetchData} />
          ) : (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
              <HealthPill
                label="Last Webhook"
                value={
                  data?.recentCustSms && data.recentCustSms.length > 0
                    ? ago(data.recentCustSms[0].created_at)
                    : "N/A"
                }
                ok={
                  data?.recentCustSms && data.recentCustSms.length > 0
                    ? (Date.now() - new Date(data.recentCustSms[0].created_at).getTime()) < 3600000
                    : false
                }
              />
              <HealthPill
                label="Pending Follow-ups"
                value={String(pendingFollowUps)}
                ok={pendingFollowUps <= 10}
              />
              <HealthPill
                label="Brain Crashes (7d)"
                value={String(data?.brainHealth?.crashesThisWeek || 0)}
                ok={(data?.brainHealth?.crashesThisWeek || 0) === 0}
              />
              <HealthPill
                label="Stuck Customers"
                value={String(data?.alerts?.stuckCustomerConvs || 0)}
                ok={(data?.alerts?.stuckCustomerConvs || 0) === 0}
              />
              <HealthPill
                label="Stale Orders"
                value={String(data?.alerts?.staleOrders || 0)}
                ok={(data?.alerts?.staleOrders || 0) === 0}
              />
              <HealthPill
                label="Active Drivers"
                value={String(data?.driverCount || 0)}
                ok={(data?.driverCount || 0) > 0}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════
function KPICard({ label, value, sub, color, alert }: {
  label: string; value: string; sub?: string; color?: string; alert?: boolean
}) {
  return (
    <div className={`rounded-lg p-4 border ${alert ? "bg-red-950/30 border-red-900/50" : "bg-gray-900 border-gray-800"}`}>
      <div className="text-[11px] text-gray-400 uppercase tracking-wide font-medium">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color || "text-white"}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-1">{sub}</div>}
    </div>
  )
}

function HealthPill({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-red-500"}`} />
      <span className="text-gray-300">{label}:</span>
      <span className={ok ? "text-gray-300" : "text-red-400 font-semibold"}>{value}</span>
    </div>
  )
}
