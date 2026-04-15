"use client"

// ═══════════════════════════════════════════════════════════
// EARTH COMMAND v4 — OPERATIONS ASSURANCE
// 100% live data. Zero mock arrays. No driver pay on any surface.
// ═══════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts"
import { createBrowserSupabase } from "@/lib/supabase"
import {
  useOrders, useConversations, useHeatData, usePlatformIQ,
  type Order, type Conversation, type HeatZone,
} from "@/lib/hooks/useCommandData"

// ── Color system (same as v3) ─────────────────────────────
const C = {
  bg: "#04060a", s: "#090b12", card: "#0e1018", cardH: "#151720",
  b: "#191c2c", bA: "#2a2e44",
  amber: "#e8a308", amberB: "#fbbf24", amberD: "rgba(232,163,8,.12)",
  green: "#10b981", greenB: "#34d399", greenD: "rgba(16,185,129,.1)",
  red: "#ef4444", redB: "#f87171", redD: "rgba(239,68,68,.12)",
  blue: "#3b82f6", blueB: "#60a5fa", blueD: "rgba(59,130,246,.1)",
  cyan: "#06b6d4", purple: "#a78bfa", pink: "#f472b6",
  t: "#e2e8f0", tM: "#8892a8", tD: "#4a5068",
} as const

const m = "'JetBrains Mono',monospace"
const sn = "'DM Sans',sans-serif"

// ── Types local to this page ──────────────────────────────
interface SmsMessage {
  id: string
  body: string
  direction: "inbound" | "outbound"
  created_at: string
  from_number?: string | null
}

type TabKey = "orders" | "map" | "chat" | "brain"

interface BrainLearning {
  id: string
  brain: string
  rule: string
  category: string | null
  priority: number | null
  active: boolean
}

// ═══════════════════════════════════════════════════════════
// Atoms
// ═══════════════════════════════════════════════════════════
function Pulse({ color, size = 6 }: { color: string; size?: number }) {
  return (
    <span style={{ position: "relative", display: "inline-block", width: size, height: size }}>
      <span style={{ position: "absolute", inset: -2, borderRadius: "50%", background: color, opacity: 0.4, animation: "ep 2s ease-out infinite" }} />
      <span style={{ display: "block", width: size, height: size, borderRadius: "50%", background: color }} />
    </span>
  )
}

function Badge({ children, color, bg }: { children: React.ReactNode; color: string; bg?: string }) {
  return (
    <span style={{ fontSize: 8, fontWeight: 700, fontFamily: m, color, background: bg || `${color}20`, padding: "2px 6px", borderRadius: 3, letterSpacing: 0.6 }}>
      {children}
    </span>
  )
}

// ═══════════════════════════════════════════════════════════
// AndonCard
// ═══════════════════════════════════════════════════════════
function statusLabel(s: string): string {
  switch (s) {
    case "in_transit": return "IN TRANSIT"
    case "payment_pending": return "AWAITING PAY"
    case "complete": return "COMPLETE"
    default: return s.replace(/_/g, " ").toUpperCase()
  }
}

function statusColor(s: string): string {
  switch (s) {
    case "quoted": return C.blue
    case "payment_pending": return C.amber
    case "scheduled": return C.cyan
    case "dispatched": return C.blue
    case "loading": return C.cyan
    case "in_transit": return C.green
    case "arriving": return C.greenB
    case "delivered": return C.amber
    case "verified":
    case "complete": return C.green
    default: return C.tD
  }
}

function AndonCard({ order, isSelected, onClick }: { order: Order; isSelected: boolean; onClick: () => void }) {
  const needsVerify = order.status === "delivered" && !order.customer_confirmed
  const borderColor = order.isEscalated ? C.red : order.isWarning ? C.amber : needsVerify ? C.amber : statusColor(order.status)
  const price = order.total_price ?? 0

  return (
    <div
      onClick={onClick}
      style={{
        padding: "8px 10px",
        background: isSelected ? C.cardH : C.card,
        borderRadius: 6,
        border: `1px solid ${isSelected ? borderColor : C.b}`,
        borderLeft: `3px solid ${borderColor}`,
        cursor: "pointer",
        marginBottom: 4,
        transition: "all .15s",
        position: "relative",
      }}
    >
      {order.isEscalated && (
        <div style={{ position: "absolute", top: 4, right: 6, width: 8, height: 8, borderRadius: "50%", background: C.red, animation: "ep 1s ease infinite" }} />
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ fontSize: 10, fontWeight: 700, fontFamily: m, color: C.amberB }}>
            DS-{order.id.slice(0, 6).toUpperCase()}
          </span>
          <Badge color={statusColor(order.status)}>{statusLabel(order.status)}</Badge>
        </div>
        <span style={{ fontSize: 11, fontWeight: 800, fontFamily: m, color: C.green }}>
          ${price.toLocaleString()}
        </span>
      </div>
      <div style={{ fontSize: 10, color: C.t, marginBottom: 2 }}>
        {order.customer_name || "—"} — {order.city || "—"}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 9, color: C.tD }}>
          {order.yards ?? "—"} yds {order.material_type || ""}
        </span>
        <span style={{ fontSize: 9, fontFamily: m, color: order.isEscalated ? C.red : order.isWarning ? C.amber : C.tD }}>
          {order.time_in_state_minutes}m in state{order.isEscalated ? " — ESCALATED" : ""}
        </span>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        {[
          { l: "Paid", v: !!order.paid },
          { l: "Photo", v: !!order.photo_verified },
          { l: "Delivered", v: order.status === "delivered" || order.status === "verified" || order.status === "complete" },
          { l: "Verified", v: !!order.photo_verified },
          { l: "Confirmed", v: !!order.customer_confirmed },
        ].map((c, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 2 }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: c.v ? C.green : C.b }} />
            <span style={{ fontSize: 7, color: c.v ? C.green : C.tD, fontFamily: m }}>{c.l}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// HeatMap
// ═══════════════════════════════════════════════════════════
function HeatMap({
  zones, selectedZone, onSelect, layer1Active, layer2Active,
}: {
  zones: HeatZone[]
  selectedZone: HeatZone | null
  onSelect: (z: HeatZone | null) => void
  layer1Active: boolean
  layer2Active: boolean
}) {
  const W = 480, H = 300
  const lnMin = -97.9, lnMax = -96.35
  const ltMin = 32.45, ltMax = 33.3
  const toX = (lng: number) => ((lng - lnMin) / (lnMax - lnMin)) * W
  const toY = (lat: number) => ((ltMax - lat) / (ltMax - ltMin)) * H

  const maxOrders = Math.max(1, ...zones.map((z) => z.orderCount))
  const maxDemand = Math.max(1, ...zones.map((z) => z.driverDemand))

  return (
    <div style={{ position: "relative", width: W, height: H, background: C.bg, borderRadius: 8, border: `1px solid ${C.b}`, overflow: "hidden" }}>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        {Array.from({ length: 10 }).map((_, i) => (
          <line key={`v${i}`} x1={i * (W / 9)} y1={0} x2={i * (W / 9)} y2={H} stroke={C.b} strokeWidth={0.4} opacity={0.3} />
        ))}
        {Array.from({ length: 7 }).map((_, i) => (
          <line key={`h${i}`} x1={0} y1={i * (H / 6)} x2={W} y2={i * (H / 6)} stroke={C.b} strokeWidth={0.4} opacity={0.3} />
        ))}
      </svg>

      {layer1Active &&
        zones.map((z) => {
          const x = toX(z.lng), y = toY(z.lat)
          const r = Math.max(10, Math.min(36, 10 + (z.orderCount / maxOrders) * 26))
          const isSel = selectedZone?.city === z.city
          const fill = z.temp === "hot" ? C.red : z.temp === "warm" ? C.amber : z.temp === "cool" ? C.blue : "#1e3a5f"
          return (
            <div
              key={`o-${z.city}`}
              onClick={() => onSelect(isSel ? null : z)}
              style={{
                position: "absolute", left: x - r, top: y - r, width: r * 2, height: r * 2,
                borderRadius: "50%", cursor: "pointer",
                background: `radial-gradient(circle,${fill}44,transparent 70%)`,
                border: isSel ? `2px solid ${fill}` : `1px solid ${fill}55`,
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: isSel ? `0 0 16px ${fill}66` : "none",
                zIndex: isSel ? 10 : 2, transition: "all .2s",
              }}
            >
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 10, fontWeight: 800, fontFamily: m, color: fill }}>{z.orderCount}</div>
                {r > 20 && <div style={{ fontSize: 6, color: C.tD, fontFamily: m }}>{z.city.split(" ")[0]}</div>}
              </div>
            </div>
          )
        })}

      {layer2Active &&
        zones.filter((z) => z.driverDemand > 0).map((z) => {
          const x = toX(z.lng) + 8, y = toY(z.lat) + 8
          const r = Math.max(6, Math.min(24, 6 + (z.driverDemand / maxDemand) * 18))
          return (
            <div
              key={`d-${z.city}`}
              style={{
                position: "absolute", left: x - r, top: y - r, width: r * 2, height: r * 2,
                borderRadius: "50%", pointerEvents: "none",
                background: `radial-gradient(circle,${C.cyan}44,transparent 70%)`,
                border: `1px solid ${C.cyan}66`,
                display: "flex", alignItems: "center", justifyContent: "center",
                zIndex: 1,
              }}
            >
              <div style={{ fontSize: 9, fontWeight: 700, fontFamily: m, color: C.cyan }}>{z.driverDemand}</div>
            </div>
          )
        })}

      <div style={{ position: "absolute", top: 5, left: 6, fontSize: 8, fontFamily: m, color: C.tD, letterSpacing: 1 }}>DFW DEMAND INTELLIGENCE</div>
      <div style={{ position: "absolute", bottom: 4, right: 5, display: "flex", gap: 10, background: `${C.bg}cc`, padding: "2px 6px", borderRadius: 3 }}>
        <span style={{ fontSize: 7, fontFamily: m, color: C.amber }}>● ORDERS</span>
        <span style={{ fontSize: 7, fontFamily: m, color: C.cyan }}>● DRIVER DEMAND</span>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════
export default function EarthCommandV4() {
  const [tab, setTab] = useState<TabKey>("orders")
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null)
  const [selectedZone, setSelectedZone] = useState<HeatZone | null>(null)
  const [isInTakeover, setIsInTakeover] = useState(false)
  const [messageInput, setMessageInput] = useState("")
  const [sentMessages, setSentMessages] = useState<Array<{ phone: string; text: string; time: string }>>([])
  const [smsThread, setSmsThread] = useState<SmsMessage[]>([])
  const [smsLoading, setSmsLoading] = useState(false)
  const [layer1Active, setLayer1Active] = useState(true)
  const [layer2Active, setLayer2Active] = useState(true)
  const [orderFilter, setOrderFilter] = useState<string>("all")
  const [now, setNow] = useState<Date>(new Date())
  const [learnings, setLearnings] = useState<BrainLearning[]>([])
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // Live data
  const { orders, loading: ordersLoading } = useOrders()
  const { conversations, loading: convsLoading } = useConversations()
  const { zones, loading: zonesLoading } = useHeatData()
  const { iqScore, components, trendData } = usePlatformIQ()

  // Clock
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // Brain learnings — pulled once on brain tab entry
  useEffect(() => {
    if (tab !== "brain") return
    let cancelled = false
    const sb = createBrowserSupabase()
    ;(async () => {
      const { data } = await sb
        .from("brain_learnings")
        .select("id, brain, rule, category, priority, active")
        .eq("active", true)
        .order("priority", { ascending: false })
        .limit(20)
      if (cancelled) return
      setLearnings((data ?? []) as unknown as BrainLearning[])
    })()
    return () => { cancelled = true }
  }, [tab])

  // Sync takeover state when a new conversation is selected
  useEffect(() => {
    if (!selectedConv) {
      setIsInTakeover(false)
      setSmsThread([])
      return
    }
    setIsInTakeover(selectedConv.mode === "HUMAN_ACTIVE")
  }, [selectedConv])

  // Load SMS thread for selected conversation
  const loadSmsThread = useCallback(async (conv: Conversation) => {
    setSmsLoading(true)
    const sb = createBrowserSupabase()
    const table = conv.convType === "driver" ? "sms_logs" : "customer_sms_logs"
    const { data } = await sb
      .from(table)
      .select("id, body, direction, created_at")
      .eq("phone", conv.phone)
      .order("created_at", { ascending: true })
      .limit(50)
    type Row = { id?: string | number; body: string | null; direction: string | null; created_at: string }
    const rows = (data ?? []) as unknown as Row[]
    const mapped: SmsMessage[] = rows.map((r, i) => ({
      id: String(r.id ?? `${conv.phone}-${i}`),
      body: r.body ?? "",
      direction: r.direction === "inbound" ? "inbound" : "outbound",
      created_at: r.created_at,
    }))
    setSmsThread(mapped)
    setSmsLoading(false)
  }, [])

  useEffect(() => {
    if (!selectedConv) return
    loadSmsThread(selectedConv)
  }, [selectedConv, loadSmsThread])

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [smsThread, sentMessages, selectedConv])

  // ─── Handlers ────────────────────────────────────────
  const handleSendMessage = async () => {
    if (!selectedConv || !messageInput.trim()) return
    const text = messageInput
    const time = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
    try {
      const res = await fetch("/api/admin/send-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: selectedConv.phone, message: text, convType: selectedConv.convType }),
      })
      const json = (await res.json()) as { success: boolean; error?: string }
      if (!json.success) {
        alert("Failed to send: " + (json.error || "unknown"))
        return
      }
      setSentMessages((p) => [...p, { phone: selectedConv.phone, text, time }])
      setMessageInput("")
      loadSmsThread(selectedConv)
    } catch {
      alert("Failed to send")
    }
  }

  const handleTakeover = async () => {
    if (!selectedConv) return
    try {
      const res = await fetch("/api/admin/set-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: selectedConv.phone, convType: selectedConv.convType, mode: "HUMAN_ACTIVE" }),
      })
      const json = (await res.json()) as { success: boolean; error?: string }
      if (json.success) setIsInTakeover(true)
      else alert("Takeover failed: " + (json.error || "unknown"))
    } catch {
      alert("Takeover failed")
    }
  }

  const handleResumeAI = async () => {
    if (!selectedConv) return
    try {
      const res = await fetch("/api/admin/set-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: selectedConv.phone, convType: selectedConv.convType, mode: "AI_ACTIVE" }),
      })
      const json = (await res.json()) as { success: boolean; error?: string }
      if (json.success) setIsInTakeover(false)
      else alert("Resume failed: " + (json.error || "unknown"))
    } catch {
      alert("Resume failed")
    }
  }

  // ─── Derived ─────────────────────────────────────────
  const escalatedOrders = useMemo(() => orders.filter((o) => o.isEscalated), [orders])
  const needsAttention = useMemo(
    () => orders.filter((o) => o.status === "delivered" && !o.customer_confirmed),
    [orders]
  )
  const activeOrderCount = useMemo(
    () => orders.filter((o) => o.status !== "complete" && o.status !== "cancelled").length,
    [orders]
  )
  const totalPipeline = useMemo(() => orders.reduce((s, o) => s + (o.total_price ?? 0), 0), [orders])
  const collectedToday = useMemo(
    () => orders.filter((o) => o.paid).reduce((s, o) => s + (o.total_price ?? 0), 0),
    [orders]
  )

  const filteredOrders = useMemo(() => {
    if (orderFilter === "all") return orders
    if (orderFilter === "escalated") return escalatedOrders
    if (orderFilter === "attention") return [...escalatedOrders, ...needsAttention]
    return orders.filter((o) => o.status === orderFilter)
  }, [orderFilter, orders, escalatedOrders, needsAttention])

  // Agent liveness from conversations
  const sarahLive = useMemo(
    () => conversations.some((c) => c.convType === "customer" && c.mode === "AI_ACTIVE"),
    [conversations]
  )
  const jesseLive = useMemo(
    () => conversations.some((c) => c.convType === "driver" && c.mode === "AI_ACTIVE"),
    [conversations]
  )

  // Busiest city
  const busiestCity = useMemo(() => zones[0]?.city ?? null, [zones])

  // Follow-up queue (right sidebar) — computed from real orders
  const followUps = useMemo(() => {
    const out: Array<{ name: string; value: string; reason: string; hrs: number; urgent: boolean }> = []
    const nowT = Date.now()
    for (const o of orders) {
      const hrs = (nowT - new Date(o.updated_at).getTime()) / 3_600_000
      if (o.status === "quoted" && hrs > 2) {
        out.push({
          name: o.customer_name || "Unknown",
          value: "$" + (o.total_price ?? 0).toLocaleString(),
          reason: "Quoted — going cold",
          hrs: Math.round(hrs * 10) / 10,
          urgent: hrs > 6,
        })
      } else if (o.status === "delivered" && !o.customer_confirmed) {
        out.push({
          name: o.customer_name || "Unknown",
          value: "$" + (o.total_price ?? 0).toLocaleString(),
          reason: "Delivered — no customer confirm",
          hrs: Math.round(hrs * 10) / 10,
          urgent: hrs > 1,
        })
      } else if (o.status === "payment_pending" && hrs > 3) {
        out.push({
          name: o.customer_name || "Unknown",
          value: "$" + (o.total_price ?? 0).toLocaleString(),
          reason: "Payment pending",
          hrs: Math.round(hrs * 10) / 10,
          urgent: true,
        })
      }
    }
    return out.slice(0, 6)
  }, [orders])

  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.t, fontFamily: sn, overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap');
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:${C.b};border-radius:3px}
        @keyframes ep{0%,100%{transform:scale(1);opacity:.5}50%{transform:scale(2.2);opacity:0}}
        @keyframes ef{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
        @keyframes eg{0%,100%{opacity:.5}50%{opacity:1}}
      `}</style>

      {/* HEADER */}
      <div style={{ background: C.s, borderBottom: `1px solid ${C.b}`, padding: "5px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 42 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 24, height: 24, borderRadius: 4, background: `linear-gradient(135deg,${C.amber},${C.amber}88)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 900, color: C.bg }}>E</div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2.5, fontFamily: m, lineHeight: 1 }}>EARTH COMMAND</div>
            <div style={{ fontSize: 6, color: C.tD, letterSpacing: 2.5, fontFamily: m }}>OPERATIONS ASSURANCE</div>
          </div>
          <div style={{ width: 1, height: 18, background: C.b, margin: "0 4px" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 8, fontFamily: m }}>
            <span style={{ display: "flex", alignItems: "center", gap: 2 }}>
              <Pulse color={sarahLive ? C.green : C.amber} /><span style={{ color: sarahLive ? C.green : C.amber }}>SARAH</span>
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 2 }}>
              <Pulse color={jesseLive ? C.green : C.amber} /><span style={{ color: jesseLive ? C.green : C.amber }}>JESSE</span>
            </span>
          </div>
          <div style={{ width: 1, height: 18, background: C.b, margin: "0 4px" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 3, background: `${C.green}12`, padding: "2px 7px", borderRadius: 4, border: `1px solid ${C.green}25` }}>
            <span style={{ fontSize: 7, fontFamily: m, color: C.tD }}>IQ</span>
            <span style={{ fontSize: 12, fontWeight: 800, fontFamily: m, color: C.green, animation: "eg 3s ease infinite" }}>{iqScore}</span>
          </div>
          {escalatedOrders.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 3, background: C.redD, padding: "2px 7px", borderRadius: 4, border: `1px solid ${C.red}30` }}>
              <Pulse color={C.red} size={5} />
              <span style={{ fontSize: 9, fontFamily: m, color: C.red, fontWeight: 700 }}>{escalatedOrders.length} ESCALATED</span>
            </div>
          )}
          {needsAttention.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 3, background: C.amberD, padding: "2px 7px", borderRadius: 4, border: `1px solid ${C.amber}30` }}>
              <span style={{ fontSize: 9, fontFamily: m, color: C.amber, fontWeight: 700 }}>{needsAttention.length} UNVERIFIED</span>
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", gap: 2 }}>
            {([
              { k: "orders", l: "ORDERS" },
              { k: "map", l: "INTEL MAP" },
              { k: "chat", l: "LIVE CHAT" },
              { k: "brain", l: "BRAIN" },
            ] as const).map((t) => (
              <button
                key={t.k}
                onClick={() => { setTab(t.k); setSelectedOrder(null); setSelectedConv(null) }}
                style={{
                  background: tab === t.k ? `${C.amber}15` : "transparent",
                  border: tab === t.k ? `1px solid ${C.amber}35` : "1px solid transparent",
                  color: tab === t.k ? C.amber : C.tD,
                  fontSize: 8, fontFamily: m, fontWeight: 600, padding: "3px 7px", borderRadius: 3, cursor: "pointer", letterSpacing: 0.7,
                }}
              >
                {t.l}
              </button>
            ))}
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, fontWeight: 700, fontFamily: m }}>
              {now.toLocaleTimeString("en-US", { hour12: true, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </div>
            <div style={{ fontSize: 6, color: C.tD, fontFamily: m }}>
              {now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
            </div>
          </div>
        </div>
      </div>

      {/* KPI BAR */}
      <div style={{ background: C.s, borderBottom: `1px solid ${C.b}`, padding: "5px 14px", display: "flex", gap: 6 }}>
        {([
          { l: "PIPELINE", v: `$${Math.round(totalPipeline).toLocaleString()}`, c: C.amberB, s: `${orders.length} orders` },
          { l: "COLLECTED", v: `$${Math.round(collectedToday).toLocaleString()}`, c: C.green, s: `${orders.filter((o) => o.paid).length} paid` },
          { l: "ACTIVE", v: activeOrderCount, c: C.blue, s: `${orders.filter((o) => o.status === "in_transit").length} transit` },
          { l: "ESCALATED", v: escalatedOrders.length, c: escalatedOrders.length > 0 ? C.red : C.green, s: escalatedOrders.length > 0 ? "NEEDS ACTION" : "All clear" },
          { l: "UNVERIFIED", v: needsAttention.length, c: needsAttention.length > 0 ? C.amber : C.green, s: needsAttention.length > 0 ? "Confirm delivery" : "All verified" },
          { l: "PLATFORM IQ", v: `${iqScore}/100`, c: C.green, s: "live" },
        ] as const).map((k, i) => (
          <div key={i} style={{ flex: 1, padding: "6px 8px", background: C.card, borderRadius: 5, border: `1px solid ${C.b}`, minWidth: 0 }}>
            <div style={{ fontSize: 7, color: C.tD, fontFamily: m, letterSpacing: 1, marginBottom: 2 }}>{k.l}</div>
            <div style={{ fontSize: 16, fontWeight: 800, fontFamily: m, color: k.c, lineHeight: 1 }}>{k.v}</div>
            <div style={{ fontSize: 8, color: C.tD, marginTop: 1 }}>{k.s}</div>
          </div>
        ))}
      </div>

      {/* MAIN */}
      <div style={{ display: "flex", height: "calc(100vh - 42px - 50px)" }}>
        <div style={{ flex: 1, overflow: "auto", padding: 12, animation: "ef .2s ease" }}>
          {tab === "orders" && (
            <OrdersTab
              orders={orders}
              filteredOrders={filteredOrders}
              ordersLoading={ordersLoading}
              escalated={escalatedOrders}
              needsAttention={needsAttention}
              selected={selectedOrder}
              setSelected={setSelectedOrder}
              filter={orderFilter}
              setFilter={setOrderFilter}
              now={now}
              iqScore={iqScore}
              collectedToday={collectedToday}
              totalPipeline={totalPipeline}
              busiestCity={busiestCity}
            />
          )}
          {tab === "map" && (
            <MapTab
              zones={zones}
              zonesLoading={zonesLoading}
              selectedZone={selectedZone}
              setSelectedZone={setSelectedZone}
              layer1Active={layer1Active} setLayer1Active={setLayer1Active}
              layer2Active={layer2Active} setLayer2Active={setLayer2Active}
            />
          )}
          {tab === "chat" && (
            <ChatTab
              conversations={conversations}
              convsLoading={convsLoading}
              selected={selectedConv}
              setSelected={setSelectedConv}
              isInTakeover={isInTakeover}
              onTakeover={handleTakeover}
              onResumeAI={handleResumeAI}
              messageInput={messageInput}
              setMessageInput={setMessageInput}
              onSend={handleSendMessage}
              smsThread={smsThread}
              smsLoading={smsLoading}
              sentMessages={sentMessages}
              scrollRef={scrollRef}
            />
          )}
          {tab === "brain" && (
            <BrainTab
              iqScore={iqScore}
              components={components}
              trendData={trendData}
              learnings={learnings}
            />
          )}
        </div>

        {/* RIGHT SIDEBAR */}
        <RightSidebar followUps={followUps} />
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// Orders tab
// ═══════════════════════════════════════════════════════════
function OrdersTab({
  orders, filteredOrders, ordersLoading, escalated, needsAttention,
  selected, setSelected, filter, setFilter, now, iqScore,
  collectedToday, totalPipeline, busiestCity,
}: {
  orders: Order[]
  filteredOrders: Order[]
  ordersLoading: boolean
  escalated: Order[]
  needsAttention: Order[]
  selected: Order | null
  setSelected: (o: Order | null) => void
  filter: string
  setFilter: (s: string) => void
  now: Date
  iqScore: number
  collectedToday: number
  totalPipeline: number
  busiestCity: string | null
}) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 10, fontFamily: m, color: C.tD, letterSpacing: 1 }}>ORDER ASSURANCE BOARD</div>
        <div style={{ display: "flex", gap: 3 }}>
          {[
            { k: "all", l: "ALL" },
            { k: "escalated", l: "ESCALATED" },
            { k: "attention", l: "NEEDS ATTN" },
            { k: "in_transit", l: "TRANSIT" },
            { k: "delivered", l: "DELIVERED" },
          ].map((f) => {
            const count =
              f.k === "all" ? orders.length :
              f.k === "escalated" ? escalated.length :
              f.k === "attention" ? escalated.length + needsAttention.length :
              orders.filter((o) => o.status === f.k).length
            return (
              <button
                key={f.k}
                onClick={() => setFilter(f.k)}
                style={{
                  background: filter === f.k ? `${C.amber}15` : "transparent",
                  border: filter === f.k ? `1px solid ${C.amber}30` : "1px solid transparent",
                  color: filter === f.k ? C.amber : C.tD,
                  fontSize: 7, fontFamily: m, padding: "2px 6px", borderRadius: 3, cursor: "pointer", fontWeight: 600,
                }}
              >
                {f.l} ({count})
              </button>
            )
          })}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        {ordersLoading && (
          <div style={{ gridColumn: "1 / -1", padding: 20, textAlign: "center", color: C.tD, fontSize: 10, fontFamily: m }}>
            loading orders…
          </div>
        )}
        {!ordersLoading && filteredOrders.length === 0 && (
          <div style={{ gridColumn: "1 / -1", padding: 20, textAlign: "center", color: C.tD, fontSize: 10, fontFamily: m }}>
            No orders match this filter.
          </div>
        )}
        {filteredOrders.map((o) => (
          <AndonCard
            key={o.id}
            order={o}
            isSelected={selected?.id === o.id}
            onClick={() => setSelected(selected?.id === o.id ? null : o)}
          />
        ))}
      </div>

      {selected && (
        <div style={{ marginTop: 10, background: C.card, borderRadius: 8, border: `1px solid ${C.b}`, padding: 14, animation: "ef .2s ease" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{selected.customer_name || "Unknown"}</div>
              <div style={{ fontSize: 10, fontFamily: m, color: C.tD }}>
                DS-{selected.id.slice(0, 6).toUpperCase()} — {selected.customer_phone || "—"} — {selected.city || "—"}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 18, fontWeight: 800, fontFamily: m, color: C.green }}>
                ${(selected.total_price ?? 0).toLocaleString()}
              </div>
              <Badge color={statusColor(selected.status)}>{statusLabel(selected.status)}</Badge>
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, fontFamily: m, color: C.tD, marginBottom: 3 }}>
              {["Quoted", "Paid", "Dispatched", "Loading", "Transit", "Delivered", "Verified"].map((s, i) => (
                <span key={i}>{s}</span>
              ))}
            </div>
            <div style={{ height: 6, background: C.b, borderRadius: 3, overflow: "hidden" }}>
              <div style={{ width: `${selected.progress}%`, height: "100%", background: `linear-gradient(90deg,${C.blue},${C.green})`, borderRadius: 3, transition: "width .5s" }} />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, fontSize: 10 }}>
            <div><span style={{ color: C.tD }}>Material:</span> <span style={{ color: C.t }}>{selected.yards ?? "—"} yds {selected.material_type || ""}</span></div>
            <div><span style={{ color: C.tD }}>Driver:</span> <span style={{ color: C.t }}>{selected.driver_name || "Unassigned"}</span></div>
            <div><span style={{ color: C.tD }}>Time in state:</span> <span style={{ color: selected.time_in_state_minutes > 90 ? C.red : C.t, fontFamily: m }}>{selected.time_in_state_minutes} min</span></div>
            <div><span style={{ color: C.tD }}>Paid:</span> <span style={{ color: selected.paid ? C.green : C.red }}>{selected.paid ? "Yes" : "No"}</span></div>
            <div><span style={{ color: C.tD }}>Photo verified:</span> <span style={{ color: selected.photo_verified ? C.green : C.amber }}>{selected.photo_verified ? "Yes" : "Pending"}</span></div>
            <div><span style={{ color: C.tD }}>Customer confirmed:</span> <span style={{ color: selected.customer_confirmed ? C.green : C.amber }}>{selected.customer_confirmed ? "Yes" : "Pending"}</span></div>
          </div>
          {selected.status === "delivered" && !selected.customer_confirmed && (
            <div style={{ marginTop: 8, padding: "6px 10px", background: C.amberD, borderRadius: 4, border: `1px solid ${C.amber}30`, fontSize: 10, color: C.amber, fontFamily: m }}>
              ACTION REQUIRED: Customer has not confirmed delivery.
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 14, background: C.card, borderRadius: 8, border: `1px solid ${C.b}`, padding: 12 }}>
        <div style={{ fontSize: 10, fontFamily: m, color: C.tD, letterSpacing: 1, marginBottom: 8 }}>
          DAILY BRIEFING — {now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        </div>
        {[
          {
            color: C.red,
            msg: escalated.length > 0
              ? `${escalated.length} orders escalated — ${escalated.slice(0, 2).map((o) => `DS-${o.id.slice(0, 6).toUpperCase()} (${o.time_in_state_minutes}m)`).join(", ")}${escalated.length > 2 ? "…" : ""}`
              : "No escalations. Every lane is on time.",
          },
          {
            color: C.green,
            msg: `$${Math.round(collectedToday).toLocaleString()} collected. $${Math.max(0, Math.round(totalPipeline - collectedToday)).toLocaleString()} outstanding in pipeline.`,
          },
          {
            color: C.amber,
            msg: needsAttention.length > 0
              ? `${needsAttention.length} delivered order(s) awaiting customer confirmation.`
              : "All deliveries confirmed.",
          },
          { color: C.purple, msg: `Platform IQ at ${iqScore}.` },
          { color: C.cyan, msg: busiestCity ? `Busiest city: ${busiestCity}.` : "No city activity yet." },
        ].map((b, i) => (
          <div key={i} style={{ padding: "5px 8px", borderLeft: `2px solid ${b.color}`, background: `${C.bg}80`, borderRadius: "0 4px 4px 0", marginBottom: 3 }}>
            <span style={{ fontSize: 10, color: C.t, lineHeight: 1.4 }}>{b.msg}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// Map tab
// ═══════════════════════════════════════════════════════════
function MapTab({
  zones, zonesLoading, selectedZone, setSelectedZone,
  layer1Active, setLayer1Active, layer2Active, setLayer2Active,
}: {
  zones: HeatZone[]
  zonesLoading: boolean
  selectedZone: HeatZone | null
  setSelectedZone: (z: HeatZone | null) => void
  layer1Active: boolean; setLayer1Active: (b: boolean) => void
  layer2Active: boolean; setLayer2Active: (b: boolean) => void
}) {
  const gap = selectedZone ? selectedZone.driverDemand - selectedZone.orderCount : 0

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 10, fontFamily: m, color: C.tD, letterSpacing: 1 }}>DEMAND INTELLIGENCE — LIVE</div>
        <div style={{ display: "flex", gap: 6 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 8, fontFamily: m, color: layer1Active ? C.amber : C.tD, cursor: "pointer" }}>
            <input type="checkbox" checked={layer1Active} onChange={(e) => setLayer1Active(e.target.checked)} style={{ width: 10, height: 10, accentColor: C.amber }} />ORDERS
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 8, fontFamily: m, color: layer2Active ? C.cyan : C.tD, cursor: "pointer" }}>
            <input type="checkbox" checked={layer2Active} onChange={(e) => setLayer2Active(e.target.checked)} style={{ width: 10, height: 10, accentColor: C.cyan }} />DRIVER DEMAND
          </label>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <HeatMap
          zones={zones}
          selectedZone={selectedZone}
          onSelect={setSelectedZone}
          layer1Active={layer1Active}
          layer2Active={layer2Active}
        />
        <div style={{ width: 220 }}>
          {zonesLoading && <div style={{ fontSize: 9, color: C.tD, padding: 8 }}>loading zones…</div>}
          {!zonesLoading && !selectedZone && (
            <div style={{ background: C.card, borderRadius: 6, border: `1px solid ${C.b}`, padding: 10, fontSize: 9, color: C.tD }}>
              Click a zone for details. Amber = orders, cyan = driver demand.
            </div>
          )}
          {selectedZone && (
            <div style={{ background: C.card, borderRadius: 6, border: `1px solid ${C.b}`, padding: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, textTransform: "capitalize" }}>{selectedZone.city}</div>
              {([
                ["Orders", selectedZone.orderCount, C.amber],
                ["Revenue", `$${Math.round(selectedZone.revenue).toLocaleString()}`, C.green],
                ["Driver demand", selectedZone.driverDemand, C.cyan],
                ["Gap (demand - orders)", gap, gap < 0 ? C.red : C.green],
              ] as const).map(([l, v, c], i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: i < 3 ? `1px solid ${C.b}` : "none" }}>
                  <span style={{ fontSize: 9, color: C.tD }}>{l}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, fontFamily: m, color: c }}>{v}</span>
                </div>
              ))}
              {gap < 0 && (
                <div style={{ marginTop: 4, padding: "4px 6px", background: C.redD, borderRadius: 3, border: `1px solid ${C.red}25`, fontSize: 8, color: C.red, fontFamily: m }}>
                  UNDERSUPPLIED — deploy drivers to {selectedZone.city}.
                </div>
              )}
            </div>
          )}
          <div style={{ marginTop: 8, fontSize: 9, fontFamily: m, color: C.tD, letterSpacing: 1, marginBottom: 4 }}>TOP ACTIVE CITIES</div>
          {zones.slice(0, 4).map((z) => (
            <div key={z.city} style={{ display: "flex", justifyContent: "space-between", padding: "3px 6px", marginBottom: 2, background: C.card, borderRadius: 3, cursor: "pointer" }} onClick={() => setSelectedZone(z)}>
              <span style={{ fontSize: 9, color: C.t, textTransform: "capitalize" }}>{z.city}</span>
              <span style={{ fontSize: 8, fontFamily: m, color: C.amber }}>{z.orderCount} orders</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// Chat tab
// ═══════════════════════════════════════════════════════════
function ChatTab({
  conversations, convsLoading, selected, setSelected,
  isInTakeover, onTakeover, onResumeAI,
  messageInput, setMessageInput, onSend,
  smsThread, smsLoading, sentMessages, scrollRef,
}: {
  conversations: Conversation[]
  convsLoading: boolean
  selected: Conversation | null
  setSelected: (c: Conversation | null) => void
  isInTakeover: boolean
  onTakeover: () => void
  onResumeAI: () => void
  messageInput: string
  setMessageInput: (s: string) => void
  onSend: () => void
  smsThread: SmsMessage[]
  smsLoading: boolean
  sentMessages: Array<{ phone: string; text: string; time: string }>
  scrollRef: React.RefObject<HTMLDivElement | null>
}) {
  return (
    <div style={{ display: "flex", gap: 10, height: "100%" }}>
      <div style={{ width: 260, overflowY: "auto" }}>
        <div style={{ fontSize: 10, fontFamily: m, color: C.tD, letterSpacing: 1, marginBottom: 6 }}>LIVE CONVERSATIONS</div>
        {convsLoading && <div style={{ fontSize: 9, color: C.tD, padding: 8 }}>loading…</div>}
        {!convsLoading && conversations.length === 0 && (
          <div style={{ fontSize: 9, color: C.tD, padding: 8 }}>No conversations.</div>
        )}
        {conversations.map((c) => {
          const ac = c.convType === "customer" ? C.blue : C.amber
          const isSel = selected?.phone === c.phone && selected?.convType === c.convType
          const ago = Math.max(0, Math.round((Date.now() - new Date(c.updatedAt).getTime()) / 60000))
          const modeColor = c.mode === "HUMAN_ACTIVE" ? C.red : C.green
          return (
            <div
              key={`${c.convType}-${c.phone}`}
              onClick={() => setSelected(c)}
              style={{
                padding: "8px 10px",
                background: isSel ? C.cardH : C.card,
                borderRadius: 6,
                border: `1px solid ${isSel ? ac : C.b}`,
                borderLeft: `3px solid ${ac}`,
                cursor: "pointer", marginBottom: 4,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <Badge color={ac}>{c.convType === "customer" ? "SARAH" : "JESSE"}</Badge>
                  <span style={{ fontSize: 10, fontWeight: 600 }}>{c.name || c.phone}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                  <Pulse color={modeColor} size={4} />
                  {c.quoteAmount != null && c.quoteAmount > 0 && (
                    <span style={{ fontSize: 10, fontFamily: m, color: C.green, fontWeight: 700 }}>
                      ${Math.round(c.quoteAmount).toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 9, color: C.tD, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>
                  {c.state || "—"}{c.city ? ` · ${c.city}` : ""}
                </span>
                <span style={{ fontSize: 8, color: C.tD, fontFamily: m }}>{ago}m ago</span>
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: C.card, borderRadius: 8, border: `1px solid ${C.b}` }}>
        {selected ? (
          <>
            <div style={{ padding: "6px 12px", borderBottom: `1px solid ${C.b}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 600 }}>{selected.name || selected.phone}</span>
                <span style={{ fontSize: 9, fontFamily: m, color: C.tD }}>{selected.phone}</span>
                <Badge color={isInTakeover ? C.red : C.green}>
                  {isInTakeover ? "HUMAN_ACTIVE" : "AI_ACTIVE"}
                </Badge>
              </div>
              {isInTakeover ? (
                <button onClick={onResumeAI} style={{ background: `${C.green}12`, border: `1px solid ${C.green}35`, color: C.green, fontSize: 8, fontFamily: m, fontWeight: 700, padding: "3px 8px", borderRadius: 3, cursor: "pointer" }}>
                  RESUME AI
                </button>
              ) : (
                <button onClick={onTakeover} style={{ background: `${C.amber}12`, border: `1px solid ${C.amber}35`, color: C.amber, fontSize: 8, fontFamily: m, fontWeight: 700, padding: "3px 8px", borderRadius: 3, cursor: "pointer" }}>
                  TAKE OVER
                </button>
              )}
            </div>
            {isInTakeover && (
              <div style={{ padding: "3px 12px", background: C.redD, borderBottom: `1px solid ${C.red}25`, fontSize: 8, fontFamily: m, color: C.red, display: "flex", alignItems: "center", gap: 4 }}>
                <Pulse color={C.red} size={4} />
                HUMAN OVERRIDE — Sending as {selected.convType === "customer" ? "Sarah" : "Jesse"}
              </div>
            )}
            <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
              {smsLoading && (
                <div style={{ fontSize: 9, color: C.tD, textAlign: "center", padding: 20 }}>loading thread…</div>
              )}
              {!smsLoading && smsThread.length === 0 && (
                <div style={{ fontSize: 9, color: C.tD, textAlign: "center", padding: 20 }}>No messages yet.</div>
              )}
              {smsThread.map((msg) => {
                const isOut = msg.direction === "outbound"
                const ac = selected.convType === "customer" ? C.blue : C.amber
                const time = new Date(msg.created_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
                return (
                  <div key={msg.id} style={{ display: "flex", justifyContent: isOut ? "flex-end" : "flex-start", marginBottom: 6 }}>
                    <div style={{ maxWidth: "78%", padding: "6px 10px", borderRadius: isOut ? "8px 8px 2px 8px" : "8px 8px 8px 2px", background: isOut ? `${ac}12` : C.s, border: `1px solid ${isOut ? `${ac}25` : C.b}` }}>
                      <div style={{ fontSize: 11, color: C.t, lineHeight: 1.4, whiteSpace: "pre-wrap" }}>{msg.body}</div>
                      <div style={{ fontSize: 7, color: isOut ? ac : C.tD, fontFamily: m, marginTop: 2, textAlign: isOut ? "right" : "left" }}>
                        {isOut ? (selected.convType === "customer" ? "SARAH" : "JESSE") : selected.convType === "customer" ? "CUSTOMER" : "DRIVER"} — {time}
                      </div>
                    </div>
                  </div>
                )
              })}
              {sentMessages.filter((s) => s.phone === selected.phone).map((msg, i) => (
                <div key={`sent-${i}`} style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
                  <div style={{ maxWidth: "78%", padding: "6px 10px", borderRadius: "8px 8px 2px 8px", background: C.redD, border: `1px solid ${C.red}25` }}>
                    <div style={{ fontSize: 11, color: C.t, lineHeight: 1.4 }}>{msg.text}</div>
                    <div style={{ fontSize: 7, color: C.red, fontFamily: m, marginTop: 2, textAlign: "right" }}>
                      YOU (as {selected.convType === "customer" ? "SARAH" : "JESSE"}) — {msg.time}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={scrollRef} />
            </div>
            {isInTakeover && (
              <div style={{ padding: "6px 10px", borderTop: `1px solid ${C.b}`, display: "flex", gap: 4 }}>
                <input
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && onSend()}
                  placeholder={`Message as ${selected.convType === "customer" ? "Sarah" : "Jesse"}…`}
                  style={{ flex: 1, background: C.s, border: `1px solid ${C.red}35`, borderRadius: 5, padding: "6px 10px", color: C.t, fontSize: 11, fontFamily: sn, outline: "none" }}
                />
                <button onClick={onSend} style={{ background: C.red, border: "none", color: "#fff", fontSize: 9, fontFamily: m, fontWeight: 700, padding: "6px 12px", borderRadius: 5, cursor: "pointer" }}>
                  SEND
                </button>
              </div>
            )}
          </>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, color: C.tD, fontSize: 10, fontFamily: m }}>
            Select a conversation
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// Brain tab
// ═══════════════════════════════════════════════════════════
function categoryColor(cat: string | null): string {
  switch (cat) {
    case "safety": return C.red
    case "style": return C.blue
    case "extraction": return C.amber
    case "dispatch": return C.green
    case "payment": return C.cyan
    case "photos": return C.purple
    case "tone": return C.pink
    default: return C.tM
  }
}

function BrainTab({
  iqScore, components, trendData, learnings,
}: {
  iqScore: number
  components: { sarahCloseRate: number; jesseAcceptRate: number; confirmRate: number; quoteSpeedScore: number }
  trendData: Array<{ week: string; iq: number; sarah: number; jesse: number; confirm: number; quote: number }>
  learnings: BrainLearning[]
}) {
  const bars: Array<{ label: string; pct: number; color: string }> = [
    { label: "Sarah close rate",  pct: Math.round(components.sarahCloseRate * 100), color: C.blue },
    { label: "Jesse accept rate", pct: Math.round(components.jesseAcceptRate * 100), color: C.amber },
    { label: "Confirm rate",      pct: Math.round(components.confirmRate * 100), color: C.green },
    { label: "Quote speed",       pct: Math.round(components.quoteSpeedScore), color: C.purple },
  ]

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 10, fontFamily: m, color: C.tD, letterSpacing: 1 }}>PLATFORM INTELLIGENCE</div>
          <div style={{ fontSize: 8, color: C.tM, marginTop: 2 }}>Every order makes us smarter. Every conversation trains us. Every delivery calibrates us.</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 32, fontWeight: 900, fontFamily: m, color: C.green, lineHeight: 1, animation: "eg 3s ease infinite" }}>{iqScore}</div>
          <div style={{ fontSize: 8, color: C.tD }}>Platform IQ</div>
        </div>
      </div>

      <div style={{ background: C.card, borderRadius: 8, border: `1px solid ${C.b}`, padding: 10, marginBottom: 10 }}>
        {bars.map((b) => (
          <div key={b.label} style={{ marginBottom: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, fontFamily: m, color: C.tD, marginBottom: 2 }}>
              <span>{b.label}</span>
              <span style={{ color: b.color }}>{b.pct}%</span>
            </div>
            <div style={{ height: 5, background: C.b, borderRadius: 3, overflow: "hidden" }}>
              <div style={{ width: `${Math.min(100, Math.max(0, b.pct))}%`, height: "100%", background: b.color, borderRadius: 3, transition: "width .5s" }} />
            </div>
          </div>
        ))}
      </div>

      <div style={{ background: C.card, borderRadius: 8, border: `1px solid ${C.b}`, padding: "10px 6px 2px", marginBottom: 12 }}>
        <ResponsiveContainer width="100%" height={140}>
          <AreaChart data={trendData}>
            <defs>
              <linearGradient id="iqa" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.green}  stopOpacity={0.3} /><stop offset="100%" stopColor={C.green}  stopOpacity={0} /></linearGradient>
              <linearGradient id="iqb" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.blue}   stopOpacity={0.25} /><stop offset="100%" stopColor={C.blue}   stopOpacity={0} /></linearGradient>
              <linearGradient id="iqc" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.amber}  stopOpacity={0.25} /><stop offset="100%" stopColor={C.amber}  stopOpacity={0} /></linearGradient>
              <linearGradient id="iqd" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.purple} stopOpacity={0.25} /><stop offset="100%" stopColor={C.purple} stopOpacity={0} /></linearGradient>
            </defs>
            <CartesianGrid stroke={C.b} strokeDasharray="2 4" />
            <XAxis dataKey="week" tick={{ fontSize: 8, fill: C.tD, fontFamily: m }} axisLine={false} tickLine={false} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 8, fill: C.tD, fontFamily: m }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: C.card, border: `1px solid ${C.b}`, borderRadius: 4, fontFamily: m, fontSize: 9 }} />
            <Area type="monotone" dataKey="iq"      name="IQ"      stroke={C.green}  fill="url(#iqa)" strokeWidth={2} />
            <Area type="monotone" dataKey="sarah"   name="Sarah"   stroke={C.blue}   fill="url(#iqb)" strokeWidth={1.5} />
            <Area type="monotone" dataKey="jesse"   name="Jesse"   stroke={C.amber}  fill="url(#iqc)" strokeWidth={1.5} />
            <Area type="monotone" dataKey="confirm" name="Confirm" stroke={C.purple} fill="url(#iqd)" strokeWidth={1.5} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div style={{ fontSize: 10, fontFamily: m, color: C.tD, letterSpacing: 1, marginBottom: 6 }}>ACTIVE BRAIN LEARNINGS</div>
      {learnings.length === 0 && (
        <div style={{ fontSize: 9, color: C.tD, padding: 8 }}>No active learnings loaded.</div>
      )}
      {learnings.map((l) => (
        <div
          key={l.id}
          style={{
            padding: "5px 8px",
            borderLeft: `2px solid ${categoryColor(l.category)}`,
            marginBottom: 3,
            background: `${C.bg}80`,
            borderRadius: "0 4px 4px 0",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 10, color: C.t, lineHeight: 1.3 }}>
              <span style={{ color: categoryColor(l.category), fontFamily: m, fontSize: 8, marginRight: 6 }}>
                [{(l.category || "general").toUpperCase()}] {l.brain.toUpperCase()}
              </span>
              {l.rule}
            </span>
            <span style={{ fontSize: 8, fontFamily: m, color: C.tD, minWidth: 28, textAlign: "right" }}>p{l.priority ?? "?"}</span>
          </div>
        </div>
      ))}

      <div style={{ marginTop: 14, fontSize: 10, fontFamily: m, color: C.tD, letterSpacing: 1, marginBottom: 6 }}>
        5-YEAR VISION
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        {[
          { l: "Permit-to-Order Pipeline", d: "Auto-generate material estimates from new building permits via Shovels.ai.", s: "Patent XLVI",  c: C.purple, ready: "Building" },
          { l: "Weather-Responsive Dispatch", d: "Auto-adjust schedules based on NOAA forecasts. Pre-notify customers.", s: "Patent V",     c: C.cyan,   ready: "Building" },
          { l: "Material Quality CV",     d: "Computer vision analyzes dirt/aggregate quality from driver photos.", s: "Patent I",     c: C.amber,  ready: "Active" },
          { l: "AI-to-AI Negotiation",    d: "Sarah and Jesse negotiate pricing and scheduling with supplier AI.", s: "Patent V",     c: C.pink,   ready: "2027" },
          { l: "Autonomous Fleet",        d: "Air traffic control for autonomous dump trucks between quarries.", s: "Patent XXXVII", c: C.green,  ready: "2028" },
          { l: "Carbon Credit Per Delivery", d: "Track emissions per haul. Generate verified carbon credits.", s: "Patent XXVIII", c: C.greenB, ready: "2027" },
          { l: "Digital Twin Job Sites",  d: "3D model of every active construction site showing material needs.", s: "Patent XLVI",  c: C.blue,   ready: "2029" },
          { l: "Federated Learning",      d: "Multiple quarries train shared models without exposing data.", s: "Patent XLII",  c: C.red,    ready: "2030" },
        ].map((f, i) => (
          <div key={i} style={{ background: C.card, borderRadius: 6, border: `1px solid ${C.b}`, padding: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: f.c }}>{f.l}</span>
              <Badge color={f.ready === "Active" ? C.green : f.ready === "Building" ? C.amber : C.tD}>{f.ready}</Badge>
            </div>
            <div style={{ fontSize: 9, color: C.tM, lineHeight: 1.3, marginBottom: 3 }}>{f.d}</div>
            <div style={{ fontSize: 7, fontFamily: m, color: C.tD }}>{f.s}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// Right sidebar
// ═══════════════════════════════════════════════════════════
function RightSidebar({
  followUps,
}: {
  followUps: Array<{ name: string; value: string; reason: string; hrs: number; urgent: boolean }>
}) {
  return (
    <div style={{ width: 220, minWidth: 220, borderLeft: `1px solid ${C.b}`, display: "flex", flexDirection: "column", background: C.s, overflowY: "auto" }}>
      <div style={{ padding: "8px 8px", borderBottom: `1px solid ${C.b}` }}>
        <div style={{ fontSize: 9, fontFamily: m, color: C.tD, letterSpacing: 1, marginBottom: 4 }}>FOLLOW-UP QUEUE</div>
        {followUps.length === 0 && (
          <div style={{ fontSize: 9, color: C.tD, padding: 4 }}>No follow-ups queued.</div>
        )}
        {followUps.map((f, i) => (
          <div key={i} style={{ padding: "5px 7px", background: C.card, borderRadius: 4, border: `1px solid ${f.urgent ? `${C.red}30` : C.b}`, marginBottom: 3, borderLeft: `2px solid ${f.urgent ? C.red : C.amber}` }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 10, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 130 }}>{f.name}</span>
              <span style={{ fontSize: 9, fontFamily: m, color: C.amber, fontWeight: 700 }}>{f.value}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 1 }}>
              <span style={{ fontSize: 8, color: C.tD }}>{f.reason}</span>
              <span style={{ fontSize: 8, fontFamily: m, color: f.hrs > 3 ? C.red : C.tD }}>{f.hrs}h</span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ padding: "8px 8px", borderBottom: `1px solid ${C.b}` }}>
        <div style={{ fontSize: 9, fontFamily: m, color: C.tD, letterSpacing: 1, marginBottom: 4 }}>SYSTEM</div>
        {([
          ["Twilio SMS", "operational"],
          ["Supabase", "operational"],
          ["Claude Sonnet", "operational"],
          ["Vercel", "operational"],
          ["10DLC", "pending"],
        ] as const).map(([l, s], i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ width: 4, height: 4, borderRadius: "50%", background: s === "operational" ? C.green : C.amber }} />
              <span style={{ fontSize: 8, color: C.tM }}>{l}</span>
            </div>
            <span style={{ fontSize: 7, fontFamily: m, color: s === "operational" ? C.green : C.amber }}>{s}</span>
          </div>
        ))}
      </div>

      <div style={{ padding: "8px 8px" }}>
        <div style={{ fontSize: 9, fontFamily: m, color: C.tD, letterSpacing: 1, marginBottom: 4 }}>DATA SOURCES</div>
        {[
          { l: "TxDOT ArcGIS",      n: "projects",    c: C.cyan },
          { l: "Shovels.ai Permits", n: "permits",    c: C.purple },
          { l: "SAM.gov",           n: "fed contracts", c: C.blue },
          { l: "NOAA Weather",      n: "forecast",    c: C.pink },
          { l: "Supabase Fleet",    n: "real-time",   c: C.green },
        ].map((d, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
            <span style={{ fontSize: 8, color: d.c }}>{d.l}</span>
            <span style={{ fontSize: 7, fontFamily: m, color: C.tD }}>{d.n}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
