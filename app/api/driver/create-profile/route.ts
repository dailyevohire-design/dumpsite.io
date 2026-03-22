import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { createServerSupabase } from '@/lib/supabase.server'

export async function POST(req: NextRequest) {
  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // SECURITY: Get userId from authenticated session first
  let userId: string | null = null
  try {
    const supabase = await createServerSupabase()
    const { data, error } = await supabase.auth.getUser()
    if (!error && data.user) userId = data.user.id
  } catch {}

  // SECURITY: If no session, accept body.userId ONLY if it matches a real auth user
  // AND no profile exists yet (signup race condition where session cookie isn't set yet)
  if (!userId && body.userId) {
    const admin = createAdminSupabase()
    const { data: authUser } = await admin.auth.admin.getUserById(body.userId)
    if (authUser?.user) {
      // Extra check: only allow if the user was created in the last 5 minutes (signup window)
      const createdAt = new Date(authUser.user.created_at).getTime()
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000
      if (createdAt >= fiveMinutesAgo) {
        userId = body.userId
      }
    }
  }

  // SECURITY: If session auth succeeded but body.userId differs, reject (impersonation attempt)
  if (userId && body.userId && body.userId !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { firstName, lastName, company, phone, truckCount, truckType } = body
  if (!firstName || !lastName || !phone) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const admin = createAdminSupabase()

  const { data: existing } = await admin
    .from('driver_profiles')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ success: true, message: 'Profile already exists' })
  }

  const { data: tier } = await admin.from('tiers').select('id').eq('slug', 'trial').single()

  const digits = phone.replace(/\D/g, '')
  let normalizedPhone = phone
  if (digits.length === 10) normalizedPhone = '+1' + digits
  else if (digits.length === 11 && digits.startsWith('1')) normalizedPhone = '+' + digits
  else if (!phone.startsWith('+')) normalizedPhone = '+1' + digits

  // Generate memorable referral code: first name + 2 random digits
  const refCode = (firstName.trim().toUpperCase().slice(0, 4) + String(Math.floor(10 + Math.random() * 90))).replace(/[^A-Z0-9]/g, '')

  const { error: insertError } = await admin.from('driver_profiles').insert({
    user_id: userId,
    first_name: firstName.trim(),
    last_name: lastName.trim(),
    company_name: company?.trim() || null,
    phone: normalizedPhone,
    phone_verified: false,
    city_id: null,
    truck_count: parseInt(truckCount) || 1,
    truck_type: truckType || 'tandem_axle',
    tier_id: tier?.id || null,
    status: 'active',
    trial_loads_used: 0,
    gps_score: 85,
    referral_code: refCode,
  })

  if (insertError) {
    return NextResponse.json({ error: 'Failed to create profile' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
