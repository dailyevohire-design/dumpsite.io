import { createAdminSupabase } from '../supabase'
import { insertSmsLog } from '../sms'

const ADMIN_PHONE = (process.env.ADMIN_PHONE || '7134439223').replace(/\D/g, '')

function getTwilioFrom(): string {
  return process.env.TWILIO_FROM_NUMBER_2 || process.env.TWILIO_FROM_NUMBER || ''
}

function getTwilioAuth(): { sid: string; key: string; secret: string } {
  const rawSid = process.env.TWILIO_ACCOUNT_SID || ''
  const apiKey = process.env.TWILIO_API_KEY
  const apiSecret = process.env.TWILIO_API_SECRET
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (apiKey && apiSecret) {
    return { sid: rawSid, key: apiKey, secret: apiSecret }
  }
  return { sid: rawSid, key: rawSid, secret: authToken || '' }
}

async function twilioSend(to: string, from: string, body: string, mediaUrl?: string): Promise<{ success: boolean; sid?: string; error?: string }> {
  const { sid, key, secret } = getTwilioAuth()
  const params: Record<string, string> = { To: to, From: from, Body: body }
  if (mediaUrl) params.MediaUrl = mediaUrl
  try {
    const resp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(params).toString(),
      }
    )
    const data = await resp.json()
    if (data.error_code || data.status === 'failed') {
      console.error('[approval] Twilio error:', data.message, data.error_code)
      return { success: false, error: `${data.error_code}: ${data.message}` }
    }
    return { success: true, sid: data.sid }
  } catch (e: any) {
    console.error('[approval] fetch error:', e.message)
    return { success: false, error: e.message }
  }
}

function formatPhone(phone: string): string {
  if (!phone) return ''
  // Strip everything except digits
  const digits = phone.replace(/\D/g, '')
  // Handle all formats: (817) 676-7467, 817-676-7467, +18176767467, 8176767467
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (digits.length === 11) return `+1${digits.slice(1)}`
  // Already has country code without +
  if (digits.length > 11) return `+${digits}`
  return `+1${digits}`
}

export async function downloadAndStorePhoto(
  mediaUrl: string,
  driverPhone: string,
  orderId: string
): Promise<{ storagePath: string; publicUrl: string } | null> {
  try {
    const supabase = createAdminSupabase()

    // Download photo from Twilio (requires auth)
    const accountSid = process.env.TWILIO_ACCOUNT_SID!
    const authToken = process.env.TWILIO_AUTH_TOKEN!
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64')

    const response = await fetch(mediaUrl, {
      headers: { 'Authorization': `Basic ${auth}` }
    })

    if (!response.ok) {
      console.error('[photo download] failed:', response.status)
      return null
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg'
    // Preserve original extension — iPhones send HEIC, Android sometimes WEBP. If we
    // mislabel them as .jpg, the resigned URL Twilio fetches later will be a corrupt
    // image and the customer sees a broken approval MMS.
    const ext = contentType.includes('heic') ? 'heic'
      : contentType.includes('heif') ? 'heif'
      : contentType.includes('webp') ? 'webp'
      : contentType.includes('png') ? 'png'
      : contentType.includes('gif') ? 'gif'
      : 'jpg'
    const buffer = await response.arrayBuffer()
    const storagePath = `${driverPhone}/${orderId}/${Date.now()}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from('material-photos')
      .upload(storagePath, buffer, { contentType, upsert: true })

    if (uploadError) {
      console.error('[photo upload]', uploadError.message)
      return null
    }

    const { data: urlData } = supabase.storage.from('material-photos').getPublicUrl(storagePath)

    return { storagePath, publicUrl: urlData.publicUrl }
  } catch (err: any) {
    console.error('[downloadAndStorePhoto]', err?.message)
    return null
  }
}

export async function sendCustomerApprovalRequest(
  customerPhone: string,
  customerName: string,
  driverName: string,
  orderId: string,
  yardsNeeded: number,
  photoUrl: string,
  approvalCode: string
): Promise<boolean> {
  const fromNumber = getTwilioFrom()
  const formattedPhone = formatPhone(customerPhone)

  console.log('[approval] sending to:', formattedPhone, 'from:', fromNumber, 'photo:', photoUrl?.slice(0,80))

  if (!fromNumber) {
    console.error('[approval] TWILIO_FROM is empty. Set TWILIO_FROM_NUMBER_2 in Vercel env vars')
    return false
  }

  if (!formattedPhone || formattedPhone.length < 10) {
    console.error('[approval] invalid customer phone:', customerPhone)
    return false
  }

  const supabase = createAdminSupabase()

  // Generate a fresh signed URL valid for 2 hours so Twilio can always fetch it
  let mediaUrlToSend = photoUrl
  try {
    if (photoUrl && photoUrl.includes('supabase')) {
      const pathMatch = photoUrl.match(/material-photos\/(.+)$/)
      if (pathMatch) {
        const { data: signed } = await supabase.storage
          .from('material-photos')
          .createSignedUrl(pathMatch[1], 7200)
        if (signed?.signedUrl) {
          mediaUrlToSend = signed.signedUrl
        }
      }
    }
  } catch (signErr: any) {
    console.error('[approval] signed URL error:', signErr?.message)
  }

  const body = `DumpSite: ${driverName} has dirt ready to deliver to your property — ${yardsNeeded} yds. Reply YES to approve or NO to decline.`

  // Store approval attempt in DB for tracking (mirrors what Twilio will receive below)
  try {
    await insertSmsLog(supabase, 'sms_logs', {
      phone: customerPhone.replace(/\D/g, ''),
      body,
      direction: 'outbound',
    })
  } catch {}

  // Try MMS with photo using same auth as lib/sms.ts
  if (mediaUrlToSend) {
    const result = await twilioSend(formattedPhone, fromNumber, body, mediaUrlToSend)
    if (result.success) {
      console.log('[approval] MMS sent. SID:', result.sid)
      return true
    }
    console.error('[approval] MMS failed:', result.error)
  }

  // Fallback: SMS without photo
  const fallbackBody = body + (mediaUrlToSend ? `\nDirt photo: ${mediaUrlToSend}` : '')
  const result = await twilioSend(formattedPhone, fromNumber, fallbackBody)
  if (result.success) {
    console.log('[approval] SMS fallback sent. SID:', result.sid)
    return true
  }
  console.error('[approval] ALL sends failed:', result.error, 'to:', formattedPhone, 'from:', fromNumber)
  return false
}

export async function makeVoiceCallToCustomer(
  customerPhone: string,
  driverName: string,
  yardsNeeded: number,
  approvalCode: string
): Promise<boolean> {
  try {
    const { sid, key, secret } = getTwilioAuth()
    const formattedPhone = formatPhone(customerPhone)
    const from = getTwilioFrom()
    const twiml = `<Response><Say voice="man" language="en-US">Hello, this is Dumpsite. ${driverName} has clean fill dirt ready to deliver to your property right now, ${yardsNeeded} yards. Please reply YES to the text message to approve the delivery, or NO to decline. Your approval code is ${approvalCode.split('').join(', ')}. Thank you.</Say><Pause length="2"/><Say voice="man" language="en-US">Again, reply YES to approve or NO to decline. Goodbye.</Say></Response>`

    const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: formattedPhone, From: from, Twiml: twiml }).toString(),
    })
    const data = await resp.json()
    if (data.error_code) {
      console.error('[voiceCall] Twilio error:', data.message)
      return false
    }
    return true
  } catch (err: any) {
    console.error('[voiceCall]', err?.message)
    return false
  }
}

export async function sendAdminEscalation(
  orderId: string,
  orderJobNumber: string,
  driverName: string,
  driverPhone: string,
  city: string,
  yards: number,
  payPerLoad: number,
  reason: string,
  approvalCode: string
): Promise<void> {
  try {
    const message = `DumpSite ESCALATION (${reason}):
Job: ${orderJobNumber} — ${city}
Driver: ${driverName} (${driverPhone})
${yards} yds — $${payPerLoad}/load
Reply: APPROVE-${approvalCode} or REJECT-${approvalCode}`

    await twilioSend(formatPhone(ADMIN_PHONE), getTwilioFrom(), message)
  } catch (err: any) {
    console.error('[adminEscalation]', err?.message)
  }
}

export async function processAdminApproval(
  approvalCode: string,
  approved: boolean
): Promise<{ driverPhone: string; orderId: string } | null> {
  const supabase = createAdminSupabase()

  const { data: escalation } = await supabase
    .from('escalation_queue')
    .select('*')
    .eq('approval_code', approvalCode)
    .eq('status', 'pending')
    .maybeSingle()

  if (!escalation) return null

  await supabase.from('escalation_queue').update({
    status: approved ? 'approved' : 'rejected',
    admin_response: approved ? 'APPROVED' : 'REJECTED',
    updated_at: new Date().toISOString()
  }).eq('id', escalation.id)

  return { driverPhone: escalation.driver_phone, orderId: escalation.order_id }
}

export async function processCustomerApproval(
  customerPhone: string,
  approved: boolean
): Promise<{ driverPhone: string; orderId: string } | null> {
  const supabase = createAdminSupabase()
  const normalizedCustomer = customerPhone.replace(/\D/g, '').replace(/^1/, '')

  // Find pending approval for this customer
  const { data: orders } = await supabase
    .from('dispatch_orders')
    .select('id, client_phone')
    .in('status', ['dispatching', 'active', 'pending'])

  const matchedOrder = orders?.find(o => {
    const normalized = (o.client_phone || '').replace(/\D/g, '').replace(/^1/, '')
    return normalized === normalizedCustomer
  })

  if (!matchedOrder) return null

  // Find the conversation waiting for this approval
  const { data: conv } = await supabase
    .from('conversations')
    .select('phone, pending_approval_order_id')
    .eq('pending_approval_order_id', matchedOrder.id)
    .eq('state', 'APPROVAL_PENDING')
    .maybeSingle()

  if (!conv) return null

  return { driverPhone: conv.phone, orderId: matchedOrder.id }
}
