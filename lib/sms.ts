import { createAdminSupabase } from './supabase'

function getTwilioConfig() {
  const sid    = process.env.TWILIO_ACCOUNT_SID
  // Support both API Key auth and Auth Token auth
  const key    = process.env.TWILIO_API_KEY || sid
  const secret = process.env.TWILIO_API_SECRET || process.env.TWILIO_AUTH_TOKEN
  const from   = process.env.TWILIO_FROM_NUMBER
  const admin  = process.env.ADMIN_PHONE
  if (!sid || !key || !secret || !from || !admin) {
    throw new Error('Missing Twilio env vars — check TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN (or TWILIO_API_KEY+TWILIO_API_SECRET), TWILIO_FROM_NUMBER, ADMIN_PHONE')
  }
  return { sid, key, secret, from, admin }
}

async function sendSMS(to: string, body: string, messageType: string, relatedId?: string) {
  const supabase = createAdminSupabase()
  const { sid, key, secret, from } = getTwilioConfig()
  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({ To: to, From: from, Body: body }).toString()
      }
    )
    const data = await response.json()
    if (data.error_code) {
      console.error('Twilio error:', data.message)
      supabase.from('sms_log').insert({ to_phone: to, message_type: messageType, message_body: body, status: 'failed', related_id: relatedId }).then(() => {})
      return { success: false, error: data.message }
    }
    supabase.from('sms_log').insert({ to_phone: to, message_type: messageType, message_body: body, twilio_sid: data.sid, status: 'sent', related_id: relatedId }).then(() => {})
    return { success: true, sid: data.sid }
  } catch (error: any) {
    console.error('SMS failed:', error.message)
    return { success: false, error: error.message }
  }
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return '+1' + digits
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits
  if (phone.startsWith('+')) return phone
  return '+1' + digits
}

export async function sendApprovalSMS(phone: string, opts: {
  accessUrl: string
  loadId: string
  payDollars: number
  cityName: string
}) {
  const normalized = normalizePhone(phone)
  const body = `✅ DumpSite.io APPROVED!\n\nJob area: ${opts.cityName}\nPay: $${opts.payDollars}/load\n\nOpen your secure job link:\n${opts.accessUrl}\n\nThis link is required to start the job and unlock site details.\n\nReply STOP to unsubscribe.`
  return sendSMS(normalized, body, 'approval', opts.loadId)
}

export async function sendRejectionSMS(phone: string, opts: { reason: string; loadId: string }) {
  const normalized = normalizePhone(phone)
  const body = `DumpSite.io: Your load request was not approved.\n\nReason: ${opts.reason}\n\nQuestions? Visit dumpsite.io/dashboard`
  return sendSMS(normalized, body, 'rejection', opts.loadId)
}

export async function sendDispatchSMS(phone: string, opts: {
  cityName: string
  yardsNeeded: number
  payDollars: number
  haulDate: string
  dispatchId: string
  tierSlug: string
}) {
  const normalized = normalizePhone(phone)
  const urgencyLine = opts.tierSlug === 'elite' ? '🔥 PRIORITY JOB — ' : ''
  const body = `${urgencyLine}DumpSite.io Job Available!\n\n📍 ${opts.cityName}\n📦 ${opts.yardsNeeded} yards needed\n💰 $${opts.payDollars}/load\n📅 ${opts.haulDate}\n\nLog in to claim: dumpsite.io/dashboard\n\nReply STOP to unsubscribe.`
  return sendSMS(normalized, body, 'dispatch', opts.dispatchId)
}

export async function sendAdminAlert(message: string) {
  const { admin } = getTwilioConfig()
  return sendSMS(admin, `DumpSite.io Alert: ${message}`, 'admin_alert')
}

export interface DispatchDriver {
  phone: string
  tierSlug: string
  dispatchId: string
  cityName: string
  yardsNeeded: number
  payDollars: number
  haulDate: string
}

export async function batchDispatchSMS(drivers: DispatchDriver[]): Promise<{ sent: number; failed: number }> {
  const TIER_DELAYS: Record<string, number> = { elite: 0, pro: 2, hauler: 5, trial: 10 }
  let sent = 0
  let failed = 0

  // Group by tier for ordered dispatch
  const byTier: Record<string, DispatchDriver[]> = {}
  for (const d of drivers) {
    const tier = d.tierSlug || 'trial'
    if (!byTier[tier]) byTier[tier] = []
    byTier[tier].push(d)
  }

  const order = ['elite', 'pro', 'hauler', 'trial']
  for (const tier of order) {
    const group = byTier[tier] || []
    const delayMinutes = TIER_DELAYS[tier] || 10

    for (const driver of group) {
      if (delayMinutes === 0) {
        const result = await sendDispatchSMS(driver.phone, {
          cityName: driver.cityName,
          yardsNeeded: driver.yardsNeeded,
          payDollars: driver.payDollars,
          haulDate: driver.haulDate,
          dispatchId: driver.dispatchId,
          tierSlug: driver.tierSlug,
        })
        if (result.success) sent++
        else failed++
      } else {
        // Send immediately for now — QStash migration is next sprint
        const result = await sendDispatchSMS(driver.phone, {
          cityName: driver.cityName,
          yardsNeeded: driver.yardsNeeded,
          payDollars: driver.payDollars,
          haulDate: driver.haulDate,
          dispatchId: driver.dispatchId,
          tierSlug: driver.tierSlug,
        })
        if (result.success) sent++
        else failed++
      }
    }
  }

  return { sent, failed }
}
