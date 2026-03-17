import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import twilio from 'twilio'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params

  // Step 1: Get the load request by id
  const { data: load, error: loadError } = await supabase
    .from('load_requests')
    .select('id, driver_id, dispatch_order_id, status')
    .eq('id', id)
    .single()

  if (loadError || !load) {
    return NextResponse.json({ error: `Load not found: ${loadError?.message}` }, { status: 404 })
  }

  // Step 2: Get driver profile separately
  const { data: driver } = await supabase
    .from('driver_profiles')
    .select('user_id, first_name, phone')
    .eq('user_id', load.driver_id)
    .single()

  // Step 3: Get dispatch order separately
  const { data: order } = await supabase
    .from('dispatch_orders')
    .select('id, client_address, city_id, cities(name)')
    .eq('id', load.dispatch_order_id)
    .single()

  // Step 4: Update status to approved
  const { error: updateError } = await supabase
    .from('load_requests')
    .update({ status: 'approved' })
    .eq('id', id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  // Step 5: Send SMS
  const phone = driver?.phone
  const firstName = driver?.first_name || 'Driver'
  const address = order?.client_address || 'See dashboard'
  const city = (order?.cities as any)?.name || ''

  if (phone) {
    try {
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
      let normalizedPhone = phone.replace(/\D/g, '')
      if (normalizedPhone.length === 10) normalizedPhone = '1' + normalizedPhone
      if (!normalizedPhone.startsWith('+')) normalizedPhone = '+' + normalizedPhone
      await client.messages.create({
        body: `Hi ${firstName}! Your DumpSite.io load has been approved. Delivery address: ${address}${city ? ', ' + city : ''}. Drive safe! - DumpSite.io`,
        from: process.env.TWILIO_FROM_NUMBER!,
        to: normalizedPhone
      })
    } catch (smsError: any) {
      return NextResponse.json({ success: true, smsError: smsError.message })
    }
  } else {
    return NextResponse.json({ success: true, smsError: 'No phone number on file for driver' })
  }

  return NextResponse.json({ success: true })
}
