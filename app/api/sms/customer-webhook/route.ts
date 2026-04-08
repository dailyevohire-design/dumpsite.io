import { NextRequest, NextResponse } from "next/server"
import { after } from "next/server"
import { handleCustomerSMS } from "@/lib/services/customer-brain.service"
import { createAdminSupabase } from "@/lib/supabase"
import crypto from "crypto"
import twilio from "twilio"
import { classifyTwilioError, shouldFallBackToDefault, type ClassifiedError } from "@/lib/services/twilio-errors"

const ADMIN_PHONE = (process.env.ADMIN_PHONE || "7134439223").replace(/\D/g, "")
const ADMIN_PHONE_2 = (process.env.ADMIN_PHONE_2 || "").replace(/\D/g, "")

function validateTwilioSignature(url: string, params: Record<string, string>, signature: string): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!authToken) {
    console.error("[Customer SMS] TWILIO_AUTH_TOKEN missing — refusing webhook")
    return false
  }
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

type SendResult =
  | { ok: true; sid: string }
  | { ok: false; error: ClassifiedError; rawMessage: string }
  | { ok: false; error: ClassifiedError; rawMessage: string; networkError: true }

async function sendViaTwilioAPI(to: string, body: string, replyFrom?: string): Promise<SendResult> {
  const { sid, key, secret } = getTwilioAuth()
  // Reply from the same number the customer texted (sales agent number), or fall back to default
  const from = replyFrom || process.env.CUSTOMER_TWILIO_NUMBER || process.env.TWILIO_FROM_NUMBER_2 || process.env.TWILIO_FROM_NUMBER || ""
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
      const classified = classifyTwilioError(data.error_code)
      console.error(`[customer SMS] Twilio error ${data.error_code} (${classified.class}): ${data.message} — ${classified.hint}`)
      try {
        await createAdminSupabase().from("customer_sms_logs").insert({
          phone: digits,
          body: `TWILIO SEND FAILED: code=${data.error_code} class=${classified.class} from=${from} msg="${data.message || ""}" hint="${classified.hint}" — attempted body: ${body.slice(0, 200)}`,
          direction: "error",
          message_sid: `twilio_err_${Date.now()}`,
        })
      } catch {}
      return { ok: false, error: classified, rawMessage: data.message || "" }
    }
    console.log("[customer SMS] sent OK SID:", data.sid)
    return { ok: true, sid: data.sid }
  } catch (err) {
    console.error("[customer SMS] fetch to Twilio threw:", err)
    // Network/transport errors are transient by definition
    return {
      ok: false,
      error: { code: 0, class: "transient", hint: `Network error: ${(err as any)?.message || "unknown"}` },
      rawMessage: String(err),
      networkError: true,
    }
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

  // TEMP DEBUG (remove after Micah routing fix verified):
  // log raw To/From so we can see what Twilio is actually delivering
  try {
    await createAdminSupabase().from("customer_sms_logs").insert({
      phone: from.replace(/\D/g, "").replace(/^1/, ""),
      body: `DEBUG inbound raw — From="${from}" To="${to}"`,
      direction: "error",
      message_sid: `dbg_${messageSid}`,
    })
  } catch {}

  try {
    // Pass the Twilio To number so the brain can track which sales agent number was texted
    const sourceNumber = to.replace(/\D/g, "").replace(/^1/, "")
    const reply = await handleCustomerSMS({ from, body: body.trim(), messageSid, numMedia, mediaUrl, sourceNumber })
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

    // Reply from the same number the customer texted — critical for multi-agent tracking
    // Format as E.164 for Twilio FROM field
    const replyFromNumber = sourceNumber ? `+1${sourceNumber}` : undefined

    // Human-like delay, then send with retry + admin alert on failure
    const delay = 5000

    after(async () => {
      try {
        await new Promise(r => setTimeout(r, delay))
        let result = await sendViaTwilioAPI(phone, reply, replyFromNumber)

        if (!result.ok) {
          // PERMANENT errors on the agent number → DO NOT fall back to the
          // default number. Sending from the wrong number breaks multi-agent
          // attribution and confuses the customer about which agent they're
          // talking to. Surface to admin and bail.
          if (!shouldFallBackToDefault(result.error)) {
            console.error(`[customer SMS] PERMANENT error on ${replyFromNumber} (${result.error.class}, code ${result.error.code}) — not falling back`)
            await alertAdmin(
              `URGENT: Agent number ${replyFromNumber} CANNOT SEND. ` +
              `Code ${result.error.code} (${result.error.class}). ` +
              `${result.error.hint} ` +
              `Customer ${phone} got NO reply. Their msg: "${body.slice(0, 80)}"`
            )
            try {
              await createAdminSupabase().from("customer_sms_logs").insert({
                phone,
                body: `SEND BLOCKED on ${replyFromNumber} — code ${result.error.code} ${result.error.class}: ${result.error.hint} — reply lost: ${reply.slice(0, 200)}`,
                direction: "error",
                message_sid: `send_blocked_${messageSid}`,
              })
            } catch {}
            return // Leave pending_send marker — operator must fix Twilio config
          }

          // TRANSIENT error → retry once on the same agent number
          console.error(`[customer SMS] TRANSIENT error to ${phone} (code ${result.error.code}), retrying in 3s...`)
          await new Promise(r => setTimeout(r, 3000))
          result = await sendViaTwilioAPI(phone, reply, replyFromNumber)

          if (!result.ok && replyFromNumber && shouldFallBackToDefault(result.error)) {
            // Still transient after retry → fall back to default number.
            // This is the ONLY path that uses the default for an agent reply.
            console.error(`[customer SMS] retry still transient (${result.error.code}), falling back to default`)
            const fallback = await sendViaTwilioAPI(phone, reply)
            if (fallback.ok) {
              await alertAdmin(`Transient Twilio error on ${replyFromNumber} — reply to ${phone} sent from default. Code ${result.error.code}.`)
              result = fallback
            }
          }

          if (!result.ok) {
            console.error(`[customer SMS] ALL ATTEMPTS FAILED to ${phone}`)
            await alertAdmin(`SMS SEND FAILED to ${phone}. Code ${result.error.code} (${result.error.class}). Customer got NO reply. Their msg: "${body.slice(0, 80)}"`)
            try {
              await createAdminSupabase().from("customer_sms_logs").insert({
                phone, body: `SEND FAILED — reply lost: ${reply.slice(0, 200)}`,
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
