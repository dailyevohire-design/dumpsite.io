import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { createServerSupabase } from '@/lib/supabase.server'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { loadId, lat, lng, accuracy } = body

  if (!loadId || typeof lat !== 'number' || typeof lng !== 'number') {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const admin = createAdminSupabase()

  // Find latest tracking session for this load + driver
  const { data: session } = await admin
    .from('job_tracking_sessions')
    .select('id')
    .eq('load_request_id', loadId)
    .eq('driver_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!session) {
    return NextResponse.json({ error: 'No active tracking session' }, { status: 404 })
  }

  await admin.from('job_location_pings').insert({
    tracking_session_id: session.id,
    lat,
    lng,
    accuracy_meters: typeof accuracy === 'number' ? accuracy : null,
  })

  await admin
    .from('job_tracking_sessions')
    .update({ last_ping_at: new Date().toISOString() })
    .eq('id', session.id)

  return NextResponse.json({ success: true })
}
