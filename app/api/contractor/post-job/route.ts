import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { createServerSupabase } from '@/lib/supabase.server'
import { encryptAddress } from '@/lib/crypto'
import { sanitizeText } from '@/lib/validation'
import { sendAdminAlert } from '@/lib/sms'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { title, address, materialType, yardsEstimated, loadsNeeded, budgetPerLoad, urgency, availableDates, accessInstructions, contactName, contactPhone, cityName } = body

  if (!title || !address || !materialType || !yardsEstimated || !contactName || !contactPhone || !cityName) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const admin = createAdminSupabase()

  // Find city
  const { data: city } = await admin.from('cities').select('id, name').ilike('name', `%${sanitizeText(cityName).trim()}%`).maybeSingle()
  if (!city) return NextResponse.json({ error: `City "${cityName}" not found` }, { status: 404 })

  // Encrypt access instructions if provided
  let encryptedInstructions = null
  if (accessInstructions) {
    try { encryptedInstructions = JSON.stringify(encryptAddress(accessInstructions)) } catch {}
  }

  const { data: order, error: insertErr } = await admin.from('dispatch_orders').insert({
    client_name: sanitizeText(contactName).slice(0, 200),
    client_phone: sanitizeText(contactPhone).slice(0, 20),
    client_address: sanitizeText(address).slice(0, 500),
    city_id: city.id,
    yards_needed: parseInt(yardsEstimated) || 10,
    price_quoted_cents: Math.round((parseFloat(budgetPerLoad) || 30) * 100),
    driver_pay_cents: Math.round((parseFloat(budgetPerLoad) || 30) * 100),
    truck_type_needed: materialType,
    notes: sanitizeText(title).slice(0, 500) + (encryptedInstructions ? '\n[Access instructions encrypted]' : ''),
    urgency: urgency === 'urgent' ? 'urgent' : 'standard',
    source: 'contractor_portal',
    created_by: user.id,
    status: 'dispatching',
  }).select('id').single()

  if (insertErr) return NextResponse.json({ error: 'Failed to create job' }, { status: 500 })

  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dumpsite.io'
    await sendAdminAlert(`New contractor job posted — "${sanitizeText(title)}" in ${city.name}. Review at ${appUrl}/admin`)
  } catch {}

  return NextResponse.json({ success: true, jobId: order?.id })
}
