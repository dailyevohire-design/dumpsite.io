import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { createDispatchOrder } from '@/lib/services/dispatch.service'
import { sanitizeText, sanitizeNumber } from '@/lib/validation'

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

  const clientName = sanitizeText(body.client_name || body.name || '').slice(0, 200)
  const clientAddress = sanitizeText(body.client_address || body.address || '').slice(0, 500)
  const yardsNeeded = sanitizeNumber(body.yards_needed || body.yards, 1, 100000) || 0
  const priceQuoted = Math.max(0, Math.min(1000000, parseFloat(body.price_quoted || body.price || '0') || 0))
  const cityName = sanitizeText(body.city || '').slice(0, 100)

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
    clientPhone: sanitizeText(body.client_phone || body.phone || '').slice(0, 20),
    clientAddress,
    cityId: city.id,
    yardsNeeded,
    priceQuotedCents: Math.round(priceQuoted * 100),
    truckTypeNeeded: sanitizeText(body.truck_type || '').slice(0, 50),
    notes: sanitizeText(body.notes || '').slice(0, 1000),
    urgency: body.urgency === 'urgent' ? 'urgent' : 'standard',
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
