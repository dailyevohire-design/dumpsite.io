import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { requireAdmin } from '@/lib/admin-auth'
import { getDriverPayCents } from '@/lib/driver-pay-rates'

export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const supabase = createAdminSupabase()

  // Try with driver pay column; fall back if it doesn't exist yet
  let cities: { id: string; name: string; default_driver_pay_cents?: number }[] = []
  const { data, error } = await supabase
    .from('cities')
    .select('id, name, default_driver_pay_cents')
    .order('name')

  if (error?.message?.includes('default_driver_pay_cents')) {
    const { data: basic, error: basicErr } = await supabase
      .from('cities')
      .select('id, name')
      .order('name')
    if (basicErr) {
      console.error('[admin/cities] query error:', basicErr.message)
      return NextResponse.json({ success: false, error: 'Failed to load cities' }, { status: 500 })
    }
    cities = (basic || []).map(c => ({ ...c, default_driver_pay_cents: undefined }))
  } else if (error) {
    console.error('[admin/cities] query error:', error.message)
    return NextResponse.json({ success: false, error: 'Failed to load cities' }, { status: 500 })
  } else {
    cities = data || []
  }

  // Attach the effective driver pay rate for each city
  const citiesWithRates = cities.map(c => ({
    id: c.id,
    name: c.name,
    driverPayCents: getDriverPayCents(c.name, c.default_driver_pay_cents),
  }))

  return NextResponse.json({ success: true, data: citiesWithRates })
}
