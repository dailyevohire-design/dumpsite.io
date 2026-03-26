import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { rateLimit } from '@/lib/rate-limit'
import { sanitizeText } from '@/lib/validation'
import crypto from 'crypto'

/**
 * POST /api/sms/webhook — Twilio incoming SMS webhook
 *
 * Handles driver replies:
 * - STOP: opt out of SMS notifications
 * - HELP: send help info
 * - YES/ACCEPT: confirm job acceptance
 * - Status keywords: route to appropriate handler
 *
 * Twilio sends form-encoded POST with: From, Body, MessageSid, etc.
 * Must return TwiML (XML) or 200 with empty body.
 */

function validateTwilioSignature(url: string, params: Record<string, string>, signature: string): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!authToken) {
    // If no auth token configured, skip validation in dev
    if (process.env.NODE_ENV === 'development') return true
    return false
  }

  // Build the data string: URL + sorted params concatenated
  const sortedKeys = Object.keys(params).sort()
  let data = url
  for (const key of sortedKeys) {
    data += key + params[key]
  }

  const computed = crypto
    .createHmac('sha1', authToken)
    .update(data)
    .digest('base64')

  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature))
}

export async function POST(request: Request) {
  // Parse form-encoded body from Twilio
  let formData: URLSearchParams
  try {
    const text = await request.text()
    formData = new URLSearchParams(text)
  } catch {
    return new Response('<Response></Response>', {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    })
  }

  const from = formData.get('From') || ''
  const body = sanitizeText(formData.get('Body') || '').toLowerCase().trim()
  const messageSid = formData.get('MessageSid') || ''

  if (!from || !body) {
    return new Response('<Response></Response>', {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    })
  }

  // Validate Twilio signature
  const twilioSignature = request.headers.get('x-twilio-signature') || ''
  const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://dumpsite.io'}/api/sms/webhook`
  const params: Record<string, string> = {}
  formData.forEach((value, key) => {
    params[key] = value
  })

  if (!validateTwilioSignature(webhookUrl, params, twilioSignature)) {
    console.error('Invalid Twilio signature for SMS webhook')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Rate limit by phone number
  const rl = await rateLimit(`sms-webhook:${from}`, 30, '1 h')
  if (!rl.allowed) {
    return new Response('<Response></Response>', {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    })
  }

  const supabase = createAdminSupabase()

  // Log incoming SMS
  await supabase.from('sms_log').insert({
    to_phone: from,
    message_type: 'inbound',
    message_body: body.slice(0, 500),
    twilio_sid: messageSid,
    status: 'received',
  })

  let replyMessage = ''

  // Handle STOP/unsubscribe — Twilio handles this automatically,
  // but we also flag in our DB
  if (body === 'stop' || body === 'unsubscribe') {
    await supabase
      .from('driver_profiles')
      .update({ sms_opted_out: true })
      .eq('phone', from)

    // No TwiML reply needed — Twilio handles STOP automatically
    return new Response('<Response></Response>', {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    })
  }

  // Handle START/re-subscribe
  if (body === 'start' || body === 'subscribe') {
    await supabase
      .from('driver_profiles')
      .update({ sms_opted_out: false })
      .eq('phone', from)

    replyMessage = 'You have been re-subscribed to DumpSite.io notifications. Reply STOP to unsubscribe.'
  }

  // Handle HELP
  else if (body === 'help') {
    replyMessage = 'DumpSite.io — Dirt hauling jobs. Log in at dumpsite.io/dashboard to view and claim jobs. Reply STOP to unsubscribe.'
  }

  // Handle YES/ACCEPT — driver confirming availability for a dispatch
  else if (body === 'yes' || body === 'accept' || body === 'claim') {
    // Find the most recent dispatch SMS sent to this number
    const { data: recentDispatch } = await supabase
      .from('sms_log')
      .select('related_id')
      .eq('to_phone', from)
      .eq('message_type', 'dispatch')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (recentDispatch?.related_id) {
      replyMessage = `Got it! Log in at dumpsite.io/dashboard to submit your load for job ${recentDispatch.related_id.slice(0, 6).toUpperCase()}. You'll receive the address after approval.`
    } else {
      replyMessage = 'No recent job found. Log in at dumpsite.io/dashboard to view available jobs.'
    }
  }

  // Handle STATUS — driver checking their status
  else if (body === 'status') {
    const { data: profile } = await supabase
      .from('driver_profiles')
      .select('first_name')
      .eq('phone', from)
      .maybeSingle()

    const { data: driverProfiles } = await supabase
      .from('driver_profiles')
      .select('user_id')
      .eq('phone', from)

    const driverIds = (driverProfiles || []).map(d => d.user_id)

    const { count: pendingCount } = driverIds.length > 0
      ? await supabase
          .from('load_requests')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending')
          .in('driver_id', driverIds)
      : { count: 0 }

    const name = profile?.first_name || 'Driver'
    replyMessage = `Hi ${name}! You have ${pendingCount || 0} pending load requests. Visit dumpsite.io/dashboard for details.`
  }

  // Unknown command
  else {
    replyMessage = 'DumpSite.io: Reply HELP for info, or visit dumpsite.io/dashboard. Reply STOP to unsubscribe.'
  }

  // Return TwiML response
  if (replyMessage) {
    const twiml = `<Response><Message>${escapeXml(replyMessage)}</Message></Response>`
    return new Response(twiml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    })
  }

  return new Response('<Response></Response>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  })
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
