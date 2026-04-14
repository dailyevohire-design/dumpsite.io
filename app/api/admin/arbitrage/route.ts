import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin-auth"
import { createAdminSupabase } from "@/lib/supabase"

interface ArbitrageRow {
  id: string
  phone: string
  customer_name: string | null
  delivery_address: string | null
  original_agent_id: string | null
  original_agent_name: string | null
  shopping_agent_id: string | null
  shopping_agent_name: string | null
  original_total_cents: number | null
  applied_total_cents: number | null
  surcharge_pct: number | null
  shop_attempt_number: number | null
  detected_at: string
}

interface PriceHistoryRow {
  phone: string
  agent_id: string
  delivery_address: string | null
  total_price_cents: number | null
  yards_needed: number | null
  material_type: string | null
  quoted_at: string
}

export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const sb = createAdminSupabase()

  // Recent arbitrage hits (last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const [{ data: hits }, { data: allHits }, { data: priceRows }] = await Promise.all([
    sb.from("customer_arbitrage_log")
      .select("*")
      .gte("detected_at", thirtyDaysAgo)
      .order("detected_at", { ascending: false })
      .limit(200) as any,
    sb.from("customer_arbitrage_log")
      .select("phone, original_total_cents, applied_total_cents, surcharge_pct, detected_at")
      .gte("detected_at", thirtyDaysAgo) as any,
    sb.from("customer_price_history")
      .select("phone, agent_id, delivery_address, total_price_cents, yards_needed, material_type, quoted_at")
      .gte("quoted_at", thirtyDaysAgo)
      .order("quoted_at", { ascending: false })
      .limit(500) as any,
  ])

  // Aggregate stats
  const typedHits = (allHits as ArbitrageRow[]) || []
  const totalExtra = typedHits.reduce((s, h) => s + ((h.applied_total_cents || 0) - (h.original_total_cents || 0)), 0)
  const uniqueShoppers = new Set(typedHits.map(h => h.phone)).size
  const avgSurcharge = typedHits.length > 0
    ? typedHits.reduce((s, h) => s + (Number(h.surcharge_pct) || 0), 0) / typedHits.length
    : 0

  // Per-customer shop journey — group price_history by phone
  const byPhone: Record<string, PriceHistoryRow[]> = {}
  for (const row of (priceRows as PriceHistoryRow[]) || []) {
    if (!byPhone[row.phone]) byPhone[row.phone] = []
    byPhone[row.phone].push(row)
  }
  // Only keep phones that quoted across 2+ distinct agents (the ones worth surfacing)
  const shopJourneys = Object.entries(byPhone)
    .map(([phone, rows]) => {
      const uniqueAgents = new Set(rows.map(r => r.agent_id))
      return { phone, agentCount: uniqueAgents.size, rows }
    })
    .filter(j => j.agentCount >= 2)
    .sort((a, b) => b.agentCount - a.agentCount)
    .slice(0, 50)

  return NextResponse.json({
    success: true,
    stats: {
      totalHits: typedHits.length,
      uniqueShoppers,
      totalExtraCents: totalExtra,
      avgSurchargePct: avgSurcharge,
      windowDays: 30,
    },
    hits: hits || [],
    shopJourneys,
  })
}
