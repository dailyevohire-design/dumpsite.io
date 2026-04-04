import { NextRequest, NextResponse } from "next/server"
import { after } from "next/server"
import { handleCustomerSMS } from "@/lib/services/customer-brain.service"
import { createAdminSupabase } from "@/lib/supabase"
import crypto from "crypto"

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

async function sendViaTwilioAPI(to: string, body: string) {
  const { sid, key, secret } = getTwilioAuth()
  // Use CUSTOMER number first, fall back to driver number
  const from = process.env.CUSTOMER_TWILIO_NUMBER || process.env.TWILIO_FROM_NUMBER_2 || process.env.TWILIO_FROM_NUMBER || ""
  const digits = to.replace(/\D/g, "")
  const toE164 = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith("1") ? `+${digits}` : `+1${digits}`

  console.log(`[customer SMS] sending to ${toE164} from ${from}`)

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
  }
  else console.log("[customer SMS] sent OK SID:", data.sid)
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
  const body = formData.get("Body") || ""
  const messageSid = formData.get("MessageSid") || ""
  const numMedia = parseInt(formData.get("NumMedia") || "0")
  const mediaUrl = numMedia > 0 ? formData.get("MediaUrl0") || undefined : undefined

  if (!from || !messageSid) {
    return new Response("<Response></Response>", { status: 200, headers: { "Content-Type": "text/xml" } })
  }

  // Validate Twilio signature in production
  const twilioSignature = req.headers.get("x-twilio-signature") || ""
  const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://dumpsite.io"}/api/sms/customer-webhook`
  const params: Record<string, string> = {}
  formData.forEach((value, key) => { params[key] = value })

  if (process.env.NODE_ENV === "production" && !validateTwilioSignature(webhookUrl, params, twilioSignature)) {
    console.error("[Customer SMS] Invalid Twilio signature")
    return new Response("Unauthorized", { status: 401 })
  }

  try {
    const reply = await handleCustomerSMS({ from, body: body.trim(), messageSid, numMedia, mediaUrl })
    if (!reply) return new Response("<Response></Response>", { status: 200, headers: { "Content-Type": "text/xml" } })

    // Human-like delay
    const phone = from.replace(/\D/g, "").replace(/^1/, "")
    const delay = 5000

    after(async () => {
      await new Promise(r => setTimeout(r, delay))
      await sendViaTwilioAPI(phone, reply)
    })

    return new Response("<Response></Response>", { status: 200, headers: { "Content-Type": "text/xml" } })
  } catch (err) {
    console.error("[Customer webhook error]", err)
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
