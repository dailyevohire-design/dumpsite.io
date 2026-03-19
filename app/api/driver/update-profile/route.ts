import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase, createAdminSupabase } from '@/lib/supabase'
import { encryptAddress } from '@/lib/crypto'

const ALLOWED = new Set(['first_name','last_name','company_name','phone','truck_count','truck_type','bank_name','account_holder_name','routing_number','account_number','account_type','payment_method'])
const FORBIDDEN = new Set(['user_id','tier_id','status','gps_score','rating','trial_loads_used','phone_verified','city_id','w9_url'])
const ENCRYPT_FIELDS = new Set(['routing_number','account_number'])

export async function PATCH(req: NextRequest) {
  const supabase = createServerSupabase(req)
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const updates: Record<string, any> = {}
  for (const [key, value] of Object.entries(body)) {
    if (FORBIDDEN.has(key)) return NextResponse.json({ error: `Field "${key}" cannot be modified` }, { status: 400 })
    if (!ALLOWED.has(key)) continue
    if (ENCRYPT_FIELDS.has(key) && typeof value === 'string' && value.trim()) {
      try {
        const enc = encryptAddress(value.trim())
        updates[`${key}_encrypted`] = JSON.stringify(enc)
        updates[key] = '[encrypted]'
      } catch {
        return NextResponse.json({ error: 'Encryption failed' }, { status: 500 })
      }
    } else {
      updates[key] = value
    }
  }

  if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })

  if (updates.truck_count !== undefined) {
    const n = parseInt(updates.truck_count)
    if (isNaN(n) || n < 1 || n > 100) return NextResponse.json({ error: 'truck_count must be between 1 and 100' }, { status: 400 })
    updates.truck_count = n
  }

  const admin = createAdminSupabase()
  const { error } = await admin.from('driver_profiles').update(updates).eq('user_id', user.id)
  if (error) return NextResponse.json({ error: 'Failed to save profile' }, { status: 500 })

  return NextResponse.json({ success: true })
}
