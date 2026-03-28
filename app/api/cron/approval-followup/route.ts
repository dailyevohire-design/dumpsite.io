import { createAdminSupabase } from '@/lib/supabase'
import { makeVoiceCallToCustomer } from '@/lib/services/approval.service'

export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabase = createAdminSupabase()
  const twoMinsAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString()

  // Find conversations in APPROVAL_PENDING state for more than 2 minutes with no voice call made
  const { data: pendingConvs } = await supabase
    .from('conversations')
    .select('phone, pending_approval_order_id, extracted_yards, voice_call_made')
    .eq('state', 'APPROVAL_PENDING')
    .eq('voice_call_made', false)
    .lt('approval_sent_at', twoMinsAgo)
    .not('pending_approval_order_id', 'is', null)

  if (!pendingConvs?.length) {
    return new Response(JSON.stringify({ checked: 0, called: 0 }), { headers: { 'Content-Type': 'application/json' } })
  }

  let called = 0
  for (const conv of pendingConvs) {
    const { data: order } = await supabase
      .from('dispatch_orders')
      .select('client_phone, client_name, yards_needed')
      .eq('id', conv.pending_approval_order_id)
      .single()

    if (!order?.client_phone) continue

    const profile = await supabase
      .from('driver_profiles')
      .select('first_name')
      .eq('phone', conv.phone)
      .maybeSingle()

    const driverName = (profile.data as any)?.first_name || 'Driver'
    const approvalCode = `DS-${conv.pending_approval_order_id.replace(/-/g, '').slice(0, 6).toUpperCase()}`

    await makeVoiceCallToCustomer(
      order.client_phone,
      driverName,
      conv.extracted_yards || order.yards_needed,
      approvalCode
    )

    // Mark voice call made
    await supabase
      .from('conversations')
      .update({ voice_call_made: true, updated_at: new Date().toISOString() })
      .eq('phone', conv.phone)

    called++
  }

  return new Response(JSON.stringify({ checked: pendingConvs.length, called }), { headers: { 'Content-Type': 'application/json' } })
}
