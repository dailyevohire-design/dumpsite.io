import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabase } from "@/lib/supabase"
import twilio from "twilio"

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
const CUSTOMER_FROM = process.env.CUSTOMER_TWILIO_NUMBER!

// Agent phone number lookup — must match AGENT_MAP in customer-brain.service.ts
const AGENT_FROM: Record<string, string> = {
  sarah: process.env.CUSTOMER_TWILIO_NUMBER || process.env.TWILIO_FROM_NUMBER_2 || "",
  micah: process.env.MICAH_TWILIO_NUMBER || "+14695236420",
  john_l: process.env.JOHN_L_TWILIO_NUMBER || "+14692470556",
}
function getAgentFrom(agentName?: string): string {
  return (agentName && AGENT_FROM[agentName]) || CUSTOMER_FROM
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 })
  }
  const sb = createAdminSupabase()
  const now = new Date().toISOString()

  // Check FOLLOW_UP state (scheduled follow-ups) AND stale QUOTING (no reply in 24h+)
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: staleQuotes } = await sb
    .from("customer_conversations")
    .select("phone, customer_name")
    .eq("state", "QUOTING")
    .lt("updated_at", yesterday)
    .neq("opted_out", true)
  // Auto-transition stale quotes to FOLLOW_UP
  for (const q of staleQuotes || []) {
    await sb.from("customer_conversations").update({
      state: "FOLLOW_UP",
      follow_up_at: now,
      follow_up_count: 0,
    }).eq("phone", q.phone)
  }

  const { data: followUps } = await sb
    .from("customer_conversations")
    .select("phone, customer_name, state, follow_up_count, material_type, yards_needed, total_price_cents, agent_name")
    .eq("state", "FOLLOW_UP")
    .lt("follow_up_at", now)
    .lt("follow_up_count", 3)
    .neq("opted_out", true)

  if (!followUps?.length) return NextResponse.json({ checked: 0 })

  let sent = 0
  for (const c of followUps) {
    try {
      const firstName = (c.customer_name || "").split(/\s+/)[0] || "Hey"
      const count = c.follow_up_count || 0

      let msg = ""
      if (count === 0) {
        msg = `Hey ${firstName} just following up on that dirt delivery. Still interested? Just text me back and I can get you scheduled`
      } else if (count === 1) {
        msg = `${firstName} checking in one more time on that delivery. Let me know if you still need it or if anything changed`
      } else {
        msg = `${firstName} last check in on the dirt delivery. No worries if plans changed, just text me anytime you need material delivered`
      }

      await twilioClient.messages.create({
        body: msg, from: getAgentFrom(c.agent_name),
        to: `+1${c.phone}`,
      })

      await sb.from("customer_sms_logs").insert({
        phone: c.phone, body: msg, direction: "outbound",
        message_sid: `followup_${Date.now()}`,
      })

      const nextFollowUp = new Date(Date.now() + (count === 0 ? 48 : 72) * 60 * 60 * 1000).toISOString()
      await sb.from("customer_conversations").update({
        follow_up_count: count + 1,
        follow_up_at: count < 2 ? nextFollowUp : null,
        state: count >= 2 ? "CLOSED" : "FOLLOW_UP",
      }).eq("phone", c.phone)

      sent++
    } catch (e) { console.error("[followup]", e) }
  }

  return NextResponse.json({ checked: followUps.length, sent })
}
