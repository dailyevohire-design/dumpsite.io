import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { createDispatchOrder } from '@/lib/services/dispatch.service'

export async function POST(req: NextRequest) {
  // SECURITY: Validate webhook secret from env — never use a hardcoded fallback
  const expectedSecret = process.env.ZAPIER_WEBHOOK_SECRET
  if (!expectedSecret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }
  const zapierSecret = req.headers.get('x-zapier-secret')
  if (zapierSecret !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const clientName = body.client_name || body.name || ''
  const clientAddress = body.client_address || body.address || ''
  const yardsNeeded = parseInt(body.yards_needed || body.yards || '0')
  const priceQuoted = parseFloat(body.price_quoted || body.price || '0')
  const cityName = body.city || ''

  if (!clientName || !clientAddress || !yardsNeeded || !cityName) {
    return NextResponse.json({
      success: false,
      message: 'Missing required fields: client_name, client_address, yards_needed, city'
    })
  }

  const supabase = createAdminSupabase()
  const { data: city } = await supabase
    .from('cities')
    .select('id, name')
    .ilike('name', `%${cityName.trim()}%`)
    .eq('is_active', true)
    .maybeSingle()

  if (!city) {
    return NextResponse.json({
      success: false,
      message: `City "${cityName}" not found. Add it in your admin panel.`
    })
  }

  const result = await createDispatchOrder({
    clientName,
    clientPhone: body.client_phone || body.phone,
    clientAddress,
    cityId: city.id,
    yardsNeeded,
    priceQuotedCents: Math.round(priceQuoted * 100),
    truckTypeNeeded: body.truck_type,
    notes: body.notes,
    urgency: body.urgency || 'standard',
    source: 'zapier',
    zapierRowId: body.row_id || body.id
  })

  return NextResponse.json({
    success: result.success,
    dispatchId: result.dispatchId,
    driversNotified: result.driversNotified,
    city: result.cityName,
    message: result.error || `${result.driversNotified} drivers notified in ${result.cityName}`
  })
}
