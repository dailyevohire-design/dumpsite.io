import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { createDispatchOrder } from '@/lib/services/dispatch.service'

export async function POST(req: NextRequest) {
  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.clientName || !body.clientAddress || !body.cityId || !body.yardsNeeded) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const result = await createDispatchOrder({
    clientName: body.clientName,
    clientPhone: body.clientPhone,
    clientAddress: body.clientAddress,
    cityId: body.cityId,
    yardsNeeded: parseInt(body.yardsNeeded),
    priceQuotedCents: Math.round(parseFloat(body.priceQuoted || '0') * 100),
    truckTypeNeeded: body.truckTypeNeeded,
    notes: body.notes,
    urgency: body.urgency || 'standard',
    source: 'manual',
    createdBy: body.createdBy
  })

  return NextResponse.json(result, { status: result.success ? 201 : 400 })
}

export async function GET(req: NextRequest) {
  const supabase = createAdminSupabase()
  const { searchParams } = new URL(req.url)
  const page = parseInt(searchParams.get('page') || '1')
  const statusFilter = searchParams.get('status') || 'dispatching'
  const limit = 200
  const offset = (page - 1) * limit

  const { data: orders, count } = await supabase
    .from('dispatch_orders')
    .select(`
      id, client_name, client_address, yards_needed,
      price_quoted_cents, status, urgency, drivers_notified,
      created_at, source, cities(name)
    `, { count: 'exact' })
    .eq('status', statusFilter)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  return NextResponse.json({ orders, total: count, page, limit })
}
