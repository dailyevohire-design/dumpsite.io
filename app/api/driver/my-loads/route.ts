import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { createServerSupabase } from '@/lib/supabase.server'
import { rateLimit } from '@/lib/rate-limit'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rl = await rateLimit(`my-loads:${user.id}`, 30, '1 m')
  if (!rl.allowed) return rl.response!

  const admin = createAdminSupabase()

  // Fetch driver's load_requests
  const { data: loads, error } = await admin
    .from('load_requests')
    .select('id, status, dirt_type, photo_url, truck_type, truck_count, yards_estimated, haul_date, submitted_at, rejected_reason, payout_cents, completion_photo_url, dispatch_order_id')
    .eq('driver_id', user.id)
    .order('submitted_at', { ascending: false })
    .limit(20)

  if (error) {
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 })
  }

  if (!loads || loads.length === 0) {
    return NextResponse.json({ loads: [] })
  }

  // Enrich with safe dispatch_order fields (no client_address, no customer phone)
  const dispatchIds = [...new Set(loads.map(l => l.dispatch_order_id).filter(Boolean))]

  const ordersMap: Record<string, any> = {}
  if (dispatchIds.length > 0) {
    const { data: orders } = await admin
      .from('dispatch_orders')
      .select('id, yards_needed, driver_pay_cents, cities(name)')
      .in('id', dispatchIds)

    for (const o of (orders || [])) {
      ordersMap[o.id] = o
    }
  }

  const enriched = loads.map(load => ({
    ...load,
    dispatch_orders: load.dispatch_order_id ? ordersMap[load.dispatch_order_id] || null : null,
  }))

  return NextResponse.json({ loads: enriched })
}
