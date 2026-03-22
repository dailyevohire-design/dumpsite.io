import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { requireAdmin } from '@/lib/admin-auth'
import { sendRejectionSMS } from '@/lib/sms'
import { rateLimit } from '@/lib/rate-limit'
import { createNotification } from '@/lib/notifications'

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const rl = await rateLimit(`reject:${auth.user.id}`, 50, '1 h')
  if (!rl.allowed) return rl.response!

  const { id } = await context.params

  let body: any
  try { body = await req.json() } catch {
    body = {}
  }

  const reason = body.reason || 'Not approved'

  const supabase = createAdminSupabase()

  const { error } = await supabase
    .from('load_requests')
    .update({
      status: 'rejected',
      reviewed_at: new Date().toISOString(),
      reviewed_by: auth.user.id,
      rejected_reason: reason
    })
    .eq('id', id)
    .eq('status', 'pending')

  if (error) return NextResponse.json({ error: 'Failed to reject' }, { status: 500 })

  // Notify driver
  const { data: load } = await supabase
    .from('load_requests')
    .select('driver_id')
    .eq('id', id)
    .single()

  if (load) {
    const { data: driver } = await supabase
      .from('driver_profiles')
      .select('phone')
      .eq('user_id', load.driver_id)
      .single()

    if (driver?.phone) {
      await sendRejectionSMS(driver.phone, { reason, loadId: id })
    }
  }

  // In-app notification
  if (load) {
    try {
      await createNotification(load.driver_id, {
        type: 'job_rejected',
        title: 'Load Not Approved',
        message: `Reason: ${reason}`,
        actionUrl: '/dashboard',
      })
    } catch {}
  }

  return NextResponse.json({ success: true })
}
