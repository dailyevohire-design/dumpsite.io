import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { createServerSupabase } from '@/lib/supabase.server'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const role = user.user_metadata?.role
  if (role === 'admin' || role === 'superadmin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminSupabase()

  const { data, error } = await admin
    .from('dispatch_orders')
    .select('id, city_id, yards_needed, driver_pay_cents, urgency, created_at, cities(name)')
    .eq('status', 'dispatching')
    .order('driver_pay_cents', { ascending: false })
    .limit(50)

  if (error) {
    return NextResponse.json({ error: 'Failed to load jobs' }, { status: 500 })
  }

  return NextResponse.json({ jobs: data || [] })
}
