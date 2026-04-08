import { NextResponse } from "next/server"
import { createAdminSupabase } from "@/lib/supabase"


function getTwilioAuth(): { sid: string; key: string; secret: string } {
  const rawSid = process.env.TWILIO_ACCOUNT_SID || ''
  const apiKey = process.env.TWILIO_API_KEY
  const apiSecret = process.env.TWILIO_API_SECRET
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (apiKey && apiSecret) return { sid: rawSid, key: apiKey, secret: apiSecret }
  return { sid: rawSid, key: rawSid, secret: authToken || '' }
}

async function sendSMS(to: string, body: string) {
  const { sid, key, secret } = getTwilioAuth()
  const from = process.env.TWILIO_FROM_NUMBER_2 || process.env.TWILIO_FROM_NUMBER || ''
  const digits = to.replace(/\D/g, '')
  const toE164 = digits.length === 10 ? `+1${digits}` : `+${digits}`
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: toE164, From: from, Body: body }).toString(),
  })
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return new Response("CRON_SECRET not configured", { status: 500 })
  }
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 })
  }
  const sb = createAdminSupabase()
  const adminPhone = (process.env.ADMIN_PHONE || '7134439223').replace(/\D/g, '')
  let notified = 0, escalated = 0

  // FIX #6: Driver goes dark — check ACTIVE jobs with no update
  const thirtyMin = new Date(Date.now() - 30 * 60 * 1000).toISOString()
  const twoHours = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()

  // 30 min stale — first nudge
  const { data: stale30 } = await sb.from("conversations")
    .select("phone, active_order_id, updated_at")
    .eq("state", "ACTIVE").lt("updated_at", thirtyMin).gt("updated_at", twoHours)
  for (const d of stale30 || []) {
    try {
      await sendSMS(d.phone, "you good? you on the way")
      await sb.from("sms_logs").insert({ phone: d.phone, body: "you good? you on the way", direction: "outbound" })
      notified++
    } catch {}
  }

  // 2 hours stale — escalate to admin, notify site owner
  const { data: stale2h } = await sb.from("conversations")
    .select("phone, active_order_id, updated_at")
    .eq("state", "ACTIVE").lt("updated_at", twoHours)
  for (const d of stale2h || []) {
    try {
      const { data: profile } = await sb.from("driver_profiles").select("first_name").eq("phone", d.phone).maybeSingle()
      const name = profile?.first_name || d.phone

      // Tell driver
      await sendSMS(d.phone, "hey you still coming? if not lmk so I can find someone else")
      await sb.from("sms_logs").insert({ phone: d.phone, body: "hey you still coming? if not lmk so I can find someone else", direction: "outbound" })

      // Alert admin
      await sendSMS(adminPhone, `STALE JOB: ${name} (${d.phone}) no response in 2+ hours. Order: ${d.active_order_id || "unknown"}`)

      // Notify site owner if we have the order
      if (d.active_order_id) {
        const { data: order } = await sb.from("dispatch_orders").select("client_phone, client_name").eq("id", d.active_order_id).maybeSingle()
        if (order?.client_phone) {
          const ownerPhone = order.client_phone.replace(/\D/g, "").replace(/^1/, "")
          await sendSMS(ownerPhone, `DumpSite: Driver ${name} hasn't responded in a while. We're checking on it and will update you shortly.`)
        }
      }
      escalated++
    } catch {}
  }

  // FIX #7: Customer never responds — check APPROVAL_PENDING > 30 min
  const { data: pendingApproval } = await sb.from("conversations")
    .select("phone, pending_approval_order_id, approval_sent_at, voice_call_made")
    .eq("state", "APPROVAL_PENDING").not("approval_sent_at", "is", null)

  let approvalFollowups = 0
  for (const c of pendingApproval || []) {
    if (!c.approval_sent_at) continue
    const elapsed = Date.now() - new Date(c.approval_sent_at).getTime()
    const minutes = elapsed / 60000

    // 5 min — resend text to customer
    if (minutes >= 5 && minutes < 10 && !c.voice_call_made) {
      if (c.pending_approval_order_id) {
        const { data: order } = await sb.from("dispatch_orders").select("client_phone, client_name, yards_needed").eq("id", c.pending_approval_order_id).maybeSingle()
        if (order?.client_phone) {
          const cp = order.client_phone.replace(/\D/g, "").replace(/^1/, "")
          await sendSMS(cp, `DumpSite reminder: We still need your approval for the ${order.yards_needed} yard delivery. Reply YES to approve or NO to decline.`)
          approvalFollowups++
        }
      }
    }

    // 15 min — alert admin
    if (minutes >= 15 && minutes < 20) {
      const { data: profile } = await sb.from("driver_profiles").select("first_name").eq("phone", c.phone).maybeSingle()
      await sendSMS(adminPhone, `APPROVAL TIMEOUT: Customer not responding for ${Math.round(minutes)}min. Driver: ${profile?.first_name || c.phone}. Order: ${c.pending_approval_order_id}`)

      // Tell driver we're still working on it
      await sendSMS(c.phone, "still waiting on them, give me a few more minutes")
      await sb.from("sms_logs").insert({ phone: c.phone, body: "still waiting on them, give me a few more minutes", direction: "outbound" })
    }

    // 30 min — release the driver
    if (minutes >= 30) {
      await sendSMS(c.phone, "customer not responding, let me find you another site. stand by")
      await sb.from("sms_logs").insert({ phone: c.phone, body: "customer not responding, let me find you another site. stand by", direction: "outbound" })
      // Release reservation and reset to look for new job
      await sb.from("site_reservations").update({ status: "released" }).eq("driver_phone", c.phone).eq("status", "active")
      await sb.from("conversations").update({
        state: "DISCOVERY", pending_approval_order_id: null, approval_sent_at: null
      }).eq("phone", c.phone)
    }
  }

  return NextResponse.json({ stale30: stale30?.length || 0, notified, stale2h: stale2h?.length || 0, escalated, approvalFollowups })
}
