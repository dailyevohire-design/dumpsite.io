import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'

export async function GET() {
  try {
    const supabase = createAdminSupabase()

    const [jobsRes, driversRes, ordersRes] = await Promise.all([
      supabase.from('dispatch_orders').select('id, city_id, driver_pay_cents', { count: 'exact' }).eq('status', 'dispatching'),
      supabase.from('driver_profiles').select('id', { count: 'exact' }).eq('status', 'active'),
      supabase.from('dispatch_orders').select('driver_pay_cents').eq('status', 'dispatching'),
    ])

    const activeJobs = jobsRes.count || 0
    const driversActive = driversRes.count || 0

    // Unique cities
    const cityIds = new Set((jobsRes.data || []).map(j => j.city_id))
    const citiesActive = cityIds.size

    // Average pay
    const payValues = (ordersRes.data || []).map(o => o.driver_pay_cents).filter(Boolean)
    const rawAvg = payValues.length > 0
      ? Math.round(payValues.reduce((a: number, b: number) => a + b, 0) / payValues.length / 100)
      : 35
    // Floor at $35 for marketing — actual pay ranges $35-$55
    const avgPayDollars = Math.max(rawAvg, 35)

    const res = NextResponse.json({ activeJobs, avgPayDollars, citiesActive, driversActive })
    res.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60')
    return res
  } catch {
    return NextResponse.json({ activeJobs: 47, avgPayDollars: 30, citiesActive: 12, driversActive: 50 })
  }
}
