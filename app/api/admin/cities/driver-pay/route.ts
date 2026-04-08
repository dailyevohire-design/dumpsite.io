import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { requireAdmin } from '@/lib/admin-auth'

/**
 * GET /api/admin/cities/driver-pay
 *
 * Returns every city with its current driver pay rate, dispatch volume,
 * and average customer quote — sorted by dispatch count desc so the most
 * active markets appear first.
 */
export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  try {
    const supabase = createAdminSupabase()

    const { data: cities, error: citiesErr } = await supabase
      .from('cities')
      .select('id, name, default_driver_pay_cents')
      .order('name')

    if (citiesErr) {
      console.error('[admin/cities/driver-pay] cities query failed:', citiesErr.message)
      return NextResponse.json(
        { success: false, error: 'Failed to load cities' },
        { status: 500 }
      )
    }

    const { data: dispatches, error: dispatchErr } = await supabase
      .from('dispatch_orders')
      .select('city_id, price_quoted_cents')

    if (dispatchErr) {
      console.error('[admin/cities/driver-pay] dispatch query failed:', dispatchErr.message)
      return NextResponse.json(
        { success: false, error: 'Failed to load dispatch volume' },
        { status: 500 }
      )
    }

    // Aggregate dispatch stats per city
    const stats = new Map<string, { count: number; totalQuoteCents: number }>()
    for (const d of dispatches || []) {
      if (!d.city_id) continue
      const cur = stats.get(d.city_id) || { count: 0, totalQuoteCents: 0 }
      cur.count += 1
      cur.totalQuoteCents += d.price_quoted_cents || 0
      stats.set(d.city_id, cur)
    }

    const enriched = (cities || []).map(c => {
      const s = stats.get(c.id) || { count: 0, totalQuoteCents: 0 }
      const avgQuoteCents = s.count > 0 ? Math.round(s.totalQuoteCents / s.count) : 0
      return {
        id: c.id,
        name: c.name,
        driverPayCents: c.default_driver_pay_cents ?? 4000,
        dispatchCount: s.count,
        avgQuoteCents,
      }
    })

    // Sort by dispatch volume desc, then alphabetically
    enriched.sort((a, b) => {
      if (b.dispatchCount !== a.dispatchCount) return b.dispatchCount - a.dispatchCount
      return a.name.localeCompare(b.name)
    })

    return NextResponse.json({ success: true, data: enriched })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    console.error('[admin/cities/driver-pay] crash:', msg)
    return NextResponse.json(
      { success: false, error: 'Server error' },
      { status: 500 }
    )
  }
}
