"use client"
import { useState, useEffect } from "react"

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
  staleOrders: any[]; unpaidCustomers: any[]; stuckDrivers: any[]; stuckCustomers: any[]; noShows: any[]
  recentSms: any[]; recentCustSms: any[]
  driverCount: number
}

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

export default function CommandCenter() {
  const [data, setData] = useState<CommandData | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<"overview" | "drivers" | "customers" | "sms">("overview")

  const refresh = async () => {
    try {
      const r = await fetch("/api/command-center")
      setData(await r.json())
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { refresh(); const i = setInterval(refresh, 30000); return () => clearInterval(i) }, [])

  if (loading || !data) return <div style={{ padding: 40, color: "#888" }}>Loading command center...</div>

  const a = data.alerts
  const totalAlerts = a.staleOrders + a.unpaidCustomers + a.stuckDriverConvs + a.stuckCustomerConvs + a.driverNoShows

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "20px 16px", fontFamily: "-apple-system, sans-serif", color: "#fff", background: "#0a0a0a", minHeight: "100vh" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>Command Center</h1>
        <div style={{ display: "flex", gap: 8 }}>
          {(["overview", "drivers", "customers", "sms"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ padding: "6px 14px", background: tab === t ? "#fff" : "#222", color: tab === t ? "#000" : "#888", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>{t}</button>
          ))}
          <button onClick={refresh} style={{ padding: "6px 14px", background: "#222", color: "#888", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>Refresh</button>
        </div>
      </div>

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
        <Card title={`Active Customer Conversations (${data.activeConversations.customers.length})`}>
          {data.activeConversations.customers.length === 0 ? <div style={{ color: "#888" }}>No active customer conversations</div> :
            data.activeConversations.customers.map((c: any, i: number) => (
              <ConvRow key={i} phone={c.phone} state={c.state} detail={`${c.customer_name || ""} ${c.delivery_city || ""} ${c.yards_needed ? c.yards_needed + "yds" : ""}`} time={c.updated_at} />
            ))}
        </Card>
        {data.stuckCustomers.length > 0 && (
          <Card title="Stuck Customer Conversations (2h+)" alert>
            {data.stuckCustomers.map((c: any, i: number) => (
              <ConvRow key={i} phone={c.phone} state={c.state} detail={c.customer_name || ""} time={c.updated_at} />
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
        Auto-refreshes every 30s | Last updated: {new Date(data.timestamp).toLocaleTimeString()}
      </div>
    </div>
  )
}
