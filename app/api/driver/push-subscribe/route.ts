import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { createServerSupabase } from '@/lib/supabase.server'
import { rateLimit } from '@/lib/rate-limit'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimit(`push-subscribe:${user.id}`, 10, '1 h')
  if (!rl.allowed) return rl.response!

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const sub = body.subscription
  if (!sub || typeof sub !== 'object' || !sub.endpoint || typeof sub.endpoint !== 'string' || !sub.endpoint.startsWith('https://')) {
    return NextResponse.json({ error: 'Invalid push subscription — must include valid endpoint' }, { status: 400 })
  }
  if (!sub.keys || typeof sub.keys !== 'object' || !sub.keys.p256dh || !sub.keys.auth) {
    return NextResponse.json({ error: 'Invalid push subscription — must include encryption keys' }, { status: 400 })
  }

  const admin = createAdminSupabase()
  await admin.from('driver_push_subscriptions').upsert({
    user_id: user.id,
    subscription_json: body.subscription,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })

  return NextResponse.json({ success: true })
}

export async function DELETE() {
  const supabase = await createServerSupabase()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminSupabase()
  await admin.from('driver_push_subscriptions').delete().eq('user_id', user.id)

  return NextResponse.json({ success: true })
}
