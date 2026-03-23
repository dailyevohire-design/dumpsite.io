import { createAdminSupabase } from '../supabase'
import { batchDispatchSMS, sendAdminAlert } from '../sms'
import { CITY_COORDS } from '../city-coords'

export interface CreateDispatchInput {
  clientName: string
  clientPhone?: string
  clientAddress: string
  cityId: string
  yardsNeeded: number
  priceQuotedCents: number
  truckTypeNeeded?: string
  notes?: string
  urgency?: 'standard' | 'urgent'
  source?: 'manual' | 'zapier' | 'web_form'
  zapierRowId?: string
  createdBy?: string
}

export async function createDispatchOrder(input: CreateDispatchInput) {
  const supabase = createAdminSupabase()

  if (input.zapierRowId) {
    const { data: existing } = await supabase
      .from('dispatch_orders')
      .select('id')
      .eq('zapier_row_id', input.zapierRowId)
      .maybeSingle()
    if (existing) {
      return { success: true, dispatchId: existing.id, driversNotified: 0, cityName: '', duplicate: true }
    }
  }

  const { data: city } = await supabase
    .from('cities')
    .select('id, name')
    .eq('id', input.cityId)
    .single()

  if (!city) return { success: false, driversNotified: 0, cityName: '', error: 'City not found' }

  // Resolve delivery coordinates — city center as fallback
  const cityCoords = CITY_COORDS[city.name]

  const { data: order, error: orderError } = await supabase
    .from('dispatch_orders')
    .insert({
      client_name: input.clientName,
      client_phone: input.clientPhone,
      client_address: input.clientAddress,
      city_id: input.cityId,
      yards_needed: input.yardsNeeded,
      price_quoted_cents: input.priceQuotedCents,
      truck_type_needed: input.truckTypeNeeded,
      notes: input.notes,
      urgency: input.urgency || 'standard',
      source: input.source || 'manual',
      zapier_row_id: input.zapierRowId,
      created_by: input.createdBy,
      status: 'dispatching',
      delivery_latitude: cityCoords?.lat || null,
      delivery_longitude: cityCoords?.lng || null,
    })
    .select()
    .single()

  if (orderError || !order) {
    console.error('Failed to create dispatch order:', orderError)
    return { success: false, driversNotified: 0, cityName: city.name, error: 'Failed to create order' }
  }

  // Limit drivers per city to prevent unbounded SMS dispatch
  const { data: drivers } = await supabase
    .from('driver_profiles')
    .select('user_id, first_name, phone, phone_verified, tiers(slug, dispatch_priority, notification_delay_minutes)')
    .eq('city_id', input.cityId)
    .eq('status', 'active')
    .eq('phone_verified', true)
    .limit(500)

  if (!drivers || drivers.length === 0) {
    await sendAdminAlert(
      `New order in ${city.name} - no drivers found. Check admin panel: ${process.env.NEXT_PUBLIC_APP_URL}/admin/dispatch`
    )
    return { success: true, dispatchId: order.id, driversNotified: 0, cityName: city.name, error: 'No drivers in this city yet' }
  }

  const haulDate = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

  // Group drivers by tier for tiered dispatch
  const tierCounts = { elite: 0, pro: 0, hauler: 0, trial: 0 }
  const dispatchDrivers = drivers.map(d => {
    const tierSlug = (d.tiers as any)?.slug || 'trial'
    if (tierSlug in tierCounts) tierCounts[tierSlug as keyof typeof tierCounts]++
    return {
      phone: d.phone,
      tierSlug,
      dispatchId: order.id,
      cityName: city.name,
      yardsNeeded: input.yardsNeeded,
      payDollars: input.priceQuotedCents ? Math.round(input.priceQuotedCents / 100) : 20,
      haulDate
    }
  })

  const { sent, failed } = await batchDispatchSMS(dispatchDrivers)

  // Update with tier-specific counts (columns may not exist yet — graceful fallback)
  const tierUpdate: Record<string, any> = { drivers_notified: sent }
  tierUpdate.elite_notified_count = tierCounts.elite
  tierUpdate.pro_notified_count = tierCounts.pro
  tierUpdate.hauler_notified_count = tierCounts.hauler
  tierUpdate.trial_notified_count = tierCounts.trial

  const { error: tierErr } = await supabase.from('dispatch_orders').update(tierUpdate).eq('id', order.id)
  if (tierErr) {
    // Fallback if tier columns don't exist yet
    await supabase.from('dispatch_orders').update({ drivers_notified: sent }).eq('id', order.id)
  }

  // Send push notifications to drivers in this city
  try {
    const { sendPushToCity } = await import('../push-notifications')
    const payDollars = input.priceQuotedCents ? Math.round(input.priceQuotedCents / 100) : 20
    await sendPushToCity(
      input.cityId,
      `New Job in ${city.name}`,
      `$${payDollars}/load · ${input.yardsNeeded} yards needed`,
      'https://dumpsite.io/dashboard'
    )
  } catch {}

  await supabase.from('audit_logs').insert({
    action: 'dispatch_order.created',
    entity_type: 'dispatch_order',
    entity_id: order.id,
    metadata: { drivers_notified: sent, city: city.name, tier_counts: tierCounts }
  })

  return { success: true, dispatchId: order.id, driversNotified: sent, cityName: city.name }
}
