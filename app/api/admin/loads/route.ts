import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const supabase = createAdminSupabase()
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') || 'pending'
  const page = parseInt(searchParams.get('page') || '1')
  const limit = 20
  const offset = (page - 1) * limit

  const { data: loads, count } = await supabase
    .from('load_requests')
    .select(`
      id, status, dirt_type, photo_url, truck_type, truck_count,
      yards_estimated, haul_date, requires_extra_review, auto_approved,
      submitted_at, rejected_reason,
      dump_sites(name, pay_rate_cents, cities(name)),
      driver_profiles!load_requests_driver_id_fkey(
        first_name, last_name, company_name, phone, gps_score, rating,
        tiers(name, slug)
      )
    `, { count: 'exact' })
    .eq('status', status)
    .order('requires_extra_review', { ascending: false })
    .order('submitted_at', { ascending: true })
    .range(offset, offset + limit - 1)

  return NextResponse.json({ loads, total: count, page, limit })
}
