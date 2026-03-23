import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { createServerSupabase } from '@/lib/supabase.server'

export async function POST(req: NextRequest) {
  // Auth check — only authenticated users can create referrals
  const supabase = await createServerSupabase()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { referrerId, referredId, referralCode } = body
  if (!referrerId || !referredId || !referralCode) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  // Validate the referred user matches the authenticated user
  if (referredId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (referrerId === referredId) {
    return NextResponse.json({ error: 'Cannot refer yourself' }, { status: 400 })
  }

  const admin = createAdminSupabase()

  // Verify referrer exists
  const { data: referrer } = await admin
    .from('driver_profiles')
    .select('user_id')
    .eq('user_id', referrerId)
    .eq('referral_code', referralCode)
    .single()

  if (!referrer) {
    return NextResponse.json({ error: 'Invalid referral code' }, { status: 404 })
  }

  // Upsert to prevent duplicates
  await admin.from('driver_referrals').upsert({
    referrer_id: referrerId,
    referred_id: referredId,
    referral_code: referralCode,
    status: 'pending',
    loads_completed_by_referred: 0,
    loads_required_to_qualify: 5,
    bonus_amount_cents: 2500,
  }, { onConflict: 'referred_id' })

  return NextResponse.json({ success: true })
}
