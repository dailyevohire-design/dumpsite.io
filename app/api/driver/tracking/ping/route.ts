import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { createServerSupabase } from '@/lib/supabase.server'

const GEOFENCE_ARRIVAL_METERS = 500

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { loadId, lat, lng, accuracy } = body

  if (!loadId || typeof lat !== 'number' || typeof lng !== 'number') {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const admin = createAdminSupabase()

  // Find latest tracking session for this load + driver
  const { data: session } = await admin
    .from('job_tracking_sessions')
    .select('id, arrived_at, load_request_id')
    .eq('load_request_id', loadId)
    .eq('driver_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!session) {
    return NextResponse.json({ error: 'No active tracking session' }, { status: 404 })
  }

  // Insert ping
  await admin.from('job_location_pings').insert({
    tracking_session_id: session.id,
    lat,
    lng,
    accuracy_meters: typeof accuracy === 'number' ? accuracy : null,
  })

  const now = new Date().toISOString()
  const updates: Record<string, any> = { last_ping_at: now }

  // Geofence arrival detection — check if within 500m of delivery address
  if (!session.arrived_at) {
    // Get delivery address coordinates
    const { data: load } = await admin
      .from('load_requests')
      .select('dispatch_order_id')
      .eq('id', loadId)
      .single()

    if (load?.dispatch_order_id) {
      const { data: order } = await admin
        .from('dispatch_orders')
        .select('client_address, cities(name)')
        .eq('id', load.dispatch_order_id)
        .single()

      let destLat: number | null = null
      let destLng: number | null = null

      if (order?.client_address) {
        try {
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), 3000)
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

      if (destLat !== null && destLng !== null) {
        const distance = haversineMeters(lat, lng, destLat, destLng)
        if (distance <= GEOFENCE_ARRIVAL_METERS) {
          updates.arrived_at = now
          // Log arrival
          await admin.from('audit_logs').insert({
            action: 'job.geofence_arrival_detected',
            entity_type: 'load_request',
            entity_id: loadId,
            metadata: { driver_id: user.id, lat, lng, distance_meters: Math.round(distance) }
          })
        }
      }
    }
  }

  await admin
    .from('job_tracking_sessions')
    .update(updates)
    .eq('id', session.id)

  return NextResponse.json({ success: true, arrived: !!updates.arrived_at })
}
