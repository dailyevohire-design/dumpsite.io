import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabase } from "@/lib/supabase"
import twilio from "twilio"


const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
const CUSTOMER_FROM = process.env.CUSTOMER_TWILIO_NUMBER!

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return new Response("CRON_SECRET not configured", { status: 500 })
  }
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
    .select("phone, agent_id, customer_name")
    .eq("state", "QUOTING")
    .lt("updated_at", yesterday)
    .neq("opted_out", true)
  // Auto-transition stale quotes to FOLLOW_UP (scoped to specific agent row)
  for (const q of staleQuotes || []) {
    await sb.from("customer_conversations").update({
      state: "FOLLOW_UP",
      follow_up_at: now,
      follow_up_count: 0,
    }).eq("phone", q.phone).eq("agent_id", q.agent_id)
  }

  // ── FIX 4: Follow up on COLLECTING + ASKING_DIMENSIONS too ──
  // 4 real customers ghosted in COLLECTING with no re-engagement (2026-04-12
  // forensic). These now get follow_up_at set in the brain (4h timeout).
  // Auto-transition stale COLLECTING/ASKING_DIMENSIONS (4h+) to FOLLOW_UP
  // if they've been stuck without customer activity.
  const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()
  const { data: staleCollecting } = await sb
    .from("customer_conversations")
    .select("phone, agent_id, customer_name, state, delivery_address, material_type, yards_needed, delivery_city")
    .in("state", ["COLLECTING", "ASKING_DIMENSIONS"])
    .lt("follow_up_at", now)
    .neq("opted_out", true)
  for (const sc of staleCollecting || []) {
    await sb.from("customer_conversations").update({
      state: "FOLLOW_UP",
      follow_up_at: now,
      follow_up_count: 0,
    }).eq("phone", sc.phone).eq("agent_id", sc.agent_id)
    // Log anomaly for visibility
    try {
      await sb.from("conversation_anomalies").insert({
        phone: sc.phone,
        anomaly_type: "collecting_timeout",
        severity: "high",
        details: { original_state: sc.state, name: sc.customer_name, address: sc.delivery_address, city: sc.delivery_city, yards: sc.yards_needed, material: sc.material_type },
      })
    } catch {}
  }

  const { data: followUps } = await sb
    .from("customer_conversations")
    .select("phone, agent_id, source_number, customer_name, state, follow_up_count, material_type, yards_needed, total_price_cents, delivery_address, delivery_city")
    .eq("state", "FOLLOW_UP")
    .lt("follow_up_at", now)
    .lt("follow_up_count", 3)
    .neq("opted_out", true)

  if (!followUps?.length) return NextResponse.json({ checked: staleCollecting?.length || 0 })

  let sent = 0
  for (const c of followUps) {
    try {
      const firstName = (c.customer_name || "").split(/\s+/)[0] || "Hey"
      const count = c.follow_up_count || 0
      const hasQuote = !!c.total_price_cents
      const hasAddr = !!c.delivery_address

      let msg = ""
      if (!hasQuote && count === 0) {
        // Was in COLLECTING — pick up where we left off
        const matName = c.material_type ? c.material_type.replace(/_/g, " ") : "dirt"
        if (!hasAddr) {
          msg = `Hey ${firstName} still need that ${matName} delivered? Just send me the address and I can get you priced out real quick`
        } else {
          msg = `Hey ${firstName} still looking to get that ${matName} to ${c.delivery_city || "your spot"}? Just text me back and we'll knock it out`
        }
      } else if (count === 0) {
        msg = `Hey ${firstName} just following up on that dirt delivery. Still interested? Just text me back and I can get you scheduled`
      } else if (count === 1) {
        msg = `${firstName} checking in one more time on that delivery. Let me know if you still need it or if anything changed`
      } else {
        msg = `${firstName} last check in on the dirt delivery. No worries if plans changed, just text me anytime you need material delivered`
      }

      // Reply FROM the agent's Twilio number to preserve per-agent illusion
      const fromNumber = c.source_number ? `+1${c.source_number}` : CUSTOMER_FROM
      await twilioClient.messages.create({
        body: msg, from: fromNumber,
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
      }).eq("phone", c.phone).eq("agent_id", c.agent_id)

      sent++
    } catch (e) { console.error("[followup]", e) }
  }

  return NextResponse.json({ checked: followUps.length, sent })
}
