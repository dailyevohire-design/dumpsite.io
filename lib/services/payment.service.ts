import Stripe from 'stripe'
import { createAdminSupabase } from '../supabase'

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured')
  return new Stripe(key, { apiVersion: '2026-02-25.clover' })
}

export interface PayoutResult {
  success: boolean
  payoutId?: string
  amountCents?: number
  error?: string
}

/**
 * Record a completed load payment in the database.
 * Actual payouts happen via Stripe Connect or manual transfer — this tracks the record.
 */
export async function recordLoadPayment(loadId: string, driverId: string): Promise<PayoutResult> {
  const supabase = createAdminSupabase()

  // Get load + dispatch order to determine pay
  const { data: load, error: loadErr } = await supabase
    .from('load_requests')
    .select('id, status, dispatch_order_id, driver_id')
    .eq('id', loadId)
    .eq('driver_id', driverId)
    .single()

  if (loadErr || !load) {
    return { success: false, error: 'Load not found or access denied' }
  }

  if (load.status !== 'completed') {
    return { success: false, error: 'Load must be completed before payment' }
  }

  // Check for duplicate payment
  const { data: existingPayment } = await supabase
    .from('driver_payments')
    .select('id')
    .eq('load_request_id', loadId)
    .maybeSingle()

  if (existingPayment) {
    return { success: true, payoutId: existingPayment.id, error: 'Payment already recorded' }
  }

  // Get driver pay from dispatch order
  let amountCents = 0
  if (load.dispatch_order_id) {
    const { data: order } = await supabase
      .from('dispatch_orders')
      .select('driver_pay_cents')
      .eq('id', load.dispatch_order_id)
      .single()
    amountCents = order?.driver_pay_cents || 0
  }

  if (amountCents <= 0) {
    return { success: false, error: 'Could not determine driver pay amount' }
  }

  const { data: payment, error: payErr } = await supabase
    .from('driver_payments')
    .insert({
      driver_id: driverId,
      load_request_id: loadId,
      amount_cents: amountCents,
      status: 'pending',
    })
    .select('id')
    .single()

  if (payErr || !payment) {
    // Unique violation on (load_request_id, driver_id) — another concurrent insert won. Treat as success.
    if (payErr && (payErr.code === '23505' || /duplicate|unique/i.test(payErr.message || ''))) {
      const { data: existing } = await supabase
        .from('driver_payments').select('id').eq('load_request_id', loadId).eq('driver_id', driverId).maybeSingle()
      if (existing) return { success: true, payoutId: existing.id, amountCents, error: 'Payment already recorded' }
    }
    console.error('Payment record error:', payErr)
    return { success: false, error: 'Failed to record payment' }
  }

  await supabase.from('audit_logs').insert({
    action: 'payment.recorded',
    entity_type: 'driver_payment',
    entity_id: payment.id,
    metadata: { driver_id: driverId, load_id: loadId, amount_cents: amountCents },
  })

  return { success: true, payoutId: payment.id, amountCents }
}

/**
 * Create a Stripe Checkout session for tier upgrades.
 */
export async function createUpgradeCheckout(userId: string, tierSlug: string): Promise<{ success: boolean; url?: string; error?: string }> {
  const TIER_PRICES: Record<string, string> = {
    hauler: process.env.STRIPE_PRICE_HAULER || '',
    pro: process.env.STRIPE_PRICE_PRO || '',
    elite: process.env.STRIPE_PRICE_ELITE || '',
  }

  const priceId = TIER_PRICES[tierSlug]
  if (!priceId) {
    return { success: false, error: 'Invalid tier' }
  }

  try {
    const stripe = getStripe()
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dumpsite.io'

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/dashboard?upgraded=${tierSlug}`,
      cancel_url: `${appUrl}/upgrade`,
      metadata: { userId, tierSlug },
    })

    return { success: true, url: session.url || undefined }
  } catch (error: any) {
    console.error('Stripe checkout error:', error.message)
    return { success: false, error: 'Payment system unavailable. Please try again.' }
  }
}

/**
 * Handle Stripe webhook for subscription events.
 * Called from the Stripe webhook route after signature verification.
 */
export async function handleSubscriptionEvent(event: Stripe.Event): Promise<{ success: boolean; error?: string }> {
  const supabase = createAdminSupabase()

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const userId = session.metadata?.userId
    const tierSlug = session.metadata?.tierSlug

    if (!userId || !tierSlug) {
      return { success: false, error: 'Missing metadata in checkout session' }
    }

    // Look up the tier ID
    const { data: tier } = await supabase
      .from('tiers')
      .select('id')
      .eq('slug', tierSlug)
      .single()

    if (!tier) {
      return { success: false, error: `Tier ${tierSlug} not found` }
    }

    const { error: updateErr } = await supabase
      .from('driver_profiles')
      .update({
        tier_id: tier.id,
        stripe_subscription_id: session.subscription as string,
      })
      .eq('user_id', userId)

    if (updateErr) {
      console.error('Tier upgrade error:', updateErr)
      return { success: false, error: 'Failed to upgrade tier' }
    }

    await supabase.from('audit_logs').insert({
      actor_id: userId,
      action: 'tier.upgraded',
      entity_type: 'driver_profile',
      entity_id: userId,
      metadata: { tier: tierSlug, stripe_session: session.id },
    })

    return { success: true }
  }

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object as Stripe.Subscription
    const subscriptionId = subscription.id

    // Downgrade to trial tier
    const { data: trialTier } = await supabase
      .from('tiers')
      .select('id')
      .eq('slug', 'trial')
      .single()

    if (trialTier) {
      await supabase
        .from('driver_profiles')
        .update({ tier_id: trialTier.id, stripe_subscription_id: null })
        .eq('stripe_subscription_id', subscriptionId)
    }

    return { success: true }
  }

  return { success: true }
}

/**
 * Create a Stripe Checkout session for one-time priority order payment.
 * Customer pays upfront before we dispatch — quarry material must be paid same-day.
 */
export async function createCustomerPaymentCheckout(opts: {
  phone: string
  customerName: string
  amountCents: number
  description: string
  guaranteedDate: string
}): Promise<{ success: boolean; url?: string; sessionId?: string; error?: string }> {
  try {
    const stripe = getStripe()
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dumpsite.io'

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Priority Dirt Delivery',
            description: opts.description,
          },
          unit_amount: opts.amountCents,
        },
        quantity: 1,
      }],
      metadata: {
        phone: opts.phone,
        customerName: opts.customerName,
        orderType: 'priority',
        guaranteedDate: opts.guaranteedDate,
      },
      success_url: `${appUrl}/payment-success`,
      cancel_url: `${appUrl}/payment-success?cancelled=true`,
    })

    return { success: true, url: session.url || undefined, sessionId: session.id }
  } catch (error: any) {
    console.error('Stripe customer checkout error:', error.message)
    return { success: false, error: 'Payment system unavailable. Please try again.' }
  }
}

/**
 * Check if a Stripe Checkout session has been paid.
 */
export async function checkPaymentStatus(sessionId: string): Promise<{ paid: boolean; paymentIntentId?: string }> {
  try {
    const stripe = getStripe()
    const session = await stripe.checkout.sessions.retrieve(sessionId)
    const paid = session.payment_status === 'paid'
    return { paid, paymentIntentId: paid ? (session.payment_intent as string) || undefined : undefined }
  } catch (error: any) {
    console.error('Stripe session check error:', error.message)
    return { paid: false }
  }
}
