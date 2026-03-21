import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { requireAdmin } from '@/lib/admin-auth'
import { sendApprovalSMS } from '@/lib/sms'
import crypto from 'crypto'

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function makeCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const { id } = await context.params
  const supabase = createAdminSupabase()

  // 1. Load pending load_request by id
  const { data: load, error: loadError } = await supabase
    .from('load_requests')
    .select('id, driver_id, dispatch_order_id, status')
    .eq('id', id)
    .eq('status', 'pending')
    .single()

  if (loadError || !load) {
    return NextResponse.json({ success: false, error: 'Load not found or already processed' }, { status: 404 })
  }

  // 2. Load driver profile
  const { data: driver } = await supabase
    .from('driver_profiles')
    .select('user_id, first_name, phone, status')
    .eq('user_id', load.driver_id)
    .single()

  // 3. Load pay + city from dispatch_order
  let payDollars = 20
  let cityName = 'DFW'

  if (load.dispatch_order_id) {
    const { data: order } = await supabase
      .from('dispatch_orders')
      .select('driver_pay_cents, cities(name)')
      .eq('id', load.dispatch_order_id)
      .single()
    if (order) {
      payDollars = order.driver_pay_cents ? Math.round(order.driver_pay_cents / 100) : 20
      cityName = (order.cities as any)?.name || cityName
    }
  }

  // 4. Validate driver is active
  if (driver && driver.status !== 'active') {
    return NextResponse.json({ success: false, error: 'Driver is not active' }, { status: 400 })
  }

  // 5. Update load_request to approved
  const { error: updateError } = await supabase
    .from('load_requests')
    .update({ status: 'approved', reviewed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending')

  if (updateError) {
    return NextResponse.json({ success: false, error: updateError.message }, { status: 500 })
  }

  // 6. Generate secure token
  const rawToken = crypto.randomBytes(32).toString('hex')
  const tokenHash = hashToken(rawToken)

  // 7. Store token_hash in job_access_tokens (48h expiry)
  await supabase.from('job_access_tokens').insert({
    load_request_id: id,
    driver_id: load.driver_id,
    token_hash: tokenHash,
    expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
  })

  // 8. Create seeded job_tracking_sessions row
  await supabase.from('job_tracking_sessions').insert({
    load_request_id: id,
    driver_id: load.driver_id,
  })

  // 9. Create or upsert 6-digit job_completion_code with 24h expiry
  const code = makeCode()
  await supabase.from('job_completion_codes').upsert({
    load_request_id: id,
    code,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  }, { onConflict: 'load_request_id' })

  // 10. Write audit log
  await supabase.from('audit_logs').insert({
    action: 'job.approved_secure_link_issued',
    entity_type: 'load_request',
    entity_id: id,
    metadata: { driver_id: load.driver_id, city: cityName }
  })

  // 11. Send approval SMS with secure access URL — NO address
  let smsError = null
  if (driver?.phone) {
    const accessUrl = `${process.env.NEXT_PUBLIC_APP_URL}/job-access/${rawToken}`
    const result = await sendApprovalSMS(driver.phone, {
      accessUrl,
      loadId: id,
      payDollars,
      cityName,
    })
    if (!result.success) smsError = result.error
  } else {
    smsError = 'No phone number on file for driver'
  }

  // 12. Return success
  return NextResponse.json({
    success: true,
    completionCode: code,
    message: smsError
      ? `Approved but SMS failed: ${smsError}`
      : `✅ Approved! Secure job link sent to driver via SMS.`,
    smsError
  })
}
