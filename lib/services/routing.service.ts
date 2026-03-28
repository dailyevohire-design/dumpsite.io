import { createAdminSupabase } from '../supabase'

function distanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

async function geocodeCity(city: string): Promise<{ lat: number; lng: number } | null> {
  try {
    await new Promise(r => setTimeout(r, 300))
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(city + ' Texas USA')}&limit=1`
    const r = await fetch(url, { headers: { 'User-Agent': 'DumpSite.io/1.0' } })
    const data = await r.json()
    if (data?.[0]) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) }
    // Try without Texas
    const url2 = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(city + ' USA')}&limit=1`
    const r2 = await fetch(url2, { headers: { 'User-Agent': 'DumpSite.io/1.0' } })
    const data2 = await r2.json()
    if (data2?.[0]) return { lat: parseFloat(data2[0].lat), lng: parseFloat(data2[0].lon) }
  } catch {}
  return null
}

export interface JobMatch {
  id: string
  cityName: string
  yardsNeeded: number
  driverPayCents: number
  truckTypeNeeded: string
  distanceMiles: number
  clientPhone: string
  clientName: string
}

export async function findNearbyJobs(
  driverCity: string,
  truckType?: string | null,
  maxMiles = 15
): Promise<JobMatch[]> {
  const supabase = createAdminSupabase()

  // Get open orders with coordinates
  const { data: orders, error } = await supabase
    .from('dispatch_orders')
    .select('id, city_id, yards_needed, driver_pay_cents, truck_type_needed, status, delivery_latitude, delivery_longitude, client_phone, client_name, cities(name)')
    .in('status', ['dispatching', 'active', 'pending'])
    .not('delivery_latitude', 'is', null)
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

  // Geocode driver city
  const driverCoords = await geocodeCity(driverCity)

  let withDistance: (typeof available[0] & { distanceMiles: number })[]

  if (driverCoords) {
    withDistance = available
      .filter(o => o.delivery_latitude && o.delivery_longitude)
      .map(o => ({
        ...o,
        distanceMiles: distanceMiles(driverCoords.lat, driverCoords.lng, o.delivery_latitude!, o.delivery_longitude!)
      }))
      .sort((a, b) => a.distanceMiles - b.distanceMiles)

    // Try 15 miles, expand to 30 if nothing found
    let nearby = withDistance.filter(o => o.distanceMiles <= maxMiles)
    if (!nearby.length) nearby = withDistance.filter(o => o.distanceMiles <= 30)
    if (!nearby.length) nearby = withDistance.slice(0, 3)
    withDistance = nearby
  } else {
    withDistance = available.slice(0, 5).map(o => ({ ...o, distanceMiles: 0 }))
  }

  // Filter by truck type if specified
  if (truckType) {
    const truckFiltered = withDistance.filter(o => !o.truck_type_needed || o.truck_type_needed === truckType)
    if (truckFiltered.length) withDistance = truckFiltered
  }

  return withDistance.slice(0, 5).map(o => ({
    id: o.id,
    cityName: (o.cities as any)?.name || driverCity,
    yardsNeeded: o.yards_needed,
    driverPayCents: o.driver_pay_cents || 4500,
    truckTypeNeeded: o.truck_type_needed || 'tandem_axle',
    distanceMiles: Math.round(o.distanceMiles * 10) / 10,
    clientPhone: o.client_phone || '',
    clientName: o.client_name || 'Customer'
  }))
}

export async function atomicClaimJob(
  orderId: string,
  driverPhone: string,
  driverUserId: string
): Promise<string | null> {
  const supabase = createAdminSupabase()
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString() // 30 min TTL

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
