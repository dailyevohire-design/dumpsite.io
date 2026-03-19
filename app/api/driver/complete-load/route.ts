import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase, createAdminSupabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { loadId, completionPhotoUrl, loadsDelivered } = body
  if (!loadId || !completionPhotoUrl || !loadsDelivered) return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })

  const numLoads = parseInt(loadsDelivered)
  if (isNaN(numLoads) || numLoads < 1 || numLoads > 200) return NextResponse.json({ error: 'Loads delivered must be between 1 and 200' }, { status: 400 })

  const admin = createAdminSupabase()

  const { data: load, error: loadError } = await admin.from('load_requests').select('id, driver_id, status, dispatch_order_id').eq('id', loadId).single()
  if (loadError || !load) return NextResponse.json({ error: 'Load not found' }, { status: 404 })
  if (load.driver_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (load.status !== 'approved') return NextResponse.json({ error: 'Load is not approved' }, { status: 409 })

  let payPerLoadCents = 2000
  if (load.dispatch_order_id) {
    const { data: order } = await admin.from('dispatch_orders').select('driver_pay_cents').eq('id', load.dispatch_order_id).single()
    if (order?.driver_pay_cents) payPerLoadCents = order.driver_pay_cents
  }

  const payoutCents = payPerLoadCents * numLoads

  const { error: updateError } = await admin.from('load_requests').update({
    status: 'completed',
    completion_photo_url: completionPhotoUrl,
    truck_count: numLoads,
    payout_cents: payoutCents,
    completed_at: new Date().toISOString(),
  }).eq('id', loadId).eq('driver_id', user.id).eq('status', 'approved')

  if (updateError) return NextResponse.json({ error: 'Failed to mark complete' }, { status: 500 })

  return NextResponse.json({
    success: true,
    loadsDelivered: numLoads,
    totalPayDollars: Math.round(payoutCents / 100),
    message: `Job complete! ${numLoads} load${numLoads > 1 ? 's' : ''} delivered — total pay: $${Math.round(payoutCents / 100)}.`
  })
}
