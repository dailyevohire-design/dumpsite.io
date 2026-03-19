import { createAdminSupabase } from './supabase'

function getTwilioConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const apiKey     = process.env.TWILIO_API_KEY
  const apiSecret  = process.env.TWILIO_API_SECRET
  const from       = process.env.TWILIO_FROM_NUMBER
  const adminPhone = process.env.ADMIN_PHONE
  if (!accountSid || !apiKey || !apiSecret || !from || !adminPhone) {
    throw new Error('Missing Twilio env vars')
  }
  return { accountSid, apiKey, apiSecret, from, adminPhone }
}

async function sendSMS(to: string, body: string, messageType: string, relatedId?: string) {
  const supabase = createAdminSupabase()
  const { accountSid, apiKey, apiSecret, from } = getTwilioConfig()
  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${apiKey}:${apiSecret}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
      }
    )
    const data = await response.json()
    if (data.error_code) {
      console.error('Twilio error:', data.message)
      await supabase.from('sms_log').insert({ to_phone: to, message_type: messageType, message_body: body, status: 'failed', related_id: relatedId })
      return { success: false, error: data.message }
    }
    await supabase.from('sms_log').insert({ to_phone: to, message_type: messageType, message_body: body, twilio_sid: data.sid, status: 'sent', related_id: relatedId })
    return { success: true, sid: data.sid }
  } catch (error: any) {
    console.error('SMS failed:', error.message)
    return { success: false, error: error.message }
  }
}

export async function sendDispatchSMS(driverPhone: string, data: { cityName: string; yardsNeeded: number; haulDate: string; dispatchId: string }) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dumpsite.io'
  const body = `DumpSite.io - New delivery job!\n📍 ${data.cityName}\n📦 ${data.yardsNeeded} yards needed\n📅 ${data.haulDate}\nTap to request: ${appUrl}/dashboard\nReply STOP to unsubscribe`
  return sendSMS(driverPhone, body, 'dispatch', data.dispatchId)
}

export async function sendApprovalSMS(driverPhone: string, data: { plainAddress: string; gateCode: string | null; accessInstructions: string | null; loadId: string; payDollars: number }) {
  const lines = [
    '✅ DumpSite.io APPROVED!',
    `📍 Delivery address: ${data.plainAddress}`,
    data.gateCode ? `🔑 Gate code: ${data.gateCode}` : null,
    data.accessInstructions ? `ℹ️ ${data.accessInstructions}` : null,
    `💰 Your pay: $${data.payDollars}/load`,
    'Call us if you have any issues.',
    '-DumpSite.io',
  ].filter(Boolean).join('\n')
  return sendSMS(driverPhone, lines, 'approval', data.loadId)
}

export async function sendRejectionSMS(driverPhone: string, data: { reason: string; loadId: string }) {
  const body = `DumpSite.io - Load Not Approved\nReason: ${data.reason}\nPlease submit a new request with clean fill dirt.\n-DumpSite.io`
  return sendSMS(driverPhone, body, 'rejection', data.loadId)
}

export async function sendPayoutSMS(driverPhone: string, data: { amountDollars: number; loadId: string }) {
  const body = `💸 DumpSite.io - Payout Sent!\n$${data.amountDollars} transferred to your bank.\nArrives in 1-2 business days.\n-DumpSite.io`
  return sendSMS(driverPhone, body, 'payout', data.loadId)
}

export async function sendAdminAlert(message: string) {
  const { adminPhone } = getTwilioConfig()
  return sendSMS(adminPhone, `DumpSite Admin: ${message}`, 'admin_alert')
}

export async function batchDispatchSMS(drivers: Array<{ phone: string; tierSlug: string; dispatchId: string; cityName: string; yardsNeeded: number; haulDate: string }>) {
  const delayMap: Record<string, number> = { elite: 0, pro: 15 * 60 * 1000, hauler: 30 * 60 * 1000, trial: 45 * 60 * 1000 }
  let sent = 0, failed = 0
  for (const driver of drivers) {
    const delay = delayMap[driver.tierSlug] ?? 0
    const sendFn = async () => {
      const result = await sendDispatchSMS(driver.phone, { cityName: driver.cityName, yardsNeeded: driver.yardsNeeded, haulDate: driver.haulDate, dispatchId: driver.dispatchId })
      if (result.success) sent++; else failed++
    }
    if (delay === 0) await sendFn()
    else setTimeout(sendFn, delay)
  }
  return { sent, failed }
}
