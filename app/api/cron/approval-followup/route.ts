import { NextResponse } from "next/server"
import { createAdminSupabase } from "@/lib/supabase"
import { makeVoiceCallToCustomer } from "@/lib/services/approval.service"
import twilio from "twilio"

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://dumpsite.io"

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 })
  }

  const sb = createAdminSupabase()
  const now = new Date()
  const twoMinAgo = new Date(now.getTime() - 2 * 60 * 1000).toISOString()
  const threeMinAgo = new Date(now.getTime() - 3 * 60 * 1000).toISOString()
  const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000).toISOString()

  const { data: pending } = await sb
    .from("conversations")
    .select("phone, pending_approval_order_id, approval_sent_at, voice_call_made")
    .eq("state", "APPROVAL_PENDING")
    .not("approval_sent_at", "is", null)
    .gt("approval_sent_at", thirtyMinAgo)

  if (!pending?.length) return NextResponse.json({ checked: 0 })

  let voiceCalls = 0, emails = 0
  const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
  const from = process.env.TWILIO_FROM_NUMBER_2 || process.env.TWILIO_FROM_NUMBER

  for (const conv of pending) {
    const sentAt = new Date(conv.approval_sent_at!)
    const minutesWaiting = Math.floor((now.getTime() - sentAt.getTime()) / 60000)

    if (!conv.pending_approval_order_id) continue

    const { data: order } = await sb.from("dispatch_orders")
      .select("id, client_phone, client_name, yards_needed, cities(name)")
      .eq("id", conv.pending_approval_order_id).maybeSingle()
    if (!order?.client_phone) continue

    const { data: profile } = await sb.from("driver_profiles")
      .select("first_name").eq("phone", conv.phone).maybeSingle()
    const driverName = profile?.first_name || "driver"
    const approvalCode = `DS-${order.id.replace(/-/g,"").slice(0,6).toUpperCase()}`

    // 2 min: voice call
    if (!conv.voice_call_made && conv.approval_sent_at < twoMinAgo) {
      await makeVoiceCallToCustomer(
        order.client_phone.replace(/\D/g,"").replace(/^1/,""),
        driverName, order.yards_needed, approvalCode
      ).catch(() => {})
      await sb.from("conversations").update({ voice_call_made: true }).eq("phone", conv.phone)
      voiceCalls++
    }

    // 3 min: email escalation + admin SMS
    if (conv.approval_sent_at < threeMinAgo) {
      const resendKey = process.env.RESEND_API_KEY
      if (resendKey) {
        const city = (order.cities as any)?.name || ""
        const { data: convFull } = await sb.from("conversations")
          .select("photo_public_url").eq("phone", conv.phone).maybeSingle()

        try {
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: "DumpSite Alerts <alerts@dumpsite.io>",
              to: ["support@dumpsite.io"],
              subject: `Customer not responding — ${driverName} waiting ${minutesWaiting}min`,
              html: `<div style="font-family:monospace;padding:24px;background:#0d1117;color:#e2e8f0;">
                <h2 style="color:#f59e0b;">Customer Approval Needed</h2>
                <p>Driver: ${driverName} (+1${conv.phone})</p>
                <p>Customer: ${order.client_name} (+1${order.client_phone})</p>
                <p>Location: ${city} — ${order.yards_needed} yards</p>
                <p style="color:#f87171;font-weight:bold;">Waiting: ${minutesWaiting} minutes</p>
                ${convFull?.photo_public_url ? `<img src="${convFull.photo_public_url}" style="max-width:400px;border-radius:8px;" />` : ""}
                <p><a href="${APP_URL}/admin/live" style="background:#22c55e;color:#000;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;">Open Dashboard</a></p>
              </div>`,
            }),
          })
          emails++
        } catch (err) { console.error("[escalation-email]", err) }
      }

      // SMS to admin
      try {
        await twilioClient.messages.create({
          body: `${minutesWaiting}min — customer not responding for ${driverName}. Check email or dashboard.`,
          from: from!, to: "+17134439223",
        })
      } catch {}
    }
  }

  return NextResponse.json({ checked: pending.length, voiceCalls, emails })
}
