import { createAdminSupabase } from '../supabase'
import { DEFAULT_DRIVER_PAY_CENTS } from '../driver-pay-rates'

const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY || ''

// ─────────────────────────────────────────────────────────────
// DISTANCE
// ─────────────────────────────────────────────────────────────
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ─────────────────────────────────────────────────────────────
// GEOCODING — Google Maps (address-level) with Nominatim fallback (city-level)
// ─────────────────────────────────────────────────────────────
interface GeoResult {
  lat: number
  lng: number
  precision: 'address' | 'city' | 'unknown'
  formattedAddress?: string
}

// Parse raw "lat,lng" or a Google Maps share link → coordinates.
// Returns null if input isn't a coordinate or maps link, or if link resolution fails.
export async function parseCoordinatesOrMapsLink(input: string): Promise<GeoResult | null> {
  // 1) Bare coordinate pair (covers "32.7767,-96.797" and "32.7767 -96.797")
  const coordMatch = input.match(/(-?\d{1,3}\.\d{3,})\s*[,\s]\s*(-?\d{1,3}\.\d{3,})/)
  if (coordMatch) {
    const lat = parseFloat(coordMatch[1])
    const lng = parseFloat(coordMatch[2])
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return { lat, lng, precision: 'address', formattedAddress: `${lat},${lng}` }
    }
  }
  // 2) Google Maps share link — follow redirect, then pull coords from final URL
  const urlMatch = input.match(/https?:\/\/(?:www\.)?(?:maps\.google\.[a-z.]+|google\.[a-z.]+\/maps|goo\.gl\/maps|maps\.app\.goo\.gl|g\.co\/maps)\/?\S*/i)
  if (urlMatch) {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 5000)
      const resp = await fetch(urlMatch[0], { redirect: 'follow', signal: ctrl.signal })
      clearTimeout(t)
      const finalUrl = resp.url
      // Pattern A: @lat,lng,zoom (modern maps URLs)
      let m = finalUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/)
      // Pattern B: !3d<lat>!4d<lng> (place URLs)
      if (!m) m = finalUrl.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/)
      // Pattern C: ?q=lat,lng or &q=lat,lng (legacy share format)
      if (!m) m = finalUrl.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/)
      if (m) {
        const lat = parseFloat(m[1])
        const lng = parseFloat(m[2])
        return { lat, lng, precision: 'address', formattedAddress: `${lat},${lng}` }
      }
      console.warn('[parseMapsLink] could not extract coords from final URL:', finalUrl)
    } catch (err) {
      console.error('[parseMapsLink] fetch error:', err)
    }
  }
  return null
}

async function geocode(input: string): Promise<GeoResult | null> {
  // Try direct coordinate / Maps-link parsing first — bypasses external geocoder
  const direct = await parseCoordinatesOrMapsLink(input)
  if (direct) return direct

  // Try Google Maps first (address-level precision)
  if (GOOGLE_MAPS_KEY) {
    try {
      const q = encodeURIComponent(input.includes('TX') || input.includes('Texas') ? input : `${input}, Texas, USA`)
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${q}&key=${GOOGLE_MAPS_KEY}&components=country:US`
      // Hard 5s timeout — without it a slow Google response hangs the entire SMS webhook
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 5000)
      const r = await fetch(url, { signal: ctrl.signal })
      clearTimeout(t)
      const data = await r.json()
      if (data.status === 'OK' && data.results?.[0]) {
        const loc = data.results[0].geometry.location
        const types = data.results[0].types || []
        // Determine precision — street_address or route = address-level, locality = city-level
        const isAddressLevel = types.some((t: string) =>
          ['street_address', 'route', 'premise', 'subpremise', 'intersection'].includes(t)
        )
        return {
          lat: loc.lat,
          lng: loc.lng,
          precision: isAddressLevel ? 'address' : 'city',
          formattedAddress: data.results[0].formatted_address,
        }
      }
    } catch (err) {
      console.error('[geocode] Google Maps error:', err)
    }
  }

  // Fallback: Nominatim (city-level only)
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 5000)
    // Warmup delay sits INSIDE the abort window so a hung process can't bypass the 5s budget
    await new Promise(r => setTimeout(r, 300))
    const q = encodeURIComponent(input.includes('Texas') || input.includes('TX') ? input : `${input} Texas USA`)
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${q}&limit=1`
    const r = await fetch(url, { headers: { 'User-Agent': 'DumpSite.io/1.0' }, signal: ctrl.signal })
    clearTimeout(t)
    const data = await r.json()
    if (data?.[0]) {
      return {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
        precision: 'city',
      }
    }
  } catch {}

  return null
}

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────
export interface JobMatch {
  id: string
  cityName: string
  yardsNeeded: number
  driverPayCents: number
  truckTypeNeeded: string
  distanceMiles: number
  drivingMinutes: number
  clientPhone: string
  clientName: string
}

// CP2: the dispatch_orders column that flags 18-wheeler site access.
// Exported so tests and future code reference a single source of truth.
export const ACCESS_COLUMN = 'eighteen_wheeler_access'

const BIG_TRUCK_TYPES = new Set(['end_dump', '18_wheeler', 'eighteen_wheeler', 'semi'])
const SMALL_TRUCK_TYPES = new Set(['tandem_axle', 'dump_truck', 'tandem'])

export function normalizeTruckClass(truckType?: string | null): 'small' | 'big' {
  if (!truckType) return 'small'
  if (BIG_TRUCK_TYPES.has(truckType)) return 'big'
  // tandem/dump_truck match small explicitly; anything else also defaults small
  // (if we guess wrong on an unknown type, small is safer — no sites filtered out).
  return 'small'
}

// ─────────────────────────────────────────────────────────────
// FIND NEARBY JOBS
// Now accepts full address OR city name. Geocodes to actual coordinates.
// ─────────────────────────────────────────────────────────────
export async function findNearbyJobs(
  driverLocation: string,
  truckType?: string | null,
  maxMiles = 15
): Promise<JobMatch[]> {
  const supabase = createAdminSupabase()

  // CP2: 18-wheeler access gate. Normalize driver truck class, then filter at
  // the query level so we never pick up a site that can't physically accept
  // an 18-wheeler. Tandem/dump-truck drivers get everything — they fit anywhere.
  const truckClass = normalizeTruckClass(truckType)
  const baseSelect = 'id, city_id, yards_needed, driver_pay_cents, truck_type_needed, status, delivery_latitude, delivery_longitude, client_phone, client_name, client_address, cities(name)'

  let orders: any[] | null = null
  let accessColumnUsed: string | null = null
  let candidatesBeforeFilter = 0

  if (truckClass === 'big') {
    const q = supabase
      .from('dispatch_orders')
      .select(baseSelect)
      .in('status', ['dispatching', 'active', 'pending'])
      .eq(ACCESS_COLUMN, true)
      .order('created_at', { ascending: false })
    const { data, error } = await q
    if (error && error.message?.includes(ACCESS_COLUMN)) {
      // Column not applied yet (migration pending). Log and fall back to
      // unfiltered behavior so routing doesn't break in prod before the
      // dashboard DDL run. Once the migration is in, this branch is dead.
      console.warn(`[routing] ${ACCESS_COLUMN} column missing — running without access filter`)
      const { data: unfiltered } = await supabase
        .from('dispatch_orders')
        .select(baseSelect)
        .in('status', ['dispatching', 'active', 'pending'])
        .order('created_at', { ascending: false })
      orders = unfiltered
      accessColumnUsed = null
      candidatesBeforeFilter = unfiltered?.length || 0
    } else {
      if (error) console.error('[routing]', error.message)
      orders = data
      accessColumnUsed = ACCESS_COLUMN
      // For observability we also need pre-filter count
      const { count } = await supabase
        .from('dispatch_orders')
        .select('id', { count: 'exact', head: true })
        .in('status', ['dispatching', 'active', 'pending'])
      candidatesBeforeFilter = count || 0
    }
  } else {
    const { data, error } = await supabase
      .from('dispatch_orders')
      .select(baseSelect)
      .in('status', ['dispatching', 'active', 'pending'])
      .order('created_at', { ascending: false })
    if (error) console.error('[routing]', error.message)
    orders = data
    accessColumnUsed = null
    candidatesBeforeFilter = data?.length || 0
  }

  const candidatesAfterFilter = orders?.length || 0

  // Fire-and-forget observability — never blocks routing on log failure.
  try {
    await supabase.from('jesse_routing_log').insert({
      driver_location: driverLocation,
      truck_type_input: truckType || null,
      normalized_class: truckClass,
      candidates_before_filter: candidatesBeforeFilter,
      candidates_after_filter: candidatesAfterFilter,
      access_column_used: accessColumnUsed,
    })
  } catch (err: any) {
    // Table may not exist yet (migration pending). Silent fail — routing must continue.
    if (!err?.message?.includes('jesse_routing_log')) {
      console.error('[routing log]', err?.message)
    }
  }

  if (!orders?.length) return []

  // Filter out already-reserved orders
  const { data: activeReservations } = await supabase
    .from('site_reservations')
    .select('order_id')
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())

  const reservedIds = new Set((activeReservations || []).map((r: any) => r.order_id))
  const available = orders.filter(o => !reservedIds.has(o.id))
  if (!available.length) return []

  // Geocode driver location (address or city)
  const driverGeo = await geocode(driverLocation)

  let withDistance: (typeof available[0] & { distanceMiles: number; drivingMinutes: number })[]

  if (driverGeo) {
    // For orders missing coordinates, geocode their client_address and backfill
    const needsGeocode = available.filter(o => !o.delivery_latitude && o.client_address)
    if (needsGeocode.length > 0) {
      // Geocode up to 10 missing orders in parallel to avoid rate limits
      const toGeocode = needsGeocode.slice(0, 10)
      const geoResults = await Promise.all(
        toGeocode.map(async (o) => {
          try {
            const geo = await geocode(o.client_address!)
            if (geo) {
              // Backfill coordinates in DB for future lookups
              await supabase.from('dispatch_orders').update({
                delivery_latitude: geo.lat, delivery_longitude: geo.lng
              }).eq('id', o.id)
              return { id: o.id, lat: geo.lat, lng: geo.lng }
            }
          } catch {}
          return null
        })
      )
      // Apply geocoded coordinates to the available orders
      for (const result of geoResults) {
        if (result) {
          const order = available.find(o => o.id === result.id)
          if (order) {
            ;(order as any).delivery_latitude = result.lat
            ;(order as any).delivery_longitude = result.lng
          }
        }
      }
    }

    withDistance = available
      .filter(o => o.delivery_latitude && o.delivery_longitude)
      .map(o => {
        const dist = haversine(driverGeo.lat, driverGeo.lng, o.delivery_latitude!, o.delivery_longitude!)
        return {
          ...o,
          distanceMiles: dist,
          // Rough driving estimate: 1.3x haversine distance, 35mph average in DFW
          drivingMinutes: Math.round((dist * 1.3 / 35) * 60),
        }
      })
      .sort((a, b) => a.distanceMiles - b.distanceMiles)

    // Address-aware tiering — prefer same city as driver loading address before pure distance.
    // Tier 1: same city as driver formattedAddress; Tier 2: within 25mi; Tier 3: further.
    const driverCity = (driverGeo.formattedAddress || '')
      .split(',').map(s => s.trim()).filter(Boolean)[1]?.toLowerCase() || ''
    const tier1: typeof withDistance = []
    const tier2: typeof withDistance = []
    const tier3: typeof withDistance = []
    for (const o of withDistance) {
      const orderCity = ((o.cities as any)?.name || '').toLowerCase()
      if (driverCity && orderCity && orderCity === driverCity) tier1.push(o)
      else if (o.distanceMiles <= 25) tier2.push(o)
      else tier3.push(o)
    }
    let tiered = tier1.length ? tier1 : tier2.length ? tier2 : tier3
    // Within tier, also enforce maxMiles softness: try 15, then 30, then keep top 5
    let nearby = tiered.filter(o => o.distanceMiles <= maxMiles)
    if (!nearby.length) nearby = tiered.filter(o => o.distanceMiles <= 30)
    if (!nearby.length) nearby = tiered.slice(0, 5)
    withDistance = nearby
  } else {
    // Geocoding completely failed — return nothing rather than fake 0-mile results
    console.warn('[routing] geocoding failed for:', driverLocation)
    return []
  }

  // (CP2 replaced the old post-fetch truck_type_needed filter with a
  // query-level gate on eighteen_wheeler_access — see above.)

  return withDistance.slice(0, 5).map(o => ({
    id: o.id,
    cityName: (o.cities as any)?.name || driverLocation,
    yardsNeeded: o.yards_needed,
    driverPayCents: o.driver_pay_cents || DEFAULT_DRIVER_PAY_CENTS,
    truckTypeNeeded: o.truck_type_needed || 'tandem_axle', // null = dump truck access only
    distanceMiles: Math.round(o.distanceMiles * 10) / 10,
    drivingMinutes: o.drivingMinutes,
    clientPhone: o.client_phone || '',
    clientName: o.client_name || 'Customer',
  }))
}

// ─────────────────────────────────────────────────────────────
// ATOMIC CLAIM
// ─────────────────────────────────────────────────────────────
export async function atomicClaimJob(
  orderId: string,
  driverPhone: string,
  driverUserId: string
): Promise<string | null> {
  const supabase = createAdminSupabase()
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString()

  const { data, error } = await supabase.rpc('claim_dispatch_order', {
    p_order_id: orderId,
    p_driver_phone: driverPhone,
    p_driver_user_id: driverUserId,
    p_expires_at: expiresAt
  })

  if (error) { console.error('[routing claim]', error.message); return null }
  return data as string | null
}

export async function releaseReservation(reservationId: string): Promise<void> {
  const supabase = createAdminSupabase()
  await supabase.from('site_reservations').update({ status: 'released', updated_at: new Date().toISOString() }).eq('id', reservationId)
}

// Export geocode for use in brain service
export { geocode }
