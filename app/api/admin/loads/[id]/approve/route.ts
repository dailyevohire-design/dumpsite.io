import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { requireAdmin } from '@/lib/admin-auth'
import { sendApprovalSMS } from '@/lib/sms'
import { sendApprovalEmail } from '@/lib/email'
import { rateLimit } from '@/lib/rate-limit'
import { createNotification } from '@/lib/notifications'
import crypto from 'crypto'

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

// Generate short 8-char alphanumeric ID for SMS-friendly URLs
function makeShortId(): string {
  return crypto.randomBytes(6).toString('base64url').slice(0, 8)
}

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const rl = await rateLimit(`approve:${auth.user.id}`, 50, '1 h')
  if (!rl.allowed) return rl.response!

  const { id } = await context.params
  const supabase = createAdminSupabase()
  const errors: string[] = []

  // 1. Load pending load_request
  const { data: load, error: loadError } = await supabase
    .from('load_requests')
    .select('id, driver_id, dispatch_order_id, status')
    .eq('id', id)
    .eq('status', 'pending')
    .single()

  if (loadError || !load) {
    return NextResponse.json({ success: false, error: 'Load not found or already processed' }, { status: 404 })
  }

  // 2. Load driver profile + get email from auth
  const { data: driver, error: driverError } = await supabase
    .from('driver_profiles')
    .select('user_id, first_name, phone, status')
    .eq('user_id', load.driver_id)
    .single()

  // Get driver email from auth.users
  let driverEmail: string | null = null
  try {
    const { data: authData } = await supabase.auth.admin.getUserById(load.driver_id)
    driverEmail = authData?.user?.email || null
  } catch {}

  if (driverError || !driver) {
    errors.push(`Driver profile not found: ${driverError?.message || 'null'}`)
  }

  // 3. Load pay + city
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
    return NextResponse.json({ success: false, error: `Driver status is "${driver.status}" — must be active` }, { status: 400 })
  }

  // 5. Update load_request to approved
  const { error: updateError } = await supabase
    .from('load_requests')
    .update({ status: 'approved', reviewed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending')

  if (updateError) {
    console.error('[approve] DB update failed:', updateError.code)
    return NextResponse.json({ success: false, error: 'Failed to approve load. Please try again.' }, { status: 500 })
  }

  // 6. Generate secure token + short ID for SMS-friendly URL
  const rawToken = crypto.randomBytes(32).toString('hex')
  const tokenHash = hashToken(rawToken)
  const shortId = makeShortId()

  // 7. Store token — try with short_id, fallback without if column doesn't exist yet
  let shortIdStored = false
  const { error: tokenErr } = await supabase.from('job_access_tokens').insert({
    load_request_id: id,
    driver_id: load.driver_id,
    token_hash: tokenHash,
    short_id: shortId,
    expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
  })
  if (tokenErr) {
    // Retry without short_id in case column doesn't exist yet
    const { error: tokenErr2 } = await supabase.from('job_access_tokens').insert({
      load_request_id: id,
      driver_id: load.driver_id,
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    })
    if (tokenErr2) errors.push('job_access_tokens: insert failed')
  } else {
    shortIdStored = true
  }

  // 8. Create tracking session
  const { error: sessionErr } = await supabase.from('job_tracking_sessions').insert({
    load_request_id: id,
    driver_id: load.driver_id,
  })
  if (sessionErr) errors.push('job_tracking_sessions: insert failed')

  // 9. Audit log
  const { error: auditErr } = await supabase.from('audit_logs').insert({
    action: 'job.approved_secure_link_issued',
    entity_type: 'load_request',
    entity_id: id,
    metadata: { driver_id: load.driver_id, city: cityName }
  })
  if (auditErr) errors.push('audit_logs: insert failed')

  // 11. Send SMS with SHORT URL
  let smsError: string | null = null
  let smsSent = false

  if (!driver?.phone) {
    smsError = 'No phone number on file for driver'
  } else {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dumpsite.io'
    // Use short URL if short_id was stored, otherwise fall back to full token
    const accessUrl = shortIdStored
      ? `${appUrl}/j/${shortId}`
      : `${appUrl}/job-access/${rawToken}`

    try {
      const result = await sendApprovalSMS(driver.phone, {
        accessUrl,
        loadId: id,
        payDollars,
        cityName,
      })
      if (result.success) {
        smsSent = true
      } else {
        smsError = result.error || 'SMS send returned failure'
      }
    } catch (e: any) {
      console.error('[approve] SMS exception:', e.message)
      smsError = 'SMS send failed'
    }
  }

  // 12. Email fallback — always send, ensures driver gets the link even if SMS is carrier-blocked
  let emailSent = false
  if (driverEmail) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dumpsite.io'
    const accessUrl = shortIdStored
      ? `${appUrl}/j/${shortId}`
      : `${appUrl}/job-access/${rawToken}`
    try {
      const emailResult = await sendApprovalEmail({
        to: driverEmail,
        driverName: driver?.first_name || 'Driver',
        cityName,
        payDollars,
        accessUrl,
        loadId: id,
      })
      if (emailResult.success) emailSent = true
    } catch {}
  }

  // Create in-app notification for driver
  try {
    await createNotification(load.driver_id, {
      type: 'job_approved',
      title: 'Job Approved!',
      message: `Your ${cityName} job ($${payDollars}/load) has been approved. Check your SMS for the secure link.`,
      actionUrl: '/dashboard',
    })
  } catch {}

  const hasDbErrors = errors.length > 0

  const notified = smsSent || emailSent
  let message = ''
  if (smsSent && emailSent) {
    message = `✅ Approved! Job link sent via SMS (${driver?.phone}) and email (${driverEmail}).`
  } else if (smsSent) {
    message = `✅ Approved! Job link sent via SMS to ${driver?.phone}.`
  } else if (emailSent) {
    message = `✅ Approved! SMS failed (carrier blocked) — job link sent via email to ${driverEmail}.`
  } else {
    message = `⚠️ Approved but notification failed. SMS: ${smsError}. Email: ${driverEmail ? 'failed' : 'no email on file'}.`
  }

  return NextResponse.json({
    success: true,
    smsSent,
    emailSent,
    smsError,
    driverPhone: driver?.phone || null,
    driverEmail,
    dbErrors: hasDbErrors ? errors : undefined,
    message,
  })
}
