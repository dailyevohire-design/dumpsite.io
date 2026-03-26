import { createAdminSupabase } from '../supabase'
import { sendAdminAlert } from '../sms'

/**
 * SMS Dispatch Service — handles advanced dispatch workflows:
 * - Re-dispatch to additional drivers
 * - Dispatch status tracking
 * - Job number generation (DS- prefix)
 * - Inbound SMS handling (status, done, cancel, free-text requests)
 */

interface IncomingSMS {
  from: string
  body: string
  messageSid: string
}

export function generateJobNumber(dispatchId: string): string {
  // Use first 6 chars of UUID for human-readable job number
  const short = dispatchId.replace(/-/g, '').slice(0, 6).toUpperCase()
  return `DS-${short}`
}

export interface DispatchStatus {
  dispatchId: string
  jobNumber: string
  status: string
  driversNotified: number
  driversAccepted: number
  cityName: string
  createdAt: string
}

export async function getDispatchStatus(dispatchId: string): Promise<{ success: boolean; data?: DispatchStatus; error?: string }> {
  const supabase = createAdminSupabase()

  const { data: order, error } = await supabase
    .from('dispatch_orders')
    .select('id, status, drivers_notified, city_id, created_at, cities(name)')
    .eq('id', dispatchId)
    .single()

  if (error || !order) {
    return { success: false, error: 'Dispatch order not found' }
  }

  const { count: acceptedCount } = await supabase
    .from('load_requests')
    .select('id', { count: 'exact', head: true })
    .eq('dispatch_order_id', dispatchId)
    .in('status', ['approved', 'completed'])

  return {
    success: true,
    data: {
      dispatchId: order.id,
      jobNumber: generateJobNumber(order.id),
      status: order.status,
      driversNotified: order.drivers_notified || 0,
      driversAccepted: acceptedCount || 0,
      cityName: (order.cities as any)?.name || 'Unknown',
      createdAt: order.created_at,
    },
  }
}

export async function redispatchOrder(dispatchId: string, adminUserId: string): Promise<{ success: boolean; driversNotified?: number; error?: string }> {
  const supabase = createAdminSupabase()

  const { data: order, error: orderErr } = await supabase
    .from('dispatch_orders')
    .select('id, city_id, yards_needed, driver_pay_cents, status, cities(name)')
    .eq('id', dispatchId)
    .single()

  if (orderErr || !order) {
    return { success: false, error: 'Dispatch order not found' }
  }

  if (order.status === 'completed' || order.status === 'cancelled') {
    return { success: false, error: `Cannot re-dispatch a ${order.status} order` }
  }

  // Find drivers who were NOT already notified for this dispatch
  const { data: alreadyNotified } = await supabase
    .from('sms_log')
    .select('to_phone')
    .eq('related_id', dispatchId)
    .eq('message_type', 'dispatch')

  const notifiedPhones = new Set((alreadyNotified || []).map(s => s.to_phone))

  const { data: drivers } = await supabase
    .from('driver_profiles')
    .select('user_id, phone, phone_verified, tiers(slug, dispatch_priority)')
    .eq('city_id', order.city_id)
    .eq('status', 'active')
    .eq('phone_verified', true)
    .limit(500)

  if (!drivers || drivers.length === 0) {
    return { success: false, error: 'No active drivers in this city' }
  }

  const newDrivers = drivers.filter(d => !notifiedPhones.has(d.phone))
  if (newDrivers.length === 0) {
    return { success: false, error: 'All drivers in this city have already been notified' }
  }

  const { batchDispatchSMS } = await import('../sms')
  const haulDate = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const cityName = (order.cities as any)?.name || 'DFW'
  const payDollars = order.driver_pay_cents ? Math.round(order.driver_pay_cents / 100) : 35

  const dispatchDrivers = newDrivers.map(d => ({
    phone: d.phone,
    tierSlug: (d.tiers as any)?.slug || 'trial',
    dispatchId: order.id,
    cityName,
    yardsNeeded: order.yards_needed,
    payDollars,
    haulDate,
  }))

  const { sent, failed } = await batchDispatchSMS(dispatchDrivers)

  // Update total notified count
  await supabase
    .from('dispatch_orders')
    .update({
      drivers_notified: (order as any).drivers_notified ? (order as any).drivers_notified + sent : sent,
      status: 'dispatching',
    })
    .eq('id', dispatchId)

  await supabase.from('audit_logs').insert({
    actor_id: adminUserId,
    action: 'dispatch_order.redispatched',
    entity_type: 'dispatch_order',
    entity_id: dispatchId,
    metadata: { new_drivers_notified: sent, failed, city: cityName },
  })

  try {
    await sendAdminAlert(`Re-dispatch ${generateJobNumber(dispatchId)}: ${sent} new drivers notified in ${cityName}`)
  } catch {}

  return { success: true, driversNotified: sent }
}

export async function cancelDispatch(dispatchId: string, adminUserId: string, reason: string): Promise<{ success: boolean; error?: string }> {
  const supabase = createAdminSupabase()

  const { data: order, error } = await supabase
    .from('dispatch_orders')
    .update({ status: 'cancelled' })
    .eq('id', dispatchId)
    .not('status', 'eq', 'completed')
    .select('id, cities(name)')
    .single()

  if (error || !order) {
    return { success: false, error: 'Order not found or already completed' }
  }

  await supabase.from('audit_logs').insert({
    actor_id: adminUserId,
    action: 'dispatch_order.cancelled',
    entity_type: 'dispatch_order',
    entity_id: dispatchId,
    metadata: { reason, city: (order.cities as any)?.name },
  })

  return { success: true }
}

async function handleStatusRequest(phone: string): Promise<string> {
  const supabase = createAdminSupabase()

  const { data: profile } = await supabase
    .from('driver_profiles')
    .select('user_id, first_name')
    .eq('phone', phone)
    .maybeSingle()

  if (!profile) {
    return 'No driver account found for this number. Sign up at dumpsite.io'
  }

  const { data: activeLoad } = await supabase
    .from('load_requests')
    .select('id, status, dispatch_order_id, yards_estimated, dispatch_orders(status, cities(name))')
    .eq('driver_id', profile.user_id)
    .in('status', ['pending', 'approved'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!activeLoad) {
    return `Hi ${profile.first_name || 'Driver'}! No active jobs right now. Visit dumpsite.io/dashboard to find available jobs.`
  }

  const cityName = (activeLoad.dispatch_orders as any)?.cities?.name || 'DFW'
  const jobNumber = generateJobNumber(activeLoad.dispatch_order_id)

  if (activeLoad.status === 'pending') {
    return `Hi ${profile.first_name}! Job ${jobNumber} in ${cityName} is pending approval. You'll get an SMS with the address once approved.`
  }

  return `Hi ${profile.first_name}! Job ${jobNumber} in ${cityName} is approved. ${activeLoad.yards_estimated || 0} yards. Reply DONE when complete or CANCEL to cancel.`
}

async function handleDoneRequest(phone: string, body: string): Promise<string> {
  const supabase = createAdminSupabase()

  const { data: profile } = await supabase
    .from('driver_profiles')
    .select('user_id, first_name')
    .eq('phone', phone)
    .maybeSingle()

  if (!profile) {
    return 'No driver account found for this number. Sign up at dumpsite.io'
  }

  const { data: activeLoad } = await supabase
    .from('load_requests')
    .select('id, dispatch_order_id, yards_estimated, dispatch_orders(driver_pay_cents, cities(name))')
    .eq('driver_id', profile.user_id)
    .eq('status', 'approved')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!activeLoad) {
    return 'No active approved job found. Visit dumpsite.io/dashboard to check your jobs.'
  }

  // Parse load count from message like "done 3" or "complete 5 loads"
  const loadMatch = body.match(/(\d+)/)
  const loadsDelivered = loadMatch ? Math.min(parseInt(loadMatch[1], 10), 50) : 1

  const payPerLoad = (activeLoad.dispatch_orders as any)?.driver_pay_cents || 3500
  const totalPayCents = payPerLoad * loadsDelivered
  const totalPayDollars = Math.round(totalPayCents / 100)
  const jobNumber = generateJobNumber(activeLoad.dispatch_order_id)
  const cityName = (activeLoad.dispatch_orders as any)?.cities?.name || 'DFW'

  // Mark load as completed
  await supabase
    .from('load_requests')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      payout_cents: totalPayCents,
      truck_count: loadsDelivered,
    })
    .eq('id', activeLoad.id)

  // Create payment record
  await supabase.from('driver_payments').insert({
    driver_id: profile.user_id,
    load_request_id: activeLoad.id,
    amount_cents: totalPayCents,
    status: 'pending',
  })

  try {
    await sendAdminAlert(
      `Job ${jobNumber} completed via SMS by ${profile.first_name || 'driver'} in ${cityName}. ${loadsDelivered} load(s), $${totalPayDollars} payout pending.`
    )
  } catch {}

  return `Job ${jobNumber} marked complete! ${loadsDelivered} load(s) delivered — $${totalPayDollars} payout pending. Upload completion photo at dumpsite.io/dashboard for faster processing.`
}

async function handleCancelRequest(phone: string): Promise<string> {
  const supabase = createAdminSupabase()

  const { data: profile } = await supabase
    .from('driver_profiles')
    .select('user_id, first_name')
    .eq('phone', phone)
    .maybeSingle()

  if (!profile) {
    return 'No driver account found for this number. Sign up at dumpsite.io'
  }

  const { data: activeLoad } = await supabase
    .from('load_requests')
    .select('id, dispatch_order_id, status, dispatch_orders(cities(name))')
    .eq('driver_id', profile.user_id)
    .in('status', ['pending', 'approved'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!activeLoad) {
    return 'No active job to cancel. Visit dumpsite.io/dashboard to view your jobs.'
  }

  const jobNumber = generateJobNumber(activeLoad.dispatch_order_id)
  const cityName = (activeLoad.dispatch_orders as any)?.cities?.name || 'DFW'

  await supabase
    .from('load_requests')
    .update({
      status: 'rejected',
      rejected_reason: 'Cancelled by driver via SMS',
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', activeLoad.id)

  try {
    await sendAdminAlert(
      `Job ${jobNumber} cancelled via SMS by ${profile.first_name || 'driver'} in ${cityName}.`
    )
  } catch {}

  return `Job ${jobNumber} in ${cityName} has been cancelled. Visit dumpsite.io/dashboard for other available jobs.`
}

async function handleFreeTextRequest(phone: string, body: string): Promise<string> {
  const supabase = createAdminSupabase()

  const { data: profile } = await supabase
    .from('driver_profiles')
    .select('user_id, first_name, city_id, cities(name)')
    .eq('phone', phone)
    .maybeSingle()

  if (!profile) {
    return 'No driver account found for this number. Sign up at dumpsite.io to get started.'
  }

  // Check if driver already has an active job
  const { data: existingLoad } = await supabase
    .from('load_requests')
    .select('id')
    .eq('driver_id', profile.user_id)
    .in('status', ['pending', 'approved'])
    .limit(1)
    .maybeSingle()

  if (existingLoad) {
    return 'You already have an active job. Reply STATUS to check it, DONE when complete, or CANCEL to cancel first.'
  }

  // Try to parse city, material, yards from free text
  // e.g. "Fort Worth, clean fill, 200 yards"
  const yardsMatch = body.match(/(\d+)\s*(?:yards?|yds?|cubic)/i)
  const yards = yardsMatch ? parseInt(yardsMatch[1], 10) : null

  // Look for available dispatch orders in their city
  const { data: availableJobs } = await supabase
    .from('dispatch_orders')
    .select('id, yards_needed, driver_pay_cents, cities(name)')
    .eq('city_id', profile.city_id)
    .in('status', ['dispatching', 'active'])
    .order('created_at', { ascending: false })
    .limit(3)

  if (!availableJobs || availableJobs.length === 0) {
    return `No available jobs in ${(profile.cities as any)?.name || 'your area'} right now. We'll text you when new jobs come in. Check dumpsite.io/dashboard for updates.`
  }

  const job = availableJobs[0]
  const jobNumber = generateJobNumber(job.id)
  const payDollars = job.driver_pay_cents ? Math.round(job.driver_pay_cents / 100) : 35
  const cityName = (job.cities as any)?.name || 'DFW'

  return `${profile.first_name}, we have a job in ${cityName}: ${job.yards_needed || '?'} yards at $${payDollars}/load (${jobNumber}). Reply YES to claim it or visit dumpsite.io/dashboard for more details.`
}

async function handleIncoming(sms: IncomingSMS): Promise<string> {
  const bodyLower = sms.body.toLowerCase().trim()

  if (bodyLower === 'status' || bodyLower === 'job') {
    return handleStatusRequest(sms.from)
  }

  if (
    bodyLower.startsWith('done') ||
    bodyLower.startsWith('complete') ||
    bodyLower.startsWith('finished')
  ) {
    return handleDoneRequest(sms.from, sms.body)
  }

  if (bodyLower === 'cancel' || bodyLower === 'stop job') {
    return handleCancelRequest(sms.from)
  }

  // Free-text — try to match to available jobs
  return handleFreeTextRequest(sms.from, sms.body)
}

export const smsDispatchService = {
  handleIncoming,
  generateJobNumber,
  getDispatchStatus,
  redispatchOrder,
  cancelDispatch,
}
