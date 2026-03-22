import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { createDispatchOrder } from '@/lib/services/dispatch.service'
import { requireAdmin } from '@/lib/admin-auth'
import { rateLimit } from '@/lib/rate-limit'
import { sanitizeText } from '@/lib/validation'

export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const rl = await rateLimit(`dispatch:${auth.user.id}`, 30, '1 h')
  if (!rl.allowed) return rl.response!

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Sanitize text inputs
  if (body.clientName) body.clientName = sanitizeText(body.clientName).slice(0, 200)
  if (body.clientAddress) body.clientAddress = sanitizeText(body.clientAddress).slice(0, 500)
  if (body.notes) body.notes = sanitizeText(body.notes).slice(0, 1000)
  if (body.clientPhone) body.clientPhone = sanitizeText(body.clientPhone).slice(0, 20)

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
    createdBy: auth.user.id
  })

  return NextResponse.json(result, { status: result.success ? 201 : 400 })
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

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

export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const { searchParams } = new URL(req.url)
  const orderId = searchParams.get('id')
  if (!orderId) return NextResponse.json({ error: 'Missing order id' }, { status: 400 })

  const supabase = createAdminSupabase()

  const { count } = await supabase
    .from('load_requests')
    .select('id', { count: 'exact', head: true })
    .eq('dispatch_order_id', orderId)

  if ((count || 0) > 0) {
    return NextResponse.json({
      error: `Cannot delete — this order has ${count} load request(s) attached. Cancel them first.`
    }, { status: 409 })
  }

  const { error } = await supabase
    .from('dispatch_orders')
    .update({ status: 'cancelled' })
    .eq('id', orderId)

  if (error) return NextResponse.json({ error: 'Failed to cancel order' }, { status: 500 })

  await supabase.from('audit_logs').insert({
    actor_id: auth.user.id,
    action: 'dispatch_order.cancelled',
    entity_type: 'dispatch_order',
    entity_id: orderId,
    metadata: { cancelled_via: 'admin_dashboard' }
  })

  return NextResponse.json({ success: true })
}
