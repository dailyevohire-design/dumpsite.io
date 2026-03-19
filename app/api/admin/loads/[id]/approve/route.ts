import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { sendApprovalSMS } from '@/lib/sms'

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const supabase = createAdminSupabase()

  // Get load — only process if still pending (race condition protection)
  const { data: load, error: loadError } = await supabase
    .from('load_requests')
    .select('id, driver_id, dispatch_order_id, status')
    .eq('id', id)
    .eq('status', 'pending')
    .single()

  if (loadError || !load) {
    return NextResponse.json({ success: false, error: 'Load not found or already processed' }, { status: 404 })
  }

  // Get driver profile
  const { data: driver } = await supabase
    .from('driver_profiles')
    .select('user_id, first_name, phone')
    .eq('user_id', load.driver_id)
    .single()

  // Get dispatch order + address
  let address = 'Contact dispatch for address'
  let payDollars = 20
  let cityName = 'DFW'

  if (load.dispatch_order_id) {
    const { data: order } = await supabase
      .from('dispatch_orders')
      .select('client_address, driver_pay_cents, cities(name)')
      .eq('id', load.dispatch_order_id)
      .single()
    if (order) {
      address = order.client_address || address
      payDollars = order.driver_pay_cents ? Math.round(order.driver_pay_cents / 100) : 20
      cityName = (order.cities as any)?.name || cityName
    }
  }

  // Mark approved
  const { error: updateError } = await supabase
    .from('load_requests')
    .update({ status: 'approved', reviewed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending')

  if (updateError) {
    return NextResponse.json({ success: false, error: updateError.message }, { status: 500 })
  }

  // Log address release
  await supabase.from('audit_logs').insert({
    action: 'address.released',
    entity_type: 'load_request',
    entity_id: id,
    metadata: { driver_id: load.driver_id, city: cityName }
  })

  // Send SMS using our lib (no twilio npm package — uses fetch)
  let smsError = null
  if (driver?.phone) {
    const result = await sendApprovalSMS(driver.phone, {
      plainAddress: address,
      gateCode: null,
      accessInstructions: `Delivery job in ${cityName}. Call dispatch if you have questions.`,
      loadId: id,
      payDollars
    })
    if (!result.success) smsError = result.error
  } else {
    smsError = 'No phone number on file for driver'
  }

  return NextResponse.json({
    success: true,
    message: smsError
      ? `Approved but SMS failed: ${smsError}`
      : `✅ Approved! SMS sent to driver with delivery address.`,
    smsError
  })
}
