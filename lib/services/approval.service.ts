import { createAdminSupabase } from '../supabase'
import twilio from 'twilio'

const ADMIN_PHONE = '7134439223'
const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER || ''

function getTwilioClient() {
  return twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
}

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
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
  try {
    const client = getTwilioClient()
    const formattedPhone = formatPhone(customerPhone)

    const message = `DumpSite.io: ${driverName} has clean fill ready to deliver now — ${yardsNeeded} yds
Photo: ${photoUrl}
Reply YES to approve delivery or NO to decline (Code: ${approvalCode})`

    await client.messages.create({
      to: formattedPhone,
      from: TWILIO_FROM,
      body: message
    })

    return true
  } catch (err: any) {
    console.error('[sendCustomerApproval]', err?.message)
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
