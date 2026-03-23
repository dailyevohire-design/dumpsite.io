import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { createServerSupabase } from '@/lib/supabase.server'
import { rateLimit } from '@/lib/rate-limit'
import { analyzeForFraud, type PingData } from '@/lib/fraud-detection'

// Geofence thresholds
const GEOFENCE_AUTO_APPROVE_KM = 1.0   // Within 1km = auto-approve
const GEOFENCE_FLAG_KM = 5.0           // Within 5km = flag for review (not block)
const MIN_TIME_ON_SITE_MINUTES = 10    // Must be on site at least 10 minutes

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimit(`complete-load:${user.id}`, 10, '1 h')
  if (!rl.allowed) return rl.response!

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { loadId, completionPhotoUrl, loadsDelivered, photoLat, photoLng } = body
  if (!loadId || !completionPhotoUrl || !loadsDelivered) {
    return NextResponse.json({ error: 'Missing required fields (loadId, completionPhotoUrl, loadsDelivered)' }, { status: 400 })
  }

  // Validate photo URL — must be https
  if (typeof completionPhotoUrl !== 'string' || !completionPhotoUrl.startsWith('https://')) {
    return NextResponse.json({ error: 'Invalid photo URL' }, { status: 400 })
  }

  // Validate GPS coordinates if provided
  if (typeof photoLat === 'number' && (photoLat < -90 || photoLat > 90)) {
    return NextResponse.json({ error: 'Invalid latitude' }, { status: 400 })
  }
  if (typeof photoLng === 'number' && (photoLng < -180 || photoLng > 180)) {
    return NextResponse.json({ error: 'Invalid longitude' }, { status: 400 })
  }

  const numLoads = parseInt(loadsDelivered)
  if (isNaN(numLoads) || numLoads < 1 || numLoads > 200) return NextResponse.json({ error: 'Invalid loads count' }, { status: 400 })

  const admin = createAdminSupabase()

  // 1. Load load_request and validate ownership + status
  const { data: load, error: loadError } = await admin
    .from('load_requests')
    .select('id, driver_id, status, dispatch_order_id, truck_count, payout_cents')
    .eq('id', loadId)
    .single()

  if (loadError || !load) return NextResponse.json({ error: 'Load not found' }, { status: 404 })
  if (load.driver_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Already completed — return success so driver sees green screen (idempotent)
  if (load.status === 'completed') {
    const payPerLoad = 2000
    return NextResponse.json({
      success: true,
      loadsDelivered: load.truck_count || numLoads,
      totalPayDollars: Math.round((load.payout_cents || payPerLoad * numLoads) / 100),
      autoApproved: true,
      flaggedForReview: false,
      alreadyCompleted: true,
    })
  }

  if (load.status !== 'approved') {
    const msg = load.status === 'rejected' ? 'This load was rejected'
      : load.status === 'pending' ? 'This load is still pending approval'
      : 'This load cannot be completed right now'
    return NextResponse.json({ error: msg }, { status: 409 })
  }

  // FIX: Verify dispatch order is still active (not cancelled/completed)
  if (load.dispatch_order_id) {
    const { data: dOrder } = await admin
      .from('dispatch_orders')
      .select('status')
      .eq('id', load.dispatch_order_id)
      .single()
    if (dOrder && (dOrder.status === 'cancelled' || dOrder.status === 'completed')) {
      return NextResponse.json({ error: 'This job is no longer active' }, { status: 409 })
    }
  }

  // 2. Load tracking session — if it exists, great. If not, still allow completion.
  // Some loads were approved before the tracking system existed, or the driver
  // is completing from the inline job-access page where the session is already started.
  const { data: session } = await admin
    .from('job_tracking_sessions')
    .select('id, job_started_at, address_revealed_at, arrived_at, created_at')
    .eq('load_request_id', loadId)
    .eq('driver_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Flag for review if no tracking session or job wasn't started via secure link
  let missingSession = false
  if (!session || !session.job_started_at) {
    missingSession = true // will be flagged but not blocked
  }

  // 3. Get delivery address coordinates for geofence check
  let destLat: number | null = null
  let destLng: number | null = null

  if (load.dispatch_order_id) {
    const { data: order } = await admin
      .from('dispatch_orders')
      .select('client_address, cities(name)')
      .eq('id', load.dispatch_order_id)
      .single()

    if (order?.client_address) {
      // Try geocoding
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 4000)
        const geoRes = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(order.client_address)}`,
          { headers: { 'User-Agent': 'DumpSite.io/1.0' }, signal: controller.signal }
        )
        clearTimeout(timeout)
        const geoData = await geoRes.json()
        if (geoData?.[0]) {
          destLat = parseFloat(geoData[0].lat)
          destLng = parseFloat(geoData[0].lon)
        }
      } catch {}
    }

    // City fallback
    if (destLat === null && order) {
      const CITY_COORDS: Record<string, [number, number]> = {
        'Arlington': [32.7357, -97.1081], 'Dallas': [32.7767, -96.7970], 'Fort Worth': [32.7555, -97.3308],
        'Garland': [32.9126, -96.6389], 'Everman': [32.6293, -97.2836], 'McKinney': [33.1972, -96.6397],
        'Plano': [33.0198, -96.6989], 'Irving': [32.8140, -96.9489], 'Little Elm': [33.1629, -96.9375],
        'Midlothian': [32.4821, -97.0053], 'Carrollton': [32.9537, -96.8903], 'Mansfield': [32.5632, -97.1411],
      }
      const cityName = (order.cities as any)?.name
      if (cityName && CITY_COORDS[cityName]) {
        destLat = CITY_COORDS[cityName][0]
        destLng = CITY_COORDS[cityName][1]
      }
    }
  }

  // 4. Get GPS pings to check time on site and location
  let pings: any[] | null = null
  if (session?.id) {
    // Limit pings to prevent unbounded fetch on long jobs
    const { data } = await admin
      .from('job_location_pings')
      .select('lat, lng, recorded_at')
      .eq('tracking_session_id', session.id)
      .order('recorded_at', { ascending: true })
      .limit(500)
    pings = data
  }

  // 5. Calculate geofence + time on site
  let distanceKm: number | null = null
  let photoDistanceKm: number | null = null
  let timeOnSiteMinutes = 0
  let gpsMatch = false
  let flagForReview = false

  // Time on site = time since job started
  if (session?.job_started_at) {
    timeOnSiteMinutes = Math.round((Date.now() - new Date(session.job_started_at).getTime()) / 60000)
  }

  // Check latest ping against destination
  if (destLat !== null && destLng !== null && pings && pings.length > 0) {
    const lastPing = pings[pings.length - 1]
    distanceKm = haversineKm(lastPing.lat, lastPing.lng, destLat, destLng)
  }

  // Check photo GPS metadata against destination
  if (destLat !== null && destLng !== null && typeof photoLat === 'number' && typeof photoLng === 'number') {
    photoDistanceKm = haversineKm(photoLat, photoLng, destLat, destLng)
  }

  // Determine if GPS matches
  const bestDistance = Math.min(
    distanceKm ?? Infinity,
    photoDistanceKm ?? Infinity
  )

  if (bestDistance <= GEOFENCE_AUTO_APPROVE_KM) {
    gpsMatch = true
  } else if (bestDistance <= GEOFENCE_FLAG_KM) {
    // Close enough — allow but flag
    gpsMatch = false
    flagForReview = true
  } else if (bestDistance === Infinity) {
    // No GPS data at all — allow but flag
    flagForReview = true
  } else {
    // Far from site — flag for review (don't block)
    flagForReview = true
  }

  // Flag if no tracking session
  if (missingSession) flagForReview = true

  // Auto-approve if GPS matches AND enough time on site
  const autoApproved = gpsMatch && timeOnSiteMinutes >= MIN_TIME_ON_SITE_MINUTES && !missingSession

  // 5b. Run fraud detection engine
  const fraudPings: PingData[] = (pings || []).map((p: any) => ({
    lat: p.lat,
    lng: p.lng,
    recorded_at: p.recorded_at,
    accuracy_meters: p.accuracy_meters,
    at_delivery_site: destLat !== null && destLng !== null
      ? haversineKm(p.lat, p.lng, destLat, destLng) <= 0.5
      : false,
  }))

  let fraudAnalysis = analyzeForFraud({
    pings: fraudPings,
    claimedLoads: numLoads,
    completionLat: typeof photoLat === 'number' ? photoLat : undefined,
    completionLng: typeof photoLng === 'number' ? photoLng : undefined,
    deliveryLat: destLat ?? undefined,
    deliveryLng: destLng ?? undefined,
    sessionStartedAt: session?.job_started_at ?? undefined,
  })

  // Override flagForReview if fraud engine flags it
  if (fraudAnalysis.recommendation === 'flag' || fraudAnalysis.recommendation === 'reject') {
    flagForReview = true
  }

  // 6. Resolve pay
  let payPerLoadCents = 2000
  if (load.dispatch_order_id) {
    const { data: order } = await admin.from('dispatch_orders').select('driver_pay_cents').eq('id', load.dispatch_order_id).single()
    if (order?.driver_pay_cents) payPerLoadCents = order.driver_pay_cents
  }

  const payoutCents = payPerLoadCents * numLoads
  const now = new Date().toISOString()

  // 7. Mark load_request completed
  // Try full update first, fall back to minimal if columns don't exist
  let completionSaved = false

  // Attempt 1: Full update with all columns
  const { error: err1 } = await admin.from('load_requests').update({
    status: 'completed',
    completion_photo_url: completionPhotoUrl,
    truck_count: numLoads,
    payout_cents: payoutCents,
    completed_at: now,
  }).eq('id', loadId).eq('driver_id', user.id).eq('status', 'approved')

  if (!err1) {
    completionSaved = true
  } else {
    console.error('[complete-load] full update failed:', err1.code, err1.message)

    // Attempt 2: Just set status to completed (absolute minimum)
    const { error: err2 } = await admin.from('load_requests').update({
      status: 'completed',
    }).eq('id', loadId).eq('driver_id', user.id).eq('status', 'approved')

    if (!err2) {
      completionSaved = true
      // Try adding other columns one by one (don't block)
      try { await admin.from('load_requests').update({ truck_count: numLoads }).eq('id', loadId) } catch {}
      try { await admin.from('load_requests').update({ payout_cents: payoutCents }).eq('id', loadId) } catch {}
      try { await admin.from('load_requests').update({ completed_at: now }).eq('id', loadId) } catch {}
      try { await admin.from('load_requests').update({ completion_photo_url: completionPhotoUrl }).eq('id', loadId) } catch {}
    } else {
      console.error('[complete-load] minimal update also failed:', err2.code, err2.message)
    }
  }

  if (!completionSaved) {
    return NextResponse.json({ error: 'Failed to mark load complete. Please try again.' }, { status: 500 })
  }

  // Set optional/fraud columns — never block the driver
  try {
    await admin.from('load_requests').update({
      completion_latitude: typeof photoLat === 'number' ? photoLat : null,
      completion_longitude: typeof photoLng === 'number' ? photoLng : null,
      completion_distance_km: bestDistance === Infinity ? null : Math.round(bestDistance * 100) / 100,
      requires_manual_review: flagForReview,
      fraud_score: fraudAnalysis.fraudScore,
      fraud_flags: JSON.stringify(fraudAnalysis.flags),
      flagged_for_review: flagForReview,
      ping_count: fraudPings.length,
    }).eq('id', loadId)
  } catch {}

  // Alert admin on high fraud risk — never block the driver
  if (fraudAnalysis.recommendation === 'reject') {
    try {
      const { sendAdminAlert } = await import('@/lib/sms')
      await sendAdminAlert(
        `HIGH FRAUD RISK: Load ${loadId.slice(0, 8)} — Score: ${fraudAnalysis.fraudScore}/100. ` +
        `Flags: ${fraudAnalysis.flags.join(', ')}. ` +
        `Driver submitted ${numLoads} loads. Review: /admin`
      )
    } catch {}
  }

  // 8. Update tracking session (if it exists)
  if (session?.id) {
    await admin.from('job_tracking_sessions').update({
      completion_code_verified_at: now,
      arrived_at: session.arrived_at || now,
    }).eq('id', session.id)
  }

  // 9. Audit log with geofence + fraud data
  await admin.from('audit_logs').insert({
    action: flagForReview ? 'job.completed_flagged_review' : 'job.completed_auto_approved',
    entity_type: 'load_request',
    entity_id: loadId,
    metadata: {
      driver_id: user.id,
      fraud_score: fraudAnalysis.fraudScore,
      fraud_flags: fraudAnalysis.flags,
      fraud_recommendation: fraudAnalysis.recommendation,
      distance_km: bestDistance === Infinity ? null : Math.round(bestDistance * 100) / 100,
      photo_distance_km: photoDistanceKm !== null ? Math.round(photoDistanceKm * 100) / 100 : null,
      time_on_site_minutes: timeOnSiteMinutes,
      auto_approved: autoApproved,
      flagged: flagForReview,
      ping_count: pings?.length || 0,
    }
  })

  // Track referral progress — increment loads for the referred driver
  try {
    const { data: referral } = await admin
      .from('driver_referrals')
      .select('id, referrer_id, loads_completed_by_referred, loads_required_to_qualify, status')
      .eq('referred_id', user.id)
      .eq('status', 'pending')
      .single()

    if (referral) {
      const newCount = (referral.loads_completed_by_referred || 0) + 1
      const updates: Record<string, any> = { loads_completed_by_referred: newCount }

      if (newCount >= referral.loads_required_to_qualify) {
        updates.status = 'qualified'
        updates.qualified_at = new Date().toISOString()
        // Alert admin about qualified referral
        try {
          const { sendAdminAlert } = await import('@/lib/sms')
          await sendAdminAlert(`Referral qualified! Driver completed ${newCount} loads. Referrer earns $25 bonus.`)
        } catch {}
      }

      await admin.from('driver_referrals').update(updates).eq('id', referral.id)
    }
  } catch {}

  return NextResponse.json({
    success: true,
    loadsDelivered: numLoads,
    totalPayDollars: Math.round(payoutCents / 100),
    autoApproved,
    flaggedForReview: flagForReview,
    distanceKm: bestDistance === Infinity ? null : Math.round(bestDistance * 100) / 100,
    timeOnSiteMinutes,
  })
}
