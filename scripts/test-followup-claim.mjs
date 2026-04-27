#!/usr/bin/env node
/**
 * Validates claim_followup_attempt + get_followup_candidates against PROD.
 *
 * Inserts 2 customer_conversations rows for the same phone (different agent_id —
 * mimics the real duplicate-row pattern), then exercises:
 *   1. get_followup_candidates returns ONE entry for the phone (deduped)
 *   2. claim_followup_attempt returns true on first call AND fans out the
 *      follow_up_count increment to BOTH rows
 *   3. claim_followup_attempt returns false on second call within 24h cooldown
 *   4. on_customer_inbound resets follow_up_count to 0 on BOTH rows
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=https://agsjodzzjrnqdopysjbb.supabase.co \
 *   SUPA_SRV=<service-role-key> \
 *   node scripts/test-followup-claim.mjs
 */
import { createClient } from "@supabase/supabase-js"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPA_SRV || process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error("missing NEXT_PUBLIC_SUPABASE_URL or SUPA_SRV / SUPABASE_SERVICE_ROLE_KEY")
  process.exit(2)
}

const sb = createClient(url, key, { auth: { persistSession: false } })

const phone = `9999${Date.now().toString().slice(-6)}`
const sentinelAgent = "00000000-0000-0000-0000-000000000001"
const realAgent = "024f2627-b16b-4ef7-bc21-fe195688360c"  // any real-looking uuid

let exitCode = 0
const fail = (msg) => { console.error("FAIL:", msg); exitCode = 1 }

try {
  // Seed: two rows for same phone, 26h-old outbound/inbound to satisfy cooldown
  const aDayAndHourAgo = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString()
  for (const [agentId, updatedAt] of [
    [sentinelAgent, new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()],   // newer = canonical
    [realAgent,     new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString()],
  ]) {
    const { error } = await sb.from("customer_conversations").insert({
      phone, agent_id: agentId, agent_name: "sarah",
      mode: "AI_ACTIVE", state: "QUOTING",
      follow_up_count: 0, opted_out: false,
      last_outbound_at: aDayAndHourAgo,
      last_inbound_at:  aDayAndHourAgo,
      updated_at: updatedAt,
    })
    if (error) throw new Error(`seed insert (${agentId}): ${error.message}`)
  }

  // 1. Candidates list dedupes to one entry per phone
  const candResp = await sb.rpc("get_followup_candidates", { p_limit: 100 })
  if (candResp.error) throw new Error(`get_followup_candidates: ${candResp.error.message}`)
  const matches = (candResp.data || []).filter(r => r.phone === phone)
  if (matches.length !== 1) fail(`expected 1 candidate for ${phone}, got ${matches.length}`)

  // 2. First claim returns true and fans out follow_up_count to BOTH rows
  const claim1 = await sb.rpc("claim_followup_attempt", { p_phone: phone })
  if (claim1.error) throw new Error(`claim 1: ${claim1.error.message}`)
  if (claim1.data !== true) fail(`first claim should return true, got ${claim1.data}`)

  const { data: postClaim } = await sb
    .from("customer_conversations")
    .select("agent_id, follow_up_count")
    .eq("phone", phone)
  const counts = (postClaim || []).map(r => r.follow_up_count)
  if (counts.length !== 2 || counts[0] !== counts[1] || counts[0] !== 1) {
    fail(`expected both rows to have follow_up_count=1; got ${JSON.stringify(counts)}`)
  }

  // 3. Second claim within 24h cooldown returns false
  const claim2 = await sb.rpc("claim_followup_attempt", { p_phone: phone })
  if (claim2.error) throw new Error(`claim 2: ${claim2.error.message}`)
  if (claim2.data !== false) fail(`second claim within 24h should return false, got ${claim2.data}`)

  // 4. on_customer_inbound resets count on BOTH rows
  const reset = await sb.rpc("on_customer_inbound", { p_phone: phone })
  if (reset.error) throw new Error(`on_customer_inbound: ${reset.error.message}`)
  const { data: postReset } = await sb
    .from("customer_conversations")
    .select("follow_up_count, last_followup_at, followup_paused_until")
    .eq("phone", phone)
  if ((postReset || []).some(r => r.follow_up_count !== 0)) fail("expected all rows to reset to follow_up_count=0")
  if ((postReset || []).some(r => r.last_followup_at !== null)) fail("expected all rows to clear last_followup_at")

  if (exitCode === 0) console.log("PASS: rescue/followup claim semantics correct")
} catch (err) {
  console.error("ERROR:", err?.message || err)
  exitCode = 1
} finally {
  // Always clean up
  await sb.from("customer_conversations").delete().eq("phone", phone)
}

process.exit(exitCode)
