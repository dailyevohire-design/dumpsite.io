import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import twilio from 'twilio'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { id } = params

  // Get the load request with driver phone and dispatch order address
  const { data: load, error: loadError } = await supabase
    .from('load_requests')
    .select('*, driver_profiles(phone_number, first_name), dispatch_orders(client_address, cities(name))')
    .eq('id', id)
    .single()

  if (loadError || !load) {
    return NextResponse.json({ error: 'Load not found' }, { status: 404 })
  }

  // Update status to approved
  const { error: updateError } = await supabase
    .from('load_requests')
    .update({ status: 'approved' })
    .eq('id', id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  // Send SMS to driver
  const phone = load.driver_profiles?.phone_number
  const firstName = load.driver_profiles?.first_name || 'Driver'
  const address = load.dispatch_orders?.client_address || 'See dashboard for details'
  const city = load.dispatch_orders?.cities?.name || ''

  if (phone) {
    try {
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
      
      // Normalize phone number - add +1 if not present
      let normalizedPhone = phone.replace(/\D/g, '')
      if (normalizedPhone.length === 10) normalizedPhone = '1' + normalizedPhone
      if (!normalizedPhone.startsWith('+')) normalizedPhone = '+' + normalizedPhone

      await client.messages.create({
        body: `Hi ${firstName}! Your DumpSite.io load request has been approved. Delivery address: ${address}${city ? ', ' + city : ''}. Drive safe and get paid! - DumpSite.io`,
        from: process.env.TWILIO_FROM_NUMBER!,
        to: normalizedPhone
      })
    } catch (smsError: any) {
      console.error('SMS failed:', smsError.message)
      // Still return success - status was updated, just SMS failed
      return NextResponse.json({ success: true, smsError: smsError.message })
    }
  }

  return NextResponse.json({ success: true })
}
