import { createAdminSupabase } from '../supabase'
import twilio from 'twilio'

const ADMIN_PHONE = '7134439223'
const TWILIO_FROM = process.env.TWILIO_FROM_NUMBER_2 || process.env.TWILIO_FROM_NUMBER || ''

function getTwilioClient() {
  return twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
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
    const ext = contentType.includes('png') ? 'png' : contentType.includes('gif') ? 'gif' : 'jpg'
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
  const fromNumber = TWILIO_FROM
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

  const client = getTwilioClient()
  const supabase = createAdminSupabase()

  // Generate a fresh signed URL valid for 2 hours so Twilio can always fetch it
  let mediaUrlToSend = photoUrl
  try {
    if (photoUrl && photoUrl.includes('supabase')) {
      // Extract storage path from public URL
      const pathMatch = photoUrl.match(/material-photos\/(.+)$/)
      if (pathMatch) {
        const { data: signed } = await supabase.storage
          .from('material-photos')
          .createSignedUrl(pathMatch[1], 7200)
        if (signed?.signedUrl) {
          mediaUrlToSend = signed.signedUrl
          console.log('[approval] using signed URL:', mediaUrlToSend.slice(0, 80))
        }
      }
    }
  } catch (signErr: any) {
    console.error('[approval] signed URL error:', signErr?.message)
  }

  const body = `DumpSite: ${driverName} has dirt ready to deliver to your property — ${yardsNeeded} yds. Reply YES to approve or NO to decline.`

  // Try MMS with photo
  if (mediaUrlToSend) {
    try {
      const msg = await client.messages.create({
        to: formattedPhone,
        from: fromNumber,
        body,
        mediaUrl: [mediaUrlToSend]
      })
      console.log('[approval] MMS sent. SID:', msg.sid)
      return true
    } catch (mmsErr: any) {
      console.error('[approval] MMS failed:', mmsErr?.message, mmsErr?.code)
    }
  }

  // Fallback: SMS with link
  try {
    const fallbackBody = body + (mediaUrlToSend ? `\nDirt photo: ${mediaUrlToSend}` : '')
    const msg = await client.messages.create({
      to: formattedPhone,
      from: fromNumber,
      body: fallbackBody
    })
    console.log('[approval] SMS fallback sent. SID:', msg.sid)
    return true
  } catch (smsErr: any) {
    console.error('[approval] ALL sends failed:', smsErr?.message, smsErr?.code, 'to:', formattedPhone, 'from:', fromNumber)
    return false
  }
}

export async function makeVoiceCallToCustomer(
  customerPhone: string,
  driverName: string,
  yardsNeeded: number,
  approvalCode: string
): Promise<boolean> {
  try {
    const client = getTwilioClient()
    const formattedPhone = formatPhone(customerPhone)

    await client.calls.create({
      to: formattedPhone,
      from: TWILIO_FROM,
      twiml: `<Response>
        <Say voice="man" language="en-US">
          Hello, this is Dumpsite. ${driverName} has clean fill dirt ready to deliver to your property right now — ${yardsNeeded} yards.
          Please reply YES to the text message to approve the delivery, or NO to decline.
          Your approval code is ${approvalCode.split('').join(', ')}.
          Thank you.
        </Say>
        <Pause length="2"/>
        <Say voice="man" language="en-US">
          Again, reply YES to approve or NO to decline. Goodbye.
        </Say>
      </Response>`
    })

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
    const client = getTwilioClient()
    const message = `DumpSite ESCALATION (${reason}):
Job: ${orderJobNumber} — ${city}
Driver: ${driverName} (${driverPhone})
${yards} yds — $${payPerLoad}/load
Reply: APPROVE-${approvalCode} or REJECT-${approvalCode}`

    await client.messages.create({
      to: formatPhone(ADMIN_PHONE),
      from: TWILIO_FROM,
      body: message
    })
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
