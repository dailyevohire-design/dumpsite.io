/**
 * Phase 4F — Auto-rule generation from failed conversations.
 *
 * When a conversation fails (low score), this service asks Claude Opus what single
 * rule would prevent the failure. Candidates go into brain_learnings with
 * active=false until an admin approves them (via SMS or UI).
 *
 * Conflict detection: candidates >0.8 Levenshtein similarity to any existing active
 * rule are rejected to prevent drift.
 */

import Anthropic from "@anthropic-ai/sdk"
import { distance as levenshteinDistance } from "fastest-levenshtein"
import { createAdminSupabase } from "../supabase"

const anthropic = new Anthropic()

interface ProposedRule {
  rule: string
  category: string
  priority: number
  confidence: number
}

function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  return 1 - levenshteinDistance(a.toLowerCase(), b.toLowerCase()) / maxLen
}

export async function generateLearningFromFailure(phone: string, conversationId?: string): Promise<ProposedRule | null> {
  const sb = createAdminSupabase()
  const digits = phone.replace(/\D/g, "")

  // Fetch up to the last 50 messages for context
  const { data: logs } = await sb
    .from("sms_logs")
    .select("body, direction, created_at")
    .eq("phone", digits)
    .order("created_at", { ascending: true })
    .limit(50)
  if (!logs || logs.length === 0) return null

  const transcript = logs
    .map((l: any) => `[${l.direction.toUpperCase()}] ${l.body}`)
    .join("\n")

  const prompt = `Analyze this failed dispatch conversation between Jesse (dispatcher) and a dump truck driver. What went wrong? What single rule would prevent this exact failure from happening again?

Conversation:
${transcript}

Return JSON only, no prose:
{"rule": "one sentence imperative rule", "category": "safety|style|extraction|dispatch|payment|language|tone|photos", "priority": 1-100, "confidence": 0-1}

Confidence should be >0.7 only if the failure mode is clearly actionable via a rule. Return confidence <0.5 if unsure.`

  let proposed: ProposedRule
  try {
    const resp = await anthropic.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 300,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    })
    const text = resp.content[0].type === "text" ? resp.content[0].text.trim() : ""
    const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim()
    proposed = JSON.parse(cleaned)
  } catch (err) {
    console.error("[AUTO-LEARN] Opus call failed:", err)
    return null
  }

  if (proposed.confidence < 0.7) {
    console.log("[AUTO-LEARN] low confidence, skipping:", proposed)
    return null
  }

  // Conflict detection: reject if >80% similar to an existing active rule
  const { data: existing } = await sb
    .from("brain_learnings")
    .select("rule")
    .eq("brain", "jesse")
    .eq("active", true)
  const conflict = existing?.find((r: any) => similarity(r.rule, proposed.rule) > 0.8)
  if (conflict) {
    console.log("[AUTO-LEARN] conflict with existing rule, skipping:", conflict.rule)
    return null
  }

  // Insert as pending (active=false until admin approves)
  await sb.from("brain_learnings").insert({
    brain: "jesse",
    rule: proposed.rule,
    category: proposed.category,
    priority: proposed.priority,
    active: false,
    auto_generated: true,
    source_conversation_id: conversationId || null,
  })

  return proposed
}

/**
 * Phase 4G — rule garbage collection. Intended to run monthly via Vercel cron or
 * Supabase pg_cron.
 */
export async function garbageCollectRules(): Promise<{ deactivated: number }> {
  const sb = createAdminSupabase()
  let deactivated = 0

  // 1. Deactivate rules older than 90 days with times_injected < 10
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const { data: stale } = await sb
    .from("brain_learnings")
    .update({ active: false })
    .eq("brain", "jesse")
    .eq("active", true)
    .lt("created_at", ninetyDaysAgo)
    .lt("times_injected", 10)
    .select("id")
  deactivated += stale?.length || 0

  // 2. Cap total active rules at 30 — deactivate lowest priority excess
  const { data: allActive } = await sb
    .from("brain_learnings")
    .select("id, priority")
    .eq("brain", "jesse")
    .eq("active", true)
    .order("priority", { ascending: true })
  if (allActive && allActive.length > 30) {
    const toDeactivate = allActive.slice(0, allActive.length - 30).map((r: any) => r.id)
    await sb.from("brain_learnings").update({ active: false }).in("id", toDeactivate)
    deactivated += toDeactivate.length
  }

  console.log(`[GC] deactivated ${deactivated} rules`)
  return { deactivated }
}
