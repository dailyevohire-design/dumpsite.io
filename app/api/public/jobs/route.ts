import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'

/**
 * Public jobs API — no authentication required.
 * SECURITY: Only returns safe, non-sensitive fields.
 * NEVER returns: client_address, client_name, client_phone, price_quoted_cents
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const cityFilter = searchParams.get('city')

  const admin = createAdminSupabase()

  let query = admin
    .from('dispatch_orders')
    .select('id, city_id, yards_needed, driver_pay_cents, urgency, created_at, truck_type_needed, cities(name)')
    .eq('status', 'dispatching')
    .order('driver_pay_cents', { ascending: false })
    .limit(20)

  if (cityFilter) {
    // Filter by city name via the cities relation
    const { data: cityRow } = await admin
      .from('cities')
      .select('id')
      .ilike('name', cityFilter)
      .maybeSingle()

    if (cityRow) {
      query = query.eq('city_id', cityRow.id)
    } else {
      // No matching city — return empty
      return NextResponse.json(
        { success: true, jobs: [] },
        {
          headers: {
            'Cache-Control': 'public, max-age=60',
          },
        }
      )
    }
  }

  const { data, error } = await query

  if (error) {
    console.error('[public/jobs] fetch failed:', error.code)
    return NextResponse.json(
      { success: false, error: 'Failed to load jobs' },
      { status: 500 }
    )
  }

  // SECURITY AUDIT: Map to only safe fields — never leak sensitive data
  const safeJobs = (data || []).map((job: any) => ({
    id: job.id,
    city_name: job.cities?.name || 'DFW',
    driver_pay_cents: job.driver_pay_cents,
    yards_needed: job.yards_needed,
    truck_type_needed: job.truck_type_needed,
    urgency: job.urgency,
    created_at: job.created_at,
  }))

  return NextResponse.json(
    { success: true, jobs: safeJobs },
    {
      headers: {
        'Cache-Control': 'public, max-age=60',
      },
    }
  )
}
