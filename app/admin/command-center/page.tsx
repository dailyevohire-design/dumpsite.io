"use client"
import { useState, useEffect, useRef } from "react"

interface CommandData {
  timestamp: string
  revenue: {
    today: { orders: number; completed: number; yards: number; revenue: number; driverPay: number; margin: number }
    week: { orders: number; completed: number; yards: number; revenue: number }
  }
  alerts: {
    staleOrders: number; unpaidCustomers: number; unpaidCustomerTotal: number
    stuckDriverConvs: number; stuckCustomerConvs: number; driverNoShows: number
    pendingDriverPayments: number; pendingDriverPayTotal: number
  }
  activeConversations: { drivers: any[]; customers: any[] }
  agentPipeline: { id: string; name: string; leads: number; quotedCents: number; orders: number; paidCents: number }[]
  unassignedLeads: number
  salesAgents: { id: string; name: string }[]
  staleOrders: any[]; unpaidCustomers: any[]; stuckDrivers: any[]; stuckCustomers: any[]; noShows: any[]
  recentSms: any[]; recentCustSms: any[]
  driverCount: number
  pendingActions: PendingAction[]
}

interface PendingAction {
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
}

const PENDING_TYPE_COLOR: Record<string, string> = {
  MANUAL_QUOTE:    "#f59e0b",
  MANUAL_PRIORITY: "#f97316",
  URGENT_STRIPE:   "#ef4444",
  DISPATCH_FAILED: "#ef4444",
  BRAIN_CRASH:     "#dc2626",
  MANUAL_CITY:     "#eab308",
  NO_DRIVERS:      "#eab308",
}

function PendingActionsCard({ items, onResolve }: { items: PendingAction[]; onResolve: (id: string) => void }) {
  if (!items || items.length === 0) {
    return (
      <Card title="Stuck Conversations / Manual Actions">
        <div style={{ color: "#10b981", fontSize: 13 }}>None — every conversation moving forward cleanly</div>
      </Card>
    )
  }
  return (
    <Card title={`${items.length} Stuck — needs your attention`} alert>
      {items.map(item => {
        const color = PENDING_TYPE_COLOR[item.type] || "#888"
        const phone = (item.phone || "").replace(/\D/g, "")
        const fmtPhone = phone.length === 10 ? `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}` : phone
        const ageStr = item.minutesOld < 60 ? `${item.minutesOld}m` : `${Math.round(item.minutesOld / 60)}h`
        const ageColor = item.minutesOld > 60 ? "#ef4444" : item.minutesOld > 15 ? "#f59e0b" : "#888"
        const tel = `sms:+1${phone}`
        return (
          <div key={item.id} style={{ background: "#0a0a0a", border: `1px solid ${color}33`, borderLeft: `3px solid ${color}`, borderRadius: 6, padding: 12, marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div>
                <span style={{ background: color, color: "#000", fontWeight: 700, fontSize: 11, padding: "2px 8px", borderRadius: 4, marginRight: 8 }}>{item.type}</span>
                <span style={{ color: "#fff", fontWeight: 600, fontSize: 14 }}>{item.customer_name || fmtPhone}</span>
                {item.delivery_city && <span style={{ color: "#888", marginLeft: 8, fontSize: 12 }}>· {item.delivery_city}</span>}
                {item.yards_needed && <span style={{ color: "#888", marginLeft: 8, fontSize: 12 }}>· {item.yards_needed}yds</span>}
                {item.total_price_cents && <span style={{ color: "#10b981", marginLeft: 8, fontSize: 12, fontWeight: 600 }}>${Math.round(item.total_price_cents / 100)}</span>}
              </div>
              <span style={{ color: ageColor, fontSize: 12, fontWeight: 600 }}>{ageStr} ago</span>
            </div>
            <div style={{ color: "#ccc", fontSize: 12, lineHeight: 1.4, marginBottom: 8 }}>{item.message}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <a href={tel} style={{ background: "#2563eb", color: "#fff", padding: "5px 12px", borderRadius: 4, fontSize: 12, fontWeight: 600, textDecoration: "none" }}>Text {fmtPhone}</a>
              <button onClick={() => onResolve(item.id)} style={{ background: "#16a34a", color: "#fff", padding: "5px 12px", borderRadius: 4, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer" }}>Mark Resolved</button>
            </div>
          </div>
        )
      })}
    </Card>
  )
}

// ── Customer state colors ──
const CUST_STATE: Record<string, { color: string; label: string }> = {
  NEW: { color: "#6b7280", label: "NEW" },
  COLLECTING: { color: "#3b82f6", label: "COLLECTING" },
  ASKING_DIMENSIONS: { color: "#3b82f6", label: "DIMENSIONS" },
  QUOTING: { color: "#f59e0b", label: "QUOTING" },
  ORDER_PLACED: { color: "#10b981", label: "ORDERED" },
  AWAITING_PAYMENT: { color: "#f97316", label: "AWAITING PAY" },
  AWAITING_PRIORITY_PAYMENT: { color: "#f97316", label: "PRIORITY PAY" },
  FOLLOW_UP: { color: "#eab308", label: "FOLLOW UP" },
  DELIVERED: { color: "#10b981", label: "DELIVERED" },
  CLOSED: { color: "#6b7280", label: "CLOSED" },
}
const custState = (s: string) => CUST_STATE[s] || { color: "#6b7280", label: s }

function Card({ title, children, alert }: { title: string; children: React.ReactNode; alert?: boolean }) {
  return (
    <div style={{ background: alert ? "#1a0a0a" : "#111", border: `1px solid ${alert ? "#ff4444" : "#333"}`, borderRadius: 8, padding: 16, marginBottom: 12 }}>
      <h3 style={{ margin: "0 0 12px", fontSize: 14, color: alert ? "#ff6666" : "#888", textTransform: "uppercase", letterSpacing: 1 }}>{title}</h3>
      {children}
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ display: "inline-block", marginRight: 24, marginBottom: 8 }}>
      <div style={{ fontSize: 28, fontWeight: 700, color: color || "#fff" }}>{value}</div>
      <div style={{ fontSize: 12, color: "#888" }}>{label}</div>
    </div>
  )
}

function ConvRow({ phone, state, detail, time }: { phone: string; state: string; detail: string; time: string }) {
  const stateColors: Record<string, string> = {
    ACTIVE: "#4CAF50", OTW_PENDING: "#4CAF50", COLLECTING: "#2196F3", QUOTING: "#FF9800",
    ORDER_PLACED: "#4CAF50", AWAITING_PAYMENT: "#FF9800", PHOTO_PENDING: "#9C27B0",
    APPROVAL_PENDING: "#9C27B0", JOB_PRESENTED: "#2196F3", ASKING_DIMENSIONS: "#2196F3",
  }
  const ago = Math.round((Date.now() - new Date(time).getTime()) / 60000)
  const agoStr = ago < 60 ? `${ago}m` : `${Math.round(ago / 60)}h`
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #222", fontSize: 13 }}>
      <span style={{ color: "#ccc" }}>{phone.slice(-4)}</span>
      <span style={{ color: stateColors[state] || "#888", fontWeight: 600 }}>{state}</span>
      <span style={{ color: "#888", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detail}</span>
      <span style={{ color: ago > 120 ? "#ff4444" : "#666" }}>{agoStr}</span>
    </div>
  )
}

function SmsRow({ phone, body, direction, time }: { phone: string; body: string; direction: string; time: string }) {
  const ago = Math.round((Date.now() - new Date(time).getTime()) / 60000)
  return (
    <div style={{ padding: "4px 0", borderBottom: "1px solid #1a1a1a", fontSize: 12 }}>
      <span style={{ color: direction === "inbound" ? "#4CAF50" : "#2196F3", marginRight: 8 }}>{direction === "inbound" ? "IN" : "OUT"}</span>
      <span style={{ color: "#666", marginRight: 8 }}>...{phone.slice(-4)}</span>
      <span style={{ color: "#aaa" }}>{(body || "").slice(0, 80)}</span>
      <span style={{ color: "#444", marginLeft: 8 }}>{ago}m</span>
    </div>
  )
}

// ── Customer conversation row with click-to-expand SMS thread ──
function CustomerRow({ conv, agentName, smsLog, expanded, onToggle }: {
  conv: any; agentName: string; smsLog: any[]; expanded: boolean; onToggle: () => void
}) {
  const st = custState(conv.state)
  const ago = Math.round((Date.now() - new Date(conv.updated_at).getTime()) / 60000)
  const agoStr = ago < 60 ? `${ago}m` : `${Math.round(ago / 60)}h`
  const phone = (conv.phone || "").replace(/\D/g, "")
  const fmtPhone = phone.length === 10 ? `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}` : phone.slice(-4)
  const material = conv.material_type ? conv.material_type.replace(/_/g, " ") : ""
  const quote = conv.total_price_cents ? `$${Math.round(conv.total_price_cents / 100)}` : ""
  const yards = conv.yards_needed ? `${conv.yards_needed}yds` : ""
  const customerMsgs = smsLog.filter(m => m.phone === phone)

  return (
    <div style={{ borderBottom: "1px solid #222" }}>
      <div
        onClick={onToggle}
        style={{ display: "grid", gridTemplateColumns: "90px 1fr 80px 60px 90px 50px", alignItems: "center", padding: "8px 0", cursor: "pointer", fontSize: 13, gap: 8 }}
      >
        <span style={{ color: "#8b5cf6", fontWeight: 600, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {agentName || "---"}
        </span>
        <span style={{ color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {conv.customer_name || fmtPhone}
          {conv.delivery_city ? <span style={{ color: "#666", marginLeft: 6 }}>{conv.delivery_city}</span> : null}
        </span>
        <span style={{ color: "#888", fontSize: 12, textAlign: "right" }}>
          {yards} {material ? material.split(" ")[0] : ""}
        </span>
        <span style={{ color: quote ? "#10b981" : "#444", fontWeight: 600, textAlign: "right" }}>{quote}</span>
        <span style={{
          color: st.color, fontWeight: 700, fontSize: 11, textAlign: "center",
          background: st.color + "18", padding: "2px 8px", borderRadius: 4,
        }}>
          {st.label}
        </span>
        <span style={{ color: ago > 120 ? "#ef4444" : "#555", textAlign: "right", fontSize: 12 }}>{agoStr}</span>
      </div>
      {expanded && (
        <div style={{ background: "#0a0a0a", borderTop: "1px solid #222", padding: "8px 12px", maxHeight: 300, overflowY: "auto" }}>
          {customerMsgs.length === 0 ? (
            <div style={{ color: "#555", fontSize: 12 }}>No SMS history loaded</div>
          ) : customerMsgs.map((m: any, i: number) => (
            <div key={i} style={{ padding: "3px 0", fontSize: 12 }}>
              <span style={{ color: m.direction === "inbound" ? "#4ade80" : "#60a5fa", marginRight: 6, fontWeight: 600, fontSize: 11 }}>
                {m.direction === "inbound" ? "CUST" : "SARAH"}
              </span>
              <span style={{ color: m.direction === "inbound" ? "#d1d5db" : "#9ca3af" }}>{(m.body || "").slice(0, 200)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Agent pipeline card ──
function AgentPipelineCard({ pipeline, unassigned }: { pipeline: CommandData["agentPipeline"]; unassigned: number }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${pipeline.length + (unassigned > 0 ? 1 : 0)}, 1fr)`, gap: 12, marginBottom: 12 }}>
      {pipeline.map(a => (
        <div key={a.id} style={{ background: "#111", border: "1px solid #333", borderRadius: 8, padding: 14, textAlign: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#8b5cf6", marginBottom: 8 }}>{a.name.split(" ")[0].toUpperCase()}</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#fff" }}>{a.leads}</div>
          <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>active leads</div>
          <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 6 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 600, color: "#f59e0b" }}>${Math.round(a.quotedCents / 100)}</div>
              <div style={{ fontSize: 10, color: "#666" }}>quoted</div>
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 600, color: "#10b981" }}>{a.orders}</div>
              <div style={{ fontSize: 10, color: "#666" }}>orders</div>
            </div>
          </div>
          {a.paidCents > 0 && (
            <div style={{ marginTop: 6, fontSize: 12, color: "#10b981" }}>
              ${Math.round(a.paidCents / 100)} collected
            </div>
          )}
        </div>
      ))}
      {unassigned > 0 && (
        <div style={{ background: "#111", border: "1px solid #333", borderRadius: 8, padding: 14, textAlign: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#6b7280", marginBottom: 8 }}>UNASSIGNED</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#fff" }}>{unassigned}</div>
          <div style={{ fontSize: 11, color: "#888" }}>leads</div>
        </div>
      )}
    </div>
  )
}

export default function CommandCenter() {
  const [data, setData] = useState<CommandData | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<"overview" | "drivers" | "customers" | "sms">("overview")
  const [expandedPhone, setExpandedPhone] = useState<string | null>(null)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  const refresh = async () => {
    try {
      const r = await fetch("/api/command-center")
      setData(await r.json())
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  const resolveAction = async (id: string) => {
    try {
      const r = await fetch(`/api/admin/pending-actions/${id}/resolve`, { method: "POST" })
      if (r.ok) refresh()
      else alert("Failed to resolve — check console")
    } catch (e) { console.error(e); alert("Network error resolving action") }
  }

  // 10s polling on customers tab, 30s on others
  useEffect(() => {
    refresh()
    if (intervalRef.current) clearInterval(intervalRef.current)
    const ms = tab === "customers" ? 10000 : 30000
    intervalRef.current = setInterval(refresh, ms)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [tab])

  if (loading || !data) return <div style={{ padding: 40, color: "#888" }}>Loading command center...</div>

  const a = data.alerts
  const totalAlerts = a.staleOrders + a.unpaidCustomers + a.stuckDriverConvs + a.stuckCustomerConvs + a.driverNoShows

  // Build agent name lookup
  const agentNames: Record<string, string> = {}
  for (const ag of (data.salesAgents || [])) agentNames[ag.id] = ag.name

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "20px 16px", fontFamily: "-apple-system, sans-serif", color: "#fff", background: "#0a0a0a", minHeight: "100vh" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>Command Center</h1>
        <div style={{ display: "flex", gap: 8 }}>
          {(["overview", "drivers", "customers", "sms"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ padding: "6px 14px", background: tab === t ? "#fff" : "#222", color: tab === t ? "#000" : "#888", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>{t}</button>
          ))}
          <button onClick={refresh} style={{ padding: "6px 14px", background: "#222", color: "#888", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>Refresh</button>
        </div>
      </div>

      <PendingActionsCard items={data.pendingActions || []} onResolve={resolveAction} />

      {totalAlerts > 0 && (
        <Card title={`${totalAlerts} Active Alerts`} alert>
          {a.staleOrders > 0 && <div style={{ color: "#ff6666", marginBottom: 4 }}>{a.staleOrders} orders with no driver for 4+ hours</div>}
          {a.driverNoShows > 0 && <div style={{ color: "#ff6666", marginBottom: 4 }}>{a.driverNoShows} drivers went OTW 3+ hours ago with no completion</div>}
          {a.stuckDriverConvs > 0 && <div style={{ color: "#ff9944", marginBottom: 4 }}>{a.stuckDriverConvs} driver conversations stuck 2+ hours</div>}
          {a.stuckCustomerConvs > 0 && <div style={{ color: "#ff9944", marginBottom: 4 }}>{a.stuckCustomerConvs} customer conversations stuck 2+ hours</div>}
          {a.unpaidCustomers > 0 && <div style={{ color: "#ff9944", marginBottom: 4 }}>{a.unpaidCustomers} unpaid customer deliveries (${a.unpaidCustomerTotal})</div>}
          {a.pendingDriverPayments > 0 && <div style={{ color: "#ffcc00", marginBottom: 4 }}>{a.pendingDriverPayments} pending driver payments (${a.pendingDriverPayTotal})</div>}
        </Card>
      )}

      {tab === "overview" && <>
        <Card title="Today">
          <Stat label="Orders" value={data.revenue.today.orders} />
          <Stat label="Completed" value={data.revenue.today.completed} color="#4CAF50" />
          <Stat label="Yards" value={data.revenue.today.yards} />
          <Stat label="Revenue" value={`$${data.revenue.today.revenue}`} color="#4CAF50" />
          <Stat label="Driver Pay" value={`$${data.revenue.today.driverPay}`} color="#FF9800" />
          <Stat label="Margin" value={`$${data.revenue.today.margin}`} color={data.revenue.today.margin >= 0 ? "#4CAF50" : "#ff4444"} />
        </Card>
        <Card title="This Week">
          <Stat label="Orders" value={data.revenue.week.orders} />
          <Stat label="Completed" value={data.revenue.week.completed} />
          <Stat label="Yards" value={data.revenue.week.yards} />
          <Stat label="Revenue" value={`$${data.revenue.week.revenue}`} color="#4CAF50" />
        </Card>
        {(data.agentPipeline || []).length > 0 && (
          <Card title="Sales Agent Performance (This Week)">
            {data.agentPipeline.map(a => (
              <div key={a.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #222", fontSize: 13 }}>
                <span style={{ color: "#8b5cf6", fontWeight: 600, width: 140 }}>{a.name}</span>
                <span style={{ color: "#3b82f6" }}>{a.leads} leads</span>
                <span style={{ color: "#f59e0b" }}>${Math.round(a.quotedCents / 100)} quoted</span>
                <span style={{ color: "#10b981" }}>{a.orders} orders</span>
                <span style={{ color: "#10b981", fontWeight: 600 }}>${Math.round(a.paidCents / 100)} paid</span>
              </div>
            ))}
          </Card>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Card title="Stale Orders (4h+ no driver)">
            {data.staleOrders.length === 0 ? <div style={{ color: "#4CAF50" }}>None</div> :
              data.staleOrders.map((o: any, i: number) => (
                <div key={i} style={{ fontSize: 13, color: "#ccc", marginBottom: 4 }}>
                  {(o.cities as any)?.name || "?"} - {o.yards_needed}yds - ${Math.round((o.driver_pay_cents || 0) / 100)}/load
                </div>
              ))}
          </Card>
          <Card title="Unpaid Customer Deliveries">
            {data.unpaidCustomers.length === 0 ? <div style={{ color: "#4CAF50" }}>None</div> :
              data.unpaidCustomers.map((c: any, i: number) => (
                <div key={i} style={{ fontSize: 13, color: "#ccc", marginBottom: 4 }}>
                  {c.customer_name || c.phone} - ${Math.round((c.total_price_cents || 0) / 100)}
                </div>
              ))}
          </Card>
        </div>
      </>}

      {tab === "drivers" && <>
        <Card title={`Active Driver Conversations (${data.activeConversations.drivers.length})`}>
          {data.activeConversations.drivers.length === 0 ? <div style={{ color: "#888" }}>No active driver conversations</div> :
            data.activeConversations.drivers.map((d: any, i: number) => (
              <ConvRow key={i} phone={d.phone} state={d.state} detail={d.extracted_city || ""} time={d.updated_at} />
            ))}
        </Card>
        {data.noShows.length > 0 && (
          <Card title="Driver No-Shows (OTW 3h+)" alert>
            {data.noShows.map((d: any, i: number) => (
              <div key={i} style={{ fontSize: 13, color: "#ff6666", marginBottom: 4 }}>{d.phone} - Order: {(d.active_order_id || "").slice(0, 8)}</div>
            ))}
          </Card>
        )}
        {data.stuckDrivers.length > 0 && (
          <Card title="Stuck Driver Conversations (2h+)" alert>
            {data.stuckDrivers.map((d: any, i: number) => (
              <ConvRow key={i} phone={d.phone} state={d.state} detail="" time={d.updated_at} />
            ))}
          </Card>
        )}
      </>}

      {tab === "customers" && <>
        {/* Agent pipeline header */}
        <AgentPipelineCard pipeline={data.agentPipeline || []} unassigned={data.unassignedLeads || 0} />

        {/* State legend */}
        <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
          {["COLLECTING", "QUOTING", "ORDER_PLACED", "AWAITING_PAYMENT", "FOLLOW_UP"].map(s => {
            const st = custState(s)
            const count = data.activeConversations.customers.filter((c: any) => c.state === s).length
            return (
              <div key={s} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: st.color }} />
                <span style={{ color: "#888" }}>{st.label}</span>
                <span style={{ color: st.color, fontWeight: 600 }}>{count}</span>
              </div>
            )
          })}
        </div>

        {/* Column headers */}
        <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 80px 60px 90px 50px", padding: "0 0 4px", fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: 1, borderBottom: "1px solid #333", marginBottom: 2, gap: 8 }}>
          <span>Agent</span>
          <span>Customer</span>
          <span style={{ textAlign: "right" }}>Order</span>
          <span style={{ textAlign: "right" }}>Quote</span>
          <span style={{ textAlign: "center" }}>Status</span>
          <span style={{ textAlign: "right" }}>Ago</span>
        </div>

        {data.activeConversations.customers.length === 0 ? (
          <div style={{ color: "#888", padding: 20, textAlign: "center" }}>No active customer conversations</div>
        ) : (
          data.activeConversations.customers.map((c: any, i: number) => (
            <CustomerRow
              key={i}
              conv={c}
              agentName={c.agent_id ? (agentNames[c.agent_id] || "").split(" ")[0] : ""}
              smsLog={data.recentCustSms || []}
              expanded={expandedPhone === c.phone}
              onToggle={() => setExpandedPhone(expandedPhone === c.phone ? null : c.phone)}
            />
          ))
        )}

        {data.stuckCustomers.length > 0 && (
          <Card title="Stuck Customer Conversations (2h+)" alert>
            {data.stuckCustomers.map((c: any, i: number) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13, borderBottom: "1px solid #222" }}>
                <span style={{ color: "#ff6666" }}>{c.customer_name || c.phone?.slice(-4)}</span>
                <span style={{ color: custState(c.state).color, fontWeight: 600, fontSize: 11 }}>{custState(c.state).label}</span>
              </div>
            ))}
          </Card>
        )}
      </>}

      {tab === "sms" && <>
        <Card title="Recent Driver SMS">
          {data.recentSms.slice(0, 20).map((m: any, i: number) => (
            <SmsRow key={i} phone={m.phone} body={m.body} direction={m.direction} time={m.created_at} />
          ))}
        </Card>
        <Card title="Recent Customer SMS">
          {data.recentCustSms.slice(0, 20).map((m: any, i: number) => (
            <SmsRow key={i} phone={m.phone} body={m.body} direction={m.direction} time={m.created_at} />
          ))}
        </Card>
      </>}

      <div style={{ textAlign: "center", color: "#333", fontSize: 11, marginTop: 20 }}>
        {tab === "customers" ? "Auto-refreshes every 10s" : "Auto-refreshes every 30s"} | Last updated: {new Date(data.timestamp).toLocaleTimeString()}
      </div>
    </div>
  )
}
