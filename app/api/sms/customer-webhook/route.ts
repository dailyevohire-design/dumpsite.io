import { NextRequest, NextResponse } from "next/server"
import { after } from "next/server"
import { handleCustomerSMS } from "@/lib/services/customer-brain.service"
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

async function sendViaTwilioAPI(to: string, body: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID || ""
  const apiKey = process.env.TWILIO_API_KEY
  const apiSecret = process.env.TWILIO_API_SECRET
  const authToken = process.env.TWILIO_AUTH_TOKEN || ""
  const key = apiKey || sid
  const secret = apiSecret || authToken
  const from = process.env.CUSTOMER_TWILIO_NUMBER || ""
  const digits = to.replace(/\D/g, "")
  const toE164 = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith("1") ? `+${digits}` : `+1${digits}`
  const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      "Authorization": "Basic " + Buffer.from(`${key}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: toE164, From: from, Body: body }).toString(),
  })
  const data = await resp.json()
  if (data.error_code) console.error("[customer SMS] Twilio error:", data.message, data.error_code)
  else console.log("[customer SMS] sent to", toE164, "SID:", data.sid)
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

  const twilioSignature = req.headers.get("x-twilio-signature") || ""
  const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://dumpsite.io"}/api/sms/customer-webhook`
  const params: Record<string, string> = {}
  formData.forEach((value, key) => { params[key] = value })

  if (process.env.NODE_ENV === "production" && !validateTwilioSignature(webhookUrl, params, twilioSignature)) {
    console.error("[Customer SMS] Invalid Twilio signature")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const reply = await handleCustomerSMS({ from, body: body.trim(), messageSid, numMedia, mediaUrl })
    if (!reply) return new Response("<Response></Response>", { status: 200, headers: { "Content-Type": "text/xml" } })

    // Human-like delay — Sarah is a friendly person texting, not instant
    // Short replies (ok, got it) = 4-10s, medium = 8-18s, long (quotes, explanations) = 12-25s
    const phone = from.replace(/\D/g, "").replace(/^1/, "")
    const replyLen = reply.length
    const baseDelay = replyLen < 30 ? 4000 : replyLen < 100 ? 8000 : 12000
    const jitter = replyLen < 30 ? 6000 : replyLen < 100 ? 10000 : 13000
    const delay = baseDelay + Math.floor(Math.random() * jitter)

    after(async () => {
      await new Promise(r => setTimeout(r, delay))
      await sendViaTwilioAPI(phone, reply)
    })

    return new Response("<Response></Response>", { status: 200, headers: { "Content-Type": "text/xml" } })
  } catch (err) {
    console.error("[Customer webhook error]", err)
    const phone = from.replace(/\D/g, "").replace(/^1/, "")
    after(async () => {
      await new Promise(r => setTimeout(r, 5000))
      await sendViaTwilioAPI(phone, "Give me just a moment")
    })
    return new Response("<Response></Response>", { status: 200, headers: { "Content-Type": "text/xml" } })
  }
}

export async function GET() {
  return NextResponse.json({ status: "Customer SMS webhook active" })
}
