import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { createServerSupabase } from '@/lib/supabase.server'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminSupabase()

  const { data: profile } = await admin.from('driver_profiles').select('city_id').eq('user_id', user.id).single()
  const cityId = profile?.city_id

  // Get all active drivers (or in same city if set)
  let query = admin.from('driver_profiles')
    .select('user_id, first_name, last_name, gps_score, tiers(name, slug)')
    .eq('status', 'active')
  if (cityId) query = query.eq('city_id', cityId)

  const { data: drivers } = await query.limit(50)
  if (!drivers?.length) return NextResponse.json({ leaderboard: [], myRank: null })

  // Get completed loads this month for each driver
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
  const driverIds = drivers.map(d => d.user_id)

  const { data: loads } = await admin
    .from('load_requests')
    .select('driver_id, payout_cents')
    .in('driver_id', driverIds)
    .eq('status', 'completed')
    .gte('completed_at', monthStart)

  const stats: Record<string, { loads: number; earned: number }> = {}
  for (const l of (loads || [])) {
    if (!stats[l.driver_id]) stats[l.driver_id] = { loads: 0, earned: 0 }
    stats[l.driver_id].loads++
    stats[l.driver_id].earned += l.payout_cents || 0
  }

  const ranked = drivers.map(d => ({
    userId: d.user_id,
    name: `${d.first_name} ${(d.last_name || '').charAt(0)}.`,
    loadsThisMonth: stats[d.user_id]?.loads || 0,
    earnedThisMonth: Math.round((stats[d.user_id]?.earned || 0) / 100),
    gpsScore: d.gps_score,
    tier: (d.tiers as any)?.name || 'Trial',
    tierSlug: (d.tiers as any)?.slug || 'trial',
  })).sort((a, b) => b.loadsThisMonth - a.loadsThisMonth || b.earnedThisMonth - a.earnedThisMonth)
    .slice(0, 10)
    .map((d, i) => ({ ...d, rank: i + 1 }))

  const myRank = ranked.findIndex(d => d.userId === user.id) + 1

  return NextResponse.json({ leaderboard: ranked, myRank: myRank > 0 ? myRank : null })
}
