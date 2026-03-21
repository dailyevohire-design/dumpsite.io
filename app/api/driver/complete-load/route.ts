import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { createServerSupabase } from '@/lib/supabase.server'
import crypto from 'crypto'

const MAX_CODE_ATTEMPTS = 5
const ATTEMPT_WINDOW_MINUTES = 60

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { loadId, completionPhotoUrl, loadsDelivered, completionCode } = body
  if (!loadId || !completionPhotoUrl || !loadsDelivered || !completionCode) {
    return NextResponse.json({ error: 'Missing required fields (loadId, completionPhotoUrl, loadsDelivered, completionCode)' }, { status: 400 })
  }

  const numLoads = parseInt(loadsDelivered)
  if (isNaN(numLoads) || numLoads < 1 || numLoads > 200) return NextResponse.json({ error: 'Invalid loads count' }, { status: 400 })

  const admin = createAdminSupabase()

  // 1. Load load_request and validate ownership + status
  const { data: load, error: loadError } = await admin
    .from('load_requests')
    .select('id, driver_id, status, dispatch_order_id')
    .eq('id', loadId)
    .single()

  if (loadError || !load) return NextResponse.json({ error: 'Load not found' }, { status: 404 })
  if (load.driver_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (load.status !== 'approved') return NextResponse.json({ error: 'Load is not approved' }, { status: 409 })

  // 2. Rate limit: check failed code attempts in rolling window
  const windowStart = new Date(Date.now() - ATTEMPT_WINDOW_MINUTES * 60 * 1000).toISOString()
  const { count: failedAttempts } = await admin
    .from('completion_code_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('load_request_id', loadId)
    .eq('driver_id', user.id)
    .eq('success', false)
    .gte('created_at', windowStart)

  if ((failedAttempts || 0) >= MAX_CODE_ATTEMPTS) {
    return NextResponse.json({
      error: 'Too many invalid completion code attempts. Try again later or contact dispatch.'
    }, { status: 429 })
  }

  // 3. Load latest tracking session and validate job was started
  const { data: session } = await admin
    .from('job_tracking_sessions')
    .select('id, job_started_at, address_revealed_at')
    .eq('load_request_id', loadId)
    .eq('driver_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!session || !session.job_started_at || !session.address_revealed_at) {
    return NextResponse.json({ error: 'You must start the job via the secure link before completing it' }, { status: 400 })
  }

  // 4. Validate completion code
  const { data: codeRecord } = await admin
    .from('job_completion_codes')
    .select('id, code, expires_at, used_at')
    .eq('load_request_id', loadId)
    .single()

  if (!codeRecord) {
    return NextResponse.json({ error: 'No completion code found for this job' }, { status: 400 })
  }

  if (codeRecord.used_at) {
    return NextResponse.json({ error: 'Completion code has already been used' }, { status: 409 })
  }

  if (new Date(codeRecord.expires_at) < new Date()) {
    return NextResponse.json({ error: 'Completion code has expired' }, { status: 410 })
  }

  const submittedCode = Buffer.from(String(completionCode).trim())
  const storedCode = Buffer.from(codeRecord.code)
  if (submittedCode.length !== storedCode.length || !crypto.timingSafeEqual(submittedCode, storedCode)) {
    // Log failed attempt
    await admin.from('completion_code_attempts').insert({
      load_request_id: loadId,
      driver_id: user.id,
      attempted_code: String(completionCode).trim(),
      success: false,
    })
    return NextResponse.json({ error: 'Invalid completion code' }, { status: 400 })
  }

  // 5. Resolve pay
  let payPerLoadCents = 2000
  if (load.dispatch_order_id) {
    const { data: order } = await admin.from('dispatch_orders').select('driver_pay_cents').eq('id', load.dispatch_order_id).single()
    if (order?.driver_pay_cents) payPerLoadCents = order.driver_pay_cents
  }

  const payoutCents = payPerLoadCents * numLoads
  const now = new Date().toISOString()

  // 6. Mark load_request completed
  const { error: updateError } = await admin.from('load_requests').update({
    status: 'completed',
    completion_photo_url: completionPhotoUrl,
    truck_count: numLoads,
    payout_cents: payoutCents,
    completed_at: now,
  }).eq('id', loadId).eq('driver_id', user.id).eq('status', 'approved')

  if (updateError) return NextResponse.json({ error: 'Failed to mark complete' }, { status: 500 })

  // 7. Mark completion code used
  await admin.from('job_completion_codes').update({
    used_at: now,
    used_by_driver_id: user.id,
  }).eq('id', codeRecord.id)

  // 8. Update tracking session
  await admin.from('job_tracking_sessions').update({
    completion_code_verified_at: now,
    arrived_at: now,
  }).eq('id', session.id)

  // 9. Log successful attempt
  await admin.from('completion_code_attempts').insert({
    load_request_id: loadId,
    driver_id: user.id,
    attempted_code: '[valid]',
    success: true,
  })

  return NextResponse.json({
    success: true,
    loadsDelivered: numLoads,
    totalPayDollars: Math.round(payoutCents / 100)
  })
}
