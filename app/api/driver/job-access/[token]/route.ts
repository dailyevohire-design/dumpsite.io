import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { createServerSupabase } from '@/lib/supabase.server'
import crypto from 'crypto'
import { rateLimit } from '@/lib/rate-limit'
import { CITY_COORDS } from '@/lib/city-coords'

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params

  const supabase = await createServerSupabase()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Rate limit to prevent token brute-force
  const rl = await rateLimit(`job-access:${user.id}`, 20, '1 m')
  if (!rl.allowed) return rl.response!

  const admin = createAdminSupabase()

  // Support both short_id (8 chars from SMS) and full token (64 hex chars)
  let accessToken: any = null
  if (token.length <= 12) {
    // Short ID lookup
    const { data } = await admin
      .from('job_access_tokens')
      .select('id, load_request_id, driver_id, expires_at, used_at')
      .eq('short_id', token)
      .single()
    accessToken = data
  } else {
    // Full token hash lookup
    const tokenHash = hashToken(token)
    const { data } = await admin
      .from('job_access_tokens')
      .select('id, load_request_id, driver_id, expires_at, used_at')
      .eq('token_hash', tokenHash)
      .single()
    accessToken = data
  }

  if (!accessToken) {
    return NextResponse.json({ error: 'Invalid or expired link' }, { status: 404 })
  }

  if (accessToken.driver_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (new Date(accessToken.expires_at) < new Date()) {
    return NextResponse.json({ error: 'This link has expired' }, { status: 410 })
  }

  // Load load_request + dispatch_order for safe fields only
  const { data: load } = await admin
    .from('load_requests')
    .select('id, dispatch_order_id, location_text')
    .eq('id', accessToken.load_request_id)
    .single()

  if (!load) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  let cityName = 'DFW'
  let payDollars = 20
  let deliveryLat: number | null = null
  let deliveryLng: number | null = null
  let distanceMiles: number | null = null

  if (load.dispatch_order_id) {
    const { data: order } = await admin
      .from('dispatch_orders')
      .select('driver_pay_cents, delivery_latitude, delivery_longitude, cities(name)')
      .eq('id', load.dispatch_order_id)
      .single()
    if (order) {
      payDollars = order.driver_pay_cents ? Math.round(order.driver_pay_cents / 100) : 20
      cityName = (order.cities as any)?.name || cityName
      deliveryLat = order.delivery_latitude
      deliveryLng = order.delivery_longitude

      // Fallback to city center
      if (!deliveryLat && cityName && CITY_COORDS[cityName]) {
        deliveryLat = CITY_COORDS[cityName].lat
        deliveryLng = CITY_COORDS[cityName].lng
      }

      // Calculate distance from driver's pickup location to delivery
      if (deliveryLat && deliveryLng && load.location_text) {
        try {
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), 4000)
          const geoRes = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(load.location_text)}`,
            { headers: { 'User-Agent': 'DumpSite.io/1.0' }, signal: controller.signal }
          )
          clearTimeout(timeout)
          const geoData = await geoRes.json()
          if (geoData?.[0]) {
            const km = haversineKm(parseFloat(geoData[0].lat), parseFloat(geoData[0].lon), deliveryLat, deliveryLng)
            distanceMiles = Math.round(km * 0.621371 * 10) / 10
          }
        } catch {}
      }
    }
  }

  // Check if job was already started (token used)
  let address = null
  let instructions = null

  if (accessToken.used_at) {
    // Token was already used — reveal address
    if (load.dispatch_order_id) {
      const { data: order } = await admin
        .from('dispatch_orders')
        .select('client_address, notes')
        .eq('id', load.dispatch_order_id)
        .single()
      if (order) {
        address = order.client_address
        instructions = order.notes
      }
    }
  }

  return NextResponse.json({
    loadId: load.id,
    cityName,
    payDollars,
    address,
    instructions,
    alreadyStarted: !!accessToken.used_at,
    deliveryLat,
    deliveryLng,
    distanceMiles,
  })
}
