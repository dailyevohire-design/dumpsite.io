import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { requireAdmin } from '@/lib/admin-auth'
import { rateLimit } from '@/lib/rate-limit'

export async function GET(req: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const rl = await rateLimit(`admin-loads:${auth.user.id}`, 60, '1 m')
  if (!rl.allowed) return rl.response!

  const supabase = createAdminSupabase()
  const { searchParams } = new URL(req.url)
  const ALLOWED_STATUSES = ['pending', 'approved', 'rejected', 'completed', 'flagged']
  const rawStatus = searchParams.get('status') || 'pending'
  const status = ALLOWED_STATUSES.includes(rawStatus) ? rawStatus : 'pending'
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
  const limit = 20
  const offset = (page - 1) * limit

  // "flagged" is a virtual tab — shows completed loads with fraud flags
  let query = supabase
    .from('load_requests')
    .select(`
      id, status, dirt_type, photo_url, truck_type, truck_count,
      yards_estimated, haul_date, requires_extra_review,
      submitted_at, rejected_reason, dispatch_order_id, driver_id,
      fraud_score, fraud_flags, flagged_for_review
    `, { count: 'exact' })

  if (status === 'flagged') {
    query = query.eq('flagged_for_review', true).order('submitted_at', { ascending: false })
  } else {
    query = query.eq('status', status).order('submitted_at', { ascending: true })
  }

  const { data: loads, count, error } = await query.range(offset, offset + limit - 1)

  if (error) {
    return NextResponse.json({ loads: [], total: 0, error: 'Failed to load' })
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
