import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabase } from "@/lib/supabase"
import Anthropic from "@anthropic-ai/sdk"

// ─────────────────────────────────────────────────────────────────
// STUCK CONVERSATION RESCUE AGENT — runs every 30 minutes
// Finds stuck Jesse (driver) and Sarah (customer) conversations,
// generates persona-appropriate rescue messages via Claude,
// and sends them to nudge the conversation forward.
// ─────────────────────────────────────────────────────────────────

const FROM_DRIVER = process.env.TWILIO_FROM_NUMBER_2 || process.env.TWILIO_FROM_NUMBER || ""
const FROM_CUSTOMER = process.env.CUSTOMER_TWILIO_NUMBER || ""
const ADMIN_PHONE = (process.env.ADMIN_PHONE || "5126161820").replace(/\D/g, "")

// ── Twilio auth (matches lib/sms.ts pattern) ──
function getTwilioAuth() {
  const rawSid = process.env.TWILIO_ACCOUNT_SID || ""
  const apiKey = process.env.TWILIO_API_KEY
  const apiSecret = process.env.TWILIO_API_SECRET
  const authToken = process.env.TWILIO_AUTH_TOKEN

  let accountSid: string, authKey: string, authSecret: string

  if (rawSid.startsWith("SK")) {
    accountSid = process.env.TWILIO_ACCOUNT_SID_REAL || ""
    authKey = rawSid
    authSecret = apiSecret || ""
  } else if (apiKey && apiSecret) {
    accountSid = rawSid
    authKey = apiKey
    authSecret = apiSecret
  } else if (authToken) {
    accountSid = rawSid
    authKey = rawSid
    authSecret = authToken
  } else {
    throw new Error("No Twilio auth configured")
  }
  return { accountSid, authKey, authSecret }
}

async function sendSMSraw(to: string, body: string, from: string): Promise<boolean> {
  if (process.env.PAUSE_ADMIN_SMS === "true" && to.replace(/\D/g, "").endsWith(ADMIN_PHONE)) {
    console.log("[rescue] SMS paused for admin")
    return false
  }

  try {
    const { accountSid, authKey, authSecret } = getTwilioAuth()
    const resp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: "Basic " + Buffer.from(`${authKey}:${authSecret}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
      }
    )
    const data = await resp.json()
    if (data.error_code) {
      console.error("[rescue] Twilio error:", data.message)
      return false
    }
    return true
  } catch (e: any) {
    console.error("[rescue] SMS failed:", e.message)
    return false
  }
}

async function alertAdmin(msg: string) {
  if (process.env.PAUSE_ADMIN_SMS === "true") return
  await sendSMSraw(`+1${ADMIN_PHONE}`, `DumpSite.io Rescue: ${msg}`, FROM_DRIVER)
}

// ── State → rescue message maps ──

const JESSE_RESCUE_MAP: Record<string, string | "ESCALATE"> = {
  ASKING_TRUCK: "What truck you running?",
  PHOTO_PENDING: "Still need that pic of the dirt",
  APPROVAL_PENDING: "ESCALATE",
  PAYMENT_METHOD_PENDING: "Need to get you paid — Zelle or Venmo?",
  PAYMENT_ACCOUNT_PENDING: "Need to get you paid — Zelle or Venmo?",
  JOB_PRESENTED: "You want that job or nah?",
}

const SARAH_RESCUE_MAP: Record<string, string | "ESCALATE"> = {
  COLLECTING: "Still happy to get you a quote! What's the delivery address?",
  ASKING_DIMENSIONS: "How many yards are you looking for?",
  QUOTING: "Did you get a chance to review the quote? Happy to answer any questions!",
  AWAITING_PAYMENT: "Whenever you're ready, you can send payment via Zelle or Venmo to complete your order.",
  AWAITING_PRIORITY_PAYMENT: "Whenever you're ready, you can send payment via Zelle or Venmo to complete your order.",
  ASKING_EMAIL: "Hi! Just wanted to follow up — what's your email so we can send the receipt?",
  FOLLOW_UP: "Did you get a chance to review the quote? Happy to answer any questions!",
}

// ── AI rescue generation (optional enhancement over static map) ──

async function generateRescue(
  system: "jesse" | "sarah",
  state: string,
  phone: string,
  recentMessages: string[]
): Promise<string | null> {
  // Use static map first — only call AI if state not in map
  const map = system === "jesse" ? JESSE_RESCUE_MAP : SARAH_RESCUE_MAP
  const staticMsg = map[state]
  if (staticMsg && staticMsg !== "ESCALATE") return staticMsg
  if (staticMsg === "ESCALATE") return null

  // For unknown states, generate with AI
  try {
    const client = new Anthropic()
    const persona = system === "jesse"
      ? "You are Jesse from DumpSite.io — a real dirt broker. Ultra short texts, trucker voice, no punctuation, 1-3 sentences max. Never reveal you're AI."
      : "You are Sarah from DumpSite.io — warm, professional customer service. Friendly but concise. Never reveal you're AI."

    const maxChars = system === "jesse" ? 160 : 320
    const context = recentMessages.length
      ? `Recent messages:\n${recentMessages.slice(-5).join("\n")}`
      : "No recent messages available."

    const resp = await client.messages.create({
      model: "claude-sonnet-4-6-20250514",
      max_tokens: 100,
      system: persona,
      messages: [{
        role: "user",
        content: `This conversation is stuck in state "${state}". The driver/customer hasn't responded in over an hour.\n\n${context}\n\nWrite a single short rescue text to nudge them forward. Under ${maxChars} characters. Just the message text, nothing else.`,
      }],
    })

    const text = resp.content[0]?.type === "text" ? resp.content[0].text.trim() : null
    if (!text) return null

    // Validate length
    if (text.length > maxChars) {
      console.warn(`[rescue] AI response too long (${text.length} chars), truncating`)
      return text.slice(0, maxChars)
    }
    return text
  } catch (e: any) {
    console.error("[rescue] AI generation failed:", e.message)
    return null
  }
}

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return new Response("CRON_SECRET not configured", { status: 500 })
  }
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 })
  }

  const sb = createAdminSupabase()
  const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()
  const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()
  const results = { jesse_rescued: 0, sarah_rescued: 0, escalated: 0, skipped: 0 }

  // ═══ JESSE RESCUE (conversations table) ═══

  const jesseTerminal = ["CLOSED", "DISCOVERY", "COMPLETED"]
  const { data: stuckJesse } = await sb.from("conversations")
    .select("phone, state, updated_at")
    .not("state", "in", `(${jesseTerminal.join(",")})`)
    .lt("updated_at", oneHourAgo)
    .limit(20)

  for (const conv of stuckJesse || []) {
    try {
      // Check opt-out via driver_profiles
      const { data: profile } = await sb.from("driver_profiles")
        .select("sms_opted_out")
        .eq("phone", conv.phone)
        .maybeSingle()
      if (profile?.sms_opted_out) { results.skipped++; continue }

      // Check needs_human_review — skip if already flagged
      const { data: convFull } = await sb.from("conversations")
        .select("needs_human_review")
        .eq("phone", conv.phone)
        .maybeSingle()
      if (convFull?.needs_human_review) { results.skipped++; continue }

      // Check rescue cooldown — no rescue within 4 hours
      const { data: recentRescue } = await sb.from("agent_rescue_logs")
        .select("id")
        .eq("phone", conv.phone)
        .eq("system", "jesse")
        .gte("sent_at", fourHoursAgo)
        .limit(1)
      if (recentRescue?.length) { results.skipped++; continue }

      // Check total rescue attempts
      const { count: totalAttempts } = await sb.from("agent_rescue_logs")
        .select("id", { count: "exact", head: true })
        .eq("phone", conv.phone)
        .eq("system", "jesse")
      const attemptNum = (totalAttempts || 0) + 1

      if (attemptNum > 3) {
        // Max attempts — mark for human review, alert admin
        try { await sb.from("conversations").update({ needs_human_review: true }).eq("phone", conv.phone) } catch {}
        await alertAdmin(`Jesse rescue maxed out: ${conv.phone} stuck in ${conv.state} after 3 attempts`)
        await sb.from("agent_rescue_logs").insert({
          system: "jesse", phone: conv.phone, stuck_state: conv.state,
          rescue_message: "", attempt_number: attemptNum, escalated: true, sent_at: new Date().toISOString(),
        })
        results.escalated++
        continue
      }

      // Check if state requires escalation
      if (JESSE_RESCUE_MAP[conv.state] === "ESCALATE" || conv.state === "APPROVAL_PENDING") {
        await alertAdmin(`Jesse needs human eyes: ${conv.phone} stuck in ${conv.state}`)
        await sb.from("agent_rescue_logs").insert({
          system: "jesse", phone: conv.phone, stuck_state: conv.state,
          rescue_message: "", attempt_number: attemptNum, escalated: true, sent_at: new Date().toISOString(),
        })
        results.escalated++
        continue
      }

      // Get recent messages for AI context
      const { data: msgs } = await sb.from("sms_logs")
        .select("body, direction")
        .eq("phone", conv.phone)
        .order("created_at", { ascending: false })
        .limit(5)
      const recentMsgs = (msgs || []).reverse().map(m => `${m.direction}: ${m.body}`)

      // Generate rescue message
      const rescueMsg = await generateRescue("jesse", conv.state, conv.phone, recentMsgs)
      if (!rescueMsg) {
        await alertAdmin(`Jesse rescue: can't generate for ${conv.phone} in ${conv.state}`)
        results.escalated++
        continue
      }

      // Send SMS
      const sent = await sendSMSraw(`+1${conv.phone}`, rescueMsg, FROM_DRIVER)
      if (sent) {
        // Log to sms_logs (matches existing pattern)
        await sb.from("sms_logs").insert({
          phone: conv.phone, body: `[RESCUE ${conv.state}] ${rescueMsg}`,
          direction: "outbound", message_sid: `rescue_j_${Date.now()}`,
        })
        // Update conversation timestamp so watchdog doesn't re-flag immediately
        await sb.from("conversations").update({ updated_at: new Date().toISOString() }).eq("phone", conv.phone)
      }

      // Log rescue attempt
      await sb.from("agent_rescue_logs").insert({
        system: "jesse", phone: conv.phone, stuck_state: conv.state,
        rescue_message: rescueMsg, attempt_number: attemptNum, escalated: false, sent_at: new Date().toISOString(),
      })
      results.jesse_rescued++
    } catch (e: any) {
      console.error(`[rescue jesse] Error for ${conv.phone}:`, e.message)
    }
  }

  // ═══ SARAH RESCUE (customer_conversations table) ═══

  const sarahTerminal = ["CLOSED", "DELIVERED", "ORDER_PLACED", "OUT_OF_AREA"]
  const { data: stuckSarah } = await sb.from("customer_conversations")
    .select("phone, agent_id, source_number, state, updated_at, opted_out, customer_name")
    .not("state", "in", `(${sarahTerminal.join(",")})`)
    .eq("opted_out", false)
    .lt("updated_at", oneHourAgo)
    .limit(20)

  for (const conv of stuckSarah || []) {
    try {
      if (conv.opted_out) { results.skipped++; continue }

      // Check needs_human_review — scope to this agent conversation
      const { data: convFull } = await sb.from("customer_conversations")
        .select("needs_human_review")
        .eq("phone", conv.phone)
        .eq("agent_id", conv.agent_id)
        .maybeSingle()
      if (convFull?.needs_human_review) { results.skipped++; continue }

      // Check rescue cooldown
      const { data: recentRescue } = await sb.from("agent_rescue_logs")
        .select("id")
        .eq("phone", conv.phone)
        .eq("system", "sarah")
        .gte("sent_at", fourHoursAgo)
        .limit(1)
      if (recentRescue?.length) { results.skipped++; continue }

      // Check total attempts
      const { count: totalAttempts } = await sb.from("agent_rescue_logs")
        .select("id", { count: "exact", head: true })
        .eq("phone", conv.phone)
        .eq("system", "sarah")
      const attemptNum = (totalAttempts || 0) + 1

      if (attemptNum > 3) {
        try { await sb.from("customer_conversations").update({ needs_human_review: true }).eq("phone", conv.phone).eq("agent_id", conv.agent_id) } catch {}
        await alertAdmin(`Sarah rescue maxed out: ${conv.phone} (${conv.customer_name || "unknown"}) stuck in ${conv.state} after 3 attempts`)
        await sb.from("agent_rescue_logs").insert({
          system: "sarah", phone: conv.phone, stuck_state: conv.state,
          rescue_message: "", attempt_number: attemptNum, escalated: true, sent_at: new Date().toISOString(),
        })
        results.escalated++
        continue
      }

      // Get recent messages for AI context
      const { data: msgs } = await sb.from("customer_sms_logs")
        .select("body, direction")
        .eq("phone", conv.phone)
        .order("created_at", { ascending: false })
        .limit(5)
      const recentMsgs = (msgs || []).reverse().map(m => `${m.direction}: ${m.body}`)

      // Generate rescue message
      const rescueMsg = await generateRescue("sarah", conv.state, conv.phone, recentMsgs)
      if (!rescueMsg) {
        await alertAdmin(`Sarah rescue: can't generate for ${conv.phone} in ${conv.state}`)
        results.escalated++
        continue
      }

      // Send SMS FROM the agent's Twilio number so agent illusion is preserved
      const rescueFrom = conv.source_number ? `+1${conv.source_number}` : FROM_CUSTOMER
      const sent = await sendSMSraw(`+1${conv.phone}`, rescueMsg, rescueFrom)
      if (sent) {
        await sb.from("customer_sms_logs").insert({
          phone: conv.phone, body: `[RESCUE ${conv.state}] ${rescueMsg}`,
          direction: "outbound", message_sid: `rescue_s_${Date.now()}`,
        })
        await sb.from("customer_conversations").update({ updated_at: new Date().toISOString() }).eq("phone", conv.phone).eq("agent_id", conv.agent_id)
      }

      await sb.from("agent_rescue_logs").insert({
        system: "sarah", phone: conv.phone, stuck_state: conv.state,
        rescue_message: rescueMsg, attempt_number: attemptNum, escalated: false, sent_at: new Date().toISOString(),
      })
      results.sarah_rescued++
    } catch (e: any) {
      console.error(`[rescue sarah] Error for ${conv.phone}:`, e.message)
    }
  }

  console.log(`[rescue] Done: ${JSON.stringify(results)}`)

  return NextResponse.json({ success: true, ...results })
}
