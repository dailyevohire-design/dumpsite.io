import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { createServerSupabase } from '@/lib/supabase.server'
import { sanitizeText, sanitizeNumber } from '@/lib/validation'
import { rateLimit } from '@/lib/rate-limit'

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

  // Rate limit by IP — signup flow
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const rl = await rateLimit(`create-profile:${ip}`, 5, '1 h')
  if (!rl.allowed) return rl.response!

  const firstName = sanitizeText(body.firstName || '').slice(0, 100)
  const lastName = sanitizeText(body.lastName || '').slice(0, 100)
  const company = body.company ? sanitizeText(body.company).slice(0, 200) : null
  const phone = body.phone || ''
  const truckCount = sanitizeNumber(body.truckCount, 1, 100) || 1
  const truckType = sanitizeText(body.truckType || 'tandem_axle').slice(0, 50)

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
    first_name: firstName,
    last_name: lastName,
    company_name: company || null,
    phone: normalizedPhone,
    phone_verified: false,
    city_id: null,
    truck_count: truckCount,
    truck_type: truckType,
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
