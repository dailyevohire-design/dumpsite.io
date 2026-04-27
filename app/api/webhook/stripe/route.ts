import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createAdminSupabase } from '@/lib/supabase'
import { sendOutboundSMS } from '@/lib/sms'
import { withFailClosed } from '@/lib/sms/fail-closed'
import twilio from 'twilio'

const ADMIN_PHONE = (process.env.ADMIN_PHONE || '7134439223').replace(/\D/g, '')
const ADMIN_PHONE_2 = (process.env.ADMIN_PHONE_2 || '').replace(/\D/g, '')
const CUSTOMER_FROM = process.env.CUSTOMER_TWILIO_NUMBER!

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured')
  return new Stripe(key, { apiVersion: '2026-02-25.clover' })
}

function getTwilio() {
  return twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
}

function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '').replace(/^1/, '')
}

async function sendCustomerSMS(to: string, body: string) {
  const result = await sendOutboundSMS({ to: normalizePhone(to), body, from: CUSTOMER_FROM })
  if (!result.ok) {
    console.error('[stripe webhook] customer SMS failed:', to, result.error)
  }
}

async function sendAdminSMS(body: string) {
  if (process.env.PAUSE_ADMIN_SMS === 'true') { console.log(`[SMS PAUSED] Stripe webhook: ${body.slice(0, 80)}`); return }
  const client = getTwilio()
  try {
    await client.messages.create({ body, from: CUSTOMER_FROM, to: `+1${ADMIN_PHONE}` })
  } catch {}
  if (ADMIN_PHONE_2) {
    try {
      await client.messages.create({ body, from: CUSTOMER_FROM, to: `+1${ADMIN_PHONE_2}` })
    } catch {}
  }
}

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('[stripe webhook] STRIPE_WEBHOOK_SECRET not configured')
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  const body = await req.text()
  const signature = req.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    const stripe = getStripe()
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch (err: any) {
    console.error('[stripe webhook] Signature verification failed:', err.message)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  // Handle customer priority payment
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const orderType = session.metadata?.orderType
    const phone = session.metadata?.phone

    // Only handle priority customer payments — tier upgrades handled elsewhere
    if (orderType !== 'priority' || !phone) {
      return NextResponse.json({ received: true })
    }

    const normalizedPhone = normalizePhone(phone)
    const supabase = createAdminSupabase()

    // Lookup by stripe_session_id — guaranteed unique across ALL rows
    // (a customer can have multiple conversations now, one per agent_id, so
    // .eq("phone") could return multiple rows and .maybeSingle() would throw).
    const { data: conv } = await supabase
      .from('customer_conversations')
      .select('*')
      .eq('stripe_session_id', session.id)
      .maybeSingle()

    if (!conv) {
      console.error(`[stripe webhook] No conversation found for stripe session: ${session.id} phone: ${normalizedPhone}`)
      await sendAdminSMS(`STRIPE PAYMENT received but no conversation found for ${phone} (session ${session.id}) — needs manual handling`)
      return NextResponse.json({ received: true })
    }

    // Agent scope for subsequent updates — use the row we found.
    const convAgentId = conv.agent_id as string

    if (conv.state !== 'AWAITING_PRIORITY_PAYMENT') {
      console.error(`[stripe webhook] Unexpected state ${conv.state} for ${normalizedPhone}`)
      // Payment received but state is wrong — still process it, don't lose money
      await sendAdminSMS(`STRIPE PAYMENT received for ${conv.customer_name} (${phone}) but state was ${conv.state} — check manually`)
    }

    // Update conversation with payment info (scoped by agent_id)
    const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : null
    await supabase
      .from('customer_conversations')
      .update({
        stripe_payment_intent_id: paymentIntentId,
        payment_status: 'paid',
        payment_method: 'stripe',
        state: 'ORDER_PLACED',
      })
      .eq('phone', normalizedPhone)
      .eq('agent_id', convAgentId)

    // Create dispatch order
    const { createDispatchOrder } = await import('@/lib/services/dispatch.service')
    const fmtMaterial = (k: string) => ({ fill_dirt: 'fill dirt', screened_topsoil: 'screened topsoil', structural_fill: 'structural fill', sand: 'sand' })[k] || k.replace(/_/g, ' ')
    const material = fmtMaterial(conv.material_type || 'fill_dirt')
    const guaranteedDate = session.metadata?.guaranteedDate || conv.priority_guaranteed_date || 'TBD'

    // Resolve city for dispatch
    let cityId: string | null = null
    if (conv.delivery_city) {
      const { data: city } = await supabase
        .from('cities')
        .select('id')
        .ilike('name', `%${conv.delivery_city.trim()}%`)
        .eq('is_active', true)
        .maybeSingle()
      cityId = city?.id || null
    }

    const truckType = conv.access_type === 'dump_truck_and_18wheeler' ? 'end_dump' : 'tandem_axle'
    const result = await createDispatchOrder({
      clientName: conv.customer_name || 'Customer',
      clientPhone: normalizedPhone,
      clientAddress: conv.delivery_address || '',
      cityId: cityId || '',
      yardsNeeded: conv.yards_needed || 10,
      priceQuotedCents: conv.priority_total_cents || conv.total_price_cents || 0,
      truckTypeNeeded: truckType,
      notes: `PRIORITY PAID | ${material} | ${conv.access_type || 'dump truck'} access | Guaranteed ${guaranteedDate} | Quarry: ${conv.priority_quarry_name || 'TBD'} | Source: FillDirtNearMe SMS`,
      urgency: 'standard',
      source: 'web_form',
    })

    if (result.success && result.dispatchId) {
      await supabase
        .from('customer_conversations')
        .update({ dispatch_order_id: result.dispatchId })
        .eq('phone', normalizedPhone)
        .eq('agent_id', convAgentId)

      console.log(`[stripe webhook] Priority order dispatched: ${result.dispatchId} for ${normalizedPhone}`)
    } else {
      console.error('[stripe webhook] Dispatch failed after payment:', result.error)
      await sendAdminSMS(`PRIORITY PAYMENT received for ${conv.customer_name} but dispatch FAILED: ${result.error} — NEEDS MANUAL DISPATCH`)
    }

    // SMS customer — payment confirmed, delivery scheduled
    const totalDollars = ((conv.priority_total_cents || 0) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })
    await withFailClosed(normalizedPhone, async (setSendCommitted) => {
      await sendCustomerSMS(normalizedPhone,
        `Payment received, you're all set. Your ${conv.yards_needed || 10} yards of ${material} is confirmed for ${guaranteedDate}. You'll get a text when your driver is heading your way.`)
      // Customer just received the confirmation. Failures past this point are
      // post-send audit issues (audit_logs insert, admin SMS) — don't pause.
      setSendCommitted()
    }, {
      source: 'stripe-customer-confirmation',
      onError: async () => null,
    })

    // SMS admin
    await sendAdminSMS(
      `PRIORITY PAID: ${conv.customer_name} | $${totalDollars} | ${conv.yards_needed}yds ${material} | ${conv.delivery_city} | Guaranteed ${guaranteedDate} | Quarry: ${conv.priority_quarry_name || 'TBD'}`
    )

    // Audit log
    await supabase.from('audit_logs').insert({
      action: 'priority_payment.completed',
      entity_type: 'customer_conversation',
      entity_id: normalizedPhone,
      metadata: {
        stripe_session_id: session.id,
        payment_intent_id: paymentIntentId,
        amount_cents: conv.priority_total_cents,
        customer_name: conv.customer_name,
        guaranteed_date: guaranteedDate,
      },
    })
  }

  return NextResponse.json({ received: true })
}
