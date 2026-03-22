import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { requireAdmin } from '@/lib/admin-auth'

export async function GET(req: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const supabase = createAdminSupabase()
  const { searchParams } = new URL(req.url)
  const loadId = searchParams.get('loadId')

  // If loadId provided, return detailed tracking for that load
  if (loadId) {
    const [sessionRes, tokenRes, codeRes, loadRes] = await Promise.all([
      supabase
        .from('job_tracking_sessions')
        .select('id, load_request_id, driver_id, terms_accepted_at, location_permission_granted_at, job_started_at, address_revealed_at, arrived_at, completion_code_verified_at, created_at, last_ping_at')
        .eq('load_request_id', loadId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single(),
      supabase
        .from('job_access_tokens')
        .select('id, driver_id, expires_at, used_at, created_at')
        .eq('load_request_id', loadId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single(),
      supabase
        .from('job_completion_codes')
        .select('code, expires_at, used_at, used_by_driver_id, created_at')
        .eq('load_request_id', loadId)
        .single(),
      supabase
        .from('load_requests')
        .select('id, status, driver_id, dispatch_order_id, submitted_at, completed_at, haul_date, payout_cents')
        .eq('id', loadId)
        .single(),
    ])

    // Get pings if session exists
    let pings: any[] = []
    if (sessionRes.data) {
      const { data } = await supabase
        .from('job_location_pings')
        .select('lat, lng, accuracy_meters, recorded_at')
        .eq('tracking_session_id', sessionRes.data.id)
        .order('recorded_at', { ascending: true })
        .limit(500)
      pings = data || []
    }

    // Get driver info
    let driver = null
    if (loadRes.data?.driver_id) {
      const { data } = await supabase
        .from('driver_profiles')
        .select('first_name, last_name, phone, company_name, truck_type, truck_count, status, gps_score, tiers(name, slug)')
        .eq('user_id', loadRes.data.driver_id)
        .single()
      driver = data
    }

    // Get dispatch order info
    let order = null
    if (loadRes.data?.dispatch_order_id) {
      const { data } = await supabase
        .from('dispatch_orders')
        .select('client_address, client_name, driver_pay_cents, cities(name)')
        .eq('id', loadRes.data.dispatch_order_id)
        .single()
      order = data
    }

    // Get destination coordinates — city coords lookup (instant, no external call)
    const CITY_COORDS: Record<string, [number, number]> = {
      'Alvarado': [32.4071, -97.2114], 'Arlington': [32.7357, -97.1081], 'Austin': [30.2672, -97.7431],
      'Azle': [32.8957, -97.5436], 'Bonham': [33.5762, -96.1772], 'Carrollton': [32.9537, -96.8903],
      'Carthage': [32.1582, -94.3394], 'Cedar Hill': [32.5882, -96.9561], 'Cleburne': [32.3471, -97.3836],
      'Colleyville': [32.8868, -97.1505], 'Covington': [32.1751, -97.2614], 'Dallas': [32.7767, -96.7970],
      'Denison': [33.7557, -96.5369], 'Denton': [33.2148, -97.1331], 'DeSoto': [32.5896, -96.8572],
      'Everman': [32.6293, -97.2836], 'Ferris': [32.5293, -96.6639], 'Fort Worth': [32.7555, -97.3308],
      'Garland': [32.9126, -96.6389], 'Godley': [32.4432, -97.5317], 'Gordonville': [33.8032, -96.8561],
      'Grand Prairie': [32.7460, -97.0186], 'Haslet': [32.9682, -97.3389], 'Hillsboro': [32.0132, -97.1239],
      'Houston': [29.7604, -95.3698], 'Hutchins': [32.6432, -96.7083], 'Hutto': [30.5427, -97.5467],
      'Irving': [32.8140, -96.9489], 'Joshua': [32.4593, -97.3903], 'Justin': [33.0843, -97.2967],
      'Kaufman': [32.5893, -96.3061], 'Lake Worth': [32.8068, -97.4336], 'Little Elm': [33.1629, -96.9375],
      'Mabank': [32.3668, -96.1044], 'Mansfield': [32.5632, -97.1411], 'Matador': [34.0107, -100.8237],
      'McKinney': [33.1972, -96.6397], 'Mesquite': [32.7668, -96.5992], 'Midlothian': [32.4821, -97.0053],
      'Plano': [33.0198, -96.6989], 'Ponder': [33.1843, -97.2836], 'Princeton': [33.1790, -96.4997],
      'Rockwall': [32.9312, -96.4597], 'Terrell': [32.7357, -96.2752], 'Venus': [32.4307, -97.1006],
    }

    let destinationCoords: { lat: number; lng: number } | null = null
    let geoSource = 'none'

    // Step 1: Try city coords first (instant, always available)
    const cityName = (order?.cities as any)?.name
    if (cityName) {
      const exact = CITY_COORDS[cityName]
      if (exact) {
        destinationCoords = { lat: exact[0], lng: exact[1] }
        geoSource = 'city'
      } else {
        const key = Object.keys(CITY_COORDS).find(k => cityName.toLowerCase().includes(k.toLowerCase()))
        if (key) {
          destinationCoords = { lat: CITY_COORDS[key][0], lng: CITY_COORDS[key][1] }
          geoSource = 'city-fuzzy'
        }
      }
    }

    // Step 2: Try geocoding the full address for more precision (async, non-blocking improvement)
    if (order?.client_address) {
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
          destinationCoords = { lat: parseFloat(geoData[0].lat), lng: parseFloat(geoData[0].lon) }
          geoSource = 'geocoded'
        }
      } catch {
        // Geocoding failed — city coords already set above as fallback
      }
    }

    // Step 3: Ultimate fallback — DFW center
    if (!destinationCoords) {
      destinationCoords = { lat: 32.7555, lng: -97.3308 }
      geoSource = 'dfw-default'
    }

    // Calculate distance and ETA server-side
    let distanceMiles: number | null = null
    let etaMinutes: number | null = null
    if (destinationCoords && pings.length > 0) {
      const last = pings[pings.length - 1]
      const R = 3958.8
      const dLat = (destinationCoords.lat - last.lat) * Math.PI / 180
      const dLng = (destinationCoords.lng - last.lng) * Math.PI / 180
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(last.lat * Math.PI / 180) * Math.cos(destinationCoords.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
      distanceMiles = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10
      etaMinutes = Math.round(distanceMiles / 0.5) // ~30mph city truck speed
    }

    return NextResponse.json({
      load: loadRes.data,
      driver,
      order,
      session: sessionRes.data,
      token: tokenRes.data,
      completionCode: codeRes.data,
      pings,
      destinationCoords,
      distanceMiles,
      etaMinutes,
    })
  }

  // Otherwise return summary of all tracked jobs
  const { data: sessions, error } = await supabase
    .from('job_tracking_sessions')
    .select(`
      id, load_request_id, driver_id, terms_accepted_at,
      job_started_at, address_revealed_at, arrived_at,
      completion_code_verified_at, created_at, last_ping_at
    `)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    return NextResponse.json({ error: 'Failed to load tracking data' }, { status: 500 })
  }

  if (!sessions || sessions.length === 0) {
    return NextResponse.json({ sessions: [] })
  }

  // Enrich with driver names and load info
  const driverIds = [...new Set(sessions.map(s => s.driver_id).filter(Boolean))]
  const loadIds = [...new Set(sessions.map(s => s.load_request_id).filter(Boolean))]

  const [driversRes, loadsRes] = await Promise.all([
    driverIds.length > 0
      ? supabase.from('driver_profiles').select('user_id, first_name, last_name, phone').in('user_id', driverIds)
      : { data: [] },
    loadIds.length > 0
      ? supabase.from('load_requests').select('id, status, dispatch_order_id, completed_at, payout_cents').in('id', loadIds)
      : { data: [] },
  ])

  const driversMap: Record<string, any> = {}
  const loadsMap: Record<string, any> = {}
  for (const d of (driversRes.data || [])) driversMap[d.user_id] = d
  for (const l of (loadsRes.data || [])) loadsMap[l.id] = l

  // Get dispatch order cities
  const dispatchIds = [...new Set((loadsRes.data || []).map(l => l.dispatch_order_id).filter(Boolean))]
  const ordersMap: Record<string, any> = {}
  if (dispatchIds.length > 0) {
    const { data: orders } = await supabase
      .from('dispatch_orders')
      .select('id, driver_pay_cents, cities(name)')
      .in('id', dispatchIds)
    for (const o of (orders || [])) ordersMap[o.id] = o
  }

  const enriched = sessions.map(s => {
    const load = loadsMap[s.load_request_id]
    const order = load?.dispatch_order_id ? ordersMap[load.dispatch_order_id] : null
    return {
      ...s,
      driver: driversMap[s.driver_id] || null,
      load: load || null,
      city: (order?.cities as any)?.name || 'Unknown',
      payDollars: order?.driver_pay_cents ? Math.round(order.driver_pay_cents / 100) : null,
    }
  })

  return NextResponse.json({ sessions: enriched })
}
