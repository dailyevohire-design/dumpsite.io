import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { CITY_COORDS } from '@/lib/city-coords'

/**
 * Public jobs API — no authentication required.
 * SECURITY: Only returns safe, non-sensitive fields.
 * NEVER returns: client_address, client_name, client_phone,
 * price_quoted_cents, delivery_latitude, delivery_longitude
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const cityFilter = searchParams.get('city')
  const limit = Math.min(
    parseInt(searchParams.get('limit') || '20'), 50
  )

  const admin = createAdminSupabase()

  let query = admin
    .from('dispatch_orders')
    .select(`
      id,
      yards_needed,
      driver_pay_cents,
      truck_type_needed,
      urgency,
      created_at,
      cities!inner(name)
    `)
    .eq('status', 'dispatching')
    .order('driver_pay_cents', { ascending: false })
    .limit(limit)

  if (cityFilter) {
    // Look up city ID first, then filter
    const { data: cityRow } = await admin
      .from('cities')
      .select('id')
      .ilike('name', `%${cityFilter}%`)
      .maybeSingle()

    if (cityRow) {
      query = query.eq('city_id', cityRow.id)
    } else {
      return NextResponse.json(
        { jobs: [], total: 0 },
        { headers: { 'Cache-Control': 'public, max-age=60' } }
      )
    }
  }

  const { data, error } = await query

  if (error) {
    console.error('Public jobs error:', error)
    return NextResponse.json(
      { jobs: [], total: 0 },
      {
        status: 200,
        headers: { 'Cache-Control': 'public, max-age=60' },
      }
    )
  }

  // Build safe public response
  // NEVER include: client_address, client_name,
  // client_phone, price_quoted_cents,
  // delivery_latitude, delivery_longitude
  const safeJobs = (data || []).map((job: any) => {
    const cityName = job.cities?.name || 'DFW'
    const coords = CITY_COORDS[cityName] || CITY_COORDS['Dallas']
    // Add small jitter so pins don't stack exactly
    const jitter = () => (Math.random() - 0.5) * 0.02

    return {
      id: job.id,
      cityName,
      payPerLoad: Math.round((job.driver_pay_cents || 4500) / 100),
      yardsNeeded: job.yards_needed,
      truckTypeNeeded: job.truck_type_needed || 'tandem_axle',
      urgency: job.urgency || 'standard',
      createdAt: job.created_at,
      // City center coordinates only — never exact address
      lat: coords.lat + jitter(),
      lng: coords.lng + jitter(),
      truckAccessLabel: (
        job.truck_type_needed === 'end_dump' ||
        job.truck_type_needed === 'semi_transfer' ||
        (job.yards_needed || 0) >= 100
      )
        ? 'End Dump · 18-Wheeler · Tandem'
        : 'Tandem Axle Only',
    }
  })

  return NextResponse.json(
    { jobs: safeJobs, total: safeJobs.length },
    { headers: { 'Cache-Control': 'public, max-age=60' } }
  )
}
