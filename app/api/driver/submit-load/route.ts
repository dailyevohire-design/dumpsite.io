import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { createServerSupabase } from '@/lib/supabase.server'
import { sendLoadSubmissionEmail } from '@/lib/email'
import { rateLimit } from '@/lib/rate-limit'
import { sanitizeText, validateUrl } from '@/lib/validation'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = user.user_metadata?.role
  if (role === 'admin' || role === 'superadmin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Rate limit: 5 per user per hour
  const rl = await rateLimit(`submit-load:${user.id}`, 5, '1 h')
  if (!rl.allowed) return rl.response!

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { dirtType, photoUrl, locationText, truckType, truckCount, yardsEstimated, haulDate, idempotencyKey, dispatchOrderId, pickupLat, pickupLng } = body

  if (!dirtType || !photoUrl || !locationText || !truckType || !truckCount || !yardsEstimated || !haulDate || !idempotencyKey || !dispatchOrderId) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Sanitize text inputs
  const cleanLocation = sanitizeText(String(locationText)).slice(0, 500)
  const cleanDirtType = sanitizeText(String(dirtType)).slice(0, 50)

  // Validate photo URL
  if (!validateUrl(String(photoUrl))) {
    return NextResponse.json({ error: 'Invalid photo URL' }, { status: 400 })
  }

  const truckCountNum = parseInt(truckCount)
  const yardsNum = parseInt(yardsEstimated)
  if (isNaN(truckCountNum) || truckCountNum < 1 || truckCountNum > 50) {
    return NextResponse.json({ error: 'Truck count must be between 1 and 50' }, { status: 400 })
  }
  if (isNaN(yardsNum) || yardsNum < 1) {
    return NextResponse.json({ error: 'Yards must be a positive number' }, { status: 400 })
  }

  const today = new Date().toISOString().split('T')[0]
  if (haulDate < today) {
    return NextResponse.json({ error: 'Haul date cannot be in the past' }, { status: 400 })
  }

  const admin = createAdminSupabase()

  // Validate dispatchOrderId exists and is active
  const { data: dispatchOrder } = await admin
    .from('dispatch_orders')
    .select('id')
    .eq('id', dispatchOrderId)
    .eq('status', 'dispatching')
    .single()

  if (!dispatchOrder) {
    return NextResponse.json({ error: 'This job is no longer available' }, { status: 404 })
  }

  // FIX: Prevent duplicate submissions to the same dispatch order by the same driver
  const { count: existingForOrder } = await admin
    .from('load_requests')
    .select('id', { count: 'exact', head: true })
    .eq('driver_id', user.id)
    .eq('dispatch_order_id', dispatchOrderId)
    .in('status', ['pending', 'approved'])

  if ((existingForOrder || 0) > 0) {
    return NextResponse.json({ error: 'You already have a submission for this job' }, { status: 409 })
  }

  const { data: profile } = await admin.from('driver_profiles').select('trial_loads_used, tiers(slug, trial_load_limit)').eq('user_id', user.id).single()
  if (!profile) return NextResponse.json({ error: 'Driver profile not found' }, { status: 404 })

  const tier = profile.tiers as any

  // Atomic trial limit check + increment (prevents race condition)
  if (tier?.slug === 'trial') {
    const { data: trialResult } = await admin.rpc('increment_trial_loads', { p_user_id: user.id })
    if (trialResult?.[0]?.limit_reached) {
      return NextResponse.json({
        success: false,
        code: 'TRIAL_LIMIT_REACHED',
        message: 'You have used all your free trial loads.'
      }, { status: 403 })
    }
  }

  const { count: pendingCount } = await admin.from('load_requests').select('id', { count: 'exact', head: true }).eq('driver_id', user.id).eq('status', 'pending')
  if ((pendingCount || 0) >= 5) {
    return NextResponse.json({ success: false, code: 'TOO_MANY_PENDING', message: 'You have 5 pending requests. Wait for approval before submitting more.' }, { status: 429 })
  }

  const requiresExtraReview = cleanDirtType === 'caliche'

  const insertData: Record<string, any> = {
    idempotency_key: idempotencyKey,
    driver_id: user.id,
    dispatch_order_id: dispatchOrderId,
    dirt_type: cleanDirtType,
    photo_url: photoUrl,
    location_text: cleanLocation,
    truck_type: truckType,
    truck_count: truckCountNum,
    yards_estimated: yardsNum,
    haul_date: haulDate,
    status: 'pending',
    requires_extra_review: requiresExtraReview,
  }

  // Save pickup coordinates if provided (from address autocomplete)
  if (typeof pickupLat === 'number' && typeof pickupLng === 'number') {
    insertData.pickup_latitude = pickupLat
    insertData.pickup_longitude = pickupLng
  }

  const { data: loadReq, error } = await admin.from('load_requests').upsert(
    insertData, { onConflict: 'idempotency_key' }
  ).select().single()

  if (error) return NextResponse.json({ success: false, message: 'Failed to submit. Please try again.' }, { status: 500 })

  // Trial increment already handled atomically above via RPC

  const { data: driverProfile } = await admin
    .from('driver_profiles')
    .select('first_name, last_name, phone')
    .eq('user_id', user.id)
    .single()

  const driverName = driverProfile
    ? `${driverProfile.first_name || ''} ${driverProfile.last_name || ''}`.trim() || 'Unknown Driver'
    : 'Unknown Driver'

  try {
    await sendLoadSubmissionEmail({
      driverName,
      driverPhone: driverProfile?.phone || 'N/A',
      dirtType: cleanDirtType,
      truckType,
      truckCount: truckCountNum,
      yardsEstimated: yardsNum,
      haulDate,
      locationText: cleanLocation,
      loadId: loadReq.id,
      requiresExtraReview,
      submittedAt: new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }),
    })
  } catch (emailErr: any) {
    console.error('Load submission email failed:', emailErr.message)
  }

  return NextResponse.json({
    success: true, loadId: loadReq.id, status: 'pending',
    message: requiresExtraReview ? '⏳ Caliche requires manual review.' : '⏳ Under review. SMS with secure job link coming once approved.'
  }, { status: 201 })
}
