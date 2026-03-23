import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { createServerSupabase } from '@/lib/supabase.server'
import { rateLimit } from '@/lib/rate-limit'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimit(`earnings:${user.id}`, 30, '1 m')
  if (!rl.allowed) return rl.response!

  const admin = createAdminSupabase()

  const { data: completedLoads } = await admin
    .from('load_requests')
    .select('payout_cents, completed_at')
    .eq('driver_id', user.id)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(500)

  const loads = completedLoads || []
  const now = new Date()

  // Monday of current week
  const monday = new Date(now)
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7))
  monday.setHours(0, 0, 0, 0)

  // 1st of current month
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  let totalCents = 0
  let weekCents = 0
  let monthCents = 0
  const dailyEarnings: Record<string, number> = {}
  const weeklyEarnings: Record<string, number> = {}

  for (const load of loads) {
    const cents = load.payout_cents || 0
    const d = new Date(load.completed_at)
    totalCents += cents

    if (d >= monday) weekCents += cents
    if (d >= monthStart) monthCents += cents

    const dayKey = d.toISOString().split('T')[0]
    dailyEarnings[dayKey] = (dailyEarnings[dayKey] || 0) + cents

    // Week key: ISO week start (Monday)
    const weekMonday = new Date(d)
    weekMonday.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    const weekKey = weekMonday.toISOString().split('T')[0]
    weeklyEarnings[weekKey] = (weeklyEarnings[weekKey] || 0) + cents
  }

  const bestDay = Object.values(dailyEarnings).length > 0
    ? Math.max(...Object.values(dailyEarnings))
    : 0

  // Last 8 weeks
  const weeks: { label: string; dollars: number; isCurrent: boolean }[] = []
  for (let i = 7; i >= 0; i--) {
    const weekStart = new Date(monday)
    weekStart.setDate(monday.getDate() - i * 7)
    const key = weekStart.toISOString().split('T')[0]
    const label = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    weeks.push({
      label,
      dollars: Math.round((weeklyEarnings[key] || 0) / 100),
      isCurrent: i === 0,
    })
  }

  return NextResponse.json({
    totalDollars: Math.round(totalCents / 100),
    weekDollars: Math.round(weekCents / 100),
    monthDollars: Math.round(monthCents / 100),
    avgPerLoad: loads.length > 0 ? Math.round(totalCents / loads.length / 100) : 0,
    totalLoads: loads.length,
    bestDayDollars: Math.round(bestDay / 100),
    weeks,
  })
}
