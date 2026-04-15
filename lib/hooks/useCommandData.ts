"use client"

// Earth Command v4 — live data hooks.
// Every hook talks to Supabase directly using the browser client.
// Realtime subscribes + polls merge so the UI never goes stale.

import { useEffect, useRef, useState } from "react"
import { createBrowserSupabase } from "@/lib/supabase"

// ─────────────────────────────────────────────────────────────
// Constants (hardcoded per spec)
// ─────────────────────────────────────────────────────────────
export const CITY_COORDS: Record<string, { lat: number; lng: number }> = {
  "dallas": { lat: 32.7767, lng: -96.797 },
  "fort worth": { lat: 32.7555, lng: -97.3308 },
  "arlington": { lat: 32.7357, lng: -97.1081 },
  "plano": { lat: 33.0198, lng: -96.6989 },
  "irving": { lat: 32.814, lng: -96.9489 },
  "denton": { lat: 33.2148, lng: -97.1331 },
  "frisco": { lat: 33.1507, lng: -96.8236 },
  "mckinney": { lat: 33.1972, lng: -96.6397 },
  "garland": { lat: 32.9126, lng: -96.6389 },
  "mesquite": { lat: 32.7668, lng: -96.5992 },
  "mansfield": { lat: 32.5632, lng: -97.1417 },
  "grand prairie": { lat: 32.7459, lng: -97.0077 },
  "southlake": { lat: 32.9401, lng: -97.1336 },
  "rockwall": { lat: 32.9293, lng: -96.4597 },
  "lewisville": { lat: 33.0462, lng: -96.9942 },
  "carrollton": { lat: 32.9537, lng: -96.8903 },
  "denver": { lat: 39.7392, lng: -104.9903 },
}

export const ESCALATION: Record<string, number> = {
  quoted: 120,
  payment_pending: 180,
  dispatched: 60,
  loading: 45,
  in_transit: 90,
  arriving: 15,
  delivered: 120,
}

export const STATUS_PROGRESS: Record<string, number> = {
  quoted: 10,
  payment_pending: 15,
  scheduled: 20,
  dispatched: 30,
  loading: 45,
  in_transit: 65,
  arriving: 85,
  delivered: 95,
  verified: 98,
  complete: 100,
}

// Bridge dispatch_orders.status (dispatching/active/completed/cancelled)
// into Earth Command lifecycle keys that ESCALATION and STATUS_PROGRESS know.
function mapDbStatus(raw: string | null | undefined): string {
  if (!raw) return "quoted"
  switch (raw) {
    case "dispatching": return "dispatched"
    case "active":      return "in_transit"
    case "completed":   return "complete"
    case "cancelled":   return "cancelled"
    default:            return raw
  }
}

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
export interface Order {
  id: string
  status: string
  customer_name: string | null
  customer_phone: string | null
  material_type: string | null
  yards: number | null
  city: string | null
  total_price: number | null
  driver_name: string | null
  driver_phone: string | null
  paid: boolean | null
  photo_verified: boolean | null
  customer_confirmed: boolean | null
  delivery_photo_url: string | null
  updated_at: string
  created_at: string
  time_in_state_minutes: number
  isEscalated: boolean
  isWarning: boolean
  progress: number
}

export interface Conversation {
  phone: string
  name: string | null
  state: string | null
  mode: string | null
  updatedAt: string
  city: string | null
  convType: "driver" | "customer"
  quoteAmount?: number | null
}

export interface HeatZone {
  city: string
  lat: number
  lng: number
  orderCount: number
  revenue: number
  driverDemand: number
  temp: "hot" | "warm" | "cool" | "cold"
}

export interface IQComponents {
  sarahCloseRate: number
  jesseAcceptRate: number
  confirmRate: number
  quoteSpeedScore: number
}

export interface IQTrendPoint {
  week: string
  iq: number
  sarah: number
  jesse: number
  confirm: number
  quote: number
}

// ─────────────────────────────────────────────────────────────
// Internal — DB row shapes (only the columns we use)
// ─────────────────────────────────────────────────────────────
type DispatchOrderRow = {
  id: string
  status: string | null
  client_name: string | null
  client_address: string | null
  source_number: string | null
  yards_needed: number | null
  truck_type_needed: string | null
  price_quoted_cents: number | null
  city_id: string | null
  cities?: { name: string | null } | { name: string | null }[] | null
  photo_verified?: boolean | null
  customer_confirmed?: boolean | null
  delivery_photo_url?: string | null
  delivery_latitude?: number | null
  delivery_longitude?: number | null
  updated_at: string
  created_at: string
}

type ConversationRow = {
  phone: string
  state: string | null
  mode: string | null
  extracted_city: string | null
  updated_at: string
}

type CustomerConversationRow = {
  phone: string
  customer_name: string | null
  state: string | null
  mode: string | null
  delivery_city: string | null
  total_price_cents: number | null
  updated_at: string
}

// ─────────────────────────────────────────────────────────────
// mapOrderRow
// ─────────────────────────────────────────────────────────────
function cityNameFrom(row: DispatchOrderRow): string | null {
  const c = row.cities
  if (!c) return null
  if (Array.isArray(c)) return c[0]?.name ?? null
  return c.name ?? null
}

function toOrder(row: DispatchOrderRow): Order {
  const mapped = mapDbStatus(row.status)
  const updatedAt = row.updated_at || row.created_at || new Date().toISOString()
  const time_in_state_minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(updatedAt).getTime()) / 60000)
  )
  const threshold = ESCALATION[mapped]
  const isEscalated = typeof threshold === "number" && time_in_state_minutes > threshold
  const isWarning = typeof threshold === "number" && time_in_state_minutes > threshold * 0.7
  const progress = STATUS_PROGRESS[mapped] ?? 0

  return {
    id: row.id,
    status: mapped,
    customer_name: row.client_name ?? null,
    customer_phone: row.source_number ?? null,
    material_type: row.truck_type_needed ?? null,
    yards: row.yards_needed ?? null,
    city: cityNameFrom(row),
    total_price: row.price_quoted_cents != null ? row.price_quoted_cents / 100 : null,
    driver_name: null,
    driver_phone: null,
    paid: mapped === "complete" || mapped === "verified",
    photo_verified: row.photo_verified ?? null,
    customer_confirmed: row.customer_confirmed ?? null,
    delivery_photo_url: row.delivery_photo_url ?? null,
    updated_at: updatedAt,
    created_at: row.created_at,
    time_in_state_minutes,
    isEscalated,
    isWarning,
    progress,
  }
}

// ─────────────────────────────────────────────────────────────
// HOOK 1 — useOrders
// ─────────────────────────────────────────────────────────────
const ORDER_SELECT =
  "id, status, client_name, client_address, source_number, yards_needed, truck_type_needed, price_quoted_cents, " +
  "city_id, cities(name), photo_verified, customer_confirmed, delivery_photo_url, " +
  "delivery_latitude, delivery_longitude, updated_at, created_at"

export function useOrders(): { orders: Order[]; loading: boolean; error: string | null } {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const sb = createBrowserSupabase()
    let cancelled = false

    const fetchAll = async () => {
      const { data, error: err } = await sb
        .from("dispatch_orders")
        .select(ORDER_SELECT)
        .not("status", "in", "(cancelled,archived)")
        .order("updated_at", { ascending: false })

      if (cancelled) return
      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }
      const rows = (data ?? []) as unknown as DispatchOrderRow[]
      setOrders(rows.map(toOrder))
      setLoading(false)
    }

    fetchAll()

    const channel = sb
      .channel("earth_command_orders")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "dispatch_orders" },
        () => { fetchAll() }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "dispatch_orders" },
        () => { fetchAll() }
      )
      .subscribe()

    // Re-derive time_in_state every 30s without re-fetching
    const tick = setInterval(() => {
      if (cancelled) return
      setOrders((prev) =>
        prev.map((o) => {
          const t = Math.max(0, Math.floor((Date.now() - new Date(o.updated_at).getTime()) / 60000))
          const thr = ESCALATION[o.status]
          return {
            ...o,
            time_in_state_minutes: t,
            isEscalated: typeof thr === "number" && t > thr,
            isWarning: typeof thr === "number" && t > thr * 0.7,
          }
        })
      )
    }, 30_000)

    return () => {
      cancelled = true
      clearInterval(tick)
      sb.removeChannel(channel)
    }
  }, [])

  return { orders, loading, error }
}

// ─────────────────────────────────────────────────────────────
// HOOK 2 — useConversations
// ─────────────────────────────────────────────────────────────
export function useConversations(): { conversations: Conversation[]; loading: boolean } {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const sb = createBrowserSupabase()
    let cancelled = false

    const fetchAll = async () => {
      const [driversRes, customersRes] = await Promise.allSettled([
        sb.from("conversations")
          .select("phone, state, mode, extracted_city, updated_at")
          .order("updated_at", { ascending: false })
          .limit(100),
        sb.from("customer_conversations")
          .select("phone, customer_name, state, mode, delivery_city, total_price_cents, updated_at")
          .order("updated_at", { ascending: false })
          .limit(100),
      ])

      if (cancelled) return
      const driverRows: ConversationRow[] =
        driversRes.status === "fulfilled" && driversRes.value.data
          ? (driversRes.value.data as unknown as ConversationRow[])
          : []
      const custRows: CustomerConversationRow[] =
        customersRes.status === "fulfilled" && customersRes.value.data
          ? (customersRes.value.data as unknown as CustomerConversationRow[])
          : []

      const driverConvs: Conversation[] = driverRows.map((r) => ({
        phone: r.phone,
        name: null,
        state: r.state,
        mode: r.mode,
        updatedAt: r.updated_at,
        city: r.extracted_city,
        convType: "driver" as const,
      }))
      const custConvs: Conversation[] = custRows.map((r) => ({
        phone: r.phone,
        name: r.customer_name,
        state: r.state,
        mode: r.mode,
        updatedAt: r.updated_at,
        city: r.delivery_city,
        convType: "customer" as const,
        quoteAmount: r.total_price_cents != null ? r.total_price_cents / 100 : null,
      }))

      const combined = [...driverConvs, ...custConvs].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )
      setConversations(combined)
      setLoading(false)
    }

    fetchAll()

    const chDriver = sb
      .channel("earth_command_conv_driver")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => fetchAll())
      .subscribe()
    const chCust = sb
      .channel("earth_command_conv_cust")
      .on("postgres_changes", { event: "*", schema: "public", table: "customer_conversations" }, () => fetchAll())
      .subscribe()

    return () => {
      cancelled = true
      sb.removeChannel(chDriver)
      sb.removeChannel(chCust)
    }
  }, [])

  return { conversations, loading }
}

// ─────────────────────────────────────────────────────────────
// HOOK 3 — useHeatData
// ─────────────────────────────────────────────────────────────
type CityAgg = {
  city: string
  orderCount: number
  revenue: number
  driverDemand: number
}

function normalizeCity(raw: string | null | undefined): string | null {
  if (!raw) return null
  const k = raw.trim().toLowerCase()
  return k || null
}

function tempFor(orderCount: number): HeatZone["temp"] {
  if (orderCount > 20) return "hot"
  if (orderCount >= 10) return "warm"
  if (orderCount >= 3) return "cool"
  return "cold"
}

export function useHeatData(): { zones: HeatZone[]; loading: boolean } {
  const [zones, setZones] = useState<HeatZone[]>([])
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    const sb = createBrowserSupabase()

    const fetchAll = async () => {
      // orders by city (via cities relation)
      const ordersRes = await sb
        .from("dispatch_orders")
        .select("price_quoted_cents, cities(name)")
        .not("status", "in", "(cancelled,archived)")
        .limit(5000)

      // driver demand: conversations in active dispatching states by extracted_city
      const driverRes = await sb
        .from("conversations")
        .select("extracted_city")
        .in("state", ["JOB_PRESENTED", "PHOTO_PENDING", "ACTIVE", "OTW_PENDING"])
        .not("extracted_city", "is", null)
        .limit(5000)

      if (!mountedRef.current) return

      const byCity = new Map<string, CityAgg>()
      const ensure = (city: string): CityAgg => {
        const existing = byCity.get(city)
        if (existing) return existing
        const created: CityAgg = { city, orderCount: 0, revenue: 0, driverDemand: 0 }
        byCity.set(city, created)
        return created
      }

      if (ordersRes.data) {
        const rows = ordersRes.data as unknown as Array<{
          price_quoted_cents: number | null
          cities: { name: string | null } | { name: string | null }[] | null
        }>
        for (const r of rows) {
          let rawName: string | null = null
          if (Array.isArray(r.cities)) rawName = r.cities[0]?.name ?? null
          else if (r.cities) rawName = r.cities.name ?? null
          const c = normalizeCity(rawName)
          if (!c) continue
          const agg = ensure(c)
          agg.orderCount += 1
          agg.revenue += (r.price_quoted_cents ?? 0) / 100
        }
      }

      if (driverRes.data) {
        const rows = driverRes.data as unknown as Array<{ extracted_city: string | null }>
        for (const r of rows) {
          const c = normalizeCity(r.extracted_city)
          if (!c) continue
          const agg = ensure(c)
          agg.driverDemand += 1
        }
      }

      const out: HeatZone[] = []
      for (const [, agg] of byCity) {
        const coords = CITY_COORDS[agg.city]
        if (!coords) continue
        out.push({
          city: agg.city,
          lat: coords.lat,
          lng: coords.lng,
          orderCount: agg.orderCount,
          revenue: agg.revenue,
          driverDemand: agg.driverDemand,
          temp: tempFor(agg.orderCount),
        })
      }
      out.sort((a, b) => b.orderCount - a.orderCount)

      if (mountedRef.current) {
        setZones(out)
        setLoading(false)
      }
    }

    fetchAll()
    const iv = setInterval(fetchAll, 60_000)

    return () => {
      mountedRef.current = false
      clearInterval(iv)
    }
  }, [])

  return { zones, loading }
}

// ─────────────────────────────────────────────────────────────
// HOOK 4 — usePlatformIQ
// ─────────────────────────────────────────────────────────────
type IQSnapshotRow = {
  iq_score: number | null
  sarah_close_rate: number | null
  jesse_accept_rate: number | null
  quote_speed_score: number | null
  confirm_rate: number | null
  snapshot_week: string | null
  created_at: string
}

export function usePlatformIQ(): {
  iqScore: number
  components: IQComponents
  trendData: IQTrendPoint[]
  loading: boolean
} {
  const [iqScore, setIqScore] = useState(0)
  const [components, setComponents] = useState<IQComponents>({
    sarahCloseRate: 0,
    jesseAcceptRate: 0,
    confirmRate: 0,
    quoteSpeedScore: 75,
  })
  const [trendData, setTrendData] = useState<IQTrendPoint[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const sb = createBrowserSupabase()
    let cancelled = false

    const fetchAll = async () => {
      const [
        sarahCompleted,
        sarahTotal,
        jesseClosed,
        jesseTotal,
        deliveredTotal,
        deliveredConfirmed,
        snapshotsRes,
      ] = await Promise.allSettled([
        sb.from("customer_conversations").select("phone", { head: true, count: "exact" }).eq("state", "COMPLETED"),
        sb.from("customer_conversations").select("phone", { head: true, count: "exact" }).neq("state", "COLLECTING_NAME"),
        sb.from("conversations").select("phone", { head: true, count: "exact" }).in("state", ["ACTIVE", "OTW_PENDING", "PAYMENT_METHOD_PENDING", "CLOSED"]),
        sb.from("conversations").select("phone", { head: true, count: "exact" }),
        sb.from("dispatch_orders").select("id", { head: true, count: "exact" }).eq("status", "completed"),
        sb.from("dispatch_orders").select("id", { head: true, count: "exact" }).eq("customer_confirmed", true),
        sb.from("platform_iq_snapshots").select("*").order("created_at", { ascending: true }).limit(12),
      ])

      if (cancelled) return

      const countFrom = (r: PromiseSettledResult<{ count: number | null }>): number =>
        r.status === "fulfilled" && typeof r.value.count === "number" ? r.value.count : 0

      const sarahComp = countFrom(sarahCompleted)
      const sarahAll = countFrom(sarahTotal)
      const jesseAcc = countFrom(jesseClosed)
      const jesseAll = countFrom(jesseTotal)
      const delAll = countFrom(deliveredTotal)
      const delConf = countFrom(deliveredConfirmed)

      const sarahRate = sarahAll > 0 ? sarahComp / sarahAll : 0
      const jesseRate = jesseAll > 0 ? jesseAcc / jesseAll : 0
      const confRate = delAll > 0 ? delConf / delAll : 0
      const quoteSpeed = 75

      const iq = Math.round(
        sarahRate * 100 * 0.3 +
        jesseRate * 100 * 0.3 +
        confRate * 100 * 0.25 +
        quoteSpeed * 0.15
      )

      setComponents({
        sarahCloseRate: sarahRate,
        jesseAcceptRate: jesseRate,
        confirmRate: confRate,
        quoteSpeedScore: quoteSpeed,
      })
      setIqScore(iq)

      // Trend
      const snapshots: IQSnapshotRow[] =
        snapshotsRes.status === "fulfilled" && snapshotsRes.value.data
          ? (snapshotsRes.value.data as unknown as IQSnapshotRow[])
          : []

      let trend: IQTrendPoint[]
      if (snapshots.length >= 2) {
        trend = snapshots.map((s, i) => ({
          week: s.snapshot_week || `W${i + 1}`,
          iq: s.iq_score ?? 0,
          sarah: Math.round((s.sarah_close_rate ?? 0) * 100),
          jesse: Math.round((s.jesse_accept_rate ?? 0) * 100),
          confirm: Math.round((s.confirm_rate ?? 0) * 100),
          quote: Math.round(s.quote_speed_score ?? 75),
        }))
      } else {
        // Synthetic 8-week ramp into current iq
        const cur = iq || 60
        const start = Math.max(40, cur - 20)
        trend = Array.from({ length: 8 }).map((_, i) => {
          const t = i / 7
          const w = Math.round(start + (cur - start) * t)
          return {
            week: `W${i + 1}`,
            iq: w,
            sarah: Math.round(sarahRate * 100 * (0.6 + 0.4 * t)),
            jesse: Math.round(jesseRate * 100 * (0.6 + 0.4 * t)),
            confirm: Math.round(confRate * 100 * (0.6 + 0.4 * t)),
            quote: Math.round(quoteSpeed * (0.8 + 0.2 * t)),
          }
        })
      }

      setTrendData(trend)
      setLoading(false)
    }

    fetchAll()
    const iv = setInterval(fetchAll, 60_000)

    return () => {
      cancelled = true
      clearInterval(iv)
    }
  }, [])

  return { iqScore, components, trendData, loading }
}
