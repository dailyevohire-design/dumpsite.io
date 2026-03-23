import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase.server'
import { createAdminSupabase } from '@/lib/supabase'

export async function GET(_req: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = createAdminSupabase()
    const now = new Date()
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

    const { data: loads } = await admin
      .from('load_requests')
      .select('payout_cents, completed_at, truck_count')
      .eq('driver_id', user.id)
      .eq('status', 'completed')
      .not('payout_cents', 'is', null)

    if (!loads) {
      return NextResponse.json({
        todayEarnings: 0, todayLoads: 0,
        monthEarnings: 0, monthLoads: 0,
        allTimeEarnings: 0, allTimeLoads: 0,
        lastCompletedAt: null,
      })
    }

    const month = loads.filter(l => l.completed_at && l.completed_at >= monthStart)
    const today = loads.filter(l => l.completed_at && l.completed_at >= todayMidnight)

    const sum = (arr: typeof loads) => arr.reduce((acc, l) => acc + (l.payout_cents || 0), 0)
    const sorted = [...loads].filter(l => l.completed_at).sort((a, b) =>
      new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime()
    )

    return NextResponse.json({
      todayEarnings: Math.round(sum(today) / 100),
      todayLoads: today.length,
      monthEarnings: Math.round(sum(month) / 100),
      monthLoads: month.length,
      allTimeEarnings: Math.round(sum(loads) / 100),
      allTimeLoads: loads.length,
      lastCompletedAt: sorted[0]?.completed_at || null,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch earnings' }, { status: 500 })
  }
}
