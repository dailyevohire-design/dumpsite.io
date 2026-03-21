import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { createServerSupabase } from '@/lib/supabase.server'

export async function POST(req: NextRequest) {
  // Auth: use server supabase to get the logged-in user
  let user: any = null
  try {
    const supabase = await createServerSupabase()
    const { data, error } = await supabase.auth.getUser()
    if (!error && data.user) user = data.user
  } catch {}

  // Also accept user_id from body for signup flow where session may not be set yet
  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const userId = user?.id || body.userId
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { firstName, lastName, company, phone, truckCount, truckType } = body
  if (!firstName || !lastName || !phone) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const admin = createAdminSupabase()

  // Check if profile already exists
  const { data: existing } = await admin
    .from('driver_profiles')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ success: true, message: 'Profile already exists' })
  }

  // Get trial tier
  const { data: tier } = await admin
    .from('tiers')
    .select('id')
    .eq('slug', 'trial')
    .single()

  // Normalize phone
  const digits = phone.replace(/\D/g, '')
  let normalizedPhone = phone
  if (digits.length === 10) normalizedPhone = '+1' + digits
  else if (digits.length === 11 && digits.startsWith('1')) normalizedPhone = '+' + digits
  else if (!phone.startsWith('+')) normalizedPhone = '+1' + digits

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
  })

  if (insertError) {
    console.error('Profile creation failed:', insertError.message)
    return NextResponse.json({ error: 'Failed to create profile' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
