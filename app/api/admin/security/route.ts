import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { requireAdmin } from '@/lib/admin-auth'

export async function GET(req: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const url = new URL(req.url)
  const type = url.searchParams.get('type')
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '200', 10), 500)

  const supabase = createAdminSupabase()
  let q = supabase
    .from('security_events')
    .select('id, event_type, session_id, url, ip, user_agent, country, city, payload, bot_confidence, alerted, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (type) q = q.eq('event_type', type)

  const { data, error } = await q
  if (error) {
    console.error('[admin/security] query error:', error.message)
    return NextResponse.json({ success: false, error: 'Failed to load' }, { status: 500 })
  }

  // Quick stats over the returned window
  const stats = {
    total: data?.length || 0,
    critical: data?.filter((e) => e.event_type === 'honeypot_form' || e.event_type === 'address_leak').length || 0,
    bots: data?.filter((e) => (e.bot_confidence || 0) >= 0.7).length || 0,
    csp: data?.filter((e) => e.event_type === 'csp_violation').length || 0,
    alerted: data?.filter((e) => e.alerted).length || 0,
  }

  return NextResponse.json({ success: true, events: data || [], stats })
}
