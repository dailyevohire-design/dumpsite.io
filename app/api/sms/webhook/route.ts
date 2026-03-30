import { NextResponse } from 'next/server'
import { smsDispatchService } from '@/lib/services/brain.service'
import crypto from 'crypto'

function validateTwilioSignature(url: string, params: Record<string, string>, signature: string): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!authToken) return process.env.NODE_ENV === 'development'
  const sortedKeys = Object.keys(params).sort()
  let data = url
  for (const key of sortedKeys) data += key + params[key]
  const computed = crypto.createHmac('sha1', authToken).update(data).digest('base64')
  try { return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature)) } catch { return false }
}

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

export async function POST(request: Request) {
  let formData: URLSearchParams
  try {
    const text = await request.text()
    formData = new URLSearchParams(text)
  } catch {
    return new Response('<Response></Response>', { status: 200, headers: { 'Content-Type': 'text/xml' } })
  }

  const from = formData.get('From') || ''
  const body = formData.get('Body') || ''
  const messageSid = formData.get('MessageSid') || ''
  const numMedia = parseInt(formData.get('NumMedia') || '0')
  const mediaUrl = numMedia > 0 ? formData.get('MediaUrl0') || undefined : undefined

  if (!from || !messageSid) {
    return new Response('<Response></Response>', { status: 200, headers: { 'Content-Type': 'text/xml' } })
  }

  const twilioSignature = request.headers.get('x-twilio-signature') || ''
  const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://dumpsite.io'}/api/sms/webhook`
  const params: Record<string, string> = {}
  formData.forEach((value, key) => { params[key] = value })

  if (process.env.NODE_ENV === 'production' && !validateTwilioSignature(webhookUrl, params, twilioSignature)) {
    console.error('[SMS] Invalid Twilio signature')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const reply = await smsDispatchService.handleIncoming({
      from, body: body.trim(), messageSid, mediaUrl, numMedia
    })
    if (!reply) return new Response('<Response></Response>', { status: 200, headers: { 'Content-Type': 'text/xml' } })
    return new Response(
      `<Response><Message>${escapeXml(reply)}</Message></Response>`,
      { status: 200, headers: { 'Content-Type': 'text/xml' } }
    )
  } catch (err) {
    console.error('[SMS webhook error]', err)
    return new Response(
      '<Response><Message>Give me a sec</Message></Response>',
      { status: 200, headers: { 'Content-Type': 'text/xml' } }
    )
  }
}

export async function GET() {
  return new Response(JSON.stringify({ status: 'active' }), { headers: { 'Content-Type': 'application/json' } })
}
