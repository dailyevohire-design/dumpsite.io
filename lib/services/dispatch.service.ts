import { createAdminSupabase } from '../supabase'
import { batchDispatchSMS, sendAdminAlert } from '../sms'

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
      status: 'dispatching'
    })
    .select()
    .single()

  if (orderError || !order) {
    console.error('Failed to create dispatch order:', orderError)
    return { success: false, driversNotified: 0, cityName: city.name, error: 'Failed to create order' }
  }

  const { data: drivers } = await supabase
    .from('driver_profiles')
    .select('user_id, first_name, phone, phone_verified, tiers(slug, dispatch_priority, notification_delay_minutes)')
    .eq('city_id', input.cityId)
    .eq('status', 'active')
    .eq('phone_verified', true)

  if (!drivers || drivers.length === 0) {
    await sendAdminAlert(
      `New order in ${city.name} - no drivers found. Check admin panel: ${process.env.NEXT_PUBLIC_APP_URL}/admin/dispatch`
    )
    return { success: true, dispatchId: order.id, driversNotified: 0, cityName: city.name, error: 'No drivers in this city yet' }
  }

  const haulDate = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

  const sorted = [...drivers].sort((a, b) => {
    const pa = (a.tiers as any)?.dispatch_priority || 4
    const pb = (b.tiers as any)?.dispatch_priority || 4
    return pa - pb
  })

  const dispatchDrivers = sorted.map(d => ({
    phone: d.phone,
    tierSlug: (d.tiers as any)?.slug || 'trial',
    dispatchId: order.id,
    cityName: city.name,
    yardsNeeded: input.yardsNeeded,
    haulDate
  }))

  const { sent, failed } = await batchDispatchSMS(dispatchDrivers)

  await supabase
    .from('dispatch_orders')
    .update({ drivers_notified: sent })
    .eq('id', order.id)

  await supabase.from('audit_logs').insert({
    action: 'dispatch_order.created',
    entity_type: 'dispatch_order',
    entity_id: order.id,
    metadata: { drivers_notified: sent, city: city.name }
  })

  return { success: true, dispatchId: order.id, driversNotified: sent, cityName: city.name }
}
