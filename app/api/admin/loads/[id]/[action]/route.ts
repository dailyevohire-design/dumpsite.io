import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { requireAdmin } from '@/lib/admin-auth'
import { sendRejectionSMS } from '@/lib/sms'

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string; action: string }> }
) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const { id: loadId, action } = await context.params
  const supabase = createAdminSupabase()

  if (action === 'approve') {
    return NextResponse.json({ error: 'Use the /approve endpoint instead' }, { status: 400 })
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
        reviewed_by: auth.user.id,
        rejected_reason: body.reason
      })
      .eq('id', loadId)
      .eq('status', 'pending')

    if (updateError) {
      return NextResponse.json({ success: false, message: 'Failed to reject' }, { status: 400 })
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
