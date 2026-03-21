import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { createServerSupabase } from '@/lib/supabase.server'

export async function GET() {
  // Auth check — if it fails, still return jobs (safe public data)
  // but block admin users from using this driver endpoint
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const role = user.user_metadata?.role
      if (role === 'admin' || role === 'superadmin') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }
  } catch {
    // Auth check failed — proceed anyway, data is safe
  }

  const admin = createAdminSupabase()

  const { data, error } = await admin
    .from('dispatch_orders')
    .select('id, city_id, yards_needed, driver_pay_cents, urgency, created_at, cities(name)')
    .eq('status', 'dispatching')
    .order('driver_pay_cents', { ascending: false })
    .limit(50)

  if (error) {
    console.error('Jobs fetch error:', error)
    return NextResponse.json({ error: 'Failed to load jobs' }, { status: 500 })
  }

  return NextResponse.json({ jobs: data || [] })
}
