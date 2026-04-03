import { NextResponse } from 'next/server'
import { after } from 'next/server'
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

function getTwilioAuth(): { sid: string; key: string; secret: string } {
  const rawSid = process.env.TWILIO_ACCOUNT_SID || ''
  const apiKey = process.env.TWILIO_API_KEY
  const apiSecret = process.env.TWILIO_API_SECRET
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (apiKey && apiSecret) return { sid: rawSid, key: apiKey, secret: apiSecret }
  return { sid: rawSid, key: rawSid, secret: authToken || '' }
}

async function sendViaTwilioAPI(to: string, body: string) {
  const { sid, key, secret } = getTwilioAuth()
  const from = process.env.TWILIO_FROM_NUMBER_2 || process.env.TWILIO_FROM_NUMBER || ''
  const digits = to.replace(/\D/g, '')
  const toE164 = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith('1') ? `+${digits}` : `+1${digits}`
  const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: toE164, From: from, Body: body }).toString(),
  })
  const data = await resp.json()
  if (data.error_code) console.error('[delayed SMS] Twilio error:', data.message, data.error_code)
  else console.log('[delayed SMS] sent to', toE164, 'SID:', data.sid)
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
  const mediaContentType = numMedia > 0 ? formData.get('MediaContentType0') || undefined : undefined

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
      from, body: body.trim(), messageSid, mediaUrl, mediaContentType, numMedia
    })
    if (!reply) return new Response('<Response></Response>', { status: 200, headers: { 'Content-Type': 'text/xml' } })

    // Human-like delay: scale with message complexity
    // Short acks (10.4, bet, copy) = 3-8s, medium = 6-15s, long/address = 10-25s
    const phone = from.replace(/\D/g, '').replace(/^1/, '')
    const replyLen = reply.length
    const baseDelay = replyLen < 20 ? 3000 : replyLen < 80 ? 6000 : 10000
    const jitter = replyLen < 20 ? 5000 : replyLen < 80 ? 9000 : 15000
    const delay = baseDelay + Math.floor(Math.random() * jitter)

    after(async () => {
      await new Promise(r => setTimeout(r, delay))
      await sendViaTwilioAPI(phone, reply)
    })

    return new Response('<Response></Response>', { status: 200, headers: { 'Content-Type': 'text/xml' } })
  } catch (err) {
    console.error('[SMS webhook error]', err)
    // Error fallback — send immediately since something went wrong
    return new Response(
      '<Response><Message>Give me a sec</Message></Response>',
      { status: 200, headers: { 'Content-Type': 'text/xml' } }
    )
  }
}

export async function GET() {
  return new Response(JSON.stringify({ status: 'active' }), { headers: { 'Content-Type': 'application/json' } })
}
