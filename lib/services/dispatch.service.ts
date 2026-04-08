import { createAdminSupabase } from '../supabase'
import { batchDispatchSMS, sendAdminAlert } from '../sms'
import { CITY_COORDS } from '../city-coords'
import { getDriverPayCents } from '../driver-pay-rates'

export interface CreateDispatchInput {
  clientName: string
  clientPhone?: string
  clientAddress: string
  cityId: string
  yardsNeeded: number
  priceQuotedCents: number
  driverPayCents?: number // Ignored — driver pay is ALWAYS calculated from city rate
  truckTypeNeeded?: string
  notes?: string
  urgency?: 'standard' | 'urgent'
  source?: 'manual' | 'zapier' | 'web_form'
  zapierRowId?: string
  createdBy?: string
  agentId?: string | null      // Sales agent attribution (multi-number tracking)
  sourceNumber?: string | null // Twilio number the customer texted
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

  // Try to fetch with driver pay column; fall back to without if column doesn't exist yet
  let city: { id: string; name: string; default_driver_pay_cents?: number } | null = null
  const { data: cityWithPay, error: cityErr } = await supabase
    .from('cities')
    .select('id, name, default_driver_pay_cents')
    .eq('id', input.cityId)
    .single()

  if (cityErr?.message?.includes('default_driver_pay_cents')) {
    // Column doesn't exist yet — fetch without it
    const { data: cityBasic } = await supabase
      .from('cities')
      .select('id, name')
      .eq('id', input.cityId)
      .single()
    city = cityBasic ? { ...cityBasic, default_driver_pay_cents: undefined } : null
  } else {
    city = cityWithPay
  }

  if (!city) return { success: false, driversNotified: 0, cityName: '', error: 'City not found' }

  // Resolve delivery coordinates — geocode actual address, city center as fallback
  const cityCoords = CITY_COORDS[city.name]
  let deliveryLat = cityCoords?.lat || null
  let deliveryLng = cityCoords?.lng || null

  // Geocode the actual client address for precise distance matching
  if (input.clientAddress) {
    try {
      const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY
      if (GOOGLE_MAPS_KEY) {
        const addr = input.clientAddress.includes('TX') || input.clientAddress.includes('Texas')
          ? input.clientAddress : `${input.clientAddress}, Texas, USA`
        const q = encodeURIComponent(addr)
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${q}&key=${GOOGLE_MAPS_KEY}&components=country:US`
        const r = await fetch(url)
        const data = await r.json()
        if (data.status === 'OK' && data.results?.[0]) {
          deliveryLat = data.results[0].geometry.location.lat
          deliveryLng = data.results[0].geometry.location.lng
        }
      }
    } catch (e) {
      console.error('[dispatch] geocode error:', e)
    }
  }

  // PERMANENT FIX: Driver pay is ALWAYS determined by city rate.
  // Never use the customer quote or admin input — prevents showing
  // company revenue to drivers. DB column overrides config fallback.
  const driverPayCents = getDriverPayCents(city.name, city.default_driver_pay_cents)

  const { data: order, error: orderError } = await supabase
    .from('dispatch_orders')
    .insert({
      client_name: input.clientName,
      client_phone: input.clientPhone,
      client_address: input.clientAddress,
      city_id: input.cityId,
      yards_needed: input.yardsNeeded,
      price_quoted_cents: input.priceQuotedCents,
      driver_pay_cents: driverPayCents,
      truck_type_needed: input.truckTypeNeeded,
      notes: input.notes,
      urgency: input.urgency || 'standard',
      source: input.source || 'manual',
      zapier_row_id: input.zapierRowId,
      created_by: input.createdBy,
      status: 'dispatching',
      delivery_latitude: deliveryLat,
      delivery_longitude: deliveryLng,
      // Optional sales-agent attribution columns; the migration in
      // migrations/2026-04-07_dispatch_agent_attribution.sql adds them.
      ...(input.agentId ? { agent_id: input.agentId } : {}),
      ...(input.sourceNumber ? { source_number: input.sourceNumber } : {}),
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
      payDollars: order.driver_pay_cents ? Math.round(order.driver_pay_cents / 100) : 35,
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
    const payDollars = order.driver_pay_cents ? Math.round(order.driver_pay_cents / 100) : 35
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
