import { createAdminSupabase } from '../supabase'
import { sendApprovalSMS, sendRejectionSMS, sendAdminAlert } from '../sms'
import crypto from 'crypto'

const HIGH_REJECTION_MATERIALS = ['caliche']

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function makeCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

export async function submitLoadRequest(driverId: string, input: {
  siteId: string, dispatchOrderId?: string, dirtType: string,
  photoUrl: string, photoTakenAt?: string, locationText: string,
  truckType: string, truckCount: number, yardsEstimated: number,
  haulDate: string, idempotencyKey: string
}) {
  const supabase = createAdminSupabase()

  const { data: profile } = await supabase
    .from('driver_profiles')
    .select('trial_loads_used, tiers(slug, trial_load_limit)')
    .eq('user_id', driverId)
    .single()

  if (!profile) return { success: false, code: 'NO_PROFILE', message: 'Driver profile not found' }

  const tier = profile.tiers as any
  if (tier?.slug === 'trial' && tier?.trial_load_limit) {
    if (profile.trial_loads_used >= tier.trial_load_limit) {
      return { success: false, code: 'TRIAL_LIMIT_REACHED', message: `You've used all ${tier.trial_load_limit} free trial loads. Upgrade to keep earning.` }
    }
  }

  const { count: pendingCount } = await supabase
    .from('load_requests')
    .select('id', { count: 'exact', head: true })
    .eq('driver_id', driverId)
    .eq('status', 'pending')

  if ((pendingCount || 0) >= 5) {
    return { success: false, code: 'TOO_MANY_PENDING', message: 'You have 5 pending requests. Wait for approval before submitting more.' }
  }

  const requiresExtraReview = HIGH_REJECTION_MATERIALS.includes(input.dirtType)
  const trusted = await checkTrustedDriver(driverId, input.siteId)
  const autoApprove = trusted && !requiresExtraReview

  const { data: loadReq, error } = await supabase
    .from('load_requests')
    .upsert({
      idempotency_key: input.idempotencyKey,
      driver_id: driverId,
      site_id: input.siteId,
      dispatch_order_id: input.dispatchOrderId,
      dirt_type: input.dirtType,
      photo_url: input.photoUrl,
      photo_taken_at: input.photoTakenAt,
      location_text: input.locationText,
      truck_type: input.truckType,
      truck_count: input.truckCount,
      yards_estimated: input.yardsEstimated,
      haul_date: input.haulDate,
      status: autoApprove ? 'approved' : 'pending',
      requires_extra_review: requiresExtraReview,
      auto_approved: autoApprove
    }, { onConflict: 'idempotency_key' })
    .select()
    .single()

  if (error) {
    console.error('Load request error:', error)
    return { success: false, code: 'INSERT_FAILED', message: 'Failed to submit. Please try again.' }
  }

  if (tier?.slug === 'trial') {
    await supabase
      .from('driver_profiles')
      .update({ trial_loads_used: profile.trial_loads_used + 1 })
      .eq('user_id', driverId)
  }

  if (autoApprove) {
    await triggerApprovalFlow(loadReq.id, driverId)
    return { success: true, loadId: loadReq.id, status: 'approved', autoApproved: true, message: '✅ Approved! Check your SMS for a secure job link.' }
  }

  await sendAdminAlert(
    `New load request${requiresExtraReview ? ' ⚠️ CALICHE - needs extra review' : ''}. Review: ${process.env.NEXT_PUBLIC_APP_URL}/admin/approvals`
  )

  return {
    success: true, loadId: loadReq.id, status: 'pending', autoApproved: false,
    message: requiresExtraReview
      ? '⏳ Caliche requires manual review - usually within 2 hours.'
      : '⏳ Under review. You will get an SMS with a secure job link within 2 hours.'
  }
}

async function checkTrustedDriver(driverId: string, siteId: string): Promise<boolean> {
  const supabase = createAdminSupabase()

  const { data: profile } = await supabase
    .from('driver_profiles')
    .select('gps_score, rating')
    .eq('user_id', driverId)
    .single()

  if (!profile) return false

  const { count: completedAtSite } = await supabase
    .from('load_requests')
    .select('id', { count: 'exact', head: true })
    .eq('driver_id', driverId)
    .eq('site_id', siteId)
    .eq('status', 'completed')

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { count: recentRejections } = await supabase
    .from('load_requests')
    .select('id', { count: 'exact', head: true })
    .eq('driver_id', driverId)
    .eq('status', 'rejected')
    .gte('submitted_at', thirtyDaysAgo)

  return (
    (completedAtSite || 0) >= 1 &&
    (profile.gps_score || 0) >= 85 &&
    (profile.rating || 5) >= 4.0 &&
    (recentRejections || 0) === 0
  )
}

export async function triggerApprovalFlow(loadId: string, driverId: string) {
  const supabase = createAdminSupabase()

  const { data: profile } = await supabase
    .from('driver_profiles')
    .select('phone, first_name')
    .eq('user_id', driverId)
    .single()

  if (!profile) return

  // Get pay and city from load_request -> dispatch_order
  const { data: load } = await supabase
    .from('load_requests')
    .select('dispatch_order_id')
    .eq('id', loadId)
    .single()

  let payDollars = 20
  let cityName = 'DFW'

  if (load?.dispatch_order_id) {
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

  // Generate secure token + short ID for SMS-friendly URL
  const rawToken = crypto.randomBytes(32).toString('hex')
  const tokenHash = hashToken(rawToken)
  const shortId = crypto.randomBytes(6).toString('base64url').slice(0, 8)

  // Store token — try with short_id, fallback without
  let shortIdStored = false
  const { error: tokenErr } = await supabase.from('job_access_tokens').insert({
    load_request_id: loadId,
    driver_id: driverId,
    token_hash: tokenHash,
    short_id: shortId,
    expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
  })
  if (tokenErr) {
    await supabase.from('job_access_tokens').insert({
      load_request_id: loadId,
      driver_id: driverId,
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    })
  } else {
    shortIdStored = true
  }

  // Create tracking session
  await supabase.from('job_tracking_sessions').insert({
    load_request_id: loadId,
    driver_id: driverId,
  })

  // Create completion code
  const code = makeCode()
  await supabase.from('job_completion_codes').upsert({
    load_request_id: loadId,
    code,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  }, { onConflict: 'load_request_id' })

  // Send SMS with short URL — carrier-friendly
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dumpsite.io'
  const accessUrl = shortIdStored
    ? `${appUrl}/j/${shortId}`
    : `${appUrl}/job-access/${rawToken}`
  await sendApprovalSMS(profile.phone, {
    accessUrl,
    loadId,
    payDollars,
    cityName,
  })

  await supabase.from('audit_logs').insert({
    action: 'job.approved_secure_link_issued',
    entity_type: 'load_request',
    entity_id: loadId,
    metadata: { driver_id: driverId, city: cityName }
  })
}

export async function adminApproveLoad(loadId: string, adminUserId: string) {
  const supabase = createAdminSupabase()

  const { data, error } = await supabase
    .from('load_requests')
    .update({ status: 'approved', reviewed_by: adminUserId, reviewed_at: new Date().toISOString() })
    .eq('id', loadId)
    .eq('status', 'pending')
    .select('driver_id')
    .single()

  if (error || !data) return { success: false, message: 'Load already processed or not found' }

  await triggerApprovalFlow(loadId, data.driver_id)

  await supabase.from('audit_logs').insert({
    actor_id: adminUserId, action: 'load_request.approved',
    entity_type: 'load_request', entity_id: loadId
  })

  return { success: true, message: 'Approved. Secure job link sent to driver via SMS.' }
}

export async function adminRejectLoad(loadId: string, adminUserId: string, reason: string) {
  const supabase = createAdminSupabase()

  const { data, error } = await supabase
    .from('load_requests')
    .update({ status: 'rejected', reviewed_by: adminUserId, reviewed_at: new Date().toISOString(), rejected_reason: reason })
    .eq('id', loadId)
    .eq('status', 'pending')
    .select('driver_id')
    .single()

  if (error || !data) return { success: false, message: 'Load already processed or not found' }

  const { data: profile } = await supabase
    .from('driver_profiles')
    .select('phone')
    .eq('user_id', data.driver_id)
    .single()

  if (profile?.phone) {
    await sendRejectionSMS(profile.phone, { reason, loadId })
  }

  await supabase.from('audit_logs').insert({
    actor_id: adminUserId, action: 'load_request.rejected',
    entity_type: 'load_request', entity_id: loadId,
    metadata: { reason }
  })

  return { success: true, message: 'Rejected. Driver notified via SMS.' }
}
