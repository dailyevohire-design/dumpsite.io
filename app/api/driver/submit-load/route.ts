import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase, createAdminSupabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = user.user_metadata?.role
  if (role === 'admin' || role === 'superadmin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { dirtType, photoUrl, locationText, truckType, truckCount, yardsEstimated, haulDate, idempotencyKey, dispatchOrderId } = body

  if (!dirtType || !photoUrl || !locationText || !truckType || !truckCount || !yardsEstimated || !haulDate || !idempotencyKey || !dispatchOrderId) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // ✅ Server-side numeric validation — no NaN in DB
  const truckCountNum = parseInt(truckCount)
  const yardsNum = parseInt(yardsEstimated)
  if (isNaN(truckCountNum) || truckCountNum < 1 || truckCountNum > 50) {
    return NextResponse.json({ error: 'Truck count must be between 1 and 50' }, { status: 400 })
  }
  if (isNaN(yardsNum) || yardsNum < 1) {
    return NextResponse.json({ error: 'Yards must be a positive number' }, { status: 400 })
  }

  // ✅ Server-side haul date validation — no past dates
  const today = new Date().toISOString().split('T')[0]
  if (haulDate < today) {
    return NextResponse.json({ error: 'Haul date cannot be in the past' }, { status: 400 })
  }

  const admin = createAdminSupabase()

  const { data: profile } = await admin.from('driver_profiles').select('trial_loads_used, tiers(slug, trial_load_limit)').eq('user_id', user.id).single()
  if (!profile) return NextResponse.json({ error: 'Driver profile not found' }, { status: 404 })

  const tier = profile.tiers as any
  if (tier?.slug === 'trial' && tier?.trial_load_limit && profile.trial_loads_used >= tier.trial_load_limit) {
    return NextResponse.json({ success: false, code: 'TRIAL_LIMIT_REACHED', message: 'You have used all your free trial loads.' }, { status: 403 })
  }

  const { count: pendingCount } = await admin.from('load_requests').select('id', { count: 'exact', head: true }).eq('driver_id', user.id).eq('status', 'pending')
  if ((pendingCount || 0) >= 5) {
    return NextResponse.json({ success: false, code: 'TOO_MANY_PENDING', message: 'You have 5 pending requests. Wait for approval before submitting more.' }, { status: 429 })
  }

  const HIGH_REJECTION_MATERIALS = ['caliche']
  const requiresExtraReview = HIGH_REJECTION_MATERIALS.includes(dirtType)

  const { data: loadReq, error } = await admin.from('load_requests').upsert({
    idempotency_key: idempotencyKey,
    driver_id: user.id,
    dispatch_order_id: dispatchOrderId,
    dirt_type: dirtType,
    photo_url: photoUrl,
    location_text: String(locationText).slice(0, 500),
    truck_type: truckType,
    truck_count: truckCountNum,
    yards_estimated: yardsNum,
    haul_date: haulDate,
    status: 'pending',
    requires_extra_review: requiresExtraReview,
  }, { onConflict: 'idempotency_key' }).select().single()

  if (error) return NextResponse.json({ success: false, message: 'Failed to submit. Please try again.' }, { status: 500 })

  if (tier?.slug === 'trial') {
    await admin.from('driver_profiles').update({ trial_loads_used: profile.trial_loads_used + 1 }).eq('user_id', user.id)
  }

  return NextResponse.json({
    success: true, loadId: loadReq.id, status: 'pending',
    message: requiresExtraReview ? '⏳ Caliche requires manual review - usually within 2 hours.' : '⏳ Under review. You will get an SMS with the address within 2 hours.'
  }, { status: 201 })
}
