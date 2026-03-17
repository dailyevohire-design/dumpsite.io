import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { sendApprovalSMS, sendRejectionSMS } from '@/lib/sms'

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string; action: string }> }
) {
  const { id: loadId, action } = await context.params
  const supabase = createAdminSupabase()

  if (action === 'approve') {
    const { error: updateError } = await supabase
      .from('load_requests')
      .update({ status: 'approved', reviewed_at: new Date().toISOString() })
      .eq('id', loadId)
      .eq('status', 'pending')

    if (updateError) {
      return NextResponse.json({ success: false, message: 'Failed to approve: ' + updateError.message }, { status: 400 })
    }

    const { data: load } = await supabase
      .from('load_requests')
      .select('id, driver_id, dispatch_order_id')
      .eq('id', loadId)
      .single()

    if (!load) {
      return NextResponse.json({ success: false, message: 'Load not found after update' }, { status: 404 })
    }

    const { data: driver } = await supabase
      .from('driver_profiles')
      .select('phone, first_name')
      .eq('user_id', load.driver_id)
      .single()

    let address = 'Contact dispatch for address'
    let payDollars = 20
    let city = 'DFW'

    if (load.dispatch_order_id) {
      const { data: order } = await supabase
        .from('dispatch_orders')
        .select('client_address, driver_pay_cents, cities(name)')
        .eq('id', load.dispatch_order_id)
        .single()

      if (order) {
        address = order.client_address || address
        payDollars = order.driver_pay_cents ? Math.round(order.driver_pay_cents / 100) : 20
        city = (order.cities as any)?.name || city
      }
    }

    if (driver?.phone) {
      const phone = driver.phone.startsWith('+') ? driver.phone : '+1' + driver.phone.replace(/\D/g, '')
      await sendApprovalSMS(phone, {
        plainAddress: address,
        gateCode: null,
        accessInstructions: `Delivery job in ${city}. Call if you have questions.`,
        loadId,
        payDollars
      })
    }

    return NextResponse.json({ success: true, message: 'Approved. Driver notified via SMS.' })
  }

  if (action === 'reject') {
    let body: any
    try { body = await req.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    if (!body.reason || body.reason.trim().length < 5) {
      return NextResponse.json({ error: 'Please provide a rejection reason' }, { status: 400 })
    }

    const { error: updateError } = await supabase
      .from('load_requests')
      .update({
        status: 'rejected',
        reviewed_at: new Date().toISOString(),
        rejected_reason: body.reason
      })
      .eq('id', loadId)
      .eq('status', 'pending')

    if (updateError) {
      return NextResponse.json({ success: false, message: 'Failed to reject: ' + updateError.message }, { status: 400 })
    }

    const { data: load } = await supabase
      .from('load_requests')
      .select('driver_id')
      .eq('id', loadId)
      .single()

    if (load) {
      const { data: driver } = await supabase
        .from('driver_profiles')
        .select('phone')
        .eq('user_id', load.driver_id)
        .single()

      if (driver?.phone) {
        const phone = driver.phone.startsWith('+') ? driver.phone : '+1' + driver.phone.replace(/\D/g, '')
        await sendRejectionSMS(phone, { reason: body.reason, loadId })
      }
    }

    return NextResponse.json({ success: true, message: 'Rejected. Driver notified.' })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
