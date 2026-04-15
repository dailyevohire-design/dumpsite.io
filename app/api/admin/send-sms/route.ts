// Earth Command v4 — admin SMS takeover send.
// POST { phone, message, convType: 'driver' | 'customer' }
// → sends via Twilio, flips mode=HUMAN_ACTIVE on the appropriate conversation table,
//   logs the send in admin_takeover_log. Never throws.

import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabase } from "@/lib/supabase"
import { requireAdmin } from "@/lib/admin-auth"

type SendBody = {
  phone?: string
  message?: string
  convType?: "driver" | "customer"
}

function getTwilioCreds(): { sid: string; auth: string } | { error: string } {
  const rawSid = process.env.TWILIO_ACCOUNT_SID || ""
  const apiKey = process.env.TWILIO_API_KEY
  const apiSecret = process.env.TWILIO_API_SECRET
  const authToken = process.env.TWILIO_AUTH_TOKEN

  if (!rawSid) return { error: "TWILIO_ACCOUNT_SID missing" }

  // API Key SK... mode
  if (rawSid.startsWith("SK")) {
    const realSid = process.env.TWILIO_ACCOUNT_SID_REAL
    if (!realSid || !apiSecret) return { error: "API Key mode requires TWILIO_ACCOUNT_SID_REAL + TWILIO_API_SECRET" }
    return { sid: realSid, auth: `${rawSid}:${apiSecret}` }
  }
  if (apiKey && apiSecret) return { sid: rawSid, auth: `${apiKey}:${apiSecret}` }
  if (authToken) return { sid: rawSid, auth: `${rawSid}:${authToken}` }
  if (apiSecret) return { sid: rawSid, auth: `${rawSid}:${apiSecret}` }
  return { error: "Missing Twilio auth — need TWILIO_AUTH_TOKEN or TWILIO_API_SECRET" }
}

function pickFromNumber(convType: "driver" | "customer"): string | null {
  if (convType === "customer") {
    return process.env.TWILIO_FROM_NUMBER_2 || process.env.CUSTOMER_TWILIO_NUMBER || null
  }
  // driver side
  return process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_FROM_NUMBER_2 || null
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  let body: SendBody
  try {
    body = (await req.json()) as SendBody
  } catch {
    return NextResponse.json({ success: false, error: "invalid JSON" }, { status: 400 })
  }

  const { phone, message, convType } = body
  if (!phone || typeof phone !== "string") {
    return NextResponse.json({ success: false, error: "phone required" }, { status: 400 })
  }
  if (!message || typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ success: false, error: "message required" }, { status: 400 })
  }
  if (convType !== "driver" && convType !== "customer") {
    return NextResponse.json({ success: false, error: "convType must be 'driver' or 'customer'" }, { status: 400 })
  }

  try {
    const creds = getTwilioCreds()
    if ("error" in creds) {
      return NextResponse.json({ success: false, error: creds.error }, { status: 500 })
    }
    const fromNumber = pickFromNumber(convType)
    if (!fromNumber) {
      return NextResponse.json({ success: false, error: "Twilio from-number env var missing" }, { status: 500 })
    }

    // Normalize recipient to E.164 (7134439223 → +17134439223)
    const digits = phone.replace(/\D/g, "")
    const to = phone.startsWith("+") ? phone : digits.length === 10 ? `+1${digits}` : `+${digits}`

    // Send via Twilio REST API
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${creds.sid}/Messages.json`
    const form = new URLSearchParams({ To: to, From: fromNumber, Body: message })
    const twilioRes = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(creds.auth).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    })

    const twilioJson = (await twilioRes.json()) as { sid?: string; message?: string; code?: number }
    if (!twilioRes.ok || !twilioJson.sid) {
      const errMsg = twilioJson.message || `Twilio error ${twilioRes.status}`
      return NextResponse.json({ success: false, error: errMsg }, { status: 502 })
    }

    const sid = twilioJson.sid
    const sb = createAdminSupabase()

    // Persist in parallel — none of these should fail the response.
    const table = convType === "driver" ? "conversations" : "customer_conversations"
    const smsLogTable = convType === "driver" ? "sms_logs" : "customer_sms_logs"

    await Promise.allSettled([
      sb.from(table).update({ mode: "HUMAN_ACTIVE", updated_at: new Date().toISOString() }).eq("phone", phone),
      sb.from("admin_takeover_log").insert({
        conversation_phone: phone,
        conversation_type: convType,
        admin_message: message,
        twilio_sid: sid,
      }),
      sb.from(smsLogTable).insert({
        phone,
        body: message,
        direction: "outbound",
        message_sid: sid,
      }),
    ])

    return NextResponse.json({ success: true, sid })
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : "unknown error"
    console.error("[admin/send-sms] fatal:", errMsg)
    return NextResponse.json({ success: false, error: errMsg }, { status: 500 })
  }
}
