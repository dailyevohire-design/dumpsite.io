import { createAdminSupabase } from '../supabase'

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

async function geocode(input: string): Promise<GeoResult | null> {
  // Try Google Maps first (address-level precision)
  if (GOOGLE_MAPS_KEY) {
    try {
      const q = encodeURIComponent(input.includes('TX') || input.includes('Texas') ? input : `${input}, Texas, USA`)
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${q}&key=${GOOGLE_MAPS_KEY}&components=country:US`
      const r = await fetch(url)
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
    await new Promise(r => setTimeout(r, 300))
    const q = encodeURIComponent(input.includes('Texas') || input.includes('TX') ? input : `${input} Texas USA`)
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${q}&limit=1`
    const r = await fetch(url, { headers: { 'User-Agent': 'DumpSite.io/1.0' } })
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

  // Get ALL open orders — including ones without coordinates (we'll geocode them)
  const { data: orders, error } = await supabase
    .from('dispatch_orders')
    .select('id, city_id, yards_needed, driver_pay_cents, truck_type_needed, status, delivery_latitude, delivery_longitude, client_phone, client_name, client_address, cities(name)')
    .in('status', ['dispatching', 'active', 'pending'])
    .order('created_at', { ascending: false })

  if (error) console.error('[routing]', error.message)
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

    // No minimum distance — a driver close to a dump site is ideal
    // The dispatch address is the DUMP SITE, not the driver's loading address

    // Try 15 miles, expand to 30 if nothing found, then just return closest 5
    let nearby = withDistance.filter(o => o.distanceMiles <= maxMiles)
    if (!nearby.length) nearby = withDistance.filter(o => o.distanceMiles <= 30)
    if (!nearby.length) nearby = withDistance.slice(0, 5)
    withDistance = nearby
  } else {
    // Geocoding completely failed — return nothing rather than fake 0-mile results
    console.warn('[routing] geocoding failed for:', driverLocation)
    return []
  }

  // Filter by truck type family
  if (truckType) {
    const dumpFamily = ['tandem_axle', 'tri_axle', 'quad_axle', 'super_dump']
    const eighteenFamily = ['end_dump', 'belly_dump', 'side_dump', '18_wheeler', 'transfer']
    const driverFamily = dumpFamily.includes(truckType) ? dumpFamily : eighteenFamily.includes(truckType) ? eighteenFamily : null
    const truckFiltered = withDistance.filter(o => {
      // Orders with no truck type default to dump truck access only
      const orderTruck = o.truck_type_needed || 'tandem_axle'
      if (orderTruck === truckType) return true
      if (driverFamily && driverFamily.includes(orderTruck)) return true
      if (dumpFamily.includes(orderTruck) && dumpFamily.includes(truckType)) return true
      if (eighteenFamily.includes(orderTruck) && eighteenFamily.includes(truckType)) return true
      return false
    })
    if (truckFiltered.length) withDistance = truckFiltered
  }

  return withDistance.slice(0, 5).map(o => ({
    id: o.id,
    cityName: (o.cities as any)?.name || driverLocation,
    yardsNeeded: o.yards_needed,
    driverPayCents: o.driver_pay_cents || 4500,
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
