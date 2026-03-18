import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params

  const { data: load, error: loadError } = await supabase
    .from('load_requests')
    .select('id, driver_id, dispatch_order_id, status')
    .eq('id', id)
    .single()

  if (loadError || !load) {
    return NextResponse.json({ error: 'Load not found' }, { status: 404 })
  }

  const { data: driver } = await supabase
    .from('driver_profiles')
    .select('user_id, first_name, phone')
    .eq('user_id', load.driver_id)
    .single()

  const { data: order } = await supabase
    .from('dispatch_orders')
    .select('id, client_address, cities(name)')
    .eq('id', load.dispatch_order_id)
    .single()

  await supabase.from('load_requests').update({ status: 'approved' }).eq('id', id)

  const phone = driver?.phone
  const firstName = driver?.first_name || 'Driver'
  const address = order?.client_address || 'See dashboard'
  const city = (order?.cities as any)?.name || ''

  if (phone) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID!
    const apiKey = process.env.TWILIO_API_KEY!
    const apiSecret = process.env.TWILIO_API_SECRET!
    let p = phone.replace(/\D/g, '')
    if (p.length === 10) p = '1' + p
    if (!p.startsWith('+')) p = '+' + p
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${apiKey}:${apiSecret}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: p,
        From: process.env.TWILIO_FROM_NUMBER!,
        Body: `Hi ${firstName}! Your DumpSite.io load has been approved. Address: ${address}${city ? ', ' + city : ''}. Drive safe! - DumpSite.io`
      }).toString()
    })
  }

  return NextResponse.json({ success: true })
}
