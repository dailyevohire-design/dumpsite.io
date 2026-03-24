import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { createAdminSupabase } from '@/lib/supabase'

export async function POST() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const admin = createAdminSupabase()
  const { data, error } = await admin
    .from('dispatch_orders')
    .update({ truck_type_needed: 'end_dump' })
    .gte('yards_needed', 100)
    .eq('status', 'dispatching')
    .or('truck_type_needed.is.null,truck_type_needed.eq.tandem_axle')
    .select('id')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    updated: data?.length || 0,
    message: `Updated ${data?.length || 0} orders to end_dump`
  })
}
