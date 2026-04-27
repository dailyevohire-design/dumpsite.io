import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabase } from "@/lib/supabase"
import { insertSmsLog, sendOutboundSMS } from "@/lib/sms"
import { withFailClosed } from "@/lib/sms/fail-closed"
import { notifyAdminThrottled } from "@/lib/alerts/notify-admin-throttled"
import Anthropic from "@anthropic-ai/sdk"

// ─────────────────────────────────────────────────────────────────
// STUCK CONVERSATION RESCUE AGENT — runs every 30 minutes
// Finds stuck Jesse (driver) and Sarah (customer) conversations,
// generates persona-appropriate rescue messages via Claude,
// and sends them to nudge the conversation forward.
//
// Every failure path persists a row to agent_rescue_logs with
// alert_type set, so the watchdog/health view sees it.
// ─────────────────────────────────────────────────────────────────

const FROM_DRIVER = process.env.TWILIO_FROM_NUMBER_2 || process.env.TWILIO_FROM_NUMBER || ""
const FROM_CUSTOMER = process.env.CUSTOMER_TWILIO_NUMBER || ""

const ANTHROPIC_MODEL = "claude-sonnet-4-6"
const MAX_ANTHROPIC_ATTEMPTS = 3
const RETRY_BACKOFF_MS = [0, 2000, 5000]

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
  // Admin alerts now route through notifyAdminThrottled (which honors
  // PAUSE_ADMIN_SMS itself). sendSMSraw is now only used for customer/driver
  // sends, so no admin-pause check here.
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
  await notifyAdminThrottled("agent_rescue_stuck", "system", `DumpSite.io Rescue: ${msg}`, {
    source: "agent:rescue-stuck",
  })
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

// ── Anthropic call with retry (3 attempts, 0/2s/5s, 5xx/429 only) ──

type ClaudeResult =
  | { ok: true; text: string; attempts: number }
  | {
      ok: false
      attempts: number
      alertType: "anthropic_5xx_after_retry" | "anthropic_4xx" | "anthropic_malformed"
      errorDetail: string
    }

async function callClaudeWithRetry(
  client: Anthropic,
  system: string,
  userContent: string,
  maxTokens: number
): Promise<ClaudeResult> {
  let lastErr: any = null
  let lastStatus: number | null = null

  for (let attempt = 0; attempt < MAX_ANTHROPIC_ATTEMPTS; attempt++) {
    if (RETRY_BACKOFF_MS[attempt] > 0) {
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[attempt]))
    }
    try {
      const resp = await client.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: userContent }],
      })
      const text = resp.content[0]?.type === "text" ? resp.content[0].text.trim() : null
      if (!text) {
        return {
          ok: false,
          attempts: attempt + 1,
          alertType: "anthropic_malformed",
          errorDetail: "no text block in response",
        }
      }
      return { ok: true, text, attempts: attempt + 1 }
    } catch (e: any) {
      lastErr = e
      lastStatus = e?.status ?? e?.response?.status ?? null
      const retriable =
        lastStatus === 429 ||
        (typeof lastStatus === "number" && lastStatus >= 500 && lastStatus < 600)
      if (!retriable) {
        return {
          ok: false,
          attempts: attempt + 1,
          alertType: "anthropic_4xx",
          errorDetail: `${lastStatus ?? "?"}: ${e?.message ?? "unknown"}`,
        }
      }
    }
  }
  return {
    ok: false,
    attempts: MAX_ANTHROPIC_ATTEMPTS,
    alertType: "anthropic_5xx_after_retry",
    errorDetail: `${lastStatus ?? "?"}: ${lastErr?.message ?? "unknown"}`,
  }
}

// ── Rescue message generation ──

type RescueGenResult =
  | { ok: true; text: string; aiUsed: boolean; attempts: number }
  | {
      ok: false
      aiUsed: true
      attempts: number
      alertType: "anthropic_5xx_after_retry" | "anthropic_4xx" | "anthropic_malformed"
      errorDetail: string
    }
  | { ok: false; aiUsed: false; attempts: 0; alertType: "escalate_required" }

async function generateRescue(
  system: "jesse" | "sarah",
  state: string,
  recentMessages: string[]
): Promise<RescueGenResult> {
  const map = system === "jesse" ? JESSE_RESCUE_MAP : SARAH_RESCUE_MAP
  const staticMsg = map[state]
  if (staticMsg && staticMsg !== "ESCALATE") {
    return { ok: true, text: staticMsg, aiUsed: false, attempts: 0 }
  }
  if (staticMsg === "ESCALATE") {
    return { ok: false, aiUsed: false, attempts: 0, alertType: "escalate_required" }
  }

  // Unmapped state — try AI
  const persona =
    system === "jesse"
      ? "You are Jesse from DumpSite.io — a real dirt broker. Ultra short texts, trucker voice, no punctuation, 1-3 sentences max. Never reveal you're AI."
      : "You are Sarah from DumpSite.io — warm, professional customer service. Friendly but concise. Never reveal you're AI."
  const maxChars = system === "jesse" ? 160 : 320
  const context = recentMessages.length
    ? `Recent messages:\n${recentMessages.slice(-5).join("\n")}`
    : "No recent messages available."

  let client: Anthropic
  try {
    client = new Anthropic()
  } catch (e: any) {
    return {
      ok: false,
      aiUsed: true,
      attempts: 0,
      alertType: "anthropic_4xx",
      errorDetail: `client init: ${e?.message ?? "unknown"}`,
    }
  }

  const userContent = `This conversation is stuck in state "${state}". The driver/customer hasn't responded in over an hour.\n\n${context}\n\nWrite a single short rescue text to nudge them forward. Under ${maxChars} characters. Just the message text, nothing else.`

  const result = await callClaudeWithRetry(client, persona, userContent, 100)
  if (!result.ok) {
    return {
      ok: false,
      aiUsed: true,
      attempts: result.attempts,
      alertType: result.alertType,
      errorDetail: result.errorDetail,
    }
  }
  let text = result.text
  if (text.length > maxChars) {
    console.warn(`[rescue] AI response too long (${text.length} chars), truncating`)
    text = text.slice(0, maxChars)
  }
  return { ok: true, text, aiUsed: true, attempts: result.attempts }
}

// ── Logging helper ──

type LogRow = {
  system: "jesse" | "sarah"
  phone: string
  stuck_state: string
  rescue_message: string
  attempt_number: number
  escalated: boolean
  alert_type: string
  error_detail?: string | null
  anthropic_attempts?: number | null
}

async function logRescue(sb: any, row: LogRow) {
  try {
    await sb.from("agent_rescue_logs").insert({
      ...row,
      sent_at: new Date().toISOString(),
    })
  } catch (e: any) {
    console.error("[rescue] log insert failed:", e.message)
  }
}

// ── Main handler ──

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
  const results = {
    jesse_rescued: 0,
    sarah_rescued: 0,
    escalated: 0,
    skipped: 0,
    failed: 0,
  }

  // ═══ JESSE RESCUE (conversations table) ═══

  const jesseTerminal = ["CLOSED", "DISCOVERY", "COMPLETED"]
  const { data: stuckJesse } = await sb
    .from("conversations")
    .select("phone, state, updated_at")
    .not("state", "in", `(${jesseTerminal.join(",")})`)
    .lt("updated_at", oneHourAgo)
    .limit(20)

  for (const conv of stuckJesse || []) {
    try {
      const { data: profile } = await sb
        .from("driver_profiles")
        .select("sms_opted_out")
        .eq("phone", conv.phone)
        .maybeSingle()
      if (profile?.sms_opted_out) {
        results.skipped++
        continue
      }

      const { data: convFull } = await sb
        .from("conversations")
        .select("needs_human_review")
        .eq("phone", conv.phone)
        .maybeSingle()
      if (convFull?.needs_human_review) {
        results.skipped++
        continue
      }

      const { data: recentRescue } = await sb
        .from("agent_rescue_logs")
        .select("id")
        .eq("phone", conv.phone)
        .eq("system", "jesse")
        .gte("sent_at", fourHoursAgo)
        .limit(1)
      if (recentRescue?.length) {
        results.skipped++
        continue
      }

      const { count: totalAttempts } = await sb
        .from("agent_rescue_logs")
        .select("id", { count: "exact", head: true })
        .eq("phone", conv.phone)
        .eq("system", "jesse")
      const attemptNum = (totalAttempts || 0) + 1

      if (attemptNum > 3) {
        try {
          await sb.from("conversations").update({ needs_human_review: true }).eq("phone", conv.phone)
        } catch {}
        await alertAdmin(
          `Jesse rescue maxed out: ${conv.phone} stuck in ${conv.state} after 3 attempts`
        )
        await logRescue(sb, {
          system: "jesse",
          phone: conv.phone,
          stuck_state: conv.state,
          rescue_message: "",
          attempt_number: attemptNum,
          escalated: true,
          alert_type: "escalation_max_attempts",
        })
        results.escalated++
        continue
      }

      const { data: msgs } = await sb
        .from("sms_logs")
        .select("body, direction")
        .eq("phone", conv.phone)
        .order("created_at", { ascending: false })
        .limit(5)
      const recentMsgs = (msgs || [])
        .reverse()
        .map((m: any) => `${m.direction}: ${m.body}`)

      const gen = await generateRescue("jesse", conv.state, recentMsgs)

      if (!gen.ok && gen.alertType === "escalate_required") {
        await alertAdmin(`Jesse needs human eyes: ${conv.phone} stuck in ${conv.state}`)
        await logRescue(sb, {
          system: "jesse",
          phone: conv.phone,
          stuck_state: conv.state,
          rescue_message: "",
          attempt_number: attemptNum,
          escalated: true,
          alert_type: "escalation_required_state",
        })
        results.escalated++
        continue
      }

      if (!gen.ok) {
        await alertAdmin(`Jesse rescue AI failed (${gen.alertType}): ${conv.phone} in ${conv.state}`)
        await logRescue(sb, {
          system: "jesse",
          phone: conv.phone,
          stuck_state: conv.state,
          rescue_message: "",
          attempt_number: attemptNum,
          escalated: true,
          alert_type: gen.alertType,
          error_detail: gen.errorDetail,
          anthropic_attempts: gen.attempts,
        })
        results.failed++
        continue
      }

      const sent = await sendSMSraw(`+1${conv.phone}`, gen.text, FROM_DRIVER)
      if (!sent) {
        await alertAdmin(`Jesse rescue Twilio send failed: ${conv.phone} in ${conv.state}`)
        await logRescue(sb, {
          system: "jesse",
          phone: conv.phone,
          stuck_state: conv.state,
          rescue_message: gen.text,
          attempt_number: attemptNum,
          escalated: false,
          alert_type: "twilio_send_failed",
          anthropic_attempts: gen.aiUsed ? gen.attempts : null,
        })
        results.failed++
        continue
      }

      await insertSmsLog(sb, "sms_logs", {
        phone: conv.phone,
        body: gen.text,
        direction: "outbound",
        message_sid: `rescue_j_${Date.now()}`,
      })
      await sb
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("phone", conv.phone)

      await logRescue(sb, {
        system: "jesse",
        phone: conv.phone,
        stuck_state: conv.state,
        rescue_message: gen.text,
        attempt_number: attemptNum,
        escalated: false,
        alert_type: "success",
        anthropic_attempts: gen.aiUsed ? gen.attempts : null,
      })
      results.jesse_rescued++
    } catch (e: any) {
      console.error(`[rescue jesse] Error for ${conv.phone}:`, e.message)
      results.failed++
    }
  }

  // ═══ SARAH RESCUE (customer_conversations table) ═══

  const sarahTerminal = ["CLOSED", "DELIVERED", "ORDER_PLACED", "OUT_OF_AREA"]
  const { data: stuckSarah } = await sb
    .from("customer_conversations")
    .select("phone, agent_id, source_number, state, updated_at, opted_out, customer_name")
    .not("state", "in", `(${sarahTerminal.join(",")})`)
    .eq("opted_out", false)
    .lt("updated_at", oneHourAgo)
    .limit(20)

  for (const conv of stuckSarah || []) {
    await withFailClosed(conv.phone, async (setSendCommitted) => {
      // Atomic shared cap+cooldown across rescue + customer-followup crons.
      // Predicate (in RPC): mode=AI_ACTIVE, !opted_out, !human_review, !paused,
      // follow_up_count<3, no inbound/outbound/followup in last 24h. Updates
      // ALL rows for this phone to keep duplicate rows in sync.
      const { data: claimed } = await sb.rpc("claim_followup_attempt", { p_phone: conv.phone })

      if (!claimed) {
        // Distinguish cap-reached from cooldown-not-elapsed using the canonical row.
        const { data: canonRows } = await sb
          .from("customer_conversations")
          .select("follow_up_count, needs_human_review")
          .eq("phone", conv.phone)
          .order("updated_at", { ascending: false })
          .limit(1)
        const canon = canonRows?.[0]
        if (canon && (canon.follow_up_count ?? 0) >= 3 && !canon.needs_human_review) {
          await sb.from("customer_conversations")
            .update({ needs_human_review: true }).eq("phone", conv.phone)
          await alertAdmin(`Sarah rescue cap reached: ${conv.phone} (${conv.customer_name || "unknown"}) stuck in ${conv.state}`)
          await logRescue(sb, {
            system: "sarah", phone: conv.phone, stuck_state: conv.state,
            rescue_message: "", attempt_number: (canon.follow_up_count ?? 0) + 1,
            escalated: true, alert_type: "escalation_max_attempts",
          })
          results.escalated++
        } else {
          results.skipped++
        }
        return
      }

      // Pull the post-claim count for accurate logging.
      const { data: postClaim } = await sb
        .from("customer_conversations")
        .select("follow_up_count")
        .eq("phone", conv.phone)
        .order("updated_at", { ascending: false })
        .limit(1)
      const attemptNum = postClaim?.[0]?.follow_up_count ?? 1

      const { data: msgs } = await sb
        .from("customer_sms_logs")
        .select("body, direction")
        .eq("phone", conv.phone)
        .order("created_at", { ascending: false })
        .limit(5)
      const recentMsgs = (msgs || []).reverse().map((m: any) => `${m.direction}: ${m.body}`)
      const gen = await generateRescue("sarah", conv.state, recentMsgs)

      if (!gen.ok && gen.alertType === "escalate_required") {
        await alertAdmin(`Sarah needs human eyes: ${conv.phone} stuck in ${conv.state}`)
        await logRescue(sb, {
          system: "sarah", phone: conv.phone, stuck_state: conv.state,
          rescue_message: "", attempt_number: attemptNum,
          escalated: true, alert_type: "escalation_required_state",
        })
        results.escalated++
        return
      }

      if (!gen.ok) {
        await alertAdmin(`Sarah rescue AI failed (${gen.alertType}): ${conv.phone} in ${conv.state}`)
        await logRescue(sb, {
          system: "sarah", phone: conv.phone, stuck_state: conv.state,
          rescue_message: "", attempt_number: attemptNum,
          escalated: true, alert_type: gen.alertType,
          error_detail: gen.errorDetail, anthropic_attempts: gen.attempts,
        })
        results.failed++
        return
      }

      const rescueFrom = conv.source_number ? `+1${conv.source_number}` : FROM_CUSTOMER
      const sendResult = await sendOutboundSMS({ to: conv.phone, body: gen.text, from: rescueFrom })
      if (!sendResult.ok) {
        await alertAdmin(`Sarah rescue Twilio send failed: ${conv.phone} in ${conv.state} — ${sendResult.error}`)
        await logRescue(sb, {
          system: "sarah", phone: conv.phone, stuck_state: conv.state,
          rescue_message: gen.text, attempt_number: attemptNum,
          escalated: false, alert_type: "twilio_send_failed",
          anthropic_attempts: gen.aiUsed ? gen.attempts : null,
        })
        results.failed++
        return
      }
      // Customer just received the message. Failures past this point are
      // post-send audit issues, not brain failures — don't pause the convo.
      setSendCommitted()

      await insertSmsLog(sb, "customer_sms_logs", {
        phone: conv.phone,
        body: sendResult.sanitizedBody,
        direction: "outbound",
        message_sid: `rescue_s_${Date.now()}`,
      })

      await logRescue(sb, {
        system: "sarah", phone: conv.phone, stuck_state: conv.state,
        rescue_message: sendResult.sanitizedBody, attempt_number: attemptNum,
        escalated: false, alert_type: "success",
        anthropic_attempts: gen.aiUsed ? gen.attempts : null,
      })
      results.sarah_rescued++
    }, {
      source: "rescue-stuck-sarah",
      onError: async () => { results.failed++; return null },
    })
  }

  console.log(`[rescue] Done: ${JSON.stringify(results)}`)

  return NextResponse.json({ success: true, ...results })
}
