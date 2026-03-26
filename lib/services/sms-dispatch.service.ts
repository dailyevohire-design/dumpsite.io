import { createAdminSupabase } from '../supabase'
import { sendAdminAlert } from '../sms'

/**
 * SMS Dispatch Service — handles advanced dispatch workflows:
 * - Re-dispatch to additional drivers
 * - Dispatch status tracking
 * - Job number generation (DS- prefix)
 */

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
