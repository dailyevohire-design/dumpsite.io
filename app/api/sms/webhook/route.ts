import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { rateLimit } from '@/lib/rate-limit'
import { sanitizeText } from '@/lib/validation'
import { smsDispatchService } from '@/lib/services/sms-dispatch.service'
import crypto from 'crypto'

function validateTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string
): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!authToken) {
    if (process.env.NODE_ENV === 'development') return true
    return false
  }
  const sortedKeys = Object.keys(params).sort()
  let data = url
  for (const key of sortedKeys) {
    data += key + params[key]
  }
  const computed = crypto
    .createHmac('sha1', authToken)
    .update(data)
    .digest('base64')
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature))
  } catch {
    return false
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function twimlResponse(message: string): Response {
  return new Response(
    `<Response><Message>${escapeXml(message)}</Message></Response>`,
    { status: 200, headers: { 'Content-Type': 'text/xml' } }
  )
}

function emptyResponse(): Response {
  return new Response('<Response></Response>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  })
}

export async function POST(request: Request) {
  let formData: URLSearchParams
  try {
    const text = await request.text()
    formData = new URLSearchParams(text)
  } catch {
    return emptyResponse()
  }

  const from = formData.get('From') || ''
  const rawBody = formData.get('Body') || ''
  const body = sanitizeText(rawBody).trim()
  const messageSid = formData.get('MessageSid') || ''

  if (!from || !body) return emptyResponse()

  const twilioSignature = request.headers.get('x-twilio-signature') || ''
  const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://dumpsite.io'}/api/sms/webhook`
  const params: Record<string, string> = {}
  formData.forEach((value, key) => { params[key] = value })

  if (!validateTwilioSignature(webhookUrl, params, twilioSignature)) {
    console.error('[SMS] Invalid Twilio signature from:', from)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rl = await rateLimit(`sms-webhook:${from}`, 30, '1 h')
  if (!rl.allowed) return emptyResponse()

  const supabase = createAdminSupabase()
  const bodyLower = body.toLowerCase()

  await supabase.from('sms_log').insert({
    to_phone: from,
    message_type: 'inbound',
    message_body: body.slice(0, 500),
    twilio_sid: messageSid,
    status: 'received',
  })

  if (bodyLower === 'stop' || bodyLower === 'unsubscribe') {
    await supabase
      .from('driver_profiles')
      .update({ sms_opted_out: true })
      .eq('phone', from)
    return emptyResponse()
  }

  if (bodyLower === 'start' || bodyLower === 'subscribe') {
    await supabase
      .from('driver_profiles')
      .update({ sms_opted_out: false })
      .eq('phone', from)
    return twimlResponse('You have been re-subscribed to DumpSite.io notifications. Reply STOP to unsubscribe.')
  }

  const { data: driverCheck } = await supabase
    .from('driver_profiles')
    .select('sms_opted_out')
    .eq('phone', from)
    .maybeSingle()

  if (driverCheck?.sms_opted_out) return emptyResponse()

  if (
    bodyLower.startsWith('done') ||
    bodyLower.startsWith('complete') ||
    bodyLower.startsWith('finished')
  ) {
    const reply = await smsDispatchService.handleIncoming({ from, body, messageSid })
    return twimlResponse(reply)
  }

  if (bodyLower === 'cancel' || bodyLower === 'stop job') {
    const reply = await smsDispatchService.handleIncoming({ from, body, messageSid })
    return twimlResponse(reply)
  }

  if (bodyLower === 'help' || bodyLower === '?') {
    return twimlResponse(
      `DumpSite.io commands:
- Text city + material + yards to get a dump site
- Reply DONE [loads] when complete
- Reply STATUS to check active job
- Reply CANCEL to cancel job
- Reply STOP to unsubscribe
Example: "Fort Worth, clean fill, 200 yards"
Dashboard: dumpsite.io/dashboard`
    )
  }

  if (bodyLower === 'yes' || bodyLower === 'accept' || bodyLower === 'claim') {
    const { data: recentDispatch } = await supabase
      .from('sms_log')
      .select('related_id')
      .eq('to_phone', from)
      .eq('message_type', 'dispatch')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (recentDispatch?.related_id) {
      return twimlResponse(
        `Got it! Log in at dumpsite.io/dashboard to submit your load for job ${recentDispatch.related_id.slice(0, 6).toUpperCase()}. Address released after approval.`
      )
    }
    return twimlResponse('No recent job found. Visit dumpsite.io/dashboard to view available jobs.')
  }

  if (bodyLower === 'status' || bodyLower === 'job') {
    const reply = await smsDispatchService.handleIncoming({ from, body, messageSid })
    return twimlResponse(reply)
  }

  const reply = await smsDispatchService.handleIncoming({ from, body, messageSid })
  return twimlResponse(reply)
}

export async function GET() {
  return new Response(
    JSON.stringify({ status: 'SMS webhook active', timestamp: new Date().toISOString() }),
    { headers: { 'Content-Type': 'application/json' } }
  )
}
