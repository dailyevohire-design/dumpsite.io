import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { createServerSupabase } from '@/lib/supabase.server'
import crypto from 'crypto'
import { rateLimit } from '@/lib/rate-limit'

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params

  const supabase = await createServerSupabase()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Rate limit to prevent token brute-force
  const rl = await rateLimit(`job-start:${user.id}`, 10, '1 m')
  if (!rl.allowed) return rl.response!

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { acceptedTerms, lat, lng, accuracy } = body

  if (acceptedTerms !== true) {
    return NextResponse.json({ error: 'You must accept the terms to proceed' }, { status: 400 })
  }

  // GPS is optional — driver should never be blocked from working
  // Missing GPS will be flagged for review by fraud detection
  const hasLocation = typeof lat === 'number' && typeof lng === 'number'

  const admin = createAdminSupabase()

  // Support both short_id (8 chars from SMS) and full token (64 hex chars)
  let accessToken: any = null
  if (token.length <= 12) {
    const { data } = await admin
      .from('job_access_tokens')
      .select('id, load_request_id, driver_id, expires_at, used_at')
      .eq('short_id', token)
      .single()
    accessToken = data
  } else {
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

  // Prevent re-start — token is single-use
  if (accessToken.used_at) {
    return NextResponse.json({
      error: 'This secure job link has already been used. Contact dispatch if you need help.'
    }, { status: 409 })
  }

  const now = new Date().toISOString()

  // Find latest tracking session
  const { data: session } = await admin
    .from('job_tracking_sessions')
    .select('id')
    .eq('load_request_id', accessToken.load_request_id)
    .eq('driver_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (session) {
    await admin
      .from('job_tracking_sessions')
      .update({
        terms_accepted_at: now,
        location_permission_granted_at: now,
        job_started_at: now,
        address_revealed_at: now,
        last_ping_at: now,
      })
      .eq('id', session.id)

    // Insert first location ping (only if GPS available)
    if (hasLocation) {
      await admin.from('job_location_pings').insert({
        tracking_session_id: session.id,
        lat,
        lng,
        accuracy_meters: typeof accuracy === 'number' ? accuracy : null,
      })
    }
  }

  // Mark token as used
  await admin
    .from('job_access_tokens')
    .update({ used_at: now })
    .eq('id', accessToken.id)

  // Load dispatch_order for address reveal
  const { data: load } = await admin
    .from('load_requests')
    .select('dispatch_order_id')
    .eq('id', accessToken.load_request_id)
    .single()

  let address = 'Contact dispatch for address'
  let instructions: string | null = null
  let cityName = 'DFW'
  let payDollars = 20

  if (load?.dispatch_order_id) {
    const { data: order } = await admin
      .from('dispatch_orders')
      .select('client_address, notes, driver_pay_cents, cities(name)')
      .eq('id', load.dispatch_order_id)
      .single()
    if (order) {
      address = order.client_address || address
      instructions = order.notes || null
      payDollars = order.driver_pay_cents ? Math.round(order.driver_pay_cents / 100) : 20
      cityName = (order.cities as any)?.name || cityName
    }
  }

  // Audit log
  await admin.from('audit_logs').insert({
    action: 'job.terms_accepted_address_revealed',
    entity_type: 'load_request',
    entity_id: accessToken.load_request_id,
    metadata: { driver_id: user.id, lat: lat || null, lng: lng || null, gps_available: hasLocation }
  })

  return NextResponse.json({
    address,
    instructions,
    cityName,
    payDollars,
  })
}
