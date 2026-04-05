import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { sendMembershipLeadEmail } from '@/lib/email'
import { sendAdminAlert } from '@/lib/sms'
import { sanitizeText, validatePhone, validateEmail } from '@/lib/validation'
import { rateLimit } from '@/lib/rate-limit'

const VALID_PLANS = ['pickup', 'tandem', 'fleet'] as const

const PLAN_LABELS: Record<string, string> = {
  pickup: 'Pickup $99/mo',
  tandem: 'Tandem $299/mo',
  fleet: 'Fleet $599/mo',
}

export async function POST(req: Request) {
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    const rl = await rateLimit(`membership-signup:${ip}`, 5, '10 m')
    if (!rl.allowed) return rl.response!

    const body = await req.json()
    const fullName = sanitizeText(body.fullName || '').slice(0, 200)
    const companyName = sanitizeText(body.companyName || '').slice(0, 200)
    const phone = sanitizeText(body.phone || '').slice(0, 20)
    const email = sanitizeText(body.email || '').slice(0, 200).toLowerCase()
    const plan = sanitizeText(body.plan || '').slice(0, 20).toLowerCase()
    const monthlyYards = sanitizeText(body.monthlyYards || '').slice(0, 50)

    if (!fullName || !phone || !email || !plan) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 })
    }

    if (!VALID_PLANS.includes(plan as typeof VALID_PLANS[number])) {
      return NextResponse.json({ success: false, error: 'Invalid plan selected' }, { status: 400 })
    }

    if (!validateEmail(email)) {
      return NextResponse.json({ success: false, error: 'Invalid email address' }, { status: 400 })
    }

    if (!validatePhone(phone)) {
      return NextResponse.json({ success: false, error: 'Invalid phone number' }, { status: 400 })
    }

    const supabase = createAdminSupabase()
    const submittedAt = new Date().toISOString()

    // Duplicate protection: same email + plan within 10 minutes
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const { data: existing } = await supabase
      .from('membership_leads')
      .select('id')
      .eq('email', email)
      .eq('plan', plan)
      .gte('submitted_at', tenMinutesAgo)
      .limit(1)

    if (existing && existing.length > 0) {
      return NextResponse.json({ success: true, data: { checkoutUrl: null } })
    }

    // Insert lead
    const { data: record, error: dbError } = await supabase
      .from('membership_leads')
      .insert({
        full_name: fullName,
        company_name: companyName || null,
        phone,
        email,
        plan,
        monthly_yards: monthlyYards || null,
        submitted_at: submittedAt,
        status: 'new',
      })
      .select('id')
      .single()

    if (dbError) {
      console.error('[membership-signup] DB insert failed:', dbError.code, dbError.message)
    }

    // Send email notification
    try {
      const emailResult = await sendMembershipLeadEmail({
        fullName,
        companyName: companyName || undefined,
        phone,
        email,
        plan,
        monthlyYards: monthlyYards || undefined,
        leadId: record?.id,
        submittedAt: new Date(submittedAt).toLocaleString('en-US', { timeZone: 'America/Chicago' }),
      })

      if (!emailResult.success) {
        console.error('[membership-signup] Email notification failed')
        try {
          await sendAdminAlert(`New membership lead: ${fullName} — ${PLAN_LABELS[plan] || plan}. Email notification failed.`)
        } catch {
          console.error('[membership-signup] SMS fallback also failed')
        }
      }
    } catch {
      console.error('[membership-signup] Email call crashed')
    }

    // Stripe checkout (optional — only if price IDs configured)
    let checkoutUrl: string | null = null
    const MEMBERSHIP_PRICES: Record<string, string> = {
      pickup: process.env.STRIPE_PRICE_MEMBERSHIP_PICKUP || '',
      tandem: process.env.STRIPE_PRICE_MEMBERSHIP_TANDEM || '',
      fleet: process.env.STRIPE_PRICE_MEMBERSHIP_FLEET || '',
    }

    const priceId = MEMBERSHIP_PRICES[plan]
    if (priceId && process.env.STRIPE_SECRET_KEY) {
      try {
        const Stripe = (await import('stripe')).default
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-02-25.clover' })
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dumpsite.io'

        const session = await stripe.checkout.sessions.create({
          mode: 'subscription',
          line_items: [{ price: priceId, quantity: 1 }],
          success_url: `${appUrl}/signup/membership?success=true&plan=${plan}`,
          cancel_url: `${appUrl}/signup/membership?plan=${plan}`,
          customer_email: email,
          metadata: {
            leadId: record?.id || '',
            plan,
            fullName,
            phone,
            companyName: companyName || '',
          },
        })

        checkoutUrl = session.url || null

        if (checkoutUrl && record?.id) {
          await supabase.from('membership_leads')
            .update({ stripe_checkout_url: checkoutUrl })
            .eq('id', record.id)
        }
      } catch (stripeErr: any) {
        console.error('[membership-signup] Stripe checkout failed:', stripeErr.message)
      }
    }

    return NextResponse.json({ success: true, data: { checkoutUrl } })
  } catch (err: any) {
    console.error('[membership-signup] Unexpected error:', err.message)
    return NextResponse.json({ success: false, error: 'Something went wrong' }, { status: 500 })
  }
}
