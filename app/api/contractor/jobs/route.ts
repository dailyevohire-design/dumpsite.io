import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { createServerSupabase } from '@/lib/supabase.server'
import { rateLimit } from '@/lib/rate-limit'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimit(`contractor-jobs:${user.id}`, 30, '1 m')
  if (!rl.allowed) return rl.response!

  const admin = createAdminSupabase()
  const { data: orders } = await admin
    .from('dispatch_orders')
    .select('id, status, yards_needed, price_quoted_cents, urgency, created_at, cities(name)')
    .eq('created_by', user.id)
    .order('created_at', { ascending: false })
    .limit(50)

  // Get load counts per order
  const orderIds = (orders || []).map(o => o.id)
  let loadCounts: Record<string, { pending: number; approved: number; completed: number }> = {}
  if (orderIds.length > 0) {
    const { data: loads } = await admin
      .from('load_requests')
      .select('dispatch_order_id, status')
      .in('dispatch_order_id', orderIds)
    for (const l of (loads || [])) {
      if (!loadCounts[l.dispatch_order_id]) loadCounts[l.dispatch_order_id] = { pending: 0, approved: 0, completed: 0 }
      if (l.status === 'pending') loadCounts[l.dispatch_order_id].pending++
      else if (l.status === 'approved') loadCounts[l.dispatch_order_id].approved++
      else if (l.status === 'completed') loadCounts[l.dispatch_order_id].completed++
    }
  }

  const enriched = (orders || []).map(o => ({
    ...o,
    loads: loadCounts[o.id] || { pending: 0, approved: 0, completed: 0 },
  }))

  return NextResponse.json({ jobs: enriched })
}
