/**
 * Phase 4E — Conversation scoring + failure detection.
 *
 * Runs after a conversation closes (reaches CLOSED state) to produce a quality score.
 * Low scores are inserted into conversation_scores for review; if auto-learning is
 * enabled, a candidate rule is proposed via auto-learn.service.
 *
 * Depends on: sms_logs, conversations, conversation_scores tables.
 */

import { createAdminSupabase } from "../supabase"

export interface ConversationScore {
  completion: number    // 0-1 — did dispatch succeed (reached CLOSED with payment collected)
  efficiency: number    // 0-1 — turns vs baseline (8 turns = 1.0)
  frustration: number   // 0-1 — 0 = calm, 1 = very frustrated
  safetyNetFired: boolean
  validatorReplaced: boolean
  templateHitRate: number  // fraction of messages handled by tryTemplate vs callBrain
  totalTurns: number
}

const FRUSTRATION_PATTERNS = [
  /\b(wtf|what the|this sucks|useless|stupid|broken|bullshit)\b/i,
  /\?{3,}/,               // three or more question marks
  /^[A-Z\s!?]{10,}$/,     // ALL CAPS messages ≥10 chars
  /\b(cancel|forget it|never mind|nvm)\b/i,
]

export async function scoreConversation(phone: string): Promise<ConversationScore> {
  const sb = createAdminSupabase()

  // Pull the conversation + full message history for this phone
  const digits = phone.replace(/\D/g, "")
  const [{ data: conv }, { data: logs }] = await Promise.all([
    sb.from("conversations").select("*").eq("phone", digits).maybeSingle(),
    sb.from("sms_logs")
      .select("body, direction, created_at")
      .eq("phone", digits)
      .order("created_at", { ascending: true })
      .limit(200),
  ])

  const inbound = (logs || []).filter((l: any) => l.direction === "inbound")
  const totalTurns = inbound.length

  // Frustration detection on inbound messages
  let frustratedCount = 0
  for (const msg of inbound) {
    const body = msg.body || ""
    if (FRUSTRATION_PATTERNS.some(p => p.test(body))) frustratedCount++
  }
  const frustration = totalTurns > 0 ? Math.min(1, frustratedCount / totalTurns) : 0

  // Completion: reached CLOSED with a payment method captured
  const completion = conv?.state === "CLOSED" && conv?.job_state ? 1 : conv?.state === "CLOSED" ? 0.7 : 0

  // Efficiency: 8 turns = 1.0; every turn over that linearly docks.
  const efficiency = totalTurns > 0 ? Math.max(0, Math.min(1, 1 - Math.max(0, totalTurns - 8) / 20)) : 0

  // Handler mix — stored in brain_decisions (Phase 10). If not populated yet, default.
  let templateHitRate = 0
  let safetyNetFired = false
  let validatorReplaced = false
  try {
    const { data: decisions } = await sb
      .from("brain_decisions")
      .select("handler, validator_replaced")
      .eq("conversation_phone", digits)
      .limit(100)
    if (decisions && decisions.length > 0) {
      const templateHits = decisions.filter((d: any) => d.handler === "template").length
      templateHitRate = templateHits / decisions.length
      safetyNetFired = decisions.some((d: any) => d.handler === "safety_net" || d.handler === "fallback")
      validatorReplaced = decisions.some((d: any) => d.validator_replaced === true)
    }
  } catch {
    // brain_decisions table may not exist yet — ignore
  }

  return { completion, efficiency, frustration, safetyNetFired, validatorReplaced, templateHitRate, totalTurns }
}

export async function detectAndLogFailure(score: ConversationScore, phone: string): Promise<boolean> {
  const isFailure = score.completion < 0.5 || score.frustration > 0.3 || score.safetyNetFired

  try {
    await createAdminSupabase().from("conversation_scores").insert({
      conversation_phone: phone.replace(/\D/g, ""),
      completion_score: score.completion,
      efficiency_score: score.efficiency,
      frustration_score: score.frustration,
      safety_net_count: score.safetyNetFired ? 1 : 0,
      validator_replacement_count: score.validatorReplaced ? 1 : 0,
      template_hit_rate: score.templateHitRate,
      total_turns: score.totalTurns,
      reached_payment: score.completion >= 0.7,
    })
  } catch (err) {
    console.error("[MONITOR] failed to log score:", err)
  }

  return isFailure
}
