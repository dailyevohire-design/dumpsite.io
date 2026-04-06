import { NextRequest, NextResponse } from "next/server"
import { after } from "next/server"
import { handleCustomerSMS } from "@/lib/services/customer-brain.service"
import { createAdminSupabase } from "@/lib/supabase"
import crypto from "crypto"
import twilio from "twilio"

const ADMIN_PHONE = (process.env.ADMIN_PHONE || "7134439223").replace(/\D/g, "")
const ADMIN_PHONE_2 = (process.env.ADMIN_PHONE_2 || "").replace(/\D/g, "")

function validateTwilioSignature(url: string, params: Record<string, string>, signature: string): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!authToken) return process.env.NODE_ENV === "development"
  const sortedKeys = Object.keys(params).sort()
  let data = url
  for (const key of sortedKeys) data += key + params[key]
  const computed = crypto.createHmac("sha1", authToken).update(data).digest("base64")
  try { return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature)) } catch { return false }
}

function getTwilioAuth(): { sid: string; key: string; secret: string } {
  const rawSid = process.env.TWILIO_ACCOUNT_SID || ""
  const apiKey = process.env.TWILIO_API_KEY
  const apiSecret = process.env.TWILIO_API_SECRET
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (apiKey && apiSecret) return { sid: rawSid, key: apiKey, secret: apiSecret }
  return { sid: rawSid, key: rawSid, secret: authToken || "" }
}

async function alertAdmin(msg: string) {
  if (process.env.PAUSE_ADMIN_SMS === "true") return
  const adminFrom = process.env.TWILIO_FROM_NUMBER_2 || process.env.TWILIO_FROM_NUMBER || ""
  if (!adminFrom) return
  const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
  try { await client.messages.create({ body: msg, from: adminFrom, to: `+1${ADMIN_PHONE}` }) } catch (e) {
    console.error("[alertAdmin] FAILED to alert primary admin:", (e as any)?.message)
    // Log to DB as last resort so we have a record
    try { await createAdminSupabase().from("customer_sms_logs").insert({ phone: "system", body: `ADMIN ALERT FAILED: ${msg.slice(0, 300)}`, direction: "error", message_sid: `alert_fail_${Date.now()}` }) } catch {}
  }
  if (ADMIN_PHONE_2) {
    try { await client.messages.create({ body: msg, from: adminFrom, to: `+1${ADMIN_PHONE_2}` }) } catch (e) {
      console.error("[alertAdmin] FAILED to alert secondary admin:", (e as any)?.message)
    }
  }
}

async function sendViaTwilioAPI(to: string, body: string, agentFrom?: string): Promise<boolean> {
  const { sid, key, secret } = getTwilioAuth()
  const from = agentFrom || process.env.CUSTOMER_TWILIO_NUMBER || process.env.TWILIO_FROM_NUMBER_2 || process.env.TWILIO_FROM_NUMBER || ""
  const digits = to.replace(/\D/g, "")
  const toE164 = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith("1") ? `+${digits}` : `+1${digits}`

  console.log(`[customer SMS] sending to ${toE164} from ${from}`)

  try {
    const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        "Authorization": "Basic " + Buffer.from(`${key}:${secret}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: toE164, From: from, Body: body }).toString(),
    })
    const data = await resp.json()
    if (data.error_code) {
      console.error("[customer SMS] Twilio error:", data.message, data.error_code)
      try {
        await createAdminSupabase().from("customer_sms_logs").insert({
          phone: digits, body: `TWILIO SEND FAILED: ${data.error_code} ${data.message || ""} — attempted body: ${body.slice(0, 200)}`,
          direction: "error", message_sid: `twilio_err_${Date.now()}`,
        })
      } catch {}
      return false
    }
    console.log("[customer SMS] sent OK SID:", data.sid)
    return true
  } catch (err) {
    console.error("[customer SMS] fetch to Twilio threw:", err)
    return false
  }
}

export async function POST(req: NextRequest) {
  let formData: URLSearchParams
  try {
    const text = await req.text()
    formData = new URLSearchParams(text)
  } catch {
    return new Response("<Response></Response>", { status: 200, headers: { "Content-Type": "text/xml" } })
  }

  const from = formData.get("From") || ""
  const to = formData.get("To") || ""
  const body = formData.get("Body") || ""
  const messageSid = formData.get("MessageSid") || ""
  const numMedia = parseInt(formData.get("NumMedia") || "0")
  const mediaUrl = numMedia > 0 ? formData.get("MediaUrl0") || undefined : undefined

  if (!from || !messageSid) {
    return new Response("<Response></Response>", { status: 200, headers: { "Content-Type": "text/xml" } })
  }

  // Validate Twilio signature in production
  const twilioSignature = req.headers.get("x-twilio-signature") || ""
  // Use the configured webhook URL (must match what Twilio has configured, NOT the request URL which may differ behind proxies)
  const webhookUrl = process.env.TWILIO_CUSTOMER_WEBHOOK_URL || `${process.env.NEXT_PUBLIC_APP_URL || "https://dumpsite.io"}/api/sms/customer-webhook`
  const params: Record<string, string> = {}
  formData.forEach((value, key) => { params[key] = value })

  if (process.env.NODE_ENV === "production" && !validateTwilioSignature(webhookUrl, params, twilioSignature)) {
    console.error("[Customer SMS] Invalid Twilio signature")
    return new Response("Unauthorized", { status: 401 })
  }

  try {
    const reply = await handleCustomerSMS({ from, to, body: body.trim(), messageSid, numMedia, mediaUrl })
    if (!reply) return new Response("<Response></Response>", { status: 200, headers: { "Content-Type": "text/xml" } })

    const phone = from.replace(/\D/g, "").replace(/^1/, "")

    // Mark the reply as PENDING in DB before entering after() — this is the crash recovery marker.
    // If after() dies, the healthcheck/recovery cron can find unsent replies by looking for
    // "pending_send" direction entries with no matching "outbound" entry.
    const pendingSid = `pending_${messageSid}`
    try {
      await createAdminSupabase().from("customer_sms_logs").insert({
        phone, body: reply, direction: "pending_send", message_sid: pendingSid,
      })
    } catch {}

    // Human-like delay, then send with retry + admin alert on failure
    const delay = 5000

    after(async () => {
      try {
        await new Promise(r => setTimeout(r, delay))
        // Reply FROM the same Twilio number the customer texted (agent routing)
        const replyFrom = to || undefined
        const sent = await sendViaTwilioAPI(phone, reply, replyFrom)
        if (!sent) {
          // Retry once after 3 seconds
          console.error(`[customer SMS] FIRST SEND FAILED to ${phone}, retrying in 3s...`)
          await new Promise(r => setTimeout(r, 3000))
          const retrySent = await sendViaTwilioAPI(phone, reply, replyFrom)
          if (!retrySent) {
            // Both attempts failed — alert admin immediately
            console.error(`[customer SMS] BOTH SENDS FAILED to ${phone}`)
            await alertAdmin(`SMS SEND FAILED TWICE to ${phone}. Customer got NO reply. Their message: "${body.slice(0, 100)}". Our reply was: "${reply.slice(0, 100)}"`)
            try {
              await createAdminSupabase().from("customer_sms_logs").insert({
                phone, body: `SEND FAILED TWICE — reply lost: ${reply.slice(0, 200)}`,
                direction: "error", message_sid: `send_fail_${messageSid}`,
              })
            } catch {}
            return // Leave pending_send marker for recovery cron
          }
        }
        // Success — remove the pending_send marker
        try {
          await createAdminSupabase().from("customer_sms_logs").delete().eq("message_sid", pendingSid)
        } catch {}
      } catch (afterErr) {
        // after() itself crashed — log it, leave pending_send for recovery
        console.error("[customer SMS] after() CRASHED:", afterErr)
        try {
          await createAdminSupabase().from("customer_sms_logs").insert({
            phone, body: `AFTER CRASHED — reply may be lost: ${reply.slice(0, 200)}`,
            direction: "error", message_sid: `after_crash_${messageSid}`,
          })
        } catch {}
      }
    })

    return new Response("<Response></Response>", { status: 200, headers: { "Content-Type": "text/xml" } })
  } catch (err) {
    console.error("[Customer webhook error]", err)
    // Log the fallback so conversation history is accurate
    const fallbackPhone = from.replace(/\D/g, "").replace(/^1/, "")
    try { await createAdminSupabase().from("customer_sms_logs").insert({ phone: fallbackPhone, body: "Give me just a moment", direction: "outbound", message_sid: `fallback_${messageSid}` }) } catch {}
    // Fallback: return TwiML directly so customer at least gets something
    return new Response(
      '<Response><Message>Give me just a moment</Message></Response>',
      { status: 200, headers: { "Content-Type": "text/xml" } }
    )
  }
}

export async function GET() {
  return NextResponse.json({ status: "Customer SMS webhook active" })
}
