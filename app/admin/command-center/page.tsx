"use client"
import { useState, useEffect, useRef, useCallback } from "react"

// ═══════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════
interface CommandData {
  timestamp: string
  revenue: {
    today: { orders: number; completed: number; yards: number; revenue: number; driverPay: number; margin: number }
    week: { orders: number; completed: number; yards: number; revenue: number; driverPay: number; margin: number }
    month: { orders: number; completed: number; revenue: number; driverPay: number; margin: number }
  }
  financial: { pipelineCents: number; outstandingCents: number; collectedCents: number; unpaidCustomerCents: number; pendingDriverPayCents: number }
  funnel: { leads: number; quoted: number; ordered: number; delivered: number; paid: number }
  alerts: {
    staleOrders: number; unpaidCustomers: number; unpaidCustomerTotal: number
    stuckDriverConvs: number; stuckCustomerConvs: number; driverNoShows: number
    pendingDriverPayments: number; pendingDriverPayTotal: number
  }
  activeConversations: { drivers: any[]; customers: any[] }
  agentPipeline: AgentPipeline[]
  unassignedLeads: number
  salesAgents: { id: string; name: string }[]
  cityIntel: CityData[]
  dailyTrend: { date: string; orders: number; completed: number; revenue: number; margin: number }[]
  brainHealth: { crashesThisWeek: number; pendingActionsByType: Record<string, number>; totalPendingActions: number }
  staleOrders: any[]; unpaidCustomers: any[]; stuckDrivers: any[]; stuckCustomers: any[]; noShows: any[]
  recentSms: any[]; recentCustSms: any[]
  driverCount: number
  pendingActions: PendingAction[]
  mapPins: MapPin[]
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
const fmt$ = (cents: number) => "$" + (cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })
const fmtK = (cents: number) => {
  const d = cents / 100
  if (d >= 10000) return "$" + (d / 1000).toFixed(0) + "k"
  if (d >= 1000) return "$" + (d / 1000).toFixed(1) + "k"
  return "$" + d.toFixed(0)
}
const fmtPct = (n: number) => n + "%"
const ago = (ts: string) => {
  const m = Math.round((Date.now() - new Date(ts).getTime()) / 60000)
  if (m < 1) return "now"
  if (m < 60) return m + "m"
  if (m < 1440) return Math.round(m / 60) + "h"
  return Math.round(m / 1440) + "d"
}

const PENDING_TYPE_COLOR: Record<string, string> = {
  MANUAL_QUOTE: "#f59e0b", MANUAL_PRIORITY: "#f97316", URGENT_STRIPE: "#ef4444",
  DISPATCH_FAILED: "#ef4444", BRAIN_CRASH: "#dc2626", MANUAL_CITY: "#eab308",
  NO_DRIVERS: "#eab308", DISPATCH_MISSING_FIELDS: "#f97316",
}

const STATE_COLOR: Record<string, string> = {
  NEW: "#6b7280", COLLECTING: "#3b82f6", ASKING_DIMENSIONS: "#3b82f6",
  QUOTING: "#f59e0b", FOLLOW_UP: "#eab308", ORDER_PLACED: "#10b981",
  AWAITING_PAYMENT: "#f97316", AWAITING_PRIORITY_PAYMENT: "#f97316",
  DELIVERED: "#10b981", CLOSED: "#6b7280", OUT_OF_AREA: "#6b7280",
}

// ═══════════════════════════════════════════════════════
// MINI COMPONENTS
// ═══════════════════════════════════════════════════════
function KPI({ label, value, sub, color, alert }: { label: string; value: string; sub?: string; color?: string; alert?: boolean }) {
  return (
    <div style={{ background: alert ? "#1a0a0a" : "#111", border: `1px solid ${alert ? "#ff4444" : "#222"}`, borderRadius: 8, padding: "14px 16px", minWidth: 130 }}>
      <div style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: color || "#fff", marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function FunnelBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <div style={{ flex: 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#aaa", marginBottom: 4 }}>
        <span>{label}</span><span style={{ color }}>{count} ({pct}%)</span>
      </div>
      <div style={{ height: 6, background: "#222", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 3, transition: "width 0.5s" }} />
      </div>
    </div>
  )
}

function Sparkline({ data, dataKey, color, height = 40 }: { data: any[]; dataKey: string; color: string; height?: number }) {
  if (!data || data.length < 2) return null
  const values = data.map(d => d[dataKey] || 0)
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const range = max - min || 1
  const w = 200
  const points = values.map((v, i) => `${(i / (values.length - 1)) * w},${height - ((v - min) / range) * (height - 4) - 2}`).join(" ")
  return (
    <svg width={w} height={height} style={{ display: "block" }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} />
      {/* Last point dot */}
      {values.length > 0 && (
        <circle cx={w} cy={height - ((values[values.length - 1] - min) / range) * (height - 4) - 2} r={3} fill={color} />
      )}
    </svg>
  )
}

function AgentRow({ a }: { a: AgentPipeline }) {
  return (
    <tr style={{ borderBottom: "1px solid #1a1a1a" }}>
      <td style={{ padding: "10px 12px", fontWeight: 600 }}>{a.name}</td>
      <td style={{ padding: "10px 8px", textAlign: "center" }}>{a.totalLeads}</td>
      <td style={{ padding: "10px 8px", textAlign: "center" }}>{a.activeLeads}</td>
      <td style={{ padding: "10px 8px", textAlign: "right", color: "#f59e0b" }}>{fmtK(a.quotedCents)}</td>
      <td style={{ padding: "10px 8px", textAlign: "center" }}>{a.orderedCount}</td>
      <td style={{ padding: "10px 8px", textAlign: "right", color: "#10b981" }}>{fmtK(a.orderedCents)}</td>
      <td style={{ padding: "10px 8px", textAlign: "center" }}>{a.completedCount}</td>
      <td style={{ padding: "10px 8px", textAlign: "right", color: "#22c55e" }}>{fmtK(a.completedCents)}</td>
      <td style={{ padding: "10px 8px", textAlign: "center" }}>{a.paidCount}</td>
      <td style={{ padding: "10px 8px", textAlign: "right", color: "#4ade80", fontWeight: 600 }}>{fmtK(a.paidCents)}</td>
      <td style={{ padding: "10px 8px", textAlign: "center", color: a.closeRate >= 30 ? "#10b981" : a.closeRate >= 15 ? "#f59e0b" : "#ef4444" }}>{fmtPct(a.closeRate)}</td>
      <td style={{ padding: "10px 8px", textAlign: "right", color: "#a78bfa" }}>{fmtK(a.commissionCents)}</td>
    </tr>
  )
}

function CityRow({ c }: { c: CityData }) {
  return (
    <tr style={{ borderBottom: "1px solid #1a1a1a" }}>
      <td style={{ padding: "8px 12px", fontWeight: 500 }}>{c.name}</td>
      <td style={{ padding: "8px 8px", textAlign: "center" }}>{c.orders}</td>
      <td style={{ padding: "8px 8px", textAlign: "center" }}>{c.completed}</td>
      <td style={{ padding: "8px 8px", textAlign: "center" }}>{c.dispatching > 0 ? <span style={{ color: "#f59e0b" }}>{c.dispatching}</span> : "0"}</td>
      <td style={{ padding: "8px 8px", textAlign: "right" }}>${Math.round(c.revenue).toLocaleString()}</td>
      <td style={{ padding: "8px 8px", textAlign: "right" }}>${Math.round(c.driverPay).toLocaleString()}</td>
      <td style={{ padding: "8px 8px", textAlign: "right", color: c.margin > 0 ? "#10b981" : "#ef4444" }}>${Math.round(c.margin).toLocaleString()}</td>
      <td style={{ padding: "8px 8px", textAlign: "center", color: c.marginPct >= 40 ? "#10b981" : c.marginPct >= 20 ? "#f59e0b" : "#ef4444" }}>{c.marginPct}%</td>
      <td style={{ padding: "8px 8px", textAlign: "right" }}>{c.yards.toLocaleString()}</td>
    </tr>
  )
}

function PendingActionRow({ item, onResolve }: { item: PendingAction; onResolve: (id: string) => void }) {
  const color = PENDING_TYPE_COLOR[item.type] || "#888"
  return (
    <div style={{ padding: "10px 12px", borderLeft: `3px solid ${color}`, background: "#111", borderRadius: "0 6px 6px 0", marginBottom: 6, fontSize: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <span style={{ background: color + "22", color, padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700, marginRight: 8 }}>{item.type}</span>
          <span style={{ fontWeight: 600 }}>{item.customer_name || item.phone}</span>
          {item.delivery_city && <span style={{ color: "#666", marginLeft: 8 }}>{item.delivery_city}</span>}
          {item.yards_needed && <span style={{ color: "#666", marginLeft: 8 }}>{item.yards_needed}yd</span>}
          {item.total_price_cents && <span style={{ color: "#10b981", marginLeft: 8 }}>{fmt$(item.total_price_cents)}</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: item.minutesOld > 30 ? "#ef4444" : "#888", fontSize: 11 }}>{item.minutesOld}m ago</span>
          <a href={`sms:+1${item.phone}`} style={{ fontSize: 11, color: "#3b82f6", textDecoration: "none" }}>SMS</a>
          <button onClick={() => onResolve(item.id)} style={{ fontSize: 11, background: "#222", color: "#10b981", border: "1px solid #333", borderRadius: 4, padding: "2px 10px", cursor: "pointer" }}>Resolve</button>
        </div>
      </div>
      <div style={{ color: "#666", fontSize: 11, marginTop: 4, maxWidth: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.message}</div>
    </div>
  )
}

function CustomerRow({ c, smsHistory }: { c: any; smsHistory: any[] }) {
  const [expanded, setExpanded] = useState(false)
  const stateColor = STATE_COLOR[c.state] || "#888"
  const agentName = c._agentName || "Unassigned"
  const material = c.material_type?.replace(/_/g, " ") || ""

  return (
    <>
      <tr onClick={() => setExpanded(!expanded)} style={{ borderBottom: "1px solid #1a1a1a", cursor: "pointer" }}>
        <td style={{ padding: "8px 12px", fontSize: 12, color: "#888" }}>{agentName}</td>
        <td style={{ padding: "8px 8px", fontWeight: 500 }}>
          {c.customer_name || c.phone?.slice(-4)}
          {c.phone && (
            <a href={`tel:+1${c.phone.replace(/\D/g, "").replace(/^1/, "")}`} onClick={e => e.stopPropagation()} style={{ marginLeft: 8, fontSize: 11, color: "#3b82f6", textDecoration: "none", fontWeight: 400 }}>
              {c.phone.replace(/\D/g, "").replace(/^1/, "").replace(/(\d{3})(\d{3})(\d{4})/, "($1) $2-$3")}
            </a>
          )}
        </td>
        <td style={{ padding: "8px 8px", fontSize: 12 }}>
          {c.yards_needed && <span>{c.yards_needed}yd </span>}
          {material && <span style={{ color: "#888" }}>{material}</span>}
        </td>
        <td style={{ padding: "8px 8px", textAlign: "right" }}>{c.total_price_cents ? fmt$(c.total_price_cents) : "--"}</td>
        <td style={{ padding: "8px 8px" }}><span style={{ background: stateColor + "22", color: stateColor, padding: "2px 8px", borderRadius: 4, fontSize: 11 }}>{c.state}</span></td>
        <td style={{ padding: "8px 8px", fontSize: 11, color: "#666" }}>{ago(c.updated_at)}</td>
        <td style={{ padding: "8px 4px", fontSize: 11, color: "#444" }}>{expanded ? "−" : "+"}</td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} style={{ padding: "0 12px 12px 40px", background: "#0d0d0d" }}>
            <div style={{ maxHeight: 300, overflowY: "auto", fontSize: 12, lineHeight: 1.6 }}>
              {smsHistory.filter(s => s.phone === c.phone?.replace(/\D/g, "").replace(/^1/, "")).slice(-20).map((s: any, i: number) => (
                <div key={i} style={{ padding: "3px 0", borderBottom: "1px solid #111" }}>
                  <span style={{ color: s.direction === "inbound" ? "#3b82f6" : "#10b981", fontWeight: 600, fontSize: 11, marginRight: 8 }}>
                    {s.direction === "inbound" ? "CUST" : "SARAH"}
                  </span>
                  <span style={{ color: "#ccc" }}>{(s.body || "").slice(0, 200)}</span>
                  <span style={{ color: "#444", marginLeft: 8, fontSize: 10 }}>{ago(s.created_at)}</span>
                </div>
              ))}
              {smsHistory.filter(s => s.phone === c.phone?.replace(/\D/g, "").replace(/^1/, "")).length === 0 && (
                <div style={{ color: "#444", fontStyle: "italic" }}>No SMS history loaded</div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════
// ORDER MAP — Leaflet via CDN, no API key needed
// ═══════════════════════════════════════════════════════
function OrderMap({ pins }: { pins: MapPin[] }) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)

  useEffect(() => {
    if (!mapRef.current || pins.length === 0) return
    // Load Leaflet CSS
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link")
      link.id = "leaflet-css"
      link.rel = "stylesheet"
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
      document.head.appendChild(link)
    }
    // Load Leaflet JS
    const loadMap = () => {
      const L = (window as any).L
      if (!L || !mapRef.current) return

      // Destroy previous instance
      if (mapInstanceRef.current) { mapInstanceRef.current.remove(); mapInstanceRef.current = null }

      const map = L.map(mapRef.current).setView([32.75, -97.33], 8) // DFW center
      mapInstanceRef.current = map
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap",
        maxZoom: 18,
      }).addTo(map)

      const pinColors: Record<string, string> = {
        ORDER_PLACED: "#10b981", QUOTING: "#f59e0b", COLLECTING: "#3b82f6",
        AWAITING_PAYMENT: "#8b5cf6", DELIVERED: "#22c55e", CLOSED: "#666",
        OUT_OF_AREA: "#ef4444", FOLLOW_UP: "#f97316",
      }

      const bounds: [number, number][] = []
      for (const p of pins) {
        if (!p.lat || !p.lng) continue
        bounds.push([p.lat, p.lng])
        const color = pinColors[p.state] || "#888"
        const radius = p.hasOrder ? 8 : 5
        const circle = L.circleMarker([p.lat, p.lng], {
          radius, color, fillColor: color, fillOpacity: 0.8, weight: p.hasOrder ? 2 : 1,
        }).addTo(map)
        const price = p.totalCents ? "$" + (p.totalCents / 100).toLocaleString() : "--"
        const material = (p.material || "fill_dirt").replace(/_/g, " ")
        const phone = p.phone?.replace(/(\d{3})(\d{3})(\d{4})/, "($1) $2-$3") || ""
        circle.bindPopup(`
          <div style="font-family:system-ui;font-size:13px;line-height:1.5;min-width:180px">
            <b>${p.name || "Unknown"}</b><br>
            <a href="tel:+1${p.phone}" style="color:#3b82f6">${phone}</a><br>
            ${p.address || p.city || ""}<br>
            ${p.yards ? p.yards + "yd " : ""}${material} — <b>${price}</b><br>
            <span style="color:${color};font-weight:600">${p.state}</span><br>
            <span style="color:#888;font-size:11px">Agent: ${p.agentName || "Unassigned"}</span>
          </div>
        `)
      }
      if (bounds.length > 0) map.fitBounds(bounds, { padding: [30, 30] })
    }

    if ((window as any).L) { loadMap() }
    else {
      if (!document.getElementById("leaflet-js")) {
        const script = document.createElement("script")
        script.id = "leaflet-js"
        script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
        script.onload = loadMap
        document.head.appendChild(script)
      } else {
        // Script exists but not loaded yet — poll
        const interval = setInterval(() => { if ((window as any).L) { clearInterval(interval); loadMap() } }, 100)
        return () => clearInterval(interval)
      }
    }

    return () => {
      if (mapInstanceRef.current) { mapInstanceRef.current.remove(); mapInstanceRef.current = null }
    }
  }, [pins])

  if (pins.length === 0) return <div style={{ color: "#444", fontStyle: "italic", padding: 20 }}>No geocoded orders to display</div>

  return (
    <div style={{ background: "#111", border: "1px solid #222", borderRadius: 8, overflow: "hidden" }}>
      <div style={{ padding: "10px 16px", fontSize: 13, fontWeight: 700, borderBottom: "1px solid #222", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Order Map ({pins.length} pins)</span>
        <div style={{ display: "flex", gap: 8, fontSize: 10 }}>
          {[["ORDER_PLACED","#10b981"], ["QUOTING","#f59e0b"], ["COLLECTING","#3b82f6"], ["AWAITING_PAYMENT","#8b5cf6"], ["OTHER","#888"]].map(([label, color]) => (
            <span key={label} style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block" }} />
              {label}
            </span>
          ))}
        </div>
      </div>
      <div ref={mapRef} style={{ height: 500, width: "100%" }} />
    </div>
  )
}

// ═══════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════
export default function CommandCenter() {
  const [data, setData] = useState<CommandData | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<"overview" | "agents" | "customers" | "cities" | "brain" | "sms">("overview")
  const [resolving, setResolving] = useState<string | null>(null)
  const [alertsOpen, setAlertsOpen] = useState(false)
  const intervalRef = useRef<any>(null)

  const fetchData = useCallback(async () => {
    try {
      const r = await fetch("/api/command-center")
      if (r.ok) {
        const d = await r.json()
        // Enrich customer conversations with agent names
        const agentNames: Record<string, string> = {}
        for (const a of (d.salesAgents || [])) agentNames[a.id] = a.name
        for (const c of (d.activeConversations?.customers || [])) {
          c._agentName = c.agent_id ? agentNames[c.agent_id] || "Unknown" : "Unassigned"
        }
        setData(d)
      }
    } catch (e) { console.error("fetch failed:", e) }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchData()
    // Refresh every 5s — the command center is a live dashboard, not a status page.
    // Customer orders that populate slowly are the #1 complaint, so we poll fast.
    intervalRef.current = setInterval(fetchData, 5000)
    return () => clearInterval(intervalRef.current)
  }, [tab, fetchData])

  const resolveAction = async (id: string) => {
    setResolving(id)
    try {
      await fetch(`/api/admin/pending-actions/${id}/resolve`, { method: "POST" })
      await fetchData()
    } catch {}
    setResolving(null)
  }

  if (loading || !data) return <div style={{ background: "#0a0a0a", color: "#fff", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>Loading...</div>

  const d = data
  const totalAlerts = d.alerts.staleOrders + d.alerts.driverNoShows + d.alerts.stuckDriverConvs + d.alerts.stuckCustomerConvs + d.alerts.unpaidCustomers + d.pendingActions.length

  return (
    <div style={{ background: "#0a0a0a", color: "#e5e5e5", minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {/* ── HEADER ── */}
      <div style={{ borderBottom: "1px solid #1a1a1a", padding: "12px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: "#fff" }}>Command Center</h1>
          <a href="/admin" style={{ fontSize: 12, color: "#3b82f6", textDecoration: "none" }}>Admin</a>
          <a href="/admin/dispatch" style={{ fontSize: 12, color: "#3b82f6", textDecoration: "none" }}>+ Dispatch</a>
          <a href="/admin/driver-pay" style={{ fontSize: 12, color: "#3b82f6", textDecoration: "none" }}>Driver Pay</a>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, position: "relative" }}>
          {totalAlerts > 0 && (
            <button
              onClick={() => setAlertsOpen(!alertsOpen)}
              style={{
                background: "#ef4444", color: "#fff", padding: "4px 12px", borderRadius: 10,
                fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer",
                display: "flex", alignItems: "center", gap: 6,
              }}
            >
              <span style={{ fontSize: 14 }}>🔔</span>
              {totalAlerts} alerts
              <span style={{ fontSize: 10, marginLeft: 2 }}>{alertsOpen ? "▲" : "▼"}</span>
            </button>
          )}
          <span style={{ fontSize: 11, color: "#444" }}>Updated {ago(d.timestamp)}</span>

          {/* Alert dropdown */}
          {alertsOpen && totalAlerts > 0 && (
            <>
              {/* Click-away overlay */}
              <div onClick={() => setAlertsOpen(false)} style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 998 }} />
              <div style={{
                position: "absolute", top: "100%", right: 0, marginTop: 10,
                width: 480, maxHeight: 600, overflowY: "auto",
                background: "#0d0d0d", border: "1px solid #333", borderRadius: 8,
                boxShadow: "0 10px 40px rgba(0,0,0,0.8)", zIndex: 999, padding: 12,
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 10, padding: "4px 8px", borderBottom: "1px solid #222", paddingBottom: 8 }}>
                  All Alerts ({totalAlerts})
                </div>

                {d.pendingActions.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#ef4444", textTransform: "uppercase", padding: "4px 8px" }}>
                      Needs Human Action ({d.pendingActions.length})
                    </div>
                    {d.pendingActions.slice(0, 10).map(a => (
                      <div key={a.id} style={{ fontSize: 12, color: "#ccc", padding: "6px 8px", borderBottom: "1px solid #1a1a1a" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, color: "#fff" }}>
                              {a.customer_name || a.phone?.slice(-4)}
                              <span style={{ color: "#888", fontWeight: 400, marginLeft: 6, fontSize: 11 }}>{a.type}</span>
                            </div>
                            <div style={{ color: "#888", fontSize: 11, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.message}</div>
                          </div>
                          <a href={`tel:+1${a.phone?.replace(/\D/g, "")}`} onClick={e => e.stopPropagation()} style={{ fontSize: 10, color: "#3b82f6", textDecoration: "none", flexShrink: 0 }}>call</a>
                          <button onClick={() => resolveAction(a.id)} disabled={resolving === a.id} style={{ fontSize: 10, color: "#10b981", background: "none", border: "1px solid #10b981", borderRadius: 4, padding: "2px 6px", cursor: "pointer" }}>
                            {resolving === a.id ? "..." : "clear"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {d.alerts.stuckCustomerConvs > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b", textTransform: "uppercase", padding: "4px 8px" }}>
                      Stuck Customer Conversations ({d.alerts.stuckCustomerConvs})
                    </div>
                    {d.stuckCustomers.slice(0, 8).map((c: any, i: number) => (
                      <div key={i} style={{ fontSize: 12, color: "#ccc", padding: "4px 8px", borderBottom: "1px solid #1a1a1a" }}>
                        <span style={{ fontWeight: 600, color: "#fff" }}>{c.customer_name || c.phone?.slice(-4)}</span>
                        <span style={{ color: "#888", marginLeft: 6 }}>{c.state}</span>
                        <span style={{ color: "#666", marginLeft: 6, fontSize: 11 }}>{ago(c.updated_at)}</span>
                        {c.total_price_cents && <span style={{ color: "#10b981", marginLeft: 6 }}>{fmt$(c.total_price_cents)}</span>}
                      </div>
                    ))}
                  </div>
                )}

                {d.alerts.staleOrders > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b", textTransform: "uppercase", padding: "4px 8px" }}>
                      Stale Orders 4h+ ({d.alerts.staleOrders})
                    </div>
                    {d.staleOrders.slice(0, 8).map((o: any, i: number) => (
                      <div key={i} style={{ fontSize: 12, color: "#ccc", padding: "4px 8px", borderBottom: "1px solid #1a1a1a" }}>
                        <span style={{ fontWeight: 600, color: "#fff" }}>{o.client_name}</span>
                        <span style={{ color: "#888", marginLeft: 6 }}>{o.yards_needed}yd</span>
                        <span style={{ color: "#666", marginLeft: 6, fontSize: 11 }}>{ago(o.created_at)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {d.alerts.unpaidCustomers > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#f97316", textTransform: "uppercase", padding: "4px 8px" }}>
                      Unpaid Deliveries ({d.alerts.unpaidCustomers})
                    </div>
                    {d.unpaidCustomers.slice(0, 8).map((c: any, i: number) => (
                      <div key={i} style={{ fontSize: 12, color: "#ccc", padding: "4px 8px", borderBottom: "1px solid #1a1a1a" }}>
                        <span style={{ fontWeight: 600, color: "#fff" }}>{c.customer_name || c.phone?.slice(-4)}</span>
                        <span style={{ color: "#10b981", marginLeft: 6 }}>{fmt$(c.total_price_cents || 0)}</span>
                        <span style={{ color: "#666", marginLeft: 6, fontSize: 11 }}>{ago(c.updated_at)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {d.alerts.driverNoShows > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#ef4444", textTransform: "uppercase", padding: "4px 8px" }}>
                      Driver No-Shows ({d.alerts.driverNoShows})
                    </div>
                    {d.noShows.slice(0, 8).map((n: any, i: number) => (
                      <div key={i} style={{ fontSize: 12, color: "#ccc", padding: "4px 8px", borderBottom: "1px solid #1a1a1a" }}>
                        <span style={{ fontWeight: 600, color: "#fff" }}>{n.phone?.slice(-4)}</span>
                        <span style={{ color: "#666", marginLeft: 6, fontSize: 11 }}>{ago(n.updated_at)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {d.alerts.stuckDriverConvs > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b", textTransform: "uppercase", padding: "4px 8px" }}>
                      Stuck Driver Conversations ({d.alerts.stuckDriverConvs})
                    </div>
                    {d.stuckDrivers.slice(0, 8).map((c: any, i: number) => (
                      <div key={i} style={{ fontSize: 12, color: "#ccc", padding: "4px 8px", borderBottom: "1px solid #1a1a1a" }}>
                        <span style={{ fontWeight: 600, color: "#fff" }}>...{c.phone?.slice(-4)}</span>
                        <span style={{ color: "#888", marginLeft: 6 }}>{c.state}</span>
                        <span style={{ color: "#666", marginLeft: 6, fontSize: 11 }}>{ago(c.updated_at)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── EXECUTIVE KPIs ── */}
      <div style={{ padding: "16px 24px", display: "flex", gap: 10, overflowX: "auto" }}>
        <KPI label="Today Revenue" value={"$" + d.revenue.today.revenue.toLocaleString()} sub={`${d.revenue.today.completed} completed / ${d.revenue.today.orders} total`} color="#10b981" />
        <KPI label="Today Margin" value={"$" + d.revenue.today.margin.toLocaleString()} sub={d.revenue.today.revenue > 0 ? Math.round((d.revenue.today.margin / d.revenue.today.revenue) * 100) + "% margin" : "0%"} color={d.revenue.today.margin > 0 ? "#10b981" : "#ef4444"} />
        <KPI label="Week Revenue" value={"$" + d.revenue.week.revenue.toLocaleString()} sub={`${d.revenue.week.completed} completed`} color="#3b82f6" />
        <KPI label="Pipeline" value={fmtK(d.financial.pipelineCents)} sub="Quoted, not ordered" color="#f59e0b" />
        <KPI label="Outstanding" value={fmtK(d.financial.outstandingCents)} sub="Ordered, not paid" color="#f97316" alert={d.financial.outstandingCents > 100000} />
        <KPI label="Collected (30d)" value={fmtK(d.financial.collectedCents)} sub="Paid orders" color="#22c55e" />
        <KPI label="Month Revenue" value={"$" + d.revenue.month.revenue.toLocaleString()} sub={`${d.revenue.month.completed} completed`} color="#8b5cf6" />
        <KPI label="Drivers" value={String(d.driverCount || 0)} sub="Active" />
      </div>

      {/* ── PENDING ACTIONS (always visible if any) ── */}
      {d.pendingActions.length > 0 && (
        <div style={{ padding: "0 24px 12px" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#ef4444", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>
            Needs Human Action ({d.pendingActions.length})
          </div>
          {d.pendingActions.map(a => <PendingActionRow key={a.id} item={a} onResolve={resolveAction} />)}
        </div>
      )}

      {/* ── TAB BAR ── */}
      <div style={{ padding: "0 24px", borderBottom: "1px solid #1a1a1a", display: "flex", gap: 0 }}>
        {(["overview", "agents", "customers", "cities", "brain", "sms"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "10px 20px", fontSize: 13, fontWeight: tab === t ? 700 : 400,
            color: tab === t ? "#fff" : "#666", background: "none", border: "none",
            borderBottom: tab === t ? "2px solid #3b82f6" : "2px solid transparent",
            cursor: "pointer", textTransform: "capitalize",
          }}>{t}</button>
        ))}
      </div>

      {/* ── TAB CONTENT ── */}
      <div style={{ padding: "20px 24px" }}>

        {/* ════════ OVERVIEW ════════ */}
        {tab === "overview" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {/* Conversion Funnel */}
            <div style={{ background: "#111", border: "1px solid #222", borderRadius: 8, padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: "#fff" }}>30-Day Conversion Funnel</div>
              <div style={{ display: "flex", gap: 12 }}>
                <FunnelBar label="Leads" count={d.funnel.leads} total={d.funnel.leads} color="#3b82f6" />
                <FunnelBar label="Quoted" count={d.funnel.quoted} total={d.funnel.leads} color="#f59e0b" />
                <FunnelBar label="Ordered" count={d.funnel.ordered} total={d.funnel.leads} color="#10b981" />
                <FunnelBar label="Delivered" count={d.funnel.delivered} total={d.funnel.leads} color="#22c55e" />
                <FunnelBar label="Paid" count={d.funnel.paid} total={d.funnel.leads} color="#4ade80" />
              </div>
            </div>

            {/* Sparklines */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={{ background: "#111", border: "1px solid #222", borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>Orders (14d)</div>
                <Sparkline data={d.dailyTrend} dataKey="orders" color="#3b82f6" />
              </div>
              <div style={{ background: "#111", border: "1px solid #222", borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>Revenue (14d)</div>
                <Sparkline data={d.dailyTrend} dataKey="revenue" color="#10b981" />
              </div>
            </div>

            {/* Alerts Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
              <KPI label="Stale Orders" value={String(d.alerts.staleOrders)} color={d.alerts.staleOrders > 0 ? "#ef4444" : "#10b981"} alert={d.alerts.staleOrders > 0} />
              <KPI label="Driver No-Shows" value={String(d.alerts.driverNoShows)} color={d.alerts.driverNoShows > 0 ? "#ef4444" : "#10b981"} alert={d.alerts.driverNoShows > 0} />
              <KPI label="Stuck Customers" value={String(d.alerts.stuckCustomerConvs)} color={d.alerts.stuckCustomerConvs > 0 ? "#f59e0b" : "#10b981"} alert={d.alerts.stuckCustomerConvs > 0} />
              <KPI label="Stuck Drivers" value={String(d.alerts.stuckDriverConvs)} color={d.alerts.stuckDriverConvs > 0 ? "#f59e0b" : "#10b981"} alert={d.alerts.stuckDriverConvs > 0} />
              <KPI label="Unpaid Deliveries" value={String(d.alerts.unpaidCustomers)} sub={d.alerts.unpaidCustomerTotal > 0 ? "$" + d.alerts.unpaidCustomerTotal : ""} color={d.alerts.unpaidCustomers > 0 ? "#f97316" : "#10b981"} alert={d.alerts.unpaidCustomers > 0} />
              <KPI label="Pending Driver Pay" value={String(d.alerts.pendingDriverPayments)} sub={d.alerts.pendingDriverPayTotal > 0 ? "$" + d.alerts.pendingDriverPayTotal : ""} color={d.alerts.pendingDriverPayments > 0 ? "#f97316" : "#10b981"} />
            </div>

            {/* Stale Orders Detail */}
            {d.staleOrders.length > 0 && (
              <div style={{ background: "#1a0a0a", border: "1px solid #ff4444", borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#ef4444", marginBottom: 8 }}>Stale Orders (4h+ no driver)</div>
                {d.staleOrders.map((o: any) => (
                  <div key={o.id} style={{ fontSize: 12, color: "#ccc", padding: "4px 0" }}>
                    {o.cities?.name || "?"} — {o.yards_needed}yd — ${Math.round((o.driver_pay_cents || 0) / 100)}/load — {ago(o.created_at)}
                    {o.price_quoted_cents && <span style={{ color: "#10b981", marginLeft: 8 }}>{fmt$((o as any).price_quoted_cents)}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ════════ AGENTS ════════ */}
        {tab === "agents" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ fontSize: 12, color: "#888" }}>
              {d.unassignedLeads > 0 && <span style={{ color: "#f59e0b" }}>{d.unassignedLeads} unassigned leads</span>}
            </div>
            <div style={{ background: "#111", border: "1px solid #222", borderRadius: 8, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#0d0d0d", borderBottom: "1px solid #222" }}>
                    <th style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, color: "#888", fontWeight: 600 }}>Agent</th>
                    <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 11, color: "#888" }}>Leads</th>
                    <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 11, color: "#888" }}>Active</th>
                    <th style={{ padding: "10px 8px", textAlign: "right", fontSize: 11, color: "#f59e0b" }}>Quoted $</th>
                    <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 11, color: "#888" }}>Orders</th>
                    <th style={{ padding: "10px 8px", textAlign: "right", fontSize: 11, color: "#10b981" }}>Ordered $</th>
                    <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 11, color: "#888" }}>Done</th>
                    <th style={{ padding: "10px 8px", textAlign: "right", fontSize: 11, color: "#22c55e" }}>Completed $</th>
                    <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 11, color: "#888" }}>Paid</th>
                    <th style={{ padding: "10px 8px", textAlign: "right", fontSize: 11, color: "#4ade80" }}>Collected $</th>
                    <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 11, color: "#888" }}>Close %</th>
                    <th style={{ padding: "10px 8px", textAlign: "right", fontSize: 11, color: "#a78bfa" }}>Commission</th>
                  </tr>
                </thead>
                <tbody>
                  {d.agentPipeline.map(a => <AgentRow key={a.id} a={a} />)}
                  {/* Totals row */}
                  <tr style={{ background: "#0d0d0d", fontWeight: 700, borderTop: "2px solid #333" }}>
                    <td style={{ padding: "10px 12px" }}>Total</td>
                    <td style={{ padding: "10px 8px", textAlign: "center" }}>{d.agentPipeline.reduce((s, a) => s + a.totalLeads, 0)}</td>
                    <td style={{ padding: "10px 8px", textAlign: "center" }}>{d.agentPipeline.reduce((s, a) => s + a.activeLeads, 0)}</td>
                    <td style={{ padding: "10px 8px", textAlign: "right", color: "#f59e0b" }}>{fmtK(d.agentPipeline.reduce((s, a) => s + a.quotedCents, 0))}</td>
                    <td style={{ padding: "10px 8px", textAlign: "center" }}>{d.agentPipeline.reduce((s, a) => s + a.orderedCount, 0)}</td>
                    <td style={{ padding: "10px 8px", textAlign: "right", color: "#10b981" }}>{fmtK(d.agentPipeline.reduce((s, a) => s + a.orderedCents, 0))}</td>
                    <td style={{ padding: "10px 8px", textAlign: "center" }}>{d.agentPipeline.reduce((s, a) => s + a.completedCount, 0)}</td>
                    <td style={{ padding: "10px 8px", textAlign: "right", color: "#22c55e" }}>{fmtK(d.agentPipeline.reduce((s, a) => s + a.completedCents, 0))}</td>
                    <td style={{ padding: "10px 8px", textAlign: "center" }}>{d.agentPipeline.reduce((s, a) => s + a.paidCount, 0)}</td>
                    <td style={{ padding: "10px 8px", textAlign: "right", color: "#4ade80" }}>{fmtK(d.agentPipeline.reduce((s, a) => s + a.paidCents, 0))}</td>
                    <td style={{ padding: "10px 8px", textAlign: "center" }}>--</td>
                    <td style={{ padding: "10px 8px", textAlign: "right", color: "#a78bfa" }}>{fmtK(d.agentPipeline.reduce((s, a) => s + a.commissionCents, 0))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ════════ CUSTOMERS ════════ */}
        {tab === "customers" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* State legend */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {Object.entries(
                (d.activeConversations.customers || []).reduce((acc: Record<string, number>, c: any) => {
                  acc[c.state] = (acc[c.state] || 0) + 1; return acc
                }, {})
              ).sort((a, b) => b[1] - a[1]).map(([state, count]) => (
                <span key={state} style={{ background: (STATE_COLOR[state] || "#888") + "22", color: STATE_COLOR[state] || "#888", padding: "3px 10px", borderRadius: 4, fontSize: 11 }}>
                  {state} ({count})
                </span>
              ))}
            </div>

            <div style={{ background: "#111", border: "1px solid #222", borderRadius: 8, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#0d0d0d", borderBottom: "1px solid #222" }}>
                    <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, color: "#888" }}>Agent</th>
                    <th style={{ padding: "8px 8px", textAlign: "left", fontSize: 11, color: "#888" }}>Customer</th>
                    <th style={{ padding: "8px 8px", textAlign: "left", fontSize: 11, color: "#888" }}>Order</th>
                    <th style={{ padding: "8px 8px", textAlign: "right", fontSize: 11, color: "#888" }}>Quote</th>
                    <th style={{ padding: "8px 8px", textAlign: "left", fontSize: 11, color: "#888" }}>Status</th>
                    <th style={{ padding: "8px 8px", textAlign: "left", fontSize: 11, color: "#888" }}>Updated</th>
                    <th style={{ padding: "8px 4px" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {(d.activeConversations.customers || []).map((c: any) => (
                    <CustomerRow key={c.phone} c={c} smsHistory={d.recentCustSms || []} />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Stuck customers */}
            {d.stuckCustomers.length > 0 && (
              <div style={{ background: "#1a0a0a", border: "1px solid #ff4444", borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#ef4444", marginBottom: 8 }}>Stuck Conversations (2h+ no update)</div>
                {d.stuckCustomers.map((c: any, i: number) => (
                  <div key={i} style={{ fontSize: 12, color: "#ccc", padding: "4px 0" }}>
                    {c.customer_name || c.phone?.slice(-4)} — {c.state} — {ago(c.updated_at)}
                    {c.total_price_cents && <span style={{ color: "#10b981", marginLeft: 8 }}>{fmt$(c.total_price_cents)}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ════════ CITIES ════════ */}
        {tab === "cities" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <OrderMap pins={d.mapPins || []} />
          <div style={{ background: "#111", border: "1px solid #222", borderRadius: 8, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#0d0d0d", borderBottom: "1px solid #222" }}>
                  <th style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, color: "#888" }}>City</th>
                  <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 11, color: "#888" }}>Orders</th>
                  <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 11, color: "#888" }}>Done</th>
                  <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 11, color: "#888" }}>Active</th>
                  <th style={{ padding: "10px 8px", textAlign: "right", fontSize: 11, color: "#888" }}>Revenue</th>
                  <th style={{ padding: "10px 8px", textAlign: "right", fontSize: 11, color: "#888" }}>Driver Pay</th>
                  <th style={{ padding: "10px 8px", textAlign: "right", fontSize: 11, color: "#888" }}>Margin</th>
                  <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 11, color: "#888" }}>Margin %</th>
                  <th style={{ padding: "10px 8px", textAlign: "right", fontSize: 11, color: "#888" }}>Yards</th>
                </tr>
              </thead>
              <tbody>
                {d.cityIntel.map(c => <CityRow key={c.name} c={c} />)}
              </tbody>
            </table>
          </div>
          </div>
        )}

        {/* ════════ BRAIN HEALTH ════════ */}
        {tab === "brain" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
              <KPI label="Brain Crashes (7d)" value={String(d.brainHealth.crashesThisWeek)} color={d.brainHealth.crashesThisWeek > 0 ? "#ef4444" : "#10b981"} alert={d.brainHealth.crashesThisWeek > 3} />
              <KPI label="Pending Actions" value={String(d.brainHealth.totalPendingActions)} color={d.brainHealth.totalPendingActions > 0 ? "#f59e0b" : "#10b981"} />
              <KPI label="Active Customers" value={String(d.activeConversations.customers?.length || 0)} color="#3b82f6" />
              <KPI label="Active Drivers" value={String(d.activeConversations.drivers?.length || 0)} color="#3b82f6" />
            </div>

            {/* Action type breakdown */}
            <div style={{ background: "#111", border: "1px solid #222", borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: "#fff" }}>Pending Actions by Type (48h)</div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {Object.entries(d.brainHealth.pendingActionsByType).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
                  <div key={type} style={{ background: (PENDING_TYPE_COLOR[type] || "#888") + "15", border: `1px solid ${PENDING_TYPE_COLOR[type] || "#888"}44`, borderRadius: 6, padding: "8px 14px" }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: PENDING_TYPE_COLOR[type] || "#888" }}>{count}</div>
                    <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>{type}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Driver conversations */}
            {d.activeConversations.drivers.length > 0 && (
              <div style={{ background: "#111", border: "1px solid #222", borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: "#fff" }}>Active Driver Conversations</div>
                {d.activeConversations.drivers.map((c: any, i: number) => (
                  <div key={i} style={{ fontSize: 12, padding: "4px 0", color: "#ccc", borderBottom: "1px solid #1a1a1a" }}>
                    ...{c.phone?.slice(-4)} — <span style={{ color: STATE_COLOR[c.state] || "#888" }}>{c.state}</span>
                    {c.extracted_city && <span style={{ color: "#666", marginLeft: 8 }}>{c.extracted_city}</span>}
                    <span style={{ color: "#444", marginLeft: 8 }}>{ago(c.updated_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ════════ SMS ════════ */}
        {tab === "sms" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={{ background: "#111", border: "1px solid #222", borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: "#fff" }}>Customer SMS (Recent)</div>
              {(d.recentCustSms || []).filter(s => s.direction === "inbound" || s.direction === "outbound").slice(0, 25).map((s: any, i: number) => (
                <div key={i} style={{ fontSize: 11, padding: "3px 0", borderBottom: "1px solid #1a1a1a" }}>
                  <span style={{ color: s.direction === "inbound" ? "#3b82f6" : "#10b981", fontWeight: 600, width: 28, display: "inline-block" }}>
                    {s.direction === "inbound" ? "IN" : "OUT"}
                  </span>
                  <span style={{ color: "#666", marginRight: 6 }}>...{s.phone?.slice(-4)}</span>
                  <span style={{ color: "#aaa" }}>{(s.body || "").slice(0, 80)}</span>
                  <span style={{ color: "#333", marginLeft: 6 }}>{ago(s.created_at)}</span>
                </div>
              ))}
            </div>
            <div style={{ background: "#111", border: "1px solid #222", borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: "#fff" }}>Driver SMS (Recent)</div>
              {(d.recentSms || []).filter(s => s.direction === "inbound" || s.direction === "outbound").slice(0, 25).map((s: any, i: number) => (
                <div key={i} style={{ fontSize: 11, padding: "3px 0", borderBottom: "1px solid #1a1a1a" }}>
                  <span style={{ color: s.direction === "inbound" ? "#3b82f6" : "#10b981", fontWeight: 600, width: 28, display: "inline-block" }}>
                    {s.direction === "inbound" ? "IN" : "OUT"}
                  </span>
                  <span style={{ color: "#666", marginRight: 6 }}>...{s.phone?.slice(-4)}</span>
                  <span style={{ color: "#aaa" }}>{(s.body || "").slice(0, 80)}</span>
                  <span style={{ color: "#333", marginLeft: 6 }}>{ago(s.created_at)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
