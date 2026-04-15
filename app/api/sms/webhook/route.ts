import { NextResponse } from 'next/server'
import { after } from 'next/server'
import { smsDispatchService } from '@/lib/services/brain.service'
import { computeFinalDelay, shouldSplitMessage } from '@/lib/services/response-delay.service'
import { createAdminSupabase } from '@/lib/supabase'
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

async function alertAdminViaTwilio(message: string) {
  const adminPhone = (process.env.ADMIN_PHONE || '7134439223').replace(/\D/g, '')
  if (!adminPhone || process.env.PAUSE_ADMIN_SMS === 'true') return
  try {
    const { sid, key, secret } = getTwilioAuth()
    const from = process.env.TWILIO_FROM_NUMBER_2 || process.env.TWILIO_FROM_NUMBER || ''
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: `+1${adminPhone}`, From: from, Body: message.slice(0, 300) }).toString(),
    })
  } catch (err) {
    console.error('[admin alert failed]', err)
  }
}

async function sendViaTwilioAPI(to: string, body: string) {
  const { sid, key, secret } = getTwilioAuth()
  const from = process.env.TWILIO_FROM_NUMBER_2 || process.env.TWILIO_FROM_NUMBER || ''
  const digits = to.replace(/\D/g, '')
  const toE164 = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith('1') ? `+${digits}` : `+1${digits}`

  // Outbound dedup: never send the exact same body twice in a row to the same driver.
  // Stops repeat-message bugs that have burned us before.
  try {
    const supabase = createAdminSupabase()
    const { data: lastOut } = await supabase.from('sms_logs')
      .select('body').eq('phone', digits).eq('direction', 'outbound')
      .order('created_at', { ascending: false }).limit(1)
    if (lastOut?.[0]?.body && lastOut[0].body.trim() === body.trim()) {
      console.warn('[delayed SMS] DEDUP — skipping repeat send to', toE164, ':', body.slice(0, 60))
      return
    }
  } catch (err) {
    console.error('[delayed SMS] dedup check failed:', err)
  }

  const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: toE164, From: from, Body: body }).toString(),
  })
  const data = await resp.json()
  if (data.error_code) {
    console.error('[delayed SMS] Twilio error:', data.message, data.error_code)
    try {
      await createAdminSupabase().from("sms_logs").insert({
        phone: digits, body: `TWILIO SEND FAILED: ${data.error_code} ${data.message || ""} — attempted body: ${body.slice(0, 200)}`,
        direction: "error", message_sid: `twilio_err_${Date.now()}`,
      })
    } catch {}
    // NEVER silent fail — alert admin so we know SMS is broken
    await alertAdminViaTwilio(`⚠ TWILIO SEND FAILED to ${toE164}: ${data.error_code} ${data.message || ''} — body: ${body.slice(0, 100)}`)
  }
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

    // CENTRAL OUTBOUND LOG — every reply, every code path. Without this,
    // brain.service.ts early-return branches (GETTING_NAME, after-hours, cancel,
    // error fallback, etc.) bypass logging and the sendViaTwilioAPI dedup at L51-64
    // can't stop repeats. This is the canonical record of "what we said".
    try {
      await createAdminSupabase().from('sms_logs').insert({
        phone, body: reply, direction: 'outbound', message_sid: `wh_${messageSid}`,
      })
    } catch (logErr) {
      console.error('[webhook] outbound log failed:', logErr)
    }
    // Phase 2 — human timing (gated by JESSE_HUMAN_TIMING=1). When off, fall back
    // to the existing naive length-bucketed delay. When on, use log-normal pipeline.
    const humanTiming = process.env.JESSE_HUMAN_TIMING === '1'
    const replyLen = reply.length

    let delay: number
    let splitDecision: { split: boolean; parts: string[] }

    if (humanTiming) {
      // Pull state hint from reply for delay categorization. We don't have the full
      // conv record here, so use a coarse classifier: very short → SIMPLE, else COMPLEX.
      const stateHint = replyLen < 30 ? 'ASKING_TRUCK' : 'DISCOVERY'
      delay = computeFinalDelay(body.length, replyLen, stateHint)
      splitDecision = shouldSplitMessage(reply)
      console.log(`[TIMING] delay=${delay}ms split=${splitDecision.split} parts=${splitDecision.parts.length}`)
    } else {
      const baseDelay = replyLen < 20 ? 3000 : replyLen < 80 ? 6000 : 10000
      const jitter = replyLen < 20 ? 5000 : replyLen < 80 ? 9000 : 15000
      delay = baseDelay + Math.floor(Math.random() * jitter)
      splitDecision = { split: false, parts: [reply] }
    }

    after(async () => {
      await new Promise(r => setTimeout(r, delay))

      for (let partIdx = 0; partIdx < splitDecision.parts.length; partIdx++) {
        const part = splitDecision.parts[partIdx]
        // Inter-part pause: 2-8s between split messages
        if (partIdx > 0) await new Promise(r => setTimeout(r, 2000 + Math.floor(Math.random() * 6000)))

        let sent = false
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            await sendViaTwilioAPI(phone, part)
            sent = true
            break
          } catch (err) {
            console.error(`[jesse] SMS part ${partIdx + 1} attempt ${attempt + 1} failed:`, err)
            if (attempt === 0) await new Promise(r => setTimeout(r, 5000))
          }
        }
        if (!sent) {
          console.error(`[jesse] SMS FAILED BOTH ATTEMPTS for ${phone}: ${part.slice(0, 100)}`)
          await alertAdminViaTwilio(`Jesse SMS delivery failed for ${phone}. Part was: ${part.slice(0, 120)}`)
          break // don't send second part if first failed
        }
      }
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
