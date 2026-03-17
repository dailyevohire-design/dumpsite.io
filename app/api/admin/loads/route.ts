import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const supabase = createAdminSupabase()
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') || 'pending'
  const page = parseInt(searchParams.get('page') || '1')
  const limit = 20
  const offset = (page - 1) * limit

  const { data: loads, count, error } = await supabase
    .from('load_requests')
    .select(`
      id, status, dirt_type, photo_url, truck_type, truck_count,
      yards_estimated, haul_date, requires_extra_review,
      submitted_at, rejected_reason, dispatch_order_id, driver_id
    `, { count: 'exact' })
    .eq('status', status)
    .order('submitted_at', { ascending: true })
    .range(offset, offset + limit - 1)

  if (error) {
    console.error('Admin loads error:', error)
    return NextResponse.json({ loads: [], total: 0, error: error.message })
  }

  if (!loads || loads.length === 0) {
    return NextResponse.json({ loads: [], total: 0, page, limit })
  }

  const driverIds = [...new Set(loads.map((l: any) => l.driver_id).filter(Boolean))]
  const dispatchIds = [...new Set(loads.map((l: any) => l.dispatch_order_id).filter(Boolean))]

  const [driversRes, ordersRes] = await Promise.all([
    driverIds.length > 0
      ? supabase.from('driver_profiles').select('user_id, first_name, last_name, company_name, phone, gps_score, rating, tier_id, tiers(name, slug)').in('user_id', driverIds)
      : { data: [] },
    dispatchIds.length > 0
      ? supabase.from('dispatch_orders').select('id, client_name, client_address, yards_needed, price_quoted_cents, driver_pay_cents, city_id, cities(name)').in('id', dispatchIds)
      : { data: [] }
  ])

  const driversMap: any = {}
  const ordersMap: any = {}

  ;(driversRes.data || []).forEach((d: any) => { driversMap[d.user_id] = d })
  ;(ordersRes.data || []).forEach((o: any) => { ordersMap[o.id] = o })

  const enriched = loads.map((load: any) => ({
    ...load,
    driver_profiles: driversMap[load.driver_id] || null,
    dispatch_orders: load.dispatch_order_id ? ordersMap[load.dispatch_order_id] || null : null
  }))

  return NextResponse.json({ loads: enriched, total: count || 0, page, limit })
}
